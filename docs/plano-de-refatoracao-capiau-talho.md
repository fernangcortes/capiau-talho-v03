# Plano de refatoração e saneamento — CapIAu-Talho

## 1. Identificação do documento

- **Repositório:** `fernangcortes/capiau-talho-v03`
- **Branch analisada:** `main`
- **Commit de referência:** `02a71804a390fc6e51de0f400fe25e5fd42a7ae6`
- **Data da análise:** 29 de outubro de 2026
- **Natureza:** proposta técnica para correção de riscos, recuperação da baseline de testes e refatoração incremental.
- **Estado do repositório durante a análise:** nenhum arquivo foi alterado e nenhuma issue foi criada.
- **Issues abertas quando da revisão:** nenhuma.

Este documento deve ser atualizado quando os testes Python, a execução via Docker, os fluxos reais de IA e os testes de interface em navegador forem validados. As conclusões aqui apresentadas pertencem ao commit de referência; mudanças posteriores exigem revisão dos achados afetados.

## 2. Resumo executivo

O projeto já possui uma base funcional ampla, documentação extensa e muitos testes. Há também decisões positivas: separação inicial por módulos, uso de repositórios para parte do acesso a dados, SQLite com chaves estrangeiras e WAL, catálogo de configurações, testes de comportamento da timeline e mecanismos de progresso/cancelamento de tarefas.

Os problemas mais urgentes não são o tamanho dos arquivos nem a ausência de um framework frontend. São:

1. **fronteira de exposição insegura**, com API sem autenticação, diretórios públicos e configuração de desenvolvimento usada como execução padrão;
2. **escrita de arquivos sem confinamento e uploads sem limites adequados**;
3. **risco de perda, sobrescrita ou divergência de dados** em exportação, importação, indexação vetorial e backup;
4. **baseline de testes e dependências sem reprodutibilidade suficiente** para sustentar uma refatoração ampla;
5. **alta concentração de responsabilidades** na API de mídia e no núcleo JavaScript da timeline.

A recomendação central é adotar uma sequência de **contenção → baseline → integridade de dados → refatoração por fatias verticais**. Não se recomenda reescrita completa, migração imediata para React, introdução de microservices ou substituição da stack.

### 2.1 Resultado esperado

Ao final do plano, o projeto deve ter:

- instalação local segura por padrão;
- exports e arquivos de mídia sem exposição pública acidental;
- uploads e imports com limites, validação e testes adversariais;
- exportação e restauração verificáveis, sem sobrescrever recursos de outros projetos;
- backups consistentes com o modo WAL do SQLite;
- reindexação do Qdrant recuperável e sem divergência silenciosa;
- testes rápidos reproduzíveis executados em CI;
- rotas HTTP progressivamente mais finas, com casos de uso e transações explícitas;
- domínio da timeline isolado de DOM, rede e estado global;
- evolução por PRs pequenos, sem reescrita big bang.

## 3. Escopo e método da análise

A revisão incluiu:

- estrutura do repositório e distribuição dos módulos;
- configuração de FastAPI, CORS, mounts estáticos e ciclo de vida da aplicação;
- Docker, Compose, dependências e instruções de execução;
- fluxos de upload, ingestão, exportação, importação e backup;
- coordenação entre SQLite, Qdrant e arquivos físicos;
- organização das rotas e dos repositórios;
- gerenciamento de tarefas e workers;
- arquivos de maior concentração de complexidade no frontend;
- execução dos scripts Node de teste disponíveis no ambiente da revisão.

### 3.1 Níveis de confiança usados neste documento

- **Confirmado por código:** o comportamento decorre diretamente do trecho indicado.
- **Observado em execução local:** foi observado na baseline Node executada durante a revisão, mas ainda exige reprodução no ambiente oficial do projeto.
- **Hipótese a validar:** exige teste com infraestrutura, dados ou integrações que não estavam disponíveis.
- **Risco condicional:** depende de o serviço ser acessível por LAN, internet ou origens não confiáveis.

## 4. Limitações desta revisão e do ambiente de análise

Estas limitações são importantes para interpretar corretamente o plano.

### 4.1 Cobertura estática, não auditoria exaustiva

Foi uma revisão dirigida aos fluxos de maior risco, e não uma leitura integral de todas as aproximadamente 161 mil linhas de código-fonte. A ausência de um achado neste documento não significa ausência de vulnerabilidade ou defeito.

Não foram realizados pentest, fuzzing completo, análise formal de autorização em todos os endpoints nem revisão de todas as combinações de estado da timeline.

### 4.2 Suíte Python não executada

A suíte `pytest` não foi executada de ponta a ponta porque o ambiente da análise não estava provisionado com todas as dependências do projeto. Portanto:

- os testes Python não devem ser considerados aprovados;
- falhas de importação observadas em um fluxo específico não devem ser automaticamente classificadas como defeito do repositório;
- a primeira etapa de baseline precisa criar um ambiente oficial e reproduzível antes de medir cobertura ou taxa de sucesso.

### 4.3 Baseline Node parcialmente dependente do ambiente

Foram executados 88 scripts Node:

- 77 terminaram com sucesso;
- 11 falharam.

No subconjunto dos 79 `autoteste_*.mjs` documentado no README:

- 74 terminaram com sucesso;
- 5 falharam.

Essas falhas incluem problemas de mocks, ambiente, dependências ausentes, ESM/CommonJS e asserções de comportamento. Elas **não devem ser todas tratadas como bugs de produto** sem triagem. Também não devem ser ocultadas por skips ou remoção de asserções.

### 4.4 Infraestrutura e integrações não exercitadas

Não foram validados nesta revisão:

