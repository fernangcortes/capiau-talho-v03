---
name: github-docs-and-wiki-standard
description: Diretrizes e padrões para formatação de documentações, README, guias e GitHub Wiki. Regras para tabelas GFM, fórmulas matemáticas KaTeX sem erros, diagramas vetoriais SVG (evitando bugs do Mermaid client-side), automação de sincronização de Wiki e prevenção de artefatos de exportação.
---

# Padrão de Documentação Técnica, Guias e GitHub Wiki

Este guia estabelece os padrões e regras obrigatórias para criação, formatação e manutenção de documentações técnicas, manuais, guias, arquivos `README.md` e páginas da **GitHub Wiki** no projeto.

---

## 🎨 I. Diagramas e Infográficos: Preferência por Vetoriais SVG

### 1. Por que Evitar Mermaid Complexo no GitHub e Wiki
* **Bug Crítico no Renderizador Client-Side:** O parser de Mermaid do GitHub (`mermaidMarkdown.js` / `mermaid-renderer.ts`) frequentemente quebra ao renderizar blocos com `subgraph`, quebras `<br/>`, nós estilizados ou conexões tracejadas (`-.->`), disparando erros no console:
  ```text
  Uncaught TypeError: Cannot convert undefined or null to object
  Uncaught TypeError: Cannot read properties of null (reading 'getAttribute')
  ```
  Isso causa telas pretas, spinners eternos e falha na renderização de toda a página.

### 2. Padrão Recomendado: Diagramas Vetoriais SVG Nativos
* **Vantagens:** 
  * 0 ms de latência e carregamento 100% nativo pelo navegador.
  * Zero dependência de scripts JavaScript externos.
  * Nitidez perfeita em qualquer resolução de tela (Retina, 4K, mobile).
* **Diretórios Padrão:**
  * Documentação principal: `docs/images/nome-do-diagrama.svg`
  * GitHub Wiki: `wiki/images/nome-do-diagrama.svg`
* **Estilo Visual Obrigatório (Dark Glassmorphism):**
  * Fundo escuro: gradiente `#0d0d12` a `#14141f` com borda sutil `#27273a`.
  * Paleta temática:
    * 🔵 **Ciano (`#06b6d4`):** Entradas, pipelines principais e conexões ativas.
    * 🟣 **Violeta (`#8b5cf6`):** Motores de IA, vetores semânticos e áudio inteligente.
    * 🟢 **Esmeralda (`#10b981`):** Sucessos, saídas master, exports e status ready.
    * 🟡 **Âmbar/Laranja (`#f59e0b`):** Interoperabilidade, alertas e codecs legados.
  * Tipografia: `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"`.
  * `viewBox` responsivo: utilizar `viewBox="0 0 880 [altura]"` e `width="100%"` `height="100%"`.

---

## 📊 II. Tabelas em GitHub Flavored Markdown (GFM)

### 1. Proibição Estrita de Grid Tables e Multiline Tables
* Conversores como Pandoc frequentemente geram tabelas no formato *Grid Table* (`+---+---+`) ou tabelas com linhas tracejadas (`-------`), que **não são suportadas pelo GitHub**:
  ```text
  ❌ INCORRETO (Não renderiza no GitHub):
  +-----------------------+-----------------------+
  | **Tecla**             | **Ação**              |
  | **J**                 | **Retroceder Vídeo**  |
  +-----------------------+-----------------------+
  ```

### 2. Padrão Obrigatório: GFM Pipe Tables
* Toda tabela deve ser escrita em formato de pipes (`|`), com linha de cabeçalho e alinhamento explícito:
  ```markdown
  ✅ CORRETO:
  | Tecla | Ação | Descrição |
  | :--- | :--- | :--- |
  | **`J`** | **Retroceder Vídeo** | Pressione para acelerar o retrocesso (-1x, -2x, -4x). |
  | **`K`** | **Play / Pause** | Alterna entre tocar e pausar a reprodução. |
  ```
* **Quebras de Linha em Células:** Utilize a tag `<br>` para quebras de linha dentro de uma célula da tabela, nunca quebras de linha cruas.
* **Atalhos e Comandos:** Destaque teclas com `**` e crases (`**` `J` `**` ou `<kbd>J</kbd>`).

