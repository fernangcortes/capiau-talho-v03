---
always_on: true
description: "Guardrails universais de ciclo de vida de mídia, render cache VRAM, paridade estrita Player vs FFmpeg e bateria obrigatória de testes compostos multipista em cascata."
---

# 🛡️ Guardrails NLE: Ciclo de Vida de Mídia, VRAM e Paridade Player vs. FFmpeg

Este documento estabelece as regras permanentes e inegociáveis para a arquitetura de reprodução (Player no navegador), pré-renderização (Render Cache) e exportação em alta fidelidade (FFmpeg) no CapIAu NLE.

---

## 1. Paridade Estrita Player vs. FFmpeg em Transições e Junções

1. **Emparelhamento por `transitionId`:**
   - Toda transição de corte entre dois clipes adjacentes (`clipeA` e `clipeB`) na mesma pista compartilha um identificador único de junção (`transitionId`).
   - Efeitos do tipo `crossfade` com `side: "out"` no clipe A e `side: "in"` no clipe B com mesmo `transitionId` são duas faces da mesma transição e devem ser tratados conjuntamente pelo pipeline de renderização e pelo player.

2. **Gestão de Handles e Extensão Temporal:**
   - Se houver folga temporal de mídia na fonte (`in_time > 0` para cabeça do Clipe B, ou duração de arquivo maior que `out_time` para cauda do Clipe A), a leitura deve ser estendida para preencher a sobreposição da transição:
     - Clipe A se estende até `corte + halfB`.
     - Clipe B recua até `corte - halfA`.

3. **Congelamento de Borda Obrigatório com `tpad=clone`:**
   - Quando não houver folga de mídia na fonte (ex: Clipe B começa em `in_time = 0.0`) ou quando `hard_boundaries: true` estiver ativo no clipe, é terminantemente proibido inventar dados ou saltar quadros.
   - Deve ser utilizado congelamento estrito de borda:
     - Clipe A: `tpad=stop_mode=clone:stop_duration=halfB`
     - Clipe B: `tpad=start_mode=clone:start_duration=halfA`
   - O player e o renderizador devem manter o último quadro de A e o primeiro quadro de B congelados pelo período do handle faltante.

4. **Clamping Temporal de Segurança:**
   - Durações de meio-fade (`halfA` e `halfB`) devem ser delimitadas por `min(half, a.duracao_s, b.duracao_s)` para evitar offsets negativos (`st < 0`) em filtros `fade` de FFmpeg e garantir tempos matematicamente válidos.

5. **Proibição de Dip to Black Espúrio em Cross Dissolve:**
   - Uma transição de dissolução cruzada NLE (`cross_dissolve`) JAMAIS deve esmaecer para preto antes de subir o próximo clipe.
   - O Clipe A deve permanecer plenamente visível na camada base ao longo de toda a janela de transição `[corte - halfA, corte + halfB]`, enquanto o Clipe B sobrepõe com curva progressiva de opacidade de entrada (0.0 a 1.0).

---

## 2. Ciclo de Vida de Decoders e Gestão Atômica de VRAM

1. **Imunidade de Buffers On-Air no Player:**
   - Durante transições ativas no Playhead, ambos os elementos `<video>` dos clipes em transição estão protegidos (`claimed` e `busy`).
   - O gestor de decodificadores do Player **nunca** deve desalocar, ejetar ou executar `seek`/rewind em um elemento `<video>` que esteja sendo exibido ou na fila imediata de transição.

2. **Pré-Aquecimento Antecipado:**
   - O decodificador do clipe seguinte em uma transição deve ser preparado e pré-carregado no início da janela da transição (`corte - halfA`), garantindo playback contínuo e sem gaguejo (*stutter* / *frame drop*).

3. **Dual-Buffer para Mesma Mídia Contígua:**
   - Cortes contíguos na mesma pista que apontem para o mesmo arquivo de mídia (`video_id` idêntico) devem alocar instâncias separadas de elementos de vídeo para permitir sobreposição temporal contínua durante a transição.

4. **Desalocação Atômica de Texturas GPU (VRAM):**
   - No Chromium/Electron, instâncias de `ImageBitmap` e texturas de Canvas retidas sem liberação explícita provocam vazamento cumulativo de VRAM e pane no renderizador GPU.
   - **Toda e qualquer substituição, invalidação de intervalo (`invalidateRange`) ou descarte completo (`invalidateAll`) de frames em cache DEVE obrigatoriamente chamar `bitmap.close()` em cada `ImageBitmap` descartado.**

5. **Preservação de Estado durante Cache Hit:**
   - Ao reproduzir trechos pré-renderizados do Render Cache, o Player não deve resetar o `dataset.activeClipId` dos decodificadores subjacentes para evitar recarregamento a frio (*cold-start*) ao cruzar a borda do trecho renderizado.

---

## 3. Bateria Obrigatória de Testes Compostos Multipista em Cascata

1. **Proibição de Testes Puramente Monopista:**
   - Testes unitários que validam ferramentas apenas em uma única pista ou com apenas um clipe isolado são insuficientes. Falhas críticas de composição (ex: blend mode interagindo com crossfade subjacente e curva Bézier) passam despercebidas em testes isolados.

2. **Cenário Canônico Obrigatório de Composição Multipista em Cascata:**
   - Toda implementação ou refatoração no motor de renderização ou player deve ser auditada contra o cenário composto canônico:
     - **Pista Superior (V2):** Camada de Ajuste (Adjustment Layer) sobreposta à junção, com curva Bézier/S-Curve em Fade In e Fade Out, gradação de cor (brilho, contraste, saturação) e modo de mesclagem (`soft-light` ou `overlay`).
     - **Pista Inferior (V1):** Dois clipes contíguos de vídeo com transição de junção Cross Dissolve ativa no ponto de corte e ajustes individuais de cor.
   - **Critérios de Validação:**
     - **Frontend:** Execução sem falhas de `node tests/autoteste_composicao_multipista_cascata.mjs`.
     - **Backend:** Execução sem falhas de `pytest tests/test_render_composicao_multipista_cascata.py`.
     - **Comportamento de Bypass:** Desativar a camada de ajuste superior restaura imediatamente a renderização intacta do crossfade inferior sem efeitos colaterais.
