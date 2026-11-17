# Frente D1 — Navegador headless comum e captura por BeginFrame

> **Resumo.** Cria o pacote `src/navegador/`: lança, reaproveita, serve, captura, diagnostica e limpa o Edge/Chrome headless para todo o Talho.
> Traz um servidor HTTP em `127.0.0.1` (GET com Range, PUT ou POST direto para disco, origem segura), `Navegador`/`Pagina` sobre o Playwright que já existe, captura por CDP direto (PNG com alfa, JPEG/WebP rápidos, recorte, deduplicação), diagnóstico barato para o preflight, cancelamento e varredura de processos órfãos.
> `titulos.py` migra para a base sem mudar um pixel (teste A/B por imagem). O Chrome Headless Shell (119,5 MB) entra no catálogo de modelos locais, baixado só a pedido, e liga a captura por BeginFrame como **opção**.
> Esforço: ≈ 9 dias sem BeginFrame, ≈ 12 com ele [inferência; estimativa grossa]. Não depende de outra frente; A, D2, H e B dependem das etapas 1 a 4.
> Principal risco: o BeginFrame não é validado no Windows nem pelo HyperFrames (só liga em Linux) e não preserva alfa, então o ganho pode ser nulo para títulos e sobreposições.
> Decisão mais importante: aprovar o servidor HTTP em loopback (muda a origem do render de títulos e destrava o AudioWorklet da frente A) e tratar o BeginFrame como opcional, condicionado ao spike da Etapa 0.

Convenções: **[lido]** conferido no código; **[inferência]** dedução minha; **[a medir]** precisa de teste prático; **[web: URL]** fonte externa. Citações `arquivo:linha` são relativas à raiz do Talho; `HF:` = HyperFrames; `PW:` = fontes do Playwright baixadas antes (código-fonte do Playwright no GitHub, versão recente, não é repositório do Talho); `CDP:` = especificação do protocolo (arquivos PDL do Chrome DevTools Protocol). Estado conferido em 28/10/2026, commit `9cba1b2`.

---

## 1. Objetivo e valor para o Fernando

Hoje o único consumidor de navegador headless é o render de títulos, e tudo (lançar, servir arquivos, fotografar, fechar) mora dentro de `GeradorTitulos`. As frentes A (áudio do export), C (legendas queimadas), D2 (composições HTML), H (auditoria de contraste) e B (teste de paridade do player) precisam do mesmo navegador. Sem uma base comum, cada uma reinventaria o lançamento, a rota de arquivos, o cancelamento e o diagnóstico.

O que o Fernando ganha:

- **Uma só implementação** de abrir, reaproveitar, cancelar e fechar o Edge/Chrome, com varredura de processo órfão no Windows. Hoje a detecção "tem navegador?" está copiada em dois testes (`tests/test_render_titulos.py:124-132`, `tests/test_fontes_projeto.py:91-100`) e lança um navegador na coleta de testes.
- **Origem segura e transporte decente**: `http://127.0.0.1:porta/<token>/` em vez do host falso `http://titulos.capiau` (inseguro). Destrava o `AudioWorklet` do gate da frente A e troca base64 por CDP por GET com Range e PUT em disco para WAV grande.
- **Captura mais barata e decidida por medição**: CDP direto com formatos e recorte, deduplicação por chave de estado ou por hash, e BeginFrame só se provar ganho no Windows do Fernando.
- **Diagnóstico honesto** no preflight (sem lançar navegador) e completo sob demanda; render que não perde título em silêncio nem deixa Chromium vivo.
- **Chrome Headless Shell opcional** via Configurações > Modelos locais, sem `playwright install` e sem baixar nada sozinho.

O que **não** é objetivo: trocar o grafo FFmpeg, mexer em `player.js`, ou prometer que o BeginFrame acelera. Esta frente mede antes de prometer.

---

## 2. Estado atual no Talho

### 2.1 O que existe

| Peça | Onde | O que faz |
|---|---|---|
| Lançamento | `src/export/video_render/titulos.py:170-196` | `sync_playwright().start()` (179); `launch(channel=canal, headless=True)` sem `args` (183-184); canais `("msedge","chrome",None)` (62); `new_page(viewport=)` (192); `page.route(HOST_INTERNO/**)` (193); `goto` (194); `wait_for_function(..., timeout=15000)` sem `polling` (195) |
| Servidor | `titulos.py:148-168`, `57-59`, `69` | Rota interna em memória: `src/ui` (`RAIZ_UI`), fontes do projeto em `/__fontes/<arquivo>`, MIME de `.js` forçado para `text/javascript`, bloqueio de travessia (162). `HOST_INTERNO = "http://titulos.capiau"`: **origem não segura** |
| Captura | `titulos.py:243-253` | `page.screenshot(path=, omit_background=True)` por estado distinto; a máscara do desfoque usa os bytes (252) e `_gravar_mascara_desfoque` (260-273) lê o alfa |
| Dedupe e cache | `titulos.py:89-111`, `234-244`, `renderTitulos.js:estados` | Chave de estado por quadro, `agrupar_estados`, `ffconcat`; PNG em `base/<hash(chave)>.png`, com `base = _hash(clipe, largura, altura[, fontes])`. **A chave não inclui identidade do navegador** |
| Ciclo de vida | `titulos.py:114-146`, `execucao.py:424`, `511-522`, `600-603` | Um gerador por job; `fechar()` no `finally`; a API síncrona pertence à thread que criou (117-118) |
| Fila | `execucao.py:127-176` | Uma thread daemon `render-video-fila`, um render por vez |
| Cancelamento | `execucao.py:76-124`, `527` | `cancelar_render` mata só o ffmpeg (`_PROCESSOS`); o laço testa `is_cancelled` entre segmentos; **nada dentro de `grupos()` checa cancelamento** |
| Preflight | `fidelidade.py:215-224`, `titulos.py:76-78`, `narrative.py:1095-1100` | Só `find_spec("playwright")`; o preflight é "barato de propósito" (sem ffprobe, sem ffmpeg, sem lançar nada) |
| Catálogo | `src/services/modelos_locais.py:30-45` (dataclass), `154-160` (pastas em `~/.cache/capiau`), `192-200` (`baixado`), `242-295` (`baixar`), rota `src/api/routes/modelos.py:14-26`, tela `src/ui/js/modelosLocais.js:13-18` | Nada baixa sozinho; exceções por id (Canary, YOLO) |
| Configurações | `src/services/settings_registry.py:578-598` | Chaves `render.*` na categoria `timeline`, nível `pro`, escopo `global` |
| Testes | `tests/test_render_titulos.py:124-130,182`, `tests/test_fontes_projeto.py:91-97,120` | Usam o privado `g._abrir(64, 64)` e `g._pagina` |

### 2.2 Invariantes que não podem quebrar

1. **Mesmo código do preview**: `tituloRender.js` + `keyframeEngine.js` desenham o título (`titulos.py:7-10`). Esta frente não toca em JS de título.
2. **PNG RGBA do tamanho do quadro**, fundo transparente, alfa fiel. A máscara do desfoque faz `w = (o - a_t)/(1 - a_t)` por pixel (`titulos.py:32-36,266-273`): qualquer formato com perda ou `optimizeForSpeed` no caminho dos títulos corrompe o alfa. Títulos ficam em PNG, sempre.
3. Chave de estado → `agrupar_estados` → `ffconcat` com o último arquivo repetido (`titulos.py:101-111`). Contrato com `comando.py:633-639` (`titulos(seq, escopo, ini, fim) -> {entradas, camadas, avisos}`).
4. Fontes do projeto continuam por `FontFace` + aviso `fonteDisponivel` (`titulos.py:148-160,219-227`).
5. **Sem navegador, o render sai sem títulos e avisa** (`execucao.py:521-522`; `fidelidade.py:217-224`). Preflight continua sem lançar processo.
6. **Nenhum download sozinho** (`modelos_locais.py:3-9`).
7. Regras P1 a P8 (`modelo.py:17-37`) e o **cenário canônico multipista em cascata** (`tests/test_render_composicao_multipista_cascata.py`, `tests/autoteste_composicao_multipista_cascata.mjs`) seguem verdes em todas as etapas que tocam `titulos.py`, `execucao.py` ou `comando.py`. A frente não altera o grafo nem `player.js`.
8. Thread: o objeto do Playwright síncrono só vale na thread que o criou; rota FastAPI `async def` não pode chamá-lo (usar `def` ou `run_in_threadpool`).

---

## 3. O que o HyperFrames tem

### 3.1 Peças e veredito

| Peça | Onde | Veredito |
|---|---|---|
| Lista de flags de captura | `HF:packages/engine/src/services/browserManager.ts:1051-1097` | Só inspirar-se: quase tudo já é padrão do Playwright (4.4) |
| Flags só de BeginFrame e a regra de remoção | `HF:browserManager.ts:320-334`, `1129-1142` | Adaptar: lista em Python, aplicada só no modo BeginFrame |
| Sonda de BeginFrame (página `data:`, enable, quadro de aquecimento, PNG válido em até 10 tentativas, prazo de 2 s) | `HF:browserManager.ts:344-517` | Adaptar (≈ 60 linhas) |
| Relançar sem os flags quando a sonda falha | `HF:browserManager.ts:873-897` | Adaptar |
| Fechamento com prazo e kill da árvore | `HF:browserManager.ts:401-415`, `907-925` | Adaptar |
| Resolução do shell (env, cache próprio, cache do Puppeteer) | `HF:browserManager.ts:169-272`, `HF:chromeHostCeiling.ts:96-105` | Adaptar para o catálogo (`CAPIAU_HEADLESS_SHELL_DIR`) |
| `shellStarts`: `--no-sandbox --dump-dom about:blank`, sair com 0 em 10 s | `HF:chromeHostCeiling.ts:66-76` | Portar quase literal (teste de partida do binário baixado) |
| Pin de versão do Chrome (`152.0.7977.30`) | `HF:chromeHostCeiling.ts:24-36` | Só inspirar-se: pin no catálogo, com MD5 |
| `beginFrameCapture`, `lastFrameCache`, nova tentativa em "Another frame is pending" | `HF:screenshotService.ts:111-188` | Adaptar |
| Sonda de vida do primeiro quadro (em SwiftShader o HF testou 30 min sem concluir) | `HF:screenshotService.ts:52-99` | Adaptar (prazo por quadro e queda automática para screenshot) |
| Captura por `Page.captureScreenshot` e com alfa | `HF:screenshotService.ts:214-332` | Adaptar: é o caminho do HF no Windows e vira a captura base (Etapa 4) |
| Aquecimento por ticks e primeiro quadro obsoleto | `HF:frameCapture.ts:2605-2660`, `4001-4009` | Adaptar, só no modo BeginFrame |
| `BrowserLeasePool` | `HF:browserLeasePool.ts` | Só inspirar-se: o Talho é síncrono e sequencial; um navegador por job, sem pool |
| Limite de RAM (≤ 8192 MiB = máquina "pequena") e `--js-flags` | `HF:systemMemory.ts`, `HF:browserManager.ts:1001-1006` | Só inspirar-se (RAM por `ctypes`, sem psutil: `src/core/tasks.py:37`) |
| `fileServer.ts` (Hono, MIME, contenção de caminho) | `HF:fileServer.ts:12-159` | Só inspirar-se: o Talho precisa de Range e PUT; implementação nova em stdlib |
| Teste de alfa por pixel | `HF:packages/producer/src/transparency-test.ts:44-85` | Adaptar (pixel transparente α=0, cartão α=255) |
| Política "alfa ou GPU por software ⇒ screenshot" | `HF:frameCapture.ts:1258-1323`, `HF:config.ts:996-1043` | Adaptar como regra de seleção do backend |
| `drawElementImage` (captura rápida) | `HF:drawElementService.ts:1-60`, `HF:config.ts:961-1004` | Não adotar: experimental, só ganha com GPU real ("~46%" sobre `captureScreenshot`) |
| Instalador do shell (`@puppeteer/browsers`, trava por pasta, staging e rename) | `HF:packages/cli/src/browser/manager.ts:714-763` | Só inspirar-se; implementação Python com MD5 (o HF não confere hash) |

