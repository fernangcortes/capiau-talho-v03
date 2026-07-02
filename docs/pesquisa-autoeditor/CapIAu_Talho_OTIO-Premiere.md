# CapIAu-Talho: Especificação Técnica OTIO ↔ Adobe Premiere Pro
## Manual de Engenharia para Geração Automática de Timelines Compatíveis

---

## 1. ARQUITETURA DO SCHEMA OTIO (Modelo de Dados Completo)

O OpenTimelineIO é um formato de intercâmbio agnóstico que descreve **estrutura editorial, intenção de corte e metadados** — não codifica mídia. A IA CapIAu-Talho deve gerar objetos JSON seguindo estritamente o schema OTIO.

### 1.1 Hierarquia de Objetos

```
Timeline
└── Stack ("tracks")
    ├── Track (kind="Video")
    │   ├── Clip
    │   ├── Gap
    │   ├── Transition
    │   └── Stack (nested) ← nesting suportado
    ├── Track (kind="Audio")
    │   ├── Clip
    │   ├── Gap
    │   └── Transition
    └── Track (kind="Video") ← múltiplas tracks suportadas
```

### 1.2 Tipos de Objeto (Schema Definitions)

| Objeto | Schema ID | Função | Compat. FCP7 XML |
|--------|-----------|--------|------------------|
| **Timeline** | `Timeline.1` | Container raiz. Contém Stack de tracks + global_start_time | ✔ |
| **Stack** | `Stack.1` | Coleção ordenada de Tracks. Renderização em "painter order" (bottom→top) | ✔ |
| **Track** | `Track.1` | Sequência de Clips/Gaps/Transitions. `kind` pode ser `Video` ou `Audio` | ✔ |
| **Clip** | `Clip.1` | Segmento de mídia editável. Referencia MediaReference + source_range | ✔ |
| **Gap** | `Gap.1` | Espaço vazio na timeline. Duração definida por source_range | ✔ |
| **Transition** | `Transition.1` | Efeito entre dois itens adjacentes (dissolve, wipe). `in_offset`/`out_offset` | ✖ |
| **Marker** | `Marker.1` | Ponto de referência com nome, cor, comentário. Associado a Clip/Track/Timeline | ✔ |
| **Effect** | `Effect.1` | Efeito aplicado a um Item. `effect_name` + metadata | ✖ |
| **ExternalReference** | `ExternalReference.1` | Aponta para arquivo de mídia externo via `target_url` | ✔ |
| **MissingReference** | `MissingReference.1` | Placeholder quando mídia não está disponível | ✔ |
| **GeneratorReference** | `GeneratorReference.1` | Referência a gerador (cor sólida, barras, etc.) | Parcial |
| **SerializableCollection** | `SerializableCollection.1` | Coleção genérica de timelines/clips | ✔ |

### 1.3 Propriedades Essenciais por Objeto

#### Timeline
```json
{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "string",
  "global_start_time": {
    "OTIO_SCHEMA": "RationalTime.1",
    "value": 0,
    "rate": 24
  },
  "tracks": { /* Stack */ },
  "metadata": {}
}
```

#### Track
```json
{
  "OTIO_SCHEMA": "Track.1",
  "name": "V1",
  "kind": "Video",  // ou "Audio"
  "children": [ /* Clip, Gap, Transition, Stack */ ],
  "markers": [],
  "effects": [],
  "metadata": {}
}
```

#### Clip
```json
{
  "OTIO_SCHEMA": "Clip.1",
  "name": "Entrevista_Rose_Take1",
  "media_reference": {
    "OTIO_SCHEMA": "ExternalReference.1",
    "target_url": "file:///media/entrevista_rose.mov",
    "available_range": {
      "OTIO_SCHEMA": "TimeRange.1",
      "start_time": {"value": 0, "rate": 24},
      "duration": {"value": 1500, "rate": 24}
    }
  },
  "source_range": {
    "OTIO_SCHEMA": "TimeRange.1",
    "start_time": {"value": 120, "rate": 24},
    "duration": {"value": 300, "rate": 24}
  },
  "markers": [],
  "effects": [],
  "metadata": {
    "capiau": {
      "scene": "INT-COZINHA-DIA",
      "shot": "01A",
      "take": 1,
      "rating": "circle"
    }
  }
}
```

