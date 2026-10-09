"""Teste do método "trechos + modelo de visão" em planos-sequência (ideia do NVIDIA VSS, local).

Corta cada take em trechos curtos com sobreposição, manda N quadros de cada trecho ao modelo
de visão configurado no Talho (OpenRouter, com gasto real medido) e pede escala no início e no
fim, movimento de câmera, descrição e se algo mudou. Ao lado, o que o Talho já faz hoje sem
API: escala por CLIP (src/vision/shot_scale.py) e movimento por fluxo óptico
(src/vision/segmentation.classify_motion). Banco só leitura; nada é gravado no banco.

Saída: data/cache/plano_sequencia/teste_<data>.json (+ relatório com
scripts/plano_sequencia_teste_relatorio.py).

Uso:
    .venv\\Scripts\\python.exe scripts\\plano_sequencia_teste.py --plano      (só conta e estima)
    .venv\\Scripts\\python.exe scripts\\plano_sequencia_teste.py [--ids 321,388] [--trecho 8]
        [--passo 6] [--quadros 4] [--teto 1.00] [--limite 5]
"""
import argparse
import base64
import datetime as dt
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import CONFIG  # noqa: E402

PASTA = CONFIG.CACHE_DIR / "plano_sequencia"
IDS_PADRAO = [321, 388, 518, 306]  # escolhidos em 07/10/2026 (plano_sequencia_escolha.json)

ESCALAS = ["detalhe", "close", "plano_medio", "plano_americano", "plano_geral", "aereo"]
MOVIMENTOS = ["parado", "pan", "tilt", "zoom_in", "zoom_out", "dolly_in", "dolly_out",
              "travelling_lateral", "orbita", "grua", "caminhando", "na_mao", "chicote"]
QUALIDADES = ["boa", "tremida", "fora_de_foco", "escura", "obstruida"]

PROMPT = """Você recebe {n} quadros, em ordem, de um trecho de {dur:.0f} s ({ini} a {fim}) de um take
contínuo (plano-sequência, sem cortes) do making of de um filme. Os quadros estão espaçados por
igual dentro do trecho. Analise o trecho como cinematografia, não só o conteúdo.

Escalas de plano (pela pessoa ou objeto principal):
- detalhe: objeto ou parte do corpo enche o quadro
- close: rosto (até os ombros)
- plano_medio: da cintura para cima
- plano_americano: dos joelhos para cima
- plano_geral: corpo inteiro ou ambiente amplo, pessoas pequenas
- aereo: vista de drone ou de muito alto

Movimentos de câmera: {movimentos}.
"na_mao" = câmera na mão sem direção clara; "caminhando" = o operador se desloca andando;
"chicote" = giro muito rápido que borra a imagem.

Responda SÓ um JSON, sem texto fora dele:
{{"escala_inicio": "<escala no 1º quadro>", "escala_fim": "<escala no último quadro>",
  "movimento": "<movimento dominante>", "movimento_obs": "<até 8 palavras: direção, ritmo>",
  "descricao": "<1 frase em português do que acontece no trecho>",
  "assunto": "<quem ou o que está em foco>", "pessoas": <número de pessoas visíveis>,
  "local": "<ambiente em até 4 palavras>",
  "mudanca": <true se o ambiente ou o assunto principal muda dentro do trecho>,
  "qualidade": "<{qualidades}>", "confianca": <0 a 1 na escala e no movimento>}}"""


def _tempo(s: float) -> str:
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d}"


def _trechos(duracao: float, tam: float, passo: float) -> List[Dict[str, float]]:
    saida, ini = [], 0.0
    while ini < duracao - 1.0:
        fim = min(ini + tam, duracao)
        saida.append({"inicio": round(ini, 2), "fim": round(fim, 2)})
        if fim >= duracao:
            break
        ini += passo
    return saida


def _quadros(cap, ini: float, fim: float, n: int) -> List[np.ndarray]:
    saida = []
    for k in range(n):
        t = ini + (fim - ini) * (k + 0.5) / n
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, f = cap.read()
        if ok:
            saida.append(f)
    return saida


