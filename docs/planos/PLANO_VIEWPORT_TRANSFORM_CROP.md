# Plano de Implementação v2 — Propriedades da Timeline, Viewport Estável, Alças de Transformação e Crop

> Substitui o plano original (`implementation_plan.md` do Antigravity), incorporando a auditoria do código
> real feita em 15/07/2026. Cada decisão vem com o porquê e com referência ao arquivo/linha que a motivou.

---

## Visão geral das fases

| Fase | Entrega | Depende de |
|------|---------|------------|
| **0** | Correções de fundação (fps cravado, undo dos sliders, painel obsoleto, volume morto, fps no autosave) | — |
| **1** | Viewport estável do Program (as 4 camadas de mídia + máscara de transbordo) | 0 |
| **2** | Propriedades da timeline (resolução/fps), auto-configuração, painel de configurações e persistência | 1 |
| **3** | Zoom de visualização do preview (Fit…100%) | 1 |
| **4** | Alças interativas de transformação (bounding box) | 1, 2 |
| **5** | Efeito de Crop | 1, 4 (helper de content rect) |

A ordem importa: as fases 1–5 constroem em cima de mecanismos que hoje têm defeitos (histórico, fps).
Implementar por cima sem a Fase 0 replica os bugs nos recursos novos.

---

## FASE 0 — Correções de fundação

### 0.1 Descravar o fps do player (pré-requisito do fps dinâmico)

O motor de sincronia ignora `TIMELINE_STATE.fps` e usa `24` cravado. Se o fps da timeline mudar
(objetivo da Fase 2), o vídeo toca no trecho errado e em velocidade errada.

Pontos a corrigir (verificados por grep):

- `player.js:1012` e `player.js:1247` — `cut.in + (offsetFrames / 24)` (seek de vídeo e áudio)
- `player.js:902` — avanço do playhead (`elapsedSecs * 24`)
- `player.js:16` — `formatTimecode` assume 24fps (passar fps como parâmetro)
- `player.js:937-940` — exibição de timecode
- `player.js:1273-1274` — janelas de fade de áudio
- `library.js:212` — timecode de exibição na biblioteca (usa 24 próprio; trocar por `TIMELINE_STATE.fps`)

**Decisão:** todos leem `TIMELINE_STATE.fps` no momento do uso (não cachear em variável de módulo —
o valor muda em runtime). Não criar uma terceira fonte de fps: `STATE._projectFps` (legado em
`state.js:38`) permanece intocado; o setter de `activeTimelineCuts` já prefere `TIMELINE_STATE.fps`
(`state.js:159`).

### 0.2 Consertar o undo dos sliders de ajuste (bug ativo hoje)

**O bug:** o `oninput` dos sliders muta o estado ao vivo sem histórico
(`timelineInteraction.js:725-737`). No soltar, o `onchange` chama `record()`, que tira o snapshot
"antes" — mas o estado **já está no valor final**. O `commit()` compara antes/depois, vê tudo igual
e descarta (`timelineState.js:938`). Nenhum ajuste de slider é reversível com Ctrl+Z.

**Decisão — padrão transacional (o mesmo dos drags da timeline):**

- `oninput` → chama `TIMELINE_HISTORY.begin()` **antes** da primeira mutação (é idempotente:
  só captura se não houver transação aberta — `timelineState.js:929-931`), depois muta ao vivo.
- `onchange` → aplica o valor final (os setters `setClipTransform`/`setClipColor`/`setClipVolume`
  continuam funcionando: com transação pendente, `record()` adere a ela) e chama
  `TIMELINE_HISTORY.commit()`.

Isso vale para: sliders de transformação (`data-prop`), de cor (`data-color`) e de volume.
Botões de fit, preset Ken Burns e fades são operações pontuais — `record()` puro já funciona neles.

**Por que `begin()` no `oninput` e não no `pointerdown`:** setas do teclado também disparam
`input`→`change` sem `pointerdown`. O `oninput` cobre os dois caminhos.

### 0.3 Atualizar o painel de ajustes após undo/redo