#### Transition
```json
{
  "OTIO_SCHEMA": "Transition.1",
  "name": "CrossDissolve_01",
  "transition_type": "SMPTE_Dissolve",  // ou "Custom_Transition"
  "in_offset": {"value": 12, "rate": 24},
  "out_offset": {"value": 12, "rate": 24},
  "parameters": {},
  "metadata": {}
}
```

#### Marker
```json
{
  "OTIO_SCHEMA": "Marker.1",
  "name": "SOUNDBITE_IMPORTANTE",
  "marked_range": {
    "OTIO_SCHEMA": "TimeRange.1",
    "start_time": {"value": 0, "rate": 24},
    "duration": {"value": 48, "rate": 24}
  },
  "color": "RED",  // RED, PINK, GREEN, BLUE, CYAN, YELLOW, PURPLE
  "metadata": {
    "capiau": {
      "marker_type": "soundbite",
      "speaker": "Rose",
      "topic": "infancia"
    }
  }
}
```

### 1.4 Modelo de Tempo (OpenTime)

Toda duração/posição usa **RationalTime**:
```json
{
  "OTIO_SCHEMA": "RationalTime.1",
  "value": 150,    // frames ou segundos (depende do contexto)
  "rate": 24       // fps
}
```

**TimeRange** define um intervalo:
```json
{
  "OTIO_SCHEMA": "TimeRange.1",
  "start_time": {"value": 0, "rate": 24},
  "duration": {"value": 300, "rate": 24}
}
```

**Regras de Constraint para a IA:**
- `source_range` de um Clip deve estar (idealmente) dentro do `available_range` do MediaReference
- `in_offset` e `out_offset` de Transition devem ser ≥ 0
- `in_offset` ≤ duração do item anterior; `out_offset` ≤ duração do item seguinte
- Duas Transitions não podem estar adjacentes (deve haver um Composable entre elas)
- Transitions no início/fim de Track geram Gaps implícitos

---

## 2. FERRAMENTAS E ECOSISTEMA OTIO

### 2.1 Instalação Core
```bash
pip install opentimelineio          # biblioteca core (Python 3.9-3.12)
pip install OpenTimelineIO-Plugins    # adapters extras (pós v0.16)
```

### 2.2 Ferramentas de Linha de Comando (CLI)

| Ferramenta | Função | Uso no Pipeline |
|------------|--------|-----------------|
| **otioview** | Visualizador de timeline com player básico | QC rápido antes de enviar ao Premiere |
| **otioconvert** | Converte entre formatos (otio ↔ fcp_xml ↔ aaf ↔ edl) | **Principal**: gera FCP7 XML para Premiere |
| **otiocat** | Concatena múltiplos arquivos OTIO | Merge de cenas/sequências |
| **otioz** | Empacota .otio + mídia em arquivo .otioz (zip) | Entrega portátil com assets |
| **otiod** | Empacota .otio + mídia em diretório | Organização de projeto |

### 2.3 Adapters Disponíveis (Matriz Completa)

| Adapter | Formato | Read | Write | Notas para Premiere |
|---------|---------|------|-------|---------------------|
| **fcp_xml** | Final Cut Pro 7 XML | ✔ | ✔ | **PONTE PRINCIPAL** para Premiere |
| **aaf** | Avid Media Composer AAF | ✔ | ✔ | Alternativa se pipeline passar por Media Composer |
| **cmx_3600** | EDL (CMX3600) | ✔ | ✔ | Estilo `premiere` disponível; perde múltiplas tracks |
| **rv** | ShotGrid/RV session | ✔ | ✔ | Review em VFX |
| **svg** | SVG sequence | ✔ | ✔ | Visualização gráfica da timeline |
| **otio** | Native .otio/.otioz/.otiod | ✔ | ✔ | Formato nativo (futuro nativo no Premiere) |
| **fcp_xml** (XtoCC) | FCP X → FCP 7 XML | — | — | Intelligent Assistance (conversor comercial) |

