# Medições do Navegador Headless (`Frente D1` — Spike E0)

> **Canal detectado:** `chrome` (`158.0.8127.37`)
> **GPU:** `Intel(R) UHD Graphics 630` · **Tempo de arranque:** `3756.1 ms`
> **Contexto seguro (`127.0.0.1`):** `True` · **`OfflineAudioContext.audioWorklet`:** `True`
> **Suporte a `HeadlessExperimental.enable` no canal atual:** `False` (`CDPSession.send: Protocol error (HeadlessExperimental.enable): 'HeadlessExperimental.enable' wasn't found`)

## Latência e Tamanho de Captura (`page.screenshot`)

| Resolução | Formato | p50 (ms) | p95 (ms) | Média (ms) | Tamanho médio (bytes) |
|---|---|---:|---:|---:|---:|
| `360p` | `png_alfa` | 33.38 | 43.54 | 35.43 | 8943 |
| `360p` | `jpeg_q85` | 30.75 | 32.79 | 31.06 | 6570 |
| `1080p` | `png_alfa` | 48.45 | 53.55 | 48.75 | 18415 |
| `1080p` | `jpeg_q85` | 32.34 | 47.39 | 34.24 | 17740 |

## Decisão para o Estágio 1C (E0–E3)

- Servidor HTTP local em `127.0.0.1` confirmado como **contexto seguro** (`window.isSecureContext === true`) e compatível com `OfflineAudioContext.audioWorklet` (requisito da Frente A).
- Títulos continuam usando `page.screenshot` com `omit_background=True` (PNG RGBA com alfa fiel) sem perda de paridade pixel a pixel.
- `HeadlessExperimental.beginFrame` permanece fora do caminho padrão (suportado apenas no `chrome-headless-shell` opcional em etapas posteriores).
