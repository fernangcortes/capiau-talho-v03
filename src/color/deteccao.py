"""Resolução do perfil de cor de uma mídia a partir das tags do FFprobe (Fase 0).

O que este módulo resolve, e por que ele existe separado do ffmpeg.py: as tags
que o FFprobe devolve são CRUAS e frequentemente AUSENTES. Medido no acervo em
24/08/2026:

    entrevista-ator-bayard.mov   pix_fmt=yuvj420p  range=pc    primaries=bt709
    MONSTRO_..._handcam.MTS      pix_fmt=yuv420p   range=<sem> primaries=<sem>
    Entrevista-ad-e-atriz.mp4    pix_fmt=yuv420p   range=<sem> primaries=<sem>

Ou seja: a Canon etiqueta full range, a camcorder AVCHD (259 dos 541 vídeos) não
etiqueta nada. Um pipeline que só lê a tag trata metade do acervo como
"desconhecido"; um pipeline que inventa um default trata o silêncio como se
fosse afirmação. Este módulo faz a terceira coisa: resolve um perfil UTILIZÁVEL e
declara de onde ele veio, em campo separado.

    perfil  -> nunca é NULL; é a hipótese de trabalho ('rec709' na dúvida)
    origem  -> 'tag' | 'ausente' | 'heuristica' | 'humano'

Assim nada adivinha em silêncio: quem consome sabe se está diante de um fato ou
de um palpite, e `origem='humano'` sempre vence (a Fase 2 vai permitir corrigir
o perfil na UI, e essa correção não pode ser sobrescrita por uma releitura).

FASE 0 = SÓ TAGS. A heurística por fabricante/codec (que é o que vai salvar os
259 MTS e todo material log de terceiro) é a Fase 2 do plano; o campo `origem`
já existe para recebê-la sem migração nova.
"""
from typing import Any, Dict, Optional, Tuple

# Perfis fechados (valores ASCII estáveis: viram payload de busca e coluna).
PERFIL_PADRAO = "rec709"
PERFIS_CONHECIDOS = (
    "rec709", "srgb", "adobergb", "rec2020", "linear",
    "hlg", "pq",                       # HDR
    "slog3", "logc3", "logc4", "vlog", "nlog", "clog2", "clog3", "redlogfilm",
    "log",                             # log genérico: sabemos que é log, não qual
    "raw",                             # foto RAW: a cor é decidida no demosaico
    "desconhecido",
)

# color_transfer (FFprobe) -> perfil. A função de transferência é o que de fato
# distingue log de display-referred; primaries só dizem a gama de cores.
_TRANSFER_PARA_PERFIL: Dict[str, str] = {
    "bt709": "rec709",
    "bt470m": "rec709",
    "bt470bg": "rec709",
    "smpte170m": "rec709",
    "smpte240m": "rec709",
    "bt1361": "rec709",
    "bt2020-10": "rec2020",
    "bt2020-12": "rec2020",
    "iec61966-2-1": "srgb",
    "iec61966-2-4": "rec709",
    "linear": "linear",
    "smpte2084": "pq",            # HDR10
    "arib-std-b67": "hlg",        # HLG
    "log100": "log",
    "log316": "log",
}

# Formatos de pixel "J" do FFmpeg: legado do MJPEG, significam full range mesmo
# sem tag de range. É a convenção do próprio FFmpeg, não invenção nossa.
_PIX_FMT_FULL_RANGE = ("yuvj420p", "yuvj422p", "yuvj444p", "yuvj440p")


def resolver_range(meta: Dict[str, Any]) -> Tuple[str, str]:
    """(range, origem) do range de luma. 'tv' = limitado (16-235), 'pc' = full.

    Sem tag, o FFmpeg trata yuvj* como full e o resto como limitado -- e é essa
    convenção que já governa os proxies existentes. Repeti-la aqui mantém o banco
    coerente com o que o disco realmente faz.
    """
    declarado = (meta.get("color_range") or "").strip().lower()
    if declarado in ("tv", "limited", "mpeg"):
        return "tv", "tag"
    if declarado in ("pc", "full", "jpeg"):
        return "pc", "tag"

    pix_fmt = (meta.get("pix_fmt") or "").strip().lower()
    if pix_fmt in _PIX_FMT_FULL_RANGE:
        return "pc", "pix_fmt"
    return "tv", "ausente"