### 2.4 Plugins e Extensões

| Tipo | Função | Aplicação |
|------|--------|-----------|
| **Media Linkers** | Resolve referências de mídia localmente | Conectar `target_url` relativo ao path absoluto do projeto |
| **Hook Scripts** | Executam em pontos específicos do pipeline | Pré-processamento de metadados antes da conversão |
| **SchemaDefs** | Definem schemas customizados | Extender OTIO com tipos próprios do CapIAu-Talho |
| **Protio** | Extensão Premiere para OTIO nativo | WIP; import/export .otio direto no Premiere (sem FCP7 XML) |

### 2.5 Recursos da Comunidade

- **GitHub Oficial:** https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- **Documentação:** https://opentimelineio.readthedocs.io/
- **Lista de Discussão:** https://lists.aswf.io/g/otio-discussion
- **PyPI:** https://pypi.org/project/OpenTimelineIO/
- **Especificação Core:** https://sandflow.github.io/otio-core-specification/

---

## 3. MATRIZ DE COMPATIBILIDADE OTIO ↔ PREMIERE PRO

### 3.1 Adapter FCP7 XML — Feature Matrix Oficial

| Feature OTIO | FCP7 XML Adapter | Premiere Import | Notas Críticas |
|--------------|------------------|-----------------|----------------|
| Single Track de Clips | ✔ | ✔ | Base funcional |
| Múltiplas Video Tracks | ✔ | ✔ | Suportado nativamente |
| Audio Tracks & Clips | ✔ | ✔ | Mapeamento de canais preservado |
| Gap / Filler | ✔ | ✔ | Convertido para espaço vazio |
| **Markers** | ✔ | ✔ | **Cores mapeadas**: vermelho=ToDo unfinished, verde=ToDo completed, azul=standard, amarelo=chapter |
| **Nesting** | ✔ | ✔ | Stacks aninhados viram Sequences aninhadas no Premiere |
| **Transitions** | ✖ | ✖ | **NÃO SUPORTADO**. Dissolves/wipes são perdidos no FCP7 XML. Premiere não importa transitions via FCP XML. |
| **Audio/Video Effects** | ✖ | ✖ | **NÃO SUPORTADO**. Effects engines são incompatíveis entre NLEs. |
| **Linear Speed Effects** | ✖ | ✖ | Speed changes não transferem via FCP7 XML. |
| **Fancy Speed Effects** | ✖ | ✖ | Retime curves, keyframed speed, etc. não suportados. |
| **Color Decision List (CDL)** | ✖ | ✖ | Metadados de cor não passam pelo adapter. |
| **Image Sequence Reference** | W-O | Parcial | Write-Only no adapter; Premiere pode precisar de tratamento manual. |
| **Multicam** | ✖ | ✖ | **NÃO SUPORTADO**. FCP7 XML não carrega multicam no Premiere. Clips multicam viram clips colapsados. |

### 3.2 O que Premiere Pro importa de FCP7 XML (Realidade)

Baseado em testes de comunidade e documentação Adobe:

| Elemento | Status | Detalhes |
|----------|--------|----------|
| Edit points (In/Out/Duração) | ✔ | Transferência perfeita de timecode |
| Cross-dissolves básicos | ✔ Parcial | Apenas dissolves padrão; settings customizados são perdidos |
| Opacity/Position/Scale | ✔ Parcial | Transform básico pode transferir, mas keyframes complexos não |
| Markers | ✔ | Cores e comentários preservados |
| Split edits (J/L cuts) | ✔ | Preservados |
| Audio volume/pan (keyframes) | ✔ Parcial | Keyframes de volume em clip inteiro transferem; por componente é instável |
| Nested sequences | ✔ | Compound clips/Stacks aninhados viram sequences aninhadas |
| Merged clips (sync) | ✔ | Synchronized clips viram merged clips |
| Effects | ✖ | Nenhum efeito customizado ou nativo FCP transfere |
| Color settings | ✖ | Não transferem |
| Transform complexo (Ken Burns, Crop) | ✖ | Não suportado |
| Roles | ✖ | Não suportado; tracks são nomeadas por Role em alguns conversores |
| iTT Captions | ✖ | Não suportado |

