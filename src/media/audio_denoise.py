"""Denoise por IA local (sherpa-onnx): ETAPA 4 de docs/PLANO_AJUSTES_DE_AUDIO.md.

Restricao que define este modulo: sherpa-onnx e o modelo ONNX NAO estao
instalados nesta maquina (decisao do dono do projeto). Entao:

- O import de sherpa_onnx/soundfile/numpy e PREGUICOSO (dentro de
  motor_disponivel), nunca no topo: o modulo importa sem dependencia nenhuma.
- Toda pergunta de disponibilidade passa por motor_disponivel(), que responde
  o que falta ANTES de qualquer tentativa de processar. Nada de ImportError
  cru no meio de um render.
- denoisar() nunca levanta excecao por dependencia ausente: devolve
  {"ok": False, "erro": "<motivo claro>"}.

Numeros medidos (secoes 1 e 6 do plano):
    DPDFNet 48 kHz: RTF 0,82 (1,2x tempo real), saida 48 kHz -> entrega.
    GTCRN        : RTF 0,28 (3,5x tempo real), saida 16 kHz -> SO previa;
                   nunca usar como arquivo final (e nunca encadear antes do
                   ASR: extract_audio_mono continua lendo o ORIGINAL).
Regra de atenacao da secao 7 (ja corrigida na Etapa 1):
    atenacao = clamp(noise_floor - (-45), 6, 18) dB. Piso -27 dB da 18.
Atenacao SEM limite deixa o piso em -infinito e destroi a ambiencia: aqui ela
so acontece com sem_limite=True explicito (nunca default) e sempre registra
aviso. Correlacao L/R < 0,95 = duas fontes distintas -> processar cada canal
separado (o modelo e mono; o par junto borra as duas vozes).

O original NUNCA e sobrescrito e nada e escrito dentro de F:/ (acervo bruto,
so leitura). O destino e escrito em arquivo temporario no proprio diretorio e
so renomeado no fim (atomico no mesmo volume).
"""
import hashlib
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

# Limiares compartilhados com a Etapa 1 (mesmas chaves/valores de
# LIMIARES_PADRAO; quem chama pode sobrescrever em atenuacao_recomendada).
from src.media.audio_analysis import LIMIARES_PADRAO

# Raiz do repositorio (src/media/audio_denoise.py -> parents[2]). Os testes
# apontam esta constante para um diretorio temporario; o resto do modulo le
# o valor no momento da chamada.
_RAIZ_PROJETO = Path(__file__).resolve().parents[2]

# Motor -> (arquivo do modelo em data/models/, taxa de saida, uso).
_MOTORES = {
    "dpdfnet": ("dpdfnet2_48khz_hr.onnx", 48000, "entrega"),
    "gtcrn": ("gtcrn_simple.onnx", 16000, "previa"),
}
RTF_MOTORES = {"dpdfnet": 0.82, "gtcrn": 0.28}      # secao 1 do plano
SAIDA_HZ_MOTORES = {"dpdfnet": 48000, "gtcrn": 16000}

# Regra da secao 7 corrigida: clamp(piso - alvo, min, max).
ATENUACAO_LIMIARES_PADRAO = {
    "piso_alvo_db": -45.0,   # mesmo alvo de _PISO_ALVO_DENOISE_DB (Etapa 1)
    "min_db": 6.0,
    "max_db": 18.0,
}
_AVISO_SEM_LIMITE = (
    "ATENCAO: atenacao sem limite pedida; o piso de ruido vai a -infinito "
    "(silencio digital entre falas) e a ambiencia sera DESTRUIDA.")

# Bloco de 30 s por chamada do motor: memoria estavel e progresso granular
# num render de horas (entrevista de 962 s -> ~13 min de CPU).
_BLOCO_S = 30.0


def caminho_modelo(motor: str = "dpdfnet", raiz: Optional[Path] = None) -> Path:
    """Caminho absoluto esperado do modelo ONNX do motor dado."""
    if motor not in _MOTORES:
        raise ValueError(f"Motor desconhecido: {motor} (use {', '.join(_MOTORES)})")
    nome, _, _ = _MOTORES[motor]
    return Path(raiz if raiz is not None else _RAIZ_PROJETO) / "data" / "models" / nome


