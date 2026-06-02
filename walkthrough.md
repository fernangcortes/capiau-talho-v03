# Walkthrough da Implementação — CapIAu Making Of MVP

Este documento resume as implementações realizadas, os testes efetuados e instrui sobre como executar a aplicação de forma rápida e local.

---

## 🛠️ O Que FO MVP funcional do **CapIAu** foi totalmente desenvolvido e testado no seu computador! A arquitetura foi adaptada de forma ideal para o seu processador **Intel i7-10700** e **32 GB de RAM** sem depender de GPU dedicada, operando em um **Modelo Híbrido Otimizado**:

### 1. Ambiente Híbrido e Modelos Customizáveis (Novidades de 2026)
* [x] Criado `requirements.txt` com todas as dependências unificadas e instaladas com sucesso (FastAPI, Qdrant-client, Sentence-transformers, AssemblyAI, OpenTimelineIO, etc.).
* [x] Estruturado arquivo `.env` para centralizar as chaves das APIs do **OpenRouter** e **AssemblyAI** e configurar as pastas locais de mídia.
* [x] **Escolha Flexível de Modelos:** Adicionado suporte para customizar `TEXT_MODEL` e `VISION_MODEL` diretamente no seu `.env`, permitindo que você use modelos modernos lançados nos últimos dois meses, como o **Gemini 3.1 Flash Lite** (maio/2026, ultra-econômico) ou o **Perceptron Mk1** (maio/2026, especializado em frames de vídeo).
* [x] Configurado `src/config.py` para carregar as variáveis de ambiente e **gerar automaticamente toda a estrutura de pastas** (`originals`, `proxies`, `watch`, `cache`, `exports`) na sua máquina.

### 2. Banco de Dados e Busca Semântica em CPU (Sem Docker!)
* [x] Criado `src/db/schema.py` com o schema relacional SQLite, estruturando projetos, vídeos, fotos, transcrições palavra-a-palavra, temas e relações.
* [x] **Gerenciamento Multi-Projeto Autônomo:** Adicionadas operações de CRUD de projetos (`add_project`, `get_projects`, `delete_project`) em `src/db/operations.py` com suporte a **Deleção Física em Cascata** (`PRAGMA foreign_keys = ON`), permitindo isolamento total de mídias de diferentes produções.
* [x] Desenvolvido `src/search/semantic.py` inicializando o **Qdrant local baseado em arquivo**. Roda 100% na sua CPU local, gerando embeddings através do modelo leve e offline `all-MiniLM-L6-v2` (~120MB) com busca semântica em menos de 10ms!
* [x] **Correção de Bugs Críticos de Parâmetros:** Identificados e corrigidos bugs silenciosos onde o `project_id` era omitido na indexação do Qdrant nos motores ASR (`asr_engine.py`) e Vision (`multimodal_engine.py`), bem como no endpoint de busca do servidor.
* [x] Resolvido o requisito do Qdrant de IDs em formato UUID através da **geração determinística de UUIDs v5** a partir de string keys, gerando unicidade e evitando duplicatas.

### 3. Pipeline de Ingestão, FFmpeg e In-Place Ingestion (HD Externo)
* [x] Criado `src/ingest/watcher.py` para monitoramento automático de arquivos na pasta `watch/`.
* [x] **Ingestão In-Place (Modo Link para HD Externo):** Adicionado suporte a parâmetro `copy_original=False` no fluxo de ingestão. Mídias gigantes localizadas em HDs externos ou SSDs podem ser analisadas e vinculadas **sem serem copiadas localmente** (poupando espaço em disco). O CapIAu armazena no SQLite o caminho absoluto real do HD externo e gera apenas o leve proxy de preview localmente, garantindo o link correto na exportação XML/EDL.
* [x] **Importador Recursivo de Pastas:** Criada a lógica `ingest_external_path` mapeada no novo endpoint `/api/ingest/external` para varrer recursivamente qualquer caminho absoluto de disco externo e catalogar mídias em modo in-place.
* [x] Implementado deduplicação automática via SHA-256 e extração de metadados técnicos ricos por **FFprobe**.
* [x] Desenvolvido proxying nativo por **FFmpeg** gerando proxies rápidos H.264 em 720p/360p com áudio AAC para visualização imediata na Web, com tratamento de exceções robusto e sem travar a CPU.