### 3.3 Limitações Críticas para CapIAu-Talho

1. **NÃO gere Transitions no OTIO se o destino for Premiere via FCP7 XML** — elas serão completamente perdidas. A IA deve gerar cortes secos (hard cuts) e, se necessário, instruir o editor humano a adicionar dissolves manualmente no Premiere.

2. **NÃO aplique Effects no OTIO** — o adapter os descarta. Metadados de intenção de efeito devem ir em `metadata` customizada (ex: `{"capiau": {"effect_intent": "blur_20px"}}`) para que o editor humano ou um script UXP posterior aplique no Premiere.

3. **Multicam é impossível via FCP7 XML** — se o projeto usar multicam, a IA deve gerar uma timeline com o ângulo ativo como clip normal, ou usar o formato nativo .otio (beta no Premiere) se disponível.

4. **Speed/Retime** — não use `LinearTimeWarp` ou `FreezeFrame` se o destino for Premiere via FCP7 XML. A IA deve calcular os cortes já com a duração final desejada.

5. **Media References** — use `ExternalReference` com `target_url` absoluto ou relativo bem definido. O Premiere precisa encontrar a mídia no mesmo path ou relativo ao projeto.

---

## 4. DOCUMENTOS NECESSÁRIOS PARA TREINAR OS AGENTES EDITORES (CapIAu-Talho)

Para que a IA gere .otio válido e compatível com Premiere, os agentes precisam ser treinados com:

### 4.1 Documento 1: Schema OTIO + Constraints (JSON Schema / Regras)

```json
{
  "capiau_otio_rules": {
    "version": "1.0",
    "target_nle": "Adobe Premiere Pro",
    "interchange_format": "FCP7 XML via OTIO adapter",
    "supported_features": [
      "single_and_multiple_tracks",
      "video_and_audio",
      "gaps",
      "markers",
      "nesting",
      "basic_media_references"
    ],
    "unsupported_features": [
      "transitions",
      "effects",
      "speed_changes",
      "multicam",
      "color_decisions",
      "image_sequences"
    ],
    "constraints": {
      "max_video_tracks": 99,
      "max_audio_tracks": 99,
      "transition_policy": "FORBIDDEN",
      "effect_policy": "FORBIDDEN_USE_METADATA_INSTEAD",
      "speed_policy": "PRE_COMPUTE_DURATION",
      "multicam_policy": "RENDER_ACTIVE_ANGLE_ONLY",
      "media_path_policy": "ABSOLUTE_OR_PROJECT_RELATIVE",
      "frame_rate_policy": "MATCH_PROJECT",
      "marker_colors": ["RED", "PINK", "GREEN", "BLUE", "CYAN", "YELLOW", "PURPLE"]
    }
  }
}
```

### 4.2 Documento 2: Mapeamento de Nomenclatura CapIAu ↔ OTIO ↔ Premiere

| Conceito Editorial | Nome OTIO | Mapeamento Premiere | Exemplo de Uso |
|--------------------|-----------|---------------------|----------------|
| Sequência | `Timeline` | Sequence | Cada "cena" ou "episódio" é um Timeline |
| Faixa de Vídeo | `Track` (kind="Video") | Video Track V1, V2... | `name`: "V1_ENTREVISTAS" |
| Faixa de Áudio | `Track` (kind="Audio") | Audio Track A1, A2... | `name`: "A1_SOM_DIRETO" |
| Clipe | `Clip` | Clip na timeline | `name`: "INT_COZINHA_01A_T01" |
| Buraco | `Gap` | Empty space | Usado para timing e ritmo |
| Marcador | `Marker` | Marker no clip/track | Cores por tipo de conteúdo |
| Transição | `Transition` (proibido) | — | Não usar. Usar metadata: `{"intent": "dissolve_12f"}` |
| Efeito | `Effect` (proibido) | — | Não usar. Usar metadata: `{"intent": "blur_20px"}` |
| Nest/Subsequência | `Stack` aninhado | Nested Sequence | Para organizar atos/cenas |
| Referência de Mídia | `ExternalReference` | Media link | `target_url`: caminho absoluto |

