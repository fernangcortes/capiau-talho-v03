# Spike F0 · Drag & Dock

Protótipo isolado da fase F0 do plano de janelas destacáveis por arrastar-e-soltar
(`docs/PLANO_JANELAS_DRAG_DOCK.md`, versão visual: https://claude.ai/artifact/SF8tDpe1VVSy4brs938X3V).
Não é carregado pelo editor. Ele mede, em cada navegador, as três incertezas técnicas antes da F1:

1. Dá para **abrir a janela destacada ao soltar** um arrasto fora do editor?
2. Dá para **arrastar da janela destacada de volta** para a principal?
3. **Vídeo, canvas, listeners e ResizeObserver** sobrevivem à ida e volta via `adoptNode`?

## Como rodar

- **Automático (Chromium, headless):** `node src/ui/spikes/dock-f0/auto.mjs`
  Usa o Playwright instalado globalmente, sobe um servidor estático próprio e **liga o bloqueador de popups** (o Playwright o desliga por padrão).
- **Manual (Chrome, Edge, Firefox):** com o Talho rodando, abra `http://localhost:<porta>/spikes/dock-f0/`.
  Ao terminar, clique em **Copiar resultados**.

## Resultados automáticos (Chromium 141 headless, bloqueador ligado)

| Pergunta | Resultado |
|---|---|
| Soltar fora com Pointer Events abre a janela? | **Sim.** `pointerup` chega mesmo fora da área visível (graças a `setPointerCapture`) e `window.open` funciona, inclusive após segurar o botão por 6 s. |
| Soltar fora com arrasto HTML5 abre a janela? | **Só se o arrasto durar menos de ~5 s.** Aos 6 s, `dragend` chega com `userActivation.isActive=false` e o popup é bloqueado. |
| Por quanto tempo o gesto vale? | 1 s, 3 s e 4,5 s: sim. 6 s: não. A janela é de ~5 s. |
| Um clique abre várias janelas? | **Não.** `window.open` consome o gesto: 1 de 3 janelas abriu. |
| Reabrir janelas ao carregar, sem clique? | **Bloqueado.** |
| Vídeo continua tocando ao mudar de janela? | **Não.** O navegador reinicia o elemento (`abort → emptied → loadstart → loadedmetadata`): volta a 0 s e pausa, tanto com arquivo quanto com stream. |
| E com restauração? | **Sim.** Guardar tempo e estado de reprodução antes do `adoptNode` e reaplicar já e de novo em `loadedmetadata` mantém o vídeo tocando do mesmo ponto. |
| Canvas mantém o desenho? | Sim (pixel idêntico na ida e na volta). |
| Listeners registrados na principal continuam? | Sim, na destacada e de volta. |
| ResizeObserver da principal vê o elemento na destacada? | Sim (disparou com a largura mudando de 320 px para 482 px e de volta). |
| Document Picture-in-Picture | Disponível. |

## O que isso muda no plano

1. **Destacar usa Pointer Events, não HTML5 DnD.** O arrasto dentro da janela e o arrancar para fora ficam num motor só, com `setPointerCapture`. O HTML5 falharia sempre que alguém segurar o painel por mais de 5 s.
2. **Plano B continua necessário.** Se `window.open` voltar `null` (outro navegador, ou regra diferente de gesto), o painel fica flutuando dentro do editor com o botão "Abrir em janela".
3. **Continuidade de mídia vira requisito da F1/F3.** O `WindowHost.mount()` precisa salvar e restaurar `currentTime`/reprodução de todo `<video>`/`<audio>` do painel. Vale conferir se os players destacados hoje (botão "Destacar Player") também reiniciam; pelo teste, devem reiniciar.
4. **Decisão 8 (janelas voltam sozinhas) precisa de ajuste de UX.** Sem permissão de popups para o site, o navegador bloqueia a reabertura automática, e cada clique abre só uma janela. Proposta:
   - ao carregar, tentar reabrir; se voltar `null`, mostrar o aviso **"Restaurar janelas (3)"**, que reabre uma janela por clique ("Restaurar Ajustes", "Restaurar Timeline"…);
   - no aviso, um link "Como restaurar tudo sozinho" explicando como permitir pop-ups para o Talho no navegador. Com a permissão, a reabertura automática funciona.
   - juntar painéis numa janela só (até 4) reduz o número de cliques.

## Roteiro manual (pendente: precisa de máquina real)

Rode em **Chrome**, **Edge** e **Firefox**, e em pelo menos um computador com dois monitores.

| # | Passo | O que observar |
|---|---|---|
| M1 | E1: arraste "Painel Pointer" até **fora da janela do navegador** e solte. | Abre janela no ponto onde soltou? `E1.outside` = ok? |
| M2 | E1: repita segurando parado uns 6 s antes de soltar fora. | Ainda abre? (No Firefox, esperamos que não; aí vale o plano B.) |
| M3 | E2: mesmo gesto com "Painel HTML5", rápido e depois segurando 6 s. | Confirma o limite de ~5 s. |
| M4 | **E3**: com o Painel HTML5 destacado, arraste a alça dele até a zona ciano da janela principal. | `E3.crossDrop` = ok? A zona acende durante o arrasto? |
| M5 | **E4**: passe o mouse na principal (calibra), depois arraste a alça do Painel Pointer destacado até a zona ciano. | O círculo rosa acompanha o cursor na principal? `E4.pointerBridge` = ok? |
| M6 | E4 com zoom da página em 125% e com a janela destacada em outro monitor. | O círculo continua alinhado? |
| M7 | E5: "Rodar ida e volta" com e sem "Restaurar tempo". Cole também a URL de um proxy real do projeto (`/proxies/…`). | Mesmo resultado do automático? Com áudio, o `play()` após mover funciona? |
| M8 | E6: "Listar monitores" e "Abrir janela no último monitor". | Pede permissão? Abre no monitor certo? |
| M9 | E7: marque, recarregue. Depois permita pop-ups para o site nas configurações do navegador e recarregue de novo. | Bloqueado sem permissão, liberado com permissão? |
| M10 | E9: "Abrir 3 janelas num clique", sem e com a permissão de pop-ups. | 1 de 3 sem permissão; 3 de 3 com? |

M4 e M5 decidem como o painel volta da janela destacada: HTML5 (E3), ponte de coordenadas (E4) ou os dois (HTML5 na destacada, Pointer na principal).
