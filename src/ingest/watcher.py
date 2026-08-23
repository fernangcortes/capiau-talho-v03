"""Monitor de pasta de ingestão (watch/) e interface de compatibilidade delegada."""
import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Dict, Any, Optional

from src.config import CONFIG
from src.core.tasks import TASK_MANAGER
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.services.ingest import IngestService, compute_hash
from src.media import audio_analysis
from src.media.ffmpeg import get_media_metadata, generate_video_proxy
from src.media.image_processing import generate_photo_proxy

# Contrato de ida e volta com o export de stems (G1, src/export/audio_stems.py):
# o nome "stem_v<video_id>_<IN_MS>-<OUT_MS>.wav" carrega clipe e intervalo, e
# parse_nome_stem e o lado de LEITURA desse contrato. Se o modulo nao existir
# (repo parcial), cai apenas para o casamento por nome-base, sem quebrar.
try:
    from src.export.audio_stems import parse_nome_stem
except ImportError:  # pragma: no cover - repositorio sempre traz o modulo
    parse_nome_stem = None

# Mapeamentos de compatibilidade para código legado
PROXY_EXECUTOR = TASK_MANAGER.executor
ACTIVE_CONVERSIONS = TASK_MANAGER.active_processes
CONVERSION_PROGRESS = TASK_MANAGER.progress

SUPPORTED_VIDEO = {'.mp4', '.mov', '.mxf', '.mts', '.mkv', '.avi'}
SUPPORTED_AUDIO = {'.wav', '.mp3', '.m4a', '.bwf'}
SUPPORTED_PHOTO = {
    '.jpg', '.jpeg', '.png', '.tiff',
    '.arw', '.cr2', '.nef', '.dng', '.pef', '.raf', '.orf', '.rw2', '.raw'
}

def cancel_conversion(video_id: int) -> bool:
    """Cancela uma conversão ativa e atualiza o status de progresso."""
    success = TASK_MANAGER.cancel_process(video_id)
    TASK_MANAGER.update_progress(str(video_id), 0.0, "cancelled")
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    return success

def delete_proxy_file(video_id: int) -> bool:
    """Exclui o arquivo proxy de vídeo e reseta o status."""
    cancel_conversion(video_id)
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception as e:
            print(f"[WatcherCompat] Não foi possível apagar o proxy físico: {e}")
            
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    TASK_MANAGER.remove_progress(str(video_id))
    return True

def ingest_file(filepath: Path, project_id: int = 1, copy_original: bool = True) -> bool:
    """Delega ingestão de arquivos para IngestService."""
    return IngestService.ingest_file(filepath, project_id, copy_original)

def ingest_external_path(target_path: Path, project_id: int = 1) -> dict:
    """Delega escaneamento in-place para IngestService."""
    return IngestService.ingest_external_path(target_path, project_id)

def _scan_watch_midias(project_id: int = 1) -> None:
    """Escaneia a pasta watch/ e ingere novos arquivos encontrados.

    Corpo original de scan_watch_folder, intocado; a funcao publica virou
    wrapper que tambem varre o retorno da DAW (ETAPA 6, secao 9 do plano).
    """
    watch_path = CONFIG.WATCH_FOLDER
    if not watch_path.exists():
        return
        
    files = [f for f in watch_path.iterdir() if f.is_file()]
    if not files:
        return
        
    print(f"\n[WATCH] Escaneando pasta watch: {watch_path}... (Detectados {len(files)} arquivos)")
    for f in files:
        try:
            success = ingest_file(f, project_id)
            if success:
                f.unlink()
                print(f"  [OK] Removido da pasta watch: {f.name}")
        except Exception as e:
            print(f"  [ERRO] Falha ao processar arquivo {f.name} do watch: {e}")

def scan_watch_folder(project_id: int = 1) -> None:
    """Escaneia as pastas observadas: midias novas (watch/) e retorno da DAW.

    Cada escaneamento roda em guarda propria: um problema no retorno da DAW
    nunca pode interromper o fluxo antigo de video/foto, e vice-versa.
    """
    try:
        _scan_watch_midias(project_id)
    except Exception as e:
        print(f"[WATCH] ERRO geral no escaneamento de midias: {e}")
    try:
        _scan_audio_daw_folder(project_id)
    except Exception as e:
        print(f"[WATCH-DAW] ERRO geral no escaneamento do retorno da DAW: {e}")


