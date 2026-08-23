"""Pre-analise de audio por clipe: parser dos relatorios ebur128 + astats do ffmpeg.

Contrato C1 da ETAPA 1 de docs/PLANO_AJUSTES_DE_AUDIO.md. Nada aqui processa
audio: mede e classifica, naquele passe unico de ffmpeg da secao 5 do plano,
para alimentar o bloco "Diagnostico" do painel de Ajustes (secao 4).

- parse_ffmpeg_audio_report(texto): parser puro (so stdlib) do stderr.
- analisar_intervalo(src, in_s, out_s): roda o ffmpeg sobre o intervalo do clipe.
- avaliar(diag, limiares): aplica a tabela de limiares da secao 7 e devolve
  selos com severidade + preset/cadeia sugeridos.
- Contrato D1 (rodada 2, "onde estourou"): extrair_serie le as linhas de quadro
  do ebur128 (uma a cada 100 ms, hoje descartadas), resumir_serie monta o
  envelope para a faixa da UI e momentos_problematicos agrupa os estouros em
  uma lista para o editor saltar ao segundo exato do problema.

O ffmpeg imprime os sumarios do ebur128 e do astats em nivel de log INFO:
com "-v error" (como escrito no exemplo do plano) o stderr volta vazio, entao
este modulo invoca com "-v info -nostats". Medido nesta maquina em 23/08/2026.
"""
import json
import math
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Limiares padrao = defaults do contrato C4 (chaves audio.analise.* no
# settings_registry, sem o prefixo). Este modulo NAO importa settings_registry
# (esta sendo editado em paralelo); quem chama pode sobrescrever via `limiares`.
LIMIARES_PADRAO = {
    "alvo_lufs": -16.0,
    "teto_dbtp": -1.5,
    "clip_pct_grave": 0.05,
    "piso_ruido_alto": -35.0,
    "piso_ruido_medio": -45.0,
    "lra_esmagado": 5.0,
    "lra_amplo": 12.0,
    "correlacao_estereo": 0.95,
}

# Constantes internas que nao entraram no contrato C4 (nomeadas para nao existir
# numero magico solto; viram setting na Etapa em que o contrato abrir).
_LOUDNESS_TOLERANCIA_LU = 1.0   # secao 7: "LUFS-I fora de alvo +-1 LU" -> loudnorm
_PISO_ALVO_DENOISE_DB = -45.0   # secao 7: atenuacao = clamp(piso - alvo, min, max)
_ATENUACAO_MIN_DB = 6           # secao 7: clamp(..., 6, 18)
_ATENUACAO_MAX_DB = 18
_TIMEOUT_FFMPEG_S = 120.0       # secao 5: entrevista inteira analisa em ~10 s

_CHAVES_DIAG = (
    "lufs_i", "lra", "true_peak_db", "rms_db", "peak_db", "crest_factor",
    "noise_floor_db", "n_samples", "peak_count", "clip_pct", "stereo_corr",
    "canais",
)

# Sumarios do ebur128 (ancorados no inicio da linha para nao casar com as
# linhas por-janela "t: ... I: ... LRA:" que vem prefixadas por [Parsed_...]).
_RE_I_LUFS = re.compile(r"^ *I: +(-?\S+) LUFS$", re.M)
_RE_LRA = re.compile(r"^ *LRA: +(-?\S+) LU$", re.M)
_RE_TRUE_PEAK = re.compile(r"^ *Peak: +(-?\S+) dBFS$", re.M)
# Cabecalhos das secoes do astats ("Channel: N" e "Overall").
_RE_BLOCO_ASTATS = re.compile(r"^(?:\[[^\]]*\] )?(?:Channel: (\d+)|Overall) *$", re.M)
# Gancho tolerante: o astats padrao nao reporta correlacao entre canais hoje;
# se uma versao futura imprimir qualquer chave "... correlation/correlacao",
# extraimos sem precisar mexer no resto do parser.
_RE_CORRELACAO = re.compile(r"[^\s]*correl\w* *[:=] +(-?\S+)", re.I)

# --- Contrato D1 (rodada 2, "onde estourou") ---------------------------------
# Linha de quadro do ebur128 (uma a cada 100 ms). Exemplo real desta maquina:
#   [Parsed_ebur128_0 @ 0000021831113e00] t: 0.399979   TARGET:-23 LUFS    M:  -8.2 S:-120.7     I:  -8.2 LUFS       LRA:   0.0 LU  FTPK:  -1.9  -1.9 dBFS  TPK:   0.0   0.0 dBFS
# Espacamento variavel entre campos; em silencio digital M vem -120.7 e pode
# colar no dois-pontos ("M:-120.7", medido no ffmpeg 7.1.4 desta maquina).
# FTPK traz um valor por canal (mono imprime so um); interessa o MAIOR.
# As linhas do bloco "Summary:" do fim NAO tem "t:" e nao casam com o regex.
_BALDES_ENVELOPE_PADRAO = 600
_MAXIMO_MOMENTOS_PADRAO = 200
_JANELA_VIZINHOS_S = 0.5        # quadros separados por menos disto = mesmo momento

_RE_QUADRO_EBUR128 = re.compile(
    r"^\[Parsed_ebur128[^\]]*\][^\S\n]*t:[^\S\n]*(\S+).*$", re.M)
_RE_CAMPO_M = re.compile(r"\bM:[ \t]*([^ \t]+)")
_RE_CAMPO_FTPK = re.compile(r"\bFTPK:[ \t]+(.+?)[ \t]+dBFS\b")


def _startupinfo():
    """Mesmo jeito de invocar subprocesso de src/media/ffmpeg.py (sem janela no Windows)."""
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return startupinfo


def _para_float(token):
    """Converte o token do relatorio em float; '-inf' vira float('-inf'), nao None."""
    texto = str(token).strip().lower()
    if not texto:
        return None
    if texto in ("-inf", "-infinity"):
        return float("-inf")
    if texto in ("+inf", "inf", "infinity"):
        return float("inf")
    try:
        valor = float(texto)
    except ValueError:
        return None
    if valor != valor:  # NaN nao serve para classificar nada
        return None
    return valor


def diagnostico_vazio() -> Dict[str, Any]:
    """Dict de diagnostico com todas as chaves presentes e None quando ausente."""
    diag = {chave: None for chave in _CHAVES_DIAG}
    diag["canais"] = 0
    return diag


def parse_ffmpeg_audio_report(texto: str) -> Dict[str, Any]:
    """Extrai as metricas do bloco Summary do ebur128 e das secoes do astats.

    Preferencia pelos valores da secao Overall do astats quando existirem;
    chaves que so saem por canal (ex.: "Crest factor" no ffmpeg 7.x) caem para
    o primeiro canal que as reportar.
    """
    diag = diagnostico_vazio()
    if not texto or not texto.strip():
        return diag

    diag["lufs_i"] = _valor_ancorado(_RE_I_LUFS, texto)
    diag["lra"] = _valor_ancorado(_RE_LRA, texto)
    diag["true_peak_db"] = _valor_ancorado(_RE_TRUE_PEAK, texto)

    blocos = _secoes_astats(texto)
    overall = next((kv for rotulo, kv in blocos if rotulo == "overall"), None)
    canais_kv = [kv for rotulo, kv in blocos if rotulo == "canal"]
    diag["canais"] = len(canais_kv)
    # Base = primeiro canal que reportar cada chave; Overall sobrescreve.
    fonte = {}
    for kv in canais_kv:
        for chave, valor in kv.items():
            fonte.setdefault(chave, valor)
    if overall is not None:
        fonte.update(overall)

    diag["rms_db"] = _pegar(fonte, "RMS level dB")
    diag["peak_db"] = _pegar(fonte, "Peak level dB")
    diag["crest_factor"] = _pegar(fonte, "Crest factor")
    diag["noise_floor_db"] = _pegar(fonte, "Noise floor dB")
    diag["n_samples"] = _pegar_int(fonte, "Number of samples")
    # O briefing pede "Peak count"; o plano (secao 5) lista "Abs Peak count".
    # No ffmpeg 7.x ambos saem iguais, entao usa um com fallback pro outro.
    diag["peak_count"] = _pegar_int(fonte, "Peak count", "Abs Peak count")

    n_samples = diag["n_samples"]
    peak_count = diag["peak_count"]
    if isinstance(n_samples, int) and n_samples > 0 and peak_count is not None:
        diag["clip_pct"] = 100.0 * peak_count / n_samples

    achou = _RE_CORRELACAO.search(texto)
    if achou:
        diag["stereo_corr"] = _para_float(achou.group(1))
    return diag


def _valor_ancorado(regex, texto):
    achou = regex.search(texto)
    return _para_float(achou.group(1)) if achou else None


def _secoes_astats(texto):
    """Fatia o stderr nas secoes do astats e devolve [(rotulo, {chave: valor})]."""
    matches = list(_RE_BLOCO_ASTATS.finditer(texto))
    blocos = []
    for i, m in enumerate(matches):
        fim = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
        kv = {}
        for linha in texto[m.end():fim].splitlines():
            if ":" not in linha:
                continue
            chave, _, valor = linha.rpartition(":")
            chave = chave.split("]")[-1].strip()
            if chave:
                kv[chave] = valor.strip()
        rotulo = "overall" if m.group(0).rstrip().endswith("Overall") else "canal"
        blocos.append((rotulo, kv))
    return blocos


def _pegar(kv, *nomes):
    for nome in nomes:
        if nome in kv:
            valor = _para_float(kv[nome])
            if valor is not None:
                return valor
    return None


def _pegar_int(kv, *nomes):
    valor = _pegar(kv, *nomes)
    if valor is None or valor != valor or valor in (float("inf"), float("-inf")):
        return None
    return int(round(valor))


def extrair_serie(texto: str) -> List[Dict[str, Any]]:
    """Contrato D1: uma entrada por linha de quadro do ebur128, na ordem.

    Devolve [{"t": float, "m": float|None, "ftpk": float|None}, ...] com t
    RELATIVO ao inicio da janela analisada (e assim que o ffmpeg imprime;
    converter para tempo absoluto do arquivo e papel de analisar_intervalo,
    que sabe o in_s). "ftpk" e o MAIOR entre os canais daquele quadro.
    Texto sem linhas de quadro -> lista vazia, sem excecao.
    """
    serie = []
    if not texto:
        return serie
    for achou in _RE_QUADRO_EBUR128.finditer(texto):
        t_quadro = _para_float(achou.group(1))
        if t_quadro is None:
            continue  # linha de quadro sem tempo utilizavel nao entra na serie
        linha = achou.group(0)
        m_quadro = None
        achou_m = _RE_CAMPO_M.search(linha)
        if achou_m:
            m_quadro = _para_float(achou_m.group(1))
        ftpk_quadro = None
        achou_ftpk = _RE_CAMPO_FTPK.search(linha)
        if achou_ftpk:
            por_canal = [_para_float(token)
                         for token in achou_ftpk.group(1).split()]
            por_canal = [valor for valor in por_canal if valor is not None]
            if por_canal:
                ftpk_quadro = max(por_canal)
        serie.append({"t": t_quadro, "m": m_quadro, "ftpk": ftpk_quadro})
    return serie


def resumir_serie(serie: List[Dict[str, Any]],
                  n_baldes: int = _BALDES_ENVELOPE_PADRAO) -> List[Dict[str, Any]]:
    """Contrato D1: envelope da serie em ate n_baldes fatias de tempo iguais.

    Devolve [{"t0", "t1", "ftpk_max", "m_med"}, ...] para a UI desenhar a faixa
    em qualquer zoom sem carregar os ~9.620 pontos de uma entrevista. Serie
    vazia -> lista vazia. Balde cujos quadros so tem silencio digital
    (FTPK -inf) fica com ftpk_max/m_med None: nunca devolvemos -inf/NaN aqui,
    porque o JSON da rota (contrato D2) nao aceita infinitos.
    """
    if not serie:
        return []
    quadros = [quadro for quadro in serie
               if isinstance(quadro.get("t"), (int, float)) and quadro["t"] == quadro["t"]]
    if not quadros:
        return []
    try:
        n_baldes = max(1, int(n_baldes))
    except (TypeError, ValueError):
        n_baldes = _BALDES_ENVELOPE_PADRAO
    t_inicial = quadros[0]["t"]
    duracao = max(quadros[-1]["t"] - t_inicial, 0.0)
    n = min(n_baldes, len(quadros))
    largura = duracao / n
    baldes = [{"ftpks": [], "ms": []} for _ in range(n)]
    for quadro in quadros:
        indice = int((quadro["t"] - t_inicial) / largura) if largura > 0 else 0
        indice = min(max(indice, 0), n - 1)
        baldes[indice]["ftpks"].append(quadro.get("ftpk"))
        baldes[indice]["ms"].append(quadro.get("m"))
    envelope = []
    for i, balde in enumerate(baldes):
        envelope.append({
            "t0": t_inicial + i * largura,
            "t1": t_inicial + (i + 1) * largura,
            "ftpk_max": _maior_finito(balde["ftpks"]),
            "m_med": _media_finita(balde["ms"]),
        })
    return envelope


def momentos_problematicos(serie: List[Dict[str, Any]],
                           limiares: Optional[Dict[str, float]] = None,
                           maximo: int = _MAXIMO_MOMENTOS_PADRAO) -> List[Dict[str, Any]]:
    """Contrato D1: agrupa quadros com problema em momentos para a UI listar.

    estouro: FTPK > 0.0 dBFS (severidade "grave");
    quase:   teto_dbtp < FTPK <= 0.0 dBFS (severidade "atencao").
    Quadros vizinhos separados por menos de _JANELA_VIZINHOS_S (0,5 s) caem no
    MESMO momento; um momento que misture quase e estouro herda o tipo mais
    grave. Ordenado por tempo; se passar de `maximo`, mantem os de maior pico.
    Tempos relativos a janela analisada - analisar_intervalo soma o in_s.
    """
    limite = dict(LIMIARES_PADRAO)
    if limiares:
        limite.update(limiares)
    teto = limite.get("teto_dbtp")
    if not isinstance(teto, (int, float)) or teto != teto:
        return []
    quadros = []
    for quadro in serie:
        t = quadro.get("t") if isinstance(quadro, dict) else None
        ftpk = quadro.get("ftpk") if isinstance(quadro, dict) else None
        if not isinstance(t, (int, float)) or t != t:
            continue
        # Sem pico finito nao ha problema: descarta None, NaN e silencio digital.
        if not isinstance(ftpk, (int, float)) or not math.isfinite(ftpk):
            continue
        if not ftpk > teto:
            continue
        quadros.append((float(t), float(ftpk)))
    quadros.sort(key=lambda par: par[0])

    grupos = []
    for t, ftpk in quadros:
        if grupos and t - grupos[-1]["fim"] < _JANELA_VIZINHOS_S:
            grupo = grupos[-1]
            grupo["fim"] = t
            grupo["picos"].append(ftpk)
        else:
            grupos.append({"inicio": t, "fim": t, "picos": [ftpk]})

    momentos = []
    for grupo in grupos:
        pico = max(grupo["picos"])
        momentos.append({
            "tipo": "estouro" if pico > 0.0 else "quase",
            "inicio": grupo["inicio"],
            "fim": grupo["fim"],
            "pico": pico,
            "severidade": "grave" if pico > 0.0 else "atencao",
        })
    momentos.sort(key=lambda momento: momento["inicio"])
    if maximo is not None and len(momentos) > maximo:
        momentos.sort(key=lambda momento: (-momento["pico"], momento["inicio"]))
        momentos = momentos[:max(int(maximo), 0)]
        momentos.sort(key=lambda momento: momento["inicio"])
    return momentos


def _maior_finito(valores):
    """Maior valor mensuravel da lista; None se so houver ausencia/silencio."""
    validos = [valor for valor in valores
               if isinstance(valor, (int, float)) and math.isfinite(valor)]
    return max(validos) if validos else None


def _media_finita(valores):
    """Media dos valores finitos; None se nada for mensuravel."""
    validos = [float(valor) for valor in valores
               if isinstance(valor, (int, float)) and math.isfinite(valor)]
    return sum(validos) / len(validos) if validos else None


def _com_tempo_absoluto(itens, deslocamento_s, chaves):
    """Soma o in_s da janela aos tempos relativos impressos pelo ffmpeg."""
    if not itens or not deslocamento_s:
        return itens
    saida = []
    for item in itens:
        novo = dict(item)
        for chave in chaves:
            valor = novo.get(chave)
            if isinstance(valor, (int, float)) and valor == valor:
                novo[chave] = round(valor + deslocamento_s, 3)
        saida.append(novo)
    return saida


def analisar_intervalo(src: Path, in_s: Optional[float] = None,
                       out_s: Optional[float] = None) -> Dict[str, Any]:
    """Roda um passe de ffmpeg (secao 5 do plano) sobre o intervalo e devolve
    o diagnostico completo acrescido de ok / erro / duracao_s.

    Contrato D1: devolve tambem "envelope" e "momentos" (novidades da rodada 2,
    "onde estourou"), com tempos convertidos para segundos ABSOLUTOS no arquivo
    de origem - o ffmpeg roda com -ss e imprime t comecando em zero, entao o
    deslocamento in_s e somado aqui, que somos quem sabe a janela pedida.
    """
    resultado = diagnostico_vazio()
    resultado["ok"] = False
    resultado["erro"] = None
    resultado["duracao_s"] = None
    resultado["envelope"] = []
    resultado["momentos"] = []

    caminho = Path(src)
    if not caminho.exists():
        resultado["erro"] = f"Arquivo nao encontrado: {caminho}"
        return resultado

    duracao_pedida = None
    if out_s is not None:
        inicio = float(in_s) if in_s is not None else 0.0
        duracao_pedida = float(out_s) - inicio
        if duracao_pedida <= 0:
            resultado["erro"] = (
                f"Intervalo invalido: out ({out_s}) precisa ser maior que in ({inicio}).")
            return resultado

    taxa_amostragem, tem_audio = _probe_faixa_audio(caminho)
    if tem_audio is False:
        print(f"[AudioAnalysis] {caminho.name} nao tem faixa de audio para analisar.")
        resultado["erro"] = ("Arquivo sem faixa de audio: ffprobe nao encontrou "
                             "nenhuma stream 'a' para mapear como 0:a:0.")
        return resultado

    cmd = ["ffmpeg", "-v", "info", "-nostats"]
    if in_s is not None:
        cmd += ["-ss", str(float(in_s))]
    if duracao_pedida is not None:
        cmd += ["-t", str(duracao_pedida)]
    cmd += ["-i", str(caminho), "-map", "0:a:0",
            "-af", "ebur128=peak=true,astats", "-f", "null", "-"]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              startupinfo=_startupinfo(), timeout=_TIMEOUT_FFMPEG_S)
    except FileNotFoundError:
        print("[AudioAnalysis] Executavel ffmpeg nao encontrado no PATH.")
        resultado["erro"] = "ffmpeg nao encontrado no PATH desta maquina."
        return resultado
    except subprocess.TimeoutExpired:
        print(f"[AudioAnalysis] Analise de {caminho.name} excedeu {_TIMEOUT_FFMPEG_S:.0f}s.")
        resultado["erro"] = f"Analise excedeu o tempo limite de {_TIMEOUT_FFMPEG_S:.0f}s."
        return resultado
    except OSError as e:
        print(f"[AudioAnalysis] Falha ao executar ffmpeg para {caminho.name}: {e}")
        resultado["erro"] = f"Falha ao executar o ffmpeg: {e}"
        return resultado

    if proc.returncode != 0:
        motivo = _ultima_linha_util(proc.stderr) or f"codigo de saida {proc.returncode}"
        print(f"[AudioAnalysis] FFmpeg falhou ao analisar {caminho.name}: {motivo}")
        resultado["erro"] = f"FFmpeg falhou ao analisar o intervalo: {motivo}"
        return resultado

    resultado.update(parse_ffmpeg_audio_report(proc.stderr))
    if resultado["canais"] == 0 and resultado["rms_db"] is None \
            and resultado["lufs_i"] is None:
        resultado["erro"] = ("FFmpeg terminou sem produzir os sumarios "
                             "ebur128/astats esperados.")
        return resultado

    # Contrato D1: as linhas por-quadro do ebur128, que antes eram jogadas
    # fora, viram faixa (envelope) + lista (momentos) para a UI.
    deslocamento = float(in_s) if in_s is not None else 0.0
    serie_quadros = extrair_serie(proc.stderr)
    resultado["envelope"] = _com_tempo_absoluto(resumir_serie(serie_quadros),
                                                deslocamento, ("t0", "t1"))
    resultado["momentos"] = _com_tempo_absoluto(
        momentos_problematicos(serie_quadros), deslocamento, ("inicio", "fim"))

    # Correlacao L/R: o astats do ffmpeg 7.1.4 NAO reporta, entao medimos com um
    # passe barato a mais. Sem ela, quem decide o processamento por canal cai
    # sempre no caminho seguro-e-lento (2,6x mais CPU) mesmo em material mono
    # duplicado, que e a maioria deste acervo.
    if resultado.get("stereo_corr") is None and (resultado.get("canais") or 0) >= 2:
        resultado["stereo_corr"] = _medir_correlacao_canais(
            src, in_s, duracao_pedida, resultado.get("rms_db"))

    resultado["ok"] = True
    if taxa_amostragem and isinstance(resultado["n_samples"], int):
        resultado["duracao_s"] = resultado["n_samples"] / taxa_amostragem
    elif duracao_pedida is not None:
        resultado["duracao_s"] = round(duracao_pedida, 3)
    return resultado


