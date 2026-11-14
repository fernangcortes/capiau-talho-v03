# Plano de Gerenciamento de Cor (OpenColorIO) — CapIAu-Talho

> Escrito em 24/08/2026. Todas as medições citadas foram feitas nesta data, nesta
> máquina, sobre o acervo real (541 vídeos, 1424 fotos) — não são estimativas.

---

## 1. O que este plano resolve

O Talho hoje trata cor em **duas** camadas e ignora a terceira:

| Camada | Pergunta que responde | Onde vive hoje |
|---|---|---|
| **Técnica** | esse número representa qual luz? | **em lugar nenhum** |
| **Criativa** | essa luz deveria ser qual? | `src/export/video_render/cor.py` + filtro CSS do player |
| **Semântica** | que luz é essa, em português? | `src/vision/palette.py` (só fotos) |

O OpenColorIO **não corrige cor**. Ele é um tradutor de convenções: converte
"esses números estão em S-Log3" para "esses números estão em Rec.709". Não tem
opinião estética, não olha a cena, não decide que está escuro demais.

Este plano constrói a camada técnica embaixo das outras duas — e é justamente
ela que faz as outras pararem de mentir.

### O que este plano NÃO resolve

- Não vai transformar o Talho em Resolve. Ele continua ilha de triagem e corte.
- Não vai rodar rede neural quadro a quadro. Backend é CPU-only (ver seção 9).
- Não vai desentrelaçar os 262 arquivos entrelaçados (`field_order=tt`). Achado durante a
  pesquisa, registrado na seção 9, mas é outro plano.

---

## 2. Evidência medida (24/08/2026)

Estes números são a razão das prioridades. Sem eles, este plano seria uma cópia
do relatório genérico que circula sobre "Premiere 2025 + ACES".

### 2.1 O acervo não tem material log

```
541 vídeos: 279 .mov | 259 .mts | 3 .mp4     — todos h264, 8 bits, 1080p
1424 fotos: 1092 .cr2 (RAW Canon) | 332 .jpg
```

Zero S-Log3, zero LogC, zero V-Log. **A conversa sobre IDT/ACES é sobre o
material que licenciados vão trazer, não sobre o acervo do Monstro.** Ela
importa — mas na Fase 2, não na Fase 1.

Onde gerenciamento de cor morde HOJE: **1092 arquivos CR2**.

### 2.2 Os originais declaram convenções diferentes entre si

```
entrevista-ator-bayard.mov   pix_fmt=yuvj420p  range=pc      primaries=bt709
MONSTRO_..._handcam.MTS      pix_fmt=yuv420p   range=<sem>   primaries=<sem>
Entrevista-ad-e-atriz.mp4    pix_fmt=yuv420p   range=<sem>   primaries=<sem>  field_order=tt
```

Canon `.MOV` grava **full range** e etiqueta; a camcorder AVCHD não etiqueta
nada. Os dois entram no mesmo projeto, na mesma timeline.

### 2.3 Duas convenções convivem — mas o pipeline é fiel

Auditoria dos **541 vídeos e seus 541 proxies** (`scripts/auditar_cor.py`,
executada em 24/08/2026):

```
ORIGINAIS   279 (51,6%)  range 'pc' declarado + bt709   -> Canon .MOV
            262 (48,4%)  sem tag nenhuma                -> .MTS (259) + .mp4 (3)

PROXIES     279          yuvj420p  range=pc
            262          yuv420p   range=<sem tag>
```

**Importante — o que NÃO está acontecendo.** Duas verificações independentes:

*Níveis*, comparando frame a frame original × proxy em 320px RGB:

```
video  7 (.mov full range) : Δmédia = +0,04/255   Δp1 = 0,0   Δp99 = 0,0
video  5 (.mp4 sem tag)    : Δmédia = -0,07/255   Δp1 = 0,0   Δp99 = -1,0
video 22 (.mts sem tag)    : Δmédia = -0,36/255   Δp1 = 0,0   Δp99 = -1,0
```