### 4.3 Documento 3: Prompt Engineering — Estrutura de Geração

O agente editor deve receber prompts estruturados e gerar OTIO. Exemplo de template:

```
PROMPT: Criar timeline documentário "Infância de Rose"

INPUTS:
- assets: [lista de media_references com available_range]
- script: [roteiro com timecodes de soundbites]
- style: [ritmo, tipo de corte, uso de b-roll]

OUTPUT REQUERIDO (OTIO JSON):
1. Timeline com nome do projeto
2. Global start time = 00:00:00:00 @ 24fps
3. Tracks:
   - V1: Entrevistas (clips principais)
   - V2: B-roll (imagens de arquivo)
   - A1: Som direto entrevistas
   - A2: Música ambiente
   - A3: Efeitos sonoros
4. Markers em cada clip de entrevista indicando:
   - SOUNDBITE (RED)
   - TRANSICAO_SUGERIDA (YELLOW)
   - BROLL_SUGERIDO (BLUE)
5. Nenhum Transition ou Effect no schema OTIO
6. Gaps entre clips para ritmo (ex: 6 frames entre takes)
7. Metadados CapIAu em cada clip:
   - scene, shot, take, speaker, topic, sentiment

REGRAS:
- source_range deve respeitar available_range
- Nunca usar Transition objects
- Nunca usar Effect objects
- target_url deve usar file:// protocol
- rate deve ser consistente (24fps) em todo o documento
```

### 4.4 Documento 4: Exemplos de .otio Válido (Few-Shot Training)

A IA deve ser treinada com exemplos reais de .otio que funcionam. Abaixo, um exemplo mínimo completo:

```json
{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "DOC_Rose_Ep01_v01",
  "global_start_time": {
    "OTIO_SCHEMA": "RationalTime.1",
    "value": 0,
    "rate": 24
  },
  "tracks": {
    "OTIO_SCHEMA": "Stack.1",
    "name": "tracks",
    "children": [
      {
        "OTIO_SCHEMA": "Track.1",
        "name": "V1_ENTREVISTAS",
        "kind": "Video",
        "children": [
          {
            "OTIO_SCHEMA": "Clip.1",
            "name": "Rose_Infancia_Soundbite",
            "media_reference": {
              "OTIO_SCHEMA": "ExternalReference.1",
              "target_url": "file:///projeto/media/entrevista_rose.mov",
              "available_range": {
                "OTIO_SCHEMA": "TimeRange.1",
                "start_time": {"value": 0, "rate": 24},
                "duration": {"value": 3600, "rate": 24}
              }
            },
            "source_range": {
              "OTIO_SCHEMA": "TimeRange.1",
              "start_time": {"value": 120, "rate": 24},
              "duration": {"value": 180, "rate": 24}
            },
            "markers": [
              {
                "OTIO_SCHEMA": "Marker.1",
                "name": "SOUNDBITE_PRINCIPAL",
                "marked_range": {
                  "OTIO_SCHEMA": "TimeRange.1",
                  "start_time": {"value": 0, "rate": 24},
                  "duration": {"value": 180, "rate": 24}
                },
                "color": "RED",
                "metadata": {
                  "capiau": {
                    "speaker": "Rose",
                    "topic": "infancia",
                    "transcript": "Quando eu era criança..."
                  }
                }
              }
            ],
            "metadata": {
              "capiau": {
                "scene": "INT-ESTUDIO-DIA",
                "shot": "MCU_ROSE",
                "take": 1,
                "camera": "A",
                "rating": "circle"
              }
            }
          },
          {
            "OTIO_SCHEMA": "Gap.1",
            "name": "PAUSA_RITMO",
            "source_range": {
              "OTIO_SCHEMA": "TimeRange.1",
              "start_time": {"value": 0, "rate": 24},
              "duration": {"value": 6, "rate": 24}
            }
          },
          {
            "OTIO_SCHEMA": "Clip.1",
            "name": "BROLL_BRINQUEDOS_01",
            "media_reference": {
              "OTIO_SCHEMA": "ExternalReference.1",
              "target_url": "file:///projeto/media/broll_brinquedos.mov",
              "available_range": {
                "OTIO_SCHEMA": "TimeRange.1",
                "start_time": {"value": 0, "rate": 24},
                "duration": {"value": 500, "rate": 24}
              }
            },
            "source_range": {
              "OTIO_SCHEMA": "TimeRange.1",
              "start_time": {"value": 30, "rate": 24},
              "duration": {"value": 120, "rate": 24}
            },
            "metadata": {
              "capiau": {
                "broll_category": "infancia_objetos",
                "suggested_transition": "dissolve_12f",
                "associated_soundbite": "Rose_Infancia_Soundbite"
              }
            }
          }
        ],
        "markers": [],
        "effects": [],
        "metadata": {}
      },
      {
        "OTIO_SCHEMA": "Track.1",
        "name": "A1_SOM_DIRETO",
        "kind": "Audio",
        "children": [
          {
            "OTIO_SCHEMA": "Clip.1",
            "name": "Rose_Infancia_Audio",
            "media_reference": {
              "OTIO_SCHEMA": "ExternalReference.1",
              "target_url": "file:///projeto/media/entrevista_rose.wav",
              "available_range": {
                "OTIO_SCHEMA": "TimeRange.1",
                "start_time": {"value": 0, "rate": 48000},
                "duration": {"value": 360000, "rate": 48000}
              }
            },
            "source_range": {
              "OTIO_SCHEMA": "TimeRange.1",
              "start_time": {"value": 2880, "rate": 48000},
              "duration": {"value": 4320, "rate": 48000}
            },
            "metadata": {}
          }
        ],
        "markers": [],
        "effects": [],
        "metadata": {}
      }
    ],
    "markers": [],
    "effects": [],
    "metadata": {}
  },
  "metadata": {
    "capiau": {
      "project": "DOC_Rose",
      "episode": "01",
      "version": "v01",
      "editor_ai": "CapIAu-Talho",
      "frame_rate": 24,
      "resolution": "1920x1080",
      "color_space": "Rec.709"
    }
  }
}
```