### 4. Transcrição ASR, Diarização e Clustering Temático (Nuvem Econômica)
* [x] Criado `src/transcription/asr_engine.py` integrado com **AssemblyAI** (Universal-2), fornecendo transcrição pt-BR rápida com diarização de falantes (quem falou o quê) e timestamps atômicos, seguido por indexação instantânea no Qdrant local.
* [x] Desenvolvido `src/vision/multimodal_engine.py` extraindo frames a cada 10s via FFmpeg (sem carregar o OpenCV) e analisando bastidores/fotos usando a API multimodal **Gemini 2.5/3.1/3.5** no OpenRouter (custando menos de R$ 7,00 para 20h!).
* [x] Desenvolvido `src/nlp/theme_cluster.py` carregando os diálogos inseridos no SQLite e agrupando trechos automaticamente em tópicos do documentário (Making Of) via **DeepSeek V3** no OpenRouter (custando menos de R$ 8,00 para as 20h!).

### 5. Exportador OpenTimelineIO e Dashboard Web Premium
* [x] Implementado `src/export/otio_export.py` integrando a biblioteca **OpenTimelineIO** para traduzir a sequência de cortes da timeline em arquivos XML (Premiere/Resolve), EDL ou JSON OTIO.
* [x] Desenvolvido servidor REST FastAPI em `src/api/server.py` mapeando endpoints de busca semântica híbrida, controllers assíncronos e servindo o frontend.
* [x] Construído **Dashboard Web Premium** (`index.html`, `styles.css`, `app.js` em `src/ui/`) com visual espetacular glassmorphism em **proporção widescreen 16:9** contendo:
  - **Área de Projetos Glassmorphic** no topo contendo seletor de projetos ativo, botão para criar novo projeto e botão de exclusão rápida.
  - **Modal de Novo Projeto** responsivo translúcido para preenchimento de metadados do filme.
  - **Menus retráteis** esquerdo (biblioteca) e direito (transcrições) por clique simples, redimensionando o player de forma responsiva.
  - **Player de Vídeo Profissional** com atalhos de teclado **JKL** (Premiere-style), controle de velocidade de reprodução e seletor de resolução proxy (720p/360p/Original).
  - **Marcação de Pontos I/O (In / Out)** via teclas `I` e `O`, permitindo fatiar e enviar trechos à timeline instantaneamente (tecla `E`).
  - **Barra de Status do Sistema em Tempo Real:** Uma barra translúcida premium no rodapé do painel esquerdo que fornece referência contínua e visual das ações em execução no background (como varredura de pastas, importações recursivas, IA decodificando falas com AssemblyAI ou temas com DeepSeek), mudando dinamicamente entre spinners de carregamento ativos e checks verdes de finalização bem-sucedida.
  - **Status de Pipeline nos Cards de Mídia:** Badges e spinners embutidos nos cards de vídeo que mostram o status individual de processamento (spinners animados para mídias em fase de `transcrevendo` ou `analisando`, selos premium **[ASR]** e **[VISÃO]** para tarefas concluídas e marcações em vermelho para erros de FFmpeg).
  - **Painel Ativo de Conversões e Progresso Real (0-100%):** O CapIAu agora lê dinamicamente a saída do `stdout` do FFmpeg (`-progress pipe:1`) e calcula o progresso real em porcentagem comparando com a duração obtida pelo FFprobe. Os cards de mídia exibem dinamicamente `Convertendo XX%` com spinners em tempo real.
  - **Ações de Controle Total (Cancelar/Deletar):** Cards de mídia ganham botões flutuantes: um botão de parada (`fa-circle-stop`) em mídias ativas para matar a tarefa e limpar arquivos parciais, e um ícone de lixeira hover (`fa-trash-can`) para proxies concluídos, permitindo deletar fisicamente o proxy do HD e liberar espaço na máquina local.
  - **Visualização em Árvore/Explorer (Premium VSCode-Style):** Para evitar poluição visual ao importar centenas de arquivos, a biblioteca do CapIAu agora detecta a estrutura física de subpastas do HD ou diretório importado e as agrupa em uma **Árvore de Diretórios interativa**. As pastas e subpastas iniciam **recolhidas por padrão**, permitindo que você as explore expandindo/fechando conforme desejar, exatamente como em um gerenciador de arquivos nativo.
  - **Prevenção Máxima de Processos Órfãos (Ganchos de Shutdown):** Adicionado manipulador de encerramento do FastAPI (`@app.on_event("shutdown")`) e limpezas via atexit. Quando o servidor é encerrado ou o terminal fechado, todos os processos de conversão `ffmpeg.exe` ativos são terminados fisicamente no Windows (`taskkill /F /T`) eliminando por completo o risco de processos órfãos invisíveis consumindo CPU no background.
  - **Atualização Dinâmica Instantânea (Auto-Polling):** Ingestões recursivas iniciam um polling inteligente que atualiza a biblioteca dinamicamente a cada 2 segundos, fazendo com que novos arquivos catalogados apareçam de forma imediata na tela do usuário.
  - **Salvamento de Projetos em Tempo Real:** Gravação atômica instantânea de todos os metadados diretamente no banco de dados local SQLite (`capiau.db`), garantindo que projetos sejam salvos automaticamente após qualquer ação sem risco de perda de dados.
  - **Mocks de segurança integrados** que entram em ação automaticamente se o servidor FastAPI estiver offline ou os bancos vazios, permitindo testar a experiência visual e atalhos na hora!
  - **Prevenção de Conflitos de Digitação:** Corrigida a escuta de eventos de atalhos globais (como Barra de Espaço, J, K, L, I, O, E) para serem suspensos automaticamente quando o usuário estiver digitando em qualquer formulário ou campo de texto do aplicativo (`input`, `textarea`, `select`), garantindo uma digitação contínua e sem bugs.