Hoje o Ctrl+Z restaura o estado e zera a seleção (`timelineState.js:960`), mas o painel continua
mostrando sliders do clipe antigo — interagir com eles falha em silêncio.

**Decisão:** `_restore()` passa a emitir `STATE.emit("timelineRestored")`. O
`TimelineInteraction.init()` escuta e chama `this.refreshClipInspector()` (e, na Fase 4, atualiza o
overlay de transformação). Evento único cobre todos os gatilhos: teclado
(`timelineInteraction.js:900-910`), botões da toolbar (`panels.js:228-229`) e qualquer futuro caminho.

### 0.4 Volume em clipe de vídeo é um controle morto

O player silencia todos os `<video>` (`el.muted = true`, `player.js:1048`); o efeito `volume` só é
lido no `syncAudioTracks` (`player.js:1268`). O slider exibido em clipes de pista de vídeo
(`timelineInteraction.js:650`) não faz nada.

**Decisão — redirecionar para o par de áudio vinculado:**

- No `renderAdjustmentsPanel`, se o clipe é de vídeo e tem `link_id`, o valor exibido e o
  `setClipVolume` operam sobre o clipe parceiro (mesmo `link_id`, pista `kind === "audio"`).
- Se o clipe de vídeo **não** tem par de áudio, a seção de volume não é exibida (não há áudio audível).
- Clipes de pista de áudio continuam operando sobre si mesmos.

### 0.5 fps no autosave (latente hoje, ativo com a Fase 2)

`performAutosave` não salva `TIMELINE_STATE.fps` (`timelineAutosave.js:30-42`). Com fps
auto-configurado (Fase 2), recarregar a página restauraria frames calculados a 30fps interpretados
a 24fps — tudo desloca.

**Decisão:** o payload do autosave ganha `fps`, `width`, `height` (os dois últimos entram junto com
a Fase 2). No `restoreAutosave`, aplicar **antes** de restaurar os cuts (o setter de
`activeTimelineCuts` usa o fps para sincronizar frames↔segundos). Usar atribuição direta + emissão
de evento, **não** o `setTimelineProperties` da Fase 2 (que reescala clipes — no restore os frames
já estão corretos).

### 0.6 Preservar o scroll do painel de ajustes no re-render

Cada `onchange` reconstrói o `innerHTML` do painel (`timelineInteraction.js:685`) e o scroll volta
ao topo. Com os sliders de Crop entrando no fim do painel (Fase 5), isso vira irritação constante.

**Decisão:** capturar `container.scrollTop` antes do `innerHTML` e restaurar depois, dentro do
próprio `renderAdjustmentsPanel`. (Re-render in-place completo fica como melhoria futura; preservar
o scroll resolve 90% do incômodo com 2 linhas.)

### 0.7 Proteger a aba Ajustes contra ocultação

A customização de abas esconde botões com `display:none` (`tabsCustomization.js:191`), mas o
`showClipInspector` clica no botão escondido (`timelineInteraction.js:373`) — `.click()` funciona em
elemento invisível e ativa o conteúdo sem aba visível na barra.

**Decisão:** no `showClipInspector`, se o botão da aba estiver oculto, re-exibi-lo
(`btn.style.display = ""`) e persistir `visibility["tab-adjustments"] = true` no localStorage antes
do clique. Respeita a escolha do usuário no resto do tempo, mas nunca deixa a UI em estado
inconsistente. (Requer exportar um helper `setTabVisibility(tabVal, visible)` de
`tabsCustomization.js`.)

### Verificação da Fase 0

1. Mover slider de Escala, soltar, Ctrl+Z → valor volta ao anterior; Ctrl+Shift+Z → refaz.
2. Ctrl+Z com painel aberto → painel limpa/atualiza (não mostra clipe fantasma).
3. Ajustar volume num clipe de vídeo com par A/V → o áudio muda de fato durante a reprodução.
4. Ocultar a aba Ajustes, clicar num clipe → aba reaparece e ativa corretamente.
5. Timeline com clipes + F5 → posições e reprodução idênticas (fps persistido).

---

## FASE 1 — Viewport estável do Program (atenção especial)

### O problema de estabilidade, com precisão

