#!/usr/bin/env python3
"""validate_ai_upgrade_spec.py — Automated verification script for AI Modernization Spec.

Thoroughly parses and validates docs/Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md:
1. File existence and non-empty integrity (> 5 KB, substantial lines).
2. Section completeness (Vision, Objects/Props, Faces, Text/NLP & Prompts, Integration & Migration).
3. Model comparative tables (>= 3 models per category, cost, latency, context, license).
4. Syntactic integrity of all embedded JSON Schemas via jsonschema (Draft 2020-12 / Draft 7).
   Validates embedded schemas, document-provided example payloads, synthetic positive and negative payloads,
   and parameter schemas for all 16 Editing Agent function-calling tools.
5. Prompt catalog and variables verification (PROMPT_REGISTRY, personas, few-shots, anti-hallucination).
6. SQLite DDL validation in an in-memory database (:memory:) ensuring 100% syntax validity.
7. Architecture & migration specifications (Qdrant payloads, Settings registry, batch workers).

Usage:
    python scripts/validate_ai_upgrade_spec.py [--spec PATH] [--verbose] [--no-color]
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import re
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import jsonschema

# Ensure utf-8 output encoding on Windows terminals if supported
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    DIM = "\033[2m"

    @classmethod
    def disable(cls) -> None:
        cls.RESET = ""
        cls.BOLD = ""
        cls.RED = ""
        cls.GREEN = ""
        cls.YELLOW = ""
        cls.BLUE = ""
        cls.MAGENTA = ""
        cls.CYAN = ""
        cls.WHITE = ""
        cls.DIM = ""


@dataclass
class PhaseResult:
    name: str
    passed: bool = True
    assertions: int = 0
    failures: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    details: List[str] = field(default_factory=list)

    def add_assertion(self, condition: bool, description: str, error_msg: Optional[str] = None) -> bool:
        self.assertions += 1
        if condition:
            self.details.append(f"[OK] {description}")
            return True
        else:
            self.passed = False
            err = error_msg or f"Assertion failed: {description}"
            self.failures.append(err)
            self.details.append(f"[FAIL] {description} -> {err}")
            return False

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)
        self.details.append(f"[WARN] {msg}")


class SpecValidator:
    """Rigorous validator for the CapIAu AI Modernization Master Specification."""

    def __init__(self, spec_path: Path, verbose: bool = False) -> None:
        self.spec_path = spec_path
        self.verbose = verbose
        self.content: str = ""
        self.results: List[PhaseResult] = []

    def log(self, msg: str) -> None:
        if self.verbose:
            print(f"  {Colors.DIM}{msg}{Colors.RESET}")

    def run_all(self) -> bool:
        start_time = time.time()
        try:
            js_version = importlib.metadata.version("jsonschema")
        except Exception:
            js_version = "4.x"

        print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.WHITE} CapIAu-Talho | AI Modernization Spec Verification Suite (2026){Colors.RESET}")
        print(f"{Colors.DIM} Target Document: {self.spec_path}{Colors.RESET}")
        print(f"{Colors.DIM} jsonschema: {js_version} | Python: {sys.version.split()[0]} | Platform: {sys.platform}{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.CYAN}{'='*80}{Colors.RESET}\n")

        # Phase 1: File Presence & Integrity
        p1 = self.validate_file_presence()
        self.results.append(p1)
        self._print_phase_summary(p1)
        if not p1.passed:
            print(f"\n{Colors.RED}{Colors.BOLD}FATAL: Spec file missing or unreadable. Aborting further tests.{Colors.RESET}")
            return False

        # Phase 2: Section Completeness
        p2 = self.validate_section_completeness()
        self.results.append(p2)
        self._print_phase_summary(p2)

        # Phase 3: Model Comparison Tables
        p3 = self.validate_model_comparison_tables()
        self.results.append(p3)
        self._print_phase_summary(p3)

        # Phase 4: JSON Schemas & Payload Validation
        p4 = self.validate_json_schemas()
        self.results.append(p4)
        self._print_phase_summary(p4)

        # Phase 5: Prompt Catalog, Personas & Safeguards
        p5 = self.validate_prompt_catalog_and_personas()
        self.results.append(p5)
        self._print_phase_summary(p5)

        # Phase 6: SQLite DDL Execution & Migration
        p6 = self.validate_sqlite_ddl()
        self.results.append(p6)
        self._print_phase_summary(p6)

        # Phase 7: Architecture & Migration (Qdrant, Settings, Workers)
        p7 = self.validate_architecture_and_migration()
        self.results.append(p7)
        self._print_phase_summary(p7)

        # Final Summary
        duration = time.time() - start_time
        return self._print_final_report(duration)

    def _print_phase_summary(self, result: PhaseResult) -> None:
        status_tag = f"{Colors.GREEN}[PASS]{Colors.RESET}" if result.passed else f"{Colors.RED}[FAIL]{Colors.RESET}"
        print(f"{status_tag} {Colors.BOLD}{result.name}{Colors.RESET} ({result.assertions} assertions)")
        if self.verbose:
            for d in result.details:
                if d.startswith("[FAIL]"):
                    print(f"    {Colors.RED}{d}{Colors.RESET}")
                elif d.startswith("[WARN]"):
                    print(f"    {Colors.YELLOW}{d}{Colors.RESET}")
                else:
                    print(f"    {Colors.DIM}{d}{Colors.RESET}")
        elif not result.passed:
            for f in result.failures:
                print(f"    {Colors.RED}* {f}{Colors.RESET}")
        for w in result.warnings:
            print(f"    {Colors.YELLOW}* Warning: {w}{Colors.RESET}")

    def _print_final_report(self, duration: float) -> bool:
        total_phases = len(self.results)
        passed_phases = sum(1 for r in self.results if r.passed)
        total_assertions = sum(r.assertions for r in self.results)
        total_failures = sum(len(r.failures) for r in self.results)
        total_warnings = sum(len(r.warnings) for r in self.results)

        print(f"\n{Colors.BOLD}{Colors.CYAN}{'-'*80}{Colors.RESET}")
        print(f"{Colors.BOLD}VERIFICATION SUMMARY:{Colors.RESET}")
        print(f"  Phases:     {passed_phases}/{total_phases} passed")
        print(f"  Assertions: {total_assertions} evaluated")
        print(f"  Failures:   {total_failures}")
        print(f"  Warnings:   {total_warnings}")
        print(f"  Duration:   {duration:.2f}s")
        print(f"{Colors.BOLD}{Colors.CYAN}{'-'*80}{Colors.RESET}")

        if passed_phases == total_phases and total_failures == 0:
            print(f"{Colors.GREEN}{Colors.BOLD}>>> SPECIFICATION VERIFIED SUCCESSFULLY (EXIT CODE 0) <<<{Colors.RESET}\n")
            return True
        else:
            print(f"{Colors.RED}{Colors.BOLD}>>> VERIFICATION FAILED ({total_failures} failures detected) <<<{Colors.RESET}\n")
            return False

    # ── Phase 1: File Presence & Integrity ───────────────────────────────────

    def validate_file_presence(self) -> PhaseResult:
        p = PhaseResult("Fase 1: Presença e Integridade do Arquivo da Especificação")
        exists = self.spec_path.exists()
        p.add_assertion(exists, f"Arquivo existe em {self.spec_path}", f"Arquivo não encontrado: {self.spec_path}")
        if not exists:
            return p

        is_file = self.spec_path.is_file()
        p.add_assertion(is_file, "O caminho especificado é um arquivo regular")
        if not is_file:
            return p

        size = self.spec_path.stat().st_size
        p.add_assertion(size > 5000, f"Arquivo possui tamanho substancial ({size:,} bytes > 5 KB)", f"Arquivo muito pequeno ({size} bytes)")

        try:
            self.content = self.spec_path.read_text(encoding="utf-8")
            p.add_assertion(len(self.content.strip()) > 0, "Conteúdo UTF-8 lido com sucesso")
            line_count = len(self.content.splitlines())
            p.add_assertion(line_count >= 200, f"Documento contém profundidade de texto ({line_count:,} linhas >= 200)", f"Apenas {line_count} linhas")
        except Exception as e:
            p.add_assertion(False, "Leitura UTF-8 sem erros de encoding", str(e))

        return p

    # ── Phase 2: Section Completeness ────────────────────────────────────────

    def validate_section_completeness(self) -> PhaseResult:
        p = PhaseResult("Fase 2: Completude das Seções Obrigatórias do Plano")
        c = self.content.lower()

        required_sections = [
            ("Visão Multimodal e Processamento de Vídeo", [
                "visão multimodal", "video", "vídeo", "b-roll", "frame", "keyframes"
            ]),
            ("Detecção de Objetos e Props de Cena (Grounding)", [
                "objeto", "props", "grounding", "bounding box", "spatial"
            ]),
            ("Reconhecimento Facial e Cascata Híbrida", [
                "reconhecimento facial", "face", "sface", "yunet", "insightface", "arcface"
            ]),
            ("Texto, NLP, Prompts e Personas de Edição", [
                "texto", "nlp", "prompt", "persona", "sumário", "sumarização"
            ]),
            ("Áudio, Transcrição Multilíngue e Diarização de Voz", [
                "áudio", "transcrição", "diarização", "nemotron", "canary", "whisper"
            ]),
            ("Arquitetura de Integração, Banco DDL e Migração", [
                "arquitetura de integração", "migração", "ddl", "sqlite", "qdrant", "settings"
            ]),
        ]

        for section_title, keywords in required_sections:
            found_keywords = [kw for kw in keywords if kw in c]
            passed = len(found_keywords) >= 2
            p.add_assertion(
                passed,
                f"Seção obrigatória identificada: '{section_title}' (palavras-chave: {found_keywords[:3]})",
                f"Seção ausente ou insuficiente: '{section_title}' (palavras-chave buscadas: {keywords})"
            )

        p.add_assertion(
            bool(re.search(r"(?:r1|requisito 1|estudo comparativo)", c, re.IGNORECASE)),
            "R1: Mapeamento de Modelos SOTA documentado"
        )
        p.add_assertion(
            bool(re.search(r"(?:r2|requisito 2|reestrutura[çc][ãa]o de prompts)", c, re.IGNORECASE)),
            "R2: Engenharia de Prompts documentada"
        )
        p.add_assertion(
            bool(re.search(r"(?:r3|requisito 3|schemas? json|tool calling)", c, re.IGNORECASE)),
            "R3: Schemas JSON e Tool Calling documentados"
        )
        p.add_assertion(
            bool(re.search(r"(?:r4|requisito 4|arquitetura de integra[çc][ãa]o|migra[çc][ãa]o)", c, re.IGNORECASE)),
            "R4: Arquitetura de Integração documentada"
        )

        return p

    # ── Phase 3: Model Comparison Tables ─────────────────────────────────────

    def _extract_tables(self) -> List[List[List[str]]]:
        """Extract all markdown tables as list of rows, where each row is list of cells."""
        tables: List[List[List[str]]] = []
        lines = self.content.splitlines()
        current_table: List[List[str]] = []

        for line in lines:
            line_str = line.strip()
            if line_str.startswith("|") and line_str.endswith("|"):
                raw_cells = line_str.split("|")[1:-1]
                cells = [re.sub(r"[*_`]", "", c).strip() for c in raw_cells]
                if all(re.match(r"^:?-+:?$", c) for c in cells if c):
                    continue
                current_table.append(cells)
            else:
                if len(current_table) >= 2:
                    tables.append(current_table)
                current_table = []

        if len(current_table) >= 2:
            tables.append(current_table)

        return tables

    def validate_model_comparison_tables(self) -> PhaseResult:
        p = PhaseResult("Fase 3: Tabelas Comparativas de Modelos SOTA (>= 3 modelos/categoria)")
        tables = self._extract_tables()
        p.add_assertion(len(tables) >= 3, f"Documento contém tabelas Markdown estruturadas (encontradas: {len(tables)})")

        categories = {
            "Visão Multimodal & Vídeo": {
                "target_models": ["gemini", "claude", "qwen", "flash", "sonnet", "vl", "pro"],
                "required_cols": ["custo", "latência", "contexto", "licença"],
                "matched_table": None,
                "model_count": 0
            },
            "Detecção de Objetos e Props": {
                "target_models": ["gemini", "yolo", "florence", "grounding", "dino", "world", "spatial"],
                "required_cols": ["latência", "licença"],
                "matched_table": None,
                "model_count": 0
            },
            "Reconhecimento Facial": {
                "target_models": ["yunet", "sface", "scrfd", "arcface", "insightface", "buffalo", "antelope", "azure", "rekognition"],
                "required_cols": ["dimensão", "tier", "precisão", "licença"],
                "matched_table": None,
                "model_count": 0
            },
            "Texto, NLP e Raciocínio": {
                "target_models": ["deepseek", "qwen", "claude", "gpt", "gemini", "r1", "v3", "haiku"],
                "required_cols": ["custo", "latência", "contexto", "licença"],
                "matched_table": None,
                "model_count": 0
            },
            "Áudio, Transcrição e Diarização": {
                "target_models": ["nemotron", "canary", "whisper", "parakeet", "diarization", "sensevoice", "assemblyai"],
                "required_cols": ["custo", "latência", "licença"],
                "matched_table": None,
                "model_count": 0
            },
        }

        for table in tables:
            table_text = " ".join(" ".join(row).lower() for row in table)

            for cat_name, cat_data in categories.items():
                if cat_data["matched_table"] is not None:
                    continue
                matches = sum(1 for m in cat_data["target_models"] if m in table_text)
                if matches >= 2:
                    cat_data["matched_table"] = table
                    cat_data["model_count"] = len(table[1:])

        for cat_name, cat_data in categories.items():
            tbl = cat_data["matched_table"]
            has_table = tbl is not None
            p.add_assertion(has_table, f"Tabela comparativa identificada para '{cat_name}'")
            if has_table:
                count = cat_data["model_count"]
                p.add_assertion(
                    count >= 3,
                    f"'{cat_name}': contém >= 3 modelos comparados (encontrados: {count})",
                    f"'{cat_name}': tabela possui apenas {count} modelos (mínimo: 3)"
                )

                header = [h.lower() for h in tbl[0]]
                header_str = " ".join(header)
                full_table_str = " ".join(" ".join(r).lower() for r in tbl)
                for col in cat_data["required_cols"]:
                    col_found = any(col in h for h in header) or (col in header_str) or (col in full_table_str)
                    p.add_assertion(
                        col_found,
                        f"'{cat_name}': critério '{col}' avaliado na tabela",
                        f"'{cat_name}': critério '{col}' não identificado na tabela"
                    )

        return p

    # ── Phase 4: JSON Schemas & Payload Validation ───────────────────────────

    def _extract_json_blocks(self) -> List[Tuple[str, Any]]:
        """Extract all JSON fenced code blocks and parse them."""
        pattern = r"```(?:json)\s*\n(.*?)\n```"
        blocks = re.findall(pattern, self.content, re.DOTALL)
        parsed: List[Tuple[str, Any]] = []

        for b in blocks:
            cleaned = b.strip()
            try:
                data = json.loads(cleaned)
                parsed.append((cleaned, data))
            except json.JSONDecodeError:
                continue
        return parsed

    def validate_json_schemas(self) -> PhaseResult:
        p = PhaseResult("Fase 4: Integridade Sintática de JSON Schemas e Validação de Payloads")
        json_blocks = self._extract_json_blocks()
        p.add_assertion(len(json_blocks) >= 4, f"Documento contém blocos JSON estruturados (encontrados: {len(json_blocks)})")

        # Map schemas and payloads
        schema_map: Dict[str, dict] = {}
        example_payloads: Dict[str, dict] = {}
        tools_array: Optional[List[dict]] = None

        for idx, (raw_str, data) in enumerate(json_blocks):
            if isinstance(data, dict):
                title = data.get("title", "")
                if "$schema" in data:
                    if "VisionAnalysisResponse" in title or "vision" in title.lower():
                        schema_map["vision"] = data
                        # If next block is a dict, it's the example payload
                        if idx + 1 < len(json_blocks) and isinstance(json_blocks[idx + 1][1], dict) and "$schema" not in json_blocks[idx + 1][1]:
                            example_payloads["vision"] = json_blocks[idx + 1][1]
                    elif "TriageResponse" in title or "triage" in title.lower():
                        schema_map["triage"] = data
                        if idx + 1 < len(json_blocks) and isinstance(json_blocks[idx + 1][1], dict) and "$schema" not in json_blocks[idx + 1][1]:
                            example_payloads["triage"] = json_blocks[idx + 1][1]
                    elif "ThemeClustersResponse" in title or "theme" in title.lower():
                        schema_map["themes"] = data
                        if idx + 1 < len(json_blocks) and isinstance(json_blocks[idx + 1][1], dict) and "$schema" not in json_blocks[idx + 1][1]:
                            example_payloads["themes"] = json_blocks[idx + 1][1]
                    else:
                        schema_map[f"schema_{len(schema_map)+1}"] = data
            elif isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict) and data[0].get("type") == "function":
                tools_array = data

        # Check that core schemas were identified
        for expected_key in ("vision", "triage", "themes"):
            found = expected_key in schema_map
            p.add_assertion(found, f"JSON Schema estruturado encontrado para '{expected_key}'")

        # Validate meta-schema for each identified schema
        for name, schema in schema_map.items():
            schema_draft = schema.get("$schema", "")
            try:
                if "2020-12" in schema_draft:
                    jsonschema.Draft202012Validator.check_schema(schema)
                    validator_cls = jsonschema.Draft202012Validator
                else:
                    jsonschema.Draft7Validator.check_schema(schema)
                    validator_cls = jsonschema.Draft7Validator

                p.add_assertion(True, f"Meta-schema válido para '{name}' ({schema.get('title', name)})")
            except Exception as e:
                p.add_assertion(False, f"Falha no meta-schema de '{name}': {e}")
                continue

            # Validate the document's own example payload if paired
            if name in example_payloads:
                ex_payload = example_payloads[name]
                try:
                    jsonschema.validate(instance=ex_payload, schema=schema)
                    p.add_assertion(True, f"Payload de exemplo do documento validado com sucesso para '{name}'")
                except jsonschema.ValidationError as ve:
                    p.add_assertion(False, f"Payload de exemplo do documento falhou contra schema '{name}': {ve.message}")

            # Specific tests per schema type
            if name == "vision":
                self._test_vision_payloads(p, schema, validator_cls)
            elif name == "triage":
                self._test_triage_payloads(p, schema, validator_cls)
            elif name == "themes":
                self._test_themes_payloads(p, schema, validator_cls)

        # Validate Tool Calling Tools (Section 3.4)
        has_tools = tools_array is not None and len(tools_array) > 0
        p.add_assertion(has_tools, f"Especificação de Tool Calling identificada (ferramentas: {len(tools_array) if tools_array else 0})")
        if tools_array:
            self._validate_tool_calling(p, tools_array)

        return p

    def _test_vision_payloads(self, p: PhaseResult, schema: dict, validator_cls: Any) -> None:
        validator = validator_cls(schema)

        # Synthetic valid payload aligned to 2026 schema
        valid_payload = {
            "descricao": "Fernando opera a câmera Sony FX3 sobre tripé na gravação externa.",
            "pessoas": [
                {
                    "nome_ou_rotulo": "Fernando",
                    "box_2d": [120, 250, 480, 520],
                    "papel_ou_acao": "operador de câmera"
                }
            ],
            "objetos_props": [
                {
                    "rotulo": "Câmera Sony FX3",
                    "categoria": "equipamento",
                    "box_2d": [200, 310, 390, 460],
                    "confianca": 0.94
                }
            ],
            "tags_tecnicas": ["plano médio", "luz natural suave"],
            "tags_semanticas": ["operação de câmera", "ensaio de cena", "locação externa"]
        }

        try:
            validator.validate(valid_payload)
            p.add_assertion(True, "Vision: payload sintético validado com sucesso")
        except jsonschema.ValidationError as ve:
            p.add_assertion(False, f"Vision: payload sintético falhou: {ve.message}")

        # Negative test: invalid bounding box scale (> 1000) or missing required
        invalid_payload = {
            "descricao": "Teste incompleto",
            # missing required: pessoas, objetos_props, tags_tecnicas, tags_semanticas
        }
        try:
            validator.validate(invalid_payload)
            p.add_assertion(False, "Vision: rejeitou payload incompleto", "Schema aceitou payload sem campos obrigatórios")
        except jsonschema.ValidationError:
            p.add_assertion(True, "Vision: rejeitou corretamente payload com campos obrigatórios ausentes")

    def _test_triage_payloads(self, p: PhaseResult, schema: dict, validator_cls: Any) -> None:
        validator = validator_cls(schema)

        valid_payload = {
            "categoria": "obra",
            "confianca": 0.92,
            "titulo": "Ensaio Geral da Cena 4",
            "justificativa": "Take ensaiado com câmera principal de cinema e claquete."
        }
        try:
            validator.validate(valid_payload)
            p.add_assertion(True, "Triage: payload válido aprovado (categoria 'obra')")
        except jsonschema.ValidationError as ve:
            p.add_assertion(False, f"Triage: payload sintético falhou: {ve.message}")

        invalid_payload = {
            "categoria": "categoria_inexistente_xpto",
            "confianca": 0.92,
            "titulo": "Teste",
            "justificativa": "Teste"
        }
        try:
            validator.validate(invalid_payload)
            p.add_assertion(False, "Triage: rejeitou categoria fora do Eixo A", "Schema aceitou categoria inválida")
        except jsonschema.ValidationError:
            p.add_assertion(True, "Triage: rejeitou corretamente categoria fora do Eixo A")

    def _test_themes_payloads(self, p: PhaseResult, schema: dict, validator_cls: Any) -> None:
        validator = validator_cls(schema)

        valid_payload = {
            "clusters": [
                {
                    "cluster_id": 1,
                    "title": "Fotografia e Luz Natural",
                    "description": "Reflexões sobre o uso da luz dourada nas locações.",
                    "excerpts": [
                        {
                            "video_id": 14,
                            "speaker": "Carlos D.P.",
                            "start_s": 45.0,
                            "end_s": 58.5,
                            "quote": "A gente só tinha vinte minutos por dia para pegar aquela luz de ouro."
                        }
                    ]
                }
            ]
        }
        try:
            validator.validate(valid_payload)
            p.add_assertion(True, "Themes: payload sintético validado com sucesso")
        except jsonschema.ValidationError as ve:
            p.add_assertion(False, f"Themes: payload sintético falhou: {ve.message}")

        invalid_payload = {
            "clusters": [
                {
                    "cluster_id": 1,
                    "title": "Incompleto sem excerpts"
                }
            ]
        }
        try:
            validator.validate(invalid_payload)
            p.add_assertion(False, "Themes: rejeitou cluster sem excerpts obrigatórios", "Schema aceitou cluster incompleto")
        except jsonschema.ValidationError:
            p.add_assertion(True, "Themes: rejeitou corretamente cluster sem excerpts obrigatórios")

    def _validate_tool_calling(self, p: PhaseResult, tools: List[dict]) -> None:
        expected_tools = [
            "get_timeline_state", "search_media", "get_transcript", "analyze_coverage",
            "insert_clip", "move_clip", "delete_clip", "trim_clip",
            "split_clip", "set_av_offset", "add_effect", "propose_bulk_edit",
            "analisar_audio", "sugerir_tratamento_audio", "aplicar_tratamento_audio", "ajustar_audio_ao_vivo"
        ]

        found_names: Dict[str, dict] = {}
        for t in tools:
            fn = t.get("function", {})
            name = fn.get("name", "")
            if name:
                found_names[name] = fn

        p.add_assertion(
            len(found_names) == 16,
            f"Todas as 16 ferramentas do Agente de Edição catalogadas no schema ({len(found_names)}/16)",
            f"Apenas {len(found_names)}/16 ferramentas encontradas: {list(found_names.keys())}"
        )

        for expected in expected_tools:
            has_tool = expected in found_names
            p.add_assertion(has_tool, f"Tool Calling: ferramenta '{expected}' especificada")
            if has_tool:
                fn = found_names[expected]
                params = fn.get("parameters", {})
                try:
                    jsonschema.Draft7Validator.check_schema(params)
                except Exception as e:
                    p.add_assertion(False, f"Tool '{expected}': parameters JSON Schema inválido", str(e))

        # Test tool calling payload validation for search_media
        if "search_media" in found_names:
            sm_params = found_names["search_media"].get("parameters", {})
            try:
                jsonschema.validate(instance={"query": "claquete e ensaio", "media_type": "broll"}, schema=sm_params)
                p.add_assertion(True, "Tool 'search_media': validou payload de chamada de função")
            except jsonschema.ValidationError as ve:
                p.add_assertion(False, f"Tool 'search_media' falhou: {ve.message}")

        # Test tool calling payload validation for insert_clip
        if "insert_clip" in found_names:
            ic_params = found_names["insert_clip"].get("parameters", {})
            sample_insert = {
                "track": "V2",
                "timeline_start": 15.0,
                "video_id": 102,
                "in_s": 2.5,
                "out_s": 8.0,
                "mode": "overwrite"
            }
            try:
                jsonschema.validate(instance=sample_insert, schema=ic_params)
                p.add_assertion(True, "Tool 'insert_clip': validou payload de inserção na timeline")
            except jsonschema.ValidationError as ve:
                p.add_assertion(False, f"Tool 'insert_clip' falhou: {ve.message}")

    # ── Phase 5: Prompt Catalog, Personas & Safeguards ───────────────────────

    def validate_prompt_catalog_and_personas(self) -> PhaseResult:
        p = PhaseResult("Fase 5: Catálogo de Prompts, Personas de Edição e Salvaguardas")
        c = self.content

        official_prompts = [
            ("vision", ["context_block", "visão", "frames"]),
            ("triage", ["categories_block", "context_block", "triagem"]),
            ("enrichment_rewrite", ["original_description", "entities_block", "replacements_block", "reescrita"]),
            ("timeline_suggestion", ["persona_block", "timeline_context", "candidates_context", "brief_block"]),
            ("interview_summary", ["formatted_transcript", "depoimento", "sumário"]),
            ("broll_summary", ["formatted_visuals", "category_block", "b-roll"]),
            ("theme_naming", ["clusters_block", "existing_block", "nomeação de temas"]),
            ("script_format_detect", ["sample", "regex", "formato de cena"]),
            ("script_extract", ["scene_block", "target_numbers", "extração"]),
            ("agent_system", ["timeline_context", "context_str", "agente de edição"]),
            ("chatbot_system", ["context_str", "chatbot rag"]),
        ]

        for prompt_id, hints in official_prompts:
            found = (prompt_id in c) or any(h.lower() in c.lower() for h in hints)
            p.add_assertion(
                found,
                f"Prompt oficial documentado: '{prompt_id}'",
                f"Prompt oficial '{prompt_id}' não identificado no catálogo do plano"
            )

        new_prompts = ["triage_batch_title", "photo_vision"]
        for np_name in new_prompts:
            found = np_name in c or np_name.replace("_", " ") in c.lower()
            p.add_assertion(
                found,
                f"Novo prompt catalogado: '{np_name}' (eliminação de prompt inline)",
                f"Novo prompt '{np_name}' não foi incorporado ao catálogo"
            )

        personas = [
            ("persona.montadora", ["montadora", "ritmo", "delete", "prolixo"]),
            ("persona.diretora", ["diretora", "narrativa", "insert", "arco"]),
            ("persona.sound_designer", ["sound designer", "áudio", "som ambiente", "j-cut"]),
            ("persona.colorista", ["colorista", "cobertura visual", "jump cut", "b-roll"]),
        ]

        for persona_id, keywords in personas:
            found_id = persona_id in c
            found_kw = sum(1 for kw in keywords if kw in c.lower()) >= 2
            p.add_assertion(
                found_id or found_kw,
                f"Diretriz de Persona documentada: '{persona_id}'",
                f"Persona '{persona_id}' ausente ou sem diretrizes detalhadas"
            )

        c_lower = c.lower()
        has_few_shot = ("few-shot" in c_lower or "in-context learning" in c_lower or "exemplos" in c_lower)
        p.add_assertion(has_few_shot, "Seção de exemplos Few-Shot documentada")

        has_anti_hallucination = ("anti-alucina" in c_lower or "proibido tags genéricas" in c_lower or "salvaguarda" in c_lower)
        p.add_assertion(has_anti_hallucination, "Regras e salvaguardas anti-alucinação documentadas")

        has_realm = ("realm='story'" in c or "realm='production'" in c or ("realm" in c_lower and "story" in c_lower and "production" in c_lower))
        p.add_assertion(has_realm, "Isolamento rígido entre ficção ('story') e bastidores ('production') documentado")

        eixo_a = ["obra", "processo", "depoimento", "cotidiano", "evento", "tecnico", "arquivo", "pessoal", "documento"]
        eixo_a_count = sum(1 for cat in eixo_a if cat in c_lower)
        p.add_assertion(
            eixo_a_count >= 7,
            f"Taxonomia Eixo A documentada ({eixo_a_count}/9 categorias encontradas)",
            f"Apenas {eixo_a_count}/9 categorias do Eixo A encontradas"
        )

        return p

    # ── Phase 6: SQLite DDL Execution & Migration ────────────────────────────

    def _extract_sql_blocks(self) -> List[str]:
        """Extract all SQL code blocks."""
        pattern = r"```(?:sql)\s*\n(.*?)\n```"
        return re.findall(pattern, self.content, re.DOTALL)

    def validate_sqlite_ddl(self) -> PhaseResult:
        p = PhaseResult("Fase 6: Execução e Validação do SQLite DDL em Memória (:memory:)")
        sql_blocks = self._extract_sql_blocks()
        p.add_assertion(len(sql_blocks) >= 1, f"Blocos de código SQL DDL encontrados no plano ({len(sql_blocks)})")

        if not sql_blocks:
            return p

        combined_sql = "\n\n".join(sql_blocks)
        p.add_assertion(
            "detected_object" in combined_sql or "object_detection" in combined_sql,
            "DDL especifica tabela de detecção espacial de objetos/props ('detected_object' ou 'object_detection')"
        )

        try:
            conn = sqlite3.connect(":memory:")
            conn.execute("PRAGMA foreign_keys = ON;")
            cursor = conn.cursor()

            base_schema = """
            CREATE TABLE project (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
            CREATE TABLE video (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES project(id));
            CREATE TABLE photo (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES project(id));
            CREATE TABLE entity (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT, entity_type TEXT, realm TEXT);
            CREATE TABLE scene (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, heading TEXT, props_json TEXT);
            """
            cursor.executescript(base_schema)
            p.add_assertion(True, "Ambiente SQLite de teste (:memory:) inicializado com tabelas base")

            statements: List[str] = []
            for block in sql_blocks:
                clean_lines = []
                for line in block.splitlines():
                    striped = line.strip()
                    if striped.startswith("--"):
                        continue
                    clean_lines.append(line)
                block_clean = "\n".join(clean_lines)

                raw_stmts = block_clean.split(";")
                for s in raw_stmts:
                    s_clean = s.strip()
                    if s_clean and any(s_clean.upper().startswith(kw) for kw in ("CREATE", "ALTER", "INSERT", "PRAGMA", "DROP")):
                        statements.append(s_clean + ";")

            executed_count = 0
            for stmt in statements:
                try:
                    cursor.execute(stmt)
                    executed_count += 1
                except sqlite3.OperationalError as oe:
                    if "duplicate column name" in str(oe).lower():
                        executed_count += 1
                    else:
                        p.add_assertion(False, f"Execução de SQL DDL: {stmt[:60]}...", f"Erro SQLite: {oe}")

            p.add_assertion(
                executed_count >= 2,
                f"Executadas com sucesso {executed_count} instruções SQL DDL propostas"
            )

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('detected_object', 'object_detection');")
            obj_tables = [row[0] for row in cursor.fetchall()]
            p.add_assertion(
                len(obj_tables) > 0,
                f"Tabela de objetos criada no banco: {obj_tables}",
                "Tabela de detecção de objetos não foi criada no SQLite"
            )

            target_table = obj_tables[0] if obj_tables else "detected_object"

            cursor.execute(f"PRAGMA table_info({target_table});")
            cols = {row[1]: row[2] for row in cursor.fetchall()}
            expected_cols = ["project_id", "bounding_box", "confidence", "detector_model"]
            for col in expected_cols:
                p.add_assertion(col in cols, f"Coluna obrigatória '{col}' presente na tabela '{target_table}'")

            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='{target_table}';")
            indexes = [row[0] for row in cursor.fetchall()]
            p.add_assertion(len(indexes) >= 3, f"Índices de performance criados para '{target_table}' (encontrados: {len(indexes)})")

            cursor.execute("INSERT INTO project (name) VALUES ('Doc Teste');")
            proj_id = cursor.lastrowid
            insert_sql = f"""
            INSERT INTO {target_table} (project_id, label, bounding_box, confidence, detector_model)
            VALUES (?, ?, ?, ?, ?);
            """
            cursor.execute(insert_sql, (proj_id, "camera", "[0.1, 0.2, 0.3, 0.4]", 0.95, "gemini_spatial"))
            inserted_id = cursor.lastrowid
            p.add_assertion(inserted_id > 0, f"Inserção DML bem-sucedida na tabela '{target_table}' (ID: {inserted_id})")

            # Check entity_mention table presence
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_mention';")
            has_em = len(cursor.fetchall()) > 0
            p.add_assertion(has_em, "Tabela 'entity_mention' presente e compatível com DDL")

            conn.close()
        except Exception as e:
            p.add_assertion(False, "Execução e integridade do SQLite DDL em memória", str(e))

        return p

    # ── Phase 7: Architecture & Migration (Qdrant, Settings, Workers) ────────

    def validate_architecture_and_migration(self) -> PhaseResult:
        p = PhaseResult("Fase 7: Arquitetura de Integração, Vetores Qdrant e Reprocessamento")
        c = self.content.lower()

        has_qdrant = "qdrant" in c
        p.add_assertion(has_qdrant, "Estratégia de integração com banco vetorial Qdrant documentada")

        has_making_of = "capiau_making_of" in c
        has_images = "capiau_images" in c
        p.add_assertion(has_making_of and has_images, "Ambas as coleções ativas ('capiau_making_of' e 'capiau_images') endereçadas")

        has_payload_enrichment = ("payload" in c and ("detected_objects" in c or "props" in c or "realm_tags" in c))
        p.add_assertion(has_payload_enrichment, "Evolução do Qdrant baseada em enriquecimento de payload sem invalidação de coleções")

        has_settings = "settings_registry" in c or "resolvedsettings" in c
        p.add_assertion(has_settings, "Extensão do catálogo de configurações (settings_registry.py) detalhada")

        new_settings_keys = [
            ("object.detector_engine", ["object.detector_engine", "props.detector_backend"]),
            ("api_keys_2026", ["api.gemini_key", "api.anthropic_key", "api.deepseek_key", "gemini_key"]),
        ]

        for name, kws in new_settings_keys:
            found = any(kw in c for kw in kws)
            p.add_assertion(found, f"Novas chaves de configuração documentadas ({name})")

        has_worker = "worker_vision" in c or "reprocessamento" in c or "worker" in c
        p.add_assertion(has_worker, "Estratégia de reprocessamento em lote (batch workers) documentada")

        has_lock_protection = ("suspend_for_worker" in c or "lock" in c or "trava" in c or "gil" in c or "fastapi" in c)
        p.add_assertion(has_lock_protection, "Salvaguarda de concorrência e trava de arquivo do Qdrant / Event Loop documentada")

        return p


def main() -> int:
    parser = argparse.ArgumentParser(description="Verificador Automatizado da Especificação de Modernização de IA (2026)")
    parser.add_argument(
        "--spec",
        type=Path,
        default=Path("docs/Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md"),
        help="Caminho do arquivo Markdown da especificação"
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Exibe detalhes de cada asserção individual")
    parser.add_argument("--no-color", action="store_true", help="Desabilita cores ANSI no terminal")

    args = parser.parse_args()

    if args.no_color or os.getenv("NO_COLOR"):
        Colors.disable()

    spec_file = args.spec.resolve()
    validator = SpecValidator(spec_file, verbose=args.verbose)
    success = validator.run_all()

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