- build e execução completos do Docker;
- Qdrant real sob falhas, reinício e concorrência;
- S3 real e restauração dos backups;
- OpenRouter, AssemblyAI, Auphonic e demais APIs externas;
- download e execução de modelos locais de IA;
- FFmpeg com todas as combinações de hardware e codecs;
- renderização com Chrome/Edge e Playwright;
- exportação OTIO/XML/EDL com todos os adaptadores;
- comportamento em Windows e macOS;
- interface completa em navegador real;
- testes de carga, estresse, memória e disco;
- restauração em uma instalação contendo dados reais de produção.

### 4.5 Sem varredura completa de dependências e segredos

Não foi executada uma análise SCA completa de vulnerabilidades das dependências nem uma auditoria histórica de segredos no Git. A presença de `.env` no `.gitignore` é positiva, mas não substitui essa verificação.

### 4.6 Nenhuma exploração destrutiva

Os riscos foram avaliados por inspeção e testes não destrutivos. Não se executaram exploits contra dados reais. Recomendações de segurança devem ser validadas por testes automatizados em ambiente descartável.

## 5. Limitações do ambiente atual da aplicação

As limitações abaixo não são todas defeitos. Algumas são restrições legítimas de um aplicativo local e monousuário, mas precisam ser explícitas para orientar a arquitetura.

### 5.1 Aplicação local versus aplicação de rede

O desenho atual é compatível com uso local e controle total do usuário sobre a máquina. Ele não oferece, por si só, uma fronteira adequada para LAN ou internet:

- não há autenticação/autorização identificada nas rotas;
- CORS é amplo;
- mídia, cache e exports são montados como arquivos estáticos;
- a porta padrão do Compose é publicada em todas as interfaces;
- rotas executam operações com efeitos colaterais e chamadas a serviços pagos.

**Consequência:** não se deve simplesmente publicar o serviço atual atrás de um IP ou domínio. Primeiro é necessário definir o perfil de deployment e o modelo de confiança.

### 5.2 Processo único e estado em memória

`TaskManager`, caches de configurações e outros estados vivem no processo. O próprio serviço de configurações documenta a premissa de worker único do Uvicorn. Workers externos usam arquivos de PID e snapshots de progresso.

**Consequências:**

- aumentar workers do Uvicorn sem redesenho pode quebrar invalidação de cache e coordenação de tarefas;
- reinício do processo pode perder estado operacional em memória;
- múltiplas réplicas não compartilham fila, cancelamento e progresso de maneira confiável;
- arquivos de PID exigem cuidado com concorrência, recuperação e identidade do processo.

**Resposta recomendada:** preservar o modelo local de worker único inicialmente, mas persistir jobs, leases, cancelamento e recuperação no SQLite. Não introduzir Redis ou fila distribuída sem requisito real.

### 5.3 SQLite, Qdrant e filesystem não formam uma transação única

Uma operação pode alterar três meios diferentes:

1. dados relacionais no SQLite;
2. vetores no Qdrant;
3. proxies, documentos, exports e cache no filesystem.

Não existe transação distribuída entre eles. Uma falha intermediária pode deixar dados parcialmente aplicados.

**Resposta recomendada:** banco relacional como fonte de verdade, operações em staging, commits curtos, registro de trabalho pendente e reindexação idempotente/recuperável. O Qdrant deve ser tratado como índice derivado sempre que possível.

### 5.4 SQLite possui concorrência limitada

WAL melhora leitura durante escrita, mas não transforma o SQLite em banco para muitos escritores concorrentes. Jobs demorados e transações extensas podem aumentar contenção.

**Resposta recomendada:** transações curtas, sem chamadas HTTP, IA, FFmpeg ou cópia de arquivos demorada dentro delas; recuperação de `busy/locked`; backup pela API própria do SQLite.

### 5.5 Dependência de recursos locais e programas externos

O produto depende de combinações de:

- Python e pacotes nativos;
- FFmpeg/FFprobe;
- Torch, OpenCV e modelos locais;
- Chrome/Edge/Chromium e Playwright;
- adaptadores OTIO;
- caminhos e comportamentos específicos de Windows/Linux.

**Consequência:** “funciona na minha máquina” é um risco real sem lockfile, ambiente versionado e matriz de testes.

### 5.6 Python 3.12 e exceções de runtime

O Dockerfile usa Python 3.12. O manifesto prevê caminho alternativo para OTIO em Python 3.14 por meio de um ambiente 3.12 auxiliar.

**Consequência:** o runtime principal e o runtime auxiliar precisam ser tratados como contrato de deployment, com versões e smoke tests explícitos.

### 5.7 IA local e IA em nuvem têm restrições diferentes

- Modelos locais exigem download, espaço, memória e tempo de inicialização.
- GPU/OpenCL/aceleração varia por máquina.
- APIs externas introduzem latência, indisponibilidade, custo e exposição de dados.
- Respostas de LLM são não determinísticas e não devem ser tratadas como HTML ou instruções confiáveis.

**Resposta recomendada:** testes unitários com doubles, integração separada, limites de custo, timeouts, retries com política clara e escape de toda saída exibida.

### 5.8 Persistência e portabilidade

Caminhos absolutos de mídias podem não existir em outra máquina. Exportar metadados não significa necessariamente exportar todos os recursos necessários para abrir o projeto.

**Resposta recomendada:** manifesto de pacote, inventário de recursos, política explícita para originais/proxies/dados derivados e rotina de relink após restauração.

### 5.9 Backup não equivale a recuperação

Copiar o `.db` ativo em WAL pode omitir transações recentes ou gerar uma cópia inconsistente. Um backup só é confiável quando sua restauração é testada.

**Resposta recomendada:** backup online consistente, versionamento, checksum, retenção e teste periódico de restore.

## 6. Estado atual e pontos fortes a preservar

### 6.1 Componentes principais

- **API:** FastAPI, com rotas para projetos, mídia, narrativa, rostos, entidades, configurações, cenas e modelos.
- **Persistência:** SQLite e repositórios parcialmente separados por domínio.
- **Busca:** Qdrant e serviços de busca semântica/RAG.
- **Processamento:** workers, threads e subprocessos para mídia e IA.
- **Frontend:** módulos JavaScript, Canvas, player, biblioteca, workspace e timeline.
- **Exportação:** vídeo, áudio, OTIO/XML/EDL e pacote de projeto.

