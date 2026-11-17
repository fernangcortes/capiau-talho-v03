# Frente H — O agente editor com olhos, e auditorias da montagem

> **Resumo.** **Entrega:** pacote `src/revisao/` (novo) em 4 camadas: checagens puras da montagem (flash, buraco, repetição, jump cut, título curto, texto pequeno, área segura), tiras de 5 quadros por corte dos proxies com medidas de pixel e contraste WCAG, revisão visual por mosaicos (Gemini 2.5 Flash) e as superfícies (ferramenta `revisar_cortes`, painel com "Ir", marcas na régua, selo nos ghost clips, seção "Revisão" no export).
> **Valor:** achar o defeito em segundos, antes de aceitar a proposta e de exportar, e dar ao agente DeepSeek (sem visão) um laudo em texto; custo US$ 0 nas camadas 1 e 2 e ≈ US$ 0,0006 a 0,001 por corte na 3 [inferência; preço visto em busca, páginas oficiais bloqueadas nesta sessão].
> **Esforço:** ≈ 15,5 dias úteis (E0 a E8), ≈ 19 com as duas etapas opcionais; corte mínimo útil de 6 a 7 dias (camada grátis, ferramenta, painel e export) [inferência].
> **Dependências:** nenhuma para E1 a E8; E9 espera a D1 (etapas 1 a 4); B e C só fornecem fixtures e constantes.
> **Principal risco:** alarme falso, com limiares do HF calibrados para motion graphics e não para documentário; depois, o custo do "pensamento" do Gemini, ainda não medido.
> **Decisão principal:** a revisão é uma terceira categoria (ofício), **separada da fidelidade, sem nível `block`** e grátis por padrão; a visão só roda por clique ou opt-in e **sem compor a timeline** na v1.

## 1. Objetivo e valor

**Hoje.** O agente monta (`propose_rough_cut`, `propose_bulk_edit`, que viram ghost clips), o porteiro conta operações para medir *risco de perder material* e o Jev opina sobre *fala importante*. Ninguém olha o resultado nem mede ofício: quadro preto, flash de um quadro, pulo, título que passa rápido demais ou ilegível sobre a imagem só aparecem quando o Fernando assiste ou exporta (PESQUISA 4.9: "o agente propõe cortes mas não os vê").

**Entrega.** Um pacote `src/revisao/` (novo) em quatro camadas, cada uma útil sozinha:

1. **Checagens puras** (sem rede e sem ffmpeg, alvo < 50 ms [a medir]): flash por duração, buraco de vídeo e de áudio, repetição da fonte, título curto para ler, texto pequeno, fora da área segura, jump cut por tempo e similaridade.
2. **Quadros** (FFmpeg nos proxies): janela de ±0,25 s por corte, tira de 5 quadros, flash, preto e pulo medidos nos pixels, contraste WCAG do texto sobre o quadro.
3. **Visão** (modelo já configurado, só sob pedido): tiras em lote, checklist, achados estruturados, cache e teto de custo.
4. **Superfícies**: ferramenta `revisar_cortes`, revisão automática após cada proposta (camada 1, grátis), painel com "Ir", marcas na régua, selo nos ghost clips e seção "Revisão" no export, **separada** do banner de fidelidade e **sem bloquear**.

**Valor.** Achar o defeito em segundos, antes do export (minutos) e antes de aceitar a proposta; dar ao agente o laudo de um olho que ele não tem (o agente padrão é DeepSeek, que não lê imagem, `src/config.py:62-63`); custo perto de zero (≈ US$ 0,001 por corte na camada 3 [inferência], zero nas outras). Princípio herdado do HF: medir antes de olhar; onde número e olho divergem, vale o número (HF:skills/hyperframes/references/review.md §1).

**Fora do escopo.** Crítica de dramaturgia, correção automática, bloqueio do export, qualquer mudança no player ou no grafo FFmpeg.

## 2. Estado atual no Talho
Marcas: **[lido]** conferido no código · **[inferência]** dedução minha · **[a medir]** precisa de teste prático · **[web: URL]** fonte externa · "(novo)" = nome proposto por mim. Caminhos sem prefixo são do Talho (28/10/2026); `HF:` = HyperFrames v0.8.185 (lido, nunca executado). Tudo da tabela é **[lido]**.

| Tema | Onde | O que importa para H |
|---|---|---|
| 17 ferramentas do agente | `src/services/chat_agent.py`: `:631` get_timeline_state, `:639` search_media, `:654` get_transcript, `:670` analyze_coverage, `:678` insert_clip, `:712` move_clip, `:728` delete_clip, `:743` trim_clip, `:759` split_clip, `:774` set_av_offset, `:789` add_effect, `:805` propose_bulk_edit, `:841` propose_rough_cut, `:892` analisar_audio, `:912` sugerir_tratamento_audio, `:931` aplicar_tratamento_audio, `:971` ajustar_audio_ao_vivo; `TOOLS` fecha em `:1009` | Schema `{"type":"function","function":{name,description,parameters}}`. Nenhuma ferramenta mostra imagem ao agente. As de áudio têm conjunto (`FERRAMENTAS_AUDIO` `:621`) e despachante (`_despachar_ferramenta_de_audio` `:1395`): `revisar_cortes` segue esse molde |
| Laço do agente | `chat_with_agent` `:1751`; `max_steps` `:1883`; cadeia `if func_name == …` de `:1943` a `:2247`; resultado é `str` devolvida como mensagem `tool` (`:2249-2255`) | A ferramenta nova devolve JSON compacto em texto; imagem nunca volta ao modelo do agente |
| Cópia-sombra | `TimelineShadowCopy` `:20`; clipes conformados `:28-40`: id, video_id, in, out, timeline_start, track, link_id, effects, alternatives, origin | Sem velocidade, sem texto, sem estilo: para propostas projeto as operações em itens; para a timeline real uso a sequência do banco (`_contexto_preflight`, `src/api/routes/narrative.py:1095`) |
| Porteiro | `evaluate_safety_gatekeeper` `:1418-1491`: conta INSERT/REPLACE/DELETE; `requires_confirmation` sempre `True` | Mede risco de perder material, não qualidade. H **não toca** em `risk_level` |
| Jev | `segunda_opiniao_jev` `:1493`; `src/services/system1_service.py:502` (só DELETE/REPLACE, lê palavras da `transcript`); `agent.jev_audit` padrão `False` (`src/services/settings_registry.py:684`) | Precedente: "só sobe, nunca baixa" e opt-in por custo. H copia o opt-in |
| Rough cut | `build_rough_cut_operations` `:1572`; `parse_and_orchestrate_rough_cut` `:1628` (heurística offline: cortes de 4 a 12 s); ferramenta `:2226`; caminho sem chave `:1773-1812` | Ganchos para revisar a proposta: `:1780` (offline) e `:2279` (fim do laço) |
| Ghost clips | back: `suggestions_output` `:2307-2347` (id, action, video_id, in, out, track, rationale, alternatives, origin); front: `setGhostSuggestions` `src/ui/js/timelineState.js:5307` (mapeia campos fixos: perde qualquer campo novo), `drawGhostClips` `src/ui/js/timelineRenderer.js:3010`, popup `src/ui/js/timelineInteraction.js:13443` (mostra só `ghost.reason`), `syncPlayerToClip` `:1917`, `src/ui/js/chat.js:280-296` | Acrescentar `achados` ao ghost, selo no desenho e lista no popup; o "Ir" já tem como mover o player |
| Card de diff | `render_diff_summary_card` `:1514`; usado em `:1781` e `:2357` (HTML com estilos inline e botões Aplicar/Descartar) | Uma linha "Revisão: N avisos" no card |
| Visão | `src/vision/multimodal_engine.py:51` `call_openrouter_vision` (1 imagem, prompt fixo de foto de set, timeout 20 s, `CONFIG.VISION_MODEL` `src/config.py:56` = `google/gemini-2.5-flash`); configurações `llm.vision_model` `:121`, reserva `:133`, `vision.max_retries` `:143`, `vision.timeout` `:466`, `vision.max_tokens` `:473` | Reuso de modelo, chave e reserva; a chamada nova leva várias imagens e pede JSON |
| Agente só texto | `AGENT_MODEL` `src/config.py:74` = `deepseek/deepseek-v4.1-flash`; comentário `:62-63`: nenhum modelo DeepSeek aceita imagem na OpenRouter | Quem enxerga é o modelo de visão; o agente lê o laudo |
| CLIP | `src/search/image_semantic.py:19-23` (ViT-B/32, 512d), coleção `capiau_images` `:37`, `index_video_keyframe` `:112` (1 vetor por segmento; payload start_time/end_time/shot_scale), `_video_keyframes` `:264` (vetores, limite 500); `video_keyframe` (`src/db/schema.py:275`) guarda só descrição | Vetores só no Qdrant, que já apareceu corrompido (`docs/proximos_chats/04_busca_objeto_A_D.md`, regras). Similaridade vem do Qdrant ou de quadros extraídos |
| Preflight | `_contexto_preflight` `narrative.py:1095` ("barato de propósito… nenhum ffprobe, nenhum decode, nenhum ffmpeg"), rota `:1179`; `fidelidade.py:1-19` (FIDELIDADE = motor, ESCOPO = editor), `_aviso` `:68` (nível block/warn), `relatorio` `:97`; painel `src/ui/js/exportVideo.js`: debounce 600 ms `:95`, `aplicarPreflight(...)` `:767`, `_renderizarBanner` `:960`, bloqueio por `nivel === "block"` `:1030` | A revisão **não entra** nessa rota (ela roda a cada clique em escopo). Terceira categoria, ao lado das duas |
| Sequência | `src/export/video_render/modelo.py`: `Pista` `:81`, `Clipe` (inicio_s, in_s, out_s, velocidade, reverso, congelado, `bruto` do título `:133`, kind, blend_mode), `trecho_fonte` `:157` | O mapa tempo da timeline → tempo da fonte já existe; reaproveito |
| Proxies | `src/config.py:112`, `:121-123` (720p, CRF 23, preset fast); `caminho_proxy_video` `src/export/video_render/midia.py:99`; `extract_frame_ffmpeg` `multimodal_engine.py:13` (1 quadro por processo) | Tiras saem dos proxies, 1 processo por lado do corte |
| Régua e guias | `markers` `timelineState.js:423`, `drawMarkers` `timelineRenderer.js:1448`; guias Action Safe 90 % e Title Safe 80 % `src/ui/js/playerTextOverlay.js:53-62` | Camada transitória de achados; os 80 % do título já são a referência visual do editor |
| Títulos | `src/export/video_render/titulos.py:1-60` (fotografados no Edge/Chrome headless, mesmo código do preview: `tituloRender.js` + `render_titulos.html`); plano D1 §7.1 (`Pagina.capturar`) | Caixa real do texto só com navegador (etapa 9, opcional) |

