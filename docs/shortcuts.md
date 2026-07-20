# 🎹 Cheat Sheet de Atalhos de Teclado e Operações

O **CapIAu-Talho** foi projetado para ser operado de forma ágil por
editores de vídeo através de atalhos de teclado no estilo NLE
profissional.

Abaixo está o guia rápido dos comandos suportados no sistema:

## 🎬 Controles do Player de Vídeo (Padrão NLE JKL)

Os atalhos abaixo controlam o player de origem (*Source*) ou o player de
timeline (*Program*), dependendo de qual deles estiver focado.

  -----------------------------------------------------------------------
         **Tecla**        **Ação**                **Descrição**
  ----------------------- ----------------------- -----------------------
           **J**          **Retroceder Vídeo**    Pressione
                                                  consecutivamente para
                                                  acelerar a velocidade
                                                  de retrocesso (-1x,
                                                  -2x, -4x, -8x).

           **K**          **Play / Pause**        Pausa a reprodução ou
                                                  retoma a reprodução na
                                                  velocidade normal
                                                  (1.0x).

           **L**          **Avançar Vídeo**       Pressione
                                                  consecutivamente para
                                                  acelerar a velocidade
                                                  de avanço (1.5x, 2x,
                                                  4x, 8x).

        **Espaço**        **Play / Pause          Atalho rápido para
                          (Geral)**               alternar
                                                  reprodução/pausa no
                                                  monitor ativo.

     **Setas (← / →)**    **Navegar Frames**      Retrocede ou avança
                                                  exatamente 1 frame do
                                                  vídeo para cortes
                                                  cirúrgicos.

           **Q**          **Alternar Monitor      Quando um dos players
                          Maximizado**            estiver maximizado
                                                  (tela cheia), alterna
                                                  instantaneamente para o
                                                  outro monitor
                                                  maximizado.

    **Clique Simples**    **Play / Pause**        Clicar na área de vídeo
                                                  de qualquer player
                                                  (Source/Program)
                                                  alterna a reprodução.

     **Duplo Clique**     **Maximizar /           Clicar duas vezes
                          Minimizar**             rápido na área de vídeo
                                                  de qualquer player
                                                  maximiza ou minimiza
                                                  sua visualização.
  -----------------------------------------------------------------------

## ✂️ Marcação de Pontos e Edição na Timeline

  -----------------------------------------------------------------------
         **Tecla**        **Ação**                **Descrição**
  ----------------------- ----------------------- -----------------------
           **I**          **Marcar Entrada (In)** Define o
                                                  frame/timestamp inicial
                                                  do segmento a ser
                                                  recortado do Source.

           **O**          **Marcar Saída (Out)**  Define o
                                                  frame/timestamp final
                                                  do segmento a ser
                                                  recortado do Source.

           **E**          **Adicionar à           Insere o segmento
                          Timeline**              selecionado \[In-Out\]
                                                  na trilha de destino
                                                  correspondente.

       **Shift + E**      **Corte de Fala         Insere diretamente a
                          Rápido**                frase ou bloco de
                                                  diálogo selecionado no
                                                  painel de transcrições
                                                  na trilha V1.
  -----------------------------------------------------------------------

## 🔄 Edição e Controle de Alternativas (IA), Inspetor & Histórico

Os comandos abaixo mudam de comportamento contextualmente baseado em
qual painel do programa você está interagindo (Biblioteca de Mídias vs.
Timeline).