### 6.2 Complexidade concentrada

| Arquivo | Aproximação observada | Relevância |
|---|---:|---|
| `src/ui/styles.css` | 17.021 linhas | Manutenção visual; não é prioridade inicial |
| `src/ui/js/library.js` | 14.864 linhas | Alto acoplamento da biblioteca |
| `src/ui/js/timelineInteraction.js` | 14.001 linhas | Núcleo de interação da timeline |
| `src/ui/js/timelineState.js` | 9.242 linhas | Estado, comandos e histórico |
| `src/ui/js/player.js` | 8.710 linhas | Player e comportamento de mídia |
| `src/ui/js/workspaceManager.js` | 6.514 linhas | Layout e janelas |
| `src/api/routes/media.py` | 3.513 linhas e 77 endpoints | Excesso de responsabilidades na camada HTTP |
| `src/services/chat_agent.py` | 2.377 linhas | Orquestração extensa de agente |
| `src/services/pipeline.py` | 2.263 linhas | Pipeline de processamento |
| `src/db/schema.py` | migração dinâmica extensa | Ciclo de vida e evolução do schema |

Esses números orientam a priorização, mas não devem ser usados como única medida de qualidade.

### 6.3 Decisões que não devem ser descartadas

- FastAPI e SQLite são adequados ao cenário local.
- Vanilla JavaScript com módulos pode continuar, desde que o domínio seja isolado.
- O catálogo de configurações reduz dispersão de defaults.
- A quantidade de testes é um ativo, mesmo precisando de saneamento.
- A documentação de risco de rede no README deve ser preservada e transformada em defaults seguros.
- O uso de parâmetros SQL foi observado nas amostras revisadas; não há evidência suficiente para registrar SQL injection como achado.

## 7. Backlog crítico recomendado

As prioridades abaixo tratam risco e dependência, não apenas esforço. `P0` exige contenção imediata; `P1` deve ser resolvido antes da refatoração ampla; os épicos estruturais vêm depois das proteções.

### SEC-01 — `P0` — Fechar exposição da API, exports e arquivos do projeto

**Evidências**

- `src/api/server.py:66-72`: CORS amplo.
- `src/api/server.py:160-169`: mounts públicos de proxies, originais, exports e cache.
- `docker-compose.yml`: publicação da porta em todas as interfaces, bind do código e `--reload`.
- `src/api/routes/projects.py:85-122`: export persistido em diretório público com nome previsível.
- Rotas de ingestão aceitam caminhos do host; outras rotas alteram configurações, iniciam backup e acionam provedores externos.
- O README reconhece a ausência de autenticação e o risco de exposição.

**Impacto**

Acesso indevido a mídias e documentos, modificação de projetos, operações no host, consumo de APIs pagas e exposição de dados sensíveis, inclusive dados biométricos armazenados no banco.

**Ações**

1. Alterar o padrão local para `127.0.0.1:8000:8000`.
2. Separar configuração de desenvolvimento da configuração de execução.
3. Remover `--reload` e bind de código do perfil não destinado a desenvolvimento.
4. Restringir CORS a origens necessárias e validar `Origin`/`Host` nas operações sensíveis.
5. Definir proteção contra CSRF para o modo local em navegador.
6. Exigir autenticação e autorização antes de habilitar LAN/internet.
7. Gerar exports em área temporária, com download autorizado e limpeza após resposta.
8. Reavaliar a necessidade de mounts públicos de `/exports`, `/cache` e `/originals`.
9. Definir rate limit/cotas para endpoints pagos quando houver acesso não confiável.

**Critérios de aceite**

- Uma instalação padrão não escuta em interfaces externas.
- Um cliente não autenticado não executa operações privilegiadas no perfil de rede.
- Export não permanece disponível por URL pública previsível.
- Testes cobrem acesso negado e perfis local/rede.
- README e Compose refletem o comportamento real.

### SEC-02 — `P0` — Corrigir path traversal e limites de upload/importação

**Evidências**

- `src/api/routes/media.py:783-793`: uso direto de `upload.filename` no destino e leitura integral do arquivo.
- `src/api/routes/projects.py:185-186`: leitura integral de documentos.
- Importação de ZIP sem política explícita de limites de tamanho, contagem e expansão.

**Impacto**

Escrita fora do diretório de mídia com os privilégios do processo, sobrescrita de arquivos, exaustão de memória e exaustão de disco.

**Ações**

1. Validar nome de arquivo e impedir caminhos absolutos, separadores e componentes `..`.
2. Resolver o destino e garantir confinamento dentro do diretório permitido.
3. Usar streaming com limite de bytes; não carregar arquivos grandes inteiros em memória.
4. Aplicar allowlist de extensões e validação de conteúdo quando aplicável.
5. Limitar quantidade de arquivos por requisição.
6. Para ZIP, limitar tamanho compactado, quantidade de membros, tamanho total expandido e razão de expansão.
7. Validar a estrutura esperada do pacote antes de iniciar a importação.
8. Usar nomes gerados pelo servidor quando o nome original não for necessário.

**Critérios de aceite**

- Testes com `../`, caminhos absolutos, nomes ambíguos e separadores alternativos falham com `4xx`, sem escrita.
- Upload excedente é interrompido sem consumir memória proporcional ao tamanho total.
- ZIP fora dos limites é recusado antes de alterar banco ou arquivos definitivos.
- Falhas não deixam arquivos temporários órfãos.

**Nota de precisão**

Não classificar automaticamente `zipfile.extractall` como Zip Slip no runtime atual: o CPython sanitiza componentes como `..`. O registro deve tratar limites, estrutura e integridade do pacote, evitando uma correção baseada em vetor não confirmado.