Hoje as 4 camadas de mídia (`program-video-a`, `program-video-b`, `program-player-photo`,
`program-player-photo-b` — `index.html:582-587`) têm `width:100%; height:100%` **do wrapper**
(`#program-video-wrapper`), que é `flex:1` do painel — proporção arbitrária que muda com o tamanho
da janela, dos splitters e do estado maximizado. Como o `applyMediaEffects` aplica
`object-fit: cover` por padrão ("fill", `player.js:1137`), **o enquadramento visível muda quando o
usuário redimensiona a janela**. Não existe "quadro da sequência" — o quadro é o painel.

### A solução: o quadro da sequência vira um elemento real

Princípio: **todas as camadas de mídia passam a ser filhas de um único elemento cuja proporção é a
da sequência** (`TIMELINE_STATE.width × height`), e esse elemento é dimensionado em pixels reais por
JS. Tudo que é relativo — `object-fit`, `translate(%)`, `clip-path: inset(%)`, o overlay de alças —
passa a ter uma referência **invariante ao layout da janela**.

#### 1.1 Nova estrutura DOM (em `index.html`)

```html
<div id="program-video-wrapper">  <!-- casca: inalterada (flex center, overflow:hidden, bg #000) -->
    <div id="program-player-viewport">
        <!-- AS 4 CAMADAS DE MÍDIA, movidas para dentro (nenhuma fica para trás): -->
        <video id="program-video-a"></video>          <!-- z-index 1  -->
        <img   id="program-player-photo">             <!-- z-index 2  -->
        <video id="program-video-b"></video>          <!-- z-index 10 -->
        <img   id="program-player-photo-b">           <!-- z-index 11 -->

        <!-- Máscara de transbordo (Fase 1) -->
        <div id="program-viewport-shade"></div>       <!-- z-index 50 -->

        <!-- Overlay de transformação (Fase 4) -->
        <div id="program-transform-overlay"></div>    <!-- z-index 60 -->
    </div>
</div>
```

Regras críticas:

- As camadas mantêm `position:absolute; inset:0; width:100%; height:100%` — agora 100% **do
  viewport**, não do wrapper. Os `dataset.loadedSrc`/`activeClipId` e toda a lógica do pool A/B do
  player continuam intactos (o player localiza por id via `getActiveElement`, indiferente ao pai).
- Remover o `object-fit` inline das tags (o `applyMediaEffects` já o define a cada frame; o inline
  só confunde — hoje `contain` no vídeo e `cover` na foto são sobrescritos de qualquer forma).
- O wrapper **permanece** `overflow:hidden` — é ele que corta o transbordo e a sombra nos limites do
  painel. O viewport usa `overflow:visible` para o transbordo existir.

#### 1.2 Máscara de transbordo — por que um filho dedicado, e não box-shadow no viewport

O plano original punha `box-shadow: 0 0 0 9999px` **no viewport**. Não funciona: box-shadow pinta
na camada de fundo do elemento, **atrás** dos filhos posicionados — o transbordo dos vídeos ficaria
100% nítido por cima da sombra.

**Decisão:** a sombra vai num **filho** `#program-viewport-shade`:

```css
#program-viewport-shade {
    position: absolute;
    inset: 0;
    z-index: 50;                 /* acima das 4 camadas de mídia (1..11) */
    pointer-events: none;        /* não bloqueia cliques de play/pause nem drags futuros */
    box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.7);
    border: 1px dashed rgba(6, 182, 212, 0.45);
}
```

Por que isso é a solução estável:

- Sendo filho com `inset:0`, **acompanha o tamanho do viewport automaticamente** — zero
  sincronização por JS, zero estado duplicado.
- Estando no mesmo contexto de empilhamento das camadas de mídia e com `z-index` maior, a sombra
  projetada para fora (spread 9999px) cobre o transbordo, escurecendo-o; a área interna (`inset:0`)
  fica livre — nítida.
- O `overflow:hidden` do wrapper corta a sombra nos limites do painel.
- `pointer-events:none` preserva os handlers de clique do wrapper
  (`workspaceManager.js:149-191` — play/pause e maximizar por duplo clique).

