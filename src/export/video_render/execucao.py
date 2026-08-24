"""Execucao do render: fila sequencial, subprocesso ffmpeg, progresso e
cancelamento (pacote C).

Padroes da casa seguidos aqui de proposito:

- SUBPROCESSO: `_startupinfo()` igual a src/media/audio_chain.py:152 (nenhuma
  janela de console piscando no Windows); stdout alimenta o progresso via
  `-progress pipe:1`, stderr e drenado por thread auxiliar -- mesma topologia
  de `_rodar_ffmpeg` (audio_chain.py:526) e de `generate_video_proxy`
  (src/media/ffmpeg.py).

- ARQUIVO PARCIAL: grava em `<nome>.parcial.mp4` e renomeia no fim, como o
  WAV tratado faz. Um MP4 truncado que parece pronto e pior que nada; no
  cancelamento e falha o parcial morre.

- REGISTRO DE PROCESSO FORA DO TASK_MANAGER (decisao documentada):
  TASK_MANAGER.register_process/cancel_process sao indexados por video_id INT
  -- e o cancelamento generico (media.py:1225) so mata processo registrado
  quando a chave da tarefa e toda de digitos. Nossa chave e
  "render_timeline_{id}" (modelo.Pedido.chave_tarefa), que nunca e digito, e
  forcar um id falso criaria colisao real: cancel_process(3), acionado pelo
  usuario para matar o video 3, mataria o render da TIMELINE 3. Entao o Popen
  vive num registro proprio, indexado por timeline_id, com API dedicada
  (`cancelar_render`). O caminho cooperativo (is_cancelled no laco de leitura)
  continua valendo pelos TASK_MANAGER.cancel_task -- e e ele que a rota
  generica ja dispara sem codigo novo.

- PROGRESSO: nesta maquina (ffmpeg 7.1.4-Jellyfin, medido 24/08/2026) o
  `-progress` imprime `out_time_ms=2000000` para 2 s de video: o valor e
  MICROSEGUNDOS apesar do nome (quirk historico do ffmpeg), e `out_time_us`
  tambem vem na mesma medida. O parser prefere `out_time_us` e trata
  `out_time_ms` como micros; como rede de seguranca, `out_time=HH:MM:SS.x`.
"""
import datetime
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core.tasks import TASK_MANAGER

from . import comando
from . import midia
from .comando import _clipes_em_cena  # mesmo pacote: os recortes pos-regra-P4
from .midia import assegurar_destino_seguro

# Fracao do progresso reservada a juncao dos segmentos (concat -c copy e
# quase instantaneo, mas nao e zero; reservar evita ficar preso em 100%
# "mentiroso" durante a copia).
_FRACAO_CONCAT = 0.04


class RenderCancelado(Exception):
    """Sinal interno: o usuario pediu cancelamento e o processo foi morto."""


def _startupinfo():
    """Mesmo jeito de invocar subprocesso de src/media/audio_chain.py:152."""
    startupinfo = None
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return startupinfo


# ---------------------------------------------------------------------------
# Registro proprio de processos (por que nao TASK_MANAGER.register_process:
# ver docstring do modulo)
# ---------------------------------------------------------------------------

_PROCESSOS: Dict[int, subprocess.Popen] = {}
_PROCESSOS_LOCK = threading.Lock()


def _registrar_processo(timeline_id: int, proc: subprocess.Popen) -> None:
    with _PROCESSOS_LOCK:
        _PROCESSOS[int(timeline_id)] = proc


def _desregistrar_processo(timeline_id: int) -> None:
    with _PROCESSOS_LOCK:
        _PROCESSOS.pop(int(timeline_id), None)


def _matar_processo(proc: subprocess.Popen) -> None:
    """terminate() e, se nao morrer em alguns segundos, kill()."""
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
    except OSError:
        pass
    try:
        proc.wait(timeout=3)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        proc.kill()
        proc.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass  # vai embora quando o SO conseguir; nada mais a fazer


