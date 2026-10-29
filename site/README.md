# Site de apresentação do CapIAu-Talho

Site estático que apresenta o Talho, convida a usar (grátis, sem assinatura, código aberto) e a
contribuir com o desenvolvimento. HTML, CSS e JavaScript puros — sem build, sem framework, sem CDN e
sem fontes externas, no mesmo espírito do programa.

## Páginas

| Arquivo | Conteúdo |
| :--- | :--- |
| `index.html` | Início: o que é, recursos em destaque, grátis de verdade, privacidade, exportação, comunidade |
| `recursos.html` | Catálogo dos recursos, com uma demo animada por grupo |
| `como-funciona.html` | Camadas, o caminho da mídia do disco à timeline, privacidade, custos, tecnologia e princípios |
| `comecar.html` | Baixar, instalar (Docker ou Python local), chaves, modelos locais, primeiros passos e problemas comuns |
| `contribuir.html` | Por que contribuir, formas de ajudar, roadmap, primeiro PR, ambiente, testes, padrões e licença |
| `404.html` | "Corte perdido" — servida pelo GitHub Pages em endereços inexistentes |

## Ver no seu computador

Qualquer servidor estático serve. Com o Python que o projeto já usa:

```bash
cd site
python -m http.server 8080
```

Abra <http://localhost:8080>. Abrir o `index.html` direto no navegador também funciona, mas o
servidor é o mais parecido com a publicação.

## Publicar

O workflow [`.github/workflows/site.yml`](../.github/workflows/site.yml) publica esta pasta no
**GitHub Pages** a cada push na `main` que mexa em `site/` (ou manualmente, pela aba *Actions*).
Uma vez só, no GitHub: **Settings › Pages › Build and deployment › Source: GitHub Actions**.

Endereço esperado: <https://fernangcortes.github.io/capiau-talho-v03/>. Se publicar em outro
domínio, troque a URL absoluta do `og:image` no `<head>` das páginas.

## Estrutura

```
site/
├── *.html                 uma página por arquivo, todas na raiz (links relativos)
├── _modelo.html           ponto de partida para página nova (não é publicado)
└── assets/
    ├── css/base.css       tokens, componentes e o sistema de animação (todas as páginas)
    ├── css/<pagina>.css   o que é só de uma página
    ├── js/base.js         comportamento compartilhado e a API window.Talho
    ├── js/<pagina>.js     demos e animações de uma página
    ├── fonts/             Inter e Barlow Semi Condensed (SIL OFL 1.1, as mesmas de src/ui/fonts)
    └── img/               logo, ícones e a imagem de compartilhamento (og-image.png)
```

## Regras da casa

- **Cabeçalho, rodapé e `<head>` são idênticos** em todas as páginas; só mudam `<title>`, descrição,
  `data-page` e o CSS/JS da página. O `base.js` marca no menu a página atual.
- **Cores e fontes vêm dos tokens** do `base.css` (`--cyan`, `--violet`, `--emerald`, `--amber`,
  `--rose`, `--font-display`…), com a mesma semântica do programa: ciano para interação, violeta
  para IA, esmeralda para sucesso/local, âmbar para alerta, rose para corte e agulha.
- **Toda animação respeita "movimento desligado"** (`html[data-motion="off"]`), que vem da
  preferência do sistema ou do botão *Pausar animações*. O estilo base de cada elemento precisa ser
  um estado estático legível; laços em JS usam `Talho.loop`, que só roda com o elemento na tela.
- **Nada inventado.** Números e afirmações saem do README, de `docs/`, da wiki ou do código.
  Mockups da interface são ilustrações, não capturas de tela.
- **Acessível e leve:** um `<h1>` por página, títulos em ordem, visuais decorativos com
  `aria-hidden`, demos operáveis por teclado, sem rolagem horizontal de 320 px a 1920 px.

## Animação: o que já vem pronto

| Recurso | Como usar |
| :--- | :--- |
| Revelar ao rolar | `data-reveal` (`up`, `fade`, `left`, `right`, `scale`, `blur`, `clip`); atraso com `style="--d: 120ms"` ou `data-reveal-stagger="80"` no pai |
| Gatilho para CSS próprio | `data-inview` adiciona `.is-in` quando o elemento aparece |
| Contador | `<span data-count-to="44" data-count-suffix="×">44×</span>` (+ `-from`, `-decimals`, `-prefix`, `-duration`) |
| O talho (linha de laser) | `<div class="talho-cut" data-inview></div>` |
| Laço de animação | `Talho.loop(el, (t, dt) => { … })` — pausa fora da tela, na aba oculta e com movimento desligado |
| Canvas nítido | `Talho.fitCanvas(canvas)` devolve `{ ctx, width, height, dpr }` |
| Outros | `Talho.onVisible`, `Talho.onResize`, `Talho.motion`, `Talho.timecode`, `Talho.toast`, `Talho.copy`, `Talho.math` |

Componentes de interface (`.btn`, `.card`, `.chip`, `kbd`, `.code` com botão de copiar, abas
`[data-tabs]`, subnavegação `[data-subnav]`, `.faq`, `.callout`, `.table`, `.cta-band`…) estão
documentados nos comentários do `base.css` e usados no `_modelo.html`.

## Página nova

1. Copie `_modelo.html`, troque `TITULO`, `DESCRICAO` e `PAGINA`.
2. Crie `assets/css/<pagina>.css` e `assets/js/<pagina>.js`.
3. Se ela entrar no menu, acrescente o link no cabeçalho e no rodapé de **todas** as páginas.
4. Confira em 1440 px e 390 px, com e sem animações, antes de abrir o PR.