**Invariantes que H respeita**

- **Regra de Ouro**: nada muda a timeline real sem clique (`requires_confirmation` `:1418+`, `final_cuts: clips if is_preview` `:2371`). H só lê e anota.
- **Preflight barato; FIDELIDADE ≠ ESCOPO** (`fidelidade.py:5-14`): a revisão é uma terceira coisa, de **ofício**. Não existe nível `block` nos achados e `_reavaliarBotoes` (`exportVideo.js:1030`) continua olhando só os avisos de fidelidade.
- **Paridade NLE** (`.agents/rules/nle-parity-and-media-lifecycle.md`): H não toca player nem grafo. Miniaturas no painel são `<img>` de JPEG servido (sem `ImageBitmap`, logo sem `bitmap.close()`). Se a etapa "quadro composto" exigir mudança em `comando.py`, rodar a bateria canônica (`pytest tests/test_render_composicao_multipista_cascata.py`, `node tests/autoteste_composicao_multipista_cascata.mjs`).
- **Decisões do Fernando** (`docs/proximos_chats/README.md`): barato, não offline; nada baixa sozinho; gasto só sob pedido ou opt-in (precedente `agent.jev_audit`).

## 3. O que o HyperFrames tem
Fonte: HyperFrames v0.8.185 (Apache-2.0, "Copyright 2026 HeyGen, Inc."), **lido, nunca executado**. O HF revisa composições HTML que ele mesmo gera; o Talho revisa mídia filmada pelo Fernando. Quase nada vira cópia de código: viram **fórmulas, limiares e método**. Portar = traduzir a conta; Adaptar = mudar limiar ou coleta; Inspirar = só a ideia; Não = fica de fora. Abreviações: `HF:craftAudit.ts` = `HF:packages/cli/src/utils/craftAudit.ts`; `HF:contrast-*` e `HF:snapshot*` = `HF:packages/cli/src/commands/…`.

| Peça do HF | Onde | O que faz | Veredito | Como entra em H |
|---|---|---|---|---|
| Medir antes de olhar; "onde número e olho divergem, vale o número" | `HF:skills/hyperframes/references/review.md` §1 | `check` numérico, depois folhas de contato | Inspirar | Camadas 1 e 2 antes da 3; o prompt de visão recebe os números e a regra de desempate |
| Nota de uma linha `t · onde · problema → mudança exata · o que fica`; P0/P1/P2; "nunca dar nota de 0 a 10" | `review.md` §3 | Achado acionável, sem placar | Adaptar | Campos `t`, `onde`, `msg`, `mudanca`, `preserva`; gravidade `alta/media/baixa` = P0/P1/P2 |
| Nota de entrega: o que foi medido, o que só foi olhado, o que ninguém checou | `review.md` §4 | `REVIEW.md` lido pelo turno seguinte | Adaptar | Campo `nao_verificado` no laudo ("áudio medido, não ouvido"; "etalonagem ignorada") |
| Olhar novo: subagente só com roteiro e folhas | `review.md` §3, último parágrafo | Evita o viés de quem montou | Inspirar | O modelo de visão é esse olhar: recebe mosaicos e números, nunca o raciocínio do agente |
| `line_unread` | `HF:craftAudit.ts:46-56` (pisos), `:392`; limiares `:10-17` | 0,4 s para 1 a 2 palavras; senão 0,75 × (0,5 + 0,3 × palavras); última linha 2 s; só linha ≥ 30 px a 1080 | Portar | `titulo_curto` (3 palavras 1,05 s; 6 palavras 1,73 s: `HF:skills/hyperframes-cli/references/lint-validate-inspect.md:51`); legenda segue a regra de C |
| `text_below_floor` | `HF:craftAudit.ts:439-443`; `typeFloorFraction` `:20` | Texto < 2,6 % do lado menor (28 px a 1080) por ≥ 0,5 s | Portar | `texto_pequeno`, inclusive a sublinha do título a 0,55× (`src/ui/js/tituloRender.js:130`) |
| `first_frame_empty`, `film_silent` | `HF:craftAudit.ts:116`, `:130`; limiar de 15 s em `:22` | Quadro 0 vazio (miniatura); filme > 15 s sem som | Portar | `primeiro_quadro_vazio`, `sequencia_sem_som` |
| `dead_stretch` | `HF:craftAudit.ts:144` | > 3 s sem nada mudar | Não | Plano longo e parado é gramática de documentário |
| Craft = só aviso, mesmo sob `--strict`; varredura de 8 fps do filme todo, fora de `--range` | `lint-validate-inspect.md:50` | Mede cada instante | Portar o aviso; não a varredura | Reforça "nunca bloqueia". Uma hora a 25 fps são 90 mil quadros: H mede por corte e por título |
| Tira no corte `REVIEW_SEAM_OFFSETS = [-0.2, -0.1, 0, 0.1, 0.2]` | `HF:snapshotReview.ts:14`; `seamTimes :182`, `reviewFrames :231` | 5 quadros por corte numa folha | Adaptar | −0,2 s, −1 quadro, 0, +1 quadro, +0,2 s: flash e quadro intruso vivem em 1 quadro (0,04 s a 25 fps) e ±0,1 s passa por cima |
| Folhas de beats e folha a 360 px | `HF:snapshotReview.ts:16`, `:263`; `HF:packages/cli/src/capture/contactSheet.ts` | Legibilidade no celular | Não | A saída é TV, festival, tela; tamanho e contraste são números (4.1, 4.3) |
| Amostragem uniforme com a última amostra dentro do intervalo | `HF:snapshotSampling.ts` (`sampleSnapshotRange`) | Evita amostrar o quadro que já é do próximo clipe | Inspirar | Os 3 instantes do contraste nunca caem no último quadro do título |
| Contraste WCAG: contas | `HF:contrast-bg.ts:24` (luminância), `:34` (razão), `:43` (4,5 ou 3), `:51` (cor conforme mais próxima) | Funções puras, com testes (`contrast-bg.test.ts`, não li) | Portar | `src/revisao/contraste.py` (novo), aviso Apache-2.0 no cabeçalho; a cor sugerida vira `mudanca` |
| Contraste: coleta | `HF:contrast-audit.browser.js:546-603`; `HF:contrast-sample.ts:38,56` | Esconde a pintura do texto, 1 foto, amostra a caixa (recuo 1 px, grade 12×6 `:572`, mediana `:516`) | Adaptar | O truque não serve: o fundo do Talho é o vídeo e o HF **pula** fundo transparente (`:600`). Ficam recuo, mediana, composição do alfa (`:606-610`) e contorno (`:614-627`) |
| "Texto grande" (≥ 24 px, ou ≥ 19 px em negrito) pede 3:1 | `HF:contrast-audit.browser.js:388` | Limiar menor para texto grande | Adaptar | Escalar por altura/1080 |
| `contrast-fg.ts` (`fill` do SVG) | `HF:contrast-fg.ts` | Cor de texto SVG | Não | Sem SVG no Talho |