*Coerência*, comparando o range efetivo de cada original com o do seu proxy:

```
541/541 proxies mantêm o mesmo range efetivo do original — nenhuma divergência
```

O `scale` do ffmpeg converte range corretamente **em todos os 541 arquivos**.
**Não há bug de níveis nem incoerência entre original e proxy.** Quem disser o
contrário não mediu.

O problema real é outro e é mais sutil: **em 262 arquivos (48%) o estado é
correto por acidente, não por declaração.** O proxy acerta porque o ffmpeg
aplica o mesmo default do original — não porque alguém escreveu em algum lugar
qual é a convenção. No dia em que um elo da corrente adivinhar diferente — um
encoder de hardware novo, uma atualização de navegador, o `libplacebo`, um
licenciado com Vulkan — o acerto por default vira erro por default, em silêncio.

É por isso que a Fase 0 (registrar) vem antes da Fase 1 (declarar): a auditoria
transformou uma suposição em fato mensurável, e agora o fato está no banco.

### 2.4 As 1092 fotos CR2 passam por um auto-exposure invisível

`src/media/image_processing.py:33` chama:

```python
rgb = raw.postprocess(use_camera_wb=True)
```

Defaults reais do rawpy, confirmados por introspecção da assinatura:

| Parâmetro | Default | Efeito |
|---|---|---|
| `no_auto_bright` | `False` | **auto-brilho LIGADO** |
| `auto_bright_thr` | `0.01` | estica exposição até clipar 1% dos pixels |
| `output_color` | `sRGB` | ok, mas nunca foi uma decisão |
| `gamma` | `(2.222, 4.5)` | BT.709 |
| `output_bps` | `8` | 8 bits a partir de 14 bits de RAW |

Consequência: **cada foto recebe um esticão de exposição diferente, calculado
sobre ela mesma.** Duas fotos do mesmo plano, com a mesma luz, saem com
exposições distintas.

Isso não é só estético. Essas 1092 imagens alimentam:

- `palette.py` -> o facet `palette_temp` (quente/neutro/frio) da busca
- CLIP -> os embeddings de `capiau_images` no Qdrant
- detecção de rostos e a análise de visão

**O facet de temperatura de cor está medindo, em parte, o auto-white-balance do
rawpy — não a luz da cena.** A busca semântica de cor está construída sobre areia.

### 2.5 Viabilidade técnica: verde

FFmpeg local (build N-123918, 11/04/2026) tem tudo:

```
lut3d  lut1d  zscale (libzimg)  colorspace  tonemap  curves
colorbalance  colortemperature  colorlevels  normalize  libplacebo
```

`opencolorio==2.5.2` no PyPI tem wheel **`cp312-win_amd64` (3,9 MB)** — e
`cp314` também, então sobrevive à migração de Python já prevista no
`requirements.txt`. Nada para compilar no Windows.

Instalação: `uv pip install opencolorio` (o venv é gerido por uv e não tem pip).

### 2.6 A restrição que define a arquitetura

O preview é `el.style.filter = cssFilter` num `<video>` (`player.js:2218`).
**CSS não aplica LUT 3D.** Ou a transformação técnica é assada em arquivo, ou
seria preciso um caminho WebGL novo no player — mudança grande, arriscada, e
que ainda deixaria CLIP/rostos/visão vendo a imagem sem tratar.

Decisão: **assar em arquivo derivado**, com o modelo da seção 3.

---

## 3. Arquitetura

### 3.1 As três camadas, e quem manda em quem

```
   +- SEMÂNTICA --- "contraluz de fim de tarde"   -> busca, agente, continuidade
   |
   +- CRIATIVA ----- bloco {"type":"color"}       -> CSS ao vivo + cor.py no master
   |                 brightness/contrast/saturation/hue/sepia/grayscale/blur
   |
   +- TÉCNICA ------ cadeia de cor + OCIO         -> assada em proxy derivado
                     idt -> correções -> odt
```

