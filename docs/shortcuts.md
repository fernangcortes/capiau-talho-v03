# 🎹 Cheat Sheet de Atalhos de Teclado e Operações

O **CapIAu-Talho** foi projetado para ser operado de forma ágil por editores de vídeo através de atalhos de teclado no estilo NLE profissional.

Abaixo está o guia completo dos comandos suportados no sistema:

---

## 🎬 Controles do Player de Vídeo (Padrão NLE JKL)

Os atalhos abaixo controlam o player de origem (*Source*) ou o player de timeline (*Program*), dependendo de qual deles estiver focado.

| Tecla | Ação | Descrição |
| :--- | :--- | :--- |
| **`J`** | **Retroceder Vídeo** | Pressione consecutivamente para acelerar a velocidade de retrocesso (-1x, -2x, -4x, -8x). |
| **`K`** | **Play / Pause** | Pausa a reprodução ou retoma a reprodução na velocidade normal (1.0x). |
| **`L`** | **Avançar Vídeo** | Pressione consecutivamente para acelerar a velocidade de avanço (1.5x, 2x, 4x, 8x). |
| **`Espaço`** | **Play / Pause (Geral)** | Atalho rápido para alternar reprodução/pausa no monitor ativo. |
| **`←` / `→`** | **Navegar Frames** | Retrocede ou avança exatamente 1 frame do vídeo para cortes cirúrgicos. |
| **`↑` / `↓`** | **Navegar Pontos de Corte (Edit Points)** | **No Program / Timeline:** Move a agulha (playhead) para o ponto de corte (início ou fim de clipe) anterior (↑) ou próximo (↓).<br>**No Source:** Pula para o ponto In/Início (↑) ou ponto Out/Fim (↓). |
| **Clique Simples** | **Play / Pause** | Clicar na área de vídeo de qualquer player (Source/Program) alterna a reprodução. |
| **Duplo Clique** | **Maximizar / Minimizar** | Clicar duas vezes rápido na área de vídeo de qualquer player maximiza ou minimiza sua visualização. |

---

## ✂️ Marcação de Pontos e Edição na Timeline

| Tecla | Ação | Descrição |
| :--- | :--- | :--- |
| **`I`** | **Marcar Entrada (In)** | Define o frame/timestamp inicial do segmento a ser recortado do Source. |
| **`O`** | **Marcar Saída (Out)** | Define o frame/timestamp final do segmento a ser recortado do Source. |
| **`E`** | **Adicionar à Timeline** | Insere o segmento selecionado [In-Out] na trilha de destino correspondente. |
| **`Shift + E`** | **Corte de Fala Rápido** | Insere diretamente a frase ou bloco de diálogo selecionado no painel de transcrições na trilha V1. |

---

## 🔄 Edição e Controle de Alternativas (IA), Inspetor & Histórico

Os comandos abaixo mudam de comportamento contextualmente baseado em qual painel do programa você está interagindo (Biblioteca de Mídias vs. Timeline).