#### 1.3 Dimensionamento — `syncProgramViewport()` (função única, exportada de `player.js`)

```js
// pseudocódigo da lógica central
function syncProgramViewport() {
    const wrapper  = getActiveElement("program-video-wrapper");
    const viewport = getActiveElement("program-player-viewport");
    if (!wrapper || !viewport) return;

    const tw = TIMELINE_STATE.width  || 1920;
    const th = TIMELINE_STATE.height || 1080;
    const PAD = 16; // respiro para a borda pontilhada não colar no painel

    const availW = Math.max(0, wrapper.clientWidth  - PAD * 2);
    const availH = Math.max(0, wrapper.clientHeight - PAD * 2);
    const fitScale = Math.min(availW / tw, availH / th);

    const zoom = TIMELINE_STATE.previewZoom; // "fit" | 0.25 | 0.5 | 0.75 | 1  (Fase 3)
    const scale = (zoom === "fit") ? fitScale : zoom;

    viewport.style.width  = `${Math.round(tw * scale)}px`;
    viewport.style.height = `${Math.round(th * scale)}px`;
}
```

**Decisões de dimensionamento:**

- **Pixels reais, não `transform: scale()` no viewport.** Com tamanho em px, `object-fit`,
  `translate(%)`, `clip-path` e `getBoundingClientRect()` (usado pelo overlay da Fase 4) funcionam
  sem conversão de coordenadas. CSS transform no viewport criaria dois espaços de coordenadas
  (layout vs. visual) e cada consumidor teria que saber o fator — fonte clássica de bugs de
  alinhamento.
- O wrapper já é flexbox centrado — o viewport centraliza sozinho, sem cálculo de posição.
- `TIMELINE_STATE.width/height/previewZoom` ganham valores default nesta fase
  (`1920/1080/"fit"`), sem UI ainda (UI é Fase 2/3). Assim a Fase 1 é testável isolada.

#### 1.4 Quando recalcular — cobertura de todos os gatilhos de layout

| Gatilho | Mecanismo |
|---|---|
| Janela redimensionada, splitters arrastados, painel maximizado/restaurado | **`ResizeObserver` no wrapper** (cobre todos — dispensa escutar cada botão) |
| Resolução da timeline mudou | evento `timelinePropertiesChanged` (Fase 2) |
| Zoom do preview mudou | evento `previewZoomChanged` (Fase 3) |
| Player destacado (popout) — o wrapper vira **outro elemento em outra janela** | ver abaixo |

**Popout (decisão de robustez):** `getActiveElement` procura primeiro nas janelas popout
(`workspaceManager.js:9-18`), então a função sempre encontra o wrapper certo. O problema é o
`ResizeObserver` ficar preso ao elemento antigo. Solução: `syncProgramViewport` guarda referência do
wrapper observado (`_observedWrapper`); a cada chamada, se o wrapper resolvido for outro elemento,
desconecta o observer antigo e observa o novo. Como o compositor do Program já roda a cada mudança
de playhead/cuts (`player.js:806`), acrescentar uma chamada barata a `syncProgramViewport` no início
do `syncVideoToPlayhead` garante a re-detecção sem precisar instrumentar o código de popout.
(O observer dispara o resto do tempo; a chamada no compositor é só o "cinto de segurança" da troca
de janela.)

#### 1.5 Semântica de enquadramento após a mudança

- `fill` (default) = `cover` **do quadro da sequência**; `fit` = `contain` do quadro. A semântica
  por clipe não muda — muda a referência, que agora é estável.
- Com a auto-configuração da Fase 2 (primeiro clipe define a resolução), o clipe inaugural tem
  proporção idêntica ao quadro → `fill` e `fit` ficam visualmente iguais para ele. Clipes de
  proporção diferente (vertical numa sequência horizontal) é que passam a se comportar de forma
  previsível: `fill` corta, `fit` deixa faixas — **sempre igual, em qualquer tamanho de janela**.
- Não migrar valores de efeitos existentes: como o enquadramento atual é instável por definição
  (depende da janela), não existe "aparência antiga" a preservar.

#### 1.6 O que NÃO muda