def _medir_correlacao_canais(src: Path, in_s: Optional[float],
                             duracao: Optional[float],
                             rms_sinal_db: Optional[float]) -> Optional[float]:
    """Correlacao entre os canais L e R, derivada da energia da DIFERENCA deles.

    Para dois canais de RMS parecido e correlacao p, a media-diferenca
    (L-R)/2 tem energia 0,5 * sigma^2 * (1-p). Logo, com r = razao linear entre
    o RMS da diferenca e o RMS do sinal:  p = 1 - 2 * r^2.

    Conferido no material real (entrevista Julia + Virshna, janela 405-425 s):
    sinal -10,65 dB, diferenca -45,53 dB -> p = 0,99935. A medicao independente
    registrada na secao 5 do plano deu 0,99937.

    Devolve None quando nao da para medir - e ai quem decide assume o pior caso.
    """
    if rms_sinal_db is None:
        return None
    cmd = ["ffmpeg", "-v", "info", "-nostats"]
    if in_s is not None:
        cmd += ["-ss", str(float(in_s))]
    if duracao is not None:
        cmd += ["-t", str(float(duracao))]
    cmd += ["-i", str(src), "-map", "0:a:0",
            "-af", "pan=mono|c0=0.5*c0-0.5*c1,astats=measure_perchannel=none",
            "-f", "null", "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", startupinfo=_startupinfo(),
                              timeout=_TIMEOUT_FFMPEG_S)
    except Exception as e:
        print(f"[AudioAnalysis] Nao consegui medir a correlacao dos canais de "
              f"{src.name}: {e}")
        return None
    achou = re.findall(r"RMS level dB:\s*(-?\d+(?:\.\d+)?|-?inf)", proc.stderr or "")
    if not achou:
        return None
    bruto = achou[-1]
    if bruto.lstrip("-").lower() == "inf":
        return 1.0  # diferenca em silencio digital: canais identicos
    rms_diff_db = _para_float(bruto)
    if rms_diff_db is None:
        return None
    razao_quadrada = 10.0 ** ((rms_diff_db - float(rms_sinal_db)) / 10.0)
    correlacao = 1.0 - 2.0 * razao_quadrada
    return round(max(-1.0, min(1.0, correlacao)), 5)