| Tecla | Ação | Descrição |
| :--- | :--- | :--- |
| **`Q`** | **Ripple Delete até a Agulha (Playhead)** | Corta a parte inicial do clipe (Início até a agulha) e fecha o espaço puxando os clipes seguintes nas pistas sincronizadas. |
| **`W`** | **Ripple Delete da Agulha até o Fim** | Corta a parte final do clipe (Agulha até o fim) e fecha o espaço puxando os clipes seguintes nas pistas sincronizadas. |
| **`V`** | **Ferramenta de Seleção Padrão** | Retorna à Ferramenta de Seleção Normal (cursor padrão). |
| **`T`** | **Selecionar Faixa para Frente** | Seleciona todos os clipes à direita em todas as faixas ativas para arrasto (*Shift+Clique: apenas 1 faixa*). |
| **`Shift + T`** | **Selecionar Faixa para Trás** | Seleciona todos os clipes à esquerda em todas as faixas ativas para arrasto (*Shift+Clique: apenas 1 faixa*). |
| **`A`** | **Abrir/Fechar Inspetor ou Alternativas (IA)** | **Se focado na Biblioteca/Mídias:** Abre ou fecha o Inspetor de Mídia Integrado.<br>**Se focado na Timeline:** Abre ou fecha o modal de alternativas da IA para o clipe selecionado. |
| **`Esc` (Escape)** | **Fechar Inspetor, Alternativas ou Desmarcar Seleção** | Fecha o Inspetor de Mídia, modal de alternativas ou limpa seleções múltiplas. |
| **`Delete` / `Backspace`** | **Lift Delete / Deletar Gap / Ghost** | **Em clipe:** Apaga o clipe mantendo o espaço vazio (Gap).<br>**Em Gap:** Executa o Ripple Delete do Gap, fechando o espaço nas pistas com Sync Lock.<br>**Em Ghost:** Rejeita a sugestão da IA. |
| **`Shift + Delete`** | **Ripple Delete de Clipe** | Apaga o clipe selecionado e fecha o buraco puxando todos os clipes posteriores nas pistas com Sync Lock ativo. |
| **`S`** | **Alternar Snapping Magnético** | Alterna o encaixe magnético global da timeline e exibe guias verticais em tempo real no Canvas. |
| **`Ctrl + Arraste` (ou Drop)** | **Ripple Insert** | Insere clipe ou mídia abrindo espaço e empurrando os cortes à direita nas pistas sincronizadas. |
| **`Ctrl + Trim`** | **Ripple Trim** | Ajusta as bordas de entrada/saída de um clipe compensando o tempo nas pistas com Sync Lock ativo. |
| **`Enter` / `Y`** | **Aceitar Sugestão da IA** | Aceita e consolida o clipe fantasma (*ghost clip*) selecionado na timeline. |
| **`U`** | **Desvincular Par A/V** | Desvincula o clipe de vídeo selecionado de seu respectivo par de áudio para trims independentes (J/L-cuts). |
| **`Z`** | **Dividir Clipe (Split)** | Divide o clipe selecionado na timeline ao meio, exatamente na posição atual da agulha (playhead). Se estiver vinculado (A/V), divide ambos. |
| **`←` / `→`** | **Deslocar Clipe (Nudge)** | Desloca o clipe selecionado exatamente 1 frame para a esquerda ou direita na timeline. |
| **`↑` / `↓`** | **Ir aos Pontos de Corte (Edit Points)** | Move a agulha (playhead) para o ponto de corte (início ou fim de clipe) anterior (↑) ou próximo (↓). |
| **`Alt + ←` / `Alt + →`** | **Ajustar Entrada (Trim In)** | Ajusta a borda esquerda (In-point) do clipe selecionado em 1 frame para trás (←) ou para a frente (→). |
| **`Shift + ←` / `Shift + →`** | **Ajustar Saída (Trim Out)** | Ajusta a borda direita (Out-point) do clipe selecionado em 1 frame para trás (←) ou para a frente (→). |
| **`[` / `]`** | **Ajustar Bordas (Nudge Trim)** | Atalho clássico de uma tecla: ajusta a borda esquerda para trás (`[`) ou a borda direita para a frente (`]`) em 1 frame. |
| **`Ctrl + Z`** | **Desfazer** | Desfaz o último passo de edição na timeline. |
| **`Ctrl + Y` ou `Ctrl + Shift + Z`** | **Refazer** | Refaz o passo de edição desfeito. |
| **Duplo Clique (nos sliders / rótulos)** | **Resetar Ajuste** | Restaura o slider de ajuste selecionado (escala, posição X/Y, rotação, crop, volume) ao seu valor padrão. |
| **Botão Sync Lock (cabeçalho de pista)** | **Sync Lock por Pista** | Ativa/desativa o sincronismo de operações de ripple para aquela pista. |
| **Clique nos ícones M / S / Olho** | **Mute / Solo / Visibilidade** | Silencia (M), isola (S) ou oculta o vídeo da pista selecionada na Timeline. |

---

## 📍 Marcadores de Timeline e Clipe (Teclado-First)

