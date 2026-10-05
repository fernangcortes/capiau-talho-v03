"""Compara os detectores de objetos nos mesmos quadros e gera uma folha de contato HTML.

Não grava no banco. Para cada vídeo extrai um quadro (no meio, ou em --pos),
roda cada detector com as classes de object.classes_filter e desenha as caixas.
Sem gabarito humano: a folha existe para julgar a olho, e a tabela mostra
tempo, número de caixas e quanto cada detector concorda com os outros (IoU >= 0,5).

Uso:
    set PYTHONPATH=. && .venv\\Scripts\\python.exe scripts\\detectores_comparar.py --ids 25,31,57 --classes "câmera,tripé,microfone boom,pessoa"
    (--ids some: pega --n vídeos de --project com categoria 'processo')
Saída: data/cache/detectores_comparacao/relatorio.html
"""
import argparse
import base64
import html
import io
import statistics
from collections import defaultdict
from pathlib import Path

from src.config import CONFIG
from src.db.connection import get_db
from src.media.ffmpeg import extract_frame
from src.services.settings_service import SettingsService
from src.vision.detectores import TODOS, DetectorIndisponivel, classes_da_configuracao, detectar
from src.vision.spatial_grounding import calculate_box_iou

SAIDA = CONFIG.CACHE_DIR / "detectores_comparacao"
CORES = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#a8c686", "#8e44ad", "#16a085", "#d35400"]


def selecionar(project_id: int, n: int) -> list:
    with get_db() as conn:
        return [r["id"] for r in conn.execute(
            "SELECT id FROM video WHERE project_id = ? AND category = 'processo' ORDER BY id LIMIT ?", (project_id, n))]


def miniatura_b64(caminho: Path, largura: int = 480) -> str:
    from PIL import Image
    img = Image.open(caminho).convert("RGB")
    img.thumbnail((largura, largura * 4))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def svg_caixas(deteccoes, cor_de) -> str:
    partes = []
    for d in deteccoes:
        y1, x1, y2, x2 = d.box
        cor = cor_de(d.label)
        conf = "" if d.confidence is None else f" {d.confidence:.2f}"
        partes.append(
            f'<rect x="{x1}" y="{y1}" width="{x2 - x1}" height="{y2 - y1}" fill="none" stroke="{cor}" stroke-width="5"/>'
            f'<text x="{x1 + 6}" y="{max(y1 + 30, 30)}" fill="{cor}" font-size="30" font-weight="700" '
            f'paint-order="stroke" stroke="#000" stroke-width="5">{html.escape(d.label)}{conf}</text>')
    return ('<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="caixas">' + "".join(partes) + "</svg>")