def cancelar_render(timeline_id: int) -> bool:
    """Cancela o render da timeline: mata o ffmpeg registrado e marca a tarefa.

    Marca ANTES de matar: o laco de leitura pode enxergar o flag e encerrar
    limpo mesmo se o kill chegar tarde. Devolve True se havia processo vivo.
    """
    timeline_id = int(timeline_id)
    TASK_MANAGER.cancel_task(f"render_timeline_{timeline_id}")
    with _PROCESSOS_LOCK:
        proc = _PROCESSOS.get(timeline_id)
    if proc is None:
        return False
    _matar_processo(proc)
    return True


# ---------------------------------------------------------------------------
# Fila SEQUENCIAL (um render por vez, FIFO). Editar a timeline continua livre:
# quem trava e a fila de render, nunca a edicao.
# ---------------------------------------------------------------------------

_FILA: "queue.Queue[Dict[str, Any]]" = queue.Queue()
_FILA_LOCK = threading.Lock()
_EM_ESPERA: Dict[str, Dict[str, Any]] = {}
_EXECUTANDO: Set[str] = set()
_WORKER_VIVA = False


def _garantir_worker() -> None:
    global _WORKER_VIVA
    with _FILA_LOCK:
        if _WORKER_VIVA:
            return
        _WORKER_VIVA = True
    threading.Thread(target=_laco_da_fila, name="render-video-fila",
                     daemon=True).start()


def _laco_da_fila() -> None:
    global _WORKER_VIVA
    while True:
        item = _FILA.get()
        pedido = item["pedido"]
        chave = pedido.chave_tarefa
        try:
            with _FILA_LOCK:
                _EXECUTANDO.add(chave)
                _EM_ESPERA.pop(chave, None)
            if TASK_MANAGER.is_cancelled(chave):
                # Cancelado enquanto esperava a vez: registra o [CANCEL] que o
                # usuario procura no log e sai sem tocar no ffmpeg.
                TASK_MANAGER.add_log(
                    chave, "[CANCEL] Render cancelado enquanto aguardava a fila.")
                TASK_MANAGER.update_progress(chave, 0.0, "cancelled", "render")
            else:
                _render_job(item["sequencia"], pedido)
        except Exception as e:  # o worker JAMAIS morre: a fila sobrevive a um job ruim
            try:
                TASK_MANAGER.add_log(chave, f"[FAIL] Erro inesperado na execucao: {e}")
                TASK_MANAGER.update_progress(chave, 0.0, "failed", "render")
            except Exception:
                pass
        finally:
            with _FILA_LOCK:
                _EXECUTANDO.discard(chave)
            _FILA.task_done()


def enfileirar(pedido, sequencia) -> Dict[str, Any]:
    """Enfileira o render e devolve NA HORA (nunca segura o request, secao 6).

    Devolve {"task_key", "posicao", "enfileirado"}; enfileirado=False quando ja
    existe render desta timeline na fila ou em execucao (a chave e unica por
    design -- dois renders da mesma timeline disputariam o mesmo registro de
    progresso e o mesmo arquivo de saida).
    """
    chave = pedido.chave_tarefa
    with _FILA_LOCK:
        if chave in _EM_ESPERA or chave in _EXECUTANDO:
            posicao = list(_EM_ESPERA).index(chave) + 1 if chave in _EM_ESPERA else 1
            return {"task_key": chave, "posicao": posicao,
                    "enfileirado": False,
                    "motivo": "Ja existe um render desta timeline na fila ou em execucao."}
        item = {"pedido": pedido, "sequencia": sequencia,
                "quando": datetime.datetime.now()}
        _EM_ESPERA[chave] = item
        posicao = len(_EM_ESPERA) + (1 if _EXECUTANDO else 0)

    # ARMADILHA DA MARCA VELHA (medida em 24/08/2026).
    # `TASK_MANAGER.cancel_task` poe a chave num set `cancelled_tasks` que NADA
    # limpa sozinho -- so `remove_progress`. Como a chave do render e
    # deterministica ("render_timeline_<id>"), cancelar um render da timeline 9
    # deixava a marca colada nessa chave PARA SEMPRE: o proximo render da mesma
    # timeline via `is_cancelled` verdadeiro e morria na largada. Medido: 1,5 s
    # em vez de 56 s, com "[CANCEL] cancelado pelo usuario" num cancelamento que
    # ninguem fez. A rota generica /api/task/{key}/cancel piora, porque aceita
    # cancelar tarefa inexistente e marca a chave do mesmo jeito.
    # Aqui e o lugar certo de limpar: um pedido NOVO acaba de entrar na fila,
    # entao qualquer cancelamento anterior e, por definicao, de outro job. Limpar
    # no INICIO do job seria tarde -- apagaria um cancelamento legitimo feito
    # enquanto ele esperava a vez.
    TASK_MANAGER.remove_progress(chave)

    _FILA.put(item)
    _garantir_worker()
    TASK_MANAGER.update_progress(chave, 0.0, "queued", "render",
                                 label=f"Aguardando fila de render ({posicao})")
    return {"task_key": chave, "posicao": max(1, posicao), "enfileirado": True}


