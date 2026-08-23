"""Ponte com a DAW - ida e volta por arquivo (PLANO_AJUSTES_DE_AUDIO.md, secoes 9 e 10).

O Talho nao e mixador e nao deve virar um. Este modulo so faz duas coisas:

1. `exportar_stems` - exporta o audio dos clipes da sequencia em WAV 48 kHz /
   24 bits (pcm_s24le), SEM tratamento nenhum (sem filtro, sem ganho, sem
   normalizacao): o ponto e entregar o material cru para a DAW. Cada stem comeca
   no ponto `in` do clipe NA MIDIA DE ORIGEM, com a duracao exata do corte, e o
   nome do arquivo carrega o timecode - e isso que permite o retorno automatico:
   o arquivo tratado volta pela pasta observada (`watch/audio_daw/`) com o MESMO
   nome-base, e `parse_nome_stem` reconhece de qual clipe ele veio.

2. `relatorio_efeitos` - gera o relatorio .txt que a secao 10 exige, listando os
   efeitos de Tipo A (`audio_eq`, `audio_dynamics`) de cada clipe para o mixador
   reproduzir na DAW. Esses efeitos NAO tem equivalente em FCPXML/EDL; fingir
   que atravessam a conformacao seria pior do que declarar.

Convencao de nomes (contrato de ida e volta):

    stem_v<video_id>_<IN_MS:09d>-<OUT_MS:09d>.wav

    Exemplo: clipe do video 17, de 405.5 s a 415.5 s na midia de origem ->
             stem_v17_000405500-000415500.wav

    - IN_MS / OUT_MS sao os milissegundos INTEIROS dos pontos de entrada e saida
      na midia de origem (nao a posicao na timeline), zero-padded em 9 digitos,
      o que torna o nome estavel, ordenavel e parseavel sem ambiguidade.
    - O par (video_id, IN_MS, OUT_MS) identifica unicamente o material exportado;
      `parse_nome_stem(nome)` devolve esses tres valores ou None se o nome nao
      seguir a convencao. E essa funcao que o retorno automatico (pasta observada)
      usa para religar o arquivo tratado ao clipe correto.
    - Clipes vinculados (video na pista V1 + audio ligado na A1) apontam para a
      mesma midia e o mesmo intervalo: geram UM stem so (dedupe por chave).

Guardas (secao "Guardas" da Etapa 6):
    - Nunca escreve dentro de F:/ (acervo bruto, somente leitura): qualquer
      destino resolvido no drive F: levanta ValueError antes de criar pasta.
    - Nunca sobrescreve arquivo existente sem que o chamador peca
      (`sobrescrever=True`); sem isso, existente -> FileExistsError.
    - Nunca toca no original: a midia de origem entra como entrada do ffmpeg e
      nada e escrito perto dela; destino identico a origem e recusado.

Nao implementado de proposito: hospedagem de VST via pedalboard (opcional no
plano, bug conhecido de crash e licenca inexistente). O encaixe previsto seria
um worker em subprocesso isolado recebendo o WAV deste modulo; quando existir,
basta plugar entre o export e a pasta de retorno.

Impressoes seguem a convencao do projeto: nada de caracteres fora de cp1252.
"""
import os
import re
import shutil
import subprocess
import datetime
from pathlib import Path

TAXA_AMOSTRAGEM = 48000
CODEC_PCM = "pcm_s24le"
BITS = 24
PREFIXO_STEM = "stem"
NOME_RELATORIO = "relatorio_efeitos.txt"

# Efeitos de Tipo A (ao vivo) que nao atravessam conformacao - secao 10 do plano.
TIPOS_EFEITO_TIPO_A = ("audio_eq", "audio_dynamics")

# Contrato de nome: stem_v<id>_<9 digitos ms>-<9 digitos ms>.wav
_PADRAO_NOME_STEM = re.compile(
    r"^" + PREFIXO_STEM + r"_v(?P<video_id>\d+)_(?P<in_ms>\d{9})-(?P<out_ms>\d{9})\.wav$",
    re.IGNORECASE,
)

_LIMITE_MS = 10 ** 9 - 1  # 9 digitos comportam ~11.5 dias de midia


