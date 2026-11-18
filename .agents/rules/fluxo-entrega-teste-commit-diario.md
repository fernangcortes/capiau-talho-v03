---
always_on: true
description: "Protocolo obrigatório de pós-implementação: roteiro de teste manual no editor, aprovação humana antes do commit, commit automático pós-aprovação, resumo do chat e consulta para registro no Plano Vivo (site/)."
---

# Protocolo de Entrega, Teste Manual, Commit e Diário Vivo

Siga este fluxo em toda implementação ou correção concluída neste repositório:

1. **Antes do commit — Verificação e Roteiro de Teste Manual:**
   - Rode os testes automatizados pertinentes (`pytest`, `node tests/autoteste_*.mjs` ou lints).
   - Quando a mudança tocar a interface, player, timeline, áudio, ingestão, busca, chat ou exportação, entregue um **passo a passo numerado e objetivo de como testar manualmente no editor CapIAu-Talho** (o que abrir, onde clicar, o que observar e o resultado esperado).
   - **Peça aprovação explícita do usuário** antes de criar o `git commit`. Nunca commite código funcional sem essa aprovação (salvo ordem explícita do usuário em contrário).

2. **Após o usuário testar e aprovar — Commit e Sumário:**
   - Execute imediatamente o `git commit` das alterações aprovadas (mensagens convencionais: `feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`).
   - Apresente um **sumário conciso do chat** cobrindo:
     - **Planejado:** o objetivo original / sub-estágio do plano.
     - **Realizado:** o que foi entregue (arquivos principais e hash do commit).
     - **Mudanças pelo caminho:** desvios, descobertas, bugs extras corrigidos ou itens adiados.
   - Em seguida, **pergunte ao usuário**:
     > *"Deseja que eu registre esta entrega na ferramenta de acompanhamento didático (`site/plano.html` e `site/GUIA_DIDATICO_GRANDE_PLANO.md`)?"*

3. **Registro sob confirmação e Blindagem de Tokens:**
   - **Somente se o usuário responder positivamente**, atualize:
     1. `site/assets/js/plano.js` (e `site/plano.html` caso contadores/status no HTML estático precisem refletir a mudança);
     2. `site/GUIA_DIDATICO_GRANDE_PLANO.md`;
     3. `site/contribuir.html#roadmap` (se impactar algum marco exibido ali);
     4. O cabeçalho/tabela de `docs/planos/GRANDE_PLANO_UNIFICADO_2026-11.md`;
     e faça o commit dessa atualização documental (`docs(plano): registrar entrega ...`).
   - **Regra de ouro de economia de tokens:** Durante tarefas comuns de desenvolvimento, auditoria ou correção de código, **NÃO leia** `site/GUIA_DIDATICO_GRANDE_PLANO.md`, `site/plano.html` nem `site/assets/js/plano.js` (eles são documentação humana isolada do contexto de código).
