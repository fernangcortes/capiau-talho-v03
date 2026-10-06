"""Detectores de objetos por vocabulário aberto, escolhidos em ``object.detector_engine``.

Todo motor recebe uma imagem e a lista de classes (em português, como em
``object.classes_filter``) e devolve caixas no padrão canônico do projeto:
[ymin, xmin, ymax, xmax] inteiros 0-1000 (ver spatial_grounding.py).

Motores:
- yolo_world      Ultralytics YOLO-World v2 (yolov8s-worldv2 + CLIP ViT-B/32), CPU
- owlv2           google/owlv2-base-patch16-ensemble (transformers), CPU
- grounding_dino  IDEA-Research/grounding-dino-tiny (transformers), CPU
- florence_2      florence-community/Florence-2-base (transformers), CPU; sem confiança
- gemini_spatial  Gemini pela OpenRouter (caixas 0-1000 nativas do Gemini), nuvem
- dino_x          DINO-X (DeepDataSpace), nuvem -- sem chave ainda: indisponível

Os modelos locais foram treinados com rótulos em inglês: a classe vai traduzida
(TRADUCAO_CLASSES) e volta com o nome em português. Classe sem tradução vai
como está, com aviso. Nada aqui inventa caixa ou confiança: Florence-2 não
informa confiança e a caixa sai com ``confidence=None``.
"""
from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from src.vision.spatial_grounding import clamp_gemini_box, pixel_to_gemini_box

MOTOR_YOLO_WORLD = "yolo_world"
MOTOR_OWLV2 = "owlv2"
MOTOR_GROUNDING_DINO = "grounding_dino"
MOTOR_FLORENCE_2 = "florence_2"
MOTOR_GEMINI = "gemini_spatial"
MOTOR_DINO_X = "dino_x"

MODELO_YOLO_WORLD = "yolov8s-worldv2.pt"
MODELO_OWLV2 = "google/owlv2-base-patch16-ensemble"
MODELO_GROUNDING_DINO = "IDEA-Research/grounding-dino-tiny"
MODELO_FLORENCE_2 = "florence-community/Florence-2-base"
MODELO_GEMINI_PADRAO = "google/gemini-2.5-flash"

EXECUCAO = {MOTOR_YOLO_WORLD: "local_cpu", MOTOR_OWLV2: "local_cpu", MOTOR_GROUNDING_DINO: "local_cpu",
            MOTOR_FLORENCE_2: "local_cpu", MOTOR_GEMINI: "cloud_api", MOTOR_DINO_X: "cloud_api"}

# Português (como o usuário escreve) -> inglês (como os modelos locais entendem).
TRADUCAO_CLASSES = {
    "camera": "camera", "câmera": "camera", "câmeras": "camera",
    "microfone boom": "boom microphone", "boom": "boom microphone", "microfone": "microphone",
    "microfone de lapela": "lavalier microphone", "lapela": "lavalier microphone",
    "claquete": "clapperboard", "monitor": "monitor", "tripé": "tripod", "tripe": "tripod",
    "figurino": "costume", "prop": "prop", "adereço": "prop", "objeto de cena": "prop",
    "refletor": "studio light", "luz": "studio light", "rebatedor": "reflector board",
    "pessoa": "person", "carro": "car", "celular": "mobile phone", "notebook": "laptop",
    "cadeira": "chair", "mesa": "table", "garrafa": "bottle", "chapéu": "hat", "óculos": "glasses",
    "revólver": "revolver", "arma": "gun", "faca": "knife", "livro": "book", "copo": "cup",
}