### DATA-01 — `P1` — Corrigir integridade e portabilidade do export/import

**Evidências**

- `projects.py:99-112`: proxies exportados com IDs antigos.
- `sync.py`: novos IDs são criados no banco.
- `projects.py:148-166`: arquivos são copiados com os nomes antigos após a importação dos metadados.
- Vídeos são servidos por `proxy_vid_{novo_id}.mp4`; fotos usam `proxy_photo_{id}.webp`, enquanto o export grava `photo_{id}.webp`.
- O commit do projeto ocorre antes da cópia física dos recursos.
- O export não inclui várias tabelas com dados do usuário, como `media_bin`, entidades, cenas, segmentos e histórico de metadados.

**Impacto**

- Proxies não encontrados após restauração.
- Sobrescrita de proxies pertencentes a outro projeto.
- Resposta de erro com projeto parcialmente persistido.
- Perda de organização e metadados ao migrar ou restaurar.

**Ações**

1. Criar manifesto versionado com versão do formato, aplicação, schema e inventário de recursos.
2. Declarar quais dados são preservados e quais são derivados/reconstruíveis.
3. Validar todo o pacote antes de escrever no destino.
4. Extrair recursos em staging exclusivo da importação.
5. Criar mapa de IDs antigos e novos para banco e nomes físicos.
6. Corrigir a nomenclatura de proxies de fotos.
7. Impedir que qualquer recurso importado sobrescreva arquivo fora de sua área de staging/destino autorizado.
8. Definir unidade lógica de sucesso e compensação para falhas de cópia.
9. Executar verificação pós-importação e relatório de itens reconstruídos ou pendentes.
10. Criar rotina de relink para originais ausentes.

**Critérios de aceite**

- Round-trip em instalação nova preserva todos os dados classificados como persistentes.
- Importar duas vezes o mesmo pacote não sobrescreve recursos de projetos existentes.
- Falha injetada em cada etapa deixa estado ausente ou recuperável, nunca sucesso parcial silencioso.
- Proxies importados são localizados pelos novos IDs.
- Pacotes antigos têm política explícita de compatibilidade ou rejeição clara.

### DATA-02 — `P1` — Tornar Qdrant, arquivos e backups recuperáveis e consistentes

**Evidências**

- `src/services/sync.py`: escritas no Qdrant ocorrem durante o fluxo transacional do SQLite, com algumas falhas apenas registradas.
- O SQLite pode sofrer rollback enquanto o Qdrant permanece alterado.
- `projects.py:358-372` e `s3_service.py`: backup copia diretamente o arquivo SQLite ativo.
- A aplicação habilita WAL nas conexões.

**Impacto**

Índice vetorial incompleto ou órfão, resultados de busca divergentes, backup sem transações recentes e falsa sensação de recuperabilidade.

**Ações**

1. Definir o SQLite como fonte de verdade.
2. Encurtar transações e remover chamadas externas demoradas de dentro delas.
3. Registrar operações de indexação pendentes em outbox/tabela de jobs.
4. Executar indexação após commit, com retry, idempotência e reconciliação.
5. Criar comando de reindexação completa por projeto.
6. Usar `sqlite3.Connection.backup()` ou `VACUUM INTO` para backup consistente.
7. Adicionar versionamento, checksum e retenção aos backups.
8. Testar restore real, inclusive com escritas simultâneas controladas.

**Critérios de aceite**

- Indisponibilidade do Qdrant não corrompe o projeto nem produz sucesso silencioso.
- Reindexação recupera o estado esperado sem duplicar vetores.
- Rollback do SQLite não deixa operações vetoriais sem rastreio.
- Backup restaurado abre o projeto e passa em `PRAGMA integrity_check`.
- Restore é documentado e testado, não apenas o upload do backup.

### SEC-03 — `P1` — Impedir XSS em conteúdo produzido por IA

**Evidências**

- `src/ui/js/timelineInteraction.js:13608-13619` e região próxima de `13912`: conteúdo de sugestões entra em `innerHTML`.
- `src/services/timeline_ai.py:296-303`: `reason` é derivado da resposta do modelo, com truncamento, mas sem sanitização para HTML.

**Impacto**

Execução de marcação/script no contexto da aplicação quando uma resposta de modelo ou dado importado contiver HTML hostil. Em ambiente exposto, o impacto se combina com a ausência de autenticação.

**Ações**

1. Usar `textContent` para texto simples.
2. Aplicar sanitizador com política restrita apenas onde HTML for realmente necessário.
3. Revisar outros sinks dinâmicos sem presumir que todo `innerHTML` seja vulnerável.
4. Adicionar CSP como defesa em profundidade após avaliar compatibilidade.
5. Criar testes com marcação e atributos de evento em respostas simuladas do LLM.

**Critérios de aceite**

- HTML enviado pelo modelo é exibido como texto ou removido pela política.
- Nenhum handler de evento ou elemento ativo é criado a partir do texto.
- Fluxos normais de sugestão permanecem funcionais.

### TEST-01 — `P1` — Restabelecer baseline reproduzível e gate de qualidade

**Evidências**

- Ausência de CI e lockfiles.
- `package.json` sem scripts de teste.
- Dependências Python declaradas principalmente com limites mínimos.
- Falhas observadas na execução Node.
- Testes Python dependentes de ambiente ainda não medidos.

**Ações**

1. Definir runtime oficial de Python e Node.
2. Gerar lockfiles e separar dependências de execução e teste.
3. Criar comandos únicos para testes rápidos, integração e E2E.
4. Padronizar ESM/CommonJS nos arquivos JavaScript.
5. Corrigir mocks desatualizados sem enfraquecer as asserções.
6. Triar individualmente as falhas de comportamento.
7. Criar marcadores Python como `unit`, `integration`, `models`, `network`, `slow` e `e2e`.
8. Configurar CI para a suíte rápida em todo PR.
9. Executar integração pesada em workflow separado ou sob demanda.
10. Publicar relatório de falhas e artefatos úteis.