# == ETAPA 6: retorno da DAW (docs/PLANO_AJUSTES_DE_AUDIO.md, secao 9) ========
# Fluxo da ponte: o Talho exporta o audio do clipe em WAV 48/24 (G1,
# src/export/audio_stems.py), o usuario trata na DAW com o que quiser e
# devolve o arquivo para uma pasta observada com o MESMO NOME-BASE do arquivo
# de origem do clipe. Aqui nos reconhecemos o retorno, casamos com o clipe,
# registramos na tabela audio_render e rodamos a pre-analise para preencher
# analysis_json.
#
# A tabela audio_render nao tem coluna engine; o motor "daw" fica declarado em
# chain_json='["daw"]' (e repetido dentro de analysis_json). O intervalo vem do
# proprio nome do stem ("stem_v<id>_<IN_MS>-<OUT_MS>.wav", convencao do G1);
# retorno solto casado por nome-base fica com in/out NULL = arquivo inteiro.
#
# Garantias de pasta observada (onde esse tipo de codigo quebra):
# - copia parcial NAO processa: so segue quando o tamanho fica IGUAL entre dois
#   escaneamentos seguidos e maior que zero;
# - arquivo sem clipe correspondente nunca e apagado nem engolido: rastro claro
#   no console, reportado uma vez por caminho+tamanho;
# - o mesmo arquivo NAO processa duas vezes: guarda na sessao (caminho+tamanho)
#   e persiste no banco (indice unico video_id+chain_hash, status 'ready');
# - NUNCA apagamos nada desta pasta, nem quando tudo dá errado.

PASTA_RETORNO_DAW_PADRAO = "watch/audio_daw"  # default de audio.daw.pasta_retorno

# Estado em memoria do processo (o banco cobre a parte persistente).
_DAW_TAMANHOS_VISTOS: Dict[str, int] = {}   # caminho -> tamanho visto no scan anterior
_DAW_PROCESSADOS: Dict[str, int] = {}       # caminho -> tamanho ja registrado nesta sessao
_DAW_RASTROS_EMITIDOS: Dict[str, int] = {}  # caminho -> ultimo tamanho com rastro ja impresso


def pasta_retorno_daw(project_id: int = 1) -> Path:
    """Resolve audio.daw.pasta_retorno via SettingsService (default -> global -> projeto).

    A chave esta sendo registrada em paralelo por outro agente; enquanto ela
    nao existir no registro/banco, KeyError cai no default sem quebrar - mesmo
    padrao de _limiares_audio em src/api/routes/media.py. Falha de banco sem as
    tabelas de settings tambem cai no default, porque um monitor 24/7 nao pode
    morrer por causa de configuracao. Caminho relativo ancora no BASE_DIR.
    """
    valor = None
    try:
        from src.services.settings_service import SettingsService
        valor = SettingsService.get_settings(project_id or None).get("audio.daw.pasta_retorno")
    except KeyError:
        pass  # chave ainda nao registrada neste banco: default cobre
    except Exception as e:
        print(f"[WATCH-DAW] Falha ao ler audio.daw.pasta_retorno ({e}); usando default.")
    if not valor or not str(valor).strip():
        valor = PASTA_RETORNO_DAW_PADRAO
    pasta = Path(str(valor).strip())
    if not pasta.is_absolute():
        pasta = CONFIG.BASE_DIR / pasta
    return pasta


def _daw_normalizar_nome_base(nome: str) -> str:
    """Normaliza nome-base para o casamento tolerante (minusculas, so alfanumericas).

    Cobre DAWS que trocam separador ao exportar ("Entrevista-Julia" vs
    "entrevista_julia") sem abrir espaco para falso positivo.
    """
    return "".join(c for c in str(nome).casefold() if c.isalnum())


def _daw_casamentos_clipe(conn, nome_base: str, project_id: int):
    """Clipes do projeto cujo arquivo de origem tem o mesmo nome-base.

    Convensao da secao 9, passo 3: o stem exportado pelo G1 e o stem do
    filename original do clipe (ex.: entrevista.mts -> entrevista.wav). Casamento
    exato primeiro (ignorando caixa); tolerante depois, ja normalizado.
    Devolve ordenado por id (mais antigo primeiro) para escolha deterministica.
    """
    videos = MediaRepository.list_videos(conn, project_id)
    exatos = [v for v in videos
              if Path(v["filename"] or "").stem.casefold() == str(nome_base).casefold()]
    if exatos:
        return sorted(exatos, key=lambda v: v["id"])
    alvo = _daw_normalizar_nome_base(nome_base)
    tolerantes = [v for v in videos
                  if _daw_normalizar_nome_base(Path(v["filename"] or "").stem) == alvo]
    return sorted(tolerantes, key=lambda v: v["id"])


