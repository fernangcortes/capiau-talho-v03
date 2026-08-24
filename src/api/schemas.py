"""Modelos Pydantic unificados para validação de requisições e respostas da API."""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class ProjectCreate(BaseModel):
    name: str
    description: str = ""

class ProjectDriveLinkUpdate(BaseModel):
    drive_link: str

class ProjectExportOptions(BaseModel):
    include_metadata: bool = True
    include_proxies: bool = False
    include_photos: bool = False
    include_docs: bool = False

class ExternalPathIngest(BaseModel):
    path: str
    project_id: int = 1

class CategoryUpdate(BaseModel):
    category: str
    note: str = ""  # observação opcional do porquê (vira contexto few-shot no E2.C3)

class TitleUpdate(BaseModel):
    title: str

class CutItem(BaseModel):
    video_id: Optional[int] = None          # obrigatório para type='video'; None para fotos
    type: str = "video"                     # 'video' | 'photo' (discriminador de mídia)
    photo_id: Optional[int] = None          # preenchido quando type='photo' (still)
    in_time: float  # mapeado de 'in' por ser palavra reservada
    out_time: float # mapeado de 'out'
    track: str = "V1"
    timeline_start: Optional[float] = None  # posição absoluta na timeline (segundos, formato v2)
    id: Optional[str] = None                # id estável do clipe no frontend
    link_id: Optional[str] = None           # vínculo A/V: par vídeo+áudio compartilham o mesmo link_id
    effects: Optional[List[Dict[str, Any]]] = None       # efeitos MLT aplicados (fade, volume, speed...)
    alternatives: Optional[List[Dict[str, Any]]] = None  # candidatos do carrossel de alternativas da IA
    origin: Optional[str] = None                          # "user" | "ai"

class TrackItem(BaseModel):
    id: str
    name: str = ""
    kind: str = "video"  # 'video' | 'audio' | 'ai'
    order: int = 0
    volume: float = 1.0
    muted: bool = False
    locked: bool = False
    magnetic: bool = False

class TimelineCreate(BaseModel):
    name: str
    description: str = ""
    cuts: List[CutItem]
    project_id: int = 1
    tracks: Optional[List[TrackItem]] = None  # formato v2 multipista
    fps: float = 24.0
    width: Optional[int] = 1920
    height: Optional[int] = 1080

class TimelineAISuggestClip(BaseModel):
    id: str
    video_id: Optional[int] = None
    type: str = "video"                     # 'video' | 'photo'
    photo_id: Optional[int] = None
    in_s: float
    out_s: float
    timeline_start_s: float = 0.0
    track: str = "V1"
    link_id: Optional[str] = None
    origin: Optional[str] = "user"
    alternatives: Optional[List[Dict[str, Any]]] = None
    effects: Optional[List[Dict[str, Any]]] = None  # preserva efeitos ao passar pelo agente

class TimelineAISuggestPayload(BaseModel):
    project_id: int = 1
    persona: str = "diretora"
    fps: float = 24.0
    brief: str = ""
    clips: List[TimelineAISuggestClip]
    tracks: List[TrackItem] = []

class LabelFacePayload(BaseModel):
    name: str

class SplitTranscriptPayload(BaseModel):
    start_time: float
    new_speaker_id: str

class ChatPayload(BaseModel):
    message: str
    history: List[Dict[str, str]] = []
    # Fase 1: Snapshot da timeline para o agente de edição
    clips: Optional[List[TimelineAISuggestClip]] = None
    tracks: Optional[List[TrackItem]] = None
    fps: float = 24.0
    agent_model: Optional[str] = None
    custom_api_key: Optional[str] = None  # Permite ao usuário passar sua própria chave OpenRouter via UI

class MergeClustersPayload(BaseModel):
    src_cluster_id: int
    dest_cluster_id: int
    name: str

class ReassignFacesPayload(BaseModel):
    face_ids: List[int]
    target_cluster_id: int
    target_name: str

class SearchResultItem(BaseModel):
    id: str
    media_type: str
    text: str