def _b64(f: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", cv2.resize(f, (640, 360)), [cv2.IMWRITE_JPEG_QUALITY, 82])
    return base64.b64encode(buf.tobytes()).decode("ascii")


class Local:
    """Escala por CLIP (mesmo classificador do Talho), carregado uma vez."""

    def __init__(self):
        from sentence_transformers import SentenceTransformer
        from src.vision.shot_scale import ShotScaleClassifier
        self.img = SentenceTransformer("clip-ViT-B-32", device="cpu")
        self.cls = ShotScaleClassifier.get_instance()

    def escala(self, f: np.ndarray):
        from PIL import Image
        vec = self.img.encode(Image.fromarray(f[:, :, ::-1]))
        rot, score = self.cls.classify(vec)
        return rot, round(score, 3)


def _normalizar(r: Dict[str, Any]) -> Dict[str, Any]:
    def um(v, opcoes):
        v = str(v or "").strip().lower().replace(" ", "_").replace("-", "_")
        return v if v in opcoes else (v or None)
    try:
        conf = float(r.get("confianca"))
    except (TypeError, ValueError):
        conf = None
    try:
        pessoas = int(r.get("pessoas"))
    except (TypeError, ValueError):
        pessoas = None
    return {
        "escala_inicio": um(r.get("escala_inicio"), ESCALAS), "escala_fim": um(r.get("escala_fim"), ESCALAS),
        "movimento": um(r.get("movimento"), MOVIMENTOS), "movimento_obs": str(r.get("movimento_obs") or "").strip(),
        "descricao": str(r.get("descricao") or "").strip(), "assunto": str(r.get("assunto") or "").strip(),
        "pessoas": pessoas, "local": str(r.get("local") or "").strip(),
        "mudanca": bool(r.get("mudanca")), "qualidade": um(r.get("qualidade"), QUALIDADES), "confianca": conf,
    }


def executar(videos, args) -> Dict[str, Any]:
    from src.services import pipeline as P
    from src.services.settings_service import SettingsService
    from src.vision.segmentation import classify_motion

    S = SettingsService.get_settings(None)
    modelo = S.get("llm.vision_model")
    local = Local()
    chamadas: List[Dict[str, Any]] = []
    P.OBSERVADORES_DE_USO.append(chamadas.append)
    gasto, saida = 0.0, []
    try:
        for v in videos:
            proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{v['id']}.mp4"
            cap = cv2.VideoCapture(str(proxy))
            trechos = _trechos(v["duracao"], args.trecho, args.passo)
            if args.limite:
                trechos = trechos[:args.limite]
            print(f"\n#{v['id']} {v['arquivo']} · {_tempo(v['duracao'])} · {len(trechos)} trechos")
            resultado = []
            for i, tr in enumerate(trechos, 1):
                if gasto >= args.teto:
                    print(f"Teto de US$ {args.teto:.2f} atingido (US$ {gasto:.4f}); parando.")
                    break
                fs = _quadros(cap, tr["inicio"], tr["fim"], args.quadros)
                if not fs:
                    continue
                ini_t = time.perf_counter()
                # Talho hoje, sem API
                esc_ini, sc_ini = local.escala(fs[0])
                esc_fim, sc_fim = local.escala(fs[-1])
                mov_local = classify_motion(proxy, tr["inicio"], tr["fim"])
                # Modelo de visão
                prompt = PROMPT.format(n=len(fs), dur=tr["fim"] - tr["inicio"], ini=_tempo(tr["inicio"]),
                                       fim=_tempo(tr["fim"]), movimentos=", ".join(MOVIMENTOS),
                                       qualidades=" | ".join(QUALIDADES))
                antes = len(chamadas)
                bruto = P.PipelineService.call_openrouter_vision_multi([_b64(f) for f in fs], prompt)
                usos = chamadas[antes:]
                custo = sum(float((u["uso"] or {}).get("cost") or 0) for u in usos)
                gasto += custo
                vlm = _normalizar(bruto) if bruto else None
                resultado.append({
                    **tr, "vlm": vlm, "erro": None if bruto else "sem resposta",
                    "local": {"escala_inicio": esc_ini, "escala_inicio_score": sc_ini,
                              "escala_fim": esc_fim, "escala_fim_score": sc_fim, "movimento": mov_local},
                    "custo_usd": round(custo, 6), "modelo": usos[-1]["modelo"] if usos else None,
                    "tokens_entrada": sum(int((u["uso"] or {}).get("prompt_tokens") or 0) for u in usos),
                    "tokens_saida": sum(int((u["uso"] or {}).get("completion_tokens") or 0) for u in usos),
                    "segundos": round(time.perf_counter() - ini_t, 1),
                })
                if vlm:
                    print(f"  {i:3d} {_tempo(tr['inicio'])}-{_tempo(tr['fim'])} "
                          f"{vlm['escala_inicio']}→{vlm['escala_fim']} {vlm['movimento']} | "
                          f"local {esc_ini}→{esc_fim} {mov_local} | US$ {custo:.5f} | {vlm['descricao'][:70]}")
                else:
                    print(f"  {i:3d} {_tempo(tr['inicio'])} sem resposta")
            cap.release()
            saida.append({**v, "trechos": resultado})
    finally:
        P.OBSERVADORES_DE_USO.remove(chamadas.append)
    return {"modelo": modelo, "gasto_usd": round(gasto, 5), "videos": saida}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default=",".join(map(str, IDS_PADRAO)))
    ap.add_argument("--trecho", type=float, default=8.0, help="duração do trecho em s")
    ap.add_argument("--passo", type=float, default=6.0, help="início de um trecho ao próximo (s)")
    ap.add_argument("--quadros", type=int, default=4)
    ap.add_argument("--teto", type=float, default=1.00, help="para ao passar deste gasto (US$)")
    ap.add_argument("--limite", type=int, default=0, help="só os N primeiros trechos de cada vídeo")
    ap.add_argument("--plano", action="store_true", help="só conta trechos, sem chamar a API")
    args = ap.parse_args(argv)

    ids = [int(x) for x in args.ids.split(",")]
    conn = sqlite3.connect(f"file:{CONFIG.DB_PATH.as_posix()}?mode=ro", uri=True)
    videos = []
    for vid in ids:
        r = conn.execute("SELECT id, filename, filepath, duration, title FROM video WHERE id = ?", (vid,)).fetchone()
        videos.append({"id": r[0], "arquivo": r[1], "caminho": r[2], "duracao": r[3], "titulo": r[4]})
    conn.close()

    n = sum(len(_trechos(v["duracao"], args.trecho, args.passo)[:args.limite or None]) for v in videos)
    print(f"{len(videos)} vídeos · {n} trechos de {args.trecho:.0f} s a cada {args.passo:.0f} s · "
          f"{args.quadros} quadros por trecho = {n * args.quadros} imagens")
    if args.plano:
        return 0

    PASTA.mkdir(parents=True, exist_ok=True)
    gerado = dt.datetime.now().isoformat(timespec="minutes")
    dados = {"gerado_em": gerado, "parametros": vars(args), **executar(videos, args)}
    destino = PASTA / f"teste_{gerado.replace(':', '').replace('T', '_')}.json"
    destino.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nGasto real: US$ {dados['gasto_usd']:.4f} · modelo {dados['modelo']}\nResultado: {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