A camada técnica roda **antes** da criativa e nunca disputa com ela. A criativa
continua sendo o que o usuário mexe com slider. A semântica lê o resultado.

### 3.2 O proxy em camadas (responde "não quero regenerar tudo")

```
original                      D:/ , F:/         somente leitura, nunca tocado
  +- proxy base 720p          data/proxies/proxy_vid_<id>.mp4      JÁ EXISTE
       +- proxy de cor        data/color/<id>/<chain_hash>.mp4     só se houver cadeia
```

Espelho exato de `data/audio_tratado/<video_id>/<chain_hash>.wav`.

Regras:

1. **Cadeia vazia = nenhum arquivo.** Um Rec.709 sem correção não gera nada.
   Dia 1 do deploy: **zero re-encode** dos 541 proxies existentes.
2. **`chain_hash` é a chave de cache.** `sha256("color|<video_id>|<in>|<out>|<cadeia>")`.
   Mesma correção duas vezes reusa o arquivo. Mesma lógica de `audio_chain.hash_cadeia`.
3. **Resolução de fonte vira `color_path || proxy_path || filepath`.**
   Um nível a mais em `player.js:1954` e em `video_render/midia.py`.
4. **Reverter = apagar o ponteiro.** O proxy base fica intocado.

### 3.3 Onde o Auto Color escreve (o atalho que economiza a Fase 1 inteira)

A IA **não** escreve na cadeia técnica. Ela escreve no bloco criativo
`{"type":"color"}` que já existe e já funciona ponta a ponta:

| Etapa | Já existe? |
|---|---|
| preview ao vivo no player (CSS) | sim — `player.js:2204-2227` |
| tradução fiel para ffmpeg | sim — `cor.py::cadeia_cor` |
| aplicação no render master | sim — `grafo_video.py:288` |
| bypass e reset na UI | sim — commits de 24/08 |

**A IA só precisa preencher números num contrato que já está testado.** Nenhum
render, nenhum arquivo novo, preview instantâneo.

A cadeia técnica assada entra na Fase 2, quando aparecer log/RAW — que é o
único caso em que CSS não dá conta.

### 3.4 Módulo novo

```
src/color/
├── __init__.py
├── ocio_manager.py    # config OCIO, lista de espaços, transform -> .cube com cache
├── deteccao.py        # ffprobe + heurística -> perfil de cor da mídia
├── cadeia.py          # cadeia canônica ordenada + chain_hash + montagem ffmpeg
├── medicao.py         # signalstats/OpenCV -> diagnóstico objetivo (o "analisar_cor")
├── auto_grade.py      # medição + LLM -> sugestão no bloco criativo
└── continuidade.py    # comparação entre planos da mesma cena
src/vision/
└── lighting.py        # classificador zero-shot CLIP de condição de luz
data/luts/             # .cube assadas pelo OCIO (gitignore)
data/ocio/             # config .ocio (gitignore)
```

---

## 4. FASE 0 — Fundação (não muda pixel nenhum) — **CONCLUÍDA em 24/08/2026**

Objetivo: passar a **saber** o que já está acontecendo. Nenhuma imagem muda.
Reversível por completo. Isto sozinho já vale, porque hoje a informação
simplesmente não existe em lugar nenhum.

| item | estado | onde |
|---|---|---|
| 0.1 ffprobe estendido | feito | `src/media/ffmpeg.py` (`COLOR_KEYS`, `_extract_color_metadata`) |
| 0.2 colunas no banco | feito | `src/db/schema.py`, `src/db/repositories/media.py` |
| 0.3 configurações | **pendente** | movido para junto de 1.2, que é quem consome |
| 0.4 script de auditoria | feito | `scripts/auditar_cor.py` |
| — resolvedor de perfil | feito | `src/color/deteccao.py` |
| — testes | feito | `tests/test_f12_cor_deteccao.py` (20 casos) |