def _checar_import(nome: str) -> Tuple[bool, str]:
    """Import preguicoso de uma dependencia opcional. Devolve (ok, motivo)."""
    try:
        __import__(nome)
    except ImportError:
        return False, f"{nome} nao instalado"
    return True, ""


def motor_disponivel(motor: str = "dpdfnet",
                     raiz: Optional[Path] = None) -> Dict[str, Any]:
    """Primeira pergunta de qualquer chamador: da para denoisar hoje?

    Devolve {"ok": bool, "sherpa_onnx": bool, "modelo": bool,
             "motivo": str|None, "caminho_modelo": str}.
    Todos os imports sao feitos AQUI dentro; o modulo inteiro funciona sem
    sherpa-onnx instalado. Ausencia nunca levanta excecao: vira motivo.
    """
    disp: Dict[str, Any] = {
        "ok": False, "sherpa_onnx": False, "modelo": False,
        "motivo": None, "caminho_modelo": "",
    }
    if motor not in _MOTORES:
        disp["motivo"] = f"motor desconhecido: {motor} (use {', '.join(sorted(_MOTORES))})"
        return disp

    caminho = caminho_modelo(motor, raiz)
    disp["caminho_modelo"] = _display_path(caminho)

    faltas: List[str] = []
    ok_sh, motivo_sh = _checar_import("sherpa_onnx")
    disp["sherpa_onnx"] = ok_sh
    if not ok_sh:
        faltas.append(f"sherpa-onnx nao instalado ({motivo_sh})")
    for aux in ("numpy", "soundfile"):
        ok_aux, motivo_aux = _checar_import(aux)
        if not ok_aux:
            faltas.append(f"{aux} nao instalado")

    if caminho.is_file() and caminho.stat().st_size > 0:
        disp["modelo"] = True
    else:
        faltas.append(f"modelo ausente em {disp['caminho_modelo']}")

    if faltas:
        disp["motivo"] = "; ".join(faltas)
    else:
        disp["ok"] = True
    return disp


def _display_path(caminho: Path) -> str:
    """Caminho relativo a raiz do projeto quando possivel (mensagens curtas)."""
    try:
        return caminho.relative_to(_RAIZ_PROJETO).as_posix()
    except ValueError:
        return str(caminho)


def hash_modelo_confere(caminho: Optional[Path] = None,
                        motor: str = "dpdfnet",
                        raiz: Optional[Path] = None) -> Tuple[bool, Optional[str]]:
    """Valida o modelo contra o lado-car <modelo>.sha256, quando existir.

    O release do k2-fsa nao publica hash do dpdfnet (nota da ETAPA 4 do
    plano): fixa-se o hash da primeira copia baixada num lado-car e valida-se
    contra ele depois. Sem lado-car devolve (True, None): nada a conferir.
    """
    alvo = Path(caminho) if caminho is not None else caminho_modelo(motor, raiz)
    lado_car = Path(str(alvo) + ".sha256")
    if not lado_car.exists():
        return True, None
    try:
        linha = lado_car.read_text(encoding="utf-8").strip().splitlines()
        esperado = linha[0].split()[0].lower() if linha else ""
    except OSError as e:
        return False, f"lado-car {lado_car.name} ilegivel: {e}"
    if len(esperado) != 64:
        return False, f"lado-car {lado_car.name} malformado (sha256 esperado)"
    digest = hashlib.sha256()
    with open(alvo, "rb") as fh:
        for bloco in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(bloco)
    obtido = digest.hexdigest()
    if obtido != esperado:
        return False, (f"hash do modelo nao confere: esperado {esperado[:12]}..., "
                       f"obtido {obtido[:12]}... ({lado_car.name})")
    return True, None


