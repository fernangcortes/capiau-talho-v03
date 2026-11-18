# Suíte de Regressão do Render — Nível 1 (Frente B)

Suíte determinística de regressão visual, temporal e sonora para o motor de exportação (`src/export/video_render/`), utilizando intermediário **lossless** em vídeo/áudio (`FFV1` nível 3 + `PCM s16le` CFR em `.mkv`) para isolar bugs de filtrograph/timing de artefatos de compressão lossy, além de checagens específicas sobre o MP4 real final (`H.264 + AAC`).

---

## 1. Arquitetura Nível 1 (`FFV1 + PCM s16le` vs MP4 Real)

1. **Intermediário determinístico (`modo="intermediario"`):**
   - Usa `comando.montar_comando(...)` intacto e substitui apenas a cauda de codificação por `-c:v ffv1 -level 3 -c:a pcm_s16le -r <fps> -t <dur> -fps_mode cfr`.
   - Permite inspeção exata quadro a quadro e amostra a amostra via `ffmpeg` (`rawvideo rgb24` e `pcm_f32le`).
2. **Saída real MP4 (`modo="real"`):**
   - Executa a codificação real `libx264` (`yuv420p`) + `aac` (incluindo o fluxo completo de `execucao.executar_agora` e gravação do Video Receipt `.receipt.json`), validando contagem exata de quadros, duração de contêiner e metadados (`color_space`).
3. **Orçamento em disco:**
   - Todo o conjunto versionado em [`midia/`](./midia) + [`referencias/`](./referencias) deve permanecer **`<= 1.5 MB`** no total, com **nenhum arquivo individual > `100 KB`**.
   - Áudios sintéticos (`.wav`) são gerados sob demanda em `tmp_path` durante a execução do `pytest` e **nunca** versionados.
   - Saídas de diagnóstico/candidatas (`_saida/`) ficam em diretório ignorado pelo Git (`.gitignore`).

---

## 2. Mídias Sintéticas e Marcação de 11 Bits ([`fontes.py`](./fontes.py))

Os vídeos sintéticos em [`midia/`](./midia) codificam em cada quadro um **código de barras de 11 bits** (`BARCODE_X0 = 24`, `BARCODE_Y0 = 4`, células de `16x12 px`):

- **Bits `0..9` (MSB):** índice exato do quadro de origem (`0..1023`).
- **Bit `10` (última célula):** identificador da fonte (`0` para fonte A / `barras_a`, `1` para fonte B / `barras_b`) e estimador contínuo de mistura `α(t)` (`ler_alpha_dissolve`) em transições.
- **4 marcadores magenta `(255, 64, 255)` de canto (`8x8 px`):** ancoragem espacial.
- **`foto.png`:** gradiente determinístico `320x180` com 4 marcadores brancos (`8x8`) e 1 marcador central ciano `(0, 255, 255)` em `(159.5, 89.5)` para validação geométrica (`centroide_marcador`) e Ken Burns.

---

## 3. Como Executar

```powershell
# Suíte completa Nível 1
.venv\Scripts\python.exe -m pytest tests/render_regressao -q

# Ou via script npm cadastrado em package.json
npm run test:render:regressao

# Apenas um cenário ou grupo
.venv\Scripts\python.exe -m pytest tests/render_regressao -k canonico -q
.venv\Scripts\python.exe -m pytest tests/render_regressao/test_export_audio.py -q

# Filtrando por marcadores definidos em pytest.ini
.venv\Scripts\python.exe -m pytest tests/render_regressao -m "render_golden and not needs_browser" -q
```

Marcadores configurados em `pytest.ini`:
- `needs_ffmpeg`: exige `ffmpeg` e `ffprobe` no `PATH` (senão faz skip automático).
- `needs_browser`: exige navegador headless utilizável via `src.navegador` (`17_titulo_caixa_desfoque`).
- `render_golden`: suíte Nível 1 completa.
- `paridade`: testes de paridade Nível 2 player × export (desligados por padrão; habilitar com `--paridade` ou `CAPIAU_PARIDADE=1` quando implementados no Estágio 6C).

---

## 4. Fluxo de Referências Douradas e CLI (`scripts/render_regressao.py`)

Nenhuma execução de `pytest` pode gravar em [`referencias/`](./referencias) (guarda estrita em `referencias.exigir_permissao_escrita_referencias`). Toda geração/aprovação passa pela CLI:

```powershell
# Inspecionar impressão digital do ambiente local (FFmpeg buildconf, Python, NumPy, Pillow)
.venv\Scripts\python.exe scripts/render_regressao.py ambiente

# Regenerar mídias sintéticas em tests/render_regressao/midia/
.venv\Scripts\python.exe scripts/render_regressao.py midia [--forcar]

# Renderizar candidata(s) e gerar relatório HTML + diffs em tests/render_regressao/_saida/<cenario>/
.venv\Scripts\python.exe scripts/render_regressao.py gerar --cenario 01_canonico_cascata

# Inspecionar o resultado JSON e caminho do index.html gerado
.venv\Scripts\python.exe scripts/render_regressao.py relatorio --cenario 01_canonico_cascata

# Promover candidata de _saida/ para referencias/ (registra trilha em APROVACOES.jsonl)
.venv\Scripts\python.exe scripts/render_regressao.py aprovar --cenario 01_canonico_cascata --motivo "Referência inicial Estágio 1C" --sim

# Migrar schemas de JSONs de cenários quando necessário
.venv\Scripts\python.exe scripts/render_regressao.py migrar
```

---

## 5. Matriz de Rastreabilidade (Contratos `P1–P8` / Regras NLE × Cenários `01–18`)

