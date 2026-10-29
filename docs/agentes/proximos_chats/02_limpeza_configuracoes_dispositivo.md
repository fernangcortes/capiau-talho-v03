# Chat 02: limpeza de configurações e dispositivo de IA

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.

---

Quero que as Configurações do CapIAu Talho não tenham chave que não faz nada. Algumas nasceram
copiadas de uma especificação (`docs/Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md`, commit
`182100d` de 30/09/2026) sem código que as leia. Confira cada uma com grep fora do
`src/services/settings_registry.py` e dos testes antes de mexer.

## O que fazer

1. **Remover `object.execution_mode`** (`settings_registry.py` ~282). Onde o detector roda já é
   definido pela escolha do detector (`EXECUCAO` em `src/vision/detectores.py`). Ajustar o teste
   `tests/test_ai_layers_2026.py` (`test_settings_registry_has_2026_keys`) e explicar no commit.
2. **Remover `object.auto_crop`** (~290) por enquanto. Volta no chat 03, junto com a tela de revisão
   da checagem técnica, que é quem precisa de recortes. Anote isso em `docs/agentes/proximos_chats/03_*.md`.
3. **Manter `object.link_script_props`** (~297), mas mudar a ajuda para dizer que entra com a
   continuidade (chat 05) e que hoje não faz nada; ou esconder da tela até lá. Pergunte-me qual.
4. **Fazer `hardware.ai_device` valer** (~1019; opções auto/cpu/directml/cuda). Hoje ninguém lê:
   `src/search/semantic.py:90`, `src/search/image_semantic.py:69,77` e `src/vision/shot_scale.py:89`
   carregam com `device="cpu"` fixo. Também os modelos locais novos: Whisper (`motores.py`,
   `WhisperModel(..., device="cpu")`), detectores (`detectores.py`), Laya (`system1_service.py`,
   `Router(device="cpu")`) e o worker do `.venv-nemo`.
   - Esta máquina não tem GPU NVIDIA (Intel UHD 630). Verifique se DirectML está instalado/funciona
     antes de oferecer; se não, a opção mostra "indisponível nesta máquina" em vez de falhar.
   - Função única de resolução (nova) que todos usam; "auto" = CPU aqui. Teste com mock de
     `torch.cuda.is_available`.
5. **Varredura geral**: liste toda chave do registro que nenhum código lê (script de grep), me mostre
   a lista com o que cada uma prometia, e só remova o que eu aprovar.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/agentes/HANDOFF_DESIGN_UI.md`.
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`,
  `library.js`, `welcomeHub.js`). Commit só dos seus trechos, direto na main, sem coautoria, sem push.
- Valor salvo no banco que sair da lista aparece como "(fora da lista atual)" no painel
  (`src/ui/js/settingsPanel.js`); confira que remover a chave não quebra quem tem valor salvo.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Português, direto. Verifique antes de afirmar.

## Pronto quando

Nenhuma chave morta aprovada para sair continua no registro; `hardware.ai_device` decide o
dispositivo de todos os modelos locais, com teste; commit por item.