Resultado da primeira execução: **541 vídeos + 1424 fotos auditados, 1965 linhas
gravadas**. Suíte do projeto: 639 passando, 2 skipped.

### 0.1 `ffprobe` estendido

`src/media/ffmpeg.py::get_media_metadata` passa a devolver também:

```python
'color_range', 'color_space', 'color_transfer', 'color_primaries',
'pix_fmt', 'bits_per_raw_sample', 'field_order'
```

Sem quebrar chamador nenhum: são chaves novas num dict que já é dict.

### 0.2 Colunas no banco

Migração dinâmica no padrão de `src/db/schema.py::init_db` (`ALTER TABLE` com
guarda de coluna existente — o padrão da casa, já usado 40+ vezes).

```sql
-- video
color_range TEXT            -- 'tv' | 'pc' | NULL
color_space TEXT
color_transfer TEXT
color_primaries TEXT
pix_fmt TEXT
field_order TEXT            -- brinde: revelou 262 arquivos entrelaçados
color_profile TEXT          -- resolvido: 'rec709' | 'slog3' | 'logc3' | 'hlg' | 'desconhecido'
color_profile_origem TEXT   -- 'tag' | 'heuristica' | 'humano'
proxy_color_range TEXT      -- em que convenção o PROXY ficou

-- photo
color_profile TEXT
raw_params_json TEXT        -- o que foi passado ao rawpy (auditoria)
```

### 0.3 Categoria "Cor" no painel de configurações

`src/services/settings_registry.py`: nova entrada em `CATEGORIES`
(`{"id": "color", "label": "Cor", "icon": "fa-palette"}`) e as chaves:

| chave | default | o que faz |
|---|---|---|
| `color.enabled` | `True` | liga o módulo inteiro |
| `color.display` | `"rec709"` | convenção de saída dos proxies |
| `color.raw_auto_bright` | `False` | **muda o default do rawpy** (ver 1.2) |
| `color.raw_output_color` | `"sRGB"` | espaço de saída do CR2 |
| `color.lighting_enabled` | `True` | facet zero-shot de luz |
| `color.auto_grade_model` | herda `llm.text_model` | modelo do Auto Color |

Defaults NÃO vão para o banco — o registry guarda só overrides, regra já
estabelecida no cabeçalho do `settings_registry.py`.

### 0.4 Script de auditoria

`scripts/auditar_cor.py`: varre o acervo, grava as colunas de 0.2 e imprime a
distribuição de perfis, ranges e tags — original e proxy lado a lado, mais a
checagem de coerência entre os dois. É como a seção 2.3 foi produzida; vira
ferramenta permanente.

```
python scripts/auditar_cor.py                  # audita tudo e grava
python scripts/auditar_cor.py --so-relatorio   # não grava, só mostra
python scripts/auditar_cor.py --projeto 2 --workers 16
```

**Custo real medido** (541 vídeos + 541 proxies + 1424 fotos, 8 threads):

```
1ª execução (cache frio) : 100 s   -> 173 ms por vídeo+proxy
2ª execução (cache OS)   :  18 s   ->  33 ms por vídeo+proxy
```

O gargalo é leitura do D: em cache frio, não CPU. A estimativa inicial de ~30 s
vinha de um teste com arquivos já em cache e com uma leitura por item — o real
são duas leituras (original **e** proxy) por vídeo, a frio.

Custo único: mídia nova já entra auditada pela ingestão
(`_registrar_cor_video` / `_registrar_cor_foto` em `src/services/ingest.py`),
sem chamada extra a disco — as tags já vêm no `meta` do FFprobe que a ingestão
sempre leu.

**Entrega da Fase 0:** você abre o Talho e vê, por mídia, em que convenção ela
está. Nada mudou de aparência.

---

## 5. FASE 1 — O acervo que existe (+ IA)