+-----------------------+-----------------------+-----------------------+
| **Tecla**             | **Ação**              | **Descrição**         |
+:=====================:+:======================+=======================+
| **A**                 | **Abrir/Fechar        | **Se focado na        |
|                       | Inspetor ou           | Biblioteca/Mídias:**  |
|                       | Alternativas**        | Abre ou fecha o       |
|                       |                       | Inspetor de Mídia     |
|                       |                       | Integrado.            |
|                       |                       |                       |
|                       |                       | **Se focado na        |
|                       |                       | Timeline:** Abre ou   |
|                       |                       | fecha o modal de      |
|                       |                       | alternativas da IA    |
|                       |                       | para o clipe          |
|                       |                       | selecionado.          |
+-----------------------+-----------------------+-----------------------+
| **Esc (Escape)**      | **Fechar Inspetor ou  | Fecha o Inspetor de   |
|                       | Alternativas**        | Mídia ou o modal de   |
|                       |                       | alternativas da IA    |
|                       |                       | caso estejam abertos. |
+-----------------------+-----------------------+-----------------------+
| **Delete /            | **Deletar Clipe /     | Apaga o clipe         |
| Backspace**           | Rejeitar Ghost**      | selecionado na        |
|                       |                       | timeline. Se for um   |
|                       |                       | clipe fantasma        |
|                       |                       | (*ghost clip*),       |
|                       |                       | rejeita a sugestão.   |
+-----------------------+-----------------------+-----------------------+
| **Enter / Y**         | **Aceitar Sugestão da | Aceita e consolida o  |
|                       | IA**                  | clipe fantasma        |
|                       |                       | (*ghost clip*)        |
|                       |                       | selecionado na        |
|                       |                       | timeline.             |
+-----------------------+-----------------------+-----------------------+
| **U**                 | **Desvincular Par     | Desvincula o clipe de |
|                       | A/V**                 | vídeo selecionado de  |
|                       |                       | seu respectivo par de |
|                       |                       | áudio para trims      |
|                       |                       | independentes         |
|                       |                       | (J/L-cuts).           |
+-----------------------+-----------------------+-----------------------+
| **Z**                 | **Dividir Clipe       | Divide o clipe        |
|                       | (Split)**             | selecionado na        |
|                       |                       | timeline ao meio,     |
|                       |                       | exatamente na posição |
|                       |                       | atual da agulha       |
|                       |                       | (playhead). Se        |
|                       |                       | estiver vinculado     |
|                       |                       | (A/V), divide ambos.  |
+-----------------------+-----------------------+-----------------------+
| **Setas (← / →)**     | **Deslocar Clipe      | Desloca o clipe       |
|                       | (Nudge)**             | selecionado           |
|                       |                       | exatamente 1 frame    |
|                       |                       | para a esquerda ou    |
|                       |                       | direita na timeline.  |
+-----------------------+-----------------------+-----------------------+
| **Alt + Setas (← /    | **Ajustar Entrada     | Ajusta a borda        |
| →)**                  | (Trim In)**           | esquerda (In-point)   |
|                       |                       | do clipe selecionado  |
|                       |                       | em 1 frame para trás  |
|                       |                       | (←) ou para a frente  |
|                       |                       | (→). (Alternativa     |
|                       |                       | layout-independent).  |
+-----------------------+-----------------------+-----------------------+
| **Shift + Setas (← /  | **Ajustar Saída (Trim | Ajusta a borda        |
| →)**                  | Out)**                | direita (Out-point)   |
|                       |                       | do clipe selecionado  |
|                       |                       | em 1 frame para trás  |
|                       |                       | (←) ou para a frente  |
|                       |                       | (→). (Alternativa     |
|                       |                       | layout-independent).  |
+-----------------------+-----------------------+-----------------------+
| **\[ / \]**           | **Ajustar Bordas      | Atalho clássico de    |
|                       | (Nudge Trim)**        | uma tecla: ajusta a   |
|                       |                       | borda esquerda para   |
|                       |                       | trás (\[) ou a borda  |
|                       |                       | direita para a frente |
|                       |                       | (\]) em 1 frame.      |
+-----------------------+-----------------------+-----------------------+
| **Ctrl + Z**          | **Desfazer**          | Desfaz o último passo |
|                       |                       | de edição na          |
|                       |                       | timeline.             |
+-----------------------+-----------------------+-----------------------+
| **Ctrl + Y ou         | **Refazer**           | Refaz o passo de      |
| Ctrl+Shift+Z**        |                       | edição desfeito.      |
+-----------------------+-----------------------+-----------------------+
| **Duplo Clique (nos    | **Resetar Ajuste**    | Restaura o slider de  |
| sliders / rótulos)**  |                       | ajuste selecionado    |
|                       |                       | (escala, posição X/Y, |
|                       |                       | rotação, crop, volume)|
|                       |                       | ao seu valor padrão.  |
+-----------------------+-----------------------+-----------------------+
| **Clique nos ícones   | **Mute / Solo /       | Silencia (M), isola   |
| M / S / Olho nas      | Visibilidade**        | (S) ou oculta o vídeo |
| pistas da Timeline**  |                       | da pista selecionada. |
+-----------------------+-----------------------+-----------------------+

## 📍 Marcadores de Timeline e Clipe (Teclado-First)

  -----------------------------------------------------------------------
         **Tecla**        **Ação**                **Descrição**
  ----------------------- ----------------------- -----------------------
           **M**          **Criar / Editar        Adiciona um marcador
                          Marcador**              compacto na playhead
                                                  (auto-vincula ao clipe
                                                  de vídeo sob a agulha ou
                                                  na régua). Abre o box
                                                  compacto sem pausar
                                                  o vídeo.

         **Tab**          **Alternar Campos**     Alterna o foco do
                                                  teclado entre Nome,
                                                  Descrição e Cores.

    **Enter / Escape**    **Salvar e Fechar**     Salva o marcador e
                                                  fecha o box flutuante
                                                  instantaneamente.

     **Shift + Click**    **Seleção Múltipla**    Seleciona múltiplos
                                                  marcadores na timeline
                                                  (borda branca de
                                                  destaque).

    **Shift + M / Alt + M** **Navegar Marcadores** Pula a agulha para o
                                                  próximo (Shift+M) ou
                                                  anterior (Alt+M)
                                                  marcador.

     **Delete / Backspace** **Exclusão em Lote**  Apaga todos os marcadores
                                                  selecionados na timeline
                                                  em uma única ação.
  -----------------------------------------------------------------------

## 📸 Navegação no Visualizador de Fotos (Lightbox)

Quando o modal visualizador de fotos de set estiver aberto, os seguintes
atalhos estarão ativos:

  -----------------------------------------------------------------------
         **Tecla**        **Ação**                **Descrição**
  ----------------------- ----------------------- -----------------------
   **Seta Esquerda (←)**  **Foto Anterior**       Retrocede para a imagem
                                                  anterior da
                                                  galeria/pasta.

   **Seta Direita (→)**   **Próxima Foto**        Avança para a próxima
                                                  imagem da
                                                  galeria/pasta.

     **Esc (Escape)**     **Fechar Visualizador** Fecha o modal de fotos
                                                  de set com segurança.
  -----------------------------------------------------------------------

## 🛡️ Prevenção Automática de Conflitos de Digitação

- O sistema detecta de forma inteligente se o cursor do usuário está
  focado em qualquer elemento de formulário (campos de busca, inputs do
  chatbot, caixas de diálogo para nomear rostos, ou seletores de
  projetos).

- **Os atalhos de controle de vídeo e timeline são temporariamente
  suspensos** nesse estado para permitir uma digitação fluida de textos
  e evitar que comandos acidentais ativem os players.
