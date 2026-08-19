<div align="center">

# 🎬 CapIAu-Talho

**Ilha de pré-edição, decupagem e assistência por IA para grandes acervos e documentários**

[![Licença: GPL v3](https://img.shields.io/badge/Licen%C3%A7a-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Status](https://img.shields.io/badge/Status-MVP%20em%20desenvolvimento-orange.svg)](docs/PLANO_IMPLEMENTACAO.md)
[![Roda em CPU](https://img.shields.io/badge/GPU-n%C3%A3o%20necess%C3%A1ria-success.svg)](#arquitetura-do-sistema)

</div>

<!-- IMAGEM: visão geral da interface com a timeline preenchida.
     Solte o arquivo em docs/images/hero-timeline.png e descomente a linha abaixo. -->
<!-- ![Interface do CapIAu-Talho](docs/images/hero-timeline.png) -->

O **CapIAu-Talho** é uma ilha de pré-edição, logging e assistência inteligente baseada em IA,
projetada sob medida para **documentaristas, editores de making-of e gestores de grandes acervos
audiovisuais**.

O sistema roda sobre uma **arquitetura híbrida otimizada para CPU local**: tarefas críticas de
privacidade e indexação — busca vetorial e biometria facial — acontecem 100% na sua máquina, **sem
GPU**. Só o trabalho linguístico pesado (transcrição e descrição de imagens) vai para APIs de nuvem,
de forma econômica e cirúrgica.

Ao contrário de ferramentas que tratam a IA como um acessório isolado, o CapIAu-Talho integra
modelos de linguagem e visão diretamente a uma **timeline multipista (NLE) em Canvas 2D**. Isso
permite mapear depoimentos palavra a palavra, buscar por conceito visual e montar cortes narrativos
semiautônomos — exportáveis para **Kdenlive, Premiere, Resolve e Final Cut**.

---

## 📑 Índice

- [🎯 Por que usar o CapIAu-Talho?](#por-que-usar-o-capiau-talho)
  - [Para documentaristas e diretores de making-of](#para-documentaristas-e-diretores-de-making-of)
  - [Para gestores de acervos e arquivistas](#para-gestores-de-acervos-e-arquivistas)
  - [Para editores de montagem profissional](#para-editores-de-montagem-profissional)
- [📸 Galeria](#galeria)
- [🚀 Recursos principais](#recursos-principais)
  - [🎞️ Decupagem e análise por IA](#decupagem-e-analise-por-ia)
  - [✂️ Timeline e edição](#timeline-e-edicao)
  - [👥 Rostos e personagens](#rostos-e-personagens)
  - [🖥️ Interface e produtividade](#interface-e-produtividade)
  - [🛡️ Resiliência e operação](#resiliencia-e-operacao)
- [📊 Arquitetura do sistema](#arquitetura-do-sistema)
  - [As quatro camadas](#as-quatro-camadas)
  - [Diagrama de fluxo](#diagrama-de-fluxo)
  - [O caminho de uma mídia, do disco à timeline](#o-caminho-de-uma-midia-do-disco-a-timeline)
- [🛠️ Como montar localmente](#como-montar-localmente)
  - [Requisitos](#requisitos)
  - [Passo a passo](#passo-a-passo)
  - [Executando](#executando)
- [⚙️ Configuração (.env)](#configuracao-env)
- [🩺 Solução de problemas](#solucao-de-problemas)
- [🧪 Testes](#testes)
- [🗺️ Roadmap](#roadmap)
- [📁 Estrutura de pastas](#estrutura-de-pastas)
- [📚 Documentação complementar](#documentacao-complementar)
- [📄 Licença](#licenca)

---

## 🎯 Por que usar o CapIAu-Talho? <a id="por-que-usar-o-capiau-talho"></a>

### Para documentaristas e diretores de making-of <a id="para-documentaristas-e-diretores-de-making-of"></a>

- **Edição por texto.** Visualize depoimentos e entrevistas transcritos palavra a palavra.
  Selecione frases ou parágrafos inteiros e insira-os direto na timeline com `Shift+E`.

- **J/L-cuts nativos.** Monte diálogos de forma cinematográfica, estendendo o áudio sob a imagem do
  entrevistado ou inserindo B-rolls de cobertura antes da fala começar — com trims independentes e
  compensação auditiva em tempo real no player.

- **Agrupamento temático automático.** Deixe a IA analisar dezenas de horas de entrevistas e
  organizá-las em tópicos (ex.: *"Direção de Arte"*, *"Problemas no Set"*), para navegar por
  subtemas instantaneamente.

### Para gestores de acervos e arquivistas <a id="para-gestores-de-acervos-e-arquivistas"></a>

- **Ingestão in-place, sem cópia.** Catalogue centenas de gigabytes mantendo os arquivos nos discos
  externos originais. Os proxies leves são gerados em segundo plano, sem sujar o armazenamento
  interno.

- **Busca híbrida, semântica e visual.** Pesquise o material bruto em linguagem natural (ex.:
  *"diretor gesticulando em frente à câmera sob iluminação quente"*). O sistema localiza o trecho
  exato em menos de 5 ms.

- **Biometria facial local.** Detecte, agrupe por proximidade (clustering DBSCAN) e identifique
  personagens de forma 100% local, com modelos ONNX otimizados para CPU. Nenhum rosto sai da sua
  máquina.

### Para editores de montagem profissional <a id="para-editores-de-montagem-profissional"></a>

- **Sem aprisionamento tecnológico.** Faça a triagem e o rough cut no CapIAu-Talho e exporte a
  timeline com precisão de frames em **OpenTimelineIO (`.otio`)**, **XML (Final Cut Pro 7)** ou
  **EDL**. O **Kdenlive 25.04+ abre o `.otio` nativamente**; Premiere, Resolve e Final Cut importam
  o `.xml`. O passo a passo está em [`docs/kdenlive_workflow.md`](docs/kdenlive_workflow.md).

- **Atalhos profissionais (scrubbing JKL).** Navegue com os mesmos atalhos de reprodução acelerada
  e reversa (`J`, `K`, `L`) e marcação de corte (`I`, `O`, `E`) do Premiere e do DaVinci Resolve.

---

## 📸 Galeria <a id="galeria"></a>

> As capturas de tela ficam em [`docs/images/`](docs/images/). Solte os arquivos com os nomes
> indicados e descomente as linhas correspondentes.

<!-- ![Biblioteca em árvore](docs/images/biblioteca-arvore.png) -->
<!-- *Biblioteca em árvore: acervos grandes organizados em pastas hierárquicas colapsáveis.* -->

<!-- ![Busca visual](docs/images/busca-visual.png) -->
<!-- *Busca por conceito visual em português, sem depender das palavras da descrição.* -->

<!-- ![Tela de rostos](docs/images/tela-rostos.png) -->
<!-- *Catalogação de elenco e equipe, com desambiguação em massa.* -->

<!-- ![Agente editor](docs/images/agente-chat.png) -->
<!-- *O agente propõe cortes direto na timeline, como rascunhos aprováveis (ghost clips).* -->

---

## 🚀 Recursos principais <a id="recursos-principais"></a>

### 🎞️ Decupagem e análise por IA <a id="decupagem-e-analise-por-ia"></a>

- **Segmentação real por shots e beats.** A decupagem visual não usa mais um relógio fixo (1 frame
  a cada 10 s). O vídeo é dividido em cortes reais (PySceneDetect), e planos-sequência longos são
  subdivididos em *beats* por deriva de conteúdo visual, com classificação automática do movimento
  de câmera (estático, pan, tilt, caminhando, mão livre, whip). Isso reduz o número de chamadas de
  IA e faz o player pular exatamente para o trecho certo ao clicar num resultado de busca.

- **Busca visual e "encontrar similares" (CLIP local).** Todo keyframe de vídeo e foto de set é
  embedado localmente por um modelo CLIP multilíngue, sem custo de API. Habilita busca por conceito
  visual em português (ex.: *"contraluz na janela"*) mesmo sem palavra correspondente na descrição,
  além de um botão **Encontrar Similares** no card de foto, no lightbox e no inspetor de vídeo.

- **Busca por similaridade em lote e explicações didáticas do RAG.** Selecione múltiplos cards para
  busca em lote e veja a justificativa de por que a IA relacionou determinado trecho à busca. Inclui
  painel de filtros em duas linhas e filtro por ciclo de status (*Todos*, *Analisados*, *Não
  Analisados*, *Erros*).

- **Títulos executivos gerados por IA.** Cada vídeo e foto recebe um título curto de 3 a 6
  palavras que diz o que a mídia é, no lugar do nome de arquivo da câmera — *"Zé: Crítica ao
  primeiro corte"*, *"Detalhe das mãos no vinil"*. O prompt proíbe explicitamente as aberturas
  genéricas que tornam um acervo ilegível (*"Vídeo de"*, *"Depoimento de"*, *"Este clipe
  mostra"*). A geração roda em lote pelo botão **Gerar Títulos IA**, em micro-lotes de 20, com
  progresso e cancelamento na tela de Tarefas — e qualquer título pode ser corrigido com duplo
  clique no card.

- **Assistente de diarização inteligente.** Fluxo completo para corrigir falantes na transcrição:
  gaveta de pistas globais (silêncios longos, perguntas, discrepâncias faciais) e inspetor de balão
  avançado. O inspetor exibe uma *waveform interativa* de fala, permite dividir depoimentos com dois
  cliques precisos e oferece desambiguação facial baseada em quem está na tela no milissegundo
  correspondente.

### ✂️ Timeline e edição <a id="timeline-e-edicao"></a>

- **Agente editor com ferramentas (IA copiloto).** Um agente conversacional analisa o roteiro e a
  timeline ativa e propõe cortes por *function-calling*. Edições simples são aplicadas direto (com
  undo/redo); edições complexas ou em lote viram rascunhos visuais (*ghost clips*) para aprovação.

- **Modal de alternativas da IA.** Todo clipe inserido pela IA carrega candidatos semânticos.
  Selecione um clipe e pressione **`A`**: um modal exibe cada alternativa tocando em loop silencioso,
  com a justificativa da IA. Troque com um clique usando **Slot Fixo** (mantém a duração) ou
  **Ripple** (desloca a timeline para encaixar a duração ideal).

- **Fotos still e efeito Ken Burns.** Insira fotos do set (inclusive RAW) como stills por
  arrastar-e-soltar. Anime movimentos suaves (Ken Burns), ajuste enquadramento (Fit/Fill) e fades
  pelo Inspetor de Foto, com composição no Program Player.

- **Viewport estável, transformação interativa e crop.** O viewport do Program mantém proporção
  física estável da sequência, com máscara de transbordo pontilhada em ciano. Selecione clipes e
  manipule uma *bounding box* direto no player para mover, escalar (alças de canto) ou rotacionar em
  tempo real. Inclui recorte (*crop*) relativo ao conteúdo, com preservação de scroll no painel e
  integração total ao histórico (undo/redo via `Ctrl+Z`).

- **Configurações da sequência e autoconfiguração.** Resolução e taxa de quadros (FPS) da timeline
  são definidas e persistidas (local e backend). O sistema autodetecta resolução e FPS do primeiro
  vídeo inserido para configurar uma timeline vazia. Alterar as configurações exibe avisos de
  reescalagem e atualiza a representação em frames preservando as durações em segundos.

- **Controles nativos de pista e interação avançada.** Botões para mutar, solar e ocultar pistas de
  vídeo (V1/V2) e áudio (A1/A2) individualmente. Inclui pré-visualização ao passar o mouse pela
  régua e pelos clipes, miniaturas progressivas e **duplo clique para resetar sliders** (posição,
  escala, rotação, crop e volume).

- **Marcadores teclado-first.** Marcadores de régua e marcadores ancorados ao clipe de vídeo
  (V1 / V2 B-Roll), com caixa flutuante compacta (310 px) que opera sem pausar a reprodução.
  Navegação rápida por teclado (**`M`** cria/edita, **`Tab`** alterna campos, **`Enter`/`Esc`** salva
  e fecha), seleção múltipla via **`Shift` + clique** e exclusão em lote via **`Delete`/`Backspace`**.

### 👥 Rostos e personagens <a id="rostos-e-personagens"></a>

- **Biometria facial, desambiguação em massa e autocura.** Tela dedicada à catalogação de elenco e
  equipe técnica: reatribua, funda grupos de rostos idênticos e rejeite artefatos, com preview de
  vídeo de contexto no hover. Inclui seleção em lote via **`Shift` + clique**, busca instantânea por
  digitação, paginação inteligente, cache local de miniaturas e um mecanismo de **autocura de dados**
  que protege suas decisões de auditoria manual contra sobrescritas automáticas do DBSCAN.

### 🖥️ Interface e produtividade <a id="interface-e-produtividade"></a>

- **Janelas destacáveis (workspaces multi-monitor).** Destaque Biblioteca, Timeline, Players ou
  Chatbot em janelas independentes, com sincronia de playhead, seleções e comandos em tempo real via
  `BroadcastChannel`.

- **Visualização em árvore inteligente.** Navegue por acervos gigantes organizados dinamicamente em
  pastas e subpastas hierárquicas colapsadas, no estilo do Explorer.

- **Índice temático na barra de rolagem (Scroll Peeker).** Parar o mouse sobre a barra de
  rolagem da biblioteca abre um cartão com a miniatura, o título executivo, o tipo, a duração e o
  resumo do item naquela altura — sem rolar até ele. Arrastar salta com alinhamento ao topo do
  card, e **`Shift` + roda** redimensiona a miniatura. Pensado para acervos em que rolar às cegas
  custa minutos.

- **Layout Estúdio e workspaces flexíveis.** Preset de interface para decupagem que maximiza a
  biblioteca e empilha os players Source/Program de forma limpa (*controles apenas no hover*), com a
  transcrição como terceira coluna retrátil. Gerencie a altura das pistas por slider global ou
  arraste individual pela borda. Workspaces customizadas podem ser salvas, sobrescritas, renomeadas
  e restauradas.

### 🛡️ Resiliência e operação <a id="resiliencia-e-operacao"></a>

- **Autossalvamento e histórico resiliente.** Gravação contínua em segundo plano (debounce de 1 s)
  de todo o estado da timeline (cortes, pistas, ghost clips) e da interface (zoom, scrolls, playhead,
  seleções), além da retenção completa do histórico de undo/redo contra `F5` e `Ctrl+F5`, por ID de
  projeto.

- **Resiliência de IA e fallback automático.** Seletor de modelos de visão na interface com queda
  automática para um modelo reserva quando o principal falha N vezes seguidas (veja
  [Configuração](#configuracao-env)). Inclui declaração explícita de `max_tokens`, para evitar
  reservas indevidas de saldo no OpenRouter, e proteção anti-sobrescrita de análises existentes.

- **Painel de logs avançado com IA.** Aba lateral que simula um terminal escuro, intercepta o
  console de desenvolvimento e registra as ações do usuário em tempo real. Conta com exportação
  rápida em texto e dois botões de IA (via OpenRouter) para gerar um relatório legível por humanos
  ou uma análise técnica estruturada de performance e exceções.

- **Gerenciador de tarefas de miniaturas e lançador desgrudado.** Painel para pausar, cancelar,
  remover e sincronizar a geração de miniaturas. No Windows, o script
  [`scripts/launch_detached.py`](scripts/launch_detached.py) roda o backend desvinculado do console,
  evitando travamentos acidentais (veja [Executando](#executando)).

---

## 📊 Arquitetura do sistema <a id="arquitetura-do-sistema"></a>

### As quatro camadas <a id="as-quatro-camadas"></a>

O CapIAu-Talho é dividido em quatro camadas. A decisão de projeto mais importante está na coluna
**Onde roda**: tudo que é sensível ou repetitivo fica na sua máquina; a nuvem só é acionada para o
que exige um modelo grande, uma vez por mídia.

| Camada | Onde roda | O que faz | Custo |
|---|---|---|---|
| 💾 **Armazenamento** | HD externo / SSD | Guarda os arquivos originais, que **nunca são copiados** | — |
| 🐍 **Backend** | Sua CPU, local | Ingestão, proxies, segmentação, embeddings, biometria facial, banco vetorial | Grátis |
| ☁️ **Nuvem** | APIs externas | Transcrição com diarização e descrição de imagens | Pago, por uso |
| 💻 **Frontend** | Navegador | Timeline em Canvas 2D, players duplos, biblioteca, chat do agente | — |

### Diagrama de fluxo <a id="diagrama-de-fluxo"></a>

```mermaid
graph TD
    subgraph HD["💾 Armazenamento do usuário"]
        Originals["Vídeos e fotos originais<br/>.mp4 · .mov · .mxf · RAW"]
    end

    subgraph Backend["🐍 Backend FastAPI — 100% CPU local, sem GPU"]
        Watcher["Ingestor<br/>varredura + SHA-256"]
        FFmpeg["FFmpeg<br/>proxies 720p · MP3 16 kHz · recorte de rostos"]
        Segmentation["PySceneDetect + OpenCV<br/>shots, beats e movimento de câmera"]
        SQLite[("SQLite<br/>metadados · diálogos · projetos · timelines")]
        MiniLM["Sentence-Transformers MiniLM<br/>embeddings de texto"]
        CLIPEngine["CLIP multilíngue<br/>embeddings de imagem"]
        FaceEngine["YuNet + SFace (ONNX)<br/>detecção e biometria facial"]
        Qdrant[("Qdrant local<br/>busca vetorial &lt; 5 ms")]
    end

    subgraph Cloud["☁️ APIs de nuvem — uso cirúrgico"]
        AssemblyAI["AssemblyAI<br/>transcrição + diarização pt-BR"]
        OpenRouter["OpenRouter<br/>DeepSeek V4-Flash · Gemini 2.5 Flash"]
        S3["AWS S3 (opcional)<br/>armazenamento remoto"]
    end

    subgraph Frontend["💻 Frontend web — NLE em Canvas 2D"]
        Biblioteca["Biblioteca em árvore<br/>+ aba Rostos"]
        Player["Players duplos<br/>Source / Program · JKL · I-O"]
        Timeline["Timeline multipista<br/>V1/V2 · A1/A2 · undo/redo"]
        Chat["Chat do agente editor<br/>+ modal de alternativas"]
    end

    Originals --> Watcher
    Watcher --> SQLite
    Watcher --> FFmpeg

    FFmpeg -->|proxy 720p/360p| Player
    FFmpeg -->|proxy 720p| Segmentation
    FFmpeg -->|mono MP3 16 kHz| AssemblyAI
    FFmpeg -->|frames de set / B-roll| CLIPEngine
    FFmpeg -->|recorte de rostos| FaceEngine
    FFmpeg -.->|opcional| S3

    AssemblyAI -->|diarização + timestamps| SQLite
    AssemblyAI -->|texto para indexar| MiniLM
    MiniLM -->|embeddings de texto| Qdrant

    Segmentation -->|shots · beats · keyframes| SQLite
    Segmentation -->|keyframes por segmento| OpenRouter

    CLIPEngine -->|embeddings de imagem| Qdrant
    FaceEngine -->|embeddings e grupos de rostos| SQLite

    SQLite -->|contexto da timeline| OpenRouter
    OpenRouter -->|operações e ghost clips| Timeline
    OpenRouter -->|temas e descrições| SQLite
    OpenRouter -->|descrições visuais| Qdrant

    Qdrant -->|busca híbrida e similares| Biblioteca
    Biblioteca --> Timeline
    Chat --> Timeline
    Timeline -->|exportar .otio / .xml / .edl| HD
```

### O caminho de uma mídia, do disco à timeline <a id="o-caminho-de-uma-midia-do-disco-a-timeline"></a>

1. **Ingestão.** O ingestor varre a pasta apontada, calcula um SHA-256 de cada arquivo (para nunca
   catalogar o mesmo material duas vezes) e grava só o *caminho* no SQLite. O arquivo original não
   sai do lugar.
2. **Proxies.** O FFmpeg gera uma cópia leve em 720p para o player e um MP3 mono de 16 kHz para a
   transcrição. Só o MP3 sobe para a nuvem — nunca o vídeo.
3. **Segmentação.** O PySceneDetect quebra o vídeo nos cortes reais e subdivide planos longos em
   *beats*, escolhendo um keyframe representativo de cada trecho.
4. **Análise.** Os keyframes escolhidos (poucos, não um a cada 10 s) vão para o OpenRouter, que
   devolve descrições visuais. O áudio vai para o AssemblyAI, que devolve a transcrição já separada
   por falante.
5. **Indexação.** Texto e imagem viram vetores — MiniLM para texto, CLIP para imagem — e são
   gravados no Qdrant local. É isso que permite buscar *"contraluz na janela"* e achar o plano
   mesmo sem essa palavra na descrição.
6. **Rostos.** Em paralelo, o YuNet detecta rostos, o SFace os transforma em vetores e o DBSCAN os
   agrupa. Suas correções manuais ficam travadas contra reagrupamentos futuros.
7. **Edição e exportação.** Você monta na timeline em Canvas 2D e exporta em `.otio`, `.xml` ou
   `.edl` para finalizar no seu NLE de preferência.

---

## 🛠️ Como rodar o CapIAu-Talho <a id="como-montar-localmente"></a>

Você pode rodar o CapIAu-Talho de duas formas:
1. **Via Docker (Recomendado)**: Ambiente isolado e 100% reprodutível. Nunca quebra com atualizações do seu computador.
2. **Localmente via Python Virtualenv**: Usando `.venv` com Python 3.12.

---

### 🐳 Opção 1: Rodando com Docker (Recomendado)

O container já inclui **Python 3.12**, **FFmpeg**, **PyTorch CPU**, **OpenCV**, **OpenTimelineIO** e todas as dependências pré-configuradas. Suas pastas de mídias (`watch/`), banco de dados e modelos (`data/`) são persistidas no seu disco físico, e o código em `src/` recarrega automaticamente ao ser editado.

**1. Configure o `.env` (se ainda não o fez):**

```bash
cp .env.example .env
```
Preencha suas chaves da OpenRouter e AssemblyAI no `.env`.

**2. Inicie o container:**

No Windows (PowerShell):
```powershell
.\scripts\run-docker.ps1
```
Ou com o comando padrão do Docker:
```bash
docker compose up --build
```

**3. Acesse a interface:**
Abra no navegador: [http://localhost:8000](http://localhost:8000)

---

### 🐍 Opção 2: Rodando Localmente (.venv)

### Requisitos

| Item | Mínimo | Observações |
|---|---|---|
| **Python** | 3.12 (Recomendado) | 3.10+ compatível |
| **FFmpeg** | qualquer versão recente | Precisa do `ffmpeg` **e** do `ffprobe`, ambos no `PATH` |
| **RAM** | 8 GB | 16 GB recomendados para acervos grandes |
| **GPU** | não é necessária | Todo o processamento local roda em CPU |

**1. Inicie com o script automatizado:**

No Windows (PowerShell):
```powershell
.\scripts\run-local.ps1
```

Ou execute manualmente:

```powershell
# Criação do ambiente virtual com Python 3.12
uv venv .venv --python 3.12
# ou: py -3.12 -m venv .venv

# Instalação das dependências
uv pip install -r requirements.txt
# ou: .venv\Scripts\pip install -r requirements.txt

# Inicialização do servidor
.venv\Scripts\python -m uvicorn src.api.server:app --reload
```

**Acesse:** 👉 **http://localhost:8000/**

---

## ⚙️ Configuração (.env) <a id="configuracao-env"></a>

Todas as chaves abaixo são lidas do arquivo `.env` na raiz do projeto. As marcadas como
**ajustáveis na interface** também podem ser alteradas pelo painel de configurações, sem reiniciar —
e o valor salvo no painel **tem prioridade sobre o `.env`**.

### Chaves de API (obrigatórias) <a id="chaves-de-api-obrigatorias"></a>

| Variável | Para que serve |
|---|---|
| `OPENROUTER_API_KEY` | Descrições visuais, temas, resumos e o agente de edição |
| `ASSEMBLYAI_API_KEY` | Transcrição com diarização em pt-BR |

### Modelos de IA <a id="modelos-de-ia"></a>

| Variável | Padrão | Para que serve |
|---|---|---|
| `TEXT_MODEL` | `deepseek/deepseek-v4-flash` | Resumos, temas, sugestões de timeline e chat. `deepseek/deepseek-v4-pro` entrega melhor qualidade a um custo maior. *Ajustável na interface.* |
| `VISION_MODEL` | `google/gemini-2.5-flash` | Descrição de frames e fotos. *Ajustável na interface.* |
| `VISION_MODEL_FALLBACK` | `nvidia/nemotron-nano-12b-v2-vl:free` | Modelo reserva, acionado só depois que o principal falha. *Ajustável na interface.* |
| `VISION_MAX_RETRIES` | `2` | Quantas tentativas no modelo principal antes de cair para a reserva |
| `AGENT_MODEL` | `deepseek/deepseek-v4-flash` | Modelo do agente que edita a timeline por comandos de chat |
| `EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Embeddings de texto. Ao trocar, rode `POST /api/search/reindex` para reindexar o acervo |

> **Sobre modelos gratuitos (`:free`).** O limite da OpenRouter é de 20 pedidos por minuto sempre, e
> 1000 por dia apenas se a conta já acumulou US$ 10 em compras — caso contrário, 50 por dia. Em lotes
> grandes eles também falham com timeout sob carga. Por isso o padrão de visão é pago e o gratuito
> fica como reserva.

### Desempenho <a id="desempenho"></a>

| Variável | Padrão | Para que serve |
|---|---|---|
| `MAX_CONVERSION_WORKERS` | `2` | Conversões de proxy em paralelo. Ex.: `6` para um i7-10700 |

### Caminhos locais (opcionais) <a id="caminhos-locais-opcionais"></a>

| Variável | Padrão | Para que serve |
|---|---|---|
| `CAPIAU_DB_PATH` | `data/capiau.db` | Banco SQLite |
| `CAPIAU_EXPORTS_DIR` | `data/exports` | Destino das timelines exportadas |

### Armazenamento remoto (opcional) <a id="armazenamento-remoto-opcional"></a>

| Variável | Para que serve |
|---|---|
| `USE_S3_STORAGE` | `true` para enviar proxies e miniaturas ao S3 em vez de manter só localmente |
| `AWS_ACCESS_KEY_ID` | Credencial da AWS |
| `AWS_SECRET_ACCESS_KEY` | Credencial da AWS |
| `AWS_REGION` | Região do bucket (ex.: `us-east-1`) |
| `AWS_S3_BUCKET` | Nome do bucket |

### Reconhecimento facial em nuvem (opcional) <a id="reconhecimento-facial-em-nuvem-opcional"></a>

| Variável | Para que serve |
|---|---|
| `AZURE_FACE_ENDPOINT` | Endpoint do Azure Face, alternativa ao motor local |
| `AZURE_FACE_KEY` | Chave do Azure Face |

> ⚠️ O arquivo `.env` é ignorado pelo Git de propósito — ele contém segredos. **Nunca** faça commit
> dele. Veja [`docs/costs_and_security.md`](docs/costs_and_security.md).

---

## 🩺 Solução de problemas <a id="solucao-de-problemas"></a>

<details>
<summary><strong>O servidor não abre e o erro fala em <code>tokenizers</code> ou <code>transformers</code></strong></summary>

<br>

Mensagem típica:

```
ImportError: tokenizers>=0.22.0,<=0.23.0 is required for a normal functioning
of this module, but found tokenizers==0.23.1
```

Alguma instalação avulsa atualizou o `tokenizers` além do que o `transformers` aceita. Rebaixe para
a versão compatível:

```bash
pip install "tokenizers==0.22.2"
```

> A versão `0.23.0` nunca foi publicada em formato final — o salto foi de `0.22.2` para `0.23.1`.
> Por isso `0.22.2` é a maior que satisfaz o requisito.

**Como evitar:** use um ambiente virtual dedicado (passo 3 da [montagem](#passo-a-passo)). Sem ele,
qualquer projeto Python da máquina pode mexer nas dependências deste.

</details>

<details>
<summary><strong><code>ffmpeg</code> não é reconhecido como comando</strong></summary>

<br>

O CapIAu-Talho chama o FFmpeg pelo nome, então ele precisa estar no `PATH` do sistema. Ter o
`ffmpeg.exe` numa pasta qualquer do disco **não basta**.

Confirme onde ele está:

```powershell
Get-Command ffmpeg
```

Se não aparecer nada, adicione a pasta que contém `ffmpeg.exe` e `ffprobe.exe` às variáveis de
ambiente do Windows e abra um terminal novo.

**Sintoma associado:** a ingestão até roda, mas nenhum proxy é gerado e a transcrição nunca começa.

</details>

<details>
<summary><strong>O servidor morre sozinho depois de horas rodando</strong></summary>

<br>

Se a janela do terminal que iniciou o servidor for fechada, o Windows envia `CTRL_CLOSE_EVENT` e o
runtime MKL/PyTorch aborta, derrubando servidor e workers juntos.

Use o lançador desgrudado descrito em [Executando](#executando).

</details>

<details>
<summary><strong>A busca não retorna nada, ou avisa que o índice está indisponível</strong></summary>

<br>

O banco vetorial (Qdrant) é gravado em `data/qdrant.db`. Se o acervo foi ingerido antes de uma troca
de `EMBEDDING_MODEL`, os vetores antigos ficam incompatíveis com as buscas novas.

Reindexe:

```bash
curl -X POST http://localhost:8000/api/search/reindex
```

</details>

<details>
<summary><strong>A exportação de timeline falha ou avisa sobre o worker de exportação</strong></summary>

<br>

Mensagem típica no console:

```
[EXPORT] Aviso: 'opentimelineio' sem wheel neste Python; exportacao usara o worker
do venv 3.12 (data/venv312) se ele existir.
```

A exportação depende de três pacotes que **não estão no `requirements.txt`**, porque a
disponibilidade do `opentimelineio` varia conforme a versão do Python. Instale-os:

```bash
pip install opentimelineio otio-fcp-adapter otio-cmx3600-adapter
```

Os dois adaptadores não são opcionais: sem `otio-fcp-adapter` não sai XML, e sem
`otio-cmx3600-adapter` não sai EDL.

Se o `opentimelineio` não instalar no seu Python, crie o interpretador auxiliar 3.12 descrito no
[passo 6 da montagem](#passo-a-passo).

</details>

<details>
<summary><strong>As análises de visão falham com timeout ou erro 504</strong></summary>

<br>

Costuma acontecer com modelos gratuitos (`:free`) sob carga — o gateway da OpenRouter fica esperando
o modelo responder e desiste.

Troque o `VISION_MODEL` para um modelo pago no painel de configurações e deixe o gratuito apenas
como `VISION_MODEL_FALLBACK`. Essa é a configuração padrão justamente por isso.

</details>

---

## 🧪 Testes <a id="testes"></a>

A suíte cobre exportação OTIO, agente de chat, segmentação, paletas, entidades, triagem e o
tratamento de respostas nulas da IA.

O `pytest` é uma dependência só de desenvolvimento e **não vem no `requirements.txt`**. Instale-o
antes da primeira execução:

```bash
pip install pytest
```

Rode a suíte completa:

```bash
python -m pytest tests/ -v
```

Ou um arquivo específico:

```bash
python -m pytest tests/test_f3_segmentation.py -v
```

---

## 🗺️ Roadmap <a id="roadmap"></a>

O plano completo, com decisões registradas e critérios de aceite, está em
[`docs/PLANO_IMPLEMENTACAO.md`](docs/PLANO_IMPLEMENTACAO.md).

| Etapa | Escopo | Situação |
|---|---|---|
| **1 — Sanear a base** | Limpeza do pipeline de análise | ✅ Concluída |
| **2 — Segmentação e CLIP local** | Shots, beats, embeddings de imagem e análise condicional | ✅ Concluída (faltam chips de faceta na UI e o título no índice) |
| **3 — Sala de Projeto** | Cartão de contexto, chat produtor, extração de roteiro, *capability manager* | 🔄 Em andamento |
| **4 — Busca multi-vetor e agentes** | Busca em 3 passos, chat com ferramentas, servidor MCP, farm de GPUs | 📋 Planejada |

---

## 📁 Estrutura de pastas <a id="estrutura-de-pastas"></a>

```
capiau-talho/
├── data/              Bancos locais (capiau.db, Qdrant, proxies, caches) — não versionado
├── docs/              Documentação complementar
│   └── images/        Capturas de tela do README
├── scripts/           Utilitários (lançador desgrudado, retriagem)
├── src/
│   ├── api/           Rotas FastAPI e controladores
│   │   └── routes/    entities · faces · media · narrative · projects · scenes · settings
│   ├── core/          Modelos e tipos compartilhados
│   ├── db/            Schema SQLite e repositórios de persistência
│   ├── export/        Exportação de timeline (.otio, .xml, .edl)
│   ├── ingest/        Varredura de diretórios e ingestão de mídias
│   ├── media/         Wrappers de FFmpeg e manipulação de arquivos
│   ├── nlp/           Temas, resumos, enriquecimento e chamadas de LLM
│   ├── search/        Indexação e busca híbrida no Qdrant
│   ├── services/      Regras de negócio (pipeline, agente, rostos, settings, S3)
│   ├── transcription/ Motor de ASR e diarização
│   ├── ui/            Interface web (HTML, CSS e JS em /ui/js)
│   └── vision/        Biometria facial local e análise multimodal
├── tests/             Suíte de testes automatizados
└── watch/             Pasta observada para ingestão automática
```

---

## 📚 Documentação complementar <a id="documentacao-complementar"></a>

| Documento | Conteúdo |
|---|---|
| 📖 [**Manual do Usuário**](USER_MANUAL.md) | Operação completa das funcionalidades visuais da tela |
| 🎬 [**Fluxo com o Kdenlive**](docs/kdenlive_workflow.md) | Sincronização e exportação para edição offline |
| 🎹 [**Atalhos de teclado**](docs/shortcuts.md) | Lista de atalhos e mapa do teclado NLE |
| 💰 [**Custos e segurança de APIs**](docs/costs_and_security.md) | Como economizar na precificação do OpenRouter e AssemblyAI |
| ⚙️ [**Guia de configurações de IA**](docs/ai_settings_pro_guide.md) | Referência do painel de configurações, campo a campo |
| 🔌 [**Referência de APIs**](docs/api_endpoints.md) | Chamadas HTTP internas, para desenvolvedores |
| 🧭 [**Plano de implementação**](docs/PLANO_IMPLEMENTACAO.md) | Etapas, decisões fechadas e critérios de aceite |
| 🚀 [**Walkthrough de desenvolvimento**](walkthrough.md) | Diário técnico e progresso passo a passo do MVP |

---

## 📄 Licença <a id="licenca"></a>

Distribuído sob a **GNU General Public License v3.0**. Veja [`LICENSE`](LICENSE) para o texto
completo.

Em resumo: você pode usar, estudar, modificar e redistribuir este software livremente. Se
distribuir uma versão modificada, ela também precisa ser publicada sob a GPL-3.0, com o código
aberto.