Aqui mora o valor imediato. Ordem abaixo é ordem de dependência.

### 1.1 Proxy declarado

> Prioridade revista depois da auditoria: como os 541 proxies estão **corretos**
> (seção 2.3), isto deixou de ser conserto e virou **blindagem**. Baixa urgência,
> custo baixo — mas é o que impede a regressão silenciosa no dia em que o
> encoder, o navegador ou a máquina do licenciado mudarem de default.

`generate_video_proxy` ganha, no fim do comando, as flags explícitas:

```
-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv
```

e, quando a origem é full-range, `scale=...:out_range=tv` explícito em vez de
implícito. Isso não muda a imagem (a conversão já acontece — seção 2.3); muda
o fato de que ela passa a ser **declarada**.

Proxies antigos: botão "Normalizar tags dos proxies" que roda
`-c copy -bsf:v h264_metadata=...` — **~1 s por arquivo, sem re-encode, sem
perda**. 541 arquivos em ~10 min, opcional, em background com o `TASK_MANAGER`
que já existe.

### 1.2 CR2 sob controle — o maior ganho de qualidade da fase

`src/media/image_processing.py`:

```python
rgb = raw.postprocess(
    use_camera_wb=True,
    no_auto_bright=not S.get("color.raw_auto_bright"),   # default: DESLIGA o auto-brilho
    output_color=rawpy.ColorSpace.sRGB,
    gamma=(2.222, 4.5),
    output_bps=8,
)
```

Grava em `photo.raw_params_json` o que foi usado. Regerar os 1092 proxies WebP:
é decode + resize, **sem encode de vídeo** — segundos por foto, e o
`_generate_photo_proxy_task` já roda em background.

Depois disso, **re-executar `palette.py` e a indexação CLIP das fotos**: pela
primeira vez o facet quente/neutro/frio vai medir a cena, não o rawpy.

> Atenção honesta: desligar o auto-brilho deixa algumas fotos visivelmente mais
> escuras — porque elas *são* mais escuras. É a exposição real. Se você
> preferir o visual anterior, `color.raw_auto_bright` religa; mas aí o facet de
> cor continua contaminado. A configuração existe para você decidir, não para
> eu decidir por você.

### 1.3 Medição objetiva — `analisar_cor`

`src/color/medicao.py` + tabela `color_render`, espelho exato de `audio_render`:

```sql
CREATE TABLE IF NOT EXISTS color_render (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
    in_s REAL, out_s REAL,
    chain_hash TEXT NOT NULL,
    chain_json TEXT,
    path TEXT,                 -- proxy derivado, quando houver (Fase 2)
    status TEXT NOT NULL DEFAULT 'pending',
    analysis_json TEXT,        -- o diagnóstico
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_color_render_hash ON color_render(video_id, chain_hash);
```

Na análise pura: `chain_json='[]'`, `chain_hash = sha256("analysis|<id>|<in>|<out>")`.
Idêntico à ETAPA 1 do plano de áudio — inclusive a convenção do prefixo.

Medida com `ffmpeg -vf signalstats` + OpenCV, devolve JSON:

```json
{"exposicao_media": 0.41, "clip_altas_pct": 2.3, "clip_baixas_pct": 0.1,
 "contraste": 0.62, "temperatura_k_estimada": 3200, "saturacao_media": 0.34,
 "dominante_hex": "#8a6b3f", "tem_pele": true, "pele_desvio": {"r": 12, "b": -8}}
```

Custo: ffmpeg puro em proxy 720p, dezenas de vezes o tempo real. Cacheado.

### 1.4 Faceta semântica de luz

`src/vision/lighting.py` — **espelho estrutural de `shot_scale.py`**, mesmo
padrão de ensemble de prompts em inglês, mesmo singleton, mesmo centróide
normalizado, mesmos rótulos ASCII estáveis para payload:

```python
LIGHTING_PROMPTS = {
    "contraluz":        [...],   # backlit, subject against bright window
    "luz_de_janela":    [...],
    "tungstenio":       [...],   # warm practical / interior noturno
    "fluorescente":     [...],
    "sol_duro":         [...],
    "penumbra":         [...],
    "difusa_suave":     [...],
    "neon":             [...],
}
```

Integração idêntica à `_shot_scale_facet` em `image_semantic.py:98`:

- coluna `media_segment.lighting` + `lighting_score`
- payload `lighting` no Qdrant, para as duas coleções
- query param em `narrative.py` ao lado do `palette_temp` que já existe
- falha **nunca** derruba a indexação (lição do E2.A5, já escrita no código)

Custo de API: **zero**. É uma multiplicação de matriz por keyframe, sobre
embeddings CLIP que já são calculados.

### 1.5 Paleta estendida a vídeo

`palette.py::classify_palette_file` já funciona por arquivo. Os keyframes já
são extraídos em `analyze_video_vision`. Falta só chamar por keyframe e agregar
por segmento -> `media_segment.palette_temp` / `palette_hex`.

Resultado combinado de 1.4 + 1.5: **"me acha os planos de contraluz quente na
entrevista da Julia"** passa a funcionar na busca que já existe.

### 1.6 Auto Color — o agente sugere, você aprova

Quatro ferramentas novas em `chat_agent.py::TOOLS`, espelhando exatamente o
quarteto de áudio que já está lá:

| ferramenta | espelha | o que faz |
|---|---|---|
| `analisar_cor` | `analisar_audio` | mede e devolve o diagnóstico de 1.3 |
| `sugerir_correcao_cor` | `sugerir_tratamento_audio` | LLM lê medição + facet de luz -> propõe valores |
| `aplicar_correcao_cor` | `aplicar_tratamento_audio` | escreve no bloco `{"type":"color"}` do clipe |
| `checar_continuidade_cor` | *(novo)* | ver 1.7 |

O LLM recebe a medição objetiva **e** o rótulo semântico ("contraluz",
"tungstênio") e devolve valores no vocabulário do bloco criativo:

```json
{"brightness": 12, "contrast": -5, "saturation": 108, "hue": -3,
 "razao": "contraluz: rosto 1,2 stop abaixo do fundo; levantei médios sem tocar nas altas"}
```

Preview: **instantâneo, por CSS**, porque é o mesmo bloco de sempre. Master:
já sai traduzido por `cor.py`. **Nada novo para construir no caminho de render.**

### 1.7 Continuidade entre planos

`src/color/continuidade.py`. Agrupa segmentos que a base já sabe serem da mesma
cena — via `theme_segment`, `scene`, rostos reconhecidos e vizinhança CLIP —
compara os vetores de medição de 1.3 e sinaliza divergências acima de limiar:

```
Cena 12 — "conversa na cozinha"
  ! plano 3 (handcam) está 0,8 stop mais escuro e 340K mais frio que os planos 1, 2 e 4
    -> sugerir: brightness +9, hue +2
```

Isto é o que **nenhuma** ferramenta de triagem faz, e é o argumento de
licenciamento do CapIAu. Depende de 1.3 e 1.4 estarem prontos; se a fase
apertar, é o item que pode escorregar para a Fase 2 sem quebrar nada.

**Entrega da Fase 1:** cor vira dimensão de busca, o agente diagnostica e
sugere correção com preview instantâneo, as fotos param de mentir sobre luz, e
os proxies passam a declarar o que são.

---

## 6. FASE 2 — Log, RAW e OCIO de verdade

É aqui que o `opencolorio` entra em cena. **É a fase que vende licença**, porque
é a que trata material que você não tem e seus clientes têm.

### 2.1 OCIO instalado e configurado

```
uv pip install opencolorio
```

`src/color/ocio_manager.py`:

