# -*- coding: utf-8 -*-
"""Corrige grafias de nome próprio nos textos que a IA gera a partir da transcrição.

Por que existe: o ASR erra nome próprio com frequência e o resumo automático herda
o erro — a legenda ouve "Baiar" no lugar de Bayard, "Wambi" no lugar de Zambier,
"Virgínia" no lugar de Virshna. Como `generate_video_summary` reescreve
title/description/summary/tags a cada transcrição, corrigir à mão depois não
resolve: o erro volta no próximo reprocessamento.

Por isso a correção roda **antes da gravação**, dentro da geração do resumo. Assim
o texto errado nunca chega ao banco — e o histórico de decupagem não ganha uma
segunda versão a cada rodada só para consertar nome.

## De onde vêm as regras

Do banco: a coluna `aliases` de `entity` (entity_type='person') e de `person`.
`entity` é a que tem caminho de edição de verdade — PATCH em
`src/api/routes/entities.py` e a fusão de entidades, que transforma nomes antigos
em aliases da sobrevivente. `person` é lida junto porque o schema tem a coluna e
é onde a rotulagem de rostos cria as pessoas.

Cada item de `aliases` pode ser:

    "Baiar"                                   -> troca por `name` da linha
    {"errado": "Johnny", "certo": "Jones"}    -> troca explícita
    {"errado": "Virg[íi]nia", "certo": "Virshna", "regex": true}

A forma explícita existe porque o nome do catálogo NÃO serve como texto em prosa:
lá as pessoas estão como "Jones Ator", "Millie Maquiagem", "Bruno Zambier Som".
Escrever "o ator Jones Ator" seria pior que o erro original.

`SEMENTE` abaixo só entra em cena quando o projeto ainda não tem alias nenhum
cadastrado — é o estado de instalação nova. Depois de semear
(`python -m scripts.corrigir_nomes_gerados --semear --project N`) o banco manda,
e editar um nome deixa de exigir mexer em código.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Regras que NÃO são apelido de pessoa e por isso não cabem em `aliases`.
# Sempre aplicadas, venham as outras de onde vierem.
REGRAS_GERAIS: Dict[str, str] = {
    # "Pamela Sheila" saiu de uma brincadeira da entrevistada, que emenda
    # "Mentira" logo depois e se apresenta como Suzana. A IA tomou como fato.
    r"\s*\(Pamela Sheila\)": "",
}

# Bootstrap: o que valia quando o mapa era constante no script. Usado apenas
# enquanto o projeto não tiver alias nenhum no banco. Chave é regex com \b.
# A ORDEM IMPORTA: nome composto antes do primeiro nome sozinho, senão
# "Johnny Schneider" viraria "Jones Schneider" pela metade.
SEMENTE: Dict[str, str] = {
    r"\bBaiar\b": "Bayard",
    r"\bYasmin\b": "Yasmim",
    r"\bWambier\b": "Zambier",
    r"\bWambi\b": "Zambier",
    r"\bVirg[íi]nia\b": "Virshna",
    r"\bEmily Montenegro\b": "Millie",
    r"\bEmily\b": "Millie",
    r"\bJohnny Schneider\b": "Jones Schneider",
    r"\bJohnny\b": "Jones",
    r"\bEmíli[ao] Montenegro\b": "Millie",
    r"\bEmília\b": "Millie",
    r"\bMili\b": "Millie",
    r"\bTiago Mois[ée]s\b": "Thiago Moyses",
}

# Mantido para quem importava o nome antigo; o conteúdo agora é a semente.
GRAFIAS_ERRADAS = SEMENTE

# (campo, o_que_estava, o_que_virou)
Troca = Tuple[str, str, str]


# ─────────────────────────────────────────────────────────────────────────────
# Leitura das regras no banco
# ─────────────────────────────────────────────────────────────────────────────

def _regra_de_alias(alias: Any, nome_da_linha: Optional[str]) -> Optional[Tuple[str, str]]:
    """Converte um item de `aliases` em (padrão_regex, substituto).

    Devolve None para item inútil (vazio, sem alvo, ou tipo inesperado).
    """
    if isinstance(alias, str):
        errado, certo, e_regex = alias, nome_da_linha, False
    elif isinstance(alias, dict):
        errado = alias.get("errado") or alias.get("wrong") or alias.get("de")
        certo = alias.get("certo") or alias.get("right") or alias.get("para") or nome_da_linha
        e_regex = bool(alias.get("regex"))
    else:
        return None

    if not isinstance(errado, str) or not errado.strip():
        return None
    if certo is None or not isinstance(certo, str):
        return None
    # Substituto vazio é legítimo (remover um trecho), mas alias vazio não.

    corpo = errado if e_regex else re.escape(errado)
    return (rf"\b{corpo}\b", certo)


def _aliases_da_tabela(conn: sqlite3.Connection, tabela: str, project_id: int) -> List[Tuple[str, str]]:
    """Lê (name, aliases) de `person` ou de `entity` (só pessoas) do projeto."""
    if tabela == "entity":
        # Só entidade CONFIRMADA pelo usuário. `suggested` é palpite da própria IA,
        # e usar palpite para reescrever texto inverteria o propósito disto aqui:
        # corrigir erro de máquina com nome verificado por gente.
        sql = ("SELECT name, aliases FROM entity "
               "WHERE project_id = ? AND entity_type = 'person' "
               "AND status = 'confirmed' AND aliases IS NOT NULL")
    else:
        sql = "SELECT name, aliases FROM person WHERE project_id = ? AND aliases IS NOT NULL"

    try:
        linhas = conn.execute(sql, (project_id,)).fetchall()
    except sqlite3.Error:
        return []  # tabela/coluna ausente num banco antigo não pode derrubar a gravação

    regras: List[Tuple[str, str]] = []
    for linha in linhas:
        nome, bruto = linha[0], linha[1]
        try:
            itens = json.loads(bruto) if isinstance(bruto, str) else bruto
        except (ValueError, TypeError):
            continue
        if not isinstance(itens, (list, tuple)):
            continue
        for item in itens:
            regra = _regra_de_alias(item, nome)
            if regra:
                regras.append(regra)
    return regras


def carregar_regras(project_id: int, conn: Optional[sqlite3.Connection] = None) -> Dict[str, str]:
    """Monta o mapa de correção do projeto: banco + regras gerais.

    Sem nenhum alias cadastrado, cai na SEMENTE — é o estado de projeto novo (ou
    ainda não semeado), e nesse caso deixar de corrigir seria pior que corrigir
    com um mapa embutido.

    Ordena as regras da mais longa para a mais curta: "Johnny Schneider" tem de
    ser testada antes de "Johnny", senão sobra o sobrenome errado.
    """
    if conn is None:
        from src.db.connection import get_db
        with get_db() as propria:
            return carregar_regras(project_id, propria)

    do_banco = _aliases_da_tabela(conn, "entity", project_id)
    do_banco += _aliases_da_tabela(conn, "person", project_id)

    if not do_banco:
        return {**SEMENTE, **REGRAS_GERAIS}

    # Mais específica primeiro; dedup preservando a primeira ocorrência
    do_banco.sort(key=lambda r: len(r[0]), reverse=True)
    regras: Dict[str, str] = {}
    for padrao, certo in do_banco:
        regras.setdefault(padrao, certo)
    regras.update(REGRAS_GERAIS)
    return regras


def _regras_padrao() -> Dict[str, str]:
    """Mapa usado quando o chamador não passa nada — sem tocar no banco."""
    return {**SEMENTE, **REGRAS_GERAIS}


# ─────────────────────────────────────────────────────────────────────────────
# Aplicação
# ─────────────────────────────────────────────────────────────────────────────

def corrigir_texto(
    texto: Any,
    campo: str = "texto",
    regras: Optional[Dict[str, str]] = None,
) -> Tuple[Any, List[Troca]]:
    """Corrige um texto. Devolve (texto_corrigido, trocas).

    Valor não-string volta intacto: a IA às vezes devolve None ou número.
    """
    if not isinstance(texto, str) or not texto:
        return texto, []

    if regras is None:
        regras = _regras_padrao()

    saida = texto
    trocas: List[Troca] = []
    for padrao, certo in regras.items():
        try:
            achados = re.findall(padrao, saida, flags=re.IGNORECASE)
        except re.error:
            continue  # alias inválido vindo do banco não pode derrubar a rodada
        if not achados:
            continue
        saida = re.sub(padrao, certo, saida, flags=re.IGNORECASE)
        for achado in achados:
            trocas.append((campo, achado, certo))
    return saida, trocas


def corrigir_tags(tags: Any, regras: Optional[Dict[str, str]] = None) -> Tuple[Any, List[Troca]]:
    """Corrige uma lista de tags. Preserva o tipo do que entrou."""
    if not isinstance(tags, (list, tuple)):
        return corrigir_texto(tags, "tags", regras)

    saida: List[Any] = []
    trocas: List[Troca] = []
    for tag in tags:
        nova, t = corrigir_texto(tag, "tags", regras)
        saida.append(nova)
        trocas.extend(t)
    return saida, trocas


def corrigir_decupagem(
    title: Any = None,
    description: Any = None,
    summary: Any = None,
    tags: Any = None,
    regras: Optional[Dict[str, str]] = None,
) -> Tuple[Any, Any, Any, Any, List[Troca]]:
    """Corrige os quatro campos da decupagem de uma vez.

    Devolve (title, description, summary, tags, trocas) — cada campo com o mesmo
    tipo que entrou, para poder substituir os valores no lugar sem cerimônia.
    """
    if regras is None:
        regras = _regras_padrao()

    novo_title, t1 = corrigir_texto(title, "title", regras)
    nova_desc, t2 = corrigir_texto(description, "description", regras)
    novo_summary, t3 = corrigir_texto(summary, "summary", regras)
    novas_tags, t4 = corrigir_tags(tags, regras)
    return novo_title, nova_desc, novo_summary, novas_tags, t1 + t2 + t3 + t4


def resumir_trocas(trocas: Sequence[Troca]) -> str:
    """Uma linha legível para log: 'title: Johnny Schneider -> Jones Schneider; ...'."""
    return "; ".join(f"{campo}: {achou} -> {certo}" for campo, achou, certo in trocas)


# ─────────────────────────────────────────────────────────────────────────────
# Semeadura: leva a SEMENTE para o banco, para o mapa deixar de morar no código
# ─────────────────────────────────────────────────────────────────────────────

def _tokens(nome: str) -> List[str]:
    return [t for t in re.split(r"[\s']+", nome or "") if t]


def _melhor_dono(certo: str, catalogo: Sequence[Tuple[int, str]]) -> Optional[Tuple[int, str]]:
    """Escolhe a linha do catálogo a que a regra pertence.

    Casa por tokens do substituto — "Jones Schneider" pertence a "Jones Ator",
    "Zambier" pertence a "Bruno Zambier Som".

    Pontua pela QUANTIDADE de tokens em comum, não pelo primeiro que bater: com
    "primeiro que bate", a regra de "Thiago Moyses" ia parar em "Cristina Moyses",
    porque o sobrenome é compartilhado. Empate desempata pelo nome mais curto,
    que é o mais específico. Sem token em comum, devolve None e o chamador reporta.
    """
    alvos = {t.lower() for t in _tokens(certo)}
    if not alvos:
        return None

    melhor: Optional[Tuple[int, int, int, str]] = None  # (-pontos, len(nome), pid, nome)
    for pid, nome in catalogo:
        pontos = len(alvos & {t.lower() for t in _tokens(nome)})
        if not pontos:
            continue
        candidato = (-pontos, len(nome), pid, nome)
        if melhor is None or candidato < melhor:
            melhor = candidato

    return (melhor[2], melhor[3]) if melhor else None


def semear(
    conn: sqlite3.Connection,
    project_id: int,
    tabela: str = "person",
    aplicar: bool = False,
) -> Dict[str, Any]:
    """Grava a SEMENTE na coluna `aliases`, uma regra por pessoa dona do nome.

    Idempotente: não duplica regra que já esteja lá. Devolve o que casou e o que
    ficou órfão, para o chamador mostrar antes de gravar.
    """
    catalogo = [
        (linha[0], linha[1])
        for linha in conn.execute(
            "SELECT id, name FROM {} WHERE project_id = ?".format(
                "entity" if tabela == "entity" else "person"
            ),
            (project_id,),
        ).fetchall()
        if linha[1]
    ]

    por_dono: Dict[int, List[Dict[str, Any]]] = {}
    casadas: List[Tuple[str, str, str]] = []
    orfas: List[Tuple[str, str]] = []

    for padrao, certo in SEMENTE.items():
        # Desfaz o \b...\b para guardar só o corpo da regra
        corpo = re.sub(r"^\\b|\\b$", "", padrao)
        literal = re.sub(r"\\(.)", r"\1", corpo)
        e_regex = literal != corpo or any(c in corpo for c in "[]()|*+?{}")

        dono = _melhor_dono(certo, catalogo)
        if dono is None:
            orfas.append((corpo, certo))
            continue

        pid, nome = dono
        item: Dict[str, Any] = {"errado": corpo if e_regex else literal, "certo": certo}
        if e_regex:
            item["regex"] = True
        por_dono.setdefault(pid, []).append(item)
        casadas.append((corpo, certo, nome))

    gravadas = 0
    if aplicar:
        for pid, novos in por_dono.items():
            atual_bruto = conn.execute(
                "SELECT aliases FROM {} WHERE id = ?".format(
                    "entity" if tabela == "entity" else "person"
                ),
                (pid,),
            ).fetchone()[0]
            try:
                atuais = json.loads(atual_bruto) if atual_bruto else []
            except (ValueError, TypeError):
                atuais = []
            if not isinstance(atuais, list):
                atuais = []

            existentes = {json.dumps(a, sort_keys=True, ensure_ascii=False) for a in atuais}
            for item in novos:
                chave = json.dumps(item, sort_keys=True, ensure_ascii=False)
                if chave not in existentes:
                    atuais.append(item)
                    existentes.add(chave)
                    gravadas += 1

            conn.execute(
                "UPDATE {} SET aliases = ? WHERE id = ?".format(
                    "entity" if tabela == "entity" else "person"
                ),
                (json.dumps(atuais, ensure_ascii=False), pid),
            )

    return {"casadas": casadas, "orfas": orfas, "gravadas": gravadas, "aplicado": aplicar}