# Categoria da tabela detected_object para as classes conhecidas; o resto vira 'outro'.
CATEGORIA_CLASSES = {
    **dict.fromkeys(["camera", "câmera", "câmeras", "microfone boom", "boom", "microfone", "microfone de lapela",
                     "lapela", "claquete", "monitor", "tripé", "tripe", "refletor", "luz", "rebatedor"], "equipamento"),
    **dict.fromkeys(["figurino", "chapéu", "óculos"], "figurino"),
    **dict.fromkeys(["prop", "adereço", "objeto de cena", "revólver", "arma", "faca", "livro", "copo", "garrafa"], "prop_cena"),
    "carro": "veiculo",
}
# A coluna confidence é NOT NULL; caixa sem confiança informada (Florence-2) grava este valor.
CONFIANCA_NAO_INFORMADA = -1.0


def categoria_da_classe(label: str) -> str:
    return CATEGORIA_CLASSES.get(label.lower(), "outro")


class DetectorIndisponivel(RuntimeError):
    """O detector pedido não pode rodar agora. A mensagem diz por quê."""


@dataclass
class Deteccao:
    label: str                      # nome em português (da lista do usuário)
    box: List[int]                  # [ymin, xmin, ymax, xmax] 0-1000
    confidence: Optional[float]     # None quando o modelo não informa (Florence-2)


@dataclass
class ResultadoDeteccao:
    motor: str
    modelo: str
    deteccoes: List[Deteccao]
    latencia_ms: float
    avisos: List[str] = field(default_factory=list)


def classes_da_configuracao(texto: str) -> List[str]:
    return [c.strip() for c in (texto or "").split(",") if c.strip()]


def traduzir_classes(classes_pt: List[str]) -> Tuple[List[str], Dict[str, str], List[str]]:
    """(lista em inglês, mapa inglês->português, avisos)."""
    en, volta, avisos = [], {}, []
    for c in classes_pt:
        t = TRADUCAO_CLASSES.get(c.lower())
        if t is None:
            t = c
            avisos.append(f"Classe '{c}' sem tradução para inglês; os detectores locais recebem como está.")
        if t not in volta:
            en.append(t)
            volta[t] = c
    return en, volta, avisos


# -- Carga de modelos (uma vez por processo) ------------------------------------------

def _exigir(modelo_id: str) -> None:
    """Modelo fora da máquina vira DetectorIndisponivel com tamanho e onde baixar."""
    from src.services.modelos_locais import ModeloNaoBaixado, exigir
    try:
        exigir(modelo_id)
    except ModeloNaoBaixado as e:
        raise DetectorIndisponivel(str(e)) from e


_modelos: Dict[str, Any] = {}
_trava = threading.Lock()


def _modelo(chave: str, carregar: Callable[[], Any]) -> Any:
    with _trava:
        if chave not in _modelos:
            try:
                _modelos[chave] = carregar()
            except DetectorIndisponivel:
                raise
            except ImportError as e:
                raise DetectorIndisponivel(f"pacote ausente para {chave}: {e.name}") from e
            except Exception as e:
                raise DetectorIndisponivel(f"falha ao carregar {chave}: {e}") from e
        return _modelos[chave]


def _abrir_imagem(caminho: Path):
    from PIL import Image
    return Image.open(caminho).convert("RGB")