def _daw_rastro(chave: str, tamanho: int, mensagem: str) -> None:
    """Imprime um rastro uma vez por caminho+tamanho (nao vira spam a cada ciclo)."""
    if _DAW_RASTROS_EMITIDOS.get(chave) == tamanho:
        return
    _DAW_RASTROS_EMITIDOS[chave] = tamanho
    print(mensagem)


def _daw_copia_estavel(caminho: Path) -> bool:
    """True somente com tamanho > 0 igual ao do scan anterior (copia terminou).

    Duas leituras em ciclos distintos provam que ninguem esta escrevendo o
    arquivo no momento - e o mecanismo mais barato que funciona para pasta
    observada por polling, sem sleep bloqueando o laco.
    """
    chave = str(caminho)
    try:
        tamanho = caminho.stat().st_size
    except OSError:
        return False
    anterior = _DAW_TAMANHOS_VISTOS.get(chave)
    _DAW_TAMANHOS_VISTOS[chave] = tamanho
    if tamanho <= 0:
        return False
    if anterior is None:
        print(f"[WATCH-DAW] Novo arquivo detectado, aguardando copia estabilizar: "
              f"{caminho.name}")
        return False
    return anterior == tamanho


def _daw_identificar_clipe(conn, f: Path, project_id: int):
    """Descobre de qual clipe (e intervalo) este retorno veio.

    1) Convencao do export G1: "stem_v<id>_<IN_MS>-<OUT_MS>.wav" - parse_nome_stem
       devolve (video_id, in_s, out_s) direto; o clipe precisa existir no projeto.
    2) Retorno solto/manual: mesmo nome-base do arquivo de origem do clipe
       (ex.: entrevista.mts -> entrevista.wav), intervalo NULL/NULL (inteiro).
    Devolve (video_row|None, in_s|None, out_s|None).
    """
    if parse_nome_stem is not None:
        parseado = parse_nome_stem(f.name)
        if parseado is not None:
            video_id_parseado, in_s, out_s = parseado
            video = MediaRepository.get_video(conn, int(video_id_parseado))
            if video is not None and video.get("project_id") == project_id:
                return video, in_s, out_s
            return None, None, None  # id valido mas clipe ausente/outro projeto

    candidatos = _daw_casamentos_clipe(conn, f.stem, project_id)
    if not candidatos:
        return None, None, None
    return candidatos[0], None, None


