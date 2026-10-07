"""Grafia dos nomes de pessoas pelo cadastro do projeto (tabelas person e entity).

O ASR escreve o nome como ouviu ("Thiago Moisés") e a IA copia para título e
resumo; o cadastro tem a grafia certa ("Thiago Moyses"). `corrigir_nomes` troca,
no texto, um trecho de 2+ palavras com inicial maiúscula pelo começo de um nome
cadastrado quando o primeiro nome é o mesmo e o resto é parecido. Sem IA, sem custo.

Diferença só de acento ou caixa não é corrigida: a IA costuma acentuar certo e o
cadastro às vezes não ("Joâo Antonio"). Cuidados: nome de uma palavra só ("Rafael") não é corrigido (troca errada é fácil
demais); a função que vem junto no cadastro ("Daniel Ator", "Nina Figurino") não
é acrescentada ao texto, só a grafia das palavras que o texto já tem.
"""
import difflib
import re
import unicodedata
from typing import Iterable, List, Optional, Tuple

SEMELHANCA_MINIMA = 0.85
_PALAVRA = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ'’-]+")


def _base(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()


def _candidatos(nomes: Iterable[str]) -> List[List[str]]:
    vistos, saida = set(), []
    for nome in nomes:
        partes = [p for p in (nome or "").split() if p]
        if len(partes) < 2:
            continue
        chave = " ".join(partes).lower()
        if chave not in vistos:
            vistos.add(chave)
            saida.append(partes)
    return saida


def corrigir_nomes(texto: str, nomes: Iterable[str]) -> str:
    return corrigir_nomes_com_trocas(texto, nomes)[0]


def corrigir_nomes_com_trocas(texto: str, nomes: Iterable[str]) -> Tuple[str, List[Tuple[str, str]]]:
    """Devolve (texto corrigido, [(o que estava, o que virou)])."""
    if not texto:
        return texto, []
    candidatos = _candidatos(nomes)
    if not candidatos:
        return texto, []
    palavras = list(_PALAVRA.finditer(texto))
    trocas: List[Tuple[int, int, str]] = []
    i = 0
    while i < len(palavras):
        achados: List[Tuple[float, int, str]] = []
        for partes in candidatos:
            for k in range(min(len(partes), len(palavras) - i), 1, -1):
                janela = palavras[i:i + k]
                if not all(w.group()[0].isupper() for w in janela):
                    continue
                if _base(janela[0].group()) != _base(partes[0]):
                    continue
                trecho = " ".join(w.group() for w in janela)
                alvo = " ".join(partes[:k])
                if _base(trecho) == _base(alvo):
                    # só acento/caixa: o texto fica (o cadastro tem erro de acento, ex.: "Joâo")
                    achados.append((2.0, k, trecho))
                    break
                nota = difflib.SequenceMatcher(None, _base(trecho), _base(alvo)).ratio()
                if nota >= SEMELHANCA_MINIMA:
                    achados.append((nota, k, alvo))
                    break  # a janela mais longa que passou basta para este nome
        achados.sort(reverse=True)
        # dois nomes diferentes igualmente parecidos: na dúvida, não troca
        unico = achados and not (len(achados) > 1 and achados[1][:2] == achados[0][:2] and achados[1][2] != achados[0][2])
        if unico:
            _, k, alvo = achados[0]
            ini, fim = palavras[i].start(), palavras[i + k - 1].end()
            if texto[ini:fim] != alvo:
                trocas.append((ini, fim, alvo))
            i += k
        else:
            i += 1
    feitas = [(texto[ini:fim], alvo) for ini, fim, alvo in trocas]
    for ini, fim, alvo in reversed(trocas):
        texto = texto[:ini] + alvo + texto[fim:]
    return texto, feitas