class SearchCategorizePayload(BaseModel):
    query: str
    results: List[SearchResultItem]


class RenameSpeakerPayload(BaseModel):
    old_speaker_id: str
    new_speaker_id: str
    global_rename: bool = False
    start_time: Optional[float] = None
    end_time: Optional[float] = None


class EditDialoguePayload(BaseModel):
    start_time: float
    end_time: float
    new_text: str
    speaker_id: str


class AddThemeSegmentPayload(BaseModel):
    theme_id: int
    project_id: int
    video_id: int
    start_time: float
    end_time: float
    speaker_id: str
    text_excerpt: str


# ── Painel de Configurações da IA ──────────────────────────────────────────

class SettingsUpdatePayload(BaseModel):
    values: Dict[str, Any]  # {"timeline.max_suggestions": 3, ...}


class SettingsResetPayload(BaseModel):
    keys: Optional[List[str]] = None  # None = reset total do escopo


class PresetApplyPayload(BaseModel):
    preset_id: str                    # economico | equilibrado | maxima_qualidade
    scope: str = "global"             # global | project
    project_id: Optional[int] = None


class PromptUpdatePayload(BaseModel):
    template: str
    scope: str = "global"             # global | project
    project_id: Optional[int] = None


# ── Render de vídeo da timeline (docs/PLANO_EXPORTACAO_VIDEO.md, seção 5) ────
# Corpo do POST .../render e .../render/preflight, espelhando modelo.Pedido
# (src/export/video_render/modelo.py, CONTRATO). A montagem do dataclass fica
# NESTE ponto único (pedido_render_do_payload): as rotas não espalham a tradução.

class RenderRangePayload(BaseModel):
    """Faixa a renderizar: timeline inteira ('full') ou trecho IN-OUT."""
    mode: str = "full"
    start_s: Optional[float] = None
    end_s: Optional[float] = None

class RenderOverridesPayload(BaseModel):
    """Override fino da seção avançada do modal. None = preset manda."""
    resolution: Optional[str] = None
    fps: Optional[float] = None
    container: str = "mp4"
    codec: str = "h264"
    crf: Optional[int] = None
    # Optional, como os vizinhos: o painel manda `null` quando o campo avancado
    # esta vazio, que e o caso NORMAL e significa "usa o do preset". Tipado como
    # int puro, todo preflight de campo vazio voltava 422 -- e o painel traduzia
    # 422 como "motor nao instalado", mandando o usuario procurar defeito no
    # lugar errado. O default de 192 vive em comando.parametros_saida.
    audio_bitrate: Optional[int] = None
    mute_audio: bool = False

class RenderScopePayload(BaseModel):
    """Escolha criativa do editor (o que ELE quer no arquivo).

    REGRA DE PRODUTO: chave AUSENTE em categories/tracks significa LIGADO.
    Por isso os dicts nascem VAZIOS — preencher default False aqui inverteria
    o significado do produto inteiro (modelo.Escopo.categoria_ligada já trata
    ausência como True; P7 do contrato: 'hidden' vira default do escopo).
    """
    categories: Dict[str, bool] = Field(default_factory=dict)
    tracks: Dict[str, bool] = Field(default_factory=dict)

class RenderOutputPayload(BaseModel):
    dir: Optional[str] = None          # None = pasta das Configurações (render.output_dir)
    filename: Optional[str] = None     # None = sugestão <timeline>_<aaaa-mm-dd_hhmm>.<ext>

class RenderPostPayload(BaseModel):
    open_folder: bool = False
    copy_path: bool = False
    save_as: bool = False
    ingest: bool = False

class RenderPedidoPayload(BaseModel):
    """Corpo completo do pedido de render/preflight (seção 5 do plano)."""
    kind: str                          # "draft" | "master" — validado contra modelo.TIPOS_RENDER
    range: RenderRangePayload = Field(default_factory=RenderRangePayload)
    preset: str = "master_1080"
    overrides: RenderOverridesPayload = Field(default_factory=RenderOverridesPayload)
    scope: RenderScopePayload = Field(default_factory=RenderScopePayload)
    output: RenderOutputPayload = Field(default_factory=RenderOutputPayload)
    post: RenderPostPayload = Field(default_factory=RenderPostPayload)
    allow_proxy_fallback: bool = False


