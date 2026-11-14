# Handoff — ajustes de design da interface (30/09/2026, rodada 3)

Para o próximo chat de design. Lê isto primeiro.

- Canvas da revisão: https://claude.ai/artifact/JDhFzyGPU2hnnxjszUZGtr (quadros 1–7; os quadros 2 e 3
  foram reescritos na rodada 3 com o que ficou).
- Canvas das sugestões da rodada 3: https://claude.ai/artifact/9HtYnTcriGXGthjVhehg4g (um quadro por
  sugestão, antes de implementar).

## Regras que o Fernando definiu (não reabrir)

- **Tamanhos pequenos ficam.** Texto 9–12 px, botões 20–28 px. Padronizar, não aumentar.
- **Painel nunca fica na frente de outro.** Todo painel empurra o centro. Sem espaço, as colunas
  encolhem juntas — nada sai da tela.
- **O usuário escolhe o que fica aberto.** Nada abre ou fecha outro painel sozinho.
- **Tudo retrátil, ajustável na largura e destacável.**
- **Cor de interação: o usuário escolhe numa paleta.** Violeta (seleção da biblioteca), verde (ok) e
  rosa (erro) ficam fora. A seleção violeta e as etiquetas de cor das mídias não mudam com a escolha.
- **Opções novas: o usuário escolhe, o padrão fica como está** (ex.: contraste do texto secundário).
- **Menos negrito.**
- **Push é sempre com o Fernando.** Nunca empurrar para o remoto.

## O que já está na main

| Commit | O quê |
|---|---|
| `13f0148` | Escala de texto `var(--fs-N)` |
| `0e18676` | Cabeçalho compacto (36 px, 8 grupos, `js/headerMenus.js`) |
| `ce5c389` · `d3d00b1` · `a048dea` | Barra fina em coluna; empurra o editor; painéis independentes |
| `c2e52b6` | Janela de Aparência ao vivo |
| `0bb40cc` · `8c7692c` | Colunas encolhem juntas; larguras iniciais proporcionais |
| `1bb2846` | Aparência: "Aplicar em" (global / só este projeto) com aviso e "Voltar a seguir o global"; peso 300–500 passo 10; `ui.text_contrast` (padrão/médio/alto → `--text-muted`) |
| `2e07b6c` | `.btn-primary` segue a cor de interação com texto escuro (`--t-primary-*`); sem escolha, cada primário fica como era (`--primary-bg/-ink/-shadow` no próprio botão) |
| `997dc9a` | Altura inicial da timeline: 36% da altura útil, 240–560 px (`initialTimelineHeight`) |
| `2ab1d78` | Ponto rosa no grupo de IA do cabeçalho quando há análises com falha (evento `capiau:failed-count`) |
| `49cdedb` | Inspetor com Índice · Legenda · IA; Temas e Rostos do clipe viraram seções do Índice ("+ vincular") |
| `10aa783` | Barra fina também em pilha (deitada) e faixa (em pé; faixa toda na barra encolhe) |
| `148c2f4` | Espaçamento do inline em degraus `var(--sp-N)` (19 degraus, `--space-scale`), `theme.css?v=5` |

Os commits `182100d`…`0712f87` (Sistema 1, onboarding, Welcome Hub, NLE, testes) são da outra sessão,
recriados com descrição. **A main local diverge do origin (8 à frente, 8 atrás, mesma árvore no ponto
de divisão): precisa de push forçado, que é com o Fernando.**

## Peças para saber onde mexer

- **Texto:** só `var(--fs-N)`; `node scripts/tema_tokenizar.mjs --write`; teste parte 7.
- **Espaçamento no inline:** só `var(--sp-N)` (1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40,
  48, 56, 64); `node scripts/tema_espacos.mjs --write` (fora da escala desce ao degrau de baixo);
  teste parte 8. Mudou `theme.css`? Suba o `?v=` nas três páginas (o teste confere).
- **Cor de interação:** `--accent` (CSS), `--t-accent` (canvas). Primário: `--t-primary-bg/-ink/-shadow`.
  Primário com cor própria declara `--primary-bg`/`--primary-ink`, nunca `background:` (teste
  `autoteste_aparencia` parte 8).
- **Aparência:** `ThemeManager.save(values, scope)`, `origins`, `projectKeys`, `followGlobal()`.
- **Barra fina:** `PanelRail` — `RAIL_PLACES`, `railLying`, `applyBands`. Anfitrião de pilha usa
  `.dock-stack-self-rail`, não `.rail-mode`.
- **Timeline:** `initialTimelineHeight()` em `workspaceManager.js`.

## Como trabalhar neste repo

- Commit direto na main, um por etapa, só arquivos de design. Se outra sessão estiver ativa, montar
  a partir do HEAD e não `git add` de arquivo inteiro compartilhado.
- Repositório guarda LF; a cópia de trabalho pode ter CRLF ou LF. O aviso "LF will be replaced" é
  normal (autocrlf). Scripts de edição: gravar em arquivo e rodar com `PYTHONUTF8=1` (heredoc pelo
  shell comeu barras e acentos).
- Servidor: Docker na 8000 (monta `src/`). Testes que mudam Configurações gravam no banco: anotar os
  `ui.*` antes e devolver (`POST /api/settings/global/reset` com `keys`). Testes de layout no
  navegador: guardar o `localStorage` antes e devolver. Abrir o Inspetor recolhe o Painel Lateral e
  isso fica salvo.
- Suite Node: `tests/autoteste_*.mjs` e `tests/test_*.js`. Hoje 73+ passam; `test_workspace_numpad_shortcuts`
  e `test_workspace_timeline_expansion` já falhavam antes da rodada 3.

## Rodada 3b (depois do primeiro handoff)

| Commit | O quê |
|---|---|
| `ac85d9e` | Controles e títulos seguem a cor de interação: 1.077 cianos da UI (`scripts/tema_acento.mjs`, teste parte 9). Ficam: :root, cores por tipo, hex no JS, cor guardada como dado, amostras de paleta |
| `17b9f45` | Opção "Abas dos painéis: Em linha / Em pé" (`ui.tabs_mode`, `--t-tabs-mode`) |
| `1378dc3` | Barra fina na janela destacada de um painel: a janela encolhe (`resizeTo`) e volta; sem permissão, a coluna fica na janela do tamanho dela. **Não testado numa janela de verdade** (o navegador de teste abre a janela na mesma aba) |

## Pendentes

1. **Testar a janela destacada encolhendo** no Chrome/Windows de verdade.
2. **`.style.x =` no JS** (1.907): quase tudo calculado; tokenizar rende pouco.
3. **Cabeçalho estreito:** no painel do navegador de teste o grupo de IA, e com ele o ponto de falhas, fica fora da área visível. Conferir numa tela normal.
4. **Densidade:** `--space-scale` já existe; falta a opção na Aparência, se quiser.
5. **Abas em pé escondem a faixa de abas**, e com ela o arrastar de aba para destacar ou trocar de menu. Em pé, destacar fica pelos botões do cabeçalho do painel.
6. **Qdrant local corrompido** ("database disk image is malformed"): busca vetorial fora. Não é de design.