- Source player (`source-video-wrapper`): intocado nesta reforma.
- Pool A/B, estabilidade de papéis, sincronia por playbackRate (`player.js:1019-1045`): intocados.
- Handlers de clique do wrapper: intocados (a máscara tem `pointer-events:none`).

### Verificação da Fase 1

1. Adicionar um vídeo, pausar num frame com `fill`. Redimensionar a janela, arrastar splitters,
   maximizar o painel → **o enquadramento não muda** (só a escala de exibição).
2. Vídeo com escala 150% (slider atual) → transbordo aparece escurecido além da borda pontilhada;
   dentro dela, nítido.
3. Destacar o player (popout) → viewport correto na nova janela; redimensionar a popout → acompanha.
4. Clique simples no vídeo → play/pause continua funcionando; duplo clique → maximiza.
5. Foto na timeline (still) → renderiza dentro do quadro, mesmas garantias.

---

## FASE 2 — Propriedades da timeline, auto-configuração e persistência

### 2.1 Estado (em `timelineState.js`)

- Novos campos: `width = 1920`, `height = 1080` (já criados na Fase 1), mais o método:

```js
setTimelineProperties({ width, height, fps }) {
    // valida (inteiros pares > 0; fps > 0), aplica, e:
    // - se fps mudou COM clipes existentes → reescala frames preservando segundos (ver 2.2)
    // - emite STATE.emit("timelinePropertiesChanged", { width, height, fps })
}
```

- **Não armazenar `aspectRatio`**: é derivado (`width/height`) — calcular na exibição. Guardar
  os três geraria dessincronia.
- `previewZoom` fica fora do undo e fora do save de backend (preferência de visualização, não
  conteúdo). Entra apenas no autosave local.

### 2.2 Política de mudança de fps com clipes existentes

Frames são a moeda absoluta da timeline; mudar o fps muda o valor em segundos de cada frame.

**Decisão: preservar segundos, reescalar frames.** Dentro do `setTimelineProperties`, se
`fps` mudou e há clipes: para cada cut, `inFrame/outFrame/timelineStartFrame` são recalculados a
partir dos campos em segundos (`in`, `out`, `timeline_start` — mantidos em sincronia pelo setter de
`activeTimelineCuts`, `state.js:197-202`). Tudo dentro de um único `TIMELINE_HISTORY.record()` —
Ctrl+Z reverte fps e reescala juntos.

### 2.3 Auto-configuração no primeiro clipe de vídeo

Local: dentro de `TIMELINE_STATE.addCut` (`timelineState.js:439`) — ponto único por onde passam
todos os fluxos (biblioteca `library.js:2031`, player `player.js:479`, chat `chat.js:599`, drop na
timeline `timelineInteraction.js:350`).

Regras:

- Dispara somente se: timeline vazia (`STATE.activeTimelineCuts.length === 0`) **e** o cut é de
  vídeo (não `addPhotoCut`).
- Metadados vêm de `STATE.allVideos` (o banco já tem `fps` e `resolution` no formato `"1920x1080"`
  — `db/schema.py:28`, extraídos pelo ffprobe em `media/ffmpeg.py:32-40`).
- **Ordem crítica:** aplicar o fps **antes** de converter `inSec/outSec` para frames dentro do
  próprio `addCut` (`timelineState.js:462-463`) — senão o clipe inaugural nasce com timing errado.
- fps fracionário (29.97): armazenar o float como veio; timecode continua funcionando
  (`framesToTimecode` arredonda o campo FF).
- Limitação conhecida (documentar, não resolver agora): vídeos de celular com rotação nos metadados
  podem reportar resolução pré-rotação no ffprobe.

### 2.4 Painel de configurações da timeline (clipe nulo)

`renderAdjustmentsPanel(null)` (`timelineInteraction.js:453`) troca o placeholder atual pelo painel:

- **Preset** (select): 1920×1080 (16:9), 1080×1920 (9:16), 3840×2160 (4K), 1080×1080 (1:1),
  Personalizado.
- **Largura / Altura** (inputs numéricos, habilitados no modo Personalizado).
- **FPS** (select): 23.976 / 24 / 25 / 29.97 / 30 / 50 / 60.
- **Proporção** (texto derivado, somente leitura).
- Aviso inline quando há clipes e o fps será reescalado.