def _caixa(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> List[int]:
    """Pixels (x1, y1, x2, y2) -> canônico [ymin, xmin, ymax, xmax] 0-1000."""
    return pixel_to_gemini_box([x1, y1, x2, y2], w, h, order="xmin_ymin_xmax_ymax")


# -- Motores locais ------------------------------------------------------------------------

# A Ultralytics guarda a configuração num arquivo global da máquina (AppData), onde
# weights_dir pode ser relativo -- os pesos caíam na pasta em que o processo rodou,
# inclusive dentro do repo -- e sync=True manda estatísticas de uso para ela.
# O CapIAu usa uma configuração só dele, sem tocar no arquivo global.
PASTA_ULTRALYTICS = Path(os.getenv("CAPIAU_ULTRALYTICS_DIR") or Path.home() / ".cache" / "capiau" / "ultralytics")


def _carregar_yolo_world(permitir_download: bool = False):
    """Carrega o YOLO-World. Só baixa pesos com ``permitir_download`` (botão em Modelos locais)."""
    if not permitir_download:
        _exigir("yolo_world")
    os.environ.setdefault("YOLO_CONFIG_DIR", str(PASTA_ULTRALYTICS))  # antes do 1o import da ultralytics
    pesos = PASTA_ULTRALYTICS / "weights"
    pesos.mkdir(parents=True, exist_ok=True)
    from ultralytics import YOLOWorld, settings
    settings.update({"weights_dir": str(pesos), "runs_dir": str(PASTA_ULTRALYTICS / "runs"), "sync": False})
    import ultralytics.nn.text_model as texto
    texto.WEIGHTS_DIR = pesos  # constante lida no import; o CLIP baixa para WEIGHTS_DIR/clip
    return YOLOWorld(str(pesos / MODELO_YOLO_WORLD))


def _yolo_world(img_path: Path, classes_en: List[str], volta: Dict[str, str], min_conf: float):
    def carregar():
        return _carregar_yolo_world()
    modelo = _modelo(MOTOR_YOLO_WORLD, carregar)
    with _trava:  # set_classes muda o estado do modelo compartilhado
        modelo.set_classes(classes_en)
        res = modelo.predict(str(img_path), conf=min_conf, device="cpu", verbose=False)[0]
    h, w = res.orig_shape
    nomes = res.names
    saida = []
    for (x1, y1, x2, y2), conf, cls in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist(), res.boxes.cls.tolist()):
        en = nomes[int(cls)]
        saida.append(Deteccao(volta.get(en, en), _caixa(x1, y1, x2, y2, w, h), round(float(conf), 4)))
    return saida, f"ultralytics {MODELO_YOLO_WORLD}"


def _owlv2(img_path: Path, classes_en: List[str], volta: Dict[str, str], min_conf: float):
    import torch

    def carregar():
        from transformers import Owlv2ForObjectDetection, Owlv2Processor
        _exigir("owlv2")
        return (Owlv2Processor.from_pretrained(MODELO_OWLV2, local_files_only=True),
                Owlv2ForObjectDetection.from_pretrained(MODELO_OWLV2, local_files_only=True).eval())
    proc, modelo = _modelo(MOTOR_OWLV2, carregar)
    img = _abrir_imagem(img_path)
    w, h = img.size
    textos = [f"a photo of a {c}" for c in classes_en]
    inputs = proc(text=[textos], images=img, return_tensors="pt")
    with torch.inference_mode():
        out = modelo(**inputs)
    # O OWLv2 trabalha num quadrado com preenchimento: a escala é pelo lado maior.
    lado = max(w, h)
    r = proc.post_process_grounded_object_detection(out, threshold=min_conf, target_sizes=[(lado, lado)],
                                                    text_labels=[classes_en])[0]
    saida = []
    for box, score, label in zip(r["boxes"].tolist(), r["scores"].tolist(), r["text_labels"]):
        x1, y1, x2, y2 = box
        saida.append(Deteccao(volta.get(label, label), _caixa(x1, y1, min(x2, w), min(y2, h), w, h), round(float(score), 4)))
    return saida, MODELO_OWLV2


def _grounding_dino(img_path: Path, classes_en: List[str], volta: Dict[str, str], min_conf: float):
    import torch

    def carregar():
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
        _exigir("grounding_dino")
        return (AutoProcessor.from_pretrained(MODELO_GROUNDING_DINO, local_files_only=True),
                AutoModelForZeroShotObjectDetection.from_pretrained(MODELO_GROUNDING_DINO, local_files_only=True).eval())
    proc, modelo = _modelo(MOTOR_GROUNDING_DINO, carregar)
    img = _abrir_imagem(img_path)
    w, h = img.size
    texto = ". ".join(classes_en) + "."
    inputs = proc(images=img, text=texto, return_tensors="pt")
    with torch.inference_mode():
        out = modelo(**inputs)
    r = proc.post_process_grounded_object_detection(out, inputs.input_ids, threshold=min_conf,
                                                    text_threshold=min_conf, target_sizes=[(h, w)])[0]
    rotulos = r.get("text_labels") or r.get("labels")
    saida = []
    for box, score, label in zip(r["boxes"].tolist(), r["scores"].tolist(), rotulos):
        en = _mais_proxima(str(label), classes_en)
        saida.append(Deteccao(volta.get(en, en), _caixa(*box, w, h), round(float(score), 4)))
    return saida, MODELO_GROUNDING_DINO