**Critérios de aceite**

- Checkout limpo consegue instalar e testar com comandos documentados.
- A suíte rápida é verde e obrigatória nos PRs.
- Falhas existentes são resolvidas ou possuem registro explícito de causa e dono; nenhuma é simplesmente apagada.
- Testes que exigem rede/modelos não bloqueiam a suíte unitária.
- Novas regras de segurança e integridade possuem testes no gate.

## 8. Arquitetura de destino

A arquitetura de destino deve reduzir acoplamento sem aumentar desnecessariamente a infraestrutura.

### 8.1 Backend

Manter **FastAPI + SQLite + Qdrant + processos locais**, organizados em quatro responsabilidades:

1. **Interface HTTP:** validação de entrada, autenticação/autorização quando aplicável, status codes e serialização.
2. **Casos de uso:** orquestração de ingest, import, export, backup, jobs e análise.
3. **Domínio:** regras puras, invariantes, erros de negócio e objetos de domínio.
4. **Adaptadores:** repositórios SQLite, Qdrant, filesystem, FFmpeg, navegador e provedores de IA.

Direção das dependências:

```text
HTTP → caso de uso → domínio
                   → portas/interfaces
Adaptadores implementam as portas; o domínio não conhece FastAPI, Qdrant ou FFmpeg.
```

### 8.2 Frontend

Manter módulos JavaScript e separar gradualmente:

```text
Domínio da timeline
  ├─ clipes, tracks, timecode e invariantes
  ├─ comandos: split, trim, ripple, insert, overwrite, slip e slide
  └─ histórico: undo/redo e snapshots

Aplicação
  ├─ estado observável
  ├─ casos de uso da sessão
  └─ coordenação de comandos

Adaptadores
  ├─ API/persistência
  ├─ player e mídia
  └─ IA e import/export

Apresentação
  ├─ Canvas renderer
  ├─ controladores de eventos
  └─ componentes DOM
```

O domínio não deve acessar `window`, `document`, `fetch`, `localStorage` ou APIs de player.

### 8.3 Jobs locais persistentes

Criar um modelo único de job, sem exigir infraestrutura distribuída:

```text
id, project_id, type, status, progress, payload_json,
priority, attempts, lease_owner, lease_expires_at,
cancel_requested, error_code, error_message,
created_at, started_at, finished_at, updated_at
```

Regras:

- transições de estado validadas;
- recuperação após reinício;
- cancelamento cooperativo;
- lease para evitar execução duplicada;
- progresso persistido com frequência limitada;
- logs separados do estado principal;
- idempotência ou chave de deduplicação quando aplicável.

### 8.4 Fluxo seguro de importação

```text
1. Receber com streaming e limite.
2. Validar ZIP, limites e manifesto.
3. Extrair em staging exclusivo.
4. Validar referências e recursos.
5. Abrir transação curta para metadados.
6. Criar mapa de IDs.
7. Mover recursos de staging para destinos novos, sem sobrescrever terceiros.
8. Confirmar a unidade lógica ou compensar falhas.
9. Agendar indexação derivada.
10. Executar verificação final e retornar relatório.
```

A implementação exata pode exigir commit de metadados antes dos arquivos, desde que haja estado `importing`, recuperação e ausência de sucesso até a conclusão. O requisito é recuperabilidade e ausência de sucesso parcial silencioso, não uma transação distribuída fictícia.

## 9. Plano por fases

### Fase 0 — Contenção e redução de risco

**Objetivo:** impedir que os riscos mais graves continuem exploráveis enquanto a baseline é preparada.

**Trabalho**

- Aplicar SEC-01 e SEC-02 em PRs pequenos.
- Corrigir os sinks XSS diretamente identificados.
- Remover persistência pública de exports.
- Se a correção de DATA-01 não for imediata, restringir temporariamente a importação a uso local confiável ou desabilitá-la com mensagem explícita.
- Adicionar testes de regressão junto com cada correção.

**Entregáveis**

- Compose seguro por padrão.
- Upload confinado e limitado.
- Export temporário/privado.
- Testes adversariais de entrada.
- Nota de segurança e instrução de atualização.

**Critério de saída:** nenhum P0 conhecido permanece aberto no perfil padrão.

**Rollback:** reverter apenas o PR afetado; nunca reabrir a exposição de rede como forma de resolver regressão de funcionalidade.

### Fase 1 — Baseline e contratos de comportamento

**Objetivo:** tornar seguro alterar o código.

**Trabalho**

- Provisionar ambiente oficial e executar a suíte Python.
- Corrigir infraestrutura de testes Node.
- Triar falhas de comportamento.
- Criar CI e lockfiles.
- Adicionar testes de caracterização antes das extrações:
  - contratos HTTP dos fluxos que serão migrados;
  - round-trip atual de export/import, documentando também os defeitos;
  - comandos críticos da timeline;
  - serialização e histórico;
  - transições de estado de jobs.

**Critério de saída:** suíte rápida verde, ambiente reproduzível e contratos congelados para os fluxos da próxima fase.

**Rollback:** mudanças de harness devem ser isoladas das mudanças de produto para facilitar identificação de falso positivo.

### Fase 2 — Integridade de dados e recuperação

**Objetivo:** garantir que nenhum projeto seja perdido ou corrompido durante a evolução do sistema.

**Trabalho**

- Introduzir manifesto de export.
- Corrigir proxies e remapeamento de IDs.
- Implementar staging e recuperação de import.
- Ampliar cobertura dos dados persistentes.
- Introduzir outbox/reindexação idempotente.
- Corrigir backup e testar restore.
- Introduzir `schema_version`/`PRAGMA user_version` e migrações ordenadas.
- Mover `init_db()` do import do módulo para comando explícito ou startup controlado.
- Criar backup automático antes de migração destrutiva ou irreversível.