def concordancia(deteccoes_por_motor: dict, motor: str) -> float:
    """Fração das caixas deste motor que algum outro motor também achou (mesma classe, IoU >= 0,5)."""
    minhas = deteccoes_por_motor.get(motor) or []
    if not minhas:
        return float("nan")
    outras = [d for m, ds in deteccoes_por_motor.items() if m != motor for d in ds]
    batem = sum(1 for d in minhas if any(o.label == d.label and calculate_box_iou(o.box, d.box) >= 0.5 for o in outras))
    return batem / len(minhas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--project", type=int, default=2)
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--pos", type=float, default=0.5, help="posição do quadro (0-1)")
    ap.add_argument("--classes", default="", help="padrão: object.classes_filter")
    ap.add_argument("--min-conf", type=float, default=0.3)
    ap.add_argument("--min-conf-yolo", type=float, default=0.08,
                    help="o YOLO-World dá notas numa escala mais baixa que os outros")
    ap.add_argument("--motores", default=",".join(TODOS))
    args = ap.parse_args()

    S = SettingsService.get_settings(args.project)
    classes = classes_da_configuracao(args.classes or S.get("object.classes_filter"))
    motores = [m.strip() for m in args.motores.split(",") if m.strip()]
    ids = [int(x) for x in args.ids.split(",") if x.strip()] or selecionar(args.project, args.n)
    SAIDA.mkdir(parents=True, exist_ok=True)
    cores = {c: CORES[i % len(CORES)] for i, c in enumerate(classes)}

    tempos, contagens, concord, falhas, avisos = defaultdict(list), defaultdict(int), defaultdict(list), {}, set()
    linhas_html = []
    for vid in ids:
        with get_db() as conn:
            v = conn.execute("SELECT filepath, duration, filename FROM video WHERE id = ?", (vid,)).fetchone()
        if not v:
            continue
        quadro = SAIDA / f"{vid}.jpg"
        if not quadro.exists() and not extract_frame(Path(v["filepath"]), (v["duration"] or 1) * args.pos, quadro):
            print(f"#{vid}: sem quadro")
            continue
        b64 = miniatura_b64(quadro)
        por_motor, celulas = {}, []
        for m in motores:
            try:
                minimo = args.min_conf_yolo if m == "yolo_world" else args.min_conf
                r = detectar(m, quadro, classes, minimo, args.project)
            except DetectorIndisponivel as e:
                falhas[m] = str(e)
                celulas.append(f'<figure><div class="quadro vazio">indisponível</div><figcaption><b>{m}</b> {html.escape(str(e))}</figcaption></figure>')
                continue
            por_motor[m] = r.deteccoes
            tempos[m].append(r.latencia_ms)
            contagens[m] += len(r.deteccoes)
            avisos.update(r.avisos)
            print(f"#{vid} {m:<15} {r.latencia_ms:8.0f} ms  {len(r.deteccoes)} caixa(s)")
            celulas.append(
                f'<figure><div class="quadro"><img src="data:image/jpeg;base64,{b64}" alt="">'
                f'{svg_caixas(r.deteccoes, lambda c: cores.get(c, "#fff"))}</div>'
                f'<figcaption><b>{m}</b> {len(r.deteccoes)} caixa(s), {r.latencia_ms / 1000:.1f} s</figcaption></figure>')
        for m in por_motor:
            c = concordancia(por_motor, m)
            if c == c:  # não é NaN
                concord[m].append(c)
        linhas_html.append(f'<section><h2>#{vid} <small>{html.escape(v["filename"])}</small></h2>'
                           f'<div class="grade">{"".join(celulas)}</div></section>')

    tabela = "".join(
        f"<tr><td>{m}</td><td>{statistics.median(tempos[m]) / 1000:.1f} s</td><td>{contagens[m]}</td>"
        f"<td>{(f'{statistics.mean(concord[m]) * 100:.0f}%' if concord[m] else '—')}</td></tr>" if tempos[m] else
        f"<tr><td>{m}</td><td colspan=3>indisponível: {html.escape(falhas.get(m, '?'))}</td></tr>"
        for m in motores) if motores else ""
    legenda = " ".join(f'<span style="color:{c}">■ {html.escape(k)}</span>' for k, c in cores.items())
    pagina = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Detectores lado a lado</title>
<style>
:root{{--fundo:#f6f5f2;--texto:#1d1d1b;--suave:#6b6b66;--linha:#d9d7d0}}
@media (prefers-color-scheme:dark){{:root{{--fundo:#161615;--texto:#ecebe7;--suave:#9a9993;--linha:#33332f}}}}
body{{margin:0;padding:16px;background:var(--fundo);color:var(--texto);font:14px/1.45 system-ui,sans-serif}}
h1{{font-size:20px;margin:0 0 4px}} h2{{font-size:15px;margin:24px 0 8px}} small{{color:var(--suave);font-weight:400}}
table{{border-collapse:collapse;margin:12px 0}} td,th{{border-bottom:1px solid var(--linha);padding:4px 12px 4px 0;text-align:left}}
.grade{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}}
figure{{margin:0}} figcaption{{font-size:12px;color:var(--suave);margin-top:4px}}
.quadro{{position:relative;line-height:0}} .quadro img{{width:100%;height:auto;display:block}}
.caixas{{position:absolute;inset:0;width:100%;height:100%}}
.vazio{{aspect-ratio:16/9;display:grid;place-items:center;border:1px dashed var(--linha);line-height:1.4;color:var(--suave)}}
ul{{color:var(--suave);font-size:12px}}
</style></head><body>
<h1>Detectores lado a lado</h1>
<p>Classes: {legenda} · confiança mínima {args.min_conf:.2f} (YOLO-World {args.min_conf_yolo:.2f}) · sem gabarito humano</p>
<table><tr><th>detector</th><th>tempo mediano</th><th>caixas</th><th>achadas também por outro</th></tr>{tabela}</table>
<ul>{"".join(f"<li>{html.escape(a)}</li>" for a in sorted(avisos))}</ul>
{"".join(linhas_html)}
</body></html>"""
    destino = SAIDA / "relatorio.html"
    destino.write_text(pagina, encoding="utf-8")
    print(f"\nRelatório: {destino}")


if __name__ == "__main__":
    main()