def _probe_faixa_audio(caminho: Path) -> Tuple[Optional[int], Optional[bool]]:
    """Checagem barata via ffprobe: existe stream 'a'? qual a sample rate?

    Devolve (sample_rate, tem_audio); tem_audio None significa "nao deu para
    saber" (ffprobe ausente ou ilegivel) e ai quem decide e o proprio ffmpeg.
    """
    cmd = ["ffprobe", "-v", "quiet", "-select_streams", "a:0",
           "-show_entries", "stream=codec_type,sample_rate",
           "-of", "json", str(caminho)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              startupinfo=_startupinfo(), timeout=_TIMEOUT_FFMPEG_S)
    except Exception as e:
        print(f"[AudioAnalysis] FFprobe indisponivel para checar faixa de audio "
              f"de {caminho.name}: {e}")
        return None, True
    try:
        dados = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return None, True
    streams = dados.get("streams") or []
    if not streams:
        return None, False
    taxa = None
    bruta = (streams[0].get("sample_rate") or "").strip()
    if bruta:
        try:
            taxa = int(bruta)
        except ValueError:
            taxa = None
    return taxa, True


def _ultima_linha_util(stderr_texto):
    if not stderr_texto:
        return None
    linhas = [linha.strip() for linha in stderr_texto.strip().splitlines() if linha.strip()]
    return linhas[-1] if linhas else None