def pedido_render_do_payload(timeline_id: int, payload: RenderPedidoPayload) -> "modelo.Pedido":
    """Converte o corpo Pydantic em modelo.Pedido validado — ÚNICO ponto de montagem.

    Erros semânticos (kind desconhecido, IN-OUT invertido, categoria inexistente)
    levantam ValueError com mensagem em português claro; quem chama traduz para
    HTTP 400. Erros de TIPO (start_s string etc.) nem chegam aqui: o Pydantic
    recusa antes com 422.

    O que NÃO fazer aqui, de propósito: preencher categorias/tracks ausentes com
    False (ver docstring de RenderScopePayload) nem clampar a faixa IN-OUT — o
    clamp contra a duração real é trabalho do modelo.Faixa.resolver, que precisa
    da sequência carregada e é reexecutado pela rota.
    """
    from src.export.video_render import modelo

    kind = (payload.kind or "").strip().lower()
    if kind not in modelo.TIPOS_RENDER:
        raise ValueError(
            f"kind inválido: '{payload.kind}'. Use '{modelo.TIPO_DRAFT}' "
            f"(rascunho rápido) ou '{modelo.TIPO_MASTER}' (arquivo final).")

    modo = (payload.range.mode or modelo.MODO_FAIXA_COMPLETA).strip().lower()
    if modo == modelo.MODO_FAIXA_COMPLETA:
        faixa = modelo.Faixa(modo=modelo.MODO_FAIXA_COMPLETA)
    elif modo == modelo.MODO_FAIXA_IN_OUT:
        if payload.range.start_s is None or payload.range.end_s is None:
            raise ValueError("range.mode 'in_out' exige start_s e end_s.")
        inicio, fim = float(payload.range.start_s), float(payload.range.end_s)
        if fim <= inicio:
            raise ValueError(
                f"Faixa IN-OUT invertida ou vazia: end_s ({fim}) precisa ser "
                f"estritamente maior que start_s ({inicio}).")
        if inicio < 0:
            raise ValueError(f"range.start_s não pode ser negativo (recebido {inicio}).")
        faixa = modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=inicio, fim_s=fim)
    else:
        raise ValueError(
            f"range.mode inválido: '{payload.range.mode}'. "
            f"Use '{modelo.MODO_FAIXA_COMPLETA}' ou '{modelo.MODO_FAIXA_IN_OUT}'.")

    # Escopo: copiar como veio. Chave ausente = LIGADO (regra de produto); só os
    # nomes são normalizados (str) e as categorias conferidas contra o contrato.
    categorias = {str(k): bool(v) for k, v in (payload.scope.categories or {}).items()}
    desconhecidas = sorted(set(categorias) - set(modelo.CATEGORIAS))
    if desconhecidas:
        raise ValueError(
            "Categorias de escopo desconhecidas: "
            f"{', '.join(desconhecidas)}. Válidas: {', '.join(modelo.CATEGORIAS)}.")
    pistas = {str(k): bool(v) for k, v in (payload.scope.tracks or {}).items()}

    overrides = payload.overrides.model_dump()

    return modelo.Pedido(
        timeline_id=int(timeline_id),
        kind=kind,
        preset=str(payload.preset or "master_1080"),
        faixa=faixa,
        escopo=modelo.Escopo(categorias=categorias, pistas=pistas),
        overrides=overrides,
        saida=modelo.Saida(diretorio=payload.output.dir, nome_arquivo=payload.output.filename),
        pos=modelo.PosRender(
            abrir_pasta=payload.post.open_folder,
            copiar_caminho=payload.post.copy_path,
            salvar_como=payload.post.save_as,
            ingerir=payload.post.ingest,
        ),
        permitir_fallback_proxy=bool(payload.allow_proxy_fallback),
    )