def atenuacao_recomendada(noise_floor_db, limiares: Optional[Dict[str, float]] = None) -> float:
    """Regra da secao 7 (ja corrigida na Etapa 1):
    clamp(noise_floor - (-45), 6, 18) dB.

    Piso -27 -> 18 (teto), -50 -> 6 (piso), -39 -> 6. Piso None/NaN nao tem
    medida confiavel: devolve o minimo conservador. Piso -inf cai no minimo
    pelo proprio clamp (silencio digital nao precisa de denoise).
    """
    l = dict(ATENUACAO_LIMIARES_PADRAO)
    if limiares:
        l.update(limiares)
    piso_alvo = float(l["piso_alvo_db"])
    minimo = float(l["min_db"])
    maximo = float(l["max_db"])
    if noise_floor_db is None:
        return minimo
    try:
        piso = float(noise_floor_db)
    except (TypeError, ValueError):
        return minimo
    if piso != piso:  # NaN
        return minimo
    bruta = piso - piso_alvo
    return float(min(maximo, max(minimo, bruta)))


def plano_de_processamento(diag: Dict[str, Any]) -> Dict[str, Any]:
    """Decide como denoisar a partir do dict de analisar_intervalo (Etapa 1).

    Devolve atenacao em dB, se processa canais separados (correlacao < 0,95),
    estimativa de tempo pelos RTF medidos e qual motor serve para o quê
    (dpdfnet entrega; gtcrn SO previa - sai em 16 kHz). Nada aqui processa
    audio nem toca em arquivo: puro calculo, testavel hoje.
    """
    plano: Dict[str, Any] = {
        "ok": bool(diag.get("ok")),
        "erro": diag.get("erro"),
        "processa": False,
        "nivel": "nenhum",          # forte | leve_opcional | nenhum
        "atenuacao_db": None,
        "por_canal": False,
        "duas_fontes": False,
        "duracao_s": diag.get("duracao_s"),
        "motor_entrega": "dpdfnet",
        "motor_previa": "gtcrn",
        "tempo_estimado_s": {},
        "saida_hz": dict(SAIDA_HZ_MOTORES),
        "aviso_gtcrn": ("GTCRN sai em 16 kHz: serve so para previa rapida, "
                        "nunca para o arquivo final (e nunca encadear antes "
                        "do ASR - extract_audio_mono le o ORIGINAL)."),
        "avisos": [],
    }
    if not plano["ok"]:
        return plano

    piso = diag.get("noise_floor_db")
    if piso is None:
        plano["avisos"].append("Piso de ruido nao medido: impossivel dosar a atenacao.")
    elif piso == float("-inf"):
        plano["avisos"].append("Piso de ruido -inf (silencio digital): nada a denoisar.")
    elif piso > LIMIARES_PADRAO["piso_ruido_alto"]:
        plano["nivel"] = "forte"
    elif piso > LIMIARES_PADRAO["piso_ruido_medio"]:
        plano["nivel"] = "leve_opcional"
    if isinstance(piso, (int, float)) and piso != float("-inf") and piso == piso:
        plano["atenuacao_db"] = atenuacao_recomendada(piso)

    canais = int(diag.get("canais") or 0)
    corr = diag.get("stereo_corr")
    if canais >= 2:
        if corr is None:
            plano["duas_fontes"] = True  # sem medida: lado seguro e separar
            plano["avisos"].append("Correlacao L/R ausente: assumindo fontes "
                                   "distintas e processando canal a canal.")
        else:
            plano["duas_fontes"] = corr < LIMIARES_PADRAO["correlacao_estereo"]
        plano["por_canal"] = plano["duas_fontes"]

    duracao = plano["duracao_s"]
    if isinstance(duracao, (int, float)) and duracao > 0:
        plano["tempo_estimado_s"] = {
            motor: round(float(duracao) * rtf, 1) for motor, rtf in RTF_MOTORES.items()
        }
    plano["processa"] = plano["nivel"] != "nenhum"
    return plano


def _fatiar(n_total: int, passo: int) -> Iterator[Tuple[int, int]]:
    """Fatiamento exato de [0, n_total) em blocos de `passo` (ultimo curto)."""
    inicio = 0
    while inicio < n_total:
        fim = min(inicio + passo, n_total)
        yield inicio, fim
        inicio = fim


def _startupinfo():
    """Mesmo jeito de invocar subprocesso de src/media/ffmpeg.py."""
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return startupinfo