- carrega a config ACES (`studio-config` ou `cg-config`) de `data/ocio/`
- lista espaços de entrada disponíveis para a UI
- `assar_lut(entrada, saida) -> Path` gera `.cube` 33³ em `data/luts/`, **com
  cache em disco** — assar é caro, aplicar é barato

> Correção ao relatório que circula: **não existe "baixar as LUTs 3D oficiais do
> ACES 1.3"**. A ACES distribui *transformações*, não `.cube`. Quem assa a LUT é
> o OCIO, a partir da config. É por isso que a dependência importa.

### 2.2 Detecção de perfil de entrada

`src/color/deteccao.py`: tags do `ffprobe` primeiro; quando ausentes (o caso dos
259 MTS), heurística por codec + fabricante + `pix_fmt` + metadados de câmera.
Resultado vai para `video.color_profile` com `color_profile_origem` dizendo se
veio de tag, de heurística ou do humano. **Desconhecido cai para `rec709` e diz
que caiu** — nunca adivinha em silêncio.

Perfis alvo: `slog3`, `logc3`, `logc4`, `vlog`, `nlog`, `clog2`, `clog3`,
`redlogfilm`, `hlg`, `pq`, `rec709`, `linear`.

### 2.3 Cadeia técnica assada

`src/color/cadeia.py`, com ordem canônica fixa no estilo de `CADEIA_ORDEM`:

```python
CADEIA_ORDEM = (
    "idt",         # lut3d — entrada log/RAW -> display; SEMPRE primeiro
    "tonemap",     # zscale+tonemap para HLG/PQ -> SDR
    "exposicao",
    "wb",          # colortemperature
    "niveis",      # colorlevels
    "curvas",      # curves
    "balanco",     # colorbalance (sombras/médios/altas)
    "saturacao",
    "odt",         # convenção de saída; SEMPRE por último
)
```

Aplicação: `lut3d=data/luts/<hash>.cube` no proxy derivado de 3.2. Só para
mídia cujo perfil não seja o display — Rec.709 continua sem gerar arquivo.

### 2.4 Reindexação consciente

Quando um proxy derivado nasce, CLIP/palette/luz daquele vídeo precisam ser
recalculados — porque agora a imagem que a IA vê mudou. Fila em background,
com marcação visível de custo, no padrão que o projeto já usa.

---

## 7. FASE 3 — Handoff e finalização

Você marcou os três destinos: Talho finaliza **e** leva para Premiere/Resolve
**e** Kdenlive.

### 3.1 Camada técnica no render master

`grafo_video.py::cadeia_clipe` já chama `cor.cadeia_cor(bloco_cor)` na linha
288. A cadeia técnica entra **imediatamente antes**, no mesmo ponto. É uma
linha mais um import. O master passa a aplicar IDT + correção técnica + look
criativo, sobre o **original**.

### 3.2 Metadados de cor no OTIO / FCPXML

`src/export/otio_export.py` já monta `ExternalReference` com `metadata`. Entra:

- `color_profile`, `color_range`, `color_primaries` por clipe
- para o FCPXML (via `otio-fcp-adapter`), a tag de color space que o
  Premiere 2025 lê para acionar o gerenciamento automático
- Kdenlive consome o `.otio` nativo (medido em 18/08, já documentado no
  `otio_export.py:38`) — mesmos metadados servem

### 3.3 Exportação da correção

Dois formatos, com honestidade sobre o que cada um carrega:

| formato | carrega | **não** carrega |
|---|---|---|
| `.cube` assada por clipe | brightness, contrast, saturation, hue, sepia, grayscale — **exato** | `blur` (é espacial, não cabe em LUT) |
| ASC CDL (`.cdl`/`.ccc`) | slope/offset/power + saturation — **aproximado** | hue, sepia, grayscale, blur |

Recomendação: `.cube` como padrão (é exato para tudo que é ponto-a-ponto), CDL
como opção para pipelines que exigem CDL.

---

## 8. FASE 4 — Diferencial

Ordem por valor decrescente; nenhuma bloqueia as outras.