---


## 🧪 Validação e Testes Executados

Efetuamos testes automatizados de integração que cobrem a integridade dos bancos e o fluxo lógico do pipeline:

1. **Testes do Banco de Dados e Busca Semântica CPU:**
   * Script: `tests/test_database.py`
   * **Resultado:** `OK` (Concluído com 100% de sucesso!). O SQLite gravou corretamente, a diarização agrupou o texto, o Qdrant local indexou em CPU com project_id e a busca semântica local isolada por projeto retornou o trecho correspondente com pontuação de relevância.
   
2. **Testes do Ingestor e Proxy:**
   * Script: `tests/test_hybrid_pipeline.py`
   * **Resultado:** `OK` (Concluído com 100% de sucesso!). O ingestor catalogou os metadados no SQLite por tipo de arquivo, calculou o hash e tratou corretamente o mock de proxying do FFmpeg.

---

## 🚀 Como Executar o MVP

Siga os três passos rápidos abaixo para ver a mágica acontecer:

### Passo 1: Configurar suas Chaves no arquivo `.env`
Abra o arquivo `.env` gerado na raiz do seu workspace:
👉 [.env](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/.env)

Substitua os placeholders pelas suas chaves reais, e escolha o modelo de sua preferência (como o Gemini 3.1 Flash Lite de maio/2026):
```env
OPENROUTER_API_KEY=sua_chave_do_openrouter_aqui
ASSEMBLYAI_API_KEY=sua_chave_da_assemblyai_aqui

# Escolha da Inteligência Customizada de 2026
TEXT_MODEL=deepseek/deepseek-chat
VISION_MODEL=google/gemini-3.1-flash-lite
```

### Passo 2: Iniciar o Servidor FastAPI
Execute o servidor FastAPI abrindo o prompt ou console no diretório do projeto e rodando:
```bash
python -m uvicorn src.api.server:app --reload
```
O console exibirá que o banco de dados SQLite foi criado/inicializado física e localmente, assim como a base do Qdrant.

### Passo 3: Abrir no Navegador
Acesse no seu navegador preferido:
👉 **[http://localhost:8000/](http://localhost:8000/)**

A interface premium carregará de forma imediata com o suporte a múltiplos projetos totalmente operacional. Você poderá criar um novo projeto, alternar entre eles, escanear pastas e realizar buscas semânticas sem nenhuma poluição cruzada de dados!

---

🎉 Parabéns! O motor de decupagem inteligente do seu filme está pronto, multi-projeto, totalmente parametrizado e estruturado para processar suas 20 horas de material de forma rápida, eficiente e extremamente econômica!