### 4.5 Documento 5: Pipeline de Validação e Conversão

```python
# Script de validação e conversão (para treinamento do agente)
import opentimelineio as otio

def validate_capiau_otio(timeline_path):
    timeline = otio.adapters.read_from_file(timeline_path)

    errors = []

    # Regra 1: Nenhum Transition
    for tr in timeline.find_children(descended_from_type=otio.schema.Transition):
        errors.append(f"Transition proibida encontrada: {tr.name}")

    # Regra 2: Nenhum Effect
    for clip in timeline.find_clips():
        if clip.effects:
            errors.append(f"Effect proibido em clip: {clip.name}")

    # Regra 3: MediaReference não pode ser Missing
    for clip in timeline.find_clips():
        if isinstance(clip.media_reference, otio.schema.MissingReference):
            errors.append(f"MissingReference em clip: {clip.name}")

    # Regra 4: Frame rate consistente
    rates = set()
    for clip in timeline.find_clips():
        if clip.source_range:
            rates.add(clip.source_range.start_time.rate)
    if len(rates) > 1:
        errors.append(f"Frame rates inconsistentes: {rates}")

    return errors

def convert_to_premiere(otio_path, output_xml_path):
    timeline = otio.adapters.read_from_file(otio_path)
    otio.adapters.write_to_file(timeline, output_xml_path, adapter_name="fcp_xml")
    return output_xml_path
```

---

## 5. PIPELINE DE IMPLEMENTAÇÃO COMPLETO

### 5.1 Fluxo de Trabalho

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   CapIAu-Talho  │────▶│  .otio (nativo)  │────▶│   otioconvert   │
│  (Geração IA)   │     │  (validação)     │     │  (fcp_xml)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Premiere Pro   │◀────│  FCP7 XML        │◀────│  QC/Review      │
│  (Import XML)   │     │  (intermediário) │     │  (otioview)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### 5.2 Comandos de Conversão

