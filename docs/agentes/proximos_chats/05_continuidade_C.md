# Chat 05: continuidade com o roteiro (C)

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça depois dos chats 03 e 04.

---

Quero saber, no CapIAu Talho, se o adereço ou figurino que o roteiro pede numa cena aparece nos takes
dessa cena: "o revólver da cena 12 aparece em algum take?", "a garrafa sumiu entre o take 3 e o 4?".
É o que a configuração `object.link_script_props` prometia e nunca fez. Leia antes
`docs/propostas/PROPOSTA_BUSCA_OBJETOS.md` (rota C) e confira no código; linhas podem ter andado.

## O que já existe (conferido em 05/10/2026)

- Roteiro: o prompt de cenas pede `props` e `objetos_chave` por cena (`src/nlp/prompt_registry.py`
  ~268-282); `src/services/script_extract.py` (~193-205, ~396) grava `scene.props_json` e cria
  entidades `object` com `realm='story'`. Rota `src/api/routes/scenes.py` (~91) devolve `props`.
- O único cruzamento roteiro↔visão hoje é por texto: nomes do roteiro entram no prompt de visão
  (`src/nlp/prompt_templates.py` ~84-160).
- Falta saber **qual take é de qual cena**: confira se existe vínculo vídeo↔cena (`scene_id` em
  `detected_object`; algo em `video` ou nas sequências?). Se não existir, me pergunte como quero
  vincular (nome do arquivo com "cena_12", marcação manual, claquete lida por OCR).
- Detectores de vocabulário aberto em `src/vision/detectores.py`; coluna `finalidade` criada no
  chat 03 (`'continuidade'`).

## O que fazer (um commit por etapa)

1. Levantar e me mostrar como take e cena se ligam hoje; decidir comigo.
2. Para uma cena: classes = `props` da cena (português) traduzidas; rodar o detector de vocabulário
   aberto nos keyframes dos takes da cena; gravar com `finalidade='continuidade'`, `realm='story'`,
   `scene_id`. Sob pedido, nunca sozinho.
3. Relatório por cena: adereço visto em quais takes e instantes, e "não visto em nenhum take".
   Com recorte (se o chat 03 trouxe `auto_crop` de volta) e link para o instante.
4. Sugestão discreta no painel da cena ("adereço 'revólver' não visto em nenhum take"), que eu escolho
   abrir; painel que empurra, nada abre sozinho.
5. `object.link_script_props` passa a ligar/desligar isso de verdade, com ajuda atualizada.
6. Teste com um roteiro e takes de exemplo; meça falso positivo (adereço "visto" onde não está) e me
   mostre a folha de contato (`scripts/detectores_comparar.py` serve de base).

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/agentes/HANDOFF_DESIGN_UI.md` (9–12 px, botões 20–28 px,
  `var(--fs-N)`, `var(--sp-N)`, `--accent`).
- Outra sessão mexe na interface. Commit só dos seus trechos (índice a partir do HEAD), direto na
  main, sem coautoria, sem push.
- Modelos não baixam sozinhos (`src/services/modelos_locais.py`, `exigir`).
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar.

## Pronto quando

Para uma cena com roteiro, o programa diz em quais takes cada adereço aparece e quais não aparecem,
sob pedido, sem misturar com a checagem técnica nem com a busca comum.