| Tecla | Ação | Descrição |
| :--- | :--- | :--- |
| **`M`** | **Criar / Editar Marcador** | Adiciona um marcador compacto na playhead (auto-vincula ao clipe de vídeo sob a agulha ou na régua). Abre o box compacto sem pausar o vídeo. |
| **`Tab`** | **Alternar Campos** | Alterna o foco do teclado entre Nome, Descrição e Cores. |
| **`Enter` / `Esc`** | **Salvar e Fechar** | Salva o marcador e fecha o box flutuante instantaneamente. |
| **`Shift + Clique`** | **Seleção Múltipla** | Seleciona múltiplos marcadores na timeline (borda branca de destaque). |
| **`Shift + M` / `Alt + M`** | **Navegar Marcadores** | Pula a agulha para o próximo (`Shift+M`) ou anterior (`Alt+M`) marcador. |
| **`Delete` / `Backspace`** | **Exclusão em Lote** | Apaga todos os marcadores selecionados na timeline em uma única ação. |

---

## 📸 Navegação no Visualizador de Fotos (Lightbox)

Quando o modal visualizador de fotos de set estiver aberto, os seguintes atalhos estarão ativos:

| Tecla | Ação | Descrição |
| :--- | :--- | :--- |
| **`←` (Seta Esquerda)** | **Foto Anterior** | Retrocede para a imagem anterior da galeria/pasta. |
| **`→` (Seta Direita)** | **Próxima Foto** | Avança para a próxima imagem da galeria/pasta. |
| **`Esc` (Escape)** | **Fechar Visualizador** | Fecha o modal de fotos de set com segurança. |

---

## 🗂️ Índice Temático de Rolagem da Biblioteca (Scroll Peeker)

Ativos sobre a **barra de rolagem** da biblioteca, no painel esquerdo. Permitem inspecionar e saltar para qualquer ponto do acervo sem rolar até lá.

| Gesto | Ação | Descrição |
| :--- | :--- | :--- |
| **Parar o mouse sobre a barra** | **Espiar o item** | Abre um cartão com miniatura, pasta de origem, título executivo, tipo (*Fala* / *Bastidores*), duração, resumo, tags e a posição (`N de M`). O tempo de parada é configurável em 0,5s / 1,0s / 1,5s, ou desativado, no menu de exibição da biblioteca. |
| **Arrastar sobre a barra** | **Salto calibrado** | Rola continuamente alinhando o **topo do item real** sob o cursor, em vez da proporção crua — o salto para no começo do card, não no meio dele. |
| **`Shift` + roda do mouse** | **Redimensionar a miniatura** | Com o cartão aberto, aumenta ou diminui a miniatura de 80 a 240 px. A escolha fica guardada entre sessões. |

---

## ✏️ Renomeação de Mídias na Biblioteca

| Gesto | Ação | Descrição |
| :--- | :--- | :--- |
| **Duplo clique no título** | **Editar no lugar** | Troca o título do card por um campo de edição, já com o texto selecionado. |
| **`Enter`** | **Gravar** | Salva o novo título e volta à exibição normal. |
| **`Esc`** | **Cancelar** | Descarta a edição e restaura o título anterior. |

---

## 📝 Operações do Editor de Títulos e Text Overlay (Player)

| Gesto / Tecla | Ação | Descrição |
| :--- | :--- | :--- |
| **Clique na caixa de texto** | **Selecionar Text Box** | Ativa a caixa delimitadora com alças de transformação sobre o monitor Program. |
| **Arrastar caixa de texto** | **Mover / Reposicionar** | Move o GC ou título livremente com encaixe magnético no centro e bordas da imagem. |
| **Arrastar alças de canto** | **Redimensionar** | Ajusta proporcionalmente o tamanho da tipografia e da caixa de fundo (*pill*). |
| **Duplo clique no texto** | **Editar no Lugar** | Transforma o elemento visual do player em campo de digitação direto. |
| **`Esc` (com texto ativo)** | **Concluir Edição** | Desmarca a caixa de texto e restaura os controles normais do player NLE. |

---

## 🛡️ Prevenção Automática de Conflitos de Digitação

- O sistema detecta de forma inteligente se o cursor do usuário está focado em qualquer elemento de formulário (campos de busca, inputs do chatbot, caixas de diálogo para nomear rostos, ou seletores de projetos).
- **Os atalhos de controle de vídeo e timeline são temporariamente suspensos** nesse estado para permitir uma digitação fluida de textos e evitar que comandos acidentais ativem os players.