Licença: fórmulas Apache-2.0 em projeto GPLv3 são compatíveis (via única) [inferência; não é parecer jurídico]. Mantenha o aviso de origem no cabeçalho dos arquivos portados.

## 4. Verificações de viabilidade
Cada subseção responde a uma pergunta do pedido. O que depende da máquina do Fernando fica **[a medir]** e entra na Etapa 0 (seção 8). B, C e D1 = `B_regressao_render.md`, `C_legendas.md`, `D1_navegador.md`. Rede: `openrouter.ai` e `ai.google.dev` não resolvem nesta sessão (rede restrita); preços e tokens vêm de resultados de busca e precisam ser conferidos nas páginas oficiais.

### 4.1 Checagens determinísticas e baratas

**Veredito: viável, grátis e entra primeiro.** Oito de dez saem só da sequência (sem rede, sem ffmpeg, sem decodificar), em O(n log n). Base comum: achatar a sequência na **camada visível** (para cada instante, o clipe de vídeo da pista de menor `ordem` que não esteja oculta, `src/export/video_render/modelo.py:81-98` [lido]; clipe com `blend_mode` ≠ normal ou camada de ajuste não esconde o de baixo [inferência]) e levar os tempos à fonte por `Clipe.trecho_fonte` (`modelo.py:157`, trata velocidade, reverso e congelado [lido]). `titulo_curto`, `texto_pequeno`, `fora_area_segura` e `contraste_baixo` só rodam na timeline real: a cópia-sombra do agente não guarda texto nem estilo (`chat_agent.py:28-40` [lido]).

| Checagem (código) | Dados que o Talho já tem [lido] | Algoritmo | Custo | Falso positivo → mitigação |
|---|---|---|---|---|
| Flash (`flash`) | Intervalos da camada visível, fonte de cada um, fps da sequência | Trecho visível ≤ 3 quadros (`revisao.flash_quadros`) com fonte diferente da dos dois vizinhos: alta se 1 quadro, média se 2 a 3 | O(n) | Montagem rítmica de propósito → se os vizinhos também têm ≤ 12 quadros, vira baixa |
| Buraco de vídeo e quadro 0 vazio (`buraco_video`, `primeiro_quadro_vazio`) | Os mesmos intervalos; `color_matte` conta como imagem (`Clipe.kind`) | Intervalo sem camada visível entre o primeiro e o último clipe, ≥ 1 quadro: alta se < 0,5 s (sobra de ripple), média se ≥ 0,5 s; quadro 0 sem nada: baixa (miniatura, `HF:craftAudit.ts:116`) | O(n) | Respiro antes de título → "Ignorar" persiste (6.3) |
| Buraco de áudio e sequência muda (`buraco_audio`, `sequencia_sem_som`) | `Pista.muted`, `volume`, `link_id` (`modelo.py:81-98`) | Trecho ≥ 1 s com imagem e sem áudio audível enquanto o resto tem som: baixa (1 a 3 s) ou média (> 3 s); sequência > 15 s sem áudio audível: alta (`HF:craftAudit.ts:130`). Medido (camada 2): silêncio dentro do clipe, reaproveitando o parser de ebur128 de `src/media/audio_analysis.py:1` (série de 100 ms) [a conferir o formato de `resumir_serie`] | O(n); medido ≈ 1 passe de áudio por clipe [a medir] | Pausa dramática, ausência de "room tone" → baixa e ignorável |
| Trecho da fonte repetido (`repeticao_fonte`) | `video_id`, `in_s`, `out_s`, `velocidade` | Por fonte, ordenar por `in_s` e varrer sobreposições entre trechos **visíveis** em posições distintas; ignora o par V+A do mesmo `link_id`, `congelado` e fotos; sobreposição ≥ máx(0,5 s; 25 % do menor): média; ≥ 90 % do menor: alta | O(n log n) | Imagem de arquivo repetida de propósito → média por padrão. Pega o erro típico do agente: puxar o mesmo take duas vezes |
| Jump cut (`jump_cut`) | Camada visível; vetores CLIP por keyframe (`src/search/image_semantic.py:112,264`; payload `start_time`/`end_time`) | Dois trechos visíveis consecutivos, **mesma pista e mesma fonte**, salto na fonte `0 ≤ in_B − out_A ≤ 2,0 s` (`revisao.jump_gap_s`), sem transição no corte: baixa só pelo tempo; média se o cosseno dos vetores vizinhos ≥ 0,92 [a medir]; o pixel (4.2) confirma | O(n); Qdrant: 1 `scroll` por fonte (limite 500) | Corte de pausa em entrevista é rotina em documentário → baixa e ignorável; B-roll por cima já some (só entra o consecutivo visível). Vetores são **por keyframe** (≈ 1 a cada 10 s, `FRAME_INTERVAL` `src/config.py:124`): dizem "mesmo plano?", não medem o corte |
| Título curto (`titulo_curto`) | Texto, `duracao_s`, opacidade em `bruto` (`modelo.py:133`) | Palavras = sequências de letras e números; piso 0,4 s (≤ 2 palavras), senão 0,75 × (0,5 + 0,3 × palavras); última linha 2 s; só se a fonte ≥ 2,8 % da altura (`HF:craftAudit.ts:10`). Legenda (bloco `legenda` de C): `legendas.max_cps` 17, `dur_min_s` 0,83, `dur_max_s` 7 (`C:268`), mesmos padrões se C ainda não existir | O(n) | Título de efeito com 1 palavra: o piso de 0,4 s já cobre |
| Texto pequeno (`texto_pequeno`) | `fontSize` (padrão 36, `tituloRender.js:23`), escala do `transform`, altura do quadro; sublinha = máx(12; 0,55 × tamanho) (`:130`) | Tamanho efetivo < round(0,026 × lado menor) (28 px a 1080, 19 px a 720) por ≥ 0,5 s: média; < 2,0 %: alta [inferência] | O(n) | Texto decorativo pequeno → o corte de 2,8 % já o isenta |
| Fora da área segura (`fora_area_segura`) | Guias 90 % e 80 % (`src/ui/js/playerTextOverlay.js:53-62`); `x`, `y`, `scale` (`estadoTitulo`, `tituloRender.js:15-26`); `maxWidth` 90 % (`:96`); fontes por família (`titulos.py:123`) | Caixa **estimada**: Pillow mede o texto com a mesma TTF, quebra a 90 % da largura, altura = linhas × 1,2 × fonte; fora do Title Safe 80 %: média; fora do Action Safe 90 % ou cortado: alta; folga de 2 % da largura | O(n); ≈ 1 ms por título [a medir] | Estimativa errada na borda (fonte padrão `Outfit`/`Inter`, `tituloRender.js:83`, pode não estar em arquivo) → folga de 2 %; caixa real pelo navegador na Etapa 9 (D1, `pg.avaliar`) |
| Contraste (`contraste_baixo`) | Quadro do proxy sob a caixa | 4.3 | ≈ 3 quadros por título | 4.3 |
| Pixel no corte (`quadro_preto`, `quadro_intruso`, `corte_invisivel`, `desfoque`) | Proxies | 4.2 (camada 2) | 2 processos ffmpeg por corte | 4.2 |

Custo total da camada 1: **< 50 ms para 500 clipes** [a medir], nenhum ffmpeg, nenhuma rede. O cosseno do `jump_cut` é opcional (Etapa 8) e cai para "só pelo tempo" se o Qdrant falhar (já apareceu corrompido, `docs/proximos_chats/04_busca_objeto_A_D.md`). O que se resolve com número não vai para a visão (`review.md` §1).

### 4.2 Revisão visual pelo modelo de visão

**Veredito: viável e barata (≈ US$ 0,0006 a 0,001 por corte), mas só por clique ou opt-in. As fontes bastam; não compor a timeline na v1.**