| Cenário | Arquivo / Teste | Contratos & Regras Cobertos | Oráculo / Referência |
|---|---|---|---|
| `01_canonico_cascata` | [`test_export_quadros.py`](./test_export_quadros.py) | Composição canônica multipista (`V2` adjustment `soft-light` + fade S-curve sobre dissolve em `V1`), barcodes externos intactos, **P5** (`disabled: true` bypass `max_abs == 0`) | Referência dourada + metamórfico |
| `02_contagem_e_tempo` | [`test_export_saida_real.py`](./test_export_saida_real.py) | Contagem exata CFR (`24/25/29.97/60 fps`), duração ±1 quadro, faixa IN/OUT (`inicio_s/fim_s`), Video Receipt (`.receipt.json`) via `execucao.executar_agora` | `ffprobe` + barcodes + SHA-256 |
| `03_velocidade_reverso_freeze` | [`test_export_quadros.py`](./test_export_quadros.py) | `speed` (`0.5x`, `2.0x`), `reverse`, `is_freeze` (`freeze_time`), **xfail** documentado `REVERSO_UM_QUADRO` (`player.js:4540`) | `oraculos.ids_esperados_sequencia` |
| `04_corte_trim_razor` | [`test_export_quadros.py`](./test_export_quadros.py) | Gap preto inicial, trim `in > 0`, **P4** sobreposição na pista, equivalência metamórfica Razor `[0,4) == [0,2) + [2,4)` | Barcodes + `max_abs == 0` |
| `05_dissolve_dip_handles` | [`test_export_quadros.py`](./test_export_quadros.py) | `video_cross_dissolve` com handles (`α(t)` monotônico), `hard_boundaries` (`tpad=clone`), `video_dip_black`, `video_dip_white` | `ler_alpha_dissolve` + barcodes |
| `06_cor_hd_matriz` | [`test_export_saida_real.py`](./test_export_saida_real.py) | Matriz HD BT.709 SMPTE bars (`smpte_hd_709.mp4`), **xfail** documentado `HD_SEM_ETIQUETA_BT709` em `smpte_hd_semtag.mp4` (Estágio 4A G1a) | Amostragem SMPTE + `ffprobe` |
| `07_ajuste_e_pistas` | [`test_export_quadros.py`](./test_export_quadros.py) | Empilhamento `V3 > V2 > V1`, camada de ajuste escopada com crop + fade, bypass `disabled: true` (**P5**) | Amostras + barcodes + `max_abs == 0` |
| `08_blend_modes` | [`test_export_quadros.py`](./test_export_quadros.py) | Modos W3C (`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `difference`, `soft-light`) com opacidade | `oraculos.blend_w3c_numpy` |
| `09_cor_css` | [`test_export_quadros.py`](./test_export_quadros.py) | Filter Effects CSS em sRGB com grampeamento entre estágios (`brightness`, `contrast`, `saturation`, `hue`, `sepia`, `grayscale`, `blur`) | `oraculos.aplicar_cor_css_numpy` + Laplaciano |
| `10_fade_curvas` | [`test_export_quadros.py`](./test_export_quadros.py) | Curvas paramétricas (`linear`, `s_curve`, `logarithmic`, `exponential`, `equal_power`, `custom` ±0.5) | `oraculos.avaliar_fade_curva` |
| `11_geometria` | [`test_export_quadros.py`](./test_export_quadros.py) | `fit`/`fill`, `scale`, translação `x/y`, rotações `90/180/270/15°`, `crop` inset (ordem CSS) | `oraculos.centroide_marcador` (`<= 1.5 px`) |
| `12_matte_foto_kenburns` | [`test_export_quadros.py`](./test_export_quadros.py) | `color_matte` exato, foto parada, `ken_burns` (`easeInOut` monotônico), **P6** (identidade sem deriva) | RGB + distância entre marcadores |
| `13_audio_ganho_fade_mute` | [`test_export_audio.py`](./test_export_audio.py) | Volume linear / `makeup_db` (±6 dB), fades `linear` / `s_curve`, pista `muted` (**P7**) e `overrides.mute_audio` | RMS em dBFS por janela |
| `14_audio_crossfade` | [`test_export_audio.py`](./test_export_audio.py) | Crossfade `equal_power` (senos `440 -> 1760 Hz` e ruído descorrelacionado), cenários com e sem handles | FFT dominante + RMS na janela |
| `15_audio_jl_cut` | [`test_export_audio.py`](./test_export_audio.py) | Sincronização audiovisual A/V com J-cut (áudio adiantado) e L-cut (áudio atrasado) | `instante_inicio_som_s` (`<= 2 ms`) + barcodes |
| `16_audio_eq_dinamica_gate` | [`test_export_audio.py`](./test_export_audio.py) | Topologia WebAudio E2 (`audio_eq` HPF/low/mid/high, `acompressor`, `agate`) | Rajadas `100/1000/8000 Hz` + degraus dB |
| `17_titulo_caixa_desfoque` | [`test_export_quadros.py`](./test_export_quadros.py) | Captura HTML via `src.navegador` (D1), caixa translúcida, `gblur@tdf` máscara `backdrop-filter`, bypass **P5** | Referência dourada + Laplaciano |
| `18_audio_velocidade_mix_limiter` | [`test_export_audio.py`](./test_export_audio.py) | `speed=2.0` com `pitch_correction` (`atempo` vs `asetrate`), mixagem multipista sob `alimiter` (`-0.2 dBTP`), determinismo (`envelope`/`null`), regra **P3** | FFT + `pico_dbfs` + residual RMS |