Listeners chamam `setTimelineProperties` no `change` (operação pontual → `record()` interno já
basta; sem caminho `oninput` aqui).

Ganchos de abertura (já existem os fluxos):

- Deselecionar clipe já cai em `renderAdjustmentsPanel(null)` (`timelineInteraction.js:362`).
- Abrir a aba Ajustes sem seleção idem (`timelineInteraction.js:54-58`).
- **Novos botões** (engrenagem "Configurações da Sequência"): no cabeçalho do Program player
  (junto a `btn-popout-program`) e na toolbar lateral da timeline (`#timeline-actions-sidebar`).
  Ambos executam: `TIMELINE_STATE.selectedClipId = null; refreshClipInspector();` + ativação da aba
  (reusando a proteção 0.7).

### 2.5 Persistência (as três pontas)

| Ponta | Mudança |
|---|---|
| **Autosave** (`timelineAutosave.js`) | payload += `fps, width, height`; restore aplica antes dos cuts (ver 0.5) |
| **Save backend** (`panels.js:1616-1631` → `api.js:202` → `schemas.py`) | `saveTimeline` ganha `width`/`height` (campos opcionais no schema Pydantic e no armazenamento da sequência) |
| **Load backend** (`panels.js:2179-2208`) | aplicar `sequence.width/height/fps` via `setTimelineProperties` **dentro** do `record()` existente, antes de mapear os cuts (o código já faz `setFps` primeiro — mesmo padrão) |

### Verificação da Fase 2

1. Timeline vazia + vídeo 1080×1920@30 → viewport vira vertical, fps 30, timecode coerente.
2. Segundo vídeo adicionado → **não** reconfigura (só o primeiro).
3. Mudar fps 24→30 com clipes → duração em segundos preservada; Ctrl+Z reverte tudo junto.
4. F5 → resolução e fps persistem (autosave). Salvar/carregar timeline nomeada → idem (backend).
5. Foto como primeiro item → não dispara auto-configuração.

---

## FASE 3 — Zoom de visualização do preview

### 3.1 Escopo deliberadamente contido

**Decisão: opções `Fit / 25% / 50% / 75% / 100%` — sem zoom > 100% nesta fase.** Com
`overflow:hidden` no wrapper e sem mecanismo de pan, 200% mostraria só o centro do quadro sem
navegação — recurso quebrado por design. Pan (espaço+arrastar) + níveis acima de 100% ficam como
Fase 3b explícita, se houver demanda.

### 3.2 Implementação

- `<select id="program-preview-zoom">` na barra de controles do Program (ao lado de
  `program-select-resolution`, `index.html:610-618`), default `Fit`.
- `change` → `TIMELINE_STATE.previewZoom = valor; STATE.emit("previewZoomChanged")` →
  `syncProgramViewport()` já reage (Fase 1.4).
- Em zoom fixo (ex.: 50%), o viewport tem `sequência × 0.5` px, centrado; a área ao redor exibe o
  transbordo escurecido pela máscara — nenhum código novo além do select e do campo de estado.
- Fora do undo, fora do save de backend; persiste só no autosave (preferência de visualização).

### Verificação da Fase 3

1. 50% → viewport encolhe centrado; transbordo de um clipe escalado fica visível e escurecido.
2. Fit → volta a ocupar o painel com a proporção da sequência.
3. Trocar resolução da timeline com zoom fixo → viewport recalcula na hora.

---

## FASE 4 — Alças interativas de transformação (bounding box)

### 4.1 O conceito-chave: content rect (retângulo do conteúdo visível)

Copiar o `transform` do clipe para a caixa **não funciona**: com `object-fit: contain`, a imagem
visível não ocupa a caixa do elemento (letterbox). A caixa precisa envolver a **imagem**, não o
elemento.

**Helper central (compartilhado com o Crop da Fase 5):**

