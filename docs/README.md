# Índice da pasta docs/

> Nota: tabelas de atalhos e de rotas são geradas por scripts/gerar_atalhos.mjs e scripts/gerar_docs_api.py — não edite à mão.

Cada linha diz para quem o documento serve, em que pé está e quando foi alterado pela última vez (último commit do arquivo). Os links são relativos a esta pasta; os itens marcados com `../` estão na raiz do repositório.

## Guias de usuário

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`ai_settings_pro_guide.md`](ai_settings_pro_guide.md) | Editor avançado (Modo Profissional) | Ativo | 2026-10-06 |
| [`costs_and_security.md`](costs_and_security.md) | Usuário (custos e chaves) | Ativo; preços a confirmar no OpenRouter | 2026-10-06 |
| [`kdenlive_workflow.md`](kdenlive_workflow.md) | Editor (fluxo com Kdenlive) | A confirmar | 2026-10-06 |
| [`shortcuts.md`](shortcuts.md) | Usuário (atalhos) | Gerado por `scripts/gerar_atalhos.mjs` | 2026-10-08 |
| [`atalhos/`](atalhos/) | Usuário (cartões para impressão) | Gerado por `scripts/gerar_atalhos.mjs` | — |

## Referência técnica

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`api_endpoints.md`](api_endpoints.md) | Desenvolvedor (rotas da API) | Gerado por `scripts/gerar_docs_api.py` | 2026-10-06 |
| [`AUPHONIC_AUDIO_RESTORATION_GUIDE.md`](AUPHONIC_AUDIO_RESTORATION_GUIDE.md) | Desenvolvedor (nuvem de áudio) | Defasado: a trilha Auphonic do código está à frente do guia | 2026-10-06 |
| [`ORDEM_DAS_ANALISES.md`](ORDEM_DAS_ANALISES.md) | Desenvolvedor (pipeline de análise) | Parcial: 9 de 20 itens feitos | 2026-10-06 |
| [`REVISAO_CATEGORIAS.md`](REVISAO_CATEGORIAS.md) | Desenvolvedor (taxonomia de categorias) | Parcial: 17 de 35 itens feitos | 2026-10-07 |
| [`TESTE_MANUAL_TRACK_BASED_NLE.md`](TESTE_MANUAL_TRACK_BASED_NLE.md) | Testador (roteiro manual) | Roteiro desatualizado (atalhos); a refazer | 2026-10-06 |
| [`AUDITORIA_DOCUMENTACAO_2026-10-29.md`](AUDITORIA_DOCUMENTACAO_2026-10-29.md) | Autor e agentes de documentação | Relatório da auditoria de 29/10/2026 | 2026-10-29 |
| [`images/`](images/) | Leitor dos guias (diagramas SVG) | Ativo; legenda em `images/README.md` | 2026-10-29 |

## Planos ativos

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`ORDEM_DE_IMPLEMENTACAO.md`](ORDEM_DE_IMPLEMENTACAO.md) | Autor e agentes (ordem de todos os planos) | Ativo; índice CSV em `ORDEM_DE_IMPLEMENTACAO_itens.csv` | 2026-10-28 |
| [`PLANO_SUITE_NLE_CLASSICO.md`](PLANO_SUITE_NLE_CLASSICO.md) | Autor e desenvolvedor (suíte NLE) | Em execução: Tasks 0 a 18, 23 e 24 concluídas; 19 a 22 e 25 planejadas | 2026-10-28 |
| [`PLANO_AUDIO_CATEGORIAS.md`](PLANO_AUDIO_CATEGORIAS.md) | Desenvolvedor (áudio) | Em andamento: camadas 1 a 3 feitas; calibração pendente | 2026-10-28 |
| [`PLANO_COR_OCIO.md`](PLANO_COR_OCIO.md) | Desenvolvedor (cor) | Em andamento (Fase 0 no código) | 2026-10-28 |
| [`PLANO_TEMA_NEUTRO.md`](PLANO_TEMA_NEUTRO.md) | Desenvolvedor (interface) | Em andamento (tokens de tema no código) | 2026-10-28 |
| [`PLANO_VIEWPORT_TRANSFORM_CROP.md`](PLANO_VIEWPORT_TRANSFORM_CROP.md) | Desenvolvedor (player e crop) | Quase concluído: 24 de 37 itens feitos | 2026-10-06 |
| [`PLANO_IMPLEMENTACAO.md`](PLANO_IMPLEMENTACAO.md) | Autor (plano geral) | Parado desde 23/08; parcialmente defasado | 2026-10-06 |
| [`PLANO_NUVEM.md`](PLANO_NUVEM.md) | Autor (nuvem e multi-máquina) | Parcial: 1 de 64 itens feitos; resto depende de decisões e contas | 2026-10-09 |
| [`PLANO_EMBEDDINGGEMMA2.md`](PLANO_EMBEDDINGGEMMA2.md) | Desenvolvedor (busca semântica) | Não iniciado (1 de 32 itens) | 2026-10-09 |