### 3.2 Erros e omissões em `docs/PESQUISA_HYPERFRAMES.md` §4.4 (e vizinhas)

1. **"O HF tem binário para win64 também" induz a erro.** O HF só liga BeginFrame com `headlessShell && platform === "linux" && !forceScreenshot` (`HF:browserManager.ts:817-823`, `HF:frameCapture.ts:1269,1315-1321`); o próprio código chama o screenshot de "fallback para onde BeginFrame não existe (macOS, Windows)" (`HF:screenshotService.ts:214-216`). No Windows o HF usa screenshot ou, desde 27/07/2026, `drawElement` com GPU (`HF:config.ts:973-985`). [lido]
2. **"Flags úteis mesmo sem BeginFrame: `--run-all-compositor-stages-before-draw`, `--disable-threaded-animation`, `--disable-checker-imaging`" é o contrário do HF**: são flags só de BeginFrame e o HF os remove no modo screenshot (`HF:browserManager.ts:316-334`, `1129-1142`). [lido]
3. **`--force-color-profile=srgb` e `--force-device-scale-factor=1` já não são pendência.** O Playwright já passa `--force-color-profile=srgb` (`PW:chromiumSwitches.ts`, lista `chromiumSwitches`) e aplica `deviceScaleFactor || 1` em cada página (`PW:crPage.ts:1018-1031`). O "teste de paridade do srgb" descrito no §4.4 já está em produção. [lido]
4. **BeginFrame não preserva alfa** (`HF:frameCapture.ts:1259-1262`), e títulos e sobreposições precisam de alfa. O §4.4 e o §1 (linha 4 da tabela) vendem o BeginFrame para "máquina de escrever e karaokê", que são casos com alfa.
5. **§4.3 propõe `hasDamage` para deduplicar HTML arbitrário**; `hasDamage` só existe no BeginFrame, que no Windows não é o caminho do HF. A dedupe tem de nascer por chave de animação ou por hash (4.5).
6. **§4.1 manda servir o WAV pela "mesma rota interna"**: `http://titulos.capiau` não é contexto seguro, e `BaseAudioContext.audioWorklet` exige contexto seguro [web: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/audioWorklet]. O gate em `AudioWorklet` não carregaria. Corpo de PUT grande via `route` também é frágil (`Network.enable.maxPostDataSize`, `CDP:browser_protocol.json`) [a medir].
7. **§7 diz que o item 5 (D2) "depende de captura rápida" do item 4.** D2 depende do módulo comum, de dedupe e de formatos baratos (etapas 1 a 4 desta frente); o BeginFrame é otimização opcional.

---

## 4. Verificações de viabilidade

| # | Pergunta | Veredito |
|---|---|---|
| 1 | BeginFrame a partir do Python, via Playwright | **Viável com ressalva** com `chrome-headless-shell`; **inviável** com `msedge`/`chrome` |
| 1a | CDP cru por websocket | **Viável com ressalva**: mais código; dá controle do processo (Job Object) |
| 1b | Sidecar Node com puppeteer-core e o engine do HF | Viável, **não recomendado** |
| 1c | `page.screenshot` otimizado (CDP direto) | **Viável**, recomendado como base |
| 2 | Alfa no BeginFrame | **Inviável com a evidência atual** (o HF não faz e diz que o compositor não preserva alfa); só vira "viável com ressalva" se o teste (i) de 4.2 passar. Alfa fica em screenshot |
| 3 | Shell sem `playwright install` | **Viável** (URL e tamanho verificados) |
| 4 | Flags do HF | Das 6 citadas na pesquisa: 2 já ativas, 1 redundante, 3 só de BeginFrame. A testar: hinting, LCD, autoplay e modo de GPU |
| 5 | Desempenho | **Viável com ressalva**: só a codificação foi medida; o resto é [a medir], com plano pronto |
| 6 | Concorrência e ciclo de vida | **Viável**: um navegador por job, órfãos tratados |

### 4.1 Pergunta 1: BeginFrame a partir do Python

**Pista confirmada.** `PW:crBrowser.ts:380` cria páginas com `Target.createTarget({url:'about:blank', browserContextId})`, sem `enableBeginFrameControl`. O PDL diz que o parâmetro é "headless shell only, not supported on MacOS yet" (`CDP:cdp_Target.pdl:162-164`) e que `beginFrame` "requires that the target was created with enabled BeginFrameControl" (`CDP:cdp_HeadlessExperimental.pdl`). [lido]

**Alvo criado à parte aparece como Page?** Sim, por leitura do código [lido + inferência]:

- A sessão raiz faz `Target.setAutoAttach({autoAttach:true, waitForDebuggerOnStart:true, flatten:true})` (`PW:crBrowser.ts:85,92`), então todo alvo `page` novo chega em `_onAttachedToTarget` (`:171-203`), qualquer que seja quem o criou. Vira `CRPage` (`:198-203`) **desde que o `browserContextId` seja de um contexto do Playwright**: contexto desconhecido cai em `_defaultContext`, que é nulo num `launch()` não persistente, e o alvo é desanexado (`:176-181,190-193`).
- `browser.new_browser_cdp_session()` existe (`PW:crBrowser.ts:286-288`); com ela se chama `Target.createTarget({url:"about:blank", browserContextId, enableBeginFrameControl:true, width, height})`. O Python não expõe o `browserContextId`: obtê-lo de `TargetInfo.browserContextId` (`CDP:browser_protocol.json`) por `Target.getTargets` na sessão de navegador, achando a página sentinela criada por `context.new_page()` (URL com marcador único). Capturar a página nova com `with context.expect_page():`.
- `page.context.new_cdp_session(page)` funciona nesse `Page`: faz `Target.attachToTarget({targetId, flatten:true})` pela sessão raiz do cliente (`PW:crBrowser.ts:605-620`, `PW:crConnection.ts:245-248`).

