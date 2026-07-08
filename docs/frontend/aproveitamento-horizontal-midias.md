# Aproveitamento Horizontal da Área de Mídias

_Alinhar mídias à esquerda para recuperar largura útil, reduzir truncamento (...) e exibir mais texto sem alterar a hierarquia ou o tamanho das thumbnails._

### Como está hoje:

```text
📁 makinof-monstro
└─ 📁 Entrevistas
   └─ 📁 todas juncoes
```

O problema atual é que as mídias são renderizadas **recuadas para a direita** por causa da profundidade da árvore:

```text
📁 makinof-monstro
└─ 📁 Entrevistas
   └─ 📁 todas juncoes

      ┌─────────────┐ Entrevista (nonono...)
      │             │
      │             │
      └─────────────┘
      ┌─────────────┐ Entrevista (nonono...)
      │             │
      │             │
      └─────────────┘
```

Esse recuo desperdiça largura útil.

### Como deve ser:

O desejado é manter a pasta como subpasta, mas fazer as mídias começarem mais à esquerda:

```text
📁 makinof-monstro
└─ 📁 Entrevistas
   └─ 📁 todas juncoes
┌─────────────┐ nonono nonono nonono nonono
│             │ nonono nonono nonono nonono
│             │ nonono nonono nonono nonono
└─────────────┘
┌─────────────┐ nonono nonono nonono nonono
│             │ nonono nonono nonono nonono
│             │ nonono nonono nonono nonono
└─────────────┘
```

### Diferenças corretas

* `todas juncoes` continua sendo subpasta de `Entrevistas`.
* A árvore continua igual.
* As mídias deixam de respeitar o recuo visual da árvore.
* As thumbnails passam a alinhar próximo à borda esquerda do painel.
* A largura recuperada é usada para mostrar mais texto.
* O texto deixa de ficar limitado a uma única linha com `...`.
* O texto passa a ocupar toda a altura disponível ao lado da thumbnail.
* Mantém a mesma altura de thumbnail.
* O texto se ajusta de acordo com o zoom.
* Remove desperdício horizontal sem perder informação hierárquica.
* Seguindo essa lógica, quando em modo maximizado, os videos podem aparecer em colunas mostrando muito mais resultados.

### Detalhes da Implementação Final

* **Modo Lista Maximizado:** Quando a biblioteca é maximizada (`.sidebar-maximized`), a lista de vídeos de cada pasta passa a renderizar como um grid de múltiplas colunas de `minmax(420px, 1fr)`. Em resoluções como `1920x1080`, exibe automaticamente 4 colunas.
* **Modo Grade Otimizado:** 
  * As subpastas ganharam a regra `grid-column: 1 / -1` para ocupar 100% de largura horizontal na grade e evitar cortes de seus nomes.
  * O botão de deletar/ações da mídia foi transformado em um controle absoluto flutuante no canto superior direito da miniatura, que só surge no hover (via `display: none` / `display: flex` controlado no CSS), colapsando a linha de metadados se vazia.
  * O botão de alternância do nome do arquivo (`.btn-toggle-filename`) também foi ocultado por padrão e exibido apenas no hover, removendo o espaçamento indesejado à esquerda do texto.
  * Adicionado `align-items: start !important` no grid para evitar que os cards estiquem de forma desigual verticalmente.