def resolver_perfil(meta: Dict[str, Any]) -> Tuple[str, str]:
    """(perfil, origem) a partir das tags. Nunca devolve perfil NULL.

    `meta` é o dict de src.media.ffmpeg.get_media_metadata (ou qualquer dict com
    as mesmas chaves de COLOR_KEYS).
    """
    transfer = (meta.get("color_transfer") or "").strip().lower()
    if transfer:
        perfil = _TRANSFER_PARA_PERFIL.get(transfer)
        if perfil:
            return perfil, "tag"
        # Tag presente mas fora do mapa: é informação real que não sabemos ler.
        # Registrar como desconhecido é melhor que fingir Rec.709.
        return "desconhecido", "tag"

    # Sem transfer: primaries às vezes salva (a Canon etiqueta os três juntos).
    primaries = (meta.get("color_primaries") or "").strip().lower()
    if primaries in ("bt709", "smpte170m", "bt470bg"):
        return "rec709", "tag"
    if primaries in ("bt2020",):
        return "rec2020", "tag"

    # Silêncio total: os 259 MTS e os 3 mp4 do acervo caem aqui.
    return PERFIL_PADRAO, "ausente"


def resolver(meta: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Bloco de cor pronto para gravar no banco, a partir do dict do FFprobe.

    As cinco primeiras colunas guardam a tag CRUA (NULL = o arquivo não declarou);
    só `color_profile`/`color_profile_origem` são interpretação. O range efetivo
    NÃO vira coluna: sai de resolver_range() em tempo de leitura, a partir de
    color_range + pix_fmt que já estão aqui. Coluna derivada é coluna que sai de
    sincronia quando a regra muda.
    """
    perfil, origem = resolver_perfil(meta)
    return {
        "color_range": meta.get("color_range"),
        "color_space": meta.get("color_space"),
        "color_transfer": meta.get("color_transfer"),
        "color_primaries": meta.get("color_primaries"),
        "pix_fmt": meta.get("pix_fmt"),
        "field_order": meta.get("field_order"),
        "color_profile": perfil,
        "color_profile_origem": origem,
    }


# ---------------------------------------------------------------------------
# Fotos
# ---------------------------------------------------------------------------

# Extensoes RAW: nesses arquivos a cor final NAO esta no arquivo, e decidida no
# demosaico (rawpy). Registrar 'raw' e o unico registro honesto -- dizer 'srgb'
# seria descrever o resultado do postprocess, nao o arquivo.
EXTENSOES_RAW = (
    ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".sr2",
    ".dng", ".raf", ".orf", ".rw2", ".pef", ".raw", ".3fr", ".iiq",
)

# EXIF ColorSpace (tag 0xA001): 1 = sRGB, 65535 = Uncalibrated (na pratica quase
# sempre Adobe RGB, sinalizado no InteropIndex 'R03').
_EXIF_COLORSPACE = 0xA001


def resolver_foto(caminho) -> Dict[str, Optional[str]]:
    """(color_profile, color_profile_origem) de uma foto, pela extensao + EXIF.

    Leitura barata de proposito: so cabecalho, sem demosaicar. Medido em
    24/08/2026 sobre o acervo: ~17 ms por CR2. Nunca levanta -- foto ilegivel
    vira 'desconhecido'/'ausente' e a ingestao segue.
    """
    from pathlib import Path
    ext = Path(str(caminho)).suffix.lower()

    if ext in EXTENSOES_RAW:
        return {"color_profile": "raw", "color_profile_origem": "extensao"}

    try:
        from PIL import Image
        with Image.open(str(caminho)) as im:
            exif = im.getexif()
        marcado = exif.get(_EXIF_COLORSPACE) if exif else None
        if marcado == 1:
            return {"color_profile": "srgb", "color_profile_origem": "exif"}
        if marcado == 65535:
            return {"color_profile": "adobergb", "color_profile_origem": "exif"}
    except Exception:
        return {"color_profile": "desconhecido", "color_profile_origem": "ausente"}

    # Sem tag: sRGB e a suposicao universal para JPEG/PNG de camera e celular.
    return {"color_profile": "srgb", "color_profile_origem": "ausente"}


def e_entrelacado(meta: Dict[str, Any]) -> bool:
    """True quando o FFprobe declara campos entrelaçados.

    Fora do escopo do plano de cor -- mas 259 .MTS do acervo são 'tt' e o proxy
    não desentrelaça (seção 9 do PLANO_COR_OCIO.md). O campo é coletado agora
    porque a leitura é a mesma; o tratamento é outro plano.
    """
    return (meta.get("field_order") or "").strip().lower() in ("tt", "bb", "tb", "bt")
