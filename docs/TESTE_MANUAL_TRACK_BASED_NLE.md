# Guia de Teste Manual: Arquitetura Track-Based NLE (CapIAu)

Este documento contém o roteiro passo a passo para validação manual de todas as funcionalidades da nova arquitetura de linha do tempo multipista profissional (estilo Premiere Pro / DaVinci Resolve).

---

## 1. Posicionamento Livre & Preservação de Posição Absoluta

- [ ] **1.1 Drop em Qualquer Ponto do Tempo**:
  1. Abra um projeto com mídias decupadas.
  2. Arraste um vídeo da Biblioteca de Mídia e solte na pista **V1** na marca de **10 segundos** (não no frame 0).
  3. **Resultado Esperado**: O clipe é inserido exatamente em 10s. O intervalo entre 0s e 10s permanece vazio (Gap), sem forçar o clipe para o início.

- [ ] **1.2 Movimentação Livre na Pista**:
  1. Clique no corpo do clipe e arraste-o horizontalmente para a marca de **25 segundos**.
  2. Solte o mouse.
  3. **Resultado Esperado**: O clipe fica exatamente onde foi solto. O player do programa reflete o timecode correto.

- [ ] **1.3 Camadas Sobrepostas (V1 e V2 com Gaps Independentes)**:
  1. Arraste um segundo clipe (B-Roll ou foto) para **V2** na marca de **15 segundos**.
  2. **Resultado Esperado**: O clipe em V2 fica posicionado em 15s independentemente de V1, permitindo sobreposição visual transparente nos trechos vazios.

---

## 2. Sincronia de Pares A/V Vinculados (`link_id`)

- [ ] **2.1 Movimentação em Par**:
  1. Arraste um clipe de vídeo de **V1** que possua áudio vinculado em **A1**.
  2. **Resultado Esperado**: O áudio em A1 acompanha a movimentação simultaneamente, mantendo a sincronia A/V perfeita.

- [ ] **2.2 Transposição Vertical de Pistas**:
  1. Arraste o clipe de **V1** verticalmente para **V2**.
  2. **Resultado Esperado**: O clipe vai para V2 e seu áudio pareado é roteado automaticamente para **A2**.

- [ ] **2.3 Desvinculação com Tecla `U`**:
  1. Selecione o clipe em V1 e pressione a tecla **`U`**.
  2. Arraste apenas o vídeo de V1 para outro ponto.
  3. **Resultado Esperado**: O vídeo se move livremente enquanto o áudio em A1 permanece em sua posição original.

---

## 3. Gaps como Entidades de Primeira Classe & Ripple Delete

- [ ] **3.1 Seleção de Gap (Espaço Vazio)**:
  1. Crie dois clipes em V1 com um espaço vazio de ~3 segundos entre eles.
  2. Dê um clique simples no espaço vazio entre os clipes.
  3. **Resultado Esperado**: O Gap fica destacado visualmente com um retângulo tracejado ciano e uma etiqueta centralizada indicando a duração (ex: `Vazio: 00:00:03:00`).

- [ ] **3.2 Ripple Delete de Gap**:
  1. Com o Gap selecionado, pressione **`Delete`** ou **`Backspace`**.
  2. **Resultado Esperado**: O buraco é instantaneamente eliminado. O segundo clipe avança para encostar no primeiro, e as pistas de áudio/vídeo sincronizadas acompanham o deslocamento.

- [ ] **3.3 Limpeza de Seleção**:
  1. Com um Gap selecionado, clique em qualquer clipe ou fora da timeline.
  2. **Resultado Esperado**: O destaque do Gap desaparece.

---

## 4. Dupla Camada: Overwrite vs. Ripple Insert

- [ ] **4.1 Arraste Normal (Modo Overwrite / Livre)**:
  1. Arraste um clipe da biblioteca ou da própria timeline e solte sobre uma pista sem pressionar nenhuma tecla modificadora.
  2. **Resultado Esperado**: O clipe é posicionado no frame exato onde o mouse foi solto (respeitando o snapping magnético). Clipes à direita NÃO são empurrados.