**Critério de saída:** testes de round-trip, falha e restauração passam; migração de banco real copiado para ambiente descartável é validada.

**Rollback:** migrações devem ser forward-compatible sempre que possível. O rollback de aplicação não pode exigir downgrade improvisado do banco.

### Fase 3 — Backend por fatias verticais

**Objetivo:** reduzir a concentração de responsabilidades sem alterar o contrato observado pelos clientes.

**Ordem recomendada**

1. Upload e ingest.
2. Export/import/backup.
3. Bins e organização da biblioteca.
4. Streaming e thumbnails.
5. Jobs/workers.
6. Demais fluxos de mídia.
7. Chat e pipeline, quando houver necessidade de evolução.

**Regras**

- Um caso de uso por PR ou conjunto pequeno de PRs.
- Rotas finas, mas sem criar uma camada de serviços vazia.
- Repositório não decide unidade de trabalho nem commita arbitrariamente no meio do caso de uso.
- Chamadas externas fora de transações de banco.
- Erros de domínio traduzidos na borda HTTP.
- Contrato de API preservado ou versionado explicitamente.

**Critério de saída:** fluxos migrados sem SQL direto nas rotas, testes de contrato verdes e recuperação de jobs validada.

### Fase 4 — Núcleo da timeline

**Objetivo:** isolar as regras de edição, que representam o núcleo de maior valor e risco de regressão.

**Sequência de extração**

1. Timecode, frames, arredondamento e duração.
2. Modelo de clipe/track e invariantes.
3. Comandos de split e trim.
4. Ripple, insert e overwrite.
5. Slip, slide, rolling e rate stretch.
6. Seleção e sincronização A/V.
7. Histórico undo/redo e snapshots.
8. Adaptadores de persistência e IA.
9. Renderer Canvas e controladores de interação.

**Técnica**

- Criar testes de caracterização no comportamento atual.
- Extrair função pura para módulo novo.
- Fazer a implementação antiga delegar à nova.
- Manter fachada `TIMELINE_STATE` temporariamente.
- Migrar consumidores gradualmente.
- Remover a fachada apenas quando não houver dependência restante.

**Critério de saída:** regras extraídas executam sem DOM/rede, testes antigos e novos passam, e não há novo estado global.

### Fase 5 — Library, Player e Workspace

Repetir a estratégia apenas depois de estabilizar a timeline:

- **Library:** separar consulta/API, view model, renderização e interações.
- **Player:** separar estado de reprodução, sincronização, elemento de mídia e controles.
- **Workspace:** separar modelo de layout, persistência e operações DOM/janelas.
- **CSS:** resolver tokens e duplicações em PRs próprios, sem misturar com refatoração comportamental.

### Fase 6 — Hardening e fechamento

- Revisão de segurança após as mudanças.
- Testes de integração reais com Qdrant, S3 e navegador.
- Testes de carga compatíveis com uso esperado.
- Documentação de arquitetura, backup, restore e perfis de execução.
- Remoção de código morto e fachadas temporárias.
- Revisão das issues e atualização do roadmap.

## 10. Sequência sugerida de PRs

| PR | Escopo | Depende de | Evidência de conclusão |
|---|---|---|---|
| `001` | Loopback, perfis de Compose e restrição de exports | — | Instalação padrão não exposta externamente |
| `002` | Upload confinado, streaming e limites | `001` | Testes adversariais sem escrita fora da área |
| `003` | Escape de saída de IA | — | Payloads aparecem como texto |
| `004` | Comandos de teste, lockfiles e CI rápido | — | Checkout limpo executa o gate |
| `005` | Triagem das falhas Node existentes | `004` | Cada falha classificada e resolvida/registrada |
| `006` | Baseline Python e marcadores de integração | `004` | Resultado real publicado no CI/relatório |
| `007` | Testes de caracterização de export/import | `004` | Contratos e defeitos atuais documentados |
| `008` | Manifesto e correção de proxies/IDs | `007` | Round-trip sem colisão entre projetos |
| `009` | Staging, recuperação e relatório de import | `008` | Falhas injetadas recuperáveis |
| `010` | Outbox e reindexação Qdrant | `008` | Reconciliação sem duplicidade |
| `011` | Backup consistente e teste de restore | — | Restore íntegro com WAL |
| `012` | Versionamento de migrações e startup explícito | `011` | Migração testada em cópia de banco real |
| `013` | Caso de uso de ingest extraído da rota | `005`, `006` | Contrato HTTP preservado |
| `014` | Jobs persistentes e recuperação | `012`, `013` | Reinício não perde estado operacional |
| `015` | Timecode e modelo puro da timeline | `005` | Testes unitários sem DOM |
| `016` | Comandos de edição extraídos | `015` | Autotestes antigos e novos verdes |
| `017` | Histórico e adaptadores da timeline | `016` | Undo/redo e persistência preservados |
| `018` | Extração da Library por casos de uso | `005` | Sem regressão nos fluxos de biblioteca |
| `019` | Limpeza de fachadas e código morto | `013`–`018` | Sem consumidores antigos nem globals novos |
| `020` | Hardening final e documentação operacional | Todos anteriores | Checklist de aceite completo |

Os PRs podem ser combinados quando forem muito pequenos, mas segurança, dados e refatoração comportamental não devem ser misturados em um único diff amplo.

## 11. Estratégia de testes

### 11.1 Testes unitários rápidos

Devem cobrir:

- validação de caminhos e nomes;
- limites de upload e manifesto;
- comandos puros da timeline;
- transições de estado de jobs;
- cálculo de timecode e frames;
- regras de configuração;
- mapeamento de IDs e recursos;
- serialização e compatibilidade de DTOs.

Não devem exigir rede, modelos, GPU, FFmpeg real ou navegador.

### 11.2 Testes de integração controlada

Executar com recursos temporários e dados sintéticos:

