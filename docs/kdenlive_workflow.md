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

## 5. Áudio Tratado na Conformação (WAV Derivado) e a Ponte com a DAW

Desde o plano de ajustes de áudio existe áudio **renderizado**: reparo de clipping, denoise,
loudness e limitador produzem um WAV derivado em `data/audio_tratado/` e o clipe passa a guardar
um ponteiro para ele. Na hora de exportar, isso muda a conformação de três maneiras — todas
automáticas, sem passo manual no editor. O arquivo original **nunca é tocado**.

### O clipe entra já com o áudio tratado

Se o clipe tem tratamento pronto (`audio_render` com `status: ready`) e o WAV existe no disco,
o export troca sozinho a referência de mídia para o WAV tratado. Como esse arquivo contém
**apenas o trecho** `[in, out]` da fonte e **começa em zero**, os dois ranges vão zerados, com a
duração do corte — manter o `in` antigo apontando para o arquivo curto joga o áudio fora de
sincronia no Resolve. Vale para `.otio`, `.xml` e `.edl`.

### Referência quebrada NÃO troca

Se o clipe declara tratamento pronto mas o WAV sumiu do disco, o export mantém o original e
grava o motivo no metadado `capiau` do clipe (`audio_tratado_motivo`, ex.: `ref de audio tratado
nao encontrada no disco`; visível no `.otio`). Conformar apontando para arquivo inexistente seria
pior do que não tratar: a conformação nunca fica quebrada por causa de um ponteiro órfão.

> ⚠️ Se você mover ou apagar WAVs em `data/audio_tratado/`, os exports novos voltam a apontar
> para o original silenciosamente (com o motivo anotado). Regenerar o tratamento recria o
> caminho, e o próximo export volta a usá-lo.

### Os efeitos "ao vivo" viajam como .txt, não dentro do arquivo

EQ, gate e compressor são ajustes de tempo real no navegador e **não atravessam FCPXML nem EDL**
(nem o OTIO). Fingir que atravessam seria pior do que declarar: junto de todo export cuja
timeline tenha esses efeitos nasce um **`<nome>_efeitos_audio.txt`** na mesma pasta
(`timeline_3.otio` → `timeline_3_efeitos_audio.txt`), listando clipe por clipe, com timecode de
origem, posição na timeline e TODOS os parâmetros, nesta ordem, para reproduzir à mão na DAW.
Efeitos desligados aparecem marcados como BYPASSADOS — omitir seria mentir sobre o estado.

### A ida e volta pela pasta observada `watch/audio_daw/`

Para levar o material cru à DAW, exporte os **stems**: um WAV 48 kHz / 24 bits **sem tratamento
nenhum** por intervalo único, com o timecode carregado no nome —

    stem_v<video_id>_<in_ms:09d>-<out_ms:09d>.wav   (ex.: stem_v17_000405500-000415500.wav)

Os milissegundos são os pontos `in`/`out` **na mídia de origem** (não na timeline), e é esse nome
que permite o retorno automático: trate o stem na sua DAW e solte o arquivo de volta na pasta
observada `watch/audio_daw/` (config `audio.daw.pasta_retorno`) **com o mesmo nome-base**. O
watcher reconhece o trio `(video_id, in, out)` e o clipe ganha o tratamento — que, a partir daí,
sai dentro da conformação como descrito acima.

> ⚠️ Não renomeie o arquivo devolvido: sem a convenção de nome, o retorno é ignorado.
> Hospedagem de VST dentro do CapIAu-Talho não foi implementada (bug conhecido de crash, licença
> ausente) — a mixagem fina continua sendo trabalho da DAW.

## 6. Regras de Efeitos e Compatibilidade de Áudio na Timeline

Para garantir reprodução contínua e exportação sem falhas ao compor timelines multipista (JL-cuts, B-rolls sobre falas):

- **Propriedades de Volume (`level` vs. `gain`):** Clipes de áudio com efeito de volume (`type: "volume"`) aceitam tanto `level` quanto `gain` (ex.: `{"type": "volume", "gain": 0.18}` ou `{"type": "volume", "level": 0.18}`). O player web, o cálculo de waveforms e o renderizador interno normalizam ambos para valores finitos em `[0.0, 1.0]`, evitando valores `NaN` que travavam o laço de animação da agulha (`requestAnimationFrame`) na entrada de trilhas secundárias (A2/V2).
- **Proteção do Playhead (Agulha):** A sincronização temporal (`syncVideoToPlayhead`) opera com isolamento de erros (`try...catch`) e validação estrita de números finitos (`Number.isFinite`), garantindo que o arraste (scrubbing) e a reprodução continuem ininterruptos mesmo se houver cortes sobrepostos com fades ou transições complexas.
- **Fades e Curvas:** Efeitos de crossfade (`type: "crossfade"`) com curvas lineares, exponenciais, logarítmicas ou em S aplicam atenuação multiplicativa segura sobre o volume do clipe e da pista.