def estado_fila() -> Dict[str, Any]:
    """Snapshot leve para o pacote D expor junto do status das tarefas."""
    with _FILA_LOCK:
        return {
            "executando": sorted(_EXECUTANDO),
            "aguardando": [{"task_key": k,
                            "timeline_id": v["pedido"].timeline_id}
                           for k, v in _EM_ESPERA.items()],
        }


def executar_agora(sequencia, pedido) -> Dict[str, Any]:
    """Renderiza SINCRONAMENTE, fora da fila.

    Para testes e validacao (e para quem quiser embutir render num fluxo
    proprio). A rota HTTP deve usar `enfileirar`: request nenhum espera um
    master de uma hora.
    """
    return _render_job(sequencia, pedido)


# ---------------------------------------------------------------------------
# Segmentacao (secao 4.2 do plano)
# ---------------------------------------------------------------------------

def dividir_em_segmentos(seq, inicio: float, fim: float,
                         max_clips: int, max_seg_s: float) -> List[Tuple[float, float]]:
    """Recorta a janela [inicio, fim] em trechos contiguos nas COSTURAS de clipe.

    Cada segmento e um mini-render independente com os MESMOS parametros; o
    concat por `-c copy` so e seguro porque todos saem identicos. Cortes caem
    no FIM de um clipe (nunca no meio dele): um clipe mais comprido que o
    limite vira um segmento oversized sozinho -- partir no meio exigiria cortar
    entrada/saida dentro do clipe e complicaria o grafo por ganho pequeno
    (documentado como limitacao, nao como silencio).
    """
    clipes = [c for c in _clipes_em_cena(seq)
              if c.fim_s > inicio + 1e-9 and c.inicio_s < fim - 1e-9]
    if not clipes:
        return [(inicio, fim)]

    segmentos: List[Tuple[float, float]] = []
    seg_ini = inicio
    n_clips = 0
    ultimo_fim = inicio
    for c in clipes:
        fim_do_clipe = min(c.fim_s, fim)
        if n_clips >= max_clips or (n_clips > 0 and (fim_do_clipe - seg_ini) > max_seg_s):
            segmentos.append((seg_ini, ultimo_fim))
            seg_ini = ultimo_fim
            n_clips = 0
        n_clips += 1
        ultimo_fim = max(ultimo_fim, fim_do_clipe)
    if ultimo_fim > seg_ini:
        segmentos.append((seg_ini, min(max(ultimo_fim, fim), fim)))
    else:
        segmentos.append((seg_ini, fim))
    return segmentos


# ---------------------------------------------------------------------------
# O job
# ---------------------------------------------------------------------------

