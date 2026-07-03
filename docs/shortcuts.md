# 🎹 Cheat Sheet de Atalhos de Teclado e Operações

O **CapIAu-Talho** foi projetado para ser operado de forma ágil por editores de vídeo através de atalhos de teclado no estilo NLE profissional. 

Abaixo está o guia rápido dos comandos suportados no sistema:

---

## 🎬 Controles do Player de Vídeo (Padrão NLE JKL)

Os atalhos abaixo controlam o player de origem (*Source*) ou o player de timeline (*Program*), dependendo de qual deles estiver focado.

| Tecla | Ação | Descrição |
| :---: | :--- | :--- |
| **`J`** | **Retroceder Vídeo** | Pressione consecutivamente para acelerar a velocidade de retrocesso (-1x, -2x, -4x, -8x). |
| **`K`** | **Play / Pause** | Pausa a reprodução ou retoma a reprodução na velocidade normal (1.0x). |
| **`L`** | **Avançar Vídeo** | Pressione consecutivamente para acelerar a velocidade de avanço (1.5x, 2x, 4x, 8x). |
| **`Espaço`** | **Play / Pause (Geral)** | Atalho rápido para alternar reprodução/pausa no monitor ativo. |
| **`Setas (← / →)`** | **Navegar Frames** | Retrocede ou avança exatamente 1 frame do vídeo para cortes cirúrgicos. |

---

## ✂️ Marcação de Pontos e Edição na Timeline

| Tecla | Ação | Descrição |
| :---: | :--- | :--- |
| **`I`** | **Marcar Entrada (In)** | Define o frame/timestamp inicial do segmento a ser recortado do Source. |
| **`O`** | **Marcar Saída (Out)** | Define o frame/timestamp final do segmento a ser recortado do Source. |
| **`E`** | **Adicionar à Timeline** | Insere o segmento selecionado [In-Out] na trilha de destino correspondente. |
| **`Shift + E`** | **Corte de Fala Rápido** | Insere diretamente a frase ou bloco de diálogo selecionado no painel de transcrições na trilha `V1`. |

---

## 📸 Navegação no Visualizador de Fotos (Lightbox)

Quando o modal visualizador de fotos de set estiver aberto, os seguintes atalhos estarão ativos:

| Tecla | Ação | Descrição |
| :---: | :--- | :--- |
| **`Seta Esquerda (←)`** | **Foto Anterior** | Retrocede para a imagem anterior da galeria/pasta. |
| **`Seta Direita (→)`** | **Próxima Foto** | Avança para a próxima imagem da galeria/pasta. |
| **`Esc (Escape)`** | **Fechar Visualizador** | Fecha o modal de fotos de set com segurança. |

---

## 🛡️ Prevenção Automática de Conflitos de Digitação
* O sistema detecta de forma inteligente se o cursor do usuário está focado em qualquer elemento de formulário (campos de busca, inputs do chatbot, caixas de diálogo para nomear rostos, ou seletores de projetos).
* **Os atalhos de controle de vídeo e timeline são temporariamente suspensos** nesse estado para permitir uma digitação fluida de textos e evitar que comandos acidentais ativem os players.