## Propostas

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`PROPOSTA_BUSCA_OBJETOS.md`](PROPOSTA_BUSCA_OBJETOS.md) | Autor (busca por objeto) | Não implementada (0 de 33 itens) | 2026-10-06 |
| [`PROPOSTA_SEQUENCIA_FANTASMA_IA.md`](PROPOSTA_SEQUENCIA_FANTASMA_IA.md) | Autor (IA na timeline) | Não implementada; cruzar com o plano da suíte antes | 2026-10-28 |

## Handoffs para agentes

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`HANDOFF_JANELAS_DRAG_DOCK.md`](HANDOFF_JANELAS_DRAG_DOCK.md) | Agente (janelas e dock) | Metade feita: 15 de 34 itens | 2026-10-06 |
| [`HANDOFF_DESIGN_UI.md`](HANDOFF_DESIGN_UI.md) | Agente de design da interface | A confirmar | 2026-10-28 |

## Prompts para agentes (proximos_chats/)

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`proximos_chats/README.md`](proximos_chats/README.md) | Autor (índice dos prompts) | Ativo; decisões abertas sobre objetos | 2026-10-09 |
| [`proximos_chats/01_correcoes_ordem_analises.md`](proximos_chats/01_correcoes_ordem_analises.md) | Agente | Concluído (8 de 8 itens) | 2026-10-06 |
| [`proximos_chats/02_limpeza_configuracoes_dispositivo.md`](proximos_chats/02_limpeza_configuracoes_dispositivo.md) | Agente | Pendente (1 parcial, 6 ausentes) | 2026-10-06 |
| [`proximos_chats/03_checagem_tecnica_B.md`](proximos_chats/03_checagem_tecnica_B.md) | Agente | Pendente (busca por objeto) | 2026-10-06 |
| [`proximos_chats/04_busca_objeto_A_D.md`](proximos_chats/04_busca_objeto_A_D.md) | Agente | Pendente (busca por objeto) | 2026-10-06 |
| [`proximos_chats/05_continuidade_C.md`](proximos_chats/05_continuidade_C.md) | Agente | Pendente (busca por objeto) | 2026-10-06 |
| [`proximos_chats/06_gabaritos_avaliacao.md`](proximos_chats/06_gabaritos_avaliacao.md) | Agente | Pendente (2 parciais, 5 ausentes) | 2026-10-06 |
| [`proximos_chats/07_pendencias_externas.md`](proximos_chats/07_pendencias_externas.md) | Autor (chaves e testes externos) | Pendente (pendências externas) | 2026-10-09 |
| [`proximos_chats/08_plano_sequencia.md`](proximos_chats/08_plano_sequencia.md) | Agente | Pendente (3 parciais, 17 ausentes) | 2026-10-09 |
| [`PROMPT_PROXIMO_CHAT_CATEGORIAS_AUDIO.md`](PROMPT_PROXIMO_CHAT_CATEGORIAS_AUDIO.md) | Agente (áudio) | Parcial: camadas 1 e 2 feitas | 2026-10-06 |
| [`PROMPT_CONFIGURAR_MODELOS_2026.md`](PROMPT_CONFIGURAR_MODELOS_2026.md) | Agente (modelos) | Histórico; resta tirar opções que não funcionam | 2026-10-09 |

## Pesquisas

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`PESQUISA_VIDEO_AUDIO_MCP.md`](PESQUISA_VIDEO_AUDIO_MCP.md) | Autor | Superada pela decisão de um MCP próprio do Talho | 2026-10-06 |
| [`Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md`](Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md) | Autor e agentes (análises com IA) | A confirmar | 2026-10-28 |

## Concluídos e históricos

| Documento | Para quem | Status | Última atualização |
| :--- | :--- | :--- | :---: |
| [`plano_reorganizacao_workspaces.md`](plano_reorganizacao_workspaces.md) | Autor (histórico) | Concluído | 2026-10-28 |
| [`PLANO_PESQUISA_19082026.md`](PLANO_PESQUISA_19082026.md) | Autor (histórico) | Histórico: triagem da pesquisa de 19/08 (arquivo de origem não versionado) | 2026-10-28 |
| [`prototipos/welcome-hub-v2.html`](prototipos/welcome-hub-v2.html) | Autor (protótipo) | Implementado | 2026-10-06 |
| [`../walkthrough.md`](../walkthrough.md) | Autor (histórico do MVP, na raiz) | Diário técnico histórico do MVP | 2026-10-06 |