def _decodificar_wav(src: Path, wav_tmp: Path, hz: int) -> Optional[str]:
    """Decodifica o intervalo todo para WAV float32 na taxa do modelo.

    Sem -ac: os canais chegam como vieram; o mixdown para mono (quando os
    canais sao coerentes, correlacao >= 0,95, somar e seguro - secao 5) e
    feito aqui em numpy depois da leitura. Devolve None ou o motivo do erro.
    """
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-map", "0:a:0",
           "-ar", str(hz), "-c:a", "pcm_f32le", "-f", "wav", str(wav_tmp)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              startupinfo=_startupinfo(), timeout=3600.0)
    except FileNotFoundError:
        return "ffmpeg nao encontrado no PATH desta maquina."
    except subprocess.TimeoutExpired:
        return "ffmpeg excedeu o tempo de decodificacao."
    except OSError as e:
        return f"Falha ao executar o ffmpeg: {e}"
    if proc.returncode != 0:
        linhas = [ln for ln in (proc.stderr or "").strip().splitlines() if ln.strip()]
        motivo = linhas[-1] if linhas else f"codigo de saida {proc.returncode}"
        return f"FFmpeg falhou ao decodificar: {motivo}"
    return None


def _ler_wav(caminho: Path, always_2d: bool) -> Tuple[Any, int]:
    """Le o WAV decodificado. Costura de injecao: os testes substituem esta
    funcao (e as demais costuras) por dubles, pois soundfile nao existe aqui."""
    import numpy as np
    import soundfile as sf
    dados, sr = sf.read(str(caminho), dtype="float32",
                        always_2d=bool(always_2d))
    return np.asarray(dados, dtype=np.float32), int(sr)


def _gravar_wav(caminho: Path, dados: Any, sr: int) -> None:
    """Grava WAV PCM 24 bits (padrao de entrega do projeto)."""
    import soundfile as sf
    sf.write(str(caminho), dados, sr, subtype="PCM_24")


def _carregar_denoise(caminho_modelo_: Path, motor: str,
                      atenuacao_db: float, sem_limite: bool) -> Tuple[Any, List[str]]:
    """Constroi o OfflineSpeechDenoiser do sherpa-onnx para o motor.

    Costura unica de integracao: se a versao instalada mudar nomes de classe/
    campo, o ajuste e aqui. O controle de atencao do DPDFNet aparece entre
    versoes do sherpa-onnx; tentamos o campo conhecido e registramos aviso
    quando a versao instalada nao o aceita (em vez de fingir que aplicou).
    """
    import sherpa_onnx

    avisos: List[str] = []
    sub_kwargs: Dict[str, Any] = {}
    if motor == "dpdfnet":
        # O sherpa-onnx 1.13.6 grafa "DpdfNet" com N maiusculo; aceitamos as duas
        # grafias para nao quebrar se uma versao futura mudar.
        cls_dpdf = (getattr(sherpa_onnx, "OfflineSpeechDenoiserDpdfNetModelConfig", None)
                    or getattr(sherpa_onnx, "OfflineSpeechDenoiserDpdfnetModelConfig", None))
        if cls_dpdf is None:
            raise AttributeError(
                "sherpa-onnx sem classe de configuracao do DPDFNet "
                "(OfflineSpeechDenoiserDpdfNetModelConfig). Versao incompativel.")
        for campo in ("attenuation_limit_db", "attenuation"):
            try:
                sub = cls_dpdf(model=str(caminho_modelo_), **{campo: float(atenuacao_db)})
                break
            except (AttributeError, TypeError):
                sub = None
        if sub is None:
            sub = cls_dpdf(model=str(caminho_modelo_))
            avisos.append("Versao do sherpa-onnx sem controle de atenacao no "
                          f"DPDFNet; pedida {atenuacao_db:g} dB e NAO aplicada "
                          "pelo motor.")
        sub_kwargs["dpdfnet"] = sub
    else:
        sub_kwargs["gtcrn"] = sherpa_onnx.OfflineSpeechDenoiserGtcrnModelConfig(
            model=str(caminho_modelo_))

    config = sherpa_onnx.OfflineSpeechDenoiserConfig(
        model=sherpa_onnx.OfflineSpeechDenoiserModelConfig(num_threads=1,
                                                           debug=False,
                                                           **sub_kwargs))
    denoiser = sherpa_onnx.OfflineSpeechDenoiser(config)
    if sem_limite:
        avisos.append("Modo sem limite: o motor recebe atenacao ilimitada.")
    return denoiser, avisos