---

## 📐 III. Fórmulas Matemáticas e Notação KaTeX no GitHub

### 1. Regra de Ouro do Underline (`_`) no KaTeX
* No motor KaTeX do GitHub, o caractere de sublinhado `_` dentro de comandos `\text{...}` dispara o erro:
  ```text
  '_' allowed only in math mode
  ```
* **Como formatar corretamente:**
  ```latex
  ❌ INCORRETO:
  $$\vec{v} = [ \text{LUFS\_I}, \text{TruePeak\_dB}, \text{NoiseFloor\_dB} ]$$

  ✅ CORRETO:
  $$\vec{v} = [ \mathbf{LUFS_I}, \mathbf{TruePeak_{dB}}, \mathbf{NoiseFloor_{dB}} ]$$
  ou
  $$\vec{v} = [ \text{LUFS}, \text{TruePeak}, \text{NoiseFloor} ]$$
  ```

### 2. Prevenção de Escapes Acidentais de Cifrão
* Ao editar arquivos convertidos do Pandoc ou LaTeX, certifique-se de que valores monetários e variáveis não contenham barras invertidas indesejadas:
  * ❌ `R\$ 30,00` $\rightarrow$ ✅ `R$ 30,00`
  * ❌ `\$5.00 USD` $\rightarrow$ ✅ `$5.00 USD`
  * ❌ `\$\$Formula\$\$` $\rightarrow$ ✅ `$$Formula$$`

---

## 🌐 IV. Estruturação e Deploy da GitHub Wiki

### 1. Estrutura de Arquivos da Wiki (`wiki/`)
A pasta `wiki/` na raiz do projeto deve conter os arquivos sincronizados:
* `Home.md`: Página inicial com índice temático e guia de início rápido.
* `_Sidebar.md`: Menu lateral de navegação com links para todos os capítulos.
* `_Footer.md`: Rodapé global unificado.
* `XX.-Nome-do-Capitulo.md`: Artigos temáticos numerados (ex: `01.-Visao-Geral-e-Conceito.md`).
* `images/`: Subpasta contendo todos os diagramas SVG vetoriais referenciados.

### 2. Script de Sincronização e Automação (`scripts/deploy_wiki.py`)
Ao sincronizar alterações locais para o repositório Git da Wiki (`<repo>.wiki.git`), o script de deploy deve seguir estas garantias:
* **Tratamento de Permissões Windows:** Implementar função `safe_rmtree` com `stat.S_IWRITE` para evitar `PermissionError: [WinError 5]` em arquivos protegidos do Git (`.git/objects/`).
* **Sincronização Incremental:** Usar `git fetch` e `git pull --rebase origin master/main` antes de copiar alterações.
* **Cópia Recursiva de Imagens:** Copiar tanto os arquivos `*.md` quanto a árvore inteira de `images/` para o repositório da Wiki (`shutil.copytree(..., dirs_exist_ok=True)`).
* **Codificação UTF-8:** Forçar `sys.stdout.reconfigure(encoding="utf-8")` para evitar erros de `cp1252` no console do Windows.

---

## ✅ V. Checklist Rápido de Validação de Documentos

Antes de commitar ou fazer deploy de qualquer documentação:

1. [ ] **Diagramas:** Todos os esquemas utilizam arquivos vetoriais `.svg` locais em vez de blocos ````mermaid` complexos?
2. [ ] **Tabelas:** Todas as tabelas estão em formato GFM Pipe Table (`| col | col |`) sem caracteres `+---+` ou traços quebrados?
3. [ ] **KaTeX:** Não há `\_` dentro de `\text{...}` em fórmulas matemáticas?
4. [ ] **Escapes:** Símbolos de cifrão (`$`) estão livres de barras invertidas desnecessárias (`\$`)?
5. [ ] **Links Relativos:** Todas as referências a imagens utilizam caminhos relativos válidos (`docs/images/...` no repositório principal e `images/...` na Wiki)?
6. [ ] **Deploy:** O script `python scripts/deploy_wiki.py` executou com código de saída 0 e sincronizou as imagens?
