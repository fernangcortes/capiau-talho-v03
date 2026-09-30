"""tests/test_adversarial_ai_spec.py — Empirical Adversarial Challenge Suite.

Adversarially stress-tests:
1. JSON Schemas extracted from docs/Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md:
   - VisionAnalysisResponse (bounding boxes, coordinates, ranges, enums, required fields, additionalProperties)
   - TriageResponse (Eixo A strict taxonomy, probabilities, required fields, additionalProperties)
   - ThemeClustersResponse (clusters, excerpts, timestamp types, required fields, additionalProperties)
   - 16 Tool Calling specifications (parameter validation, required params, enums, slider ranges)
2. SQLite DDL and Migrations extracted from the spec:
   - Idempotency of DDL execution (sequential duplicate runs with IF NOT EXISTS)
   - Migration function idempotency (duplicate calls)
   - Foreign key constraint enforcement with PRAGMA foreign_keys = ON
   - Cascade deletion on project, video, photo
   - ON DELETE SET NULL on entity, scene
   - CHECK constraints on category, realm, execution_mode, status
   - Boundary values, nullability, extreme coordinates
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Tuple

import jsonschema
import pytest

SPEC_PATH = Path("docs/Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md")


# ── Fixtures & Spec Parsers ──────────────────────────────────────────────────

@pytest.fixture(scope="session")
def spec_content() -> str:
    assert SPEC_PATH.exists(), f"Spec document not found at {SPEC_PATH}"
    return SPEC_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def json_blocks(spec_content: str) -> List[Any]:
    pattern = r"```(?:json)\s*\n(.*?)\n```"
    raw_blocks = re.findall(pattern, spec_content, re.DOTALL)
    parsed = []
    for b in raw_blocks:
        try:
            parsed.append(json.loads(b.strip()))
        except json.JSONDecodeError:
            pass
    return parsed


@pytest.fixture(scope="session")
def schema_map(json_blocks: List[Any]) -> Dict[str, dict]:
    schemas: Dict[str, dict] = {}
    for data in json_blocks:
        if isinstance(data, dict) and "$schema" in data:
            title = data.get("title", "")
            if "VisionAnalysisResponse" in title:
                schemas["vision"] = data
            elif "TriageResponse" in title:
                schemas["triage"] = data
            elif "ThemeClustersResponse" in title:
                schemas["themes"] = data
    return schemas


@pytest.fixture(scope="session")
def tools_spec(json_blocks: List[Any]) -> List[dict]:
    for data in json_blocks:
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict) and data[0].get("type") == "function":
            return data
    pytest.fail("Could not find tool calling specification block in document.")


@pytest.fixture(scope="session")
def tools_map(tools_spec: List[dict]) -> Dict[str, dict]:
    m = {}
    for t in tools_spec:
        fn = t.get("function", {})
        if "name" in fn:
            m[fn["name"]] = fn
    return m


@pytest.fixture(scope="session")
def ddl_statements(spec_content: str) -> List[str]:
    pattern = r"```(?:sql)\s*\n(.*?)\n```"
    blocks = re.findall(pattern, spec_content, re.DOTALL)
    assert len(blocks) >= 1, "No SQL blocks found in spec"
    statements = []
    for block in blocks:
        clean_lines = [l for l in block.splitlines() if not l.strip().startswith("--")]
        block_clean = "\n".join(clean_lines)
        for s in block_clean.split(";"):
            s_clean = s.strip()
            if s_clean and any(s_clean.upper().startswith(kw) for kw in ("CREATE", "ALTER", "INSERT", "PRAGMA", "DROP")):
                statements.append(s_clean + ";")
    return statements


# ── Test Suite 1: VisionAnalysisResponse Adversarial ─────────────────────────

class TestVisionAnalysisSchemaAdversarial:
    @pytest.fixture(autouse=True)
    def setup_validator(self, schema_map: Dict[str, dict]):
        assert "vision" in schema_map, "VisionAnalysisResponse schema missing"
        self.schema = schema_map["vision"]
        self.validator_cls = jsonschema.Draft202012Validator
        self.validator = self.validator_cls(self.schema)

    def get_valid_payload(self) -> dict:
        return {
            "descricao": "Operador de câmera no set com ator.",
            "pessoas": [
                {
                    "nome_ou_rotulo": "Ator 1",
                    "box_2d": [100, 200, 800, 700],
                    "papel_ou_acao": "Contracenando"
                }
            ],
            "objetos_props": [
                {
                    "rotulo": "Câmera FX3",
                    "categoria": "equipamento",
                    "box_2d": [300, 400, 600, 700],
                    "confianca": 0.95
                }
            ],
            "tags_tecnicas": ["plano médio", "tripé"],
            "tags_semanticas": ["ensaio de cena"]
        }

    def test_valid_payload_passes(self):
        self.validator.validate(self.get_valid_payload())

    @pytest.mark.parametrize("missing_field", [
        "descricao", "pessoas", "objetos_props", "tags_tecnicas", "tags_semanticas"
    ])
    def test_missing_required_fields_rejected(self, missing_field: str):
        payload = self.get_valid_payload()
        del payload[missing_field]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    def test_root_additional_property_rejected(self):
        payload = self.get_valid_payload()
        payload["unauthorized_field"] = "hacker_data"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    def test_person_missing_required_fields_rejected(self):
        # Missing nome_ou_rotulo
        p1 = self.get_valid_payload()
        del p1["pessoas"][0]["nome_ou_rotulo"]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p1)

        # Missing box_2d
        p2 = self.get_valid_payload()
        del p2["pessoas"][0]["box_2d"]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p2)

    def test_person_additional_property_rejected(self):
        p = self.get_valid_payload()
        p["pessoas"][0]["extra_intruder"] = 12345
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)

    @pytest.mark.parametrize("invalid_box", [
        [100, 200, 300],              # length 3 (minItems 4)
        [100, 200, 300, 400, 500],    # length 5 (maxItems 4)
        [-1, 200, 300, 400],          # negative integer (< 0)
        [100, 200, 300, 1001],        # > 1000 (> maximum)
        [100.5, 200, 300, 400],       # float instead of integer
        "100, 200, 300, 400",         # string instead of array
    ])
    def test_person_invalid_box_2d_rejected(self, invalid_box: Any):
        p = self.get_valid_payload()
        p["pessoas"][0]["box_2d"] = invalid_box
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)

    @pytest.mark.parametrize("missing_prop_field", [
        "rotulo", "categoria", "box_2d", "confianca"
    ])
    def test_object_missing_required_fields_rejected(self, missing_prop_field: str):
        p = self.get_valid_payload()
        del p["objetos_props"][0][missing_prop_field]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)

    def test_object_additional_property_rejected(self):
        p = self.get_valid_payload()
        p["objetos_props"][0]["unknown_field"] = "unexpected"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)

    @pytest.mark.parametrize("invalid_cat", [
        "arma", "personagem", "som", "luz", "drone", "random_string", ""
    ])
    def test_object_invalid_category_enum_rejected(self, invalid_cat: str):
        p = self.get_valid_payload()
        p["objetos_props"][0]["categoria"] = invalid_cat
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)

    @pytest.mark.parametrize("valid_cat", [
        "equipamento", "prop_cena", "figurino", "veiculo", "documento", "cenario", "outro"
    ])
    def test_object_valid_categories_accepted(self, valid_cat: str):
        p = self.get_valid_payload()
        p["objetos_props"][0]["categoria"] = valid_cat
        self.validator.validate(p)

    @pytest.mark.parametrize("invalid_conf", [
        -0.01, 1.01, 2.0, -10.0, "0.95", None
    ])
    def test_object_invalid_confidence_rejected(self, invalid_conf: Any):
        p = self.get_valid_payload()
        p["objetos_props"][0]["confianca"] = invalid_conf
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)

    @pytest.mark.parametrize("invalid_semantic_tags", [
        [],  # minItems: 1
        ["tag" + str(i) for i in range(13)],  # maxItems: 12 -> 13 rejected
        [123],  # non-string item
        "string_not_list",  # non-array
    ])
    def test_tags_semanticas_boundary_rejected(self, invalid_semantic_tags: Any):
        p = self.get_valid_payload()
        p["tags_semanticas"] = invalid_semantic_tags
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p)


# ── Test Suite 2: TriageResponse Adversarial ─────────────────────────────────

class TestTriageSchemaAdversarial:
    @pytest.fixture(autouse=True)
    def setup_validator(self, schema_map: Dict[str, dict]):
        assert "triage" in schema_map, "TriageResponse schema missing"
        self.schema = schema_map["triage"]
        self.validator_cls = jsonschema.Draft202012Validator
        self.validator = self.validator_cls(self.schema)

    def get_valid_payload(self) -> dict:
        return {
            "categoria": "obra",
            "confianca": 0.95,
            "titulo": "Ensaio Geral Cena Quatro",
            "justificativa": "Plano gravado com claquete e câmera de cinema."
        }

    def test_valid_payload_passes(self):
        self.validator.validate(self.get_valid_payload())

    @pytest.mark.parametrize("missing_field", [
        "categoria", "confianca", "titulo", "justificativa"
    ])
    def test_missing_required_fields_rejected(self, missing_field: str):
        payload = self.get_valid_payload()
        del payload[missing_field]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    def test_root_additional_property_rejected(self):
        payload = self.get_valid_payload()
        payload["extra_annotation"] = "not_allowed"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    @pytest.mark.parametrize("valid_cat", [
        "obra", "processo", "depoimento", "cotidiano", "evento", "tecnico", "arquivo", "pessoal", "documento"
    ])
    def test_all_eixo_a_categories_accepted(self, valid_cat: str):
        payload = self.get_valid_payload()
        payload["categoria"] = valid_cat
        self.validator.validate(payload)

    @pytest.mark.parametrize("invalid_cat", [
        "filme", "making_of", "broll", "entrevista", "ensaio", "random", "", 123, None
    ])
    def test_invalid_category_rejected(self, invalid_cat: Any):
        payload = self.get_valid_payload()
        payload["categoria"] = invalid_cat
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    @pytest.mark.parametrize("invalid_conf", [
        -0.01, 1.01, -1.0, 5.0, "0.95", None
    ])
    def test_invalid_confidence_rejected(self, invalid_conf: Any):
        payload = self.get_valid_payload()
        payload["confianca"] = invalid_conf
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)


# ── Test Suite 3: ThemeClustersResponse Adversarial ──────────────────────────

class TestThemeClustersSchemaAdversarial:
    @pytest.fixture(autouse=True)
    def setup_validator(self, schema_map: Dict[str, dict]):
        assert "themes" in schema_map, "ThemeClustersResponse schema missing"
        self.schema = schema_map["themes"]
        self.validator_cls = jsonschema.Draft202012Validator
        self.validator = self.validator_cls(self.schema)

    def get_valid_payload(self) -> dict:
        return {
            "clusters": [
                {
                    "cluster_id": 1,
                    "title": "Fotografia e Luz",
                    "description": "Discussão estética sobre fotografia.",
                    "excerpts": [
                        {
                            "video_id": 10,
                            "speaker": "Carlos D.P.",
                            "start_s": 12.0,
                            "end_s": 25.5,
                            "quote": "A luz natural da manhã foi decisiva."
                        }
                    ]
                }
            ]
        }

    def test_valid_payload_passes(self):
        self.validator.validate(self.get_valid_payload())

    def test_missing_clusters_rejected(self):
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate({})

    def test_root_additional_property_rejected(self):
        payload = self.get_valid_payload()
        payload["metadata"] = {}
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    @pytest.mark.parametrize("missing_cluster_field", [
        "cluster_id", "title", "description", "excerpts"
    ])
    def test_missing_cluster_fields_rejected(self, missing_cluster_field: str):
        payload = self.get_valid_payload()
        del payload["clusters"][0][missing_cluster_field]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    def test_cluster_additional_property_rejected(self):
        payload = self.get_valid_payload()
        payload["clusters"][0]["extra"] = "forbidden"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    @pytest.mark.parametrize("missing_excerpt_field", [
        "video_id", "speaker", "start_s", "end_s", "quote"
    ])
    def test_missing_excerpt_fields_rejected(self, missing_excerpt_field: str):
        payload = self.get_valid_payload()
        del payload["clusters"][0]["excerpts"][0][missing_excerpt_field]
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)

    def test_excerpt_invalid_types_rejected(self):
        # video_id string instead of integer
        p1 = self.get_valid_payload()
        p1["clusters"][0]["excerpts"][0]["video_id"] = "vid_10"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p1)

        # start_s string instead of number
        p2 = self.get_valid_payload()
        p2["clusters"][0]["excerpts"][0]["start_s"] = "00:12:00"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(p2)

    def test_excerpt_additional_property_rejected(self):
        payload = self.get_valid_payload()
        payload["clusters"][0]["excerpts"][0]["timecode"] = "00:00:10:00"
        with pytest.raises(jsonschema.ValidationError):
            self.validator.validate(payload)


# ── Test Suite 4: Tool Calling Schemas Adversarial ───────────────────────────

class TestToolCallingSchemasAdversarial:
    def test_tool_count_is_exact(self, tools_map: Dict[str, dict]):
        assert len(tools_map) == 16, f"Expected 16 tools, got {len(tools_map)}"

    def test_search_media_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["search_media"]["parameters"]
        # Valid
        jsonschema.validate({"query": "diretor"}, schema)
        jsonschema.validate({"query": "claquete", "media_type": "broll"}, schema)
        # Missing required
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({}, schema)
        # Invalid media_type enum
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"query": "teste", "media_type": "audio"}, schema)

    def test_get_transcript_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["get_transcript"]["parameters"]
        jsonschema.validate({"video_id": 10}, schema)
        jsonschema.validate({"video_id": 10, "start_time": 0.0, "end_time": 30.0}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"video_id": "10"}, schema)  # string rejected

    def test_insert_clip_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["insert_clip"]["parameters"]
        jsonschema.validate({"track": "V1", "video_id": 42}, schema)
        jsonschema.validate({"track": "V2", "video_id": 42, "mode": "insert"}, schema)
        jsonschema.validate({"track": "V2", "video_id": 42, "mode": "overwrite"}, schema)
        # Missing track
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"video_id": 42}, schema)
        # Missing video_id
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"track": "V1"}, schema)
        # Invalid mode enum
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"track": "V1", "video_id": 42, "mode": "replace"}, schema)

    def test_move_clip_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["move_clip"]["parameters"]
        jsonschema.validate({"clip_id": "c1", "to_track": "V2", "to_s": 10.0}, schema)
        # Missing required
        for req in ["clip_id", "to_track", "to_s"]:
            payload = {"clip_id": "c1", "to_track": "V2", "to_s": 10.0}
            del payload[req]
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate(payload, schema)

    def test_delete_clip_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["delete_clip"]["parameters"]
        jsonschema.validate({"clip_id": "c1"}, schema)
        jsonschema.validate({"clip_id": "c1", "delete_partner": True}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "delete_partner": "yes"}, schema)

    def test_trim_clip_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["trim_clip"]["parameters"]
        jsonschema.validate({"clip_id": "c1", "edge": "left", "delta_s": 1.5}, schema)
        jsonschema.validate({"clip_id": "c1", "edge": "right", "delta_s": -2.0}, schema)
        # Invalid edge enum
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "edge": "center", "delta_s": 1.0}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "edge": "in", "delta_s": 1.0}, schema)

    def test_split_clip_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["split_clip"]["parameters"]
        jsonschema.validate({"clip_id": "c1", "at_s": 15.5}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1"}, schema)

    def test_set_av_offset_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["set_av_offset"]["parameters"]
        jsonschema.validate({"clip_id": "c1", "audio_lead_s": 0.5}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1"}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "audio_lead_s": "half_second"}, schema)

    def test_add_effect_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["add_effect"]["parameters"]
        jsonschema.validate({"clip_id": "c1", "effect_name": "volume", "params": {"gain_db": -3.0}}, schema)
        # Invalid effect_name enum
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "effect_name": "distortion", "params": {}}, schema)
        # Params not object
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "effect_name": "volume", "params": "high"}, schema)

    def test_propose_bulk_edit_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["propose_bulk_edit"]["parameters"]
        # Valid payload
        valid_payload = {
            "operations": [
                {
                    "action": "DELETE",
                    "track": "V1",
                    "target_clip_id": "c1"
                },
                {
                    "action": "INSERT",
                    "track": "V2",
                    "video_id": 101,
                    "in_s": 2.0,
                    "out_s": 5.0,
                    "timeline_start": 12.0
                }
            ],
            "rationale": "Corte de silêncio e cobertura com B-roll."
        }
        jsonschema.validate(valid_payload, schema)

        # Adversarial 1: Lowercase action enum must fail
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({
                "operations": [{"action": "delete", "track": "V1", "target_clip_id": "c1"}],
                "rationale": "teste"
            }, schema)

        # Adversarial 2: Missing track must fail
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({
                "operations": [{"action": "DELETE", "target_clip_id": "c1"}],
                "rationale": "teste"
            }, schema)

        # Adversarial 3: Unknown property in operation must fail (additionalProperties: false)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({
                "operations": [{"action": "DELETE", "track": "V1", "target_clip_id": "c1", "unknown_key": True}],
                "rationale": "teste"
            }, schema)

        # Adversarial 4: Missing rationale must fail
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"operations": []}, schema)

        # Adversarial 5: operations not array must fail
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"operations": "DELETE V1 c1", "rationale": "teste"}, schema)

    def test_aplicar_tratamento_audio_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["aplicar_tratamento_audio"]["parameters"]
        for p in ["ambiencia_preservada", "previa_rapida", "resgate_estourado", "so_entrega", "voz_limpa"]:
            jsonschema.validate({"clip_id": "c1", "preset": p}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "preset": "mega_denoise"}, schema)

    def test_ajustar_audio_ao_vivo_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["ajustar_audio_ao_vivo"]["parameters"]
        jsonschema.validate({"clip_id": "c1"}, schema)
        jsonschema.validate({
            "clip_id": "c1",
            "hpf": 80,
            "low": 2.5,
            "mid": -1.0,
            "high": 3.0,
            "gate_db": -40,
            "comp_ratio": 3.5,
            "comp_thresh_db": -18,
            "makeup_db": 4.0,
            "reverter": "eq"
        }, schema)
        # Out of bounds tests:
        # hpf < 0 or > 300
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "hpf": -10}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "hpf": 350}, schema)
        # low < -12 or > 12
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "low": -15.0}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "low": 15.0}, schema)
        # gate_db < -90 or > -20
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "gate_db": -100}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "gate_db": -10}, schema)
        # comp_ratio < 1.0 or > 20.0
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "comp_ratio": 0.5}, schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "comp_ratio": 25.0}, schema)
        # reverter invalid enum
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({"clip_id": "c1", "reverter": "reset_all"}, schema)


    def test_empty_tools_reject_additional_properties(self, tools_map: Dict[str, dict]):
        for tool_name in ["get_timeline_state", "analyze_coverage"]:
            schema = tools_map[tool_name]["parameters"]
            jsonschema.validate({}, schema)
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate({"extraneous": "payload"}, schema)

    def test_audio_analysis_tools_schemas(self, tools_map: Dict[str, dict]):
        for tool_name in ["analisar_audio", "sugerir_tratamento_audio"]:
            schema = tools_map[tool_name]["parameters"]
            jsonschema.validate({"clip_id": "cut_42_1"}, schema)
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate({}, schema)
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate({"clip_id": 42}, schema)  # not string
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate({"clip_id": "cut_42_1", "extra": True}, schema)

    def test_insert_clip_alternatives_deep_schema(self, tools_map: Dict[str, dict]):
        schema = tools_map["insert_clip"]["parameters"]
        # Valid with alternatives
        valid_with_alts = {
            "track": "V2",
            "video_id": 101,
            "alternatives": [
                {
                    "video_id": 102,
                    "in_s": 5.0,
                    "out_s": 9.5,
                    "ideal_duration_s": 4.5,
                    "reason": "Plano mais aberto da mesma cena"
                }
            ]
        }
        jsonschema.validate(valid_with_alts, schema)

        # Alternative missing reason
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({
                "track": "V2",
                "video_id": 101,
                "alternatives": [{"video_id": 102, "in_s": 5.0, "out_s": 9.5, "ideal_duration_s": 4.5}]
            }, schema)

        # Alternative with extra property
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({
                "track": "V2",
                "video_id": 101,
                "alternatives": [{
                    "video_id": 102, "in_s": 5.0, "out_s": 9.5, "ideal_duration_s": 4.5,
                    "reason": "Plano B", "unallowed": 1
                }]
            }, schema)


# ── Test Suite 5: SQLite DDL Idempotency, FK & Cascades ──────────────────────

class TestSqliteDdlAdversarial:
    @pytest.fixture
    def db_conn(self, ddl_statements: List[str]) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        conn.execute("PRAGMA foreign_keys = ON;")
        cursor = conn.cursor()
        base_schema = """
        CREATE TABLE project (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
        CREATE TABLE video (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES project(id) ON DELETE CASCADE);
        CREATE TABLE photo (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES project(id) ON DELETE CASCADE);
        CREATE TABLE entity (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT, entity_type TEXT, realm TEXT);
        CREATE TABLE scene (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, heading TEXT, props_json TEXT);
        """
        cursor.executescript(base_schema)
        for stmt in ddl_statements:
            cursor.execute(stmt)
        conn.commit()
        return conn

    def test_ddl_idempotency_run_twice(self, db_conn: sqlite3.Connection, ddl_statements: List[str]):
        """Adversarially run every DDL statement a second time on the same connection."""
        cursor = db_conn.cursor()
        for stmt in ddl_statements:
            # Should succeed with zero errors thanks to IF NOT EXISTS
            cursor.execute(stmt)
        db_conn.commit()

    def test_query_planner_uses_all_7_indexes(self, db_conn: sqlite3.Connection):
        """Empirically verify that SQLite query planner uses all 7 created indexes."""
        cursor = db_conn.cursor()
        index_queries = [
            ("idx_obj_project", "SELECT * FROM detected_object WHERE project_id = 1;"),
            ("idx_obj_video", "SELECT * FROM detected_object WHERE video_id = 1 AND timestamp >= 10.0;"),
            ("idx_obj_photo", "SELECT * FROM detected_object WHERE photo_id = 1;"),
            ("idx_obj_label", "SELECT * FROM detected_object WHERE project_id = 1 AND label = 'camera';"),
            ("idx_obj_entity", "SELECT * FROM detected_object WHERE entity_id = 1;"),
            ("idx_obj_scene", "SELECT * FROM detected_object WHERE scene_id = 1;"),
            ("idx_obj_realm", "SELECT * FROM detected_object WHERE project_id = 1 AND realm = 'story';"),
        ]

        for expected_idx, query in index_queries:
            cursor.execute(f"EXPLAIN QUERY PLAN {query}")
            plan_rows = cursor.fetchall()
            plan_text = " ".join(r[-1] for r in plan_rows)
            assert expected_idx in plan_text, f"Query '{query}' did not use index '{expected_idx}': {plan_text}"

    def test_migration_function_idempotency(self, db_conn: sqlite3.Connection):
        """Simulate and test migrate_storage_schema idempotency."""
        cursor = db_conn.cursor()
        
        def run_migration():
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='detected_object'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS detected_object (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                        photo_id INTEGER,
                        video_id INTEGER,
                        timestamp REAL,
                        label TEXT NOT NULL,
                        category TEXT DEFAULT 'outro',
                        realm TEXT CHECK(realm IN ('production', 'story')) DEFAULT 'production',
                        bounding_box TEXT NOT NULL,
                        confidence REAL NOT NULL,
                        detector_model TEXT NOT NULL,
                        detector_version TEXT,
                        execution_mode TEXT DEFAULT 'cloud_api',
                        entity_id INTEGER,
                        scene_id INTEGER,
                        crop_path TEXT,
                        status TEXT DEFAULT 'auto',
                        raw_payload TEXT,
                        cost_usd REAL DEFAULT 0.0,
                        processing_time_ms INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
            cursor.execute("PRAGMA table_info(entity_mention)")
            existing_cols = {row[1] for row in cursor.fetchall()}
            if "bounding_box" not in existing_cols:
                cursor.execute("ALTER TABLE entity_mention ADD COLUMN bounding_box TEXT")
            if "confidence" not in existing_cols:
                cursor.execute("ALTER TABLE entity_mention ADD COLUMN confidence REAL DEFAULT 1.0")
            if "detected_label" not in existing_cols:
                cursor.execute("ALTER TABLE entity_mention ADD COLUMN detected_label TEXT")
            db_conn.commit()

        # Run migration 3 times consecutively
        run_migration()
        run_migration()
        run_migration()

        cursor.execute("PRAGMA table_info(entity_mention)")
        cols = {r[1] for r in cursor.fetchall()}
        assert "bounding_box" in cols
        assert "confidence" in cols
        assert "detected_label" in cols

    def test_foreign_key_violation_rejected(self, db_conn: sqlite3.Connection):
        cursor = db_conn.cursor()
        # Nonexistent project_id
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, label, bounding_box, confidence, detector_model)
                VALUES (9999, 'câmera', '[10,20,30,40]', 0.9, 'gemini');
            """)

        # Nonexistent video_id with valid project
        cursor.execute("INSERT INTO project (name) VALUES ('Proj 1');")
        proj_id = cursor.lastrowid
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, video_id, label, bounding_box, confidence, detector_model)
                VALUES (?, 8888, 'câmera', '[10,20,30,40]', 0.9, 'gemini');
            """, (proj_id,))

        # Nonexistent photo_id
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, photo_id, label, bounding_box, confidence, detector_model)
                VALUES (?, 7777, 'câmera', '[10,20,30,40]', 0.9, 'gemini');
            """, (proj_id,))

    def test_cascade_deletion_on_project_and_media(self, db_conn: sqlite3.Connection):
        cursor = db_conn.cursor()
        # Seed parent records
        cursor.execute("INSERT INTO project (name) VALUES ('Doc Master');")
        p_id = cursor.lastrowid
        cursor.execute("INSERT INTO video (project_id) VALUES (?);", (p_id,))
        v_id = cursor.lastrowid
        cursor.execute("INSERT INTO photo (project_id) VALUES (?);", (p_id,))
        ph_id = cursor.lastrowid

        # Insert detected objects for video and photo
        cursor.execute("""
            INSERT INTO detected_object (project_id, video_id, label, bounding_box, confidence, detector_model)
            VALUES (?, ?, 'claquete', '[100,200,300,400]', 0.92, 'gemini');
        """, (p_id, v_id))
        obj_v_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO detected_object (project_id, photo_id, label, bounding_box, confidence, detector_model)
            VALUES (?, ?, 'chapéu', '[150,250,350,450]', 0.88, 'florence_2');
        """, (p_id, ph_id))
        obj_ph_id = cursor.lastrowid

        # Delete video -> obj_v_id must cascade delete
        cursor.execute("DELETE FROM video WHERE id = ?;", (v_id,))
        cursor.execute("SELECT id FROM detected_object WHERE id = ?;", (obj_v_id,))
        assert cursor.fetchone() is None, "detected_object was not cascade deleted when parent video was deleted"

        # Photo object still remains
        cursor.execute("SELECT id FROM detected_object WHERE id = ?;", (obj_ph_id,))
        assert cursor.fetchone() is not None

        # Delete project -> photo and obj_ph_id must cascade delete
        cursor.execute("DELETE FROM project WHERE id = ?;", (p_id,))
        cursor.execute("SELECT id FROM detected_object WHERE id = ?;", (obj_ph_id,))
        assert cursor.fetchone() is None, "detected_object was not cascade deleted when parent project was deleted"

    def test_on_delete_set_null_on_entity_and_scene(self, db_conn: sqlite3.Connection):
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj X');")
        p_id = cursor.lastrowid
        cursor.execute("INSERT INTO entity (project_id, name) VALUES (?, 'Claquete Principal');", (p_id,))
        ent_id = cursor.lastrowid
        cursor.execute("INSERT INTO scene (project_id, heading) VALUES (?, 'INT. GALPAO - DIA');", (p_id,))
        sc_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO detected_object (project_id, entity_id, scene_id, label, bounding_box, confidence, detector_model)
            VALUES (?, ?, ?, 'claquete', '[10,20,30,40]', 0.9, 'gemini');
        """, (p_id, ent_id, sc_id))
        obj_id = cursor.lastrowid

        # Delete entity
        cursor.execute("DELETE FROM entity WHERE id = ?;", (ent_id,))
        cursor.execute("SELECT entity_id, scene_id FROM detected_object WHERE id = ?;", (obj_id,))
        row = cursor.fetchone()
        assert row is not None, "detected_object was deleted instead of setting entity_id to NULL"
        assert row[0] is None, f"entity_id was not set to NULL: {row[0]}"
        assert row[1] == sc_id

        # Delete scene
        cursor.execute("DELETE FROM scene WHERE id = ?;", (sc_id,))
        cursor.execute("SELECT entity_id, scene_id FROM detected_object WHERE id = ?;", (obj_id,))
        row2 = cursor.fetchone()
        assert row2[0] is None
        assert row2[1] is None, f"scene_id was not set to NULL: {row2[1]}"

    @pytest.mark.parametrize("invalid_category", ["arma", "som", "luz", "unknown", ""])
    def test_category_check_constraint(self, db_conn: sqlite3.Connection, invalid_category: str):
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj');")
        p_id = cursor.lastrowid
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, label, category, bounding_box, confidence, detector_model)
                VALUES (?, 'item', ?, '[1,2,3,4]', 0.8, 'test');
            """, (p_id, invalid_category))

    @pytest.mark.parametrize("invalid_realm", ["fictional", "backstage", "doc", "realidade"])
    def test_realm_check_constraint(self, db_conn: sqlite3.Connection, invalid_realm: str):
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj');")
        p_id = cursor.lastrowid
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, label, realm, bounding_box, confidence, detector_model)
                VALUES (?, 'item', ?, '[1,2,3,4]', 0.8, 'test');
            """, (p_id, invalid_realm))

    @pytest.mark.parametrize("invalid_execution_mode", ["cloud", "cpu", "serverless", "tpu"])
    def test_execution_mode_check_constraint(self, db_conn: sqlite3.Connection, invalid_execution_mode: str):
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj');")
        p_id = cursor.lastrowid
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, label, execution_mode, bounding_box, confidence, detector_model)
                VALUES (?, 'item', ?, '[1,2,3,4]', 0.8, 'test');
            """, (p_id, invalid_execution_mode))

    @pytest.mark.parametrize("invalid_status", ["pending", "verified", "deleted", "active"])
    def test_status_check_constraint(self, db_conn: sqlite3.Connection, invalid_status: str):
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj');")
        p_id = cursor.lastrowid
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            cursor.execute("""
                INSERT INTO detected_object (project_id, label, status, bounding_box, confidence, detector_model)
                VALUES (?, 'item', ?, '[1,2,3,4]', 0.8, 'test');
            """, (p_id, invalid_status))

    def test_nulls_and_boundary_coordinates(self, db_conn: sqlite3.Connection):
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj');")
        p_id = cursor.lastrowid
        # Still photo (timestamp NULL, video_id NULL)
        cursor.execute("""
            INSERT INTO detected_object (project_id, video_id, timestamp, label, bounding_box, confidence, detector_model)
            VALUES (?, NULL, NULL, 'foto_still', '[0, 0, 1000, 1000]', 1.0, 'gemini_spatial');
        """, (p_id,))
        assert cursor.lastrowid > 0

        # Boundary confidence = 0.0
        cursor.execute("""
            INSERT INTO detected_object (project_id, label, bounding_box, confidence, detector_model)
            VALUES (?, 'zero_conf', '[0, 0, 0, 0]', 0.0, 'yolo_world_onnx');
        """, (p_id,))
        assert cursor.lastrowid > 0

    def test_adversarial_sqlite_omitted_constraints(self, db_conn: sqlite3.Connection):
        """Critical finding: SQLite DDL does not enforce CHECK on confidence range or json_valid on bounding_box.
        
        The JSON Schema strictly enforces confidence between 0.0 and 1.0 and bounding_box as a 4-int array.
        However, the raw SQLite DDL accepts out-of-range confidence or non-JSON bounding_box.
        This test documents this empirical gap for our adversarial report.
        """
        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO project (name) VALUES ('Proj');")
        p_id = cursor.lastrowid

        # Confidence > 1.0 is accepted by SQLite because DDL lacks CHECK(confidence BETWEEN 0.0 AND 1.0)
        cursor.execute("""
            INSERT INTO detected_object (project_id, label, bounding_box, confidence, detector_model)
            VALUES (?, 'item_overconf', '[0,0,100,100]', 2.5, 'test');
        """, (p_id,))
        assert cursor.lastrowid > 0

        # Non-JSON string in bounding_box is accepted by SQLite because DDL lacks CHECK(json_valid(bounding_box))
        cursor.execute("""
            INSERT INTO detected_object (project_id, label, bounding_box, confidence, detector_model)
            VALUES (?, 'item_bad_box', 'not_json_coordinates', 0.5, 'test');
        """, (p_id,))
        assert cursor.lastrowid > 0