def _rodar_com_progresso(cmd: List[str], chave: str, duracao_janela: float,
                         frac_inicio: float, frac_fim: float, label: str,
                         timeline_id: int) -> None:
    """Roda UM comando ffmpeg mapeando o progresso na fatia [frac_inicio, frac_fim].

    Levanta RenderCancelado quando o usuario pediu cancelamento (processo morto
    antes do sinal). Levanta RuntimeError com a ultima linha util do stderr
    quando o ffmpeg sai diferente de zero.
    """
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, startupinfo=_startupinfo())
    _registrar_processo(timeline_id, proc)

    stderr_linhas: List[str] = []

    def _drenar_stderr():
        try:
            for linha in proc.stderr:  # type: ignore[union-attr]
                stderr_linhas.append(linha)
                if len(stderr_linhas) > 200:
                    del stderr_linhas[:-60]  # guarda a cauda, que e a util
        except (ValueError, OSError):
            pass  # pipe fechado no kill; o retorno usa o que deu pra coletar

    dreno = threading.Thread(target=_drenar_stderr, daemon=True)
    dreno.start()

    def _reportar(frac: float) -> float:
        pct = round(min(max(frac, 0.0), 1.0) * 100.0, 1)
        TASK_MANAGER.update_progress(chave, pct, "running", "render", label=label)
        return pct

    _reportar(frac_inicio)
    ultimo_envio = [0.0]

    cancelou = False
    try:
        assert proc.stdout is not None
        for linha in proc.stdout:
            texto = linha.strip()
            atual_s = _tempo_da_linha(texto)
            if atual_s is not None and duracao_janela > 0:
                agora = time.monotonic()
                # Throttle: o sink do TASK_MANAGER ja limita disco, mas o lock
                # e a string de label custam; 4 informes por segundo bastam.
                if agora - ultimo_envio[0] >= 0.25:
                    ultimo_envio[0] = agora
                    frac = frac_inicio + (frac_fim - frac_inicio) * \
                        min(atual_s / duracao_janela, 1.0)
                    _reportar(frac)
            elif texto.startswith("progress=") and texto.endswith("end"):
                _reportar(frac_fim)
                break
            if TASK_MANAGER.is_cancelled(chave):
                cancelou = True
                _matar_processo(proc)
                break
        codigo = proc.wait()
    finally:
        dreno.join(timeout=5.0)
        _desregistrar_processo(timeline_id)

    if cancelou or TASK_MANAGER.is_cancelled(chave):
        raise RenderCancelado()
    if codigo != 0:
        cauda = "".join(stderr_linhas).strip().splitlines()[-1:] or [f"codigo {codigo}"]
        raise RuntimeError(f"ffmpeg saiu com codigo {codigo}: {cauda[0].strip()}")


def _tempo_da_linha(texto: str) -> Optional[float]:
    """Segundos decodificados de uma linha do -progress; None se nao for tempo.

    Unidades medidas nesta build: out_time_ms e out_time_us VALEM MICROS
    (comentario do docstring do modulo). out_time=00:00:02.000000 entra como
    plano B para builds exoticas que nao emitam nenhum dos dois.
    """
    if texto.startswith("out_time_us="):
        bruto = texto.split("=", 1)[1]
        try:
            return int(bruto) / 1_000_000.0
        except ValueError:
            return None
    if texto.startswith("out_time_ms="):
        try:
            return int(texto.split("=", 1)[1]) / 1_000_000.0  # micros, apesar do nome
        except ValueError:
            return None
    if texto.startswith("out_time="):
        bruto = texto.split("=", 1)[1].strip()
        try:
            hh, mm, ss = bruto.split(":")
            return int(hh) * 3600 + int(mm) * 60 + float(ss)
        except ValueError:
            return None
    return None


def _limpar(caminhos: List[Path], pastas: List[Path]) -> None:
    for p in caminhos:
        try:
            if p.exists():
                p.unlink()
        except OSError:
            pass
    for pasta in pastas:
        try:
            if pasta.exists():
                shutil.rmtree(pasta, ignore_errors=True)
        except OSError:
            pass