def _daw_processar_arquivo(f: Path, project_id: int) -> None:
    """Casa o retorno com o clipe, registra em audio_render e roda a pre-analise.

    Nunca apaga o arquivo do usuario. Sem clipe correspondente, sem tabela de
    render ou com analise falha: fica rastro e o arquivo permanece na pasta.
    """
    chave = str(f)
    tamanho = f.stat().st_size
    if _DAW_PROCESSADOS.get(chave) == tamanho:
        return  # já processado nesta sessão, nada a fazer

    with get_db() as conn:
        video, in_s, out_s = _daw_identificar_clipe(conn, f, project_id)
        if video is None:
            _daw_rastro(chave, tamanho,
                        f"[WATCH-DAW] SEM CORRESPONDENCIA: '{f.name}' nao casa com nenhum "
                        f"clipe do projeto {project_id}. Arquivo MANTIDO em '{f}' (nada foi "
                        f"apagado). A convencao e 'stem_v<video_id>_<IN_MS>-<OUT_MS>.wav' "
                        f"(nome do stem exportado) ou o mesmo nome-base do arquivo de "
                        f"origem do clipe.")
            return
        video_id = video["id"]
        if in_s is not None:
            chain_hash = hashlib.sha256(
                f"daw|{video_id}|{round(float(in_s), 3)}|{round(float(out_s), 3)}"
                .encode("utf-8")).hexdigest()
        else:
            # Sem intervalo no nome: retorno do arquivo inteiro (NULL/NULL no banco).
            chain_hash = hashlib.sha256(f"daw|{video_id}".encode("utf-8")).hexdigest()
        existente = conn.execute(
            "SELECT status FROM audio_render WHERE video_id = ? AND chain_hash = ?",
            (video_id, chain_hash),
        ).fetchone()
        if existente is not None and existente["status"] == "ready":
            # Guardia persistente: mesmo arquivo reiniciando o processo nao
            # reprocessa nem duplica linha.
            _daw_rastro(chave, tamanho,
                        f"[WATCH-DAW] '{f.name}': retorno do clipe #{video_id} ja estava "
                        f"registrado como pronto; ignorando sem duplicar.")
            _DAW_PROCESSADOS[chave] = tamanho
            return
        try:
            conn.execute(
                "INSERT OR REPLACE INTO audio_render "
                "(video_id, in_s, out_s, chain_hash, chain_json, path, status, analysis_json) "
                "VALUES (?, ?, ?, ?, ?, ?, 'running', NULL)",
                (video_id, in_s, out_s, chain_hash, '["daw"]', str(f).replace('\\', '/')),
            )
        except sqlite3.OperationalError as err:
            if "no such table" in str(err).lower():
                _daw_rastro(chave, tamanho,
                            f"[WATCH-DAW] Tabela audio_render ainda nao existe no banco; "
                            f"'{f.name}' fica na pasta e sera registrado na proxima varredura "
                            f"depois da migracao. Erro: {err}")
                return
            raise

    # Analise fora da transacao (ffmpeg pode levar segundos; secao 5 do plano).
    print(f"[WATCH-DAW] Retorno da DAW reconhecido: '{f.name}' -> clipe #{video_id}; "
          f"rodando pre-analise...")
    try:
        diag = audio_analysis.analisar_intervalo(f)
    except Exception as e:
        print(f"[WATCH-DAW] Pre-analise de '{f.name}' falhou com excecao: {e}")
        diag = audio_analysis.diagnostico_vazio()
        diag["ok"] = False
        diag["erro"] = f"Excecao na analise: {e}"
    # Motor e origem viram metadado junto do diagnostico (a tabela nao tem
    # coluna engine; chain_json='["daw"]' declara o motor na linha).
    diag["engine"] = "daw"
    diag["origem"] = "retorno_daw"
    diag["arquivo_retorno"] = f.name

    with get_db() as conn:
        conn.execute(
            "UPDATE audio_render SET status = 'ready', path = ?, analysis_json = ? "
            "WHERE video_id = ? AND chain_hash = ?",
            (str(f).replace('\\', '/'), json.dumps(diag), video_id, chain_hash),
        )
    _DAW_PROCESSADOS[chave] = tamanho
    resumo = (f"lufs_i={diag.get('lufs_i')}" if diag.get("ok")
              else f"analise indisponivel ({diag.get('erro')})")
    print(f"[WATCH-DAW] OK: clipe #{video_id} ganhou audio_render engine=daw status=ready "
          f"path='{f.name}' ({resumo}).")


def _scan_audio_daw_folder(project_id: int = 1) -> None:
    """Varre a pasta de retorno da DAW registrando os arquivos tratados."""
    pasta = pasta_retorno_daw(project_id)

    # Guarda de colisao: a pasta de retorno igual a watch/ faria o mesmo WAV
    # ser ingestado como midia nova E tratado como retorno - nao escanear.
    try:
        if pasta.resolve() == Path(CONFIG.WATCH_FOLDER).resolve():
            print(f"[WATCH-DAW] audio.daw.pasta_retorno aponta para a propria pasta watch; "
                  f"ignorando este ciclo para nao processar arquivos duas vezes.")
            return
    except OSError:
        pass

    try:
        pasta.mkdir(parents=True, exist_ok=True)  # cria o destino de retorno p/ o usuario
    except OSError as e:
        print(f"[WATCH-DAW] Pasta de retorno inacessivel ({pasta}): {e}")
        return

    arquivos = sorted(f for f in pasta.iterdir() if f.is_file())
    if not arquivos:
        return

    print(f"[WATCH-DAW] Escaneando retorno da DAW: {pasta} "
          f"(Detectados {len(arquivos)} arquivos)")
    for f in arquivos:
        try:
            if f.suffix.lower() not in SUPPORTED_AUDIO:
                _daw_rastro(str(f), f.stat().st_size,
                            f"[WATCH-DAW] '{f.name}' nao e audio suportado "
                            f"(contrato: WAV de volta da DAW); arquivo mantido, ignorado.")
                continue
            if not _daw_copia_estavel(f):
                continue  # copia parcial ou vazia: espera o proximo ciclo
            _daw_processar_arquivo(f, project_id)
        except Exception as e:
            print(f"[WATCH-DAW] ERRO ao processar '{f.name}' do retorno da DAW: {e}")


def watch_folder_loop(interval: int = 5) -> None:
    """Loop contínuo de monitoramento da pasta watch/."""
    print("="*60)
    print(f"       MONITOR DE INGESTÃO MODULAR 24/7")
    print(f"       Monitorando: {CONFIG.WATCH_FOLDER}")
    print(f"       Retorno DAW: {pasta_retorno_daw(1)}")
    print("="*60)
    try:
        while True:
            scan_watch_folder()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[WATCH] Monitoramento abortado pelo usuário.")