- **Tiras.** Proxy 720p H.264 CRF 23 (`src/config.py:121-123`), caminho `caminho_proxy_video` (`src/export/video_render/midia.py:99`); `extract_frame_ffmpeg` (`src/vision/multimodal_engine.py:13`) tira 1 quadro por processo com `-ss` antes de `-i` [lido]. Por corte, 2 processos (lado que sai, lado que entra), 2 e 3 JPEGs a 384 px nos tempos −0,2 s, −1 quadro, 0, +1 quadro, +0,2 s, levados à fonte por `trecho_fonte`: velocidade, reverso e congelado aparecem como o export mostrará. Se a seleção por índice errar um quadro, cai para 1 processo por quadro (custo ×2,5); o teste do código de barras decide (seção 9). Estimativa: 0,3 a 0,5 s por corte com 1 fio, ≈ 0,1 s com 3 fios [a medir]; abrir processo no Windows já custa 50 a 100 ms [inferência]. O Talho limita conversões a 2 fios (`config.py:120`): H usa 3 e é cancelável.
- **Mosaico e checklist.** 5 quadros numa grade 3×2 de 384×216 (a 6ª célula é a legenda: nº do corte, tempo, números medidos) = 1152×432, JPEG q80 ≈ 60 KB. Lote de 6 mosaicos por requisição, no formato de `call_openrouter_vision` (`multimodal_engine.py:51`: texto + `image_url` base64), **mas com `max_tokens`**: sem ele a OpenRouter reserva crédito contra o teto de saída do modelo inteiro e recusa com 402 (achado de 17/07 em `settings_registry.py:473-480` [lido]). Roteiro em português: (1) uma frase por quadro "como um estranho descreveria" (`review.md` §2); (2) checklist por corte: quebra de eixo, olhar, pulo, quadro preto/branco/intruso, desfoque, repetição, enquadramento (cabeça cortada, horizonte); (3) JSON `{corte, antes, depois, achados:[{tipo, gravidade, quadros, descricao, mudanca, confianca}]}`; (4) "números medidos prevalecem; não dê nota; sem problema = lista vazia". Só passa achado com `confianca ≥ 0,5`.
- **Compor ou não?** Fontes bastam para ghost clips: o ghost não existe no banco, só `video_id`, `in` e `out` (`chat_agent.py:2334-2347`). Para a timeline montada, **não compor na v1**: o que o checklist procura vive na imagem da fonte nos dois lados do corte; texto e efeito têm checagem numérica (4.1, 4.3); compor exige `montar_comando` por janela (1 a 3 s por corte, linha de comando longa no Windows [a medir]) e abre divergência com o player. Limite assumido: dissolve e camada de ajuste não aparecem (`nao_verificado`). A composição vira a Etapa 10, só se a Etapa 0 mostrar achado perdido.
- **Preço (Gemini 2.5 Flash, `src/config.py:56`).** US$ 0,30 por milhão de tokens de entrada e US$ 2,50 de saída [web: https://openrouter.ai/blog/gemini-25-flash-api-pricing-quickstart-provider-comparison, repetido por agregadores; a página oficial não abre aqui: conferir em `openrouter.ai/google/gemini-2.5-flash`]. Imagem: 258 tokens se as duas dimensões ≤ 384 px; maiores são cortadas em ladrilhos de 768×768, 258 tokens cada [web: https://ai.google.dev/gemini-api/docs/tokens]; a conta para 1152×432 (2 ladrilhos = 516) é [inferência] e o `usage` da resposta decide. Pensamento é cobrado como saída [web: https://www.openrouter.ai/docs/guides/best-practices/reasoning-tokens]; um resumo de busca diz que, sem o campo `reasoning`, o pensamento fica desligado na OpenRouter: **não confirmei**, ler `completion_tokens` na Etapa 0.

| Por corte (lote de 6) | Tokens | US$ |
|---|---|---|
| Mosaico 384 px (2 ladrilhos) [inferência] | 516 | 0,00015 |
| Texto do corte + 1/6 do roteiro fixo (≈ 450) [inferência] | ≈ 135 | 0,00004 |
| Saída: 2 frases + 0 a 2 achados em JSON [inferência] | ≈ 150 | 0,00038 |
| **Total sem pensamento** | ≈ 800 | **≈ 0,0006** |
| Com pensamento (≈ 1000 por lote ÷ 6) [inferência] | + 170 | **≈ 0,001** |
| Mosaico 256 px (1 ladrilho) em vez de 384 | −258 | −0,00008 (13 % mais barato: o padrão fica 384) |

12 cortes (rough cut de 3 min) ≈ US$ 0,007 a 0,012; 40 cortes ≈ 0,024 a 0,04; 200 cortes ≈ 0,12 a 0,2.

- **Cache e teto.** Chave = sha1(modelo + versão do roteiro + bytes do mosaico + números medidos): corte que não mudou custa zero na segunda revisão (`revisao_cache`, 6.3). Teto por revisão: `revisao.visao_max_cortes` 30 e `revisao.visao_teto_usd` 0,10; estourou → para, marca `truncado` e lista os cortes não vistos. Com mais cortes que o teto, a ordem é: cortes com achado da camada 1, fontes diferentes, depois cronológica. A estimativa aparece **antes** do clique (conta acima, com `revisao.preco_*` editáveis); o gasto real vem de `usage`. Resposta inválida: 1 nova tentativa com o lote partido ao meio; falhou de novo = achado `info` "revisão visual falhou", nunca exceção.

### 4.3 Contraste WCAG do texto sobre o quadro real

**Veredito: versão simples (numpy sobre o quadro do proxy); portar as contas do HF, não o método.**

- **Por que não portar o método.** O HF esconde a pintura do texto e fotografa a própria página, cujo fundo é HTML (`HF:contrast-audit.browser.js:546`); quando o fundo é transparente (vídeo que o editor coloca depois) ele **pula** o texto (`:600`, comentário "supplied by the downstream editor") [lido]. O Talho é esse "editor depois": o título é fotografado transparente (`src/export/video_render/titulos.py:10`) e o FFmpeg o cola no vídeo; o fundo só existe no quadro do proxy. A linha da D1 (`D1:395`: `pg.capturar(alfa=False, formato="jpeg", recorte=caixa)` com o texto escondido) só se justifica se o quadro entrar na página como `<img>`; para H basta `pg.avaliar` (caixas, sem foto), na Etapa 9.
- **Algoritmo.** (1) Três instantes por título: 10 %, 50 % e 90 % do tempo visível (ideia de `HF:snapshotSampling.ts`). (2) Por instante, o quadro do proxy da camada visível sob o título (via `trecho_fonte`), 320×180 RGB. (3) Caixa estimada (4.1) recuada 1 px (`HF:contrast-sample.ts:38`). (4) Luminância relativa por pixel (tabela de 256 entradas; `HF:contrast-bg.ts:24`). (5) Cor do texto = `clip.color` (`tituloRender.js:88`) com a opacidade do instante composta sobre cada pixel (como `HF:contrast-audit.browser.js:606-610`); razão por pixel `(Lmáx + 0,05) / (Lmín + 0,05)`. (6) Relata **mediana** (como o HF, `:516`) e **pior quartil**: vídeo é ruidoso e a mediana esconde a metade da caixa que some no céu. (7) Mínimo 4,5; 3,0 se "grande" (≥ 24 px, ou ≥ 19 px em negrito, a 1080 e escalado por altura/1080, `:388`; os títulos de 36 px quase sempre são "grandes").
- **Gravidade [inferência, calibrar na Etapa 0].** Mediana abaixo do mínimo: média; mediana < 2,0: alta; só o pior quartil abaixo: baixa. Título com caixa de fundo opaca (`temCaixa`, `tituloRender.js:46-49`): razão texto × caixa, **sem quadro**; caixa translúcida: compõe sobre o quadro. Sombra ou contorno rebaixam um nível (WCAG ignora sombra; o HF só conta contorno sólido, `:614-627`). A cor conforme mais próxima (`HF:contrast-bg.ts:51`) vira `mudanca`: "cor do texto #C8C8C8 → #FFFFFF (3,1 → 7,2)" ou "ligar a caixa".
- **Legendas.** Os predefinidos de C trazem caixa ou contorno; com caixa opaca não há quadro. Sem proteção, amostra no máximo 40 legendas por revisão, espaçadas, e declara "amostrado 40 de 312" em `nao_verificado`.
- **Limites.** O proxy não tem etalonagem nem camada de ajuste (`Clipe.kind`, `blend_mode`, `modelo.py`): se uma cobre o instante, o resultado sai **aproximado** e nunca "alta". Custo: 3 quadros por título ≈ 0,3 s; 20 títulos ≈ 2 s com 3 fios [a medir]. **Basta para GCs e legendas: sim.**

### 4.4 Como os achados aparecem

**Veredito: viável com pouco código novo, porque ghost clips e régua já existem; o ponto frágil é `setGhostSuggestions`, que copia campos fixos e perderia `achados`.**

| Superfície | Como | Onde mexe | Detalhe |
|---|---|---|---|
| Painel "Revisão" | Lista por gravidade e tempo; cada linha: ponto colorido, tempo, código, frase e botões **Ir** (leva o playhead ao quadro do achado; em achado de ghost, também seleciona o ghost), **Ver tira** (`<img>` do JPEG em `GET /api/revisao/quadro/{chave}`) e **Ignorar** (`revisao_ignorado`) | `src/ui/js/revisao.js` (novo) | Não abre sozinho (regra de interface do repositório), só mostra o contador. Fica cinza, com "Revisar de novo", em qualquer evento de mudança da timeline. Tudo por `textContent`: o popup do ghost injeta `ghost.reason` cru em `innerHTML` (`timelineInteraction.js:13469` [lido]) e o texto do modelo não é confiável |
| Marcas na régua | Triângulos por gravidade; clique = Ir. Camada transitória `TIMELINE_STATE.achadosRevisao` (novo), **fora** de `markers` (`timelineState.js:423`: salvos, com undo e comentário do Fernando) | `timelineRenderer.js` junto de `drawMarkers :1448`; cores `ghostRedBorder`/`ghostAmberBorder` já existentes | Hit-test na faixa da régua |
| Selo no ghost | Círculo no canto superior direito do ghost, com a contagem, na cor do pior achado (só se o retângulo tiver ≥ 24 px); achado de junção causada por um DELETE vai no ghost de DELETE | `drawGhostClips :3010`; `setGhostSuggestions :5307` ganha `achados: Array.isArray(s.achados) ? s.achados : []` | Sem essa linha o campo se perde |
| Lista no popup | Até 4 achados depois de `ghost.reason`, com "ver todos" (abre o painel) | `showGhostActionsPopup :13443` | |
| Card de diff | "Revisão: 3 avisos (1 alta)" | `render_diff_summary_card`, `chat_agent.py:1514` | Só a contagem |
| Ferramenta `revisar_cortes` | Texto JSON compacto para o agente (DeepSeek, sem imagem): `{resumo, camada, achados:[{id,t,cod,g,onde,msg,mudanca,preserva}], nao_verificado, custo_usd}`, até 40 achados | `FERRAMENTAS_REVISAO` (novo) ao lado de `chat_agent.py:621`; definição depois de `:971`; despacho nos moldes de `_despachar_ferramenta_de_audio :1395` | Schema abaixo |

```python
{   # entra em TOOLS; o nome também vai em FERRAMENTAS_REVISAO (novo)
    "type": "function",
    "function": {
        "name": "revisar_cortes",
        "description": (
            "Revisa o OFICIO da montagem (nao o risco de perder material: isso e do porteiro). "
            "Camada 'barata' (padrao, gratis, ms): flash de 1 a 3 quadros, buraco de video/audio, trecho da fonte "
            "repetido, jump cut, titulo curto demais, texto pequeno, fora da area segura. 'quadros': mede pixels dos "
            "proxies nos cortes e o contraste do texto. 'visao': manda mosaicos ao modelo de visao (custa; so roda se "
            "o editor liberou). Somente leitura. Cada achado e uma pergunta: proponha a correcao, nao aplique."),
        "parameters": {
            "type": "object",
            "properties": {
                "alvo": {"type": "string", "enum": ["propostas", "timeline"],
                         "description": "propostas = ghost clips recem-sugeridos; timeline = sequencia ativa."},
                "camada": {"type": "string", "enum": ["barata", "quadros", "visao"]},
                "de_s": {"type": "number", "description": "Inicio do trecho (s da timeline)."},
                "ate_s": {"type": "number", "description": "Fim do trecho (s da timeline)."},
                "codigos": {"type": "array", "items": {"type": "string"},
                            "description": "Limita a estes codigos, ex.: ['flash','jump_cut']."}
            },
            "required": []
        }
    }
},
```

### 4.5 Onde e quando roda

**Veredito: três gatilhos e uma regra fixa: a revisão informa e nunca bloqueia.**

| Gatilho | Camadas | Custo | Quem dispara | Onde aparece |
|---|---|---|---|---|
| Depois de `propose_rough_cut`/`propose_bulk_edit` (ganchos `chat_agent.py:1780`, offline, e `:2279`, fim do laço) | 1 | Grátis, ms | Automático (`revisao.auto_barata`) | Selo, popup, card. Só o que a proposta **introduz**: compara com um instantâneo de `serialize_cuts_to_frontend()` tirado no começo do laço (`:1751`). Falha da revisão nunca derruba a proposta (`try/except`) |
| Botão "Revisar" (painel e seção do export) | 1 e 2; a 3 com a estimativa de custo à vista | Segundos; US$ 0 ou a estimativa | Clique | Painel e régua |
| Ferramenta `revisar_cortes` | 1 e 2; a 3 só com `revisao.visao_pelo_agente` ligado | Idem | O agente, a pedido | Texto para o agente e painel |
| Seção "Revisão" no export | Mostra a última revisão desta sequência (por hash) ou "Não revisado" | 0 | Abrir o modal | Contagens por gravidade, "Abrir lista", "Revisar agora" |

A seção do export fica **abaixo do banner de fidelidade e separada dele** (`exportVideo.js` `_renderizarBanner :960`); `_temBloqueio` e `_reavaliarBotoes` (`:1030`) continuam lendo só `preflight.avisos`. Não existe nível `block` nos achados. **Não roda na rota de preflight** (`narrative.py:1179`): ela dispara a cada clique de escopo com atraso de 600 ms (`exportVideo.js:95`) e é "barata de propósito" (sem ffmpeg, `narrative.py:1095`).

## 5. Decisões de projeto
| # | Decisão | Alternativas | Recomendação | Por quê |
|---|---|---|---|---|
| 1 | Onde mora a lógica | Python (`src/revisao/`); JS no front; híbrido | **Python puro; o JS só desenha** | A ferramenta do agente roda no servidor sem DOM; pytest com dados falsos; limiares num lugar só |
| 2 | Fonte dos pixels | Proxies pela sequência; quadro composto por `montar_comando`; captura do Program no navegador | **Proxies** (composto só na Etapa 10, se a Etapa 0 provar perda) | Rápido, não toca o grafo; o ghost só existe como fonte |
| 3 | Quadros da tira | HF ±0,1 s; 5 quadros (−0,2 s, −1q, 0, +1q, +0,2 s) | **Os 5, com ±1 quadro** | Flash e quadro intruso vivem em 1 quadro |
| 4 | Quem chama a visão | Automático após propor; o agente; só o clique | **Clique sempre; agente só com `revisao.visao_pelo_agente`; nunca automático** | Precedente `agent.jev_audit` (`settings_registry.py:684`) e decisão do Fernando: gasto só sob pedido |
| 5 | Imagem ao modelo | 1 mosaico 3×2 por corte; 5 imagens por corte; vídeo curto | **1 mosaico de 384 px** | Imagem é barata (258 tokens por ladrilho); a saída é que custa; vídeo não testado |
| 6 | Contraste | Método do HF no navegador; numpy no quadro do proxy | **numpy** | 4.3: o método do HF não enxerga o vídeo |
| 7 | Vocabulário | P0/P1/P2; alta/média/baixa; nota | **alta/média/baixa; sem nota; sem `block`** | `review.md` §3; a revisão nunca bloqueia |
| 8 | Persistência | Achados no banco; transitórios e cache das camadas caras | **Transitórios; cache só de quadros e visão; "Ignorar" persiste** | A camada 1 custa ms; não há o que migrar |
| 9 | Revisão de proposta | Mostrar tudo; só o que a proposta introduz | **Selo e card: só o novo; painel: tudo, com rótulo "já existia"** | Não culpar o agente por defeito antigo |
| 10 | Falha da revisão | Propagar; silenciar | **Registrar no log e seguir** | H só lê e anota; nunca derruba proposta nem export |
| 11 | Constantes de legenda | Duplicar em H; ler de C (`legendas.*`) | **Ler de C, com os mesmos padrões se C não existir** | Um número, um lugar |

## 6. Modelo de dados e compatibilidade
**6.1 Achado** (`Achado` em `src/revisao/modelos.py` (novo); a mesma forma em JSON na rota, na ferramenta e no ghost).

```json
{"id": "r7", "cod": "flash", "gravidade": "alta", "camada": 1, "origem": "proposta",
 "t": 12.4, "fim": 12.44, "quadro": 310, "pista": "V1", "clips": ["cut_8"],
 "msg": "Plano de 1 quadro (0,04 s) entre planos de outras fontes.",
 "mudanca": "apagar ou estender para ≥ 0,5 s", "preserva": "o resto da cena",
 "medido": {"quadros": 1, "limite": 3}, "confianca": 1.0, "tira": "rv_ab12.jpg"}
```

**6.2 Códigos e laudo.** `cod` nas camadas 1 e 2: `flash`, `buraco_video`, `primeiro_quadro_vazio`, `buraco_audio`, `sequencia_sem_som`, `repeticao_fonte`, `jump_cut`, `titulo_curto`, `texto_pequeno`, `fora_area_segura`, `contraste_baixo`, `quadro_preto`, `quadro_intruso`, `corte_invisivel`, `desfoque`; na 3: `quebra_eixo`, `olhar`, `pulo`, `enquadramento`, `repeticao_visual`, `outro`. `origem`: `timeline` ou `proposta`. Laudo (resposta da rota): `{resumo, camada, achados[], nao_verificado[], cortes_revisados, cortes_total, truncado, custo_usd, sequencia_hash}`.

**6.3 Tabelas novas** (`CREATE TABLE IF NOT EXISTS` no fim do esquema, padrão de `src/db/schema.py:457`; nenhuma coluna existente muda):

| Tabela (novo) | Colunas | Uso |
|---|---|---|
| `revisao_cache` | `chave` TEXT PK, `camada`, `json`, `tokens_in`, `tokens_out`, `custo_usd` REAL, `criado_em` | Camadas 2 e 3. A 3 custa dinheiro: guardar 180 dias; o resto, 30 |
| `revisao_ignorado` | `id`, `timeline_id`, `cod`, `assinatura` (código + clipes + tempo arredondado a 0,5 s), `motivo`, `criado_em`; UNIQUE (`timeline_id`, `cod`, `assinatura`) | "Ignorar" persistente, o análogo do `data-hold` do HF (`lint-validate-inspect.md:68`) |

Arquivos em `CONFIG.CACHE_DIR / "revisao"` (`src/config.py:113`, padrão de `WAVEFORMS_DIR :114`): tiras e mosaicos JPEG, teto de 300 MB, apaga o que passa de 30 dias.

**6.4 Configurações** (registro `settings_registry.py`, categoria `agent_chat`, nível `pro`, `requires_reprocess: False`, no molde de `agent.jev_audit :684`):

| Chave (novo) | Tipo e padrão | Efeito |
|---|---|---|
| `revisao.auto_barata` | bool, `True` | Revisão grátis depois de propor |
| `revisao.visao_pelo_agente` | bool, `False` | Deixa o agente chamar a camada 3 |
| `revisao.visao_max_cortes`, `revisao.visao_teto_usd` | int 30; float 0,10 | Teto por revisão |
| `revisao.visao_tile_px`, `revisao.visao_confianca_min`, `revisao.visao_max_tokens` | int 384 (ou 256); float 0,5; int 2400 | Mosaico, filtro de confiança, `max_tokens` do lote |
| `revisao.preco_in_usd_mi`, `revisao.preco_out_usd_mi` | float 0,30; float 2,50 | Estimativa de custo (preço editável) |
| `revisao.flash_quadros`, `revisao.jump_gap_s`, `revisao.piso_texto_pct` | int 3; float 2,0; float 2,6 | Limiares da camada 1 |
| `revisao.contraste_min_normal`, `revisao.contraste_min_grande` | float 4,5; float 3,0 | Limiares WCAG |

**6.5 Compatibilidade.**

- Banco: só tabelas novas; bancos antigos sobem sem migração; apagar as duas tabelas e a pasta não perde nada do Fernando.
- Projeto e timeline: nada é gravado no arquivo do projeto; achados são transitórios e o undo/redo não os vê.
- Ghost: `achados` é opcional; front antigo ignora; back novo funciona com front antigo (sem selo).
- Conversas do agente: a ferramenta só **acrescenta** um nome; conversas antigas ficam intactas; o resultado é texto de até 40 achados e a janela `agent.history_window` (6 mensagens, `settings_registry.py:677`) descarta o excesso; imagem nunca volta ao DeepSeek.
- Configurações: padrões seguros (visão desligada para o agente, teto ligado); quem nunca abrir a tela não vê diferença. O cache se invalida por `ROTEIRO_VERSAO` (novo): trocar o prompt não reaproveita resposta velha.

## 7. Mudanças por arquivo
| Arquivo | Mudança | Etapa | Risco |
|---|---|---|---|
| `src/revisao/modelos.py` (novo) | `Achado`, `Laudo`, `ItemRev`, `ContextoRev`, `Limiares` (padrões de 6.4) | E1 | Baixo |
| `src/revisao/sequencia.py` (novo) | Adaptadores: sequência do banco (molde de `_contexto_preflight`, `narrative.py:1095`) e `TimelineShadowCopy` → `ItemRev`; `camada_visivel()` | E1 | Médio: mapear campos reais (`bruto` do título, fps) |
| `src/revisao/regras.py` (novo) | As regras puras de 4.1 | E1 | Baixo |
| `src/revisao/servico.py` (novo) | Orquestra as camadas, compara proposta × antes, tira os ignorados, monta o laudo | E2 | Baixo |
| `src/revisao/quadros.py`, `medidas.py` (novo) | Tiras (ffmpeg, 3 fios, cancelável), cache de JPEG, preto/intruso/corte invisível/desfoque com numpy (`requirements.txt:19`) | E5 | Médio: ffmpeg no Windows |
| `src/revisao/contraste.py` (novo) | Contas WCAG portadas, mediana e quartil, cor conforme | E6 | Baixo |
| `src/revisao/visao.py` (novo) | Mosaico (Pillow, `requirements.txt:8`), roteiro, chamada com `max_tokens`, parse, cache, teto, estimativa | E7 | Médio: custo |
| `src/revisao/clip.py` (novo) | Cosseno por keyframe (`image_semantic.py:264`), com `try/except` | E8 | Baixo |
| `src/revisao/caixa.py`, `composto.py` (novo) | Caixa real pelo navegador (D1); quadro composto por `montar_comando` | E9, E10 | Médio: dependem de D1 e B |
| `src/api/routes/revisao.py` (novo); `src/api/server.py:97-101` | `POST /api/revisao/rodar`, `GET /api/revisao/quadro/{chave}`, `POST /api/revisao/ignorar`, `GET /api/revisao/ultima`; 1 `include_router` | E2 | Baixo |
| `src/db/schema.py` | 2 tabelas (6.3) | E2, E7 | Baixo |
| `src/services/settings_registry.py` | 14 chaves (6.4) perto de `:684` | E2 | Baixo |
| `src/services/chat_agent.py` | `FERRAMENTAS_REVISAO` (`:621`); definição depois de `:971`; ramo no laço (`:1943-2247`); ganchos `:1780` e `:2279`; `achados` no dict `:2334-2347`; linha no card `:1514`; uma frase no prompt do agente | E2 | **Médio**: arquivo grande e disputado; `git status` antes |
| `src/ui/js/revisao.js`, `revisao.css` (novo) | Painel, estado, Ir, Ignorar, tiras | E3 | Médio |
| `src/ui/js/timelineState.js` | `achados` em `:5307`; `achadosRevisao` e evento | E3 | Baixo |
| `src/ui/js/timelineRenderer.js` | `drawAchadosRevisao` junto de `:1448`; selo em `:3010` | E3 | Baixo (sem `ImageBitmap`, logo sem `bitmap.close()`) |
| `src/ui/js/timelineInteraction.js` | Lista no popup `:13443`; clique na marca | E3 | Baixo |
| `src/ui/index.html` | 1 `<script>` e 1 `<link>`; nada em `styles.css` | E3 | Baixo: outra sessão mexe no HTML |
| `src/ui/js/exportVideo.js` | Seção Revisão abaixo do banner; **sem tocar** `_temBloqueio` e `_reavaliarBotoes` | E4 | Médio: arquivo grande |
| `tests/` | `test_revisao_regras.py`, `_quadros.py`, `_contraste.py`, `_visao.py`, `_ferramenta.py`, `_rota.py`; `autoteste_revisao_painel.mjs`, `autoteste_revisao_export.mjs` | todas | — |

Não toca: `src/export/video_render/*` (salvo E10), `fidelidade.py`, o preflight de `narrative.py`, `player*.js`.

## 8. Etapas
| # | Commit | Conteúdo | Testes | Dias | Depende de |
|---|---|---|---|---|---|
| E0 | (sem commit de produto) `docs(revisao): medições de custo, tempo e limiares` | `scripts/revisao_medir.py` (novo, descartável): tempo de 40 cortes no Windows do Fernando; `usage` de 10 mosaicos (tokens, pensamento, US$); preço nas páginas oficiais; limiares em 3 projetos reais | Planilha em `docs/` | 0,5 | — |
| E1 | `feat(revisao): checagens puras da montagem` | `modelos`, `sequencia`, `regras`: flash, buracos, repetição, jump por tempo, título curto, texto pequeno, área segura | `tests/test_revisao_regras.py` (≈ 35 casos em tabela + sequência limpa) | 2,0 | — |
| E2 | `feat(agente): ferramenta revisar_cortes e revisão grátis após propor` | Schema, despacho, ganchos, `achados` no ghost, linha no card, rota, tabelas, Configurações | `test_revisao_ferramenta.py`, `test_revisao_rota.py` (LLM e HTTP falsos) | 1,5 | E1 |
| E3 | `feat(revisao): painel, marcas na régua e selo nos ghost clips` | `revisao.js`, régua, selo, popup, desatualização | `autoteste_revisao_painel.mjs` (DOM falso) | 2,5 | E2 |
| E4 | `feat(export): seção Revisão separada da fidelidade, sem bloquear` | Seção abaixo do banner, última revisão por hash, "Revisar agora" | `autoteste_revisao_export.mjs` | 1,0 | E3 |
| E5 | `feat(revisao): tiras por corte e medidas de pixel` | `quadros.py`, `medidas.py`, cache, rota de imagem | `test_revisao_quadros.py` (código de barras de B ou `testsrc2`) | 2,5 | E1 |
| E6 | `feat(revisao): contraste WCAG sobre o quadro do proxy` | `contraste.py`, caixas opacas sem quadro, amostragem de legendas | `test_revisao_contraste.py` | 1,5 | E5 |
| E7 | `feat(revisao): revisão visual por mosaicos com cache e teto` | `visao.py`, estimativa, registro de gasto, `max_tokens`, lote partido | `test_revisao_visao.py` (HTTP falso) | 3,0 | E5, E2 |
| E8 | `feat(revisao): jump cut por similaridade CLIP` | `clip.py`, queda para "só pelo tempo" | `test_revisao_clip.py` (vetores falsos) | 1,0 | E1 |
| E9 | (opcional) `feat(revisao): caixa real do título pelo navegador` | `pg.avaliar` da D1 devolve a caixa e troca a estimativa | A/B contra a estimativa em 20 títulos | 1,5 | D1, etapas 1 a 4 |
| E10 | (opcional) `feat(revisao): quadro composto no corte` | `montar_comando` numa janela de 0,3 s | Bateria canônica: `pytest tests/test_render_composicao_multipista_cascata.py` | 2,0 | B (recomendado) |
| **Total** | | E0 a E8 = **15,5 dias**; com E9 e E10 = **19** | | **15,5 / 19** | |

Ordem: E0, E1, E2, E3, E4 (valor imediato e grátis), depois E5, E6, E7, E8. **Corte mínimo útil: E1 + E2 + E3 = 6 dias (7 com E4)** [inferência; estimativa grossa].

## 9. Testes e medições
| Teste ou medição | Como | Alvo | Etapa |
|---|---|---|---|
| Tempo da camada 1 | 500 e 2000 clipes sintéticos; `subprocess.run` e `requests.post` trocados por funções que falham | < 50 ms e < 150 ms; zero chamadas externas | E1 |
| Regras em tabela | Sequência sintética com 1 defeito de cada tipo e uma sequência limpa | Códigos exatos; **0 achados** na limpa; limites exatos (3 quadros, 0,4 s, 1,05 s para 3 palavras, 2,6 %) | E1 |
| Proposta do agente | `propose_rough_cut` offline (`chat_agent.py:1773-1812`) antes e depois | `risk_level` e `requires_confirmation` idênticos (golden); `achados` só do que a proposta introduz | E2 |
| Mapa tempo → fonte | Fonte com **código de barras** do nº do quadro (B: `barras_a.mp4`, `B:226`) ou `testsrc2` gerado; velocidade 1, 0,5, 2 e reverso | Erro de 0 quadros | E5 |
| Tempo das tiras | 40 cortes em proxies 720p no i7-10700, com 1 e 3 fios | ≤ 0,5 s por corte (1 fio); ≤ 8 s os 40 (3 fios); acerto de cache < 5 ms [a medir] | E0, E5 |
| Medidas de pixel | Sintéticos: quadro preto, branco, quadro intruso, corte entre cenas quase iguais, `gblur`; depois 20 cortes reais | 100 % nos sintéticos; limiares calibrados nos reais | E5 |
| Contraste | Vetores: preto/branco 21,0; `#767676`/branco 4,54; `#777777`/branco 4,48; vetores de `HF:contrast-bg.test.ts` (conferir); fixtures "branco sobre céu claro" (achado) e "branco sobre fundo escuro" (nenhum) | Erro ≤ 0,01 | E6 |
| Visão: acerto | 10 cortes limpos e 10 com defeito de verdade: `hflip` do 2º plano (quebra de eixo sintética), quadro preto inserido, 1 quadro de outro take, trecho repetido, `gblur` | Recall ≥ 80 % (preto, intruso, pulo) e ≥ 60 % (eixo); ≤ 15 % de alarme falso nos limpos [a medir] | E7 |
| Visão: custo | 10 e 30 cortes reais; ler `usage` (`prompt_tokens`, `completion_tokens`, pensamento) | ≤ US$ 0,002 por corte (≈ 3× a estimativa); erro da estimativa ≤ 30 %; ladrilhos por mosaico confirmados | E0, E7 |
| Cache, teto, falhas | 2ª rodada igual; teto de 30 cortes e US$ 0,10; JSON inválido; chave ausente; HTTP 402 e 429 falsos | 0 chamadas na 2ª; `truncado=true`; achado `info`; nenhuma exceção | E7 |
| Painel (DOM falso) | "Ir" chama o playhead com o quadro certo; marcas; selo; desatualização | Passa | E3 |
| Export | 10 achados altos não desabilitam o botão; `_temBloqueio` ignora a revisão | Passa | E4 |
| Não regressão | `git diff --stat` sem `src/export/video_render/` nem `player*.js` | Vazio (E10: bateria canônica) | todas |

**Custo por revisão.** Cada rodada grava tokens e US$ em `revisao_cache`; o painel mostra "esta revisão: US$ x (y do cache)" e "este mês: US$ z". Metas: camadas 1 e 2 = US$ 0; camada 3 ≤ US$ 0,002 por corte e ≤ US$ 0,10 por revisão.

## 10. Critérios de aceite

1. Camada 1 em 500 clipes: < 50 ms, sem ffmpeg, rede ou Qdrant (o cosseno do E8 é opcional).
2. Sequência sintética com defeitos: exatamente os códigos esperados; sequência limpa: zero achados.
3. `propose_rough_cut` e `propose_bulk_edit` devolvem `achados` por ghost e a linha no card; `risk_level` e `requires_confirmation` não mudam; falha da revisão não altera a resposta.
4. Nenhum achado tem nível `block`; o botão de exportar continua habilitado com qualquer revisão; `fidelidade.py` e a rota de preflight sem diff.
5. A tira de 5 quadros mostra o quadro certo (erro 0) em velocidade 1, 0,5, 2 e reverso.
6. Contraste: vetores WCAG com erro ≤ 0,01; nunca "alta" em instante coberto por camada de ajuste.
7. Visão: só por clique ou opt-in; 2ª rodada sem mudança = 0 chamadas; o teto interrompe e informa os cortes não vistos; custo medido ≤ US$ 0,002 por corte.
8. Painel: "Ir" leva o playhead ao quadro do achado; marcas e selo aparecem e somem ao editar; todo texto entra por `textContent`.
9. `nao_verificado` sempre presente e honesto ("áudio não ouvido", "etalonagem ignorada", "amostrado 40 de 312").
10. `git diff --stat` sem `src/export/video_render/` e sem `player*.js` (salvo E10, com a bateria canônica).

## 11. Riscos e mitigação
| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Custo de API foge (pensamento ligado, mosaico grande, agente em laço) | Média | Médio | `max_tokens`; teto por revisão; opt-in; estimativa antes do clique; `usage` gravado; lote partido só 1 vez |
| Alarme falso desgasta a confiança (jump cut em entrevista, reuso proposital) | Alta | Médio | Gravidade baixa por padrão, "Ignorar" persistente, "um aviso é uma pergunta" (`review.md` §1); calibrar na Etapa 0 |
| Privacidade: quadros do material do Fernando vão ao Google pela OpenRouter | Certa na camada 3 | Médio | Opt-in; 384 px; sem nome de arquivo nem de pessoa; igual ao que a análise visual já envia (`multimodal_engine.py:51`); desligada para o agente por padrão |
| Desempenho: dezenas de processos ffmpeg no Windows com o editor aberto | Média | Médio | 3 fios, prioridade baixa, cancelável, sem janela de console; cache de JPEG; medir na Etapa 0 |
| Caixa estimada ≠ caixa real (área segura, contraste) | Média | Baixo | Folga de 2 %; rótulo `aproximado`; Etapa 9 usa o navegador (D1) |
| Proxy ≠ export (etalonagem, camada de ajuste, escala) | Média | Baixo | `nao_verificado`; sem "alta" quando houver ajuste; composição opcional (E10) |
| Qdrant corrompido ou vazio | Baixa | Baixo | Cosseno opcional, cai para "só pelo tempo"; **avisar o Fernando antes de consertar** (regra do repositório) |
| Texto do modelo ou da transcrição vira HTML | Baixa | Alto | `textContent` em tudo; JSON validado; o popup do ghost usa `innerHTML` (`timelineInteraction.js:13469`): não copiar |
| Excesso de achados afoga o agente (DeepSeek) | Média | Médio | No máximo 40 no texto; agrupa por código ("12 jump cuts"); `baixa` escondida no card |
| Limiares do HF vêm de motion graphics gerados, não de documentário | Alta | Médio | Etapa 0 calibra com 3 projetos reais; tudo em `revisao.*` |
| Conflito em `chat_agent.py` e `exportVideo.js` (arquivos grandes, outra sessão na interface) | Média | Baixo | `git status` antes; commit só dos trechos; ganchos mínimos |
| Preço ou modelo mudam; preço visto só em busca (páginas oficiais bloqueadas aqui) | Média | Baixo | Preços em Configurações; custo real vem de `usage`; conferir na Etapa 0 |

## 12. Perguntas para o Fernando
| # | Pergunta | Recomendação |
|---|---|---|
| 1 | A visão pode ser chamada pelo agente, ou só pelo seu clique? | Só pelo clique (`revisao.visao_pelo_agente` desligado) |
| 2 | Teto por revisão de 30 cortes e US$ 0,10? | Sim; a estimativa aparece antes do clique |
| 3 | Jump cut em entrevista deve avisar? | Sim, gravidade baixa e ignorável |
| 4 | Onde mora o painel: aba no dock do chat ou faixa sob a timeline? | Aba no dock do chat, com as marcas na régua |
| 5 | Mosaico de 384 px (padrão) ou 256 px (13 % mais barato)? | 384; a Etapa 0 confirma |
| 6 | Posso mandar quadros de 384 px dos seus vídeos ao Gemini pela OpenRouter, como a análise visual já faz? | Sim, só na camada 3 e sob clique |
| 7 | A v1 pode ignorar etalonagem e camada de ajuste no contraste, rotulando "aproximado"? | Sim |
| 8 | Fazer E1 a E4 (camada grátis, ≈ 7 dias) antes da visão, mesmo sem a D1? | Sim: não dependem de nenhuma outra frente |
| 9 | A seção do export aparece recolhida (só a contagem) ou aberta? | Recolhida |
| 10 | Quais 3 projetos reais calibram a Etapa 0? | Um de entrevista, um de B-roll e um com GCs e legendas |

## 13. Prompt para o chat de implementação

````markdown
> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> As etapas 1 a 8 não dependem de outra frente; a 9 espera a D1 (etapas 1 a 4); a regra de leitura das legendas vem da frente C, se já existir.

---

Quero que o agente editor do CapIAu Talho revise o **ofício** da montagem (flash de 1 quadro, buraco de vídeo e de áudio, trecho da fonte repetido, jump cut, título curto para ler, texto pequeno, fora da área segura, contraste do texto sobre a imagem) e, sob pedido, olhe os cortes com o modelo de visão. A revisão nunca bloqueia o export, nunca muda a timeline e nunca gasta sem eu pedir. Leia antes `docs/PESQUISA_HYPERFRAMES.md` (item 4.9) e, se eu anexei, `H_revisao_agente.md` (o plano manda). Confira cada afirmação no código; linhas podem ter andado.

## O que já existe (conferido em 28/10/2026)

- 17 ferramentas do agente em `src/services/chat_agent.py` (`TOOLS` ~627-1009). As de áudio têm o conjunto `FERRAMENTAS_AUDIO` (~621) e o despachante `_despachar_ferramenta_de_audio` (~1395): `revisar_cortes` segue esse molde. O agente padrão (DeepSeek) não lê imagem: o resultado volta como texto.
- Ghost clips: `suggestions_output` (~2334-2347), `setGhostSuggestions` (`timelineState.js` ~5307, copia campos fixos), `drawGhostClips` (`timelineRenderer.js` ~3010), popup (`timelineInteraction.js` ~13443, usa `innerHTML`: não copie).
- Sequência: `src/export/video_render/modelo.py` (`Pista`, `Clipe`, `trecho_fonte` ~157). Proxies 720p: `caminho_proxy_video` (`midia.py` ~99). Título: `tituloRender.js` (`estadoTitulo`, `temCaixa`, `maxWidth` 90 %); guias 90 % e 80 % em `playerTextOverlay.js` ~53-62.
- Visão: `multimodal_engine.py` ~51 (1 imagem, sem `max_tokens`); modelo `CONFIG.VISION_MODEL` = `google/gemini-2.5-flash`. Opt-in de custo de referência: `agent.jev_audit` (`settings_registry.py` ~684).
- Export: `fidelidade.py` (pode bloquear) e `exportVideo.js` (`_renderizarBanner` ~960, `_reavaliarBotoes` ~1030). A revisão é uma terceira coisa: **separada e sem `block`**.

## O que fazer (um commit por etapa, `feat(revisao): ...` em português)

0. (sem commit de produto) Me mostre antes de fixar qualquer número: tempo de 40 cortes (5 quadros cada) no meu Windows; tokens e dólares reais de 10 mosaicos no Gemini (`usage`, incluindo pensamento); preço nas páginas oficiais da OpenRouter; limiares em 3 projetos meus.
1. `src/revisao/` (modelos, sequência, regras puras): flash (≤ 3 quadros), buraco de vídeo e de áudio, repetição da fonte, jump cut por tempo, título curto (0,4 s até 2 palavras; senão 0,75 × (0,5 + 0,3 × palavras); última linha 2 s), texto pequeno (< 2,6 % do lado menor), fora da área segura (caixa estimada, folga de 2 %). `tests/test_revisao_regras.py`.
2. Ferramenta `revisar_cortes` + revisão grátis depois de `propose_rough_cut`/`propose_bulk_edit` (ganchos ~1780 e ~2279) + `achados` no ghost + linha no card, só com o que a proposta introduz. `try/except`: falha da revisão não derruba a proposta. Tabelas e `revisao.*` nas Configurações.
3. Painel Revisão (`revisao.js` novo) com **Ir**, marcas na régua (camada transitória, fora de `markers`), selo e lista no ghost. Nada abre sozinho.
4. Seção "Revisão" no export, abaixo do banner de fidelidade, sem tocar `_temBloqueio`/`_reavaliarBotoes`.
5. Tiras de 5 quadros por corte (−0,2 s, −1 quadro, 0, +1 quadro, +0,2 s) dos proxies via FFmpeg; medidas de pixel (preto, quadro intruso, corte invisível, desfoque); cache em `data/cache/revisao`.
6. Contraste WCAG com numpy sobre o quadro do proxy (mediana e pior quartil; mínimo 4,5 ou 3,0); contas portadas do HyperFrames (Apache-2.0: aviso no cabeçalho).
7. Visão: mosaico 3×2 de 384 px por corte, lote de 6, JSON estruturado, `max_tokens`, cache, teto (`revisao.visao_max_cortes` 30, `revisao.visao_teto_usd` 0,10), estimativa antes do clique; só por clique ou `revisao.visao_pelo_agente`.
8. Jump cut por cosseno do CLIP (opcional; cai para "só pelo tempo" se o Qdrant falhar).
9. (opcional, depois da D1) caixa real do título por `pg.avaliar`.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev`, `docs/HANDOFF_DESIGN_UI.md` (9–12 px, botões 20–28 px, `var(--fs-N)`, `var(--sp-N)`, `--accent`, nada abre sozinho) e `.agents/rules/nle-parity-and-media-lifecycle.md`.
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`, `library.js`, `welcomeHub.js`, `player.js` às vezes). Commit só dos seus trechos (índice montado a partir do HEAD), direto na main, sem coautoria, sem push. Em `chat_agent.py` e `exportVideo.js`, `git status` antes.
- Não mexa em `src/export/video_render/` nem em `player*.js`. Se algum dia mexer em `comando.py`, rode `pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs`.
- Modelos não baixam sozinhos (`src/services/modelos_locais.py`, `exigir`). O Qdrant local já apareceu corrompido ("database disk image is malformed"); se a busca vetorial falhar, me avise antes de tentar consertar.
- Gasto de API só sob pedido ou opt-in, sempre com teto; texto do modelo entra por `textContent`.
- Testes: pytest em `tests/test_revisao_*.py` com HTTP e modelo falsos; Node ESM com DOM falso em `tests/autoteste_revisao_*.mjs`.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022). Português, direto. Verifique antes de afirmar.

## Pronto quando

`revisar_cortes` acha os defeitos sintéticos sem ffmpeg nem rede, em menos de 50 ms para 500 clipes; a proposta do agente chega com selo e lista; "Ir" leva o playhead ao quadro; o export continua liberado com qualquer revisão; a visão só roda por clique ou opt-in, com cache e teto; e o custo medido por corte fica abaixo de US$ 0,002.
````