1. **Casamento automático de plano** — escolher um plano como referência e a IA
   propõe a correção que aproxima os outros dele. É 1.7 invertido: em vez de
   apontar o problema, resolver.
2. **Scopes na UI** — waveform, vectorscope, parade. O projeto já tem
   `waveformManager.js` e um `timelineRenderer` em canvas; a infraestrutura de
   desenho existe.
3. **Coerência de pele** — usar as faces que o `face_service` já detecta como
   âncora de correção. Tom de pele é a referência mais confiável que existe, e
   o Talho já sabe onde os rostos estão.
4. **Perfil de monitor (ICC)** — deixar o proxy correto para o monitor de quem
   está triando. Relevante quando o CapIAu rodar na máquina de outra produtora.
5. **Display/view OCIO múltiplos** — mesmo material, saídas diferentes
   (Rec.709 / P3 / sRGB) sem regerar.

---

## 9. Restrições e armadilhas

- **CPU-only no backend.** Nada de Zero-DCE ou rede neural quadro a quadro. O
  OCIO assa a LUT **uma vez**; o ffmpeg (que é rápido em CPU) aplica. A IA
  entra na *decisão*, nunca no *pixel*.
- **Original é sagrado.** O guarda de `audio_chain.py:renderizar` já recusa
  escrever em `F:/`; a cadeia de cor herda a mesma guarda.
- **Áudio nunca é reencodado.** Todo comando de cor leva `-c:a copy`, ou a
  sincronia com a waveform e a cadeia de áudio quebra.
- **Falha de cor não pode derrubar ingestão.** Mesma regra do E2.A5, já escrita
  no `image_semantic.py:98`: acessório não quebra o principal.
- **`opencolorio` é dependência opcional.** `import` protegido, no padrão que
  `comando.py` já usa para os grafos. Sem OCIO, Fase 0 e Fase 1 funcionam
  inteiras — só a Fase 2 recusa, com mensagem clara.
- **Achado fora de escopo:** a auditoria contou **262 vídeos entrelaçados**
  (os 259 `.MTS` e os 3 `.mp4`, todos `field_order=tt`)
  (entrelaçados) e o proxy não desentrelaça. Isso provavelmente aparece como
  serrilhado em movimento. **Não é cor** e não entra neste plano — mas está
  registrado aqui porque foi medido hoje e vai incomodar em algum momento.

---

## 10. Ordem de execução

| # | item | depende de | esforço | muda imagem? |
|---|---|---|---|---|
| 0.1 | ~~ffprobe estendido~~ **feito** | — | baixo | não |
| 0.2 | ~~colunas no banco~~ **feito** | 0.1 | baixo | não |
| 0.4 | ~~script de auditoria~~ **feito** | 0.1 | baixo | não |
| 0.3 | categoria Cor nas configs | 0.2 | baixo | não |
| 1.1 | proxy declarado + retag *(blindagem, não conserto)* | 0.2 | baixo | não |
| 1.2 | **CR2 sob controle** | 0.3 | médio | **sim (fotos)** |
| 1.3 | medição + `color_render` | 0.2 | médio | não |
| 1.4 | faceta de luz (CLIP) | — | médio | não |
| 1.5 | paleta em vídeo | 1.4 | baixo | não |
| 1.6 | Auto Color no agente | 1.3, 1.4 | médio | não* |
| 1.7 | continuidade | 1.3, 1.4 | alto | não |
| 2.x | OCIO + log/RAW | Fase 1 | alto | sim (log) |
| 3.x | handoff e master | Fase 2 | médio | sim (master) |
| 4.x | diferencial | Fase 3 | alto | varia |

\* 1.6 escreve num bloco não-destrutivo que você aprova antes de valer.

**Primeiro passo concreto:** 0.1 + 0.2 + 0.4 — em uma sessão, sem tocar em
pixel nenhum, e você já vê o mapa de cor do acervo inteiro.