```bash
# 1. Gerar .otio (via CapIAu-Talho)
# 2. Validar
python validate_capiau_otio.py cena_01.otio

# 3. Converter para FCP7 XML
otioconvert -i cena_01.otio -o cena_01.xml -a fcp_xml

# 4. (Opcional) Empacotar com mídia
otioz -i cena_01.otio -o entrega_cena_01.otioz

# 5. Importar no Premiere Pro
# File > Import > selecionar cena_01.xml
# Premiere criará bins e sequences automaticamente
```

### 5.3 Configuração de Media Linking

Para que o Premiere encontre a mídia automaticamente:

1. **Caminhos absolutos** (recomendado para pipeline automatizado):
   ```json
   "target_url": "file:///Volumes/RAID5/Projeto/Media/entrevista_rose.mov"
   ```

2. **Caminhos relativos** (recomendado para portabilidade):
   ```json
   "target_url": "Media/entrevista_rose.mov"
   ```
   O Premiere resolverá relativo ao arquivo .xml ou ao projeto.

3. **Media Linker customizado** (OTIO):
   ```python
   # hook_script.py
   def link_media_reference(in_clip, media_linker_argument_map):
       url = in_clip.media_reference.target_url
       # Lógica de resolução de path
       in_clip.media_reference.target_url = resolved_path
   ```

### 5.4 Estrutura de Projeto Recomendada

```
CapIAu-Talho_Project/
├── 01_Scripts/              # Roteiros e prompts
├── 02_Assets/
│   ├── Media/               # Arquivos de mídia brutos
│   └── Proxies/             # Proxies para review
├── 03_OTIO/
│   ├── Raw/                 # .otio gerado pela IA
│   ├── Validated/           # .otio pós-validação
│   └── Archive/             # .otioz empacotados
├── 04_XML/
│   ├── FCP7/                # XML para Premiere
│   └── EDL/                 # EDLs para backup
├── 05_Premiere/
│   ├── Projects/            # .prproj
│   └── Exports/             # Renders finais
└── 06_Documentation/
    ├── Schema_Rules.md      # Este documento
    └── Prompt_Templates.md  # Templates de prompt
```

---

## 6. CHECKLIST DE COMPATIBILIDADE PARA CADA ENTREGA

Antes de enviar qualquer .otio para conversão Premiere, verificar:

- [ ] Nenhum objeto `Transition` presente
- [ ] Nenhum objeto `Effect` presente
- [ ] Nenhum `LinearTimeWarp` ou `FreezeFrame` presente
- [ ] Todos os clips usam `ExternalReference` (não `MissingReference`)
- [ ] Frame rate consistente em todo o documento
- [ ] `source_range` dentro de `available_range` para todos os clips
- [ ] Markers usando cores da lista permitida
- [ ] `target_url` resolvível pelo Premiere (absoluto ou relativo ao projeto)
- [ ] Nesting apenas com `Stack` aninhado (suportado)
- [ ] Nenhum multicam (apenas ângulo ativo como clip normal)
- [ ] Metadados CapIAu presentes para rastreabilidade
- [ ] Nomeação consistente: `CENA_SHOT_TAKE_VERSAO` (ex: `01_01A_T01_v01`)
- [ ] Gaps calculados para ritmo (não usar transitions)
- [ ] Audio tracks separados: A1=som direto, A2=música, A3=efx
- [ ] Exportação testada via `otioconvert` para FCP7 XML e importação testada no Premiere

---

## 7. ROADMAP E FUTURO

| Milestone | Status | Impacto no CapIAu-Talho |
|-----------|--------|-------------------------|
| OTIO nativo no Premiere (beta CC) | Em beta | Futuro: exportar .otio direto, sem FCP7 XML intermediário |
| Protio (extensão Premiere OTIO) | WIP | Possibilitará import/export nativo .otio |
| Transitions no FCP7 adapter | Não planejado | Continuar proibindo transitions |
| Effects no FCP7 adapter | Não planejado | Continuar usando metadata para intent |
| Novos adapters (Pro Tools, Reaper) | Ativo | Pipeline áudio será nativo OTIO |

---

*Documento gerado para CapIAu-Talho — Pipeline OTIO ↔ Adobe Premiere Pro*
*Versão 1.0 | Baseado em OpenTimelineIO v0.16+ | Adobe Premiere Pro 2025/2026*
