# Imagens do README

Esta pasta é versionada de propósito (ao contrário de `docs/graficos/`).

## Situação atual

Hoje só existem **SVGs** (diagramas), usados no README e nos documentos:

- `diagrama-fluxo-arquitetura.svg` (usado no README)
- `auphonic-algoritmos.svg`, `auphonic-clustering-flow.svg`
- `mesa-de-montagem-mcp.svg`, `sequencia-fantasma-contracampo.svg`
- `ordem-implementacao-ondas.svg`

Ainda **não há capturas de tela nem GIFs**. O README tem um comentário HTML logo abaixo dos badges
marcando onde eles entram.

## Capturas desejadas (PNG)

| Arquivo | O que mostrar |
|---|---|
| `hero-timeline.png` | Interface completa com a timeline preenchida (imagem de abertura do README) |
| `biblioteca.png` | Biblioteca com o acervo carregado (árvore e/ou galeria) |
| `busca-visual.png` | Resultado de uma busca visual em português |
| `rostos.png` | Tela de rostos e desambiguação |
| `agente.png` | Chat do agente propondo cortes (ghost clips) na timeline |

## GIFs desejados (5 a 10 segundos)

| Arquivo | O que mostrar |
|---|---|
| `gif-ingestao.gif` | Ingestão de uma pasta e primeiros cards aparecendo |
| `gif-busca-visual.gif` | Digitar uma busca e saltar para o trecho no player |
| `gif-trava-pista.gif` | Cadeado de pista (`Shift+L`) impedindo uma edição |
| `gif-camada-facial.gif` | Camada de rostos no Source Player (`Ctrl+Alt+B`, `Alt` para espiar) |
| `gif-mascaras-9x16.gif` | Margens de segurança e máscara 9:16 no Program Player (`Ctrl+Shift+G`, `Ctrl+Alt+G`) |

## Recomendações

- **Capturas:** PNG, largura entre 1280 e 1920 px, até cerca de 500 KB cada (otimize com
  `oxipng` ou `pngquant`). Tema padrão da interface, sem dados pessoais nem chaves visíveis.
- **GIFs:** largura de 800 a 960 px, 10 a 15 fps, no máximo 10 s e até cerca de 3 MB. Se passar
  disso, use WebM/MP4 hospedado fora do repositório.
- **Nomes:** minúsculas, sem acentos, com hífen. Para usar, adicione `![descrição](docs/images/arquivo.png)`
  no README com texto alternativo descritivo.
- **Diagramas:** SVG no estilo escuro dos existentes, sem Mermaid.
