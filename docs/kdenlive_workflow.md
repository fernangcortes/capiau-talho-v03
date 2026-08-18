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
    cortes e ordenação em **OpenTimelineIO (.otio)** — lido nativamente
    pelo Kdenlive 25.04+ — ou nos padrões da indústria XML e EDL.

4.  **Edição Fina e Finalização (Online):** O editor importa a timeline
    gerada para o Kdenlive, que faz a leitura dos clipes e monta a
    timeline em segundos. O Kdenlive então substitui os arquivos proxy
    leves pelos originais 4K do HD Externo para a renderização final.

## 2. Passo a Passo: Importando a Timeline do CapIAu-Talho no Kdenlive

O caminho recomendado depende da versão do Kdenlive.

### Kdenlive 25.04 ou mais recente — importação nativa de OTIO (recomendado)

Desde a versão **25.04**, o Kdenlive lê arquivos **OpenTimelineIO** nativamente. Este é o caminho
preferencial: preserva mais informação que XML ou EDL e não depende de adaptadores externos.

1.  No CapIAu-Talho, conclua sua timeline e **salve**. A exportação usa o que está gravado no
    banco, não o que está na tela.
2.  Clique em **Exportar**. O diálogo mostra as timelines salvas do projeto com nome, data e
    quantidade de clipes — confira que está escolhendo a certa.
3.  Selecione o formato **Kdenlive 25.04+ · OpenTimelineIO (.otio)** e confirme.
4.  No Kdenlive, abra o arquivo `.otio` gerado. Ele lê os caminhos absolutos das mídias e religa
    os originais automaticamente.

> **Por que o `.otio` não usa URIs `file:///`.** O padrão OpenTimelineIO admite URI no
> `target_url`, e era assim que exportávamos. Mas o importador do Kdenlive **não** trata esse
> campo como URI: ele concatena a pasta do projeto na frente e não decodifica o percent-encoding.
> Medido em 18/08/2026 no Kdenlive 26.04.3, uma mídia em `D:\makinof-monstro\Vídeos\...`
> gravada como `file:///D:/makinof-monstro/V%C3%ADdeos/...` fazia o editor procurar por
> `C:/Users/FGC/Downloads/file:///D:/makinof-monstro/V%C3%ADdeos/...` e falhar ao abrir o
> projeto inteiro. Por isso o `.otio` passou a gravar caminho absoluto simples
> (`D:/makinof-monstro/Vídeos/...`). O `.xml` continua com a URI, que é o que Premiere e Resolve
> esperam em `<pathurl>`.

### Kdenlive anterior à 25.04 — XML ou EDL

1.  Exporte no formato **Premiere / Resolve / Final Cut (.xml)** ou **EDL · pista única (.edl)**.
2.  No Kdenlive, vá em Arquivo > Importar > Timeline e escolha o arquivo.
3.  Se solicitado, aponte a localização dos originais.

> ⚠️ O EDL é achatado em **pista única** na exportação. Timelines multipista (V1/V2, A1/A2) perdem
> a separação de trilhas nesse formato — use `.otio` ou `.xml` quando a estrutura importar.

## 3. Sobre a geração direta de arquivos .kdenlive

**Decisão (18/08/2026): não será implementada.** Esta seção descrevia antes um plano de gerar
arquivos `.kdenlive` (XML MLT) diretamente. O plano foi descartado, e o motivo é bom: **o problema
que ele resolveria deixou de existir.**

- O Kdenlive passou a importar **OTIO nativamente na 25.04**. A integração nativa cobre mais
  recursos e é mais confiável que qualquer geração externa do formato.
- O adaptador da comunidade (`otio-kdenlive-adapter`) foi **descontinuado pelos próprios autores**,
  que recomendam explicitamente a via nativa. A última versão publicada é a `0.0.3`.
- Em teste (18/08/2026), esse adaptador ainda **corrompe caminhos no Windows**: um clipe em
  `C:\Users\FGC\midia\clipeA.mp4` era gravado como `/C:/Users/FGC/midia/clipeA.mp4`, com uma barra
  sobrando antes da letra do drive. O MLT não abre esse caminho — todas as mídias entrariam
  desvinculadas. O adaptador `otio-mlt-adapter` grava a URI `file:///` crua, com o mesmo efeito.

As funcionalidades que motivavam o plano original continuam válidas como ideias, mas dependeriam
de extensões do próprio OTIO (metadados por clipe), não de um formato de saída novo:

- marcadores coloridos e comentários com as transcrições acopladas a cada bloco;
- tags de metadados do set e de reconhecimento facial anotadas na biblioteca;
- transições e overlays automatizados a partir de regras do chatbot RAG.

## 4. Dicas de Otimização e Mapeamento de Arquivos no Kdenlive

- Ao configurar pastas de mídia no Kdenlive, certifique-se de ativar o
  recurso de **Clipe Proxy** interno do Kdenlive caso precise de
  decodificação extra na sua CPU Intel i7 sem GPU.

- Se os caminhos de mídias diferirem de máquina para máquina, o Kdenlive
  possui um gerenciador interativo de relink de arquivos em Projeto \>
  Localizar Clipes Desconectados.