- SQLite real em diretório temporário;
- Qdrant real ou container dedicado;
- filesystem temporário;
- FFmpeg com fixtures pequenas;
- navegador para renderização quando necessário;
- adaptadores OTIO nos runtimes suportados.

### 11.3 Testes de falha e recuperação

Injetar falha:

- antes e depois do commit SQLite;
- durante escrita no Qdrant;
- durante cópia/movimentação de proxies;
- no meio de um job;
- durante backup;
- no reinício do servidor/worker;
- por disco cheio, permissão e timeout, quando viável.

O resultado esperado deve ser explícito: rollback, estado recuperável ou reprocessamento idempotente.

### 11.4 Testes de segurança

- path traversal e nomes ambíguos;
- limites de upload e ZIP;
- acesso não autenticado em perfil de rede;
- CSRF/origem em ações sensíveis;
- downloads de exports e mídia;
- XSS em saída de LLM;
- logs sem segredos;
- rate limit/cota para rotas pagas, se aplicável.

### 11.5 Testes E2E de produto

Manter um conjunto pequeno e valioso:

1. criar projeto;
2. ingerir mídia;
3. gerar proxy e thumbnail;
4. editar timeline e usar undo/redo;
5. salvar e reabrir;
6. exportar projeto;
7. importar em instalação limpa;
8. restaurar backup;
9. reindexar e pesquisar.

### 11.6 Triagem das falhas Node observadas

Falhas nos 79 autotestes documentados:

- `tests/autoteste_3point_editing.mjs`;
- `tests/autoteste_advanced_nle_interactions.mjs`;
- `tests/autoteste_conformacao_fit.mjs`;
- `tests/autoteste_player_f4.mjs`;
- `tests/autoteste_tema_tokens.mjs`.

Falhas adicionais entre os demais scripts Node:

- `tests/test_adversarial_challenger_edge_2b.mjs`;
- `tests/test_adversarial_challenger_edge_2c_stress.mjs`;
- `tests/test_track_resize_and_headers.js`;
- `tests/test_workspace_layout.js`;
- `tests/test_workspace_numpad_shortcuts.js`;
- `tests/test_workspace_timeline_expansion.js`.

Classificação inicial observada:

- alguns arquivos `.js` usam `require` em pacote configurado como ESM;
- alguns mocks não acompanham a implementação atual;
- um fluxo depende de pacote Python não provisionado;
- outras falhas contêm asserções de comportamento ou tokens e precisam de análise antes de qualquer alteração.

### 11.7 Política de CI

- **Todo PR:** lint/smoke, unitários Node e Python, testes de segurança rápidos e testes afetados.
- **Integração:** SQLite/filesystem e fluxos de API controlados.
- **Sob demanda ou agendado:** modelos, rede, navegador, FFmpeg pesado e E2E completo.
- **Antes de release:** restore, migração de banco copiado, import/export e E2E principal.

Cobertura deve ser usada como diagnóstico, não como meta isolada. Os caminhos críticos precisam de testes de comportamento e falha, não apenas execução de linhas.

## 12. Diretrizes de segurança por perfil de execução

### 12.1 Perfil local

- Bind apenas em loopback.
- Origem e `Host` permitidos explicitamente.
- Proteção contra ações cross-site, inclusive requisições que não exigem preflight.
- Nenhum mount público desnecessário.
- Segredos fora do código e dos logs.
- Exports temporários e limpeza automática.
- Cache de mídia sensível com política compatível com o modelo local.

### 12.2 Perfil LAN/internet

Somente após decisão explícita de produto:

- autenticação;
- autorização por projeto e operação;
- TLS em ambiente adequado;
- proteção de upload e download;
- rate limit e cotas;
- sessões/tokens com expiração;
- logs de auditoria sem dados sensíveis desnecessários;
- política para mídia, biometria e provedores externos;
- revisão de CORS e CSRF;
- avaliação de isolamento de subprocessos e filesystem.

Não é suficiente adicionar uma chave de API global se houver múltiplos usuários com projetos distintos; nesse caso é necessário definir autorização por recurso.

## 13. Migrações, compatibilidade e backup

### 13.1 Regras para migrações

- Toda migração recebe versão e descrição.
- Migrações são ordenadas e registradas.
- Backup é criado antes de alteração de risco.
- Mudanças destrutivas são divididas em expandir → migrar → contrair.
- Código antigo e novo coexistem durante a transição quando possível.
- Migrações não fazem chamadas a IA ou serviços externos.
- Teste usa cópia de banco representativo, nunca o único original.

### 13.2 Compatibilidade de pacotes de projeto

O manifesto deve conter, no mínimo:

```json
{
  "format": "capiau-project",
  "format_version": 1,
  "app_version": "...",
  "schema_version": 0,
  "created_at": "...",
  "project": {},
  "resources": [],
  "derived_data": [],
  "checksums": {}
}
```

A estrutura acima é ilustrativa; o contrato definitivo deve ser validado com os dados atuais. Pacotes com versão desconhecida devem ser rejeitados com orientação clara ou processados por migrador específico.

### 13.3 Rotina mínima de backup

- Backup online consistente.
- Nome versionado, sem sobrescrever sempre a mesma chave.
- Checksum e tamanho registrados.
- Retenção definida.
- Restore periódico em ambiente separado.
- `PRAGMA integrity_check` após restore.
- Verificação de recursos físicos e índices derivados.

## 14. Erros, logs e observabilidade

A revisão encontrou muitos tratamentos amplos de exceção. Eles não devem ser substituídos mecanicamente; cada fluxo precisa definir quais erros são esperados e qual é a recuperação.

### 14.1 Diretrizes

- Capturar exceções específicas nas bordas em que a recuperação é possível.
- Não transformar erro de validação em `500` por um `except Exception` genérico.
- Não retornar detalhes internos ou segredos ao cliente.
- Registrar `project_id`, `job_id`, `media_id` e correlation ID quando aplicável.
- Evitar segredos, tokens, prompts sensíveis e dados biométricos em logs.
- Diferenciar falha de validação, indisponibilidade, timeout, limite e defeito inesperado.
- Persistir erro operacional de job com código e mensagem útil.
- Tornar tarefas pendentes/reindexações visíveis na interface de saúde.

