# Estágio 1C — Regressão do Render (Frente B Nível 1), Video Receipts e Navegador Comum (`Frente D1` E0–E3)

> **Contexto:** Documento operacional e de arquitetura aplicada para o **Estágio 1C** derivado de [`GRANDE_PLANO_UNIFICADO_2026-11.md`](../../planos/GRANDE_PLANO_UNIFICADO_2026-11.md), [`B_regressao_render.md`](../../plano_hyperframes/B_regressao_render.md), [`D1_navegador.md`](../../plano_hyperframes/D1_navegador.md) e [`NOVOS_PLANOS_IAS_2026-11.md`](../../planos/NOVOS_PLANOS_IAS_2026-11.md) (§10), consolidando sobre a base pós-Estágio 1B e o commit parcial `11efef5`.
> **Escopo:**
> - **Frente D1 (E0–E3):** Pacote compartilhado `src/navegador/`, spike de medições em Windows, migração de `titulos.py`/`execucao.py`/`fidelidade.py` com paridade bit-a-bit contra o legado `http://titulos.capiau` e abort imediato em cancelamento.
> - **Kinocut Video Receipts:** Emissão de `<destino>.receipt.json` por exportação em `src/export/video_render/recibo.py` e exposição em `GET /api/timeline/{id}/render/ultimo`.
> - **Frente B (Nível 1):** Harness determinístico `FFV1 + PCM s16le` + mídias sintéticas (`<= 1.5 MB`), métricas NumPy/Pillow, oráculos analíticos/metamórficos, fluxo de aprovação via CLI e os **18 cenários** Nível 1 em `tests/render_regressao/`.
> - **Fora de escopo:** Paridade Nível 2 player × export (`Frente B` Nível 2 / `Frente D2` no Estágio 6C) e catálogo Headless Shell / BeginFrame (`Frente D1` E4–E8).

---

## Resumo dos Entregáveis do Estágio 1C

| Frente | Entrega Principal | Módulos / Arquivos Principais | Verificação Principal |
|---|---|---|---|
| **D1 (E0–E2)** | Pacote `src/navegador/` (`127.0.0.1`, Range/PUT/segurança, ciclo de vida Playwright, diagnóstico barato `<100ms`, limpeza de órfãos, spike Windows) | `src/navegador/{__init__,erros,servidor,orfaos,diagnostico,lancador}.py`, `scripts/spike_navegador.py`, `docs/MEDICOES_NAVEGADOR.md` | `pytest tests/test_navegador_servidor.py tests/test_navegador_lancador.py` |
| **D1 (E3)** | Migração dos títulos e cancelamento para `src.navegador` com paridade bit-a-bit | `src/export/video_render/{titulos,execucao,fidelidade}.py`, `tests/test_render_titulos_regressao.py` | `pytest tests/test_render_titulos.py tests/test_render_titulos_regressao.py tests/test_fontes_projeto.py` |
| **Video Receipts** | Recibo JSON auditável por exportação (`<destino>.receipt.json`) e integração na API | `src/export/video_render/{recibo,execucao}.py`, `src/api/routes/narrative.py`, `tests/test_render_video_receipts.py` | `pytest tests/test_render_video_receipts.py` |
| **Frente B (Nível 1)** | Harness `FFV1 + PCM s16le`, mídias sintéticas 11 bits, oráculos NumPy, referências douradas e 18 cenários | `tests/render_regressao/`, `scripts/render_regressao.py`, `pytest.ini`, `.gitignore`, `package.json`, `.agents/rules/nle-parity-and-media-lifecycle.md` | `pytest tests/render_regressao -q` e `npm run test:render:regressao` |

---

## 1. Frente D1 (E0–E3) — Navegador Headless Compartilhado (`src/navegador/`)

1. **Servidor loopback `127.0.0.1` (`src/navegador/servidor.py`):**
   - Serve `src/ui/` e rotas virtuais extras (ex.: `__fontes/`) em contexto seguro real (`isSecureContext === true`, liberando `AudioWorklet`), com suporte a `Range` (`206 Partial Content`), upload controlado `PUT` quando configurado e bloqueio de traversal / acesso externo.
2. **Lançador, diagnóstico e higiene (`lancador.py`, `diagnostico.py`, `orfaos.py`, `erros.py`):**
   - Fallback ordenado de canais (`msedge`, `chrome`, bundle Playwright) com `--proxy-bypass-list=127.0.0.1;localhost;<-loopback>` para não passar loopback por proxies corporativos/sandbox.
   - `diagnostico_barato()` (`< 100 ms`, `16.24 ms` medidos no spike em `docs/MEDICOES_NAVEGADOR.md`) sem abrir processo pesado; `diagnosticar()` completo registra versão, GPU/GL, `isSecureContext` e `audioWorklet`.
   - `Navegador.abortar()` + `orfaos.matar_arvore_pid` (`TerminateProcess` em árvore no Windows) encerram capturas em andamento durante cancelamento.