def _validar_atenuacao(valor: Any, sem_limite: bool
                       ) -> Tuple[Optional[float], List[str], Optional[str]]:
    """Atenacao fora de [6, 18] e presa no teto/piso com aviso; "sem limite"
    SO existe com sem_limite=True explicito e sempre registra o aviso forte."""
    try:
        pedida = float(valor)
    except (TypeError, ValueError):
        return None, [], f"Atenuacao invalida: {valor!r} nao e numero."
    if pedida != pedida:  # NaN
        return None, [], "Atenuacao invalida: NaN."
    avisos: List[str] = []
    if pedida <= 0.0:
        return None, [], f"Atenuacao invalida: {pedida:g} dB nao reduz ruido algum."
    if sem_limite:
        avisos.append(_AVISO_SEM_LIMITE)
        print(f"[AudioDenoise] {_AVISO_SEM_LIMITE}")
        return pedida, avisos, None
    l = ATENUACAO_LIMIARES_PADRAO
    usada = min(l["max_db"], max(l["min_db"], pedida))
    if usada != pedida:
        avisos.append(f"Atenuacao pedida {pedida:g} dB fora de "
                      f"[{l['min_db']:g}, {l['max_db']:g}]; usando {usada:g} dB.")
    return usada, avisos, None


def _e_acervo_f(caminho: Path) -> bool:
    """F:/ e o acervo bruto: somente leitura, nunca escrita."""
    letra = caminho.drive.upper().rstrip(":")
    return letra == "F"