def _florence_2(img_path: Path, classes_en: List[str], volta: Dict[str, str], min_conf: float):
    import torch

    def carregar():
        from transformers import AutoProcessor, Florence2ForConditionalGeneration
        _exigir("florence_2")
        return (AutoProcessor.from_pretrained(MODELO_FLORENCE_2, local_files_only=True),
                Florence2ForConditionalGeneration.from_pretrained(MODELO_FLORENCE_2, local_files_only=True).eval())
    proc, modelo = _modelo(MOTOR_FLORENCE_2, carregar)
    img = _abrir_imagem(img_path)
    w, h = img.size
    # Uma geração para todas as classes. O modo <OPEN_VOCABULARY_DETECTION> (uma por classe)
    # foi medido: ~175 s por quadro e a imagem inteira como caixa para toda classe.
    tarefa = "<CAPTION_TO_PHRASE_GROUNDING>"
    inputs = proc(text=tarefa + ". ".join(classes_en) + ".", images=img, return_tensors="pt")
    with torch.inference_mode():
        ids = modelo.generate(**inputs, max_new_tokens=256, num_beams=3)
    texto = proc.batch_decode(ids, skip_special_tokens=False)[0]
    r = proc.post_process_generation(texto, task=tarefa, image_size=(w, h)).get(tarefa) or {}
    saida = []
    for label, box in zip(r.get("labels") or [], r.get("bboxes") or []):
        en = _mais_proxima(str(label), classes_en)
        saida.append(Deteccao(volta.get(en, en), _caixa(*box, w, h), None))
    return saida, MODELO_FLORENCE_2


def _mais_proxima(rotulo: str, classes_en: List[str]) -> str:
    """O Grounding DINO devolve o trecho do texto que casou; volta para a classe da lista."""
    rotulo = rotulo.strip().lower()
    for c in classes_en:
        if rotulo == c.lower():
            return c
    for c in classes_en:
        if rotulo in c.lower() or c.lower() in rotulo:
            return c
    return rotulo


# -- Motores de nuvem ----------------------------------------------------------------------

PROMPT_GEMINI = (
    "Detecte na imagem SOMENTE estes objetos: {classes}. Responda só com JSON no formato "
    '{{"objetos": [{{"label": <um dos nomes da lista, exatamente como escrito>, '
    '"box_2d": [ymin, xmin, ymax, xmax], "confidence": <0 a 1>}}]}}, com box_2d em 4 inteiros '
    "normalizados de 0 a 1000. Cada objeto aparece uma vez só; no máximo 30 objetos. "
    'Se nada aparecer: {{"objetos": []}}.'
)


