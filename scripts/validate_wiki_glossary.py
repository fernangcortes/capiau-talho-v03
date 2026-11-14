#!/usr/bin/env python3
"""validate_wiki_glossary.py — Auditoria e Validação Automatizada do Capítulo 18 da Wiki do CapIAu-Talho.

Este script audita de ponta a ponta:
1. Existência e tamanho de arquivos da Wiki (18.-Glossario-Visual-e-Terminologia.md, _Sidebar.md, Home.md).
2. Existência e integridade XML dos 4 diagramas SVG Dark Glassmorphism em wiki/images/.
3. Contagem e completude dos verbetes do glossário (assert >= 50 termos detalhados com Definição, Aplicação e Analogia).
4. Conformidade de tabelas GFM Pipe Tables (| col | col |).
5. Conformidade das regras KaTeX (ausência de underlines desprotegidos em tags \text{}).
6. Validação dos links de navegação em _Sidebar.md, Home.md e no índice A-Z.
7. Verificação de caminhos relativos dos diagramas SVG embutidos.
8. Todo caminho `src/...` (e `scripts/`, `docs/`, `.agents/`) citado existe no repositório; referências
   `arquivo:linha` apontam para uma linha existente.
9. Toda âncora interna (`](#id)`) existe, como `<a id="...">` ou como slug de título no padrão do GitHub.
10. A contagem de verbetes anunciada no cabeçalho (selo e texto) é igual ao número real de verbetes.
11. Todo verbete tem um Nível (Básico, Editor ou Técnico) e aparece no índice A-Z completo.
12. Títulos H2/H3 não começam com emoji; não há LaTeX ($...$) no texto.
13. Funções citadas entre crases, como `nome()`, existem no código-fonte.

Uso:
    python scripts/validate_wiki_glossary.py [--verbose] [--no-color]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Tuple, Dict, Any

# Garante saída UTF-8 no console Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    DIM = "\033[2m"

    @classmethod
    def disable(cls) -> None:
        cls.RESET = ""
        cls.BOLD = ""
        cls.RED = ""
        cls.GREEN = ""
        cls.YELLOW = ""
        cls.BLUE = ""
        cls.CYAN = ""
        cls.DIM = ""


class ValidationReport:
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.passed: List[str] = []
        self.failed: List[Tuple[str, str]] = []
        self.warnings: List[str] = []

    def test(self, name: str, condition: bool, error_msg: str = "") -> bool:
        if condition:
            self.passed.append(name)
            if self.verbose:
                print(f"  {Colors.GREEN}✓ [PASS]{Colors.RESET} {name}")
            return True
        else:
            self.failed.append((name, error_msg))
            print(f"  {Colors.RED}✗ [FAIL]{Colors.RESET} {name}: {error_msg}")
            return False

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        print(f"  {Colors.YELLOW}⚠ [WARN]{Colors.RESET} {msg}")

    def summary(self) -> int:
        print("\n" + "=" * 70)
        print(f"{Colors.BOLD}RELATÓRIO DE AUDITORIA DO GLOSSÁRIO VISUAL E WIKI (CAPÍTULO 18){Colors.RESET}")
        print("=" * 70)
        print(f"Total de Testes Executados: {len(self.passed) + len(self.failed)}")
        print(f"{Colors.GREEN}Testes Aprovados:{Colors.RESET} {len(self.passed)}")
        if self.failed:
            print(f"{Colors.RED}Falhas Encontradas:{Colors.RESET} {len(self.failed)}")
            for name, err in self.failed:
                print(f"  - {Colors.RED}{name}{Colors.RESET}: {err}")
        else:
            print(f"{Colors.GREEN}Nenhuma falha encontrada. 100% de conformidade técnica!{Colors.RESET}")
        if self.warnings:
            print(f"{Colors.YELLOW}Avisos:{Colors.RESET} {len(self.warnings)}")
        print("=" * 70)
        return 0 if len(self.failed) == 0 else 1


EXPECTED_SVGS = [
    "diagrama_ripple_vs_roll_trim.svg",
    "diagrama_lufs_vs_dbfs_audio.svg",
    "diagrama_busca_vetorial_embeddings.svg",
    "diagrama_estrutura_faixas_otio.svg",
]


def audit_files_and_sizes(root_dir: Path, report: ValidationReport) -> Tuple[str, str, str]:
    wiki_dir = root_dir / "wiki"
    images_dir = wiki_dir / "images"

    chap18_path = wiki_dir / "18.-Glossario-Visual-e-Terminologia.md"
    sidebar_path = wiki_dir / "_Sidebar.md"
    home_path = wiki_dir / "Home.md"

    # 1. Arquivo principal do capítulo 18
    report.test("Arquivo 18.-Glossario-Visual-e-Terminologia.md existe", chap18_path.is_file(), f"Não encontrado em {chap18_path}")
    if chap18_path.is_file():
        size = chap18_path.stat().st_size
        report.test("Tamanho substancial de 18.-Glossario-Visual-e-Terminologia.md (> 20 KB)", size > 20000, f"Arquivo possui apenas {size} bytes")
        content_18 = chap18_path.read_text(encoding="utf-8")
    else:
        content_18 = ""

    # 2. _Sidebar.md
    report.test("Arquivo wiki/_Sidebar.md existe", sidebar_path.is_file(), f"Não encontrado em {sidebar_path}")
    content_sidebar = sidebar_path.read_text(encoding="utf-8") if sidebar_path.is_file() else ""

    # 3. Home.md
    report.test("Arquivo wiki/Home.md existe", home_path.is_file(), f"Não encontrado em {home_path}")
    content_home = home_path.read_text(encoding="utf-8") if home_path.is_file() else ""

    # 4. Checagem dos 4 SVGs
    for svg_name in EXPECTED_SVGS:
        svg_path = images_dir / svg_name
        report.test(f"Arquivo SVG wiki/images/{svg_name} existe", svg_path.is_file(), f"Não encontrado em {svg_path}")
        if svg_path.is_file():
            svg_size = svg_path.stat().st_size
            report.test(f"Tamanho de {svg_name} é substancial (> 5 KB)", svg_size > 5000, f"Arquivo possui apenas {svg_size} bytes")

    return content_18, content_sidebar, content_home


def audit_svg_xml_syntax(root_dir: Path, report: ValidationReport) -> None:
    images_dir = root_dir / "wiki" / "images"
    for svg_name in EXPECTED_SVGS:
        svg_path = images_dir / svg_name
        if not svg_path.is_file():
            continue

        try:
            tree = ET.parse(str(svg_path))
            root = tree.getroot()
            tag = root.tag
            is_svg_tag = tag == "svg" or tag.endswith("}svg")
            report.test(f"SVG {svg_name} possui tag raiz <svg>", is_svg_tag, f"Tag raiz encontrada: {tag}")

            # Atributo viewBox
            viewbox = root.attrib.get("viewBox") or root.attrib.get("viewbox")
            report.test(f"SVG {svg_name} possui atributo viewBox responsivo", bool(viewbox), "viewBox ausente na tag <svg>")

            # Presença de elementos gráficos essenciais
            raw_text = svg_path.read_text(encoding="utf-8")
            has_defs = "<defs" in raw_text
            has_rect = "<rect" in raw_text
            has_text = "<text" in raw_text
            report.test(f"SVG {svg_name} contém defs, gradientes ou filtros", has_defs, "Nenhum bloco <defs> encontrado")
            report.test(f"SVG {svg_name} contém retângulos e textos", has_rect and has_text, "Elementos <rect> ou <text> ausentes")

            # Sem tags <br> inválidas dentro de <text>
            has_br_inside_text = bool(re.search(r"<text[^>]*>.*?<br\s*/?>.*?</text>", raw_text, re.DOTALL | re.IGNORECASE))
            report.test(f"SVG {svg_name} não contém tags <br> ilegais em <text>", not has_br_inside_text, "Encontrada tag <br> dentro de <text>")

        except ET.ParseError as e:
            report.test(f"Sintaxe XML válida em {svg_name}", False, f"Erro de parsing XML: {e}")
        except Exception as e:
            report.test(f"Leitura de {svg_name}", False, f"Exceção inesperada: {e}")


def audit_glossary_terms(content_18: str, report: ValidationReport) -> None:
    # Localiza cabeçalhos de termos: '### N. Nome'
    term_pattern = re.compile(r"^###\s+(\d+)\.\s+(.+)$", re.MULTILINE)
    matches = list(term_pattern.finditer(content_18))
    term_count = len(matches)

    report.test(f"Contagem mínima de termos no glossário (assert >= 50, encontrados: {term_count})", term_count >= 50, f"Apenas {term_count} termos encontrados")

    # Divide o documento em seções de termos para auditar conteúdo
    sections: List[Tuple[str, str]] = []
    for i, match in enumerate(matches):
        term_title = match.group(2).strip()
        start_pos = match.end()
        end_pos = matches[i + 1].start() if i + 1 < len(matches) else len(content_18)
        term_body = content_18[start_pos:end_pos]
        sections.append((term_title, term_body))

    terms_missing_def = []
    terms_missing_usage = []
    terms_missing_analogy = []

    for title, body in sections:
        # Definição semântica
        if not re.search(r"\*?\*?Definição (?:Semântica|Técnica)\*?\*?:?", body, re.IGNORECASE):
            terms_missing_def.append(title)

        # Aplicação prática no Talho
        if not re.search(r"\*?\*?(?:Aplicação (?:no CapIAu-Talho|Prática|Técnica|no Talho)|No código)[^*\n]*\*?\*?:?", body, re.IGNORECASE):
            terms_missing_usage.append(title)

        # Analogia didática
        if not re.search(r"\*?\*?Analogia (?:Didática|Cotidiana|Prática)\*?\*?:?", body, re.IGNORECASE):
            terms_missing_analogy.append(title)

    report.test("Todos os termos possuem seção de Definição Semântica", len(terms_missing_def) == 0, f"Termos sem definição: {terms_missing_def[:5]}")
    report.test("Todos os termos possuem seção de Aplicação no Talho", len(terms_missing_usage) == 0, f"Termos sem aplicação: {terms_missing_usage[:5]}")
    report.test("Todos os termos possuem seção de Analogia Didática", len(terms_missing_analogy) == 0, f"Termos sem analogia: {terms_missing_analogy[:5]}")


def audit_gfm_tables(content_18: str, report: ValidationReport) -> None:
    lines = content_18.splitlines()
    in_table = False
    table_rows: List[str] = []
    tables_found = 0
    pipe_syntax_errors = 0

    for line_idx, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            if not in_table:
                in_table = True
                table_rows = [stripped]
            else:
                table_rows.append(stripped)
        else:
            if in_table:
                in_table = False
                tables_found += 1
                # Valida tabela coletada
                if len(table_rows) >= 2:
                    header = table_rows[0]
                    separator = table_rows[1]
                    # Separator deve conter traços e pipes
                    if not re.match(r"^\|(\s*:?-+:?\s*\|)+$", separator):
                        pipe_syntax_errors += 1
                else:
                    pipe_syntax_errors += 1
                table_rows = []

    report.test(f"Tabelas GFM Pipe Tables presentes no documento (encontradas: {tables_found})", tables_found >= 8, f"Esperadas pelo menos 8 tabelas temáticas, encontradas {tables_found}")
    report.test("Sintaxe GFM válida em todas as tabelas (sem quebras irregulares)", pipe_syntax_errors == 0, f"Detectados {pipe_syntax_errors} blocos com erro de tabela")

    # Proibição estrita de tabelas antigas tipo Grid (+---+)
    grid_table_match = re.search(r"\+[= -]+\+", content_18)
    report.test("Ausência de Grid Tables obsoletas (+---+)", grid_table_match is None, "Detectado padrão de grid table não suportado pelo GitHub")


def audit_katex_formulas(content_18: str, report: ValidationReport) -> None:
    # Procura por fórmulas matemáticas com delimitadores $ ou $$
    math_patterns = [
        re.compile(r"\$\$(.*?)\$\$", re.DOTALL),
        re.compile(r"(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)", re.DOTALL),
    ]

    invalid_text_underscores = []
    for pattern in math_patterns:
        for match in pattern.finditer(content_18):
            formula = match.group(1)
            # Procura por \text{..._...}
            text_matches = re.finditer(r"\\text\{([^}]*)\}", formula)
            for tm in text_matches:
                inner_text = tm.group(1)
                if "_" in inner_text and not r"\_" in inner_text:
                    invalid_text_underscores.append(f"\\text{{{inner_text}}}")

    report.test("Conformidade KaTeX: sem underlines soltos dentro de \\text{...}", len(invalid_text_underscores) == 0, f"Expressões inválidas encontradas: {invalid_text_underscores[:5]}")

    # Sem escapes acidentais de cifrão \$
    has_escaped_dollar = r"\$" in content_18
    report.test("Conformidade KaTeX: sem escapes acidentais de cifrão (\\$)", not has_escaped_dollar, "Detectada barra invertida antes de cifrão")

    # Zero blocos Mermaid
    has_mermaid = "```mermaid" in content_18
    report.test("Zero dependência de blocos Mermaid suscetíveis a bugs no GitHub", not has_mermaid, "Detectado bloco de código ```mermaid")


def audit_navigation_and_links(content_18: str, content_sidebar: str, content_home: str, report: ValidationReport) -> None:
    # 1. _Sidebar.md deve conter link canônico para o Capítulo 18
    sidebar_has_link = ("18.-Glossario-Visual-e-Terminologia" in content_sidebar and "18. Glossário Visual e Terminologia" in content_sidebar)
    report.test("Link do Capítulo 18 presente em wiki/_Sidebar.md", sidebar_has_link, "Link para Capítulo 18 ausente na barra lateral")

    # 2. Home.md deve conter link para o Capítulo 18 na tabela de módulos
    home_has_link = "18.-Glossario-Visual-e-Terminologia" in content_home
    report.test("Link do Capítulo 18 presente na tabela de módulos de wiki/Home.md", home_has_link, "Link para Capítulo 18 ausente em Home.md")

    # 3. Referências às 4 imagens SVG dentro de 18.-Glossario-Visual-e-Terminologia.md
    for svg_name in EXPECTED_SVGS:
        rel_path = f"images/{svg_name}"
        has_svg_ref = rel_path in content_18
        report.test(f"Referência relativa a {rel_path} no Capítulo 18", has_svg_ref, f"Caminho {rel_path} não referenciado no texto")

    # 4. Índice Remissivo A-Z: âncoras internas
    az_links = re.findall(r"\[\*\*[A-Z0-9-]+\*\*\]\(#(letra-[a-z0-9-]+)\)", content_18)
    report.test(f"Índice Remissivo A-Z no topo funcional (links para letras: {len(az_links)})", len(az_links) >= 15, f"Apenas {len(az_links)} links de letras encontrados")

    # Verifica se as âncoras de destino <a id="letra-x"></a> existem
    for link_id in az_links:
        anchor_tag = f'<a id="{link_id}"></a>'
        has_anchor = anchor_tag in content_18
        if not has_anchor:
            report.test(f"Âncora de destino {anchor_tag} existe no documento", False, f"Âncora {anchor_tag} não encontrada no texto")
            break
    else:
        report.test("Todas as âncoras de letras A-Z existem no documento", True)


NIVEIS_VALIDOS = ("Básico", "Editor", "Técnico")
ANCHOR_RE = re.compile(r'<a id="([^"]+)"></a>')


def github_slug(titulo: str) -> str:
    """Slug de título no padrão do GitHub: minúsculas, mantém acentos, remove pontuação, espaço vira hífen."""
    t = re.sub(r"[`*_]", "", titulo.strip().lower())
    t = re.sub(r"[^\w\s-]", "", t, flags=re.UNICODE)
    return t.replace(" ", "-")


def audit_terms_header_levels(content_18: str, report: ValidationReport) -> None:
    """(c) contagem do cabeçalho = verbetes reais; (d) todo verbete tem nível; índice completo."""
    heads = list(re.finditer(r"^###\s+(\d+)\.\s+(.+)$", content_18, re.MULTILINE))
    total = len(heads)
    nums = [int(m.group(1)) for m in heads]
    report.test("Numeração dos verbetes é sequencial (1..N)", nums == list(range(1, total + 1)), f"Numeração fora de ordem: {nums[:8]}...")

    badge = re.search(r"Termos_Explicados-(\d+)_Completos", content_18)
    report.test("Selo de contagem de verbetes presente no cabeçalho", badge is not None, "Selo 'Termos_Explicados-N_Completos' ausente")
    if badge:
        report.test(f"Selo do cabeçalho ({badge.group(1)}) = verbetes reais ({total})", int(badge.group(1)) == total, f"Selo diz {badge.group(1)}, existem {total}")
    texto = re.search(r"\*\*(\d+) verbetes\*\*", content_18)
    report.test("Texto de apresentação informa a contagem de verbetes", texto is not None, "Trecho '**N verbetes**' ausente")
    if texto:
        report.test(f"Contagem na apresentação ({texto.group(1)}) = verbetes reais ({total})", int(texto.group(1)) == total, f"Texto diz {texto.group(1)}, existem {total}")

    sem_nivel = []
    nivel_invalido = []
    for i, m in enumerate(heads):
        fim = heads[i + 1].start() if i + 1 < total else len(content_18)
        corpo = content_18[m.end():fim]
        mn = re.search(r"^\* \*\*Nível:\*\*\s*(\S+)", corpo, re.MULTILINE)
        if not mn:
            sem_nivel.append(m.group(2).strip())
        elif mn.group(1) not in NIVEIS_VALIDOS:
            nivel_invalido.append(f"{m.group(2).strip()} ({mn.group(1)})")
    report.test("Todo verbete tem selo de Nível", not sem_nivel, f"Sem nível: {sem_nivel[:5]}")
    report.test("Todo Nível é Básico, Editor ou Técnico", not nivel_invalido, f"Níveis inválidos: {nivel_invalido[:5]}")

    # Todo verbete precisa de âncora própria e aparecer no índice completo A-Z
    ids = []
    for m in heads:
        antes = content_18[:m.start()].rstrip().split("\n")[-1]
        ma = ANCHOR_RE.fullmatch(antes.strip())
        ids.append(ma.group(1) if ma else None)
    report.test("Todo verbete tem âncora <a id> imediatamente antes do título", all(ids), f"Verbetes sem âncora: {ids.count(None)}")
    idx_pos = content_18.find("Índice Remissivo Completo de A a Z")
    indice = content_18[idx_pos:] if idx_pos >= 0 else ""
    fora = [i for i in ids if i and f"](#{i})" not in indice]
    report.test("Todo verbete aparece no índice A-Z completo", not fora, f"Fora do índice: {fora[:5]}")
    dup = {i for i in ids if i and ids.count(i) > 1}
    report.test("Âncoras de verbetes são únicas", not dup, f"Duplicadas: {sorted(dup)}")


def audit_anchors(content_18: str, report: ValidationReport) -> None:
    """(b) toda âncora interna existe como <a id> ou como slug de título do GitHub."""
    ids = set(ANCHOR_RE.findall(content_18))
    slugs = set()
    contagem: Dict[str, int] = {}
    for m in re.finditer(r"^#{1,6}\s+(.+)$", content_18, re.MULTILINE):
        base = github_slug(m.group(1))
        n = contagem.get(base, 0)
        slugs.add(base if n == 0 else f"{base}-{n}")
        contagem[base] = n + 1
    quebrados = []
    for m in re.finditer(r"\]\(#([^)\s]+)\)", content_18):
        alvo = m.group(1)
        if alvo not in ids and alvo not in slugs:
            quebrados.append(alvo)
    report.test("Toda âncora interna (índices, eixos, 'Veja também') existe", not quebrados, f"Âncoras inexistentes: {sorted(set(quebrados))[:8]}")
    eixos = [f"eixo-{n}" for n in range(1, 9)]
    ausentes = [e for e in eixos if e not in ids]
    report.test("Âncoras <a id=\"eixo-N\"> existem para os 8 eixos", not ausentes, f"Ausentes: {ausentes}")
    em_eixos = [e for e in eixos if f"](#{e})" not in content_18]
    report.test("Índice de eixos aponta para as âncoras eixo-N", not em_eixos, f"Eixos sem link: {em_eixos}")


def audit_headings_style(content_18: str, report: ValidationReport) -> None:
    emoji_re = re.compile(r"^[\U0001F000-\U0001FFFF\u2600-\u27BF\uFE0F]")
    ruins = []
    for m in re.finditer(r"^(#{1,6})\s+(.+)$", content_18, re.MULTILINE):
        if emoji_re.match(m.group(2)):
            ruins.append(m.group(2)[:30])
    report.test("Títulos não começam com emoji (preserva as âncoras do GitHub)", not ruins, f"Títulos com emoji: {ruins[:4]}")
    report.test("Sem LaTeX ($...$) no texto corrido", not re.search(r"\$[^$\n]+\$", content_18), "Encontrado trecho entre cifrões")


PATH_RE = re.compile(r"(?<![\w/.-])((?:src|scripts|docs|\.agents|wiki)/[\w./-]*[\w-]\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?")


def audit_code_paths(root_dir: Path, content_18: str, report: ValidationReport) -> None:
    """(a) todo caminho citado existe; a linha citada (path:linha) existe no arquivo."""
    inexistentes = []
    linha_ruim = []
    vistos = set()
    for m in PATH_RE.finditer(content_18):
        caminho, ini = m.group(1), m.group(2)
        if "*" in caminho or caminho.startswith("wiki/images/"):
            continue
        alvo = root_dir / caminho
        if (caminho, ini) in vistos:
            continue
        vistos.add((caminho, ini))
        if not alvo.exists():
            inexistentes.append(caminho)
            continue
        if ini and alvo.is_file():
            total = len(alvo.read_text(encoding="utf-8", errors="ignore").splitlines())
            if int(ini) > total:
                linha_ruim.append(f"{caminho}:{ini} (arquivo tem {total} linhas)")
    report.test(f"Todo caminho src/ scripts/ docs/ citado existe (verificados: {len({c for c, _ in vistos})})", not inexistentes, f"Inexistentes: {sorted(set(inexistentes))}")
    report.test("Referências arquivo:linha apontam para linhas existentes", not linha_ruim, f"{linha_ruim[:5]}")


def audit_cited_functions(root_dir: Path, content_18: str, report: ValidationReport) -> None:
    """Funções citadas como `nome()` ou `Classe.nome()` precisam existir em algum arquivo de src/ ou scripts/."""
    corpus_partes: List[str] = []
    for pasta in ("src", "scripts"):
        for arq in (root_dir / pasta).rglob("*"):
            if arq.suffix in (".py", ".js", ".mjs", ".css", ".html"):
                try:
                    corpus_partes.append(arq.read_text(encoding="utf-8", errors="ignore"))
                except OSError:
                    pass
    corpus = "\n".join(corpus_partes)
    nomes = set()
    for m in re.finditer(r"`([A-Za-z_][\w.]*)\(", content_18):
        nomes.add(m.group(1).split(".")[-1])
    ausentes = sorted(n for n in nomes if not re.search(r"\b" + re.escape(n) + r"\b", corpus))
    report.test(f"Funções citadas entre crases existem no código (verificadas: {len(nomes)})", not ausentes, f"Não encontradas: {ausentes[:10]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audita o Capítulo 18 da Wiki do CapIAu-Talho.")
    parser.add_argument("--verbose", action="store_true", help="Exibe detalhes de cada teste aprovado")
    parser.add_argument("--no-color", action="store_true", help="Desativa cores no terminal")
    args = parser.parse_args()

    if args.no_color or os.environ.get("NO_COLOR"):
        Colors.disable()

    root_dir = Path(__file__).resolve().parent.parent
    report = ValidationReport(verbose=args.verbose)

    print(f"{Colors.BOLD}{Colors.CYAN}Iniciando Auditoria Automatizada do Capítulo 18 da Wiki...{Colors.RESET}")
    print(f"Diretório Raiz do Projeto: {root_dir}\n")

    # Etapa 1: Arquivos e tamanhos
    content_18, content_sidebar, content_home = audit_files_and_sizes(root_dir, report)

    if not content_18:
        print(f"{Colors.RED}Aborta: Conteúdo de 18.-Glossario-Visual-e-Terminologia.md não pôde ser lido.{Colors.RESET}")
        return report.summary()

    # Etapa 2: Sintaxe XML dos 4 SVGs
    audit_svg_xml_syntax(root_dir, report)

    # Etapa 3: Termos do Glossário
    audit_glossary_terms(content_18, report)

    # Etapa 4: Tabelas GFM Pipe
    audit_gfm_tables(content_18, report)

    # Etapa 5: KaTeX
    audit_katex_formulas(content_18, report)

    # Etapa 6: Navegação e Links
    audit_navigation_and_links(content_18, content_sidebar, content_home, report)

    # Etapa 7: contagem, níveis, âncoras, estilo de títulos, caminhos e funções citadas
    audit_terms_header_levels(content_18, report)
    audit_anchors(content_18, report)
    audit_headings_style(content_18, report)
    audit_code_paths(root_dir, content_18, report)
    audit_cited_functions(root_dir, content_18, report)

    return report.summary()


if __name__ == "__main__":
    sys.exit(main())