3. **Migração de títulos (`titulos.py`, `execucao.py`, `fidelidade.py`):**
   - `GeradorTitulos` utiliza `Navegador`/`Pagina` sobre `127.0.0.1` e inclui `nav.assinatura()` na chave de cache; `execucao.cancelar_render` registra e aborta o navegador ativo via `_NAVEGADORES`; `fidelidade.TITULOS_SEM_NAVEGADOR` consulta `diagnostico_barato()`.
   - Verificação A/B em `tests/test_render_titulos_regressao.py` comprova paridade bit-a-bit (`ImageChops.difference(...).getbbox() is None`) em `640x360` e `1920x1080` frente ao legado.

---

## 2. Video Receipts (`src/export/video_render/recibo.py`)

1. **Gravação por exportação:** `execucao._render_job` chama `recibo.gravar_recibo_export(...)` após concluir o arquivo final, gravando `<destino>.receipt.json` (`schema_version == 1`) com:
   - Identidade da timeline e `sequence_sha256` (64 hex);
   - Proveniência das mídias resolvidas com hashes SHA-256 (`hash_rapido_arquivo`);
   - Parâmetros reais de saída (`encoder`, comandos FFmpeg executados, flag de segmentação e avisos);
   - Métricas do arquivo final (`tamanho_bytes`, `sha256` completo e `probe` do `ffprobe`).
2. **API:** `GET /api/timeline/{id}/render/ultimo` (`narrative.ultimo_render_timeline`) expõe `receipt_path` e o conteúdo `recibo` quando presentes em disco.

---

## 3. Frente B (Nível 1) — Suíte de Regressão do Render (`tests/render_regressao/`)

1. **Infraestrutura:**
   - **Intermediário lossless (`ajudantes.comando_intermediario`):** preserva o cabeçalho e o `filter_complex` exato de `comando.montar_comando(...)`, trocando a cauda para `ffv1 -level 3` + `pcm_s16le` CFR para avaliação exata de quadros e áudio.
   - **Fontes sintéticas (`fontes.py`, `midia/`):** vídeos com código de barras de 11 bits (10 bits de quadro + 1 bit de fonte / leitura contínua de `α(t)`), SMPTE HD (`bt709` e sem etiqueta) e `foto.png` com marcadores de centro e canto; áudios WAV gerados apenas em `tmp_path`.
   - **Métricas e oráculos (`metricas.py`, `oraculos.py`, `relatorio.py`):** PSNR, SSIM de luma, tiras de miniaturas `32x18`, correlação de envoltória RMS, resíduo/null test em dB, compositor W3C NumPy, Filter Effects CSS NumPy, curvas de fade e detector de centroide subpixel.
   - **Referências douradas e guarda (`referencias.py`, `scripts/render_regressao.py`):** aprovações auditadas em `referencias/` (`APROVADO.json` + `APROVACOES.jsonl`) para os cenários dourados (`01_canonico_cascata` e `17_titulo_caixa_desfoque`), com proibição estrita de escrita durante o `pytest`.
2. **Divergências conhecidas isoladas (`@pytest.mark.xfail(strict=True)`):**
   - `REVERSO_UM_QUADRO` no cenário `03_velocidade_reverso_freeze` (`player.js:4540` vs `reverse` do FFmpeg — Estágio 2C).
   - `HD_SEM_ETIQUETA_BT709` no cenário `06_cor_hd_matriz` (`smpte_hd_semtag.mp4` sem `-colorspace bt709` — Estágio 4A Frente G1a).
3. **Documentação da suíte:** Detalhes completos de uso, marcadores, CLI e matriz `P1–P8` × `01–18` em [`tests/render_regressao/LEIA-ME.md`](../../../tests/render_regressao/LEIA-ME.md).

---

## 4. Comandos de Verificação do Estágio 1C

```powershell
# Navegador, títulos e Video Receipts (Frente D1 + Receipts)
.venv\Scripts\python.exe -m pytest tests/test_navegador_servidor.py tests/test_navegador_lancador.py tests/test_render_titulos.py tests/test_fontes_projeto.py tests/test_render_titulos_regressao.py tests/test_render_video_receipts.py tests/test_bloco_0c_higiene_seguranca.py -q

# Suíte de regressão do render Nível 1 (Frente B — 18 cenários)
.venv\Scripts\python.exe -m pytest tests/render_regressao -q --durations=10

# Suítes legadas e canônicas de render + sincronia de docs
.venv\Scripts\python.exe -m pytest tests/test_render_composicao_multipista_cascata.py tests/test_render_blend_pixel.py tests/test_render_fade.py tests/test_render_in_out_proxies_matte.py tests/test_docs_sincronizadas.py -q

# Paridade UI / fumaça / docs
node tests/autoteste_composicao_multipista_cascata.mjs
npm run test:ui:smoke
.venv\Scripts\python.exe scripts/verificar_docs.py
```