### 14.2 Health checks

Separar:

- **liveness:** processo responde;
- **readiness:** banco utilizável e migrações concluídas;
- **degraded dependencies:** Qdrant, provedores ou aceleração indisponíveis;
- **pending recovery:** imports/jobs/indexações aguardando recuperação.

A aplicação pode continuar degradada sem Qdrant, mas deve informar que busca/indexação está pendente e oferecer reconciliação.

## 15. Registro de riscos do próprio plano

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Corrigir teste em vez de corrigir regressão real | Média | Alto | Separar harness de produto; revisar asserções e histórico |
| Refatoração alterar comportamento da timeline | Alta | Alto | Testes de caracterização, extrações pequenas e fachada temporária |
| Migração danificar banco existente | Média | Muito alto | Backup, cópia descartável, versões e rollout expand/contract |
| Import antigo deixar de funcionar | Média | Alto | Manifesto e migradores de formato; mensagem clara |
| Outbox duplicar vetores | Média | Médio | Chaves idempotentes e reconciliação |
| Segurança local quebrar fluxos legítimos | Média | Médio | Perfil local explícito e testes de origem, sem reabrir rede |
| Excesso de camadas abstratas | Média | Médio | Extrair apenas onde há caso de uso e teste; evitar interfaces prematuras |
| Escopo virar reescrita | Média | Alto | PRs verticais, não funcionais primeiro e proibição de big bang |
| Dependências pesadas inviabilizarem CI | Alta | Médio | Separar unitário, integração e modelos; cache e jobs dedicados |
| Estimativas de esforço incorretas | Alta | Médio | Medir após baseline e primeiro slice; reavaliar roadmap |

## 16. Métricas e definição de pronto

### 16.1 Segurança

- Nenhum P0 aberto.
- Instalação padrão restrita a loopback.
- Testes de traversal, limites, autenticação e XSS no gate.
- Nenhum export público persistente por padrão.

### 16.2 Dados

- Round-trip validado em instalação limpa.
- Import repetido não sobrescreve recursos de outros projetos.
- Restore testado e íntegro.
- Falha de Qdrant gera estado recuperável e visível.
- Migração de banco representativo testada.

### 16.3 Testes e entrega

- Suíte rápida verde e obrigatória em PR.
- Ambiente reproduzível a partir de checkout limpo.
- Nenhuma falha existente ocultada sem registro.
- Integrações pesadas possuem workflow próprio.

### 16.4 Arquitetura

- Fluxos migrados sem SQL direto nas rotas.
- Nenhuma chamada externa demorada dentro de transação SQLite.
- Domínio novo da timeline sem dependências de DOM/rede.
- Nenhum novo `window.*` para compartilhar estado.
- Fachadas temporárias possuem issue e condição de remoção.

### 16.5 Operacional

- Jobs sobrevivem a reinício sem duplicação indevida.
- Documentação de execução, backup e restore validada.
- Logs permitem rastrear job/projeto sem expor segredos.

## 17. Não objetivos deste ciclo

- Reescrever todo o frontend em React ou outro framework.
- Migrar para arquitetura de microservices.
- Introduzir Kubernetes, Redis ou broker distribuído sem requisito comprovado.
- Multiusuário completo sem antes definir autenticação e autorização por projeto.
- Reformatação massiva de código ou CSS.
- Revisão visual completa da interface.
- Atingir uma porcentagem arbitrária de cobertura.
- Eliminar todas as exceções amplas em um único PR.
- Dividir arquivos apenas para atingir limite de linhas.

## 18. Próximas ações recomendadas

1. Registrar `SEC-01` e `SEC-02` como issues de segurança prioritárias.
2. Registrar `DATA-01` e `DATA-02` com os exemplos de proxies, IDs, Qdrant e WAL.
3. Abrir `TEST-01` para ambiente reproduzível e triagem das falhas.
4. Executar os PRs `001`–`003` antes da refatoração ampla.
5. Provisionar ambiente oficial e publicar a primeira baseline Python completa.
6. Criar os testes de caracterização de export/import antes de alterar o formato.
7. Só então iniciar as extrações de backend e timeline.

## 19. Checklist para eliminar as limitações desta análise

Antes de considerar o plano totalmente validado, executar:

- [ ] `pytest` completo no ambiente oficial.
- [ ] Build limpo do Docker.
- [ ] Smoke test do Compose nos perfis local e desenvolvimento.
- [ ] Testes Node no runtime oficialmente fixado.
- [ ] E2E principal em navegador real.
- [ ] Round-trip com projeto representativo e dados sintéticos.
- [ ] Import repetido em instalação com projetos preexistentes.
- [ ] Injeção de falha em SQLite, Qdrant e filesystem.
- [ ] Backup e restore com WAL e escritas controladas.
- [ ] Smoke tests de FFmpeg, Playwright e OTIO.
- [ ] Validação de modelos locais e APIs externas em ambiente controlado.
- [ ] Teste em Windows, se esse for um alvo de distribuição.
- [ ] Teste de memória/disco para uploads e imports grandes.
- [ ] Varredura de dependências e de segredos no histórico.
- [ ] Revisão de segurança de todos os endpoints com efeito colateral.

## 20. Conclusão

O projeto não precisa de uma reescrita; precisa de uma sequência disciplinada de redução de risco. A refatoração só será segura quando a exposição estiver contida, os dados tiverem recuperação comprovada e os testes puderem distinguir regressão de mudança intencional.

A ordem recomendada é deliberada: **primeiro impedir danos, depois tornar o comportamento observável, então recuperar a integridade dos dados e, por fim, modularizar backend e frontend por fatias pequenas e verificáveis**.