- [ ] **4.2 Inserção com Ripple (`Ctrl` + Arraste / Drop)**:
  1. Segure a tecla **`Ctrl`** (ou **`Cmd`** no Mac).
  2. Arraste um clipe da biblioteca para o meio de dois clipes em V1.
  3. **Resultado Esperado**: O cursor exibe uma linha guia vertical roxa (`#8b5cf6`) com setas indicadoras de inserção.
  4. Solte o botão do mouse.
  5. **Resultado Esperado**: A timeline abre espaço para acomodar o novo clipe e empurra todos os clipes subsequentes nas pistas com Sync Lock ativo.

---

## 5. Controle de Sync Lock por Pista

- [ ] **5.1 Identificação Visual nos Cabeçalhos**:
  1. Observe o cabeçalho lateral esquerdo das pistas (V1, V2, A1, A2).
  2. **Resultado Esperado**: Cada pista possui o botão de Sync Lock (`<i class="fa-solid fa-arrows-left-right-to-line"></i>`) aceso na cor ciano (`var(--color-cyan)`).

- [ ] **5.2 Desativação Seletiva de Sync Lock**:
  1. Clique no botão de Sync Lock da pista **V2** para desativá-lo (fica cinza escuro).
  2. Tenha clipes em V1 e V2 no mesmo ponto do tempo.
  3. Selecione e delete um Gap em V1 com **`Delete`**.
  4. **Resultado Esperado**: V1, A1 e A2 avançam para fechar o buraco. Os clipes em **V2** permanecem intactos em suas posições temporais originais sem sofrer ripple.
  5. Clique novamente no botão de Sync Lock de V2 para reativá-lo (volta a ficar ciano).

---

## 6. Snapping Magnético (`S`) & Guias Visuais

- [ ] **6.1 Ativação/Desativação com Tecla `S`**:
  1. Pressione a tecla **`S`** no teclado.
  2. **Resultado Esperado**: Um aviso toast informa `Snapping Desativado`. Pressionar `S` novamente mostra `Snapping Ativado`.

- [ ] **6.2 Encaixe Magnético e Linhas Guias**:
  1. Com o snapping ativo, arraste um clipe aproximando-o de:
     - Início ou fim de outro clipe.
     - Playhead (cursor de tempo).
     - Marcador de timeline.
  2. **Resultado Esperado**: Uma linha guia vertical ciano tracejada corta toda a altura das pistas indicando o ponto exato de atração magnética.

---

## 7. Lift Delete vs. Ripple Delete de Clipes

- [ ] **7.1 Lift Delete (`Delete` ou `Backspace`)**:
  1. Selecione um clipe posicionado entre outros dois cortes.
  2. Pressione **`Delete`**.
  3. **Resultado Esperado**: O clipe é removido, deixando um espaço vazio (Gap) no seu lugar. Os clipes à direita NÃO se movem.

- [ ] **7.2 Ripple Delete (`Shift + Delete`)**:
  1. Pressione `Ctrl + Z` para restaurar o clipe anterior.
  2. Com o clipe selecionado, pressione **`Shift + Delete`**.
  3. **Resultado Esperado**: O clipe é removido e todos os clipes à direita nas pistas com Sync Lock avançam para preencher o espaço.

---

## 8. Ripple Trim

- [ ] **8.1 Trim Normal (Padrão)**:
  1. Posicione o cursor na borda esquerda ou direita de um clipe até o cursor mudar para trim (`col-resize`).
  2. Arraste para encurtar ou estender.
  3. **Resultado Esperado**: Apenas o clipe que está sendo trimado tem seu ponto de entrada/saída modificado. Os clipes seguintes não se movem.

- [ ] **8.2 Ripple Trim (`Ctrl` + Trim)**:
  1. Segure **`Ctrl`** e arraste a borda de corte de um clipe.
  2. **Resultado Esperado**: Conforme você encurta ou estende o clipe, todos os clipes posteriores nas pistas sincronizadas (Sync Lock) avançam ou recuam em tempo real acompanhando o ajuste.

---

## 9. Histórico Global (Undo / Redo)

- [ ] **9.1 Desfazer / Refazer**:
  1. Realize uma sequência de ações: mover clipe, deletar gap, fazer ripple insert.
  2. Pressione **`Ctrl + Z`** repetidamente.
  3. **Resultado Esperado**: Cada operação é desfeita perfeitamente passo a passo.
  4. Pressione **`Ctrl + Y`** (ou **`Ctrl + Shift + Z`**).
  5. **Resultado Esperado**: Cada operação é refeita com precisão.
