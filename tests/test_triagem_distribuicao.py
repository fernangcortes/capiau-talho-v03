"""Triagem com distribuição pelas categorias e grafia dos nomes pelo cadastro.

Banco SQLite em memória (fixture `banco` de test_ordem_analises); visão falsa.
"""
import json

import pytest

from src.nlp.nomes import corrigir_nomes, corrigir_nomes_com_trocas
from tests.test_ordem_analises import banco  # noqa: F401 (fixture)
from tests.test_taxonomia_categorias import _triagem

CADASTRO = ["Thiago Moyses", "Thiago Ramos Produção", "Daniel Ator", "Cristina Moyses", "Rafael",
            "Joâo Antonio Ator", "Yasmim Sant'Anna"]


# ---------------------------------------------------------------------------
# Distribuição
# ---------------------------------------------------------------------------

def test_triagem_com_distribuicao_usa_a_probabilidade_e_guarda_a_margem(banco, monkeypatch, tmp_path):  # noqa: F811
    r, prompt = _triagem(banco, monkeypatch, tmp_path, {
        "distribuicao": {"bastidor": 0.55, "Convívio": 0.35, "cena": 0.1, "xyz": 0.4},
        "categoria": "bastidor", "titulo": "Montagem da luz", "justificativa": "equipe ajustando refletor"})
    assert '"distribuicao"' in prompt and '"confianca": 0.85' not in prompt, "sem número de exemplo para copiar"
    v = banco.execute("SELECT category, category_confidence, triagem_detalhe FROM video WHERE id = 7").fetchone()
    assert (v["category"], v["category_confidence"]) == ("bastidor", 0.55)
    detalhe = json.loads(v["triagem_detalhe"])
    assert detalhe["distribuicao"] == {"bastidor": 0.55, "convivio": 0.35, "cena": 0.1}, "chave fora da lista sai"
    assert detalhe["margem"] == 0.2 and detalhe["justificativa"] == "equipe ajustando refletor"
    assert r["margem"] == 0.2


def test_distribuicao_que_nao_soma_1_e_normalizada_e_sem_categoria_vale_a_maior(banco, monkeypatch, tmp_path):  # noqa: F811
    r, _ = _triagem(banco, monkeypatch, tmp_path, {"distribuicao": {"cena": 3, "teste": 1}, "titulo": "x"})
    assert (r["categoria"], r["confianca"], r["margem"]) == ("cena", 0.75, 0.5)


def test_sem_distribuicao_cai_na_confianca_de_antes(banco, monkeypatch, tmp_path):  # noqa: F811
    r, _ = _triagem(banco, monkeypatch, tmp_path, {"categoria": "cena", "confianca": 0.7, "titulo": "x"})
    assert (r["confianca"], r["margem"], r["distribuicao"]) == (0.7, None, None)


# ---------------------------------------------------------------------------
# Nomes
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("texto, esperado", [
    ("Thiago Moisés fala sobre o filme", "Thiago Moyses fala sobre o filme"),
    ("Cristina Moisés e Thiago Moises", "Cristina Moyses e Thiago Moyses"),
    ("Equipe ouve Thiago Moisés", "Equipe ouve Thiago Moyses"),
    ("Thiago Moyses fala", "Thiago Moyses fala"),
    ("Thiago Ramos monta a luz", "Thiago Ramos monta a luz"),          # outra pessoa, mesmo primeiro nome
    ("Daniel Ator fala sobre falta de luz", "Daniel Ator fala sobre falta de luz"),
    ("João Antônio ensaia", "João Antônio ensaia"),                    # só acento: o cadastro tem "Joâo"
    ("Rafel na cozinha", "Rafel na cozinha"),                          # nome de uma palavra: não mexe
    ("Thiago fala", "Thiago fala"),
    ("thiago moisés em minúscula", "thiago moisés em minúscula"),      # não é nome próprio no texto
])
def test_corrigir_nomes_pelo_cadastro(texto, esperado):
    assert corrigir_nomes(texto, CADASTRO) == esperado


def test_corrigir_nomes_devolve_as_trocas():
    assert corrigir_nomes_com_trocas("Thiago Moisés e Cristina Moisés", CADASTRO)[1] == [
        ("Thiago Moisés", "Thiago Moyses"), ("Cristina Moisés", "Cristina Moyses")]


def test_titulo_da_triagem_sai_com_a_grafia_do_cadastro(banco, monkeypatch, tmp_path):  # noqa: F811
    banco.execute("INSERT INTO person (project_id, name) VALUES (1, 'Thiago Moyses')")
    banco.commit()
    r, _ = _triagem(banco, monkeypatch, tmp_path, {"distribuicao": {"depoimento": 1.0},
                                                   "titulo": "Thiago Moisés fala sobre o filme"})
    assert r["titulo"] == "Thiago Moyses fala sobre o filme"
    assert banco.execute("SELECT title FROM video WHERE id = 7").fetchone()[0] == "Thiago Moyses fala sobre o filme"


def test_name_fixer_aplica_semelhanca_depois_dos_aliases():
    from src.nlp.name_fixer import corrigir_decupagem
    t, d, s, tags, trocas = corrigir_decupagem("Thiago Moisés fala", "Baiar e Thiago Moisés", None,
                                               ["Thiago Moisés"], {r"\bBaiar\b": "Bayard"}, nomes=CADASTRO)
    assert (t, d, tags) == ("Thiago Moyses fala", "Bayard e Thiago Moyses", ["Thiago Moyses"])
    assert ("description", "Baiar", "Bayard") in trocas and ("title", "Thiago Moisés", "Thiago Moyses") in trocas