def _gemini(img_path: Path, classes_pt: List[str], min_conf: float, project_id: Optional[int], http: Any = None):
    from src.services.settings_service import SettingsService
    S = SettingsService.get_settings(project_id)
    chave = S.api_key("openrouter")
    if not chave:
        raise DetectorIndisponivel("sem chave da OpenRouter (Configurações > api.openrouter_key)")
    avisos = []
    modelo = S.get("llm.vision_model")
    if not str(modelo).startswith("google/gemini"):
        avisos.append(f"Modelo de visão configurado ({modelo}) não é Gemini; caixas pedidas ao {MODELO_GEMINI_PADRAO}.")
        modelo = MODELO_GEMINI_PADRAO
    b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
    corpo = {"model": modelo, "temperature": 0, "max_tokens": 4096,
             "response_format": {"type": "json_object"}, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT_GEMINI.format(classes=", ".join(classes_pt))},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}]}
    if http is None:
        import requests as http
    try:
        r = http.post("https://openrouter.ai/api/v1/chat/completions", json=corpo, timeout=60,
                      headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"})
    except Exception as e:
        raise DetectorIndisponivel(f"OpenRouter fora do ar ou sem rede: {type(e).__name__}") from e
    if r.status_code != 200:
        raise DetectorIndisponivel(f"OpenRouter respondeu HTTP {r.status_code}: {(r.text or '')[:200].replace(chave, '***')}")
    from src.nlp.json_parser import extract_json_from_markdown
    conteudo = ((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    try:
        itens = extract_json_from_markdown(conteudo)
    except Exception as e:
        raise DetectorIndisponivel(f"Gemini devolveu JSON inválido ({modelo}): {str(e)[:160]}") from e
    if isinstance(itens, dict):
        itens = itens.get("objects") or itens.get("objetos") or []
    if not isinstance(itens, list):
        raise DetectorIndisponivel("Gemini devolveu resposta que não é lista de caixas")
    validas = {c.lower(): c for c in classes_pt}
    saida = []
    for it in itens:
        label = validas.get(str(it.get("label", "")).strip().lower())
        box = it.get("box_2d")
        if not label or not isinstance(box, list) or len(box) != 4:
            continue
        conf = it.get("confidence")
        conf = float(conf) if isinstance(conf, (int, float)) else None
        if conf is not None and conf < min_conf:
            continue
        saida.append(Deteccao(label, clamp_gemini_box(box), conf))
    avisos.append("A confiança do Gemini é declarada pelo próprio modelo, não calibrada.")
    return saida, modelo, avisos


# -- Despacho ------------------------------------------------------------------------------

LOCAIS = {MOTOR_YOLO_WORLD: _yolo_world, MOTOR_OWLV2: _owlv2,
          MOTOR_GROUNDING_DINO: _grounding_dino, MOTOR_FLORENCE_2: _florence_2}
LIGADOS = set(LOCAIS) | {MOTOR_GEMINI}
TODOS = [MOTOR_GEMINI, MOTOR_YOLO_WORLD, MOTOR_OWLV2, MOTOR_GROUNDING_DINO, MOTOR_FLORENCE_2, MOTOR_DINO_X]


def detectar(motor: str, imagem: Path, classes_pt: List[str], min_conf: float = 0.3,
             project_id: Optional[int] = None) -> ResultadoDeteccao:
    """Roda o detector pedido. Indisponível -> DetectorIndisponivel com o motivo."""
    if not classes_pt:
        raise DetectorIndisponivel("lista de classes vazia (Configurações > object.classes_filter)")
    if motor == MOTOR_DINO_X:
        raise DetectorIndisponivel("DINO-X ainda sem chave da DeepDataSpace")
    t0 = time.perf_counter()
    if motor == MOTOR_GEMINI:
        dets, modelo, avisos = _gemini(imagem, classes_pt, min_conf, project_id)
    elif motor in LOCAIS:
        classes_en, volta, avisos = traduzir_classes(classes_pt)
        dets, modelo = LOCAIS[motor](imagem, classes_en, volta, min_conf)
        if motor == MOTOR_FLORENCE_2:
            avisos.append("O Florence-2 não informa confiança e põe uma caixa para cada classe pedida, "
                          "esteja o objeto na cena ou não.")
        if motor == MOTOR_YOLO_WORLD and min_conf > 0.15:
            avisos.append(f"O YOLO-World dá notas baixas (em geral 0,05 a 0,3); com mínimo {min_conf:.2f} quase nada passa.")
    else:
        raise DetectorIndisponivel(f"detector '{motor}' não existe")
    return ResultadoDeteccao(motor=motor, modelo=modelo, deteccoes=dets,
                             latencia_ms=round((time.perf_counter() - t0) * 1000.0, 1), avisos=avisos)