def _render_job(sequencia, pedido) -> Dict[str, Any]:
    """O render completo de um pedido. Devolve dict-status; nunca levanta.

    Fluxo: resolver fontes (politica de midia) -> validar destino -> montar
    comando(s) -> rodar com progresso -> [concat] -> renomear parcial. Qualquer
    saida anormal apaga rastro parcial (try/finally) e registra [FAIL]/[CANCEL].
    """
    chave = pedido.chave_tarefa
    timeline_id = int(pedido.timeline_id)
    destino_final: Optional[Path] = None
    parcial: Optional[Path] = None
    tmpdir: Optional[Path] = None

    TASK_MANAGER.update_progress(chave, 0.0, "running", "render", label="Preparando...")
    try:
        # ---- Fontes --------------------------------------------------------
        rel_midia = midia.resolver_fontes(sequencia, pedido)
        for motivo_wav in [f.motivo_tratado for f in rel_midia.fontes.values()
                           if f.motivo_tratado]:
            TASK_MANAGER.add_log(chave, f"[WARN] {motivo_wav}", "WARN")

        if rel_midia.recusas:
            # Recusa unica: midia ausente OU master sem original sem permissao
            # (midia.py ja redigiu as duas mensagens com as listas de clipes).
            TASK_MANAGER.add_log(chave, "[FAIL] " + "; ".join(rel_midia.recusas))
            TASK_MANAGER.update_progress(chave, 0.0, "failed", "render")
            return {"ok": False, "recusado": True, "erro": "; ".join(rel_midia.recusas)}

        if rel_midia.usa_proxy_fallback:
            TASK_MANAGER.add_log(
                chave,
                "[WARN] MASTER caiu para PROXY (original indisponivel). Clipes afetados: "
                + ", ".join(rel_midia.clipes_proxy)
                + ". O nome do arquivo recebe sufixo '_proxy'.", "WARN")

        # ---- Destino -------------------------------------------------------
        cfg = comando.config_render()
        pasta_pedido = getattr(getattr(pedido, "saida", None), "diretorio", None)
        pasta = assegurar_destino_seguro(pasta_pedido or cfg["render.output_dir"])

        sufixo_proxy = rel_midia.usa_proxy_fallback
        nome = getattr(getattr(pedido, "saida", None), "nome_arquivo", None) \
            or comando.nome_arquivo(
                sequencia.nome or f"timeline_{timeline_id}",
                pedido.kind, sufixo_proxy=sufixo_proxy)
        destino_final = pasta / nome
        parcial = destino_final.with_name(destino_final.stem + ".parcial.mp4")

        # ---- Comandos ------------------------------------------------------
        inicio, fim = pedido.faixa.resolver(sequencia.duracao_s())
        duracao_total = fim - inicio
        max_clips = int(cfg["render.segment_max_clips"])
        max_seg_s = float(cfg["render.segment_max_seconds"])
        em_cena = [c for c in _clipes_em_cena(sequencia)
                   if c.fim_s > inicio + 1e-9 and c.inicio_s < fim - 1e-9]
        segmentar = (len(em_cena) > max_clips) or (duracao_total > max_seg_s)

        avisos_pendentes = True
        comandos: List[Tuple[Path, float, float]] = []  # (alvo, ini, fim)

        if segmentar:
            cortes = dividir_em_segmentos(sequencia, inicio, fim, max_clips, max_seg_s)
            tmpdir = parcial.with_name(parcial.stem + "_segmentos")
            tmpdir.mkdir(parents=True, exist_ok=True)
            for i, (s, f) in enumerate(cortes):
                alvo = tmpdir / f"parte_{i:03d}.mp4"
                comandos.append((alvo, s, f))
            desc = f"em {len(cortes)} segmentos"
        else:
            comandos.append((parcial, inicio, fim))
            desc = "em arquivo unico"

        param = comando.parametros_saida(pedido, cfg)

        # `parametros_saida` NAO traz 'encoder': quem resolve o encoder e
        # `montar_comando`, que so roda no laco abaixo. Ler param['encoder'] aqui
        # levantava KeyError e derrubava o render inteiro no log de abertura --
        # falhar ao ESCREVER que comecou e o jeito mais bobo de nao comecar.
        # Resolve-se aqui pelo mesmo caminho (com cache em memoria), e um
        # tropeco na deteccao vira texto, nunca excecao.
        try:
            nome_encoder = comando._resolver_encoder(param, getattr(sequencia, "project_id", None))[0]
        except Exception as err:
            nome_encoder = f"(indeterminado: {type(err).__name__})"

        TASK_MANAGER.add_log(
            chave,
            f"[INIT] Render {'rascunho' if pedido.e_rascunho else 'master'} "
            f"'{sequencia.nome or timeline_id}' ({desc}): {len(em_cena)} clipes, "
            f"{duracao_total:.1f}s, {param['largura']}x{param['altura']}, "
            f"encoder={nome_encoder}, saida={destino_final}")

        resultado_cmd: Dict[str, Any] = {}
        fracao_feita = 0.0
        for indice, (alvo, s, f) in enumerate(comandos):
            if TASK_MANAGER.is_cancelled(chave):
                raise RenderCancelado()
            resultado_cmd = comando.montar_comando(
                sequencia, pedido, alvo, rel_midia=rel_midia, cfg=cfg,
                destino_validado=True, inicio_s=s, fim_s=f)
            for aviso in (resultado_cmd.get("avisos") or [])[:10]:
                nivel = "WARN" if avisos_pendentes else "INFO"
                TASK_MANAGER.add_log(chave, f"[{nivel}] {aviso}")
            avisos_pendentes = False

            fatia = (f - s) / duracao_total if duracao_total > 0 else 1.0
            rotulo = (f"Renderizando segmento {indice + 1}/{len(comandos)}"
                      if segmentar else "Renderizando")
            # Segmentado: os trechos dividem [0, 1-_FRACAO_CONCAT]; o concat
            # fica com a fracao final. Unico: mapeia direto em [0, 1].
            fim_de_fatia = (fracao_feita + fatia * (1.0 - _FRACAO_CONCAT)) \
                if segmentar else 1.0
            _rodar_com_progresso(resultado_cmd["cmd"], chave, resultado_cmd["duracao_s"],
                                 fracao_feita, fim_de_fatia, rotulo, timeline_id)
            fracao_feita = fim_de_fatia

        # ---- Juncao (quando segmentado) ------------------------------------
        if segmentar:
            lista = tmpdir / "lista.txt"
            linhas = []
            for alvo, _s, _f in comandos:
                caminho_txt = str(alvo.resolve().as_posix()).replace("'", "''")
                linhas.append(f"file '{caminho_txt}'")
            lista.write_text("\n".join(linhas) + "\n", encoding="utf-8")

            cmd_concat = ["ffmpeg", "-hide_banner", "-nostdin", "-y",
                          "-f", "concat", "-safe", "0", "-i", str(lista),
                          "-c", "copy"]
            if param["faststart"]:
                cmd_concat += ["-movflags", "+faststart"]
            cmd_concat += ["-progress", "pipe:1", "-nostats", str(parcial)]

            TASK_MANAGER.update_progress(chave, round(fracao_feita * 100, 1), "running",
                                         "render", label="Juntando segmentos")
            _rodar_com_progresso(cmd_concat, chave, duracao_total,
                                 fracao_feita, 1.0, "Juntando segmentos", timeline_id)
            fracao_feita = 1.0

        # ---- Fechamento ----------------------------------------------------
        if not parcial.exists() or parcial.stat().st_size == 0:
            raise RuntimeError("ffmpeg terminou sem gravar arquivo utilizavel.")
        os.replace(parcial, destino_final)

        tamanho_mb = destino_final.stat().st_size / (1024 * 1024)
        TASK_MANAGER.add_log(
            chave,
            f"[SUCCESS] Render concluido: {destino_final} ({tamanho_mb:.1f} MB)")
        TASK_MANAGER.update_progress(chave, 100.0, "finished", "render",
                                     label=str(destino_final))
        return {"ok": True, "caminho": str(destino_final), "cancelado": False,
                "tamanho_bytes": destino_final.stat().st_size}

    except RenderCancelado:
        _limpar([parcial] if parcial else [], [tmpdir] if tmpdir else [])
        TASK_MANAGER.add_log(
            chave,
            "[CANCEL] Render cancelado pelo usuario; ffmpeg encerrado e arquivo "
            "parcial apagado.")
        TASK_MANAGER.update_progress(chave, 0.0, "cancelled", "render",
                                     label="Cancelado")
        return {"ok": False, "cancelado": True, "caminho": None}
    except Exception as e:
        _limpar([parcial] if parcial else [], [tmpdir] if tmpdir else [])
        TASK_MANAGER.add_log(chave, f"[FAIL] Render falhou: {e}")
        TASK_MANAGER.update_progress(chave, 0.0, "failed", "render", label="Falhou")
        return {"ok": False, "cancelado": False, "erro": str(e)}
    finally:
        # Redundancia deliberada com os excepts acima: o tmpdir NUNCA sobra,
        # nem num caminho de retorno esquecido.
        _limpar([], [tmpdir] if tmpdir else [])