def denoisar(src, dest, atenuacao_db: float, motor: str = "dpdfnet",
             por_canal: bool = False, progresso: Optional[Callable[..., None]] = None,
             *, sem_limite: bool = False) -> Dict[str, Any]:
    """Reduz ruido do clipe com IA local e grava em `dest`.

    Contratos:
    - Dependencia/modelo ausente -> {"ok": False, "erro": motivo}, SEM excecao.
    - O original nunca e sobrescrito (dest == src e recusado).
    - Nada e escrito dentro de F:/.
    - Nunca escreve arquivo pela metade: grava em temporario no diretorio de
      destino e so renomeia (os.replace) quando tudo terminou.
    - Atenuacao sem limite apenas com sem_limite=True explicito, sempre
      acompanhada do aviso de destruicao de ambiencia.
    """
    inicio = time.monotonic()
    resultado: Dict[str, Any] = {
        "ok": False, "erro": None, "motor": motor, "destino": str(dest),
        "atenuacao_db": None, "por_canal": bool(por_canal),
        "sem_limite": bool(sem_limite), "saida_hz": None,
        "duracao_s": None, "tempo_decorrido_s": None, "avisos": [],
    }
    origem = Path(src)
    destino = Path(dest)

    # --- Guardas de caminho (baratos, antes de qualquer dependencia) ---
    try:
        origem_real = origem.resolve()
        destino_real = destino.resolve()
    except OSError as e:
        resultado["erro"] = f"Falha ao resolver caminhos: {e}"
        return resultado
    if _e_acervo_f(destino_real):
        resultado["erro"] = ("Recusado: destino fica dentro de F:/ (acervo bruto "
                             "e somente leitura; o derivado precisa ir para data/).")
        return resultado
    if origem_real == destino_real:
        resultado["erro"] = "Recusado: o original jamais e sobrescrito pelo denoise."
        return resultado
    if not origem.is_file():
        resultado["erro"] = f"Arquivo de origem nao encontrado: {origem}"
        return resultado

    # --- Valida motor e atenacao ---
    if motor not in _MOTORES:
        resultado["erro"] = (f"Motor desconhecido: {motor} "
                             f"(use {', '.join(sorted(_MOTORES))}).")
        return resultado
    atenacao, avisos_att, erro_att = _validar_atenuacao(atenuacao_db, sem_limite)
    resultado["avisos"].extend(avisos_att)
    if erro_att:
        resultado["erro"] = erro_att
        return resultado
    resultado["atenuacao_db"] = atenacao
    if motor == "gtcrn":
        resultado["avisos"].append(
            "Motor GTCRN: saida em 16 kHz - serve so para PREVIA, nunca para "
            "o arquivo final de entrega.")

    # --- Disponibilidade honesta, antes de tocar em qualquer coisa ---
    disp = motor_disponivel(motor)
    if not disp["ok"]:
        resultado["erro"] = f"Denoise indisponivel: {disp['motivo']}"
        return resultado

    caminho_do_modelo = caminho_modelo(motor)
    hash_ok, hash_erro = hash_modelo_confere(caminho_do_modelo)
    if not hash_ok:
        resultado["erro"] = f"Modelo rejeitado: {hash_erro}"
        return resultado

    # --- Processamento (só chega aqui com dependencia + modelo presentes) ---
    destino.parent.mkdir(parents=True, exist_ok=True)
    fd_wav, wav_tmp_nome = tempfile.mkstemp(prefix=".denoise_src_", suffix=".wav",
                                            dir=str(destino.parent))
    os.close(fd_wav)
    fd_out, out_tmp_nome = tempfile.mkstemp(prefix=".denoise_out_", suffix=".wav",
                                            dir=str(destino.parent))
    os.close(fd_out)
    wav_tmp = Path(wav_tmp_nome)
    out_tmp = Path(out_tmp_nome)
    try:
        erro_dec = _decodificar_wav(origem, wav_tmp, SAIDA_HZ_MOTORES[motor])
        if erro_dec:
            resultado["erro"] = erro_dec
            return resultado

        dados, sr = _ler_wav(wav_tmp, always_2d=(por_canal and motor == "dpdfnet"))
        if dados.ndim == 2 and not por_canal:
            # Canais coerentes (corr >= 0,95): somar para mono e seguro (secao 5).
            dados = dados.mean(axis=1, dtype=dados.dtype)
        canais_efetivos = 1 if dados.ndim == 1 else dados.shape[1]
        if por_canal and canais_efetivos < 2:
            resultado["avisos"].append("por_canal pedido mas a fonte e mono: "
                                       "processando canal unico.")
        n_amostras = int(dados.shape[0])
        passo = max(1, int(_BLOCO_S * sr))
        denoiser, avisos_motor = _carregar_denoise(caminho_do_modelo, motor,
                                                   atenacao, sem_limite)
        resultado["avisos"].extend(avisos_motor)

        total_unidades = canais_efetivos * max(1, -(-n_amostras // passo))
        unidade = 0
        saida = []
        for canal in range(canais_efetivos):
            fonte = dados if dados.ndim == 1 else dados[:, canal]
            tratado_canal = []
            for ini, fim in _fatiar(n_amostras, passo):
                bloco = fonte[ini:fim]
                enhanced = denoiser.run(bloco, sr)
                tratado_canal.append(enhanced.samples[: fim - ini])
                unidade += 1
                if progresso is not None:
                    progresso(unidade / total_unidades,
                              f"canal {canal + 1}/{canais_efetivos}")
            saida.append(tratado_canal)

        import numpy as np
        if canais_efetivos == 1:
            final = np.concatenate(saida[0])
        else:
            final = np.stack([np.concatenate(ch) for ch in saida], axis=1)
        _gravar_wav(out_tmp, final, sr)

        # Renomeio atomico so no fim: ou o destino nasce pronto, ou nao nasce.
        os.replace(str(out_tmp), str(destino))
    except (RuntimeError, OSError, ValueError) as e:
        resultado["erro"] = f"Falha durante o denoise ({type(e).__name__}): {e}"
        return resultado
    finally:
        for lixo in (wav_tmp, out_tmp):
            try:
                lixo.unlink()
            except FileNotFoundError:
                pass

    decorrido = time.monotonic() - inicio
    resultado.update({
        "ok": True,
        "destino": str(destino),
        "saida_hz": sr,
        "duracao_s": round(n_amostras / sr, 3),
        "tempo_decorrido_s": round(decorrido, 3),
    })
    print(f"[AudioDenoise] {origem.name}: {motor} atenacao {atenacao:g} dB, "
          f"{resultado['duracao_s']}s de audio em {resultado['tempo_decorrido_s']}s "
          f"(RTF {resultado['tempo_decorrido_s'] / max(resultado['duracao_s'], 1e-9):.2f}) "
          f"-> {destino.name}")
    return resultado
