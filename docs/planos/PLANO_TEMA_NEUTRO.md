# Plano — Tema Neutro, Personalizado e fonte da UI

Data: 28/09/2026 · Status: **F0 commitada** (`506ce49`, branch `talho-tema-neutro`, empilhada sobre o dock) · **F1 commitada** (`3e0d3bf`) · **F2 + F3 prontas** (não commitadas)

## Como ficaram F2 e F3

- **Configurações → Aparência** (categoria `appearance` em `src/services/settings_registry.py`): `ui.theme`,
  `ui.custom_base/step/lines/hue/saturation`, `ui.font_family/weight/scale`. Escopo `both` = global com
  override por projeto, usando as camadas que já existiam.
- **`js/themeManager.js`** calcula o estado `{ theme, vars }` (função pura `computeThemeState`), grava em
  `localStorage["capiau.themeState"]` e entrega ao **`js/themeBoot.js`**, que aplica no `<head>` antes do paint
  e reaplica quando outra janela grava o cache (evento `storage`). Assim as janelas destacadas seguem
  inclusive a prévia. Canvas redesenha via `capiau:theme-applied` → `themeTokens.notifyThemeChanged()`.
- **Prévia ao vivo**: o painel emite `appearanceDraft` (dirty ui.* + slider sendo arrastado); descartar/fechar
  volta ao salvo.
- **Fontes**: 5 famílias OFL em `src/ui/fonts/` (Inter, Outfit, Roboto Flex, IBM Plex Sans Condensed, Barlow
  Semi Condensed), sem Google Fonts. "Padrão" mantém Inter + Outfit; as outras valem para títulos e corpo.
  Famílias escritas direto (`'Outfit', sans-serif`) viraram `var(--font-heading/body)`.
- **Tamanho**: os 1.461 `font-size` em px da UI viraram `calc(Npx * var(--font-scale, 1))` (mesmo script).
- **Título do vídeo** (`playerTextOverlay.js`) ganhou fonte padrão fixa, desligada da fonte da UI.
- **Prova**: Clássico + padrões comparado com F1 em 6.753 elementos (cores, tamanho, família, peso, entrelinha):
  só muda a string de fallback `Outfit, sans-serif` → `Outfit, Inter, sans-serif` (mesma fonte renderizada).
- **Desvios do plano**: (1) a unificação dos ~15 tamanhos soltos numa escala de 6 tokens NÃO foi feita — mudaria
  o visual; o slider global resolve a leitura. Fica como passo opcional. (2) Texto desenhado em canvas (régua e
  rótulos da timeline, `ctx.font = "... 'Outfit'"`) não segue a fonte nem a escala.

## Como ficou a F0

- **Técnica do fallback**: cada cor virou `var(--t-<token>, <cor original>)`. O Clássico não define `--t-*`,
  então é idêntico por construção. Prova: snapshot dos estilos computados de 6.772 elementos antes/depois
  sem diferença (além do ruído normal entre recarregamentos).
- **722 cores** em 13 arquivos, por `scripts/tema_tokenizar.mjs` (regra em `tests/tema_cores.mjs`).
  O script confere que desfazer os tokens devolve o texto original byte a byte.
- **Canvas**: `js/themeTokens.js` (`themeColor(token, fallback)` + `notifyThemeChanged()`); timeline
  (fundo, régua, divisórias, fundo das pistas) e minimapa do player.
- **Trava**: `tests/autoteste_tema_tokens.mjs` falha se entrar cor de fundo/linha/glow fora de token.
- **Regra de significado**: cor cromática em seletor de estado (`.active`, `.selected`, `:focus`, badge, tag,
  clip, marker, erro…) fica. `:hover` sozinho é decoração e neutraliza. Em atribuição JS direta
  (`el.style.x = …`) e dentro de `${…}` só neutros são tokenizados (estado desconhecido).
- **Fora de propósito**: sombras pretas, cinzas/pretos já neutros, `#000` de monitor, texto e ícones.
- Limitação conhecida: aspas duplas dentro de `${}` num `style="…"` encerram a varredura cedo —
  a cor fica como está (nunca quebra).
- Prévia com os valores do Neutro injetados no navegador confirmou que a UI inteira muda, inclusive o canvas.
  Sobras coloridas a revisar na F1 (ex.: faixa ciano do "Assistente de Falas & Pistas").

## Objetivo

1. **Modo Neutro**: todos os fundos quase pretos, sem saturação, com variações de nível.
2. **Modo Personalizado**: poucos controles, e a escala inteira é derivada deles.
3. **Fonte da UI escolhível**, mais fina, priorizando a leitura em espaços pequenos.

Ícones e textos ficam como estão. O tema mexe só em **fundos, linhas, sombras e brilhos**.

## Diagnóstico (medido em 28/09)

| Onde | O que tem |
|---|---|
| `styles.css` (13.7k linhas) | 1.332 cores fixas. `--bg-*` é usado só 5×; `--border-glass` 121× |
| `index.html` | cerca de 225 estilos inline com cor |
| JS (`timelineInteraction`, `panels`, `library`, `main`...) | cerca de 250 estilos inline com cor |
| `timelineRenderer.js` | 120 `fillStyle`/`strokeStyle` fixos, que o CSS não alcança |
| Fontes | Inter + Outfit via Google Fonts (depende de internet), em `index.html`, `panel.html` e `panel-group.html` |
| Tamanhos | cerca de 15 valores soltos entre 7 e 13px (incluindo 9.5 e 11.5), todos em px |