# ---------------------------------------------------------------------------
# Helpers de tempo e nome
# ---------------------------------------------------------------------------

def _para_ms(segundos: float) -> int:
    """Segundos -> milissegundos inteiros (arredondamento half-up)."""
    ms = int(round(float(segundos) * 1000))
    if ms < 0 or ms > _LIMITE_MS:
        raise ValueError(f"Timecode fora da faixa representavel (0 a {_LIMITE_MS} ms): {ms} ms")
    return ms


def formatar_tc(segundos: float) -> str:
    """Segundos -> 'HH:MM:SS.mmm' (legivel, ASCII puro)."""
    total_ms = max(0, int(round(float(segundos) * 1000)))
    h, resto = divmod(total_ms, 3600_000)
    m, resto = divmod(resto, 60_000)
    s, ms = divmod(resto, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def nome_stem(video_id: int, in_s: float, out_s: float) -> str:
    """Constroi o nome-base do stem segundo a convencao documentada no modulo."""
    vid = int(video_id)
    if vid <= 0:
        raise ValueError(f"video_id invalido: {video_id!r}")
    in_ms = _para_ms(in_s)
    out_ms = _para_ms(out_s)
    if out_ms <= in_ms:
        raise ValueError(f"Corte vazio ou invertido: in={in_s}s out={out_s}s")
    return f"{PREFIXO_STEM}_v{vid}_{in_ms:09d}-{out_ms:09d}.wav"


def parse_nome_stem(nome: str):
    """Reconhece um nome na convencao e devolve (video_id, in_s, out_s) ou None.

    Aceita nome solto ou caminho completo (usa apenas o basename). E o lado de
    retorno da ponte: quem observa a pasta `watch/audio_daw/` chama isto para
    saber a qual clipe o arquivo tratado pertence.
    """
    m = _PADRAO_NOME_STEM.match(Path(str(nome)).name)
    if not m:
        return None
    return (
        int(m.group("video_id")),
        int(m.group("in_ms")) / 1000.0,
        int(m.group("out_ms")) / 1000.0,
    )


# ---------------------------------------------------------------------------
# Guardas
# ---------------------------------------------------------------------------

def _assegurar_destino_seguro(destino) -> Path:
    """Valida e cria a pasta de destino. Recusa o drive F: (acervo, so leitura)."""
    pasta = Path(destino).resolve()
    if pasta.drive.upper() == "F:" or str(pasta).upper().startswith("F:\\"):
        raise ValueError(
            f"Destino dentro do drive F:/ (acervo bruto, somente leitura) e proibido: {pasta}"
        )
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def _garantir_arquivo_livre(caminho: Path, sobrescrever: bool) -> None:
    """Nunca sobrescreve arquivo existente sem pedido explicito do chamador."""
    if caminho.exists() and not sobrescrever:
        raise FileExistsError(
            f"Arquivo ja existe e sobrescrever=False: {caminho} "
            "(passe sobrescrever=True se realmente quiser substitui-lo)"
        )


def _binario(nome: str, override=None) -> str:
    """Resolve ffmpeg/ffprobe: override explicito ou PATH. Falha cedo e clara."""
    candidato = str(override) if override else shutil.which(nome)
    if not candidato or not Path(candidato).exists():
        raise RuntimeError(f"'{nome}' nao encontrado no PATH nem por override.")
    return candidato


def _ocultar_janela():
    if os.name == "nt":
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        return si
    return None


# ---------------------------------------------------------------------------
# Resolvedores padrao (DB), com fallback silencioso p/ uso standalone/testes
# ---------------------------------------------------------------------------

def _resolver_do_banco(video_id: int, campo: str):
    try:
        from src.db.connection import get_db
        with get_db() as conn:
            row = conn.execute(
                f"SELECT {campo} FROM video WHERE id = ?", (int(video_id),)
            ).fetchone()
        valor = row[campo] if row is not None else None
        return str(valor).strip() if valor else None
    except Exception:
        return None


def resolver_caminho_padrao(video_id: int):
    """Caminho da midia de origem pelo DB; None se nao achar (clipe pulado)."""
    bruto = _resolver_do_banco(video_id, "filepath")
    return Path(bruto) if bruto else None


def resolver_nome_padrao(video_id: int) -> str:
    """Nome legivel do clipe pelo DB; fallback 'video_<id>' fora do app."""
    return _resolver_do_banco(video_id, "filename") or f"video_{int(video_id)}"


# ---------------------------------------------------------------------------
# Normalizacao da sequencia
# ---------------------------------------------------------------------------

def normalizar_sequencia(sequencia) -> dict:
    """Aceita o formato v2 ({clips,fps,tracks,...}) ou lista legada v1."""
    if isinstance(sequencia, list):
        return {"version": 2, "fps": 24.0, "tracks": [], "clips": sequencia}
    if isinstance(sequencia, dict):
        seq = dict(sequencia)
        seq.setdefault("clips", [])
        seq.setdefault("fps", 24.0)
        seq.setdefault("tracks", [])
        return seq
    raise TypeError(f"Sequencia invalida: {type(sequencia).__name__}")


def _trilhas_ignoradas(seq: dict):
    """Ids de pistas de IA (sugestoes nao aceitas nunca sao exportadas)."""
    return {
        str(t.get("id"))
        for t in seq.get("tracks", [])
        if str(t.get("kind") or "").lower() == "ai"
    }


def _efeitos_tipo_a(clip: dict) -> list:
    """Efeitos de Tipo A do clipe, na ordem declarada (inclui bypassados)."""
    efeitos = clip.get("effects") or []
    return [e for e in efeitos if isinstance(e, dict) and e.get("type") in TIPOS_EFEITO_TIPO_A]


# ---------------------------------------------------------------------------
# 1. Export de stems
# ---------------------------------------------------------------------------

def exportar_stems(sequencia, destino, *, sobrescrever: bool = False,
                   trilhas=None, resolver_caminho=None, resolver_nome=None,
                   gerar_relatorio: bool = True, ffmpeg_bin=None) -> dict:
    """Exporta o audio cru de cada clipe da sequencia em WAV 48 kHz / 24 bits.

    Retorna {"stems": [Path...], "relatorio": Path|None, "ignorados": [str...]}.

    - Um arquivo por intervalo unico (video_id, in, out); clipes vinculados que
      dividem a mesma midia e corte produzem UM stem (dedupe pela chave do nome).
    - Foto, pista de IA e corte vazio sao ignorados (registrados em 'ignorados').
    - `trilhas` filtra por ids de pista (ex.: ["A1"]); None = todas.
    - `resolver_caminho(video_id)->Path|None` e `resolver_nome(video_id)->str`
      permitem injetar midia/nome sem DB (padrao: tabela video do proprio app).
    - `gerar_relatorio=True` escreve tambem o .txt da secao 10 ao lado dos stems.
    - Guardas: destino fora de F:/, sem sobrescrita sem pedido, original intacto.
    """
    seq = normalizar_sequencia(sequencia)
    pasta = _assegurar_destino_seguro(destino)
    ffmpeg = _binario("ffmpeg", ffmpeg_bin)
    res_caminho = resolver_caminho or resolver_caminho_padrao
    res_nome = resolver_nome or resolver_nome_padrao

    ia_ids = _trilhas_ignoradas(seq)
    permitidas = {str(t) for t in trilhas} if trilhas else None

    exportados: dict = {}
    ignorados: list = []

    clips = [c for c in seq["clips"] if isinstance(c, dict)]
    clips.sort(key=lambda c: (str(c.get("track", "")), float(c.get("timeline_start", 0.0) or 0.0)))

    for cut in clips:
        track = str(cut.get("track", ""))
        rotulo = cut.get("name") or (f"video_{cut.get('video_id')}" if cut.get("video_id") else track)
        if track in ia_ids:
            ignorados.append(f"{rotulo}: pista de IA (sugestao nao exportada)")
            continue
        if permitidas is not None and track not in permitidas:
            continue
        if str(cut.get("type")) == "photo" or not cut.get("video_id"):
            ignorados.append(f"{rotulo}: clipe sem audio (foto ou sem video_id)")
            continue
        try:
            in_s = float(cut.get("in", 0.0))
            out_s = float(cut.get("out", 0.0))
            nome = nome_stem(cut.get("video_id"), in_s, out_s)
        except (TypeError, ValueError) as e:
            ignorados.append(f"{rotulo}: corte invalido ({e})")
            continue

        chave = nome  # (video_id, in_ms, out_ms) ja codificado no nome
        if chave in exportados:
            continue  # par vinculado do mesmo corte: um stem basta

        origem = res_caminho(int(cut["video_id"]))
        if not origem or not Path(origem).exists():
            ignorados.append(f"{rotulo}: midia de origem nao encontrada")
            continue
        origem = Path(origem).resolve()

        alvo = pasta / nome
        _garantir_arquivo_livre(alvo, sobrescrever)
        if alvo.resolve() == origem:
            ignorados.append(f"{rotulo}: destino igual a origem (recusado)")
            continue

        dur_s = (_para_ms(out_s) - _para_ms(in_s)) / 1000.0
        comentario = f"capiau_stem v={int(cut['video_id'])} in_ms={_para_ms(in_s)} out_ms={_para_ms(out_s)}"
        cmd = [
            ffmpeg, "-hide_banner", "-v", "error", "-y",
            "-ss", f"{in_s:.3f}", "-i", str(origem),
            "-t", f"{dur_s:.3f}",
            "-vn", "-map", "0:a:0",
            "-acodec", CODEC_PCM, "-ar", str(TAXA_AMOSTRAGEM),
            "-map_metadata", "-1",
            "-metadata", f"comment={comentario}",
            str(alvo),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace",
                              startupinfo=_ocultar_janela())
        ok = proc.returncode == 0 and alvo.exists() and alvo.stat().st_size > 44
        if not ok:
            if alvo.exists():
                try:
                    alvo.unlink()
                except OSError:
                    pass
            detalhe = (proc.stderr or proc.stdout or "").strip().splitlines()
            ignorados.append(f"{rotulo}: ffmpeg falhou ({detalhe[-1] if detalhe else 'sem saida'})")
            continue
        print(f"[STEMS] OK {nome} <- {origem.name} ({formatar_tc(in_s)} a {formatar_tc(out_s)})")
        exportados[chave] = alvo

    relatorio_path = None
    if gerar_relatorio:
        relatorio_path = relatorio_efeitos(
            seq, pasta, sobrescrever=sobrescrever, resolver_nome=res_nome,
            nome_arquivo=NOME_RELATORIO,
        )

    return {"stems": list(exportados.values()), "relatorio": relatorio_path, "ignorados": ignorados}


# ---------------------------------------------------------------------------
# 2. Relatorio de efeitos de Tipo A (.txt da secao 10)
# ---------------------------------------------------------------------------

def _linha_parametros(efeito: dict) -> list:
    tipo = efeito.get("type")
    if tipo == "audio_eq":
        return [
            f"HPF (corte de graves): {_fmt_num(efeito.get('hpf'))} Hz",
            f"Graves (low shelf): {_fmt_num(efeito.get('low'))} dB",
            f"Medios (peak): {_fmt_num(efeito.get('mid'))} dB",
            f"Agudos (high shelf): {_fmt_num(efeito.get('high'))} dB",
        ]
    if tipo == "audio_dynamics":
        return [
            f"Gate (limiar): {_fmt_num(efeito.get('gate_db'))} dB",
            f"Compressor: razao {_fmt_num(efeito.get('comp_ratio'))}:1",
            f"Compressor: limiar {_fmt_num(efeito.get('comp_thresh_db'))} dB",
            f"Ganho de compensacao (makeup): {_fmt_num(efeito.get('makeup_db'))} dB",
        ]
    return []


_TITULO_EFEITO = {"audio_eq": "EQ de 3 bandas + HPF (audio_eq)",
                  "audio_dynamics": "Gate + Compressor (audio_dynamics)"}


def _fmt_num(valor) -> str:
    """Numero legivel: inteiro sem casas, float com ate 2 casas; '?' se ausente."""
    try:
        num = float(valor)
    except (TypeError, ValueError):
        return "?"
    if abs(num - round(num)) < 1e-9:
        return str(int(round(num)))
    return f"{num:.2f}".rstrip("0").rstrip(".")


def relatorio_efeitos(sequencia, destino, *, sobrescrever: bool = False,
                      resolver_nome=None, fps=None, nome_arquivo=NOME_RELATORIO) -> Path:
    """Escreve o .txt dos efeitos de Tipo A ao lado do export (secao 10).

    Legivel por humano, em portugues, com timecode de origem, posicao na
    timeline, nome do clipe e TODOS os parametros declarados. Clipe sem efeito
    de Tipo A nao aparece (nao polui o arquivo). Efeitos com disabled=true sao
    listados marcados como BYPASSADOS - omitir seria mentir sobre o estado.
    O texto e gravado em cp1252 estrito: qualquer caractere fora dele quebra
    aqui, e nao na console do usuario.
    """
    seq = normalizar_sequencia(sequencia)
    pasta = _assegurar_destino_seguro(destino)
    res_nome = resolver_nome or resolver_nome_padrao
    fps = float(fps if fps is not None else seq.get("fps") or 24.0) or 24.0
    agora = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

    linhas = [
        "RELATORIO DE EFEITOS DE AUDIO - Tipo A (ao vivo)",
        "=" * 62,
        f"Gerado em: {agora}",
        "Atencao ao mixador:",
        "  Estes efeitos NAO atravessam a conformacao (FCPXML/EDL/OTIO nao os",
        "  carregam). Os stems enviados estao CRUS: reproduza abaixo, na DAW,",
        "  o equivalente de cada ajuste, nesta ordem, por clipe.",
        f"FPS da sequencia: {_fmt_num(fps)}",
        "",
    ]

    ia_ids = _trilhas_ignoradas(seq)
    secoes = 0
    for idx, cut in enumerate([c for c in seq["clips"] if isinstance(c, dict)], start=1):
        if str(cut.get("track", "")) in ia_ids:
            continue
        efeitos = _efeitos_tipo_a(cut)
        if not efeitos:
            continue
        secoes += 1
        vid = cut.get("video_id")
        nome_cli = res_nome(int(vid)) if vid else (cut.get("name") or "clipe sem nome")
        in_s = float(cut.get("in", 0.0) or 0.0)
        out_s = float(cut.get("out", 0.0) or 0.0)
        tl = cut.get("timeline_start")
        linhas.append("-" * 62)
        linhas.append(f"[{secoes}] CLIPE: {nome_cli}")
        linhas.append(f"    Pista: {cut.get('track', '?')}   "
                      f"Origem: {formatar_tc(in_s)} a {formatar_tc(out_s)}")
        if tl is not None:
            dur = out_s - in_s
            linhas.append(f"    Posicao na timeline: {formatar_tc(float(tl))} a "
                          f"{formatar_tc(float(tl) + dur)}")
        for efeito in efeitos:
            titulo = _TITULO_EFEITO.get(efeito.get("type"), str(efeito.get("type")))
            if efeito.get("disabled"):
                linhas.append(f"    * {titulo} [BYPASSADO - NAO aplicar]")
                continue
            linhas.append(f"    * {titulo}")
            for linha in _linha_parametros(efeito):
                linhas.append(f"        - {linha}")
        linhas.append("")

    if secoes == 0:
        linhas.append("Nenhum clipe desta sequencia tem efeito de Tipo A (audio_eq /")
        linhas.append("audio_dynamics). Nada a reproduzir manualmente na DAW.")
        linhas.append("")
    else:
        linhas.append("=" * 62)
        linhas.append(f"Fim do relatorio - {secoes} clipe(s) com efeitos de Tipo A.")
        linhas.append("Efeitos de Tipo B (declip/denoise/loudness etc.) ja viram")
        linhas.append("arquivo tratado e viajam como referencia de midia, nao como nota.")

    texto = "\n".join(linhas)
    texto.encode("cp1252")  # valida cedo: nada de caractere fora do cp1252
    alvo = pasta / nome_arquivo
    _garantir_arquivo_livre(alvo, sobrescrever)
    with open(alvo, "w", encoding="cp1252", errors="strict", newline="\r\n") as fh:
        fh.write(texto)
    print(f"[STEMS] Relatorio de efeitos: {alvo}")
    return alvo
