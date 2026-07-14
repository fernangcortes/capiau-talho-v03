# 🎬 Workflow de Integração com o Kdenlive (Edição Offline/Online)

Este documento detalha o fluxo de trabalho de decupagem inteligente do
**CapIAu-Talho** integrado ao **Kdenlive** como editor não-linear (NLE)
principal do projeto.

## 1. O Conceito: Workflow Offline vs. Online

A manipulação de múltiplos arquivos de câmera pesados (4K, ProRes, RAW)
em discos externos pode gargalar o hardware. A estratégia do
CapIAu-Talho apoia o workflow tradicional de cinema:

1.  **Ingestão In-Place (Offline):** O CapIAu-Talho mapeia os arquivos
    gigantes no HD Externo sem copiá-los para a máquina de edição (modo
    copy_original=False). Ele grava apenas as referências de caminhos
    absolutos e cria **proxies leves em 720p H.264** na pasta de cache
    local da máquina.

2.  **Decupagem e Seleção:** Toda a busca semântica, leitura de falas,
    identificação facial e montagem inicial dos cortes é efetuada sobre
    os proxies leves e rápidos.

3.  **Exportação da Timeline:** O CapIAu-Talho exporta a timeline de
    cortes e ordenação usando o padrão da indústria XML ou EDL.

4.  **Edição Fina e Finalização (Online):** O editor importa a timeline
    gerada para o Kdenlive, que faz a leitura dos clipes e monta a
    timeline em segundos. O Kdenlive então substitui os arquivos proxy
    leves pelos originais 4K do HD Externo para a renderização final.

## 2. Passo a Passo: Importando a Timeline do CapIAu-Talho no Kdenlive

Embora o Kdenlive seja baseado no motor MLT, ele possui excelente
suporte de importação e mapeamento de timelines através dos formatos
exportados pelo CapIAu-Talho via **OpenTimelineIO (OTIO)**:

### Passo 1: Exportar no CapIAu-Talho

Na interface do CapIAu-Talho, conclua sua timeline de rascunho de making
of e clique em **Exportar**. Selecione o formato **XML (Final Cut Pro 7
/ Premiere)** ou **EDL (CMX 3600)**. O arquivo .xml ou .edl será gravado
no diretório de exportações configurado.

### Passo 2: Importar no Kdenlive

1.  Abra o **Kdenlive**.

2.  Vá em Projeto \> Adicionar Clipe ou Pasta ou clique em Arquivo \>
    Importar \> Timeline (XML / EDL).

3.  Escolha o arquivo gerado pelo CapIAu-Talho.

4.  O Kdenlive lerá os metadados temporais e os caminhos dos arquivos.
    Se solicitado, aponte a localização dos originais (ou deixe que o
    Kdenlive faça o mapeamento automático).

## 3. Visão de Futuro: Geração Direta de Arquivos .kdenlive (XML MLT)

A escolha do Kdenlive como NLE principal fundamenta-se na **facilidade
de automação programática** do seu formato nativo de projeto:

- **O formato .kdenlive é na verdade um XML baseado no padrão MLT (Media
  Lovin\' Toolkit).**

- Ao contrário dos formatos binários proprietários de outros NLEs
  comerciais, um arquivo do Kdenlive pode ser aberto em qualquer editor
  de texto e lido/manipulado facilmente por scripts em Python.

- **Plano de Automação:** Nas próximas atualizações, o motor de
  exportação do CapIAu-Talho implementará a geração direta de arquivos
  .kdenlive nativos. Isso permitirá:

  - Gerar timelines do Kdenlive com trilhas de áudio e vídeo
    pré-nomeadas.

  - Inserir marcadores coloridos e comentários com as transcrições da
    AssemblyAI acopladas em cada bloco de vídeo na timeline.

  - Adicionar tags de metadados do set e reconhecimento facial como
    anotações direto na biblioteca do Kdenlive.

  - Configurar transições básicas e overlays automatizados baseados em
    regras geradas pelo chatbot RAG.

## 4. Dicas de Otimização e Mapeamento de Arquivos no Kdenlive

- Ao configurar pastas de mídia no Kdenlive, certifique-se de ativar o
  recurso de **Clipe Proxy** interno do Kdenlive caso precise de
  decodificação extra na sua CPU Intel i7 sem GPU.

- Se os caminhos de mídias diferirem de máquina para máquina, o Kdenlive
  possui um gerenciador interativo de relink de arquivos em Projeto \>
  Localizar Clipes Desconectados.