```js
// computeContentRect(mediaEl, fitMode) → { x, y, w, h } em px do viewport, ANTES do transform
// mw/mh = videoWidth/videoHeight (vídeo) ou naturalWidth/naturalHeight (foto)
// s = fitMode === "fit" ? Math.min(VW/mw, VH/mh) : Math.max(VW/mw, VH/mh)
// w = mw*s; h = mh*s; x = (VW-w)/2; y = (VH-h)/2
```

Guarda: se `videoWidth === 0` (metadados ainda não carregados), não desenhar a caixa neste tick —
o compositor roda de novo no próximo frame.

Como `transform-origin` é o centro do elemento e `rotate`/`scale` preservam o centro, o retângulo
final da caixa é direto:

```
centro = (VW/2 + tx% · VW/100 ,  VH/2 + ty% · VH/100)
tamanho = (w · scale ,  h · scale)
rotação = aplicada como transform: rotate() na própria caixa (alças giram junto)
```

Nota: como o viewport é dimensionado em **px reais** (decisão 1.3), px de tela = px de viewport —
nenhuma conversão extra; o nível de zoom do preview já está embutido em VW/VH.

### 4.2 Estrutura e ciclo de vida do overlay

- `#program-transform-overlay` (filho do viewport, `z-index:60`, acima da máscara):
  `position:absolute; inset:0; pointer-events:none` (transparente a cliques quando não há seleção).
- Dentro dele, `#program-transform-box` com `pointer-events:auto`, borda ciano 1px, 4 alças de canto
  (quadrados brancos 8×8, cursores `nwse-resize`/`nesw-resize`).
  **Sem alças de borda**: o modelo só tem `scale` uniforme — alças de borda exigiriam
  `scaleX/scaleY` (mudança de modelo de efeitos, painel e agente de IA). Fora do escopo.
- Visível somente quando: há clipe selecionado **e** ele é de mídia visual **e** o playhead está
  dentro dele (senão o clipe nem está na tela — caixa some).
- Atualização: nas mesmas ocasiões do compositor — `timelineCutsUpdated`, mudança de playhead,
  seleção (via `refreshClipInspector`), `timelineRestored` (0.3) e `syncProgramViewport`.
  O elemento de mídia correspondente é localizado por `dataset.activeClipId` entre as 4 camadas.

### 4.3 Interações de arraste (Pointer Events + transação de histórico)

Padrão idêntico ao dos sliders corrigidos (0.2) — mutação ao vivo + transação:

- `pointerdown` (na caixa ou alça) → `TIMELINE_HISTORY.begin()` + `setPointerCapture` + snapshot
  do estado inicial do gesto (tx/ty/scale, posição do mouse, rect da caixa).
- `pointermove` → calcular novos valores e mutar ao vivo
  (mesmo mecanismo do `oninput`: mutação direta + `STATE.activeTimelineCuts = cuts` → o compositor
  redesenha, mesmo pausado — `player.js:806`).
  - **Mover** (interior da caixa): `tx += Δmouse.x / VW · 100` (idem y).
  - **Escalar** (canto): concêntrica — `scale = scaleInicial · (distânciaAtualAoCentro /
    distânciaInicialAoCentro)`, com mínimo 0.05. Shift **não** trava proporção (já é proporcional
    por natureza).
- `pointerup` → `TIMELINE_HISTORY.commit()` + `showClipInspector(clip)` (uma vez, para os sliders
  do painel refletirem os novos valores).

**Conflito com o clique de play/pause do wrapper (decisão):** o overlay só captura eventos dentro
da caixa quando há seleção. Para não matar o play/pause ao clicar num clipe selecionado:
no `pointerup`, se o deslocamento total < 4px (foi clique, não drag), não consumir — deixar o evento
seguir para o handler do wrapper (`workspaceManager.js:154`). Threshold espelha o padrão do
`clickTimer` existente.

### Verificação da Fase 4

1. Selecionar clipe → caixa envolve exatamente a **imagem visível** (testar com vídeo vertical em
   sequência horizontal, modo `fit` — a caixa deve abraçar o vídeo, não o quadro todo).
