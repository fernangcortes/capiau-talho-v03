"""Acha candidatos a plano-sequência: mede movimento de câmera e variação visual nos proxies.

Só takes brutos de câmera (MVI_, 000xx.MTS, handcam) com mais de 2 min: cada arquivo já é uma
tomada contínua. Amostra 1 quadro/s; movimento = deslocamento global (phaseCorrelate) entre
quadros a 0,2 s; deriva = diferença de histograma HSV a 10 s; escuro = luminância < 25.
Banco só leitura.

Uso:
    .venv\Scripts\python.exe scripts\plano_sequencia_medir.py [saida.json]
    (padrão: data/cache/plano_sequencia/medidas.json)
"""
import sqlite3, sys, io, json, re
from pathlib import Path
import cv2, numpy as np
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data/cache/plano_sequencia/medidas.json'
OUT.parent.mkdir(parents=True, exist_ok=True)
c = sqlite3.connect(f'file:{ROOT/"data/capiau.db"}?mode=ro', uri=True)
rows = c.execute("select id, filename, duration, title from video where duration>120 order by id").fetchall()
rows = [r for r in rows if re.search(r'(MVI_|_\d{5}\.MTS|handcam)', r[1])]
print(len(rows), 'candidatos')
res = []
for vid, fn, dur, title in rows:
    p = ROOT / 'data/proxies' / f'proxy_vid_{vid}.mp4'
    if not p.exists():
        print('sem proxy', vid); continue
    cap = cv2.VideoCapture(str(p)); fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = int(round(fps))          # amostra a cada 1 s
    lag = max(1, int(round(fps/5)))  # par de quadros a 0,2 s
    shifts, hists, lum = [], [], []
    i = 0; prev = None; pending = None
    while True:
        ok = cap.grab()
        if not ok: break
        if i % step == 0 or (pending is not None and i == pending):
            ok, f = cap.retrieve()
            if ok:
                g = cv2.cvtColor(cv2.resize(f, (192, 108)), cv2.COLOR_BGR2GRAY).astype(np.float32)
                if i % step == 0:
                    prev = g; pending = i + lag
                    hsv = cv2.cvtColor(cv2.resize(f, (96, 54)), cv2.COLOR_BGR2HSV)
                    h = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).flatten()
                    hists.append(h / (h.sum() + 1e-6)); lum.append(float(g.mean()))
                else:
                    (dx, dy), resp = cv2.phaseCorrelate(prev, g)
                    shifts.append((abs(dx), abs(dy), resp)); pending = None
        i += 1
    cap.release()
    if len(hists) < 30: continue
    sh = np.array(shifts); mag = np.hypot(sh[:, 0], sh[:, 1])
    moving = float(np.mean(mag > 1.0))           # >1 px em 192 px a cada 0,2 s
    H = np.array(hists)
    d2 = 0.5 * np.abs(H[2:] - H[:-2]).sum(1)      # variação a cada 2 s
    far = 0.5 * np.abs(H[10:] - H[:-10]).sum(1)   # deriva em 10 s
    jumps = int(np.sum(0.5*np.abs(H[1:]-H[:-1]).sum(1) > 0.6))  # possíveis cortes/cobertura de lente
    dark = float(np.mean(np.array(lum) < 25))
    score = moving * float(np.mean(far)) * (1 - dark)
    r = dict(id=vid, fn=fn, dur=round(dur), title=title, moving=round(moving, 2),
             var2=round(float(np.mean(d2)), 3), deriva10=round(float(np.mean(far)), 3),
             saltos=jumps, escuro=round(dark, 2), score=round(score, 4))
    res.append(r); print(json.dumps(r, ensure_ascii=False))
OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
