# Pesquisa: `video-audio-mcp` (misbahsy) e servidores MCP de vídeo/áudio — avaliação para o CapIAu-Talho

> Metodologia: apenas web_search, 4 chamadas (orçamento limitado respeitado).
> Convenção de marcação: **[confirmado]** = veio direto de snippet/fonte retornada pela busca; **[inferência]** = dedução minha a partir do material; **[não confirmado]** = lacuna que precisa verificação prática.

---

## video-audio-mcp em detalhe

**Identidade:** "An FFMPEG powered MCP server for basic Video and Audio editing", repo [github.com/misbahsy/video-audio-mcp](https://github.com/misbahsy/video-audio-mcp). Também listado como "Video & Audio Editor MCP Server by Misbah Sy" no [PulseMCP](https://www.pulsemcp.com/servers/video-audio-editor) e no [MCP Market](https://mcpmarket.com/server/video-audio-editor), com `server.json` disponível (PulseMCP declara gerir o arquivo temporariamente até o mantenedor publicá-lo no registry oficial). **[confirmado]**

### Ferramentas expostas

A busca capturou o trecho do README com nomes e descrições destas tools **[confirmado pelos snippets]**:

| Nome | Parâmetros | O que faz |
|---|---|---|
| `extract_audio_from_video` | não capturado | Extrai faixas de áudio de arquivos de vídeo |
| `trim_video` | não capturado | Corta segmentos de vídeo "com timing preciso" |
| `convert_video_format` | não capturado | Conversão entre formatos (MP4, MOV, AVI etc.) |
| `convert_video_properties` | não capturado | "Conversão abrangente de propriedades" de vídeo |
| `change_aspect_ratio` | não capturado | Ajusta aspect ratio com padding ou cropping |
| `set_video_resolution` | não capturado | Muda a resolução do vídeo |

Adicionalmente, a descrição agregada dos diretórios PulseMCP/MCP Market menciona **adição de legendas, overlays de texto e concatenação de vídeos com efeitos de transição** **[confirmado como descrição do diretório; nomes individuais dessas tools não confirmados]**. É plausível que existam também ferramentas de informação de mídia/concatenação/extração de segmentos, mas os nomes exatos **[não confirmados]**.

⚠️ **A assinatura completa (parâmetros de cada tool) não foi capturada pelas buscas.** A fonte da verdade é o código em `src/` do próprio repo (funções decoradas como tools do FastMCP) — checar antes de integrar. **[não confirmado]**

### Instalação / transporte / runtime

- **Runtime: Python, executado com `uv`, transporte stdio.** Config recomendada no README (Claude Desktop): `"command": "uv"`, `"args": ["--directory", "/path/to/your/video-audio-mcp", "run", "server.py"]`, com alternativa "usando Python diretamente". **[confirmado]**
- Ou seja: **clone local do repo + uv**; não encontrei pacote PyPI oficial nem menção a npx/uvx/docker para este projeto específico (o pacote `mcp-video` no PyPI é outro projeto). **[confirmado por ausência + inferência]**
- Transporte stdio implícito pelo padrão de config acima; **nenhuma menção a streamable-http** nas fontes. **[inferência: só stdio]**

### Dependências

- **FFmpeg NÃO vem bundled** — o troubleshooting oficial do README lista "FFmpeg not found → Install FFmpeg (`brew install ffmpeg` macOS / `apt install ffmpeg` Ubuntu / …)". Precisa estar no PATH do processo do servidor. **[confirmado]**
- Dependências Python resolvidas pelo `uv` a partir do projeto (versões exatas não capturadas). **[não confirmado]**

### Robustez declarada

O README afirma: validação de existência de arquivo antes de processar, validação de formatos/codecs suportados, *graceful fallback* tentando cópia de stream (`-c copy`) antes de re-encode, e logging detalhado de erros. **[confirmado como declaração do autor]**

### Riscos

1. **Licença não apareceu em nenhuma busca** — conferir o arquivo LICENSE no repo antes de embutir/vender. **[não confirmado]**
2. Projeto descrito pelo próprio autor como edição "**básica**" — é um wrapper fino de ffmpeg CLI; não há nada semântico (sem ASR, speaker id, descrição visual, timeline). Tudo que ele oferece, o CapIAu já faz ou pode fazer chamando ffmpeg direto no backend. **[inferência sólida]**
3. Transcodes longos rodam como subprocess síncrono dentro da tool → risco de estourar timeout do cliente MCP em mídias grandes. **[inferência]**
4. Caminho do clone no Windows contendo "Programação" (acento) pode dar problema de encoding em subprocess/uv — preferir path ASCII. **[inferência]**
5. Manutenção/comunidade: não encontrei nos resultados métricas de adoção nem relatos de uso em produção deste repo específico. **[não confirmado]**

---

## Alternativas comparáveis

| Nome | Foco | Runtime | URL |
|---|---|---|---|
| ffmpeg-mcp-comp (video-dev) | FFmpeg abrangente: "18 powerful tools" de vídeo/áudio | não capturado | [github.com/video-dev/ffmpeg-mcp-comp](https://github.com/video-dev/ffmpeg-mcp-comp) |
| ffmpeg-mcp (PedroMarianoAlmeida) | Cortar vídeo, converter formatos, remover silêncio | não capturado | [github.com/PedroMarianoAlmeida/ffmpeg-mcp](https://github.com/PedroMarianoAlmeida/ffmpeg-mcp) · listing: [mcp-marketplace.io](https://mcp-marketplace.io/server/io-github-pedromarianoalmeida-ffmpeg-mcp) |
| mcp-ffmpeg (bitscorp) | Upload + processamento ffmpeg com dirs fixas `uploads/` e `output/`; limite de 500 MB por upload | Node/npx (`npx --yes /absolute/path/to/mcp-ffmpeg`) **[confirmado]** | [mcp.so/servers/mcp-ffmpeg](https://mcp.so/servers/mcp-ffmpeg) |
| mcp-video (PyPI) | Edição de vídeo via pip | Python — `pip install mcp-video` ou `uvx mcp-video`; requer ffmpeg instalado **[confirmado]** | [pypi.org/project/mcp-video](https://pypi.org/project/mcp-video/1.3.3) |
| Video_Editor_MCP (Kush36Agrawal) | Editor de vídeo; processa **somente em allowed directories**, valida comandos ffmpeg, sanitiza inputs, rastreio de progresso e erros detalhados | não capturado | [mcpservers.org/servers/Kush36Agrawal/Video_Editor_MCP](https://mcpservers.org/servers/Kush36Agrawal/Video_Editor_MCP) |
| FFmpeg Media Tools (EGOIST) | "~14 tools for media" (conversão, trim, legendas, overlays, concat c/ transições — mesma família de features) | não capturado | [pulsemcp.com/servers/egoist-ffmpeg-media-tools](https://www.pulsemcp.com/servers/egoist-ffmpeg-media-tools) |
| mcp-video-editor (chandler767) | Cut por start/end, extrair áudio, converter formato com qualidade custom | não capturado | [lobehub.com/es/mcp/chandler767-mcp-video-editor](https://lobehub.com/es/mcp/chandler767-mcp-video-editor) |
| yt-dlp-mcp (Gtvar) | Download de vídeo/áudio de YouTube/Facebook/TikTok etc. via yt-dlp; info e legendas | Python/yt-dlp (provável) **[inferência]** | [mcpservers.org/servers/Gtvar/yt-dlp-mcp](https://mcpservers.org/servers/Gtvar/yt-dlp-mcp) · fork: [daniellopez-2/Youtube-Download](https://github.com/daniellopez-2/Youtube-Download) |
| Fast-Whisper-MCP-Server (BigUncle) | ASR de alta performance com faster-whisper | Python **[inferência pelo stack]** | [github.com/BigUncle/Fast-Whisper-MCP-Server](https://github.com/BigUncle/Fast-Whisper-MCP-Server) |
| mcp-server-whisper (arcaputo3) | Transcrição whisper (OpenAI API) + outputs estilizados; navega/lista arquivos | não capturado | [github.com/arcaputo3/mcp-server-whisper](https://github.com/arcaputo3/mcp-server-whisper) |
| Audio-MCP-Server (GongRzhe) | Interface de áudio p/ assistentes; instala via Smithery (`npx -y @smithery/cli install @GongRzhe/Audio-MCP-Server`) ou venv+pip | Python **[confirmado]** | [mcpservers.org/servers/GongRzhe/Audio-MCP-Server](https://mcpservers.org/servers/GongRzhe/Audio-MCP-Server) |
| mmaudio-mcp | Geração de áudio p/ vídeo (video-to-audio/text-to-audio generativo); MIT | Desktop Extension | [github.com/mmaudio/mmaudio-mcp](https://github.com/mmaudio/mmaudio-mcp) |

Observação: não localizei nos resultados um "vfx-mcp" estabelecido — o nicho é dominado por wrappers de ffmpeg. **[confirmado por ausência]**

---

## Lições de integração

### Caminhos de arquivo locais (ponto crítico)

- **Padrão do ecossistema = whitelist de diretórios.** O modelo do Filesystem MCP (allowed directories configuradas na linha de comando, tool `list_allowed_directories`) é a referência ([verdent.ai](https://www.verdent.ai/guides/filesystem-mcp-server), [agentskillshub.dev](https://agentskillshub.dev/skills/filesystem)). O Video_Editor_MCP aplica explicitamente: "Only processes files in explicitly allowed directories" + sanitização de parâmetros. **[confirmado]**
- **mcp-ffmpeg (bitscorp) usa dirs convencionadas**: uploads vão para `uploads/`, resultado para `output/`, relativas à raiz do servidor, com limite de **500 MB** por upload. Ou seja: alguns servidores nem aceitam caminho arbitrário — exigem copiar o arquivo para a área deles. **[confirmado]**
- **Caso real documentado de fricção** (blog ["Claude knows FFmpeg, but it has no idea where the video is"](https://kristofer.palmvik.se/claude-knows-ffmpeg)): o agente assumiu que um diretório paralelo `output/` existia; ao falhar a abertura, tentou `mkdir` — bloqueado porque o servidor só aceitava comandos começando com `ffmpeg` (segurança); o agente então se adaptou e escreveu em caminho relativo. Moral: **crie os diretórios antes, use caminhos absolutos consistentes e espere o agente errar o caminho na 1ª tentativa**. **[confirmado]**
- O video-audio-mcp declara validar existência de arquivo antes de processar → erros de path falham rápido e legível, mas continuam sendo erro de path. **[confirmado como declaração]**

### Timeouts e outputs grandes

- Servidores dessa família retornam **texto** (confirmação/caminho/log); as mídias resultantes ficam **em disco** — nunca serializadas na resposta. **[inferência consistente com todos os padrões observados]**
- Consequência prática: para o Harness, o custo real é **tempo de subprocess ffmpeg** (re-encodes de longa-metragem podem passar do timeout da tool); operações `-c copy`/cortes curtos são seguras. Preferir ferramentas de inspeção rápida primeiro e operações pesadas como passos explícitos. **[inferência]**
- Progress tracking existe em alguns (Video_Editor_MCP declara rastreio de progresso), mas não há evidência de streaming de progresso via MCP nos demais. **[parcialmente confirmado]**

---

## Recomendação de montagem no Harness

O cliente MCP nativo do DSH fala **stdio** e **streamable-http**, e tools viram `mcp__<servidor>__<ferramenta>` — o video-audio-mcp (stdio/uv) encaixa direto no transporte stdio. **[confirmado pelo contexto da missão + stdio confirmado do servidor]**

Exemplo concreto de config YAML no perfil (stdio):

```yaml
# NOTA: nomes de campos ilustrativos — validar contra o schema MCP do perfil DSH
# (chave-raiz, se env/cwd são suportados, formato de args)
mcp_servers:
  video-audio:
    transport: stdio
    command: uv
    args:
      - --directory
      - C:/dev/video-audio-mcp        # clone FORA de paths com acento ("Programação") p/ evitar encoding issues
      - run
      - server.py
    env:
      # garantir ffmpeg no PATH do processo filho, se não estiver no PATH global
      PATH: "C:/ffmpeg/bin"
```

As ferramentas aparecerão como `mcp__video-audio__trim_video`, `mcp__video-audio__convert_video_format` etc. **[inferência do mecanismo `mcp__servidor__ferramenta`]**

### O que PRECISA ser confirmado na prática

1. **Schema YAML do perfil DSH** para servidores stdio (nome exato das chaves; suporte a `env`). **[não confirmado nesta pesquisa]**
2. **Parâmetros de cada tool** — ler `src/` do repo (fonte da verdade). **[não confirmado]**
3. **Licença do repo** (LICENSE file). **[não confirmado]**
4. `uv` disponível no Windows do usuário + ffmpeg no PATH; teste mínimo: uma tool barata de leitura de metadados antes de qualquer transcode.
5. Se o repo publica algo instalável (PyPI/Smithery) ou só clona+uv. Buscas não acharam pacote oficial.
6. Comportamento de saída: onde o servidor grava arquivos resultantes (cwd? pasta do input?) — definir convenção com o acervo do CapIAu (ex.: gravar sempre em `renders/mcp/`).

### Recomendação estratégica para o CapIAu-Talho

Dado que o acervo **já está indexado** (ASR palavra-a-palavra + speaker id, CLIP+Qdrant, shots/beats, OTIO/XML/EDL), o valor incremental do video-audio-mcp é **apenas manipulação bruta** (proxies, cortes rápidos, extração de trechos, conversões ad-hoc) — e para isso um wrapper genérico de ffmpeg adiciona uma camada a mais onde o backend FastAPI já poderia chamar ffmpeg diretamente com caminhos domésticos e jobs controlados. **[inferência]**

Cenários:
- **Se o objetivo é deixar o LLM "sujar as mãos"** explorando mídia bruta durante a pesquisa/making-of (extrair clipe X, checar propriedades, gerar preview): montar o video-audio-mcp via stdio conforme acima é razoável e barato.
- **Se o objetivo é pipeline determinístico de edição/exportação**: não usar MCP genérico — as próprias rotas FastAPI do CapIAu (ou tools MCP internas do projeto) são mais confiáveis, pois conhecem o timeline OTIO e o acervo indexado.
- Alternativa leve se quiser só download/aquisição de material externo: `yt-dlp-mcp`. Para ASR adicional fora do pipeline atual: Fast-Whisper-MCP-Server — mas o CapIAu já tem ASR próprio, logo redundante. **[inferência]**

---

## Fontes

- https://github.com/misbahsy/video-audio-mcp
- https://www.pulsemcp.com/servers/video-audio-editor
- https://mcpmarket.com/server/video-audio-editor
- https://github.com/video-dev/ffmpeg-mcp-comp
- https://github.com/PedroMarianoAlmeida/ffmpeg-mcp
- https://mcp-marketplace.io/server/io-github-pedromarianoalmeida-ffmpeg-mcp
- https://skillselion.com/mcp/tool/io.github.PedroMarianoAlmeida/ffmpeg-mcp
- https://mcp.so/servers/mcp-ffmpeg
- https://pypi.org/project/mcp-video/1.3.3
- https://mcpservers.org/servers/Kush36Agrawal/Video_Editor_MCP
- https://www.pulsemcp.com/servers/egoist-ffmpeg-media-tools
- https://lobehub.com/es/mcp/chandler767-mcp-video-editor
- https://mcpservers.org/servers/Gtvar/yt-dlp-mcp
- https://github.com/daniellopez-2/Youtube-Download
- https://github.com/BigUncle/Fast-Whisper-MCP-Server
- https://github.com/arcaputo3/mcp-server-whisper
- https://mcpservers.org/servers/GongRzhe/Audio-MCP-Server
- https://github.com/mmaudio/mmaudio-mcp
- https://kristofer.palmvik.se/claude-knows-ffmpeg
- https://www.verdent.ai/guides/filesystem-mcp-server
- https://agentskillshub.dev/skills/filesystem