2. Arrastar interior → move 1:1 com o cursor (testar em zoom Fit e 50%).
3. Arrastar canto → escala concêntrica; sliders do painel refletem ao soltar.
4. Ctrl+Z → reverte o gesto inteiro (um passo), caixa e painel atualizam.
5. Clique seco no clipe selecionado → play/pause ainda funciona.
6. Rotacionar via slider → caixa gira junto.

---

## FASE 5 — Efeito de Crop

### 5.1 Modelo

Novo tipo no array de efeitos (consistente com os existentes):
`{ type: "crop", left: 0, top: 0, right: 0, bottom: 0 }` — percentuais 0–100 **relativos ao
conteúdo visível** (content rect), com validação `left + right ≤ 90` e `top + bottom ≤ 90`.

**Por que relativo ao conteúdo e não ao elemento:** com `fit`/letterbox, um inset relativo ao
elemento cortaria primeiro a faixa preta — slider que "não faz nada" até certo ponto. Relativo ao
conteúdo, cada 1% corta 1% da imagem. Usa o mesmo `computeContentRect` da Fase 4.

### 5.2 Renderização (em `applyMediaEffects`, `player.js:1127`)

```js
// px do elemento a partir do content rect {x, y, w, h}:
// insetTop    = y + (top/100)    · h
// insetRight  = (VW - x - w) + (right/100) · w   ... etc.
// el.style.clipPath = `inset(...px ...px ...px ...px)`;
// SEM crop: el.style.clipPath = "";  ← reset obrigatório (padrão da função: sempre reatribuir)
```

`clip-path` é aplicado antes do `transform` no pipeline de renderização do navegador → o corte
acompanha posição/escala/rotação do clipe, como esperado. Valores em **px** (não %) porque o
content rect não coincide com a caixa do elemento.

### 5.3 Painel

- Seção "Recorte (Crop)" com 4 sliders (`Esquerda/Direita/Superior/Inferior`, 0–90).
- **Atributo próprio `data-crop`** — nunca `data-prop`: o handler de `data-prop` grava no efeito
  `transform` (`timelineInteraction.js:712`) e corromperia o modelo.
- Handler dedicado com o padrão transacional da 0.2 (`begin()` no `oninput`, `commit()` no
  `onchange`) e clamps par-a-par (mover "Esquerda" além do limite empurra o máximo permitido).
- A caixa da Fase 4 **não** encolhe com o crop (decisão: a caixa representa a mídia transformável;
  o crop é máscara). Igual ao Premiere.

### 5.4 Paridade de exportação (registro de dívida)

O crop existe só no preview (CSS). A exportação via backend precisará do filtro `crop` do ffmpeg
(e os demais efeitos têm a mesma dívida — transform/cor também são só CSS hoje). Fica registrado
como trabalho de backend separado; o campo `effects` já trafega e persiste
(`schemas.py:32`, `panels.js:1626`), então nada se perde.

### Verificação da Fase 5

1. Crop 20% esquerda em vídeo `fit` (com letterbox) → corta 20% **da imagem**, não da faixa preta.
2. Crop + mover/escalar pelas alças → o corte acompanha o clipe.
3. Zerar sliders → `clip-path` limpo (sem resíduo); Ctrl+Z reverte cada gesto.
4. Salvar, F5, recarregar → crop persiste.
5. Ajustar crop no fim do painel → scroll não pula para o topo (0.6).

---

## Riscos e pontos de atenção transversais

- **Fase 1 é a mais invasiva**: mexe no DOM que o pool A/B usa. Mitigação: nenhum id muda, o player
  referencia por id; testar reprodução com 2 pistas sobrepostas (o caso que motivou a estabilidade
  de papéis, `player.js:1062-1074`) logo após a mudança.
- **fps 29.97**: frames continuam inteiros; a conversão frames↔segundos com float é a mesma já usada.
  Testar timecode e sincronia A/V com um arquivo real 29.97.
- **Autosave restaurado com snapshot antigo** (undoStack persistido no localStorage): snapshots
  gravados antes desta reforma não têm os campos novos — o restore deve tolerar `fps/width/height`
  ausentes (defaults).
- **Ordem dos commits**: uma fase por commit (ou menos), com a verificação da fase executada antes
  do commit — as fases 0 e 1 são pré-requisitos reais das demais.