## Decisões

| Tema | Decisão |
|---|---|
| Cor semântica | **Mantém**: clipes, marcadores, seleção, erro/sucesso e waveform. Os brilhos (glow) violeta viram neutros no Neutro |
| Presets | **Neutro** (novo padrão), **Clássico** (o violeta de hoje, idêntico) e **Personalizado** |
| Escala do Neutro | fundos: base `#080808`, `#0d0d0d`, painéis `#101010`, cabeçalhos/inputs `#161616`, hover/ativo `#1e1e1e`. Linhas: fraca `#1c1c1c`, forte `#2a2a2a` |
| Vidro/sombra no Neutro | chapado e opaco, sem blur. Sombra só em menus e modais flutuantes |
| Personalizado | sliders: brilho do fundo base, distância entre níveis, intensidade das linhas, matiz + saturação do tom |
| Fonte | uma família para a UI inteira (títulos se diferenciam só pelo peso). Timecodes seguem em mono |
| Fontes offline (OFL) | Inter variável, IBM Plex Sans Condensed, Roboto Flex, Barlow Semi Condensed. Empacotadas localmente, sem Google Fonts |
| Tamanho | escala de 6 tokens + fator global (90%–120%) |
| Escopo | **global**, com override por projeto (usa as camadas global/projeto que já existem nas configurações) |
| Aplicação | ao vivo, com prévia no slider. Chega às janelas destacadas e a timeline redesenha o canvas |
| Fora do tema | tudo que é conteúdo do vídeo: overlay de texto do player, presets de títulos, cores de legenda, `fontManager`/`fontCatalogModal` |
| Guarda | autoteste que falha se aparecer cor fixa nova fora dos tokens |
| Branch | fechar o trabalho de dock primeiro. O tema nasce numa branch própria a partir da `main` |

## Tokens (contrato)

```
Fundos    --surface-0 … --surface-4
Linhas    --line-weak  --line-strong  --line-focus
Sombra    --shadow-float  (só menus/modais)
Brilho    --glow-accent   (Clássico = violeta; Neutro = none)
Semântica --sem-select --sem-error --sem-ok --sem-warn + cores de clipe/trilha (iguais em todos os presets)
Texto     --text-primary/secondary/muted (inalterados)
Fonte     --font-ui  --font-mono  --font-weight-ui  --font-weight-strong
Tamanho   --fs-2xs --fs-xs --fs-sm --fs-md --fs-lg --fs-xl  (× --font-scale)
```

Os presets são blocos `:root[data-theme="neutro|classico|custom"]` num arquivo `theme.css` separado. O Personalizado é gerado em JS: sliders → HSL → variáveis setadas no `documentElement`.

## Fases

Cada fase fecha num commit próprio e pode ser revertida sozinha.

### F0 — Tokenização invisível
- Criar `theme.css` com o preset **Clássico** reproduzindo exatamente as cores de hoje.
- Trocar as cores fixas de fundo, linha e sombra em `styles.css`, `index.html`, `panel*.html` e JS inline por `var(--…)`.
- Canvas: criar um módulo `themeTokens.js` que lê as variáveis via `getComputedStyle`, guarda em cache e emite `themeChanged`. O `timelineRenderer`, o `player` e a `library` passam a ler dele.
- Ao agrupar cores parecidas num mesmo token, anotar a lista do que foi agrupado.
- **Critério de pronto**: screenshots antes/depois das telas principais (workspace, timeline cheia, biblioteca, inspector, configurações, modais, janela destacada) sem diferença visível.
- Autoteste `tests/autoteste_tema_tokens.mjs`, com allowlist para o conteúdo de vídeo.

### F1 — Preset Neutro
- Bloco `data-theme="neutro"` com a escala acima, sem vidro/blur e sem glow.
- Passar a revisar tela por tela: cada nível deve ser distinguível do vizinho.

### F2 — Personalizado + seção "Aparência" nas Configurações
- Seção nova no painel de configurações, com os campos de tema, sliders e fonte, respeitando o escopo global/projeto.
- Prévia ao vivo. `BroadcastChannel('capiau-theme')` para as janelas destacadas.
- Aplicar o tema **antes do primeiro paint** (script inline no `<head>` lendo o cache local) para evitar o flash do tema antigo ao abrir.

### F3 — Fontes + escala de tamanhos
- Empacotar as 4 fontes (woff2) em `src/ui/fonts/`. Remover o Google Fonts dos 3 HTMLs.
- Mapear os ~15 tamanhos soltos para os 6 tokens e aplicar `--font-scale`.
- Revisar os pontos apertados (abas, cabeçalhos de trilha, rótulos de zoom a 7px) com a fonte condensada a 90%.

## Riscos

- **Diff gigante no `styles.css`**: fazer por blocos de seção e rodar os screenshots a cada bloco.
- **Cor fixa gerada em runtime** (template strings no JS): o autoteste pega as literais; as calculadas precisam de revisão manual.
- **Escala de fonte a 120% em painéis estreitos** pode estourar o layout. Travar em 110% onde for preciso ou usar ellipsis.
- **Inter local vs Google**: pode haver diferença sutil de métrica. Validar com screenshots na F3, que é quando a fonte muda.