def avaliar(diag: Dict[str, Any], limiares: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """Aplica a tabela "Condicao medida / Consequencia" da secao 7 do plano.

    Devolve {"selos": [...], "preset_sugerido": str|None, "cadeia_sugerida": [str]}.
    """
    l = dict(LIMIARES_PADRAO)
    if limiares:
        l.update(limiares)

    lufs_i = diag.get("lufs_i")
    true_peak = diag.get("true_peak_db")
    clip_pct = diag.get("clip_pct")
    noise_floor = diag.get("noise_floor_db")
    lra = diag.get("lra")
    stereo_corr = diag.get("stereo_corr")
    canais = diag.get("canais") or 0

    selos = []
    precisa_loudnorm = False
    denoise_forte = False
    clipado = False
    lra_ampla = False

    # Loudness (LUFS contra alvo): fora de +-1 LU liga o loudnorm de 2 passes.
    if lufs_i is not None:
        desvio = lufs_i - l["alvo_lufs"]
        precisa_loudnorm = abs(desvio) > _LOUDNESS_TOLERANCIA_LU
        if not precisa_loudnorm:
            selos.append({"metrica": "loudness", "valor": lufs_i, "severidade": "ok",
                          "texto": f"Loudness no alvo: {_fmt(lufs_i)} LUFS"})
        elif desvio > 0:
            selos.append({"metrica": "loudness", "valor": lufs_i, "severidade": "atencao",
                          "texto": f"Loudness ALTO: {_fmt(lufs_i)} LUFS "
                                   f"(alvo {_fmt(l['alvo_lufs'])})"})
        else:
            selos.append({"metrica": "loudness", "valor": lufs_i, "severidade": "atencao",
                          "texto": f"Loudness BAIXO: {_fmt(lufs_i)} LUFS "
                                   f"(alvo {_fmt(l['alvo_lufs'])})"})

    # Pico real (dBTP contra teto): acima de 0 dBFS e estouro duro, sempre grave.
    if true_peak is not None:
        sinal = "+" if true_peak >= 0 else ""
        if true_peak > 0.0:
            selos.append({"metrica": "pico_real", "valor": true_peak, "severidade": "grave",
                          "texto": f"Pico real ESTOUROU: {sinal}{_fmt(true_peak)} dBTP"})
            clipado = True
        elif true_peak > l["teto_dbtp"]:
            selos.append({"metrica": "pico_real", "valor": true_peak, "severidade": "atencao",
                          "texto": f"Pico real acima do teto: {sinal}{_fmt(true_peak)} dBTP "
                                   f"(teto {_fmt(l['teto_dbtp'])})"})
        else:
            selos.append({"metrica": "pico_real", "valor": true_peak, "severidade": "ok",
                          "texto": f"Pico real sob controle: {_fmt(true_peak)} dBTP"})

    # Clipping: fracao de amostras em fundo de escala (secao 5: acima de
    # 0,05% ja e audivel).
    if clip_pct is not None:
        if clip_pct > l["clip_pct_grave"]:
            selos.append({"metrica": "clipping", "valor": clip_pct, "severidade": "grave",
                          "texto": f"Clipping GRAVE: {_fmt(clip_pct, 2)}% das amostras"})
            clipado = True
        elif clip_pct > 0.0:
            selos.append({"metrica": "clipping", "valor": clip_pct, "severidade": "atencao",
                          "texto": f"Clipping leve: {_fmt(clip_pct, 2)}% das amostras"})
        else:
            selos.append({"metrica": "clipping", "valor": clip_pct, "severidade": "ok",
                          "texto": "Sem clipping nas amostras"})

    # Ruido (piso): acima de -35 dB pede denoise IA; entre -35 e -45 so sugere leve.
    if noise_floor is not None:
        if noise_floor == float("-inf"):
            selos.append({"metrica": "ruido", "valor": noise_floor, "severidade": "ok",
                          "texto": "Piso de ruido: silencio digital (-inf)"})
        elif noise_floor > l["piso_ruido_alto"]:
            denoise_forte = True
            selos.append({"metrica": "ruido", "valor": noise_floor, "severidade": "atencao",
                          "texto": f"Ruido ALTO: {_fmt(noise_floor)} dB "
                                   "(denoise IA recomendado)"})
        elif noise_floor > l["piso_ruido_medio"]:
            selos.append({"metrica": "ruido", "valor": noise_floor, "severidade": "atencao",
                          "texto": f"Ruido moderado: {_fmt(noise_floor)} dB "
                                   "(denoise leve opcional)"})
        else:
            selos.append({"metrica": "ruido", "valor": noise_floor, "severidade": "ok",
                          "texto": f"Ruido sob controle: {_fmt(noise_floor)} dB"})

    # Dinamica (LRA): esmagada bloqueia speechnorm forte; ampla pede leveler.
    if lra is not None:
        if lra < l["lra_esmagado"]:
            selos.append({"metrica": "dinamica", "valor": lra, "severidade": "atencao",
                          "texto": f"Dinamica ESMAGADA: LRA {_fmt(lra)} "
                                   "(nao comprimir de novo)"})
        elif lra > l["lra_amplo"]:
            lra_ampla = True
            selos.append({"metrica": "dinamica", "valor": lra, "severidade": "atencao",
                          "texto": f"Dinamica ampla demais: LRA {_fmt(lra)} "
                                   "(leveler ajuda)"})
        else:
            selos.append({"metrica": "dinamica", "valor": lra, "severidade": "ok",
                          "texto": f"Dinamica saudavel: LRA {_fmt(lra)}"})

    # Fontes estereo: correlacao baixa significa duas fontes distintas.
    if stereo_corr is not None and canais >= 2:
        if stereo_corr < l["correlacao_estereo"]:
            selos.append({"metrica": "estereo", "valor": stereo_corr, "severidade": "atencao",
                          "texto": "Duas fontes detectadas: processar canais separados"})
        else:
            selos.append({"metrica": "estereo", "valor": stereo_corr, "severidade": "ok",
                          "texto": f"Canais coerentes entre si ({_fmt(stereo_corr, 3)})"})

    cadeia = []
    if clipado:
        # Plano secao 6: reparo de clipping ANTES do denoise, sempre.
        cadeia += ["adeclip", "adeclick"]
    if denoise_forte and noise_floor is not None:
        atenuacao_db = min(_ATENUACAO_MAX_DB,
                           max(_ATENUACAO_MIN_DB,
                               round(noise_floor - _PISO_ALVO_DENOISE_DB)))
        cadeia.append(f"dpdfnet:{atenuacao_db}")
    if lra_ampla:
        cadeia.append("speechnorm")
    if precisa_loudnorm:
        cadeia.append(f"loudnorm:{l['alvo_lufs']:g}")
    if cadeia:
        cadeia.append("alimiter")

    preset = None
    if clipado:
        preset = "resgate_estourado"
    elif denoise_forte:
        preset = "voz_limpa"
    elif precisa_loudnorm or lra_ampla:
        preset = "so_entrega"

    return {"selos": selos, "preset_sugerido": preset, "cadeia_sugerida": cadeia}


def _fmt(valor, casas=1):
    """Formata numero pra UI pt-BR (virgula decimal), seguro para infinitos."""
    if valor is None:
        return "?"
    if valor == float("-inf"):
        return "-inf"
    if valor == float("inf"):
        return "+inf"
    return f"{valor:.{casas}f}".replace(".", ",")