**Funciona com msedge/chrome?** Não. O domínio `HeadlessExperimental` só existe no `chrome-headless-shell`: o Chrome 132 removeu o headless antigo do binário principal [web: https://developer.chrome.com/blog/removing-headless-old-from-chrome] e a equipe do Chromium confirma que virtual time e controle manual de quadros ficam só no `headless_shell` [web: https://groups.google.com/a/chromium.org/g/headless-dev/c/WgNE0CAlx-8]. O HF avisa o mesmo: "HeadlessExperimental.beginFrame is unavailable in regular Chrome builds" (`HF:packages/cli/src/browser/manager.ts:431`). [a medir: `HeadlessExperimental.enable` no Edge do Fernando deve falhar].

**Duas formas de ligar (o spike decide):**

- **H1, flag de lançamento**: `launch(executable_path=<shell>, args=[--enable-begin-frame-control, ...])` e `context.new_page()` normal. O HF faz exatamente isto com Puppeteer: `browser.newPage()` num shell lançado com o flag, sonda com `HeadlessExperimental.beginFrame` e captura (`HF:browserManager.ts:429-475`, `HF:frameCapture.ts:1423`). O comando CDP de criação é o mesmo que o do Playwright, então é provável que funcione [inferência forte].
- **H2, por alvo**: o `createTarget` com `enableBeginFrameControl` acima. Vantagem: só as páginas escolhidas ficam sob controle de quadros, e um mesmo navegador serve títulos (screenshot) e composições (BeginFrame).

Esboço do spike para as duas formas (Playwright Python; **não foi executado**):

```python
b = pw.chromium.launch(executable_path=SHELL, args=ARGS)   # H1: ARGS=["--enable-begin-frame-control"]; H2: ARGS=[]
ctx = b.new_context(viewport={"width": 1920, "height": 1080})
sentinela = ctx.new_page(); sentinela.goto("about:blank#" + token)      # H1: use esta página e pule o bloco H2
bs = b.new_browser_cdp_session()
cid = next(t["browserContextId"] for t in bs.send("Target.getTargets")["targetInfos"] if t["url"].endswith(token))
with ctx.expect_page() as nova:                                          # H2: alvo criado fora do Playwright
    bs.send("Target.createTarget", {"url": "about:blank", "browserContextId": cid, "enableBeginFrameControl": True})
pg = nova.value; cdp = ctx.new_cdp_session(pg)
cdp.send("HeadlessExperimental.enable")                                  # obsoleto; o HF ainda o chama
r = cdp.send("HeadlessExperimental.beginFrame", {"frameTimeTicks": 100, "interval": 33.3, "screenshot": {"format": "png"}})
# esperado: r["hasDamage"] e r["screenshotData"] (base64); pg.screenshot() deve travar; pg.wait_for_function(..., polling=50) deve voltar
```

**Armadilhas do Playwright numa página sob BeginFrame** [lido no HF; a medir aqui]:

- `page.screenshot` trava: `Page.captureScreenshot` "times out in beginFrame mode since the compositor is paused" (`HF:screenshotService.ts:111-115`; também `HF:frameCapture.ts:1259-1268`, "hangs on a BeginFrame browser").
- `page.wait_for_function` usa `requestAnimationFrame` por padrão e não dispara (`HF:frameCapture.ts:2667-2668`). O `titulos.py:195` seria um travamento; o wrapper `Pagina.esperar` usa `polling=<ms>`.
- `--deterministic-mode` pausa o laço de eventos até chegarem quadros; o HF dirige "ticks" de aquecimento durante o `goto` (`HF:frameCapture.ts:2605-2650`). Em API síncrona não há paralelismo: usar `wait_until="commit"` e bombear quadros, ou **não usar `--deterministic-mode`** (variante V1 do spike).
- Primeiro quadro pode vir obsoleto (`HF:frameCapture.ts:4001-4009`); "Another frame is pending" exige nova tentativa (`HF:screenshotService.ts:117-142`); `deviceScaleFactor ≠ 1` não é respeitado (`HF:frameCapture.ts:1290-1295`).
- Em rasterização por software, com muitas camadas promovidas, o primeiro BeginFrame pode travar indefinidamente (`HF:screenshotService.ts:52-67`). O Fernando não tem GPU obrigatória: prazo por quadro e queda automática são requisitos.

**Windows.** No nível do Chromium, um resultado de busca nas listas headless-dev diz que o controle de quadros foi lançado só para Linux e Windows [web: https://groups.google.com/a/chromium.org/g/headless-dev; post antigo, não aberto por inteiro nesta sessão]; o CDP só exclui macOS (`CDP:cdp_Target.pdl:162-164`). Mas o HF nunca o liga em `win32` [lido]. Trate como **não validado**.

**Alternativas comparadas**

| | (a) CDP cru por websocket | (b) Sidecar Node (puppeteer-core + engine do HF) | (c) `page.screenshot` otimizado |
|---|---|---|---|
| Esforço | 3 a 4 dias [inferência] | 5 a 7 dias [inferência] | 1 dia (Etapa 4) |
| O que precisa existir | Cliente CDP próprio (≈ 300-400 linhas: sessões, eventos, prazos); `websockets` já vem com `uvicorn[standard]` (`requirements.txt:2`) [versão a conferir] | Node ≥ 22 (`HF:packages/engine/package.json:103`), `npm install`, IPC por stdin/stdout; o engine é TypeScript cru (`HF:packages/engine/package.json:15-16`) que puxa `@hyperframes/core` e `puppeteer ^25.8` (`:93-94`) | Nada novo |
| Manutenção | Dois caminhos (Playwright para Edge, cru para o shell) | Dois ecossistemas e duas toolchains | Um caminho |
| Empacotamento no Windows | Só o zip do shell | Node no PATH do servidor (o Fernando tem Node para os autotestes; versão não conferida) | Nenhum |
| Desempenho | Igual ao Playwright no BeginFrame, menos overhead por chamada | Igual; mais um salto de processo | Tira ≈ 6 idas e vindas por foto; JPEG/WebP rápidos para opacos |
| Ganho exclusivo | Talho lança o processo: **Job Object `KILL_ON_JOB_CLOSE` elimina órfãos** | Código do HF já provado em Linux | É o caminho do próprio HF no Windows |
| Risco | Casos de borda do protocolo | Alto: toolchain, versões, um runtime a mais | Baixo |
| Veredito | **Reserva** se o spike mostrar que o Playwright não conduz o shell e o ganho justificar | **Rejeitar** | **Base** |

O que verifiquei e o que suponho: li o Playwright, o PDL e o HF; fiz `HEAD` no storage do Chrome for Testing (4.3) e um micro-benchmark de codificação em memória (4.5); **não executei navegador nem código do HF** (regra desta tarefa). O comportamento do shell sob Playwright (H1/H2) é inferência a confirmar no spike.

### 4.2 Pergunta 2: transparência

- **HF não captura alfa por BeginFrame.** Comentário explícito: "BeginFrame's compositor does not preserve alpha" (`HF:frameCapture.ts:1259-1262`); formato com alfa força screenshot. O alfa do HF vem de `Emulation.setDefaultBackgroundColorOverride {r:0,g:0,b:0,a:0}` + `html,body{background:transparent !important}` + `Page.captureScreenshot` PNG com `optimizeForSpeed:false` (`HF:screenshotService.ts:243-332`), porque `true` "esmaga" valores de alfa para 0 ou 255 (`:218-222,271,328`). [lido]
- **O Talho já faz o equivalente**: `omit_background=True` liga o mesmo override (`PW:screenshotter.ts:296-314`, `PW:crPage.ts:272`) e `render_titulos.html` zera o fundo de `html, body`. O Playwright não passa `optimizeForSpeed` (`PW:crPage.ts:296`), o que preserva o alfa parcial.
- **Se o spike quiser tentar alfa no BeginFrame**: (i) `setDefaultBackgroundColorOverride(a=0)` + `screenshot:{format:"png"}` sem `optimizeForSpeed`, inspecionando os pixels como em `HF:transparency-test.ts:44-85` (fora α=0, cartão α=255, caixa a 50% α≈128): 15 linhas, [a medir]. (ii) *Matte* em dois fundos (preto e branco): α = 1 − (W−B)/255 por canal, o dobro de capturas e PNG obrigatório; não compensa [inferência].
- **Veredito**: alfa sempre por screenshot (CDP direto). BeginFrame com alfa só se (i) passar no spike.

### 4.3 Pergunta 3: chrome-headless-shell sem `playwright install`

- **Fonte**: Chrome for Testing. Endpoints JSON [web: https://github.com/GoogleChromeLabs/chrome-for-testing]: `last-known-good-versions-with-downloads.json`, `known-good-versions-with-downloads.json`, `latest-versions-per-milestone-with-downloads.json`, entre outros, em `https://googlechromelabs.github.io/chrome-for-testing/`. O README não documenta o esquema; o host não resolve nesta sessão, então o JSON não foi lido. Forma esperada: `channels.Stable.version` e `channels.Stable.downloads["chrome-headless-shell"][]` com `platform` e `url` [inferência; confirmar na implementação].
- **URL do zip win64** (padrão confirmado por `HEAD`, HTTP 200, em 28/10/2026, sem baixar): `https://storage.googleapis.com/chrome-for-testing-public/<versão>/win64/chrome-headless-shell-win64.zip`.

| Versão | Tamanho | MD5 (cabeçalho `x-goog-hash`, base64 → hex) |
|---|---:|---|
| `152.0.7977.30` (pin do HF) | 119 527 247 B (≈ 114 MiB) | `3a1c9321a297bf0363a44de06b87c567` |
| `131.0.6778.85` | 105 954 733 B (≈ 101 MiB) | `135fe67e9d85d9b44fefa5bf9814efe9` |
| `chrome-win64.zip` 152 (para comparar) | 202 639 669 B | n/d |

- **Conteúdo**: pasta `chrome-headless-shell-win64/` com `chrome-headless-shell.exe` (`HF:browserManager.ts:176`, `HF:packages/cli/src/browser/manager.ts:374`). Tamanho instalado ≈ 300 MB [inferência; a medir].
- **Como usar sem `playwright install`**: `chromium.launch(executable_path=...)`. É o caminho oficial: sem canal, `headless=True` já pede `chromium-headless-shell` (`PW:chromium.ts:423`), com `--remote-debugging-pipe` (`:358`), `--no-startup-window` (`:362`), `--headless` (`:381`) e os `args` do chamador no fim (`:410`).
- **Integração com o catálogo**: ver 6.3. Nada baixa sozinho; botão em Modelos locais; MD5 conferido; teste de partida (`--dump-dom about:blank`).
- **Pin**: a versão **stable** vigente no dia da implementação, resolvida por um script de manutenção (`scripts/atualizar_pino_headless_shell.py`), nunca em tempo de execução. O `152.0.7977.30` é candidato verificado (o HF o escolheu "Beta, não Canary", `HF:chromeHostCeiling.ts:24-26`); para BeginFrame prefira Stable. O MD5 só detecta corrupção: gravar também o SHA-256 calculado na primeira instalação (o `HEAD` não o fornece).
- **Veredito**: viável. Atenção de licença: build com marca Google; o Talho **não redistribui**, o Fernando baixa do Google [inferência sobre os termos; mostrar aviso na tela].

### 4.4 Pergunta 4: flags

Já ativas no Playwright (lista `chromiumSwitches`, `PW:chromiumSwitches.ts`): `--force-color-profile=srgb`, `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`, `--disable-ipc-flooding-protection`, `--disable-hang-monitor`, `--disable-breakpad`, `--disable-component-update`, `--disable-sync`, `--enable-features=CDPScreenshotNewSurface`. Em headless ele soma `--hide-scrollbars`, `--mute-audio` e `--no-sandbox` (`PW:chromium.ts:381-390`). [lido]

| Flag (`HF:browserManager.ts`, linha) | Situação | Pode piorar a paridade com o preview? | Teste que decide | Decisão provisória |
|---|---|---|---|---|
| `--force-color-profile=srgb` (`:1062`) | Já ativa | Não (já é o comportamento atual) | Nenhum | Manter; encerra a pendência do §4.4 |
| `--force-device-scale-factor=1` (`:1063`) | Redundante (override por página) | Não | Nenhum | Não adicionar |
| `--font-render-hinting=none` (`:1061`) | Não | **Sim, é o principal suspeito**: flag do headless; no Windows (DirectWrite) o efeito é incerto e pode afastar do Edge visível, que usa o hinting do sistema | **T-HINT** | Só adotar se mudar pixels **e** reduzir o erro contra o Edge visível |
| `--disable-lcd-text` | Não | Provável nulo (texto sobre fundo transparente já é cinza) | **T-LCD** | Provável: não adotar |
| `--run-all-compositor-stages-before-draw`, `--disable-threaded-animation`, `--disable-threaded-scrolling`, `--disable-checker-imaging`, `--disable-image-animation-resync`, `--disable-new-content-rendering-timeout` (`:1135-1141`) | Não | Só de BeginFrame no HF; fora dele o HF os remove (`:316-334`) | Nenhum fora do BeginFrame | Usar **apenas** no modo BeginFrame |
| `--enable-begin-frame-control`, `--enable-surface-synchronization` | Não | Idem | Spike | Só BeginFrame |
| `--deterministic-mode` (`:1132`) | Não | Pausa o laço de eventos (`HF:frameCapture.ts:2605`) | Spike V1 contra V2 | Só se a V2 for necessária |
| `--autoplay-policy=no-user-gesture-required` (`:1096`) | Não | Não afeta pixel | **T-AUTOPLAY** (`new AudioContext().state`) | Adotar só nas páginas de A e D2 |
| `--disable-features=...` e `--enable-features=...` (`:1090`, `:1057`) | O Playwright já passa os seus | **Perigo**: o Chromium usa o último `--disable-features`; passar outro substitui a lista do Playwright e remove `CDPScreenshotNewSurface` [inferência; a medir] | Nenhum: proibido por teste (AC8). `SystemInfo.getInfo().commandLine` mostra o que chegou ao navegador (`CDP:browser_protocol.json`) | **Não passar**; se preciso, mesclar a lista inteira |
| Modo de GPU: `--use-angle=swiftshader`, `--disable-gpu`, `--disable-gpu-compositing` (`:1125-1127`, `:1208-1249`) | Não | **Sim**: muda a rasterização de blur e sombras e pode invalidar `FATOR_SIGMA_DESFOQUE = 1.05` (`titulos.py:64-66`) | **T-GPU**: rodar `test_desfoque_da_caixa_igual_ao_preview` em cada modo | Não mexer para títulos |
| `--js-flags=--max-old-space-size`, `--disk-cache-size` (`:1005,1087`) | Não | Não afeta pixel | Medição de RSS | Só se RAM ≤ 8 GB |

**Harness de decisão** (`scripts/paridade_flags_navegador.py`, Etapa 5). Corpus de 12 títulos (Outfit/Inter/Barlow, pesos 300 e 700, itálico, 24/48/96 px, com e sem caixa e `backdrop-filter`, rotação 5°, escala 1,2, sombra) em 1920×1080 e 1280×720. Configurações: C0 (produção hoje), C0 repetida (determinismo), C0+flag, shell em screenshot, **Edge visível** (`headless=False`, escala do Windows em 100%) como referência de preview; com outra escala o preview real do Fernando difere por construção. Métricas por par: pixels com |Δ|>2 em algum canal, erro médio absoluto e p99,9 sobre RGBA pré-multiplicado, PSNR. **Regra**: adotar flag só se (a) reduzir o erro médio contra o Edge visível em ≥ 20% sem piorar o p99,9, ou (b) for idêntico bit a bit e trouxer ≥ 15% de velocidade ou estabilidade. Duas execuções de C0 têm de ser idênticas (senão não há base para comparar).

### 4.5 Pergunta 5: desempenho

**Medido aqui** (PIL + zlib, em memória, sandbox Xeon 2,1 GHz; só a **codificação** de 1920×1080, melhor de 5; o Chromium usa Skia e zlib próprios, então vale a ordem de grandeza; script de rascunho fora do repositório; a Etapa 4 refaz a medição com o Chromium de verdade):

| Quadro | PNG nível 1 | PNG nível 6 | JPEG q85 |
|---|---:|---:|---:|
| Título esparso (caixa translúcida + texto, ~5% dos pixels) | 28 ms, 145 KB | 46 ms, 171 KB | 4 ms, 61 KB |
| Quadro cheio (gradiente + grão, opaco) | 301 ms, 4,5 MB | 1 420 ms, 3,9 MB | 6 ms, 231 KB |

**Custo de um `page.screenshot` 1080p PNG com alfa** [inferência, soma de partes]: o Playwright faz ≈ 6 idas e vindas por foto (preparo e `document.fonts.ready` em `PW:screenshotter.ts:251-259`, override de fundo ligado e desligado `:296-314`, `Page.getLayoutMetrics` e `Page.captureScreenshot` em `PW:crPage.ts:276,296`, restauro), sem `optimizeForSpeed`. Estimativa **40 a 120 ms** por foto de título (codificação 15-45 ms no i7-10700 + leitura da superfície + transferência) e **0,4 a 1,6 s** por quadro cheio, onde o PNG domina. **Não há medição de BeginFrame contra screenshot em lugar nenhum dos repositórios**: o único número de velocidade no HF é o do `drawElement` ("~46% mais rápido", `HF:drawElementService.ts:10`). [a medir]

**O que o BeginFrame economiza**: (i) as idas e vindas (≈ 5-15 ms por foto, [inferência]); (ii) quadros sem dano (`hasDamage:false` dispensa leitura e codificação: `HF:screenshotService.ts:159-182`), só em captura sem alfa; (iii) **não** economiza a codificação PNG, que é o gasto dominante. O que domina é o formato: o JPEG custa 1/7 (título esparso) a 1/230 (quadro cheio) do PNG na codificação, mas não tem alfa; WebP com alfa não foi medido, nem se o FFmpeg o lê [a medir].

**O que a deduplicação evita**: título com fade de 0,3 s a 30 fps tem ≈ 10 estados em qualquer duração (`tests/test_render_titulos.py:146` espera 5 a 12 fotos para 30 quadros); em 5 s são 150 quadros e ≈ 10 fotos, **15× menos**. Para HTML arbitrário (D2): chave de animação (`document.getAnimations()` após o seek) evita fotos (estimativa 5-10× num GC que anima 0,5 s na entrada e na saída); hash de pixels só reduz arquivos e o `ffconcat`, porque a foto já foi paga; `hasDamage` evita a foto, mas só no BeginFrame sem alfa.

**Plano de medição** (`scripts/medir_captura_navegador.py`, Etapa 4, no Edge do Fernando e no shell): matriz {`page.screenshot`, CDP direto} × {PNG alfa, WebP alfa q90, JPEG q85 `optimizeForSpeed`} × {título esparso, quadro cheio, 3 composições de exemplo} × 100 repetições intercaladas após 10 de aquecimento. Registrar p50/p95 de ms, bytes e RSS da árvore. Se o CDP direto não for ≥ 15% mais rápido que `page.screenshot` com saída idêntica, os títulos ficam no `page.screenshot`.

### 4.6 Pergunta 6: concorrência e ciclo de vida

- **Um navegador por job**, criado de forma preguiçosa por `_render_job`, passado a `GeradorTitulos` e à frente A, fechado no `finally` (`execucao.py:600-603`). A fila é sequencial (`execucao.py:127-176`); o `Navegador` não atravessa threads. Reuso entre jobs fica fora (arranque a frio ≈ 1-2 s [a medir], pouco perto de um render).
- **Páginas**: uma por papel (títulos, áudio, composição), no máximo duas vivas; fechar a página quando o papel acaba (libera o renderer).
- **Paralelismo**: 1 por padrão. Dois workers = dois `Navegador` em duas threads, cada um com seu `sync_playwright()`. Só se medir ≥ 1,5× em 300 quadros opacos e RSS total ≤ 2 GB. O HF paraleliza com vários navegadores (`HF:packages/engine/src/services/parallelCoordinator.ts`).
- **Memória**: medir a árvore (PIDs por `SystemInfo.getProcessInfo` numa sessão de navegador, `CDP:browser_protocol.json`; memória por `GetProcessMemoryInfo` via `ctypes`, sem psutil). Meta a validar: pico ≤ 1 GB, ocioso ≤ 700 MB. Com RAM ≤ 8 GB aplicar `--js-flags=--max-old-space-size=512` (`HF:browserManager.ts:1001-1006`).
- **Cancelamento** em duas camadas: cooperativo (`cancelado()` entre fotos, latência ≤ uma foto) e rígido (`Navegador.abortar()` de outra thread: marca e mata a árvore; a chamada bloqueada levanta `TargetClosedError` e vira `CapturaCancelada`). `execucao.cancelar_render` passa a chamar `abortar()` do navegador registrado por timeline, análogo a `_PROCESSOS` (`execucao.py:76-124`).
- **Fechar com prazo**: `browser.close()` numa thread auxiliar com limite de 10 s; vencido, `taskkill /F /T` nos PIDs registrados (`HF:browserManager.ts:401-415,907-925`).
- **Órfãos no Windows**: a thread da fila é `daemon` (`execucao.py:143-145`), então o `finally` pode não rodar no desligamento. Arquivo `data/cache/navegador/pids/<pid_dono>-<token>.json` com dono, hora de criação, PIDs e executável; varredura ao criar o primeiro `Navegador` do processo e no `lifespan` (`src/api/server.py:53-56`): dono morto (`OpenProcess`, `src/core/tasks.py:36-64`) e imagem do PID igual à registrada (`QueryFullProcessImageNameW`) ⇒ `taskkill /F /T`. Nunca mata por nome. Registro em memória (`WeakSet`) + `atexit` para `abortar_todos()`. Opcional: Job Object com `KILL_ON_JOB_CLOSE` nos PIDs do navegador [a medir]. Expectativa: o driver do Playwright encerra o navegador quando o pipe fecha, então o caso real de órfão é kill duro de toda a árvore ou navegador travado [inferência; S8 mede].
- **Outras verificações que as frentes dependentes precisam**: `http://127.0.0.1` é contexto seguro [inferência da especificação; teste: `window.isSecureContext` no diagnóstico completo]; o `Navegador` falha com mensagem clara se criado em thread com laço asyncio ativo.

---

## 5. Decisões de projeto

| # | Decisão | Alternativas (prós e contras) | Recomendação |
|---|---|---|---|
| D1 | Transporte de arquivos para o navegador | (a) `page.route` em memória, como hoje: sem porta e já provado nos títulos, mas origem insegura, sem Range para `<video>`/`<audio>`, corpo grande por CDP em base64, e `Fetch` em página sob tempo virtual é terreno incerto. (b) Servidor HTTP em `127.0.0.1`: origem segura, Range, PUT em disco, independe do CDP; custa uma porta e uma thread. (c) `file://`: sem servidor, mas a origem opaca quebra módulos ES e `fetch` | **(b)**: porta efêmera, token no caminho, checagem de `Host`, só loopback |
| D2 | Biblioteca | Playwright (já dependência, `requirements.txt:25`); CDP cru; sidecar Node | **Playwright** para tudo; CDP cru só como reserva do BeginFrame (4.1) |
| D3 | Backend de captura padrão | `page.screenshot`; CDP direto; BeginFrame | **Screenshot**. CDP direto só se passar o critério AC10; BeginFrame opt-in até os critérios de 10.2; alfa nunca por BeginFrame sem prova (4.2) |
| D4 | Escopo do navegador | Por job; quente por thread; pool | **Por job**, fechado no `finally`. Quente fica como evolução: ganho ≈ 1-2 s |
| D5 | Onde mora o código | `src/navegador/` ou dentro de `video_render/` | **`src/navegador/`**: A, H e B não são render de vídeo e `services/` não deve importar `export/video_render/` |
| D6 | Onde fica o shell | `~/.cache/capiau/chrome-headless-shell/<versão>/` ou `data/` | **Cache do usuário**, como Canary e YOLO (`modelos_locais.py:154-160`), com `CAPIAU_HEADLESS_SHELL_DIR` |
| D7 | Regressão por imagem | PNGs de referência no repositório; ou A/B no mesmo processo | **A/B no mesmo processo**, com cópia congelada do caminho antigo dentro do teste. Fonte e rasterização variam por máquina: referência de uma não vale em outra. Referência local opcional, não versionada |
| D8 | Sandbox do Chromium | `--no-sandbox` (padrão do Playwright, `PW:chromium.ts:389-390`) ou `chromium_sandbox=True` | **Ligar no Windows** com retorno automático e aviso se não subir; obrigatório quando D2 carregar HTML de terceiros [a medir no spike] |
| D9 | Identidade do renderizador no cache | Ignorar (hoje) ou `assinatura()` na chave | **`assinatura()`** = hash(canal, versão maior, modo de captura, flags aprovadas, versão do módulo). Custa um cache frio. Sem isso, trocar Edge por shell mistura fotos de motores diferentes no mesmo render |
| D10 | Rede nas páginas | Livre; só local + Google Fonts; só local | Títulos: como hoje. D2: **local + fontes**, por cabeçalho `Content-Security-Policy` do servidor local (sem `Fetch`); bloqueio vira aviso. Opcional, Etapa 2 |
| D11 | Escolha do navegador | Fixa ou configurável | Ordem `msedge → chrome → shell → chromium do Playwright` (hoje `msedge → chrome → chromium`, `titulos.py:62`); BeginFrame só no shell; `render.navegador_preferido` e `render.navegador_caminho` forçam |

---

## 6. Modelo de dados e compatibilidade

### 6.1 Configurações (`settings_registry.py`, após `render.threads`, linha ~598)

Categoria `timeline`, nível `pro`, escopo `global`, `requires_reprocess: False`, no estilo das chaves `render.*` existentes.

| Chave | Tipo e padrão | Efeito |
|---|---|---|
| `render.navegador_captura` | enum `auto`, `screenshot`, `beginframe`; padrão `auto` | `auto` = `screenshot` até a Etapa 8 virar `BEGINFRAME_PADRAO_LIGADO`. `beginframe` exige shell e sonda ok; senão cai para screenshot e avisa |
| `render.navegador_preferido` | enum `auto`, `msedge`, `chrome`, `headless_shell`; padrão `auto` | Força o navegador dos títulos e composições |
| `render.navegador_caminho` | string; padrão vazio | Executável próprio; vence o `preferido` (como `HYPERFRAMES_BROWSER_PATH`, `HF:chromeHostCeiling.ts:96-105`) |
| `render.navegador_sandbox` | enum `auto`, `ligado`, `desligado`; padrão `auto` | `auto` tenta com sandbox e volta sem, com aviso |

### 6.2 Cache em disco

- `data/cache/titulos/<base>/<hash>.png`: formato igual; `base` passa a incluir `assinatura()` (D9). Pasta nova na primeira execução, pastas antigas ficam órfãs: apagar as sem acesso há > 30 dias no início do job (opcional).
- Novo `data/cache/navegador/`: `pids/` (registro de órfãos), `sondas.json` (resultado da sonda de BeginFrame por caminho+mtime do shell, build do Windows e modo de GPU; validade 30 dias), medições do spike.
- Shell: `~/.cache/capiau/chrome-headless-shell/<versão>/chrome-headless-shell-win64/` + `versao.json` com versão, MD5 e data.
- Temporário do job: `<tmpdir do job>/navegador/` (saídas de PUT, fotos intermediárias), apagado com o `tmpdir` (`execucao.py`, `_limpar`). Perfil do navegador: o temporário do Playwright, nunca persistente.

### 6.3 Catálogo de modelos locais (`modelos_locais.py`)

Entrada nova no `CATALOGO` (a partir da linha 70): `id="chrome_headless_shell"`, `nome="Chrome Headless Shell (Chrome for Testing)"`, `uso="Navegador sem janela do Google para a captura por quadro controlado (BeginFrame); sem ele o render usa o Edge/Chrome instalado"`, `tamanho_mb=120`, `ambiente="principal"`, `pacotes=("playwright",)`, `repo=None`, `configuracao=("render.navegador_captura=beginframe",)`, `obs` com a origem (`storage.googleapis.com`), MD5 conferido, aviso de que o build é do Google e não é redistribuído pelo Talho. Código:

- `baixado()` (192-200): ramo `m.id == "chrome_headless_shell"` → `headless_shell.localizar() is not None` (hoje `bool(m.repo) and ...` daria sempre falso).
- `baixar()` (275-295): ramo `elif m.id == "chrome_headless_shell"` → `headless_shell.instalar(progresso=...)` na thread existente; `_tarefas[id]` ganha `progresso` (0 a 1) sem quebrar quem lê só `status` e `erro`.
- `estado()` (202-211): campos extras `versao` e `caminho` quando instalado. `exigir()` (218-229) já serve: levanta `ModeloNaoBaixado` com o tamanho.
- Tela (`modelosLocais.js:13-18`, `cartao` em `111-166`): rótulo `"render.navegador_captura": "Captura do navegador no render"`; mostrar "baixando… 63%" e a versão. Sem `termos_url` (não há conta a aceitar).
- `GET /api/modelos` e `POST /api/modelos/{id}/baixar` (`routes/modelos.py:14-26`) não mudam.

### 6.4 Compatibilidade

- `GeradorTitulos(pasta_cache, canais=CANAIS, fontes=None)`, `.quadros`, `.grupos`, `.fechar`, `.avisos`, `preparar_titulos`, `agrupar_estados`, `escrever_ffconcat` e `TitulosIndisponiveis` ficam como estão. Kwargs novos, opcionais: `navegador=None`, `cancelado=None`. `_abrir()` e `_pagina` (= `Pagina.pw`) continuam existindo como alias até os dois testes migrarem (`tests/test_render_titulos.py:129,182`, `tests/test_fontes_projeto.py:97,120`). `HOST_INTERNO` e `PAGINA` deixam de ser usados (só `titulos.py` os referencia [lido por grep]); manter as constantes por uma versão.
- Nenhuma mudança de esquema de banco. Nenhuma dependência pip nova (`requests` já está; `zipfile`, `hashlib`, `http.server`, `ctypes` são da stdlib). `websockets` só se o CDP cru (4.1a) for adotado.
- Windows: `pathlib`, `taskkill`, `ctypes`; nomes de arquivo sem acento em `src/navegador/`.
- Código portado do HyperFrames leva cabeçalho "adaptado de HyperFrames, Copyright 2026 HeyGen, Inc., Apache-2.0; portado de TypeScript para Python" e entrada na seção de créditos.

---

## 7. Mudanças por arquivo

### 7.1 Interface pública (assinaturas que A, C, D2, H e B consomem)

```python
# src/navegador/__init__.py (novo). Tudo síncrono; um Navegador por job e por thread.
class NavegadorIndisponivel(RuntimeError): ...      # sem playwright ou sem navegador utilizável
class CapturaCancelada(Exception): ...             # cancelado() verdadeiro ou abortar() chamado
class BeginFrameIndisponivel(RuntimeError): ...     # sonda falhou ou navegador sem o domínio

@dataclass(frozen=True)
class InfoNavegador:
    canal: str                     # "msedge" | "chrome" | "headless_shell" | "playwright" | "caminho"
    caminho: str | None; versao: str; headless_shell: bool
    capturas: tuple[str, ...]      # ("screenshot",) ou ("screenshot", "beginframe")
    gpu: str; contexto_seguro: bool; sandbox: bool

class Navegador:
    def __init__(self, pasta_trabalho: Path, *, preferir: str = "auto", captura: str = "auto",
                 fontes: Sequence[Mapping[str, Any]] = (), cancelado: Callable[[], bool] | None = None,
                 args_extra: Sequence[str] = (), rotulo: str = "") -> None: ...
    def __enter__(self) -> "Navegador": ...
    def __exit__(self, *exc) -> None: ...
    def fechar(self, *, forcar: bool = False) -> None: ...     # idempotente; prazo de 10 s e depois mata a árvore
    def abortar(self) -> None: ...                             # qualquer thread: marca e mata a árvore
    @property
    def info(self) -> InfoNavegador: ...                       # lança o navegador na 1ª leitura
    @property
    def servidor(self) -> "ServidorLocal": ...                 # sobe na 1ª leitura; já publica ui/ (src/ui) e fontes/ (fontes do projeto)
    def assinatura(self) -> str: ...                           # entra na chave do cache de fotos
    def pagina(self, largura: int, altura: int, *, captura: str | None = None,
               fundo_transparente: bool = True, rotulo: str = "") -> "Pagina": ...

@dataclass(frozen=True)
class Saida:                                                   # destino de um PUT feito pela página
    url: str; caminho: Path
    def recebida(self) -> bool: ...
    def tamanho(self) -> int: ...

class ServidorLocal:                                           # http://127.0.0.1:<porta>/<token>/<prefixo>/...
    @property
    def url_base(self) -> str: ...
    def publicar_pasta(self, prefixo: str, pasta: Path) -> str: ...                    # GET/HEAD/Range; devolve a URL base
    def publicar_arquivo(self, prefixo: str, caminho: Path) -> str: ...
    def publicar_mapa(self, prefixo: str, arquivos: Mapping[str, Path]) -> str: ...    # ex.: fontes do projeto
    def reservar_saida(self, nome: str, *, limite_bytes: int = 1 << 30) -> Saida: ...  # PUT ou POST atômico em disco
    def responder_json(self, prefixo: str, corpo: Any) -> str: ...                     # resposta fixa (ex.: /api de mentira no teste B)

@dataclass(frozen=True)
class Quadro:
    dados: bytes | None; caminho: Path | None; formato: str
    largura: int; altura: int; ms: float; com_dano: bool | None   # com_dano só no BeginFrame

@dataclass(frozen=True)
class PedidoQuadro:
    indice: int; js_antes: str | None = None; arg: Any = None; chave: str | None = None

@dataclass(frozen=True)
class QuadroGravado:
    indice: int; caminho: Path; repete_anterior: bool; ms: float; com_dano: bool | None

class Pagina:
    modo: str                                                  # "screenshot" | "beginframe"
    pw: Any                                                    # a Page do Playwright (interno e testes; as frentes não usam)
    def abrir(self, url_relativa: str, *, pronto: str | None = None, timeout_s: float = 15.0) -> None: ...  # relativa a servidor.url_base
    def avaliar(self, js: str, arg: Any = None) -> Any: ...
    def esperar(self, js: str, *, timeout_s: float = 15.0, intervalo_ms: int = 25) -> None: ...  # nunca por rAF
    def redimensionar(self, largura: int, altura: int) -> None: ...
    def capturar(self, *, formato: str = "png", qualidade: int = 90, alfa: bool = True,
                 recorte: tuple[int, int, int, int] | None = None, destino: Path | None = None) -> Quadro: ...  # recorte = (x, y, largura, altura)
    def capturar_quadros(self, pedidos: Iterable[PedidoQuadro], pasta: Path, *, fps: float,
                         formato: str = "png", dedupe: str = "chave",         # "chave" | "hash" | "dano" | "nenhum"
                         progresso: Callable[[int, int], None] | None = None) -> Iterator[QuadroGravado]: ...
    def fechar(self) -> None: ...

def diagnostico_barato() -> dict: ...                          # sem lançar nada: preflight (< 100 ms)
def diagnosticar(*, sondar_beginframe: bool = False, timeout_s: float = 30.0) -> dict: ...   # lança, mede, fecha
def navegador_utilizavel() -> bool: ...                        # cacheada por processo; substitui os dois _navegador_ok

# src/navegador/headless_shell.py (novo)
def pasta_headless_shell() -> Path: ...                        # CAPIAU_HEADLESS_SHELL_DIR ou ~/.cache/capiau/chrome-headless-shell
def localizar() -> Path | None: ...
def instalar(progresso: Callable[[float], None] | None = None) -> Path: ...   # baixa, confere MD5, descompacta, testa a partida
def testar_partida(exe: Path, timeout_s: float = 10.0) -> bool: ...           # --dump-dom about:blank, como HF:chromeHostCeiling.ts:66-76
```

Quem usa o quê:

| Frente | Uso |
|---|---|
| C (legendas) | Nenhuma chamada nova: usa `GeradorTitulos`, que passa a rodar sobre `Navegador` |
| A (áudio) | `url = nav.servidor.publicar_arquivo("wav", entrada)`; `saida = nav.servidor.reservar_saida("clip12.wav")`; `pg = nav.pagina(64, 64)`; `pg.abrir("ui/render_audio.html", pronto="window.RENDER_AUDIO_PRONTO === true")`; `pg.avaliar("([u,v,p]) => window.RENDER_AUDIO.processar(u,v,p)", [url, saida.url, params])`; o Python lê `saida.caminho` do disco |
| D2 (composições) | `pg = nav.pagina(L, A)`; `pg.abrir(...)`; `for q in pg.capturar_quadros(pedidos, pasta, fps=fps, dedupe="chave")` com `chave` vinda de `document.getAnimations()`; sem chave, `dedupe="hash"` |
| H (contraste) | `pg.capturar(alfa=False, formato="jpeg", recorte=caixa)` com o texto escondido por `pg.avaliar` |
| B (paridade do player) | `Navegador(preferir="msedge")` (H.264 do Edge; o shell pode não ter codec [a medir]); `servidor.publicar_pasta("ui", RAIZ_UI)` e `/api` de mentira |

### 7.2 Arquivos

| Arquivo | Novo/alterado | O que muda |
|---|---|---|
| `src/navegador/__init__.py`, `erros.py` | novo | Reexporta a API; três exceções |
| `src/navegador/servidor.py` | novo | `ServidorLocal` e `Saida`, stdlib (`ThreadingHTTPServer`, HTTP/1.1, Range, PUT atômico) |
| `src/navegador/lancador.py` | novo | `Navegador`, `Pagina`, `Quadro`, candidatos e `assinatura()`; guarda de thread |
| `src/navegador/captura.py` | novo | `CapturaCDP` (Etapa 4) e `CapturaBeginFrame` com sonda (Etapa 7) |
| `src/navegador/flags.py` | novo | Flags aprovadas (Etapa 5); conjunto de BeginFrame separado |
| `src/navegador/diagnostico.py` | novo | `diagnostico_barato`, `diagnosticar`, `navegador_utilizavel`; `sondas.json` |
| `src/navegador/orfaos.py` | novo | Registro de PIDs, varredura, `abortar_todos`, `atexit` |
| `src/navegador/headless_shell.py` | novo | Pin, `localizar`, `instalar`, `testar_partida` |
| `src/export/video_render/titulos.py` | alterado | `GeradorTitulos` sobre `Navegador`; some o `_servir` próprio; `assinatura()` no cache; funções puras intactas |
| `src/export/video_render/execucao.py` | alterado | `Navegador` por job com `cancelado` ligado ao `TASK_MANAGER`; registro por timeline; `cancelar_render` chama `abortar()` |
| `src/export/video_render/fidelidade.py` | alterado | `TITULOS_SEM_NAVEGADOR` passa a usar `diagnostico_barato()` (cobre "playwright sem Edge/Chrome", que hoje só aparece em tempo de render) |
| `src/services/modelos_locais.py` | alterado | Entrada nova e três ramos (6.3) |
| `src/services/settings_registry.py` | alterado | Quatro chaves `render.navegador_*` |
| `src/ui/js/modelosLocais.js` | alterado | Rótulo, versão e progresso; `situacao` e `tamanho` passam a ser exportadas para o autoteste |
| `src/api/routes/modelos.py` | alterado | `GET /api/navegador/diagnostico` (barato) e `POST /api/navegador/testar` (completo, sob demanda, rota `def`) |
| `src/api/server.py`, `src/core/tasks.py` | alterados | `lifespan`: varredura na subida e `abortar_todos()` no desligamento; `cleanup()` idem |
| `tests/test_navegador_servidor.py`, `_lancador.py`, `_captura.py`, `_headless_shell.py`, `tests/test_render_titulos_regressao.py`, `tests/autoteste_modelos_locais.mjs` | novos | Ver seção 8 |
| `tests/test_render_titulos.py`, `tests/test_fontes_projeto.py` | alterados | `navegador_utilizavel()` no lugar de `_navegador_ok()` |
| `scripts/spike_navegador.py`, `medir_captura_navegador.py`, `paridade_flags_navegador.py`, `atualizar_pino_headless_shell.py` | novos | Medição e manutenção |
| `docs/MEDICOES_NAVEGADOR.md`, `docs/PESQUISA_HYPERFRAMES.md` (§4.4, §1, §7) | novo, alterado | Resultados; correções de 3.2 |
| `requirements.txt` | alterado | Só o comentário das linhas 22-25 (agora cita o módulo comum e o shell opcional) |

---

## 8. Etapas de implementação

Um commit por etapa, mensagem em conventional commits em português. Em toda etapa que toca `titulos.py`, `execucao.py` ou `comando.py`: rodar `pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs` (cenário canônico) e `pytest tests/test_render_*.py`. Portões: depois da Etapa 0 decide-se se a 7 existe; depois da 4, se os títulos trocam `page.screenshot` por CDP direto.

**Etapa 0. Spike de captura (portão da Etapa 7).**
- Commit: `chore(render): spike de captura do navegador (script de medição)`.
- Entra: `scripts/spike_navegador.py` e o esqueleto de `docs/MEDICOES_NAVEGADOR.md`. O script (rodado pelo Fernando no Windows, com o shell baixado à mão ou por `--baixar`) executa: (S1) `msedge` responde "wasn't found" a `HeadlessExperimental.enable`; (S2) matriz H1/H2 × V1 (só `--enable-begin-frame-control --run-all-compositor-stages-before-draw --disable-new-content-rendering-timeout`) e V2 (conjunto do HF, `HF:browserManager.ts:1130-1141`): página adotada, `goto` volta, `wait_for_function(polling=50)` volta, `beginFrame` devolve PNG, `hasDamage`, primeiro quadro obsoleto, `page.screenshot` trava (prazo 5 s); (S3) alfa por pixels (4.2); (S4) 100 quadros em movimento e 100 parados, PNG e JPEG, contra CDP direto no Edge; (S5) `window.isSecureContext` e `OfflineAudioContext.audioWorklet` em `http://127.0.0.1`; (S6) `chromium_sandbox=True` no Edge e no shell; (S7) RSS ocioso e após 300 quadros; (S8) kill do Python e conferência de órfãos; (S9) `SystemInfo.getInfo` (GPU em uso, `featureStatus`, e a `commandLine` efetiva).
- Testes: nenhum (é script); a saída JSON entra em `docs/MEDICOES_NAVEGADOR.md`.
- Dias: 1 (0,5 de escrita + a rodada na máquina do Fernando). Depende de: nada.
- Portão:

  | Resultado do spike | Decisão |
  |---|---|
  | H1 ou H2 funciona, alfa preservado, ≥ 2× | Etapa 7 completa; alfa por BeginFrame entra nos critérios (B4) |
  | Funciona, alfa perdido, ≥ 2× em quadros opacos | Etapa 7 reduzida a `alfa=False` (H e D2 opacos) |
  | Funciona, ganho < 1,5× | Cortar a 7 |
  | Não funciona sob Playwright | CDP cru (4.1a) só se outro meio provar o ganho; senão cortar |

**Etapa 1. Servidor local.**
- Commit: `feat(render): servidor local do navegador (GET com Range, PUT para disco, origem segura)`.
- Entra: `servidor.py`, `erros.py`.
- Testes (`tests/test_navegador_servidor.py`, sem navegador): travessia (`..`, `%2e%2e`, `C:\`, `arquivo::$DATA`, nome reservado `NUL`, symlink para fora), token errado 404, `Host` estranho 403, Range (`a-b`, `a-`, `-n`, inválido 416), HEAD, MIME de `.js`/`.mjs`/`.woff2`/`.wav`, PUT e POST acima do limite 413 e sem sobra de `.parcial`, PUT de 500 MB com RSS do Python estável, 8 clientes simultâneos, `parar()` sem thread viva, bind só em `127.0.0.1`.
- Dias: 1. Depende de: nada.

**Etapa 2. Lançador, diagnóstico, cancelamento e órfãos.**
- Commit: `feat(render): lançador comum do navegador headless com diagnóstico, cancelamento e limpeza de órfãos`.
- Entra: `lancador.py` (só backend screenshot via `page.screenshot`), `diagnostico.py`, `orfaos.py`; `lifespan`; rotas de diagnóstico.
- Testes: puros (ordem dos candidatos, `assinatura()` estável e sensível a canal/versão, guarda de thread, varredura com arquivos de PID falsos: dono morto mata, dono vivo e imagem divergente não mata, `abortar()` idempotente); com navegador (`skipif`): abrir página pelo servidor, `avaliar`, `esperar` por `polling`, `isSecureContext` verdadeiro, `capturar_quadros` parando com `cancelado()`, `abortar()` de outra thread destrava a chamada e a árvore some em ≤ 5 s, 20 ciclos sem sobra.
- Dias: 2. Depende de: 1.

**Etapa 3. `titulos.py` sobre a base.**
- Commit: `refactor(render): titulos.py usa o navegador comum sem mudar o resultado`.
- Entra: `GeradorTitulos` sobre `Navegador`/`Pagina` (`pg.abrir("ui/render_titulos.html", pronto="window.RENDER_TITULOS_PRONTO === true")`; URLs das fontes saem de `servidor.publicar_mapa("fontes", ...)` no lugar de `HOST_INTERNO/__fontes/`); `execucao.py` (um `Navegador` por job, `cancelado`, `abortar()` no cancelamento); `fidelidade.py`; `assinatura()` na chave; testes antigos migrados para `navegador_utilizavel()`.
- Testes: `tests/test_render_titulos_regressao.py`: corpus de 12 títulos (4.4) em 1920×1080 e 1280×720; cópia congelada do caminho antigo dentro do teste (`sync_playwright`, `launch`, `route` em `titulos.capiau`, `screenshot(omit_background=True)`) contra o novo, **PNG e máscara idênticos bit a bit** (`ImageChops.difference(...).getbbox() is None`); dois runs do caminho novo idênticos; se duas execuções do caminho antigo já diferirem entre si, o limiar é esse ruído medido (registrado), não zero; o teste do desfoque (`test_desfoque_da_caixa_igual_ao_preview`) e o das fontes do projeto sem mudança; teste composto: sequência do cenário canônico + pista de texto, fotos dos títulos iguais com e sem a camada de ajuste (bypass), ordem de camadas intacta.
- Dias: 1,5 a 2. Depende de: 2.

**Etapa 4. Captura direta por CDP, formatos baratos e deduplicação.**
- Commit: `feat(render): captura direta por CDP com alfa, JPEG/WebP rápidos e deduplicação`.
- Entra: `CapturaCDP` (fundo transparente definido uma vez, `Page.captureScreenshot` com `fromSurface`, `clip`; `optimizeForSpeed` **nunca** com alfa); `capturar_quadros` (`dedupe`: chave, hash, nenhum); `scripts/medir_captura_navegador.py`.
- Testes: alfa no estilo `HF:transparency-test.ts:44-85`; saída idêntica à de `page.screenshot` no corpus (se não for, os títulos ficam em `page.screenshot`); `optimizeForSpeed` com alfa proibido por teste; WebP com alfa lido pelo FFmpeg; medições em `docs/MEDICOES_NAVEGADOR.md`; títulos só trocam de backend se AC10 passar.
- Dias: 1. Depende de: 3 (ou 2).

**Etapa 5. Flags decididas por teste.**
- Commit: `feat(render): flags do navegador decididas por teste de paridade`.
- Entra: `scripts/paridade_flags_navegador.py` (4.4), `flags.py` com **só** as flags aprovadas, `docs/MEDICOES_NAVEGADOR.md` atualizado. Rodada no Windows do Fernando, com o Edge visível como referência.
- Testes: o harness vira `tests/test_navegador_flags.py` (`skipif`): C0 duas vezes idêntica; cada flag em `flags.py` tem entrada aprovada no relatório.
- Dias: 1. Depende de: 3.

**Etapa 6. Chrome Headless Shell no catálogo.**
- Commit: `feat(modelos): Chrome Headless Shell no catálogo de modelos locais`.
- Entra: `headless_shell.py`, `scripts/atualizar_pino_headless_shell.py`, entrada no catálogo, chaves em `settings_registry.py`, `modelosLocais.js`.
- Testes: zip falso com a estrutura `chrome-headless-shell-win64/` (MD5 certo instala; MD5 errado recusa e limpa; entrada `../fora` recusada; download interrompido não deixa `.part`; `testar_partida` com `subprocess` simulado); `baixado()`, `estado()`, `exigir()` antes e depois; `listar()` e `estado()` não fazem rede; `/api/modelos` devolve a entrada; `tests/autoteste_modelos_locais.mjs` (Node ESM puro, DOM falso mínimo) confere o rótulo novo e o texto "baixando… N%".
- Dias: 1. Depende de: 2 (independe de 3 a 5; pode ir em paralelo).

**Etapa 7. BeginFrame opcional (só se o portão da Etapa 0 passar).**
- Commit: `feat(render): captura por BeginFrame opcional com sonda e queda automática`.
- Entra: `CapturaBeginFrame` (H1 ou H2, a vencedora do spike), sonda portada de `HF:browserManager.ts:344-517`, `sondas.json`, prazo por quadro com queda para screenshot, tentativa extra em "Another frame is pending", quadro de apresentação antes do primeiro, `render.navegador_captura=beginframe`, aviso no preflight quando pedido e indisponível.
- Testes (`skipif` sem shell): sonda passa; `hasDamage` falso em página parada; sem `page.screenshot` na página; queda para screenshot quando a sonda falha (simulada no Edge); prazo por quadro; cancelamento no meio; cenário canônico com o backend ligado.
- Dias: 2,5. Depende de: 4, 6 e do portão.

**Etapa 8. Documentação e decisão.**
- Commit: `docs(render): navegador headless comum, medições e decisão sobre BeginFrame`.
- Entra: `docs/NAVEGADOR_HEADLESS.md`, correções em `docs/PESQUISA_HYPERFRAMES.md` (3.2), créditos do HyperFrames, e a constante `BEGINFRAME_PADRAO_LIGADO` com o valor decidido pelos critérios de 10.2.
- Testes: os de aceite da seção 10.
- Dias: 0,5. Depende de: 7 (ou de 5, se a 7 for cortada).

Total: Etapas 0 a 6 e 8 ≈ 9 a 9,5 dias; com a 7, ≈ 11,5 a 12 dias [inferência].

---

## 9. Testes e medições

Metas marcadas "meta" são alvos propostos, sem base medida; as outras vêm de 4.5 ou de critérios de decisão.

| ID | O que | Número-alvo | Como medir |
|---|---|---|---|
| M1 | Arranque a frio (do `info` à página pronta) | p50 ≤ 2,5 s, p95 ≤ 5 s (meta) | 20 lançamentos no Edge e no shell, `perf_counter`, `scripts/medir_captura_navegador.py` |
| M2 | Custo por foto 1080p: `page.screenshot` contra CDP direto | CDP direto ≥ 15% mais rápido no p50 **e** saída idêntica, senão não troca | Matriz de 4.5, 100 repetições intercaladas após 10 de aquecimento |
| M3 | PNG alfa, WebP alfa q90, JPEG q85 `optimizeForSpeed` | WebP ou JPEG ≥ 3× mais rápidos que PNG em quadro cheio (a codificação isolada do JPEG já dá 7× a 230×, 4.5); WebP com alfa lido pelo FFmpeg | Idem, mais `ffmpeg -i` no WebP |
| M4 | BeginFrame contra CDP direto, 300 quadros opacos 1080p | ≥ 2,0× sobre JPEG `optimizeForSpeed` e ≥ 1,5× sobre PNG, nenhum quadro > 10 s | S4 do spike e testes da Etapa 7 |
| M5 | Fotos por título de 5 s com fade de 0,3 s a 30 fps | ≤ 12 fotos para 150 quadros | Corpus de 4.4, contando `grupos()` |
| M6 | Fotos por GC em CSS (D2): anima 0,5 s, retém 4,5 s, sai 0,5 s | ≤ 25% dos quadros | Chave de `document.getAnimations()` contra `dedupe="hash"` |
| M7 | Memória da árvore do navegador | Pico ≤ 1 GB, ocioso ≤ 700 MB (meta); após `fechar()`, 0 PIDs do registro vivos em ≤ 5 s | `SystemInfo.getProcessInfo` + `GetProcessMemoryInfo` por `ctypes` |
| M8 | Cancelamento | Para em ≤ 1 foto + 500 ms; `abortar()` limpa a árvore em ≤ 5 s; 20 de 20 | Teste com `cancelado()` e com `abortar()` de outra thread |
| M9 | Órfãos | 100% dos PIDs registrados removidos em ≤ 5 s após matar o dono | Teste com processo-dono que sai à força |
| M10 | Servidor | PUT de 500 MB com RSS do Python +≤ 50 MB; vazão ≥ 200 MB/s em loopback (meta) | `tests/test_navegador_servidor.py` |
| M11 | Regressão por imagem (12 títulos × 2 resoluções, PNG e máscara) | 0 pixels diferentes (ou o ruído entre duas execuções do caminho antigo, se não for zero) | `ImageChops.difference(a, b).getbbox() is None` |
| M12 | Determinismo | Duas execuções do mesmo caminho: 0 pixels diferentes | Idem |
| M13 | Paridade das flags | Regra de 4.4 (≥ 20% menos erro contra o Edge visível, p99,9 não pior) | `scripts/paridade_flags_navegador.py` |
| M14 | Instalação do shell | MD5 confere; extração ≤ 30 s (meta); `testar_partida` ≤ 10 s | Etapa 6 com zip falso e uma vez com o real |
| M15 | Preflight | `diagnostico_barato()` < 100 ms (meta) e zero processos novos | `perf_counter` e contagem de processos |

---

## 10. Critérios de aceite

### 10.1 Gerais (mensuráveis)

1. **AC1**: M11 e M12 dentro do limiar (0 pixels diferentes, salvo o ruído medido do caminho antigo); testes antigos de título e de fontes passam sem alterar asserções.
2. **AC2**: `pytest tests/test_render_composicao_multipista_cascata.py`, `node tests/autoteste_composicao_multipista_cascata.mjs` e `pytest tests/test_render_*.py` verdes em cada etapa que toca `titulos.py`, `execucao.py` ou `comando.py`; teste composto "cascata + título" com fotos de título idênticas com e sem a camada de ajuste.
3. **AC3**: M8 e M9 cumpridos (cancelamento, `abortar()`, órfãos); `execucao.cancelar_render` encerra o navegador do job.
4. **AC4**: M10 e a lista de travessia da Etapa 1 sem falhas; o servidor só escuta em `127.0.0.1`.
5. **AC5**: na página servida, `window.isSecureContext === true` e `typeof new OfflineAudioContext(1, 1, 44100).audioWorklet === "object"` (destrava a frente A).
6. **AC6**: `diagnostico_barato()` cobre os três cenários (sem `playwright`; `playwright` sem Edge/Chrome; ok) com o aviso certo, em < 100 ms e sem lançar processo.
7. **AC7**: catálogo: `listar()` e `estado()` não fazem rede; `exigir("chrome_headless_shell")` levanta `ModeloNaoBaixado` antes e passa depois; instalação confere o MD5, recusa `../fora` e testa a partida.
8. **AC8**: nenhuma flag em `flags.py` sem linha aprovada em `docs/MEDICOES_NAVEGADOR.md`; nenhum `--enable-features`/`--disable-features` em `args`.
9. **AC9**: a chave do cache inclui `assinatura()`; trocar canal ou versão invalida; cache antigo presente não causa erro.
10. **AC10**: `page.screenshot` só é trocado por CDP direto se M2 passar; o resultado (passou ou não) está registrado.
11. **AC11**: `docs/PESQUISA_HYPERFRAMES.md` corrigido nos pontos de 3.2; créditos do HyperFrames registrados nos arquivos portados.

### 10.2 Para ligar BeginFrame por padrão (`BEGINFRAME_PADRAO_LIGADO = True`)

Só se **todos** valerem no Windows do Fernando, registrados em `docs/MEDICOES_NAVEGADOR.md`:

- **B1**: a sonda passa em 50 de 50 lançamentos seguidos, nos dois modos de GPU que o Fernando usa (padrão e `--disable-gpu`).
- **B2**: M4 cumprido (≥ 2,0× e ≥ 1,5×, nenhum quadro > 10 s).
- **B3**: contra a captura por screenshot, em 20 composições: erro médio absoluto ≤ 0,5/255, p99,9 ≤ 8/255, 0 quadros em branco.
- **B4**: alfa: ou o teste (i) de 4.2 prova α fiel (±2/255), ou o BeginFrame fica restrito a `alfa=False`, que é o que o `auto` fará.
- **B5**: 20 ciclos de cancelamento sem órfão nem travamento; RSS de pico ≤ o do screenshot + 200 MB.
- **B6**: cenário canônico (cascata + título) verde com o backend ligado.
- **B7**: `SystemInfo.getInfo` indica composição por GPU, **ou** B2 passa mesmo em software.

Se qualquer um falhar: BeginFrame permanece opt-in (`render.navegador_captura=beginframe`), documentado como experimental, ou a Etapa 7 é cortada.

---

## 11. Riscos e mitigação

| # | Risco | Prob. | Mitigação |
|---|---|---|---|
| R1 | BeginFrame não funciona no Windows sob Playwright (nem o HF o valida) | Média | Spike e portão; nada da base depende dele; reserva por CDP cru (4.1a) só se o ganho justificar |
| R2 | BeginFrame não preserva alfa | Alta [HF] | Alfa sempre por screenshot; BeginFrame só em `alfa=False`; matte descartado |
| R3 | Primeiro BeginFrame trava em rasterização por software (HF: testado 30 min sem concluir, `HF:screenshotService.ts:52-67`) e o Fernando não tem GPU obrigatória | Média | Sonda com prazo de 2 s, prazo de 10 s por quadro, queda automática, `SystemInfo.getInfo` no diagnóstico (B7) |
| R4 | Trocar a origem dos títulos para `127.0.0.1` muda um pixel | Baixa | Mesmos módulos JS; teste A/B bit a bit (M11); Google Fonts como hoje |
| R5 | Antivírus ou firewall barram a porta de loopback | Baixa | `servidor_ok` no diagnóstico completo; erro claro; invariante 5 (render segue sem título e avisa) |
| R6 | Atualização automática do Edge muda a rasterização | Média | `assinatura()` invalida o cache; A/B acusa; opção `headless_shell` fixa a versão |
| R7 | Chromium órfão no Windows (thread daemon, kill do servidor) | Média | Registro de PIDs, varredura, `abortar_todos`, Job Object opcional (4.6) |
| R8 | Playwright síncrono em thread errada ou em laço asyncio | Média | Guarda de thread com mensagem; rotas `def`; documentado em 7.1 |
| R9 | Copiar `--disable-features`/`--enable-features` do HF substitui a lista do Playwright e remove `CDPScreenshotNewSurface` | Média | Teste proíbe nos `args`; mesclar a lista inteira se for preciso |
| R10 | Shell sem codec H.264 inviabiliza B | Alta [inferência] | B usa Edge; o shell serve a BeginFrame e a reprodutibilidade |
| R11 | Licença: build do Google; Apache-2.0 → GPLv3 | Baixa | Download a pedido, sem redistribuir; cabeçalhos e créditos nos arquivos portados |
| R12 | `abortar()` durante `Page.captureScreenshot` espalha `TargetClosedError` | Média | Conversão num ponto único para `CapturaCancelada` |
| R13 | Cache antigo cresce | Baixa | `assinatura()` e limpeza por idade |
| R14 | Memória em máquina de 8 GB | Baixa | `--js-flags`, uma página por vez, fechar a página ao fim (M7) |

---

## 12. Perguntas para o Fernando

1. **Servidor HTTP interno em `127.0.0.1` durante o render?** Recomendo sim (porta aleatória, token, só loopback). É o que permite o gate em `AudioWorklet` da frente A e o WAV grande sem base64.
2. **Posso pedir que rode o spike da Etapa 0 (≈ 30 min) e cole a saída?** Recomendo sim, antes de qualquer trabalho de BeginFrame: ele diz se a Etapa 7 existe.
3. **Qual Edge/Chrome tem instalado, qual a escala do Windows (100, 125 ou 150%) e o monitor é sRGB ou gama ampla?** Recomendo 100% e perfil sRGB nos testes de paridade; o preview de referência é o Edge visível nessa configuração.
4. **Quanta RAM e qual GPU?** A UHD 630 do i7-10700 aparece como GPU em `SystemInfo.getInfo`; define a política de memória e se o BeginFrame cai em software (R3).
5. **Tolerância de paridade:** "idêntico bit a bit" no mesmo navegador e versão, e "erro médio ≤ 0,5/255" entre navegadores diferentes? Recomendo sim.
6. **Se o spike mostrar que BeginFrame não funciona ou não ganha, posso cortar a Etapa 7?** Recomendo sim (economiza ≈ 2,5 dias).
7. **Manter o Chrome Headless Shell no catálogo mesmo sem BeginFrame?** Recomendo manter (Etapa 6): fixa a versão do motor e dá exportação reprodutível independente das atualizações do Edge; é opcional e a pedido.
8. **Sandbox do Chromium ligado por padrão no Windows, com retorno automático?** Recomendo sim; obrigatório se D2 passar a abrir HTML de terceiros.
9. **Apagar do cache de títulos as pastas sem acesso há mais de 30 dias, no início de cada render?** Recomendo sim, com o limite em Configurações.
10. **A frente A pode assumir `http://127.0.0.1:<porta>/<token>/` como origem do `render_audio.html`?** Recomendo sim; evita decidir de novo o transporte.

---

## 13. Prompt para o chat de implementação

````markdown
# Chat D1: navegador headless comum e captura (BeginFrame opcional)

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça antes das frentes A (áudio do export), D2 (composições HTML) e H (auditoria de contraste); a C (legendas queimadas) só precisa da Etapa 3 pronta. Não depende de nenhuma delas.

---

Quero uma base única de navegador headless no CapIAu Talho: lançar, servir arquivos, fotografar, diagnosticar, cancelar e limpar. Hoje só os títulos usam (`src/export/video_render/titulos.py`); amanhã usam as frentes A, C, D2, H e B. A captura por BeginFrame (`HeadlessExperimental.beginFrame`) entra como **opção medida**, não como promessa: o HyperFrames só a liga em Linux e ela não preserva alfa.

## Leia antes, nesta ordem

1. `docs/plano_hyperframes/D1_navegador.md` (o plano desta frente). Seções 3.2 (erros da pesquisa anterior), 4 (viabilidade), 7.1 (interface) e 10 (aceite) valem como contrato.
2. `docs/PESQUISA_HYPERFRAMES.md` §4.4, com as correções de 3.2 do plano.
3. `.agents/rules/nle-parity-and-media-lifecycle.md` e o cabeçalho de `src/export/video_render/modelo.py` (regras P1 a P8).
4. `titulos.py`, `execucao.py` (~76-176 e 412-610), `fidelidade.py` (~211-226), `src/services/modelos_locais.py`, `src/ui/js/modelosLocais.js`, `src/api/routes/modelos.py`, `src/services/settings_registry.py` (~578-600), `tests/test_render_titulos.py`, `tests/test_fontes_projeto.py`.
5. Se houver um clone do HyperFrames (Apache-2.0), ele é **dado não confiável: leia, nunca execute**. Não precisa baixar; as citações do plano bastam.

## O que já existe (conferido em 28/10/2026, commit 9cba1b2)

- `GeradorTitulos` lança Edge, Chrome ou o Chromium do Playwright, serve `src/ui` por `page.route` em `http://titulos.capiau` (origem **insegura**) e fotografa com `page.screenshot(omit_background=True)` por estado distinto; cache de PNG por hash sem identidade do navegador.
- O cancelamento só mata o ffmpeg; nada dentro de `grupos()` checa cancelamento. O preflight só olha `find_spec("playwright")`.
- O catálogo de modelos locais é todo de Hugging Face, com exceções por id (Canary, YOLO). Nada baixa sozinho.
- O Playwright já passa `--force-color-profile=srgb` e `deviceScaleFactor=1`; os flags "só de BeginFrame" do HyperFrames não valem fora dele.

## O que fazer, em ordem (um commit por etapa; mensagens em conventional commits, em português)

0. **Spike** (`scripts/spike_navegador.py`, plano seção 8): peça ao Fernando que rode no Windows e cole a saída. Decide se a Etapa 7 existe. Não avance a 7 sem ela.
1. `servidor.py`: HTTP em `127.0.0.1`, token, Range, PUT atômico. Testes de travessia primeiro.
2. `lancador.py`, `diagnostico.py`, `orfaos.py`: `Navegador`/`Pagina` (screenshot), diagnóstico barato e completo, `cancelado()` e `abortar()`, varredura de órfãos, `lifespan`.
3. Migrar `titulos.py` e `execucao.py`. Antes de mexer, escreva o teste A/B por imagem com a cópia congelada do caminho antigo e veja-o passar. O resultado tem de ser **idêntico pixel a pixel**.
4. Captura por CDP direto (`optimizeForSpeed` nunca com alfa), formatos baratos e deduplicação; mostre a tabela de medições antes de trocar `page.screenshot`.
5. Flags: só as que o harness de paridade aprovar contra o Edge visível. Nunca `--enable-features`/`--disable-features` em `args`.
6. Chrome Headless Shell no catálogo (`headless_shell.py`): MD5 conferido, sem zip-slip, teste de partida, nada baixa sozinho.
7. BeginFrame opcional, só se o spike passar: sonda, prazo por quadro, queda automática para screenshot.
8. Documentação, correções na pesquisa anterior, créditos do HyperFrames e a decisão sobre `BEGINFRAME_PADRAO_LIGADO` pelos critérios B1 a B7.

## Pergunte antes de decidir

- Depois do spike: "BeginFrame funcionou? Ganho de X vezes? Alfa preservado?" e proponha manter ou cortar a Etapa 7.
- Antes da Etapa 3: confirme o servidor HTTP em loopback (D1), o sandbox (D8) e a chave de cache com `assinatura()` (D9).
- Antes da Etapa 5: escala do Windows, navegador de referência e tolerância de paridade.
- No fim da Etapa 4 e da 7: mostre os números e pergunte antes de trocar o padrão.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md` se existirem (a única mudança de tela é o rótulo e o progresso em Modelos locais: 9-12 px, `var(--fs-N)`, `var(--sp-N)`, `--accent`).
- Outra sessão mexe na interface. Commit só dos seus trechos (índice a partir do HEAD), direto na main, sem coautoria, sem push.
- Modelos não baixam sozinhos (`modelos_locais.exigir`). Nada de `playwright install`.
- Toda mudança em `titulos.py`, `execucao.py` ou `comando.py` tem de passar no cenário canônico multipista em cascata (`pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs`). Não mexa em `player.js`.
- Windows: `pathlib`, `taskkill /F /T` para árvores, `ctypes` (sem psutil). Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Código portado do HyperFrames: cabeçalho "Copyright 2026 HeyGen, Inc., Apache-2.0", indicação de alteração e entrada nos créditos.
- Português, direto. Verifique antes de afirmar e marque [lido], [inferência] ou [a medir].

## Pronto quando

Os títulos saem com os mesmos pixels pelo módulo comum; cancelar um render encerra o navegador em até 5 s e nenhum Chromium sobra; o preflight avisa "playwright sem Edge/Chrome" sem lançar nada; o Chrome Headless Shell baixa a pedido e confere o MD5; `docs/MEDICOES_NAVEGADOR.md` tem os números; e a decisão sobre o BeginFrame está registrada com os critérios B1 a B7.
````
