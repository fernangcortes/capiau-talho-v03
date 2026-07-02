# CapIAu-Talho: Especificacao Tecnica OTIO ↔ Kdenlive
## Manual de Engenharia para Geracao Automatica de Timelines Compativeis

---

## 1. STATUS ATUAL: SUPORTE NATIVO OTIO NO KDENLIVE

O Kdenlive implementou **suporte nativo a OpenTimelineIO (OTIO)** a partir da versao **25.04.0** (abril de 2025). Diferente do Adobe Premiere Pro — que ainda depende do adapter FCP7 XML como ponte intermediaria — o Kdenlive le e escreve arquivos `.otio` diretamente, sem conversores externos.

### Historico da Integracao
- **Adapter Python legado** (`otio-kdenlive-adapter`): Distribuido via PyPI, baseado em MLT XML. **DEPRECATED** desde a versao 25.04. citeweb_search:5#15
- **Integracao nativa C++**: Desenvolvida pela Grizzly Peak 3D com funding da comunidade Kdenlive. Integrada diretamente ao core do Kdenlive. citeweb_search:5#3
- **Status atual**: Kdenlive 25.04+ possui menus nativos `File > OpenTimelineIO Import` e `File > OpenTimelineIO Export`. citeweb_search:5#5

---

## 2. MATRIZ DE COMPATIBILIDADE OTIO ↔ KDENLIVE

### 2.1 Features Suportadas (Nativo)

| Feature OTIO | Kdenlive Import | Kdenlive Export | Notas para CapIAu-Talho |
|--------------|:---------------:|:---------------:|------------------------|
| **Timeline** (Stack de tracks) | ✔ | ✔ | Container raiz. Suportado nativamente. |
| **Multiplas Video Tracks** | ✔ | ✔ | Suportado. **Nota critica**: em versoes 25.04.x havia bug de inversao de ordem de tracks de video entre Kdenlive e DaVinci Resolve. **Corrigido** em builds diarias pos-01/06/2025. citeweb_search:5#2 |
| **Multiplas Audio Tracks** | ✔ | ✔ | Suportado nativamente. |
| **Clips** (source_range + media_reference) | ✔ | ✔ | Referencias externas (`ExternalReference`) sao resolvidas via path absoluto ou relativo. |
| **Gaps** (espacos vazios) | ✔ | ✔ | Convertidos para espacos vazios na timeline. |
| **Timeline Markers** (OTIO markers no Stack) | ✔ | ✔ | Convertidos para **Guides/Markers do timeline** Kdenlive. citeweb_search:5#5 |
| **Clip Markers** (OTIO markers em Clip) | ✔ | ✔ | Convertidos para **Clip Markers** Kdenlive. **Diferenca semantica critica**: em Kdenlive, clip markers sao **compartilhados entre todas as instancias do mesmo clip**; em OTIO, markers sao **unicos por instancia** do clip na timeline. citeweb_search:5#5 |
| **Basic Transition Data** | ✔ | ✔ | Grizzly Peak 3D menciona "basic transition data" como suportado na integracao nativa. citeweb_search:5#3 |
| **Metadados Round-trip** | ✔ | ✔ | Kdenlive armazena seus marker types como metadata OTIO sob a chave `kdenlive`, permitindo ida e volta sem perda. citeweb_search:5#5 |
| **MissingReference** | ✔ | — | Clips com referencia faltante sao importados como placeholders. |

### 2.2 Features NAO Suportadas ou Limitadas

| Feature OTIO | Status | Impacto no CapIAu-Talho |
|--------------|--------|------------------------|
| **Effects** (Effect.1) | ✖ | Efeitos de video/audio nao sao transferidos via OTIO. Engines de efeitos sao incompativeis entre NLEs. Mesma limitacao do Premiere. |
| **Complex Transitions** | Parcial | "Basic transition data" e suportado, mas transitions complexas ou customizadas provavelmente nao transferem corretamente. Recomenda-se gerar cortes secos e usar metadata para intencao. |
| **Speed Changes / TimeWarp** | ✖ | Nao documentado como suportado. Assumir que nao funciona. Pre-calcular duracoes. |
| **Image Sequence Reference** | ✖ | Nao suportado na integracao nativa atual. Em roadmap da Grizzly Peak 3D. citeweb_search:5#3 |
| **Multi-timeline Projects** | ✖ | Nao suportado. Em roadmap. citeweb_search:5#3 |
| **OTIO Archive Bundles (.otioz)** | ✖ | Nao suportado. Em roadmap. citeweb_search:5#3 |
| **Color Decision List (CDL)** | ✖ | Nao suportado. |
| **Nesting profundo** | Parcial | Suportado via Stacks aninhados, mas testar com cuidado. |
| **Render/Export Settings** | ✖ | OTIO nao contem informacoes de renderizacao. Kdenlive infere resolucao do primeiro video clip. citeweb_search:5#5 |

### 2.3 Diferencas Semanticas Criticas (Kdenlive vs OTIO vs Premiere)

| Aspecto | OTIO | Kdenlive | Adobe Premiere (via FCP7 XML) |
|---------|------|----------|------------------------------|
| **Clip Markers** | Unicos por instancia na timeline | Compartilhados entre todas as instancias do mesmo clip | Suportados, preservados por instancia |
| **Track Order (Video)** | Bottom-to-top (painter order) | Top-to-bottom | Top-to-bottom |
| **Transitions** | Suportado no schema | "Basic transition data" suportado | **NAO suportado** via FCP7 XML |
| **Formato Nativo** | `.otio` | `.kdenlive` (MLT XML) | `.prproj` (proprietario) |
| **Intercambio OTIO** | Nativo | Nativo (25.04+) | Indireto (via FCP7 XML adapter) |
| **Effects** | Schema existe, mas nao interoperavel | Descartado | Descartado |
| **Media Path** | `target_url` (file://) | Resolvido via path absoluto/relativo | Resolvido via path absoluto/relativo |
| **Marker Colors** | RED, PINK, GREEN, BLUE, CYAN, YELLOW, PURPLE | Mapeamento por cor mais proxima se metadata `kdenlive` nao presente | Mapeamento fixo (vermelho=ToDo, verde=done, etc.) |

---

## 3. ARQUITETURA DO SCHEMA OTIO PARA KDENLIVE

O Kdenlive le o schema OTIO nativo diretamente. Nao ha necessidade de converter para FCP7 XML ou MLT XML intermediario.

### 3.1 Estrutura Minima Valida

```json
{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "DOC_Rose_Kdenlive_v01",
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
                  "kdenlive": {
                    "marker_type": "guide",
                    "comment": "Soundbite principal - infancia"
                  },
                  "capiau": {
                    "speaker": "Rose",
                    "topic": "infancia",
                    "transcript": "Quando eu era crianca..."
                  }
                }
              }
            ],
            "metadata": {
              "capiau": {
                "scene": "INT-ESTUDIO-DIA",
                "shot": "MCU_ROSE",
                "take": 1
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
    "markers": [
      {
        "OTIO_SCHEMA": "Marker.1",
        "name": "INICIO_ATO_1",
        "marked_range": {
          "OTIO_SCHEMA": "TimeRange.1",
          "start_time": {"value": 0, "rate": 24},
          "duration": {"value": 1, "rate": 24}
        },
        "color": "YELLOW",
        "metadata": {
          "kdenlive": {
            "marker_type": "guide"
          }
        }
      }
    ],
    "effects": [],
    "metadata": {}
  },
  "metadata": {
    "capiau": {
      "project": "DOC_Rose",
      "episode": "01",
      "version": "v01",
      "editor_ai": "CapIAu-Talho",
      "target_nle": "Kdenlive",
      "frame_rate": 24,
      "resolution": "1920x1080"
    }
  }
}
```

### 3.2 Regras de Constraint Especificas para Kdenlive

1. **Clip Markers**: Como Kdenlive compartilha markers entre instancias do mesmo clip, a IA deve evitar colocar markers diferentes em instancias distintas do mesmo media file. Se necessario, duplique a referencia de midia com nomes diferentes.

2. **Timeline Markers**: Use markers no `Stack` (tracks) para guides globais do projeto (inicio de atos, notas de exportacao). Kdenlive os converte para timeline guides.

3. **Metadata Round-trip**: Para garantir que markers voltem corretamente do Kdenlive para OTIO, inclua a chave `kdenlive` nos metadados dos markers com `marker_type` e `comment`.

4. **Frame Rate**: Todo o projeto deve ter frame rate consistente. Kdenlive infere do primeiro clip se nao houver metadata de projeto.

5. **Transitions**: "Basic transition data" e suportado, mas para maxima compatibilidade, prefira cortes secos + metadata de intencao.

---

## 4. PIPELINE DE IMPLEMENTACAO COMPLETO (Kdenlive)

### 4.1 Fluxo de Trabalho

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   CapIAu-Talho  │────▶│  .otio (nativo)  │────▶│   otioview      │
│  (Geracao IA)   │     │  (validacao)     │     │  (QC visual)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Kdenlive      │◀────│  .otio           │◀────│  Import direto  │
│  (File > Import │     │  (sem conversao) │     │  (nativo)       │
│   OpenTimelineIO)│     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### 4.2 Comandos de Validacao e Empacotamento

```bash
# 1. CapIAu-Talho gera o .otio

# 2. Validacao Python
python validate_capiau_otio.py cena_01.otio

# 3. QC visual (opcional)
otioview cena_01.otio

# 4. Empacotar para entrega (midia + .otio)
otioz -i cena_01.otio -o entrega_cena_01.otioz
# NOTA: Kdenlive ainda nao suporta .otioz nativo. Desempacote antes.

# 5. No Kdenlive: File > OpenTimelineIO Import > selecionar cena_01.otio
#    Kdenlive criara automaticamente tracks, clips e markers.
```

### 4.3 Diferenca de Pipeline: Kdenlive vs Premiere

| Etapa | Kdenlive | Adobe Premiere Pro |
|-------|----------|-------------------|
| **Formato de entrada** | `.otio` nativo | `.xml` (FCP7 via adapter) |
| **Conversao necessaria** | NENHUMA | `otioconvert -a fcp_xml` |
| **Transitions** | Basic data suportado | PROIBIDO (perdido no FCP7 XML) |
| **Clip Markers** | Compartilhados entre instancias | Unicos por instancia |
| **Track Order Bug** | Corrigido em 25.04.1+ | N/A |
| **Effects** | Nao transferem | Nao transferem |
| **Media Relink** | Automatico se path correto | Automatico se path correto |
| **Round-trip** | Suportado (metadata `kdenlive`) | Nao suportado (unidirecional) |

---

## 5. DOCUMENTOS NECESSARIOS PARA TREINAR OS AGENTES EDITORES (Kdenlive)

### 5.1 Documento 1: Schema OTIO + Constraints Kdenlive

```json
{
  "capiau_otio_rules_kdenlive": {
    "version": "1.0",
    "target_nle": "Kdenlive",
    "interchange_format": "OTIO nativo (.otio)",
    "supported_features": [
      "single_and_multiple_tracks",
      "video_and_audio",
      "gaps",
      "timeline_markers",
      "clip_markers",
      "basic_transitions",
      "nesting",
      "external_references",
      "metadata_roundtrip"
    ],
    "unsupported_features": [
      "effects",
      "speed_changes",
      "image_sequences",
      "multi_timeline_projects",
      "otioz_bundles",
      "color_decisions"
    ],
    "constraints": {
      "max_video_tracks": 99,
      "max_audio_tracks": 99,
      "transition_policy": "BASIC_ONLY_PREFER_METADATA",
      "effect_policy": "FORBIDDEN_USE_METADATA_INSTEAD",
      "speed_policy": "PRE_COMPUTE_DURATION",
      "marker_semantic": "SHARED_BETWEEN_INSTANCES",
      "media_path_policy": "ABSOLUTE_OR_PROJECT_RELATIVE",
      "frame_rate_policy": "MATCH_PROJECT",
      "marker_colors": ["RED", "PINK", "GREEN", "BLUE", "CYAN", "YELLOW", "PURPLE"],
      "metadata_namespace": "kdenlive"
    }
  }
}
```

### 5.2 Documento 2: Mapeamento de Nomenclatura CapIAu ↔ OTIO ↔ Kdenlive

| Conceito Editorial | Nome OTIO | Mapeamento Kdenlive | Exemplo de Uso |
|--------------------|-----------|---------------------|----------------|
| Sequencia | `Timeline` | Timeline/Project | Cada "cena" ou "episodio" e um Timeline |
| Faixa de Video | `Track` (kind="Video") | Video Track V1, V2... | `name`: "V1_ENTREVISTAS" |
| Faixa de Audio | `Track` (kind="Audio") | Audio Track A1, A2... | `name`: "A1_SOM_DIRETO" |
| Clipe | `Clip` | Clip na timeline | `name`: "INT_COZINHA_01A_T01" |
| Buraco | `Gap` | Empty space | Usado para timing e ritmo |
| Marcador de Timeline | `Marker` (no Stack) | Guide/Marker do timeline | Marcas globais (inicio de ato) |
| Marcador de Clip | `Marker` (no Clip) | Clip Marker | **Compartilhado** entre instancias do mesmo clip |
| Transicao | `Transition` | Basic transition | Usar com cautela; preferir metadata |
| Efeito | `Effect` | — | Nao usar. Usar metadata: `{"intent": "blur_20px"}` |
| Nest/Subsequencia | `Stack` aninhado | Nested timeline | Para organizar atos/cenas |
| Referencia de Midia | `ExternalReference` | Media link | `target_url`: caminho absoluto |

### 5.3 Documento 3: Prompt Engineering — Estrutura de Geracao Kdenlive

```
PROMPT: Criar timeline documentario "Infancia de Rose" para Kdenlive

INPUTS:
- assets: [lista de media_references com available_range]
- script: [roteiro com timecodes de soundbites]
- style: [ritmo, tipo de corte, uso de b-roll]

OUTPUT REQUERIDO (OTIO JSON para Kdenlive):
1. Timeline com nome do projeto
2. Global start time = 00:00:00:00 @ 24fps
3. Tracks:
   - V1: Entrevistas (clips principais)
   - V2: B-roll (imagens de arquivo)
   - A1: Som direto entrevistas
   - A2: Musica ambiente
   - A3: Efeitos sonoros
4. Timeline Markers (no Stack) para:
   - INICIO_ATO_1 (YELLOW)
   - INICIO_ATO_2 (YELLOW)
   - FIM_CREDITOS (PURPLE)
5. Clip Markers em cada clip de entrevista:
   - SOUNDBITE (RED) — NOTA: sera compartilhado entre instancias
   - TRANSICAO_SUGERIDA (YELLOW)
   - BROLL_SUGERIDO (BLUE)
6. Metadados Kdenlive em markers para round-trip:
   - {"kdenlive": {"marker_type": "guide", "comment": "..."}}
7. Metadados CapIAu em cada clip:
   - scene, shot, take, speaker, topic, sentiment
8. Nenhum Effect object
9. Transitions apenas basicas (dissolve simples); preferir metadata de intencao
10. target_url deve usar file:// protocol
11. rate deve ser consistente (24fps) em todo o documento

REGRAS ESPECIFICAS KDENLIVE:
- NUNCA colocar markers diferentes no mesmo clip se ele aparecer em multiplas posicoes
- Usar metadata namespace "kdenlive" para markers que precisam de round-trip
- Gaps para ritmo (ex: 6 frames entre takes)
- source_range deve respeitar available_range
- Nao usar MissingReference
```

### 5.4 Documento 4: Script de Validacao para Kdenlive

```python
import opentimelineio as otio

def validate_capiau_otio_kdenlive(timeline_path):
    timeline = otio.adapters.read_from_file(timeline_path)
    errors = []
    warnings = []

    # Regra 1: Nenhum Effect
    for clip in timeline.find_clips():
        if clip.effects:
            errors.append("Effect proibido em clip: " + clip.name)

    # Regra 2: MediaReference nao pode ser Missing
    for clip in timeline.find_clips():
        if isinstance(clip.media_reference, otio.schema.MissingReference):
            errors.append("MissingReference em clip: " + clip.name)

    # Regra 3: Frame rate consistente
    rates = set()
    for clip in timeline.find_clips():
        if clip.source_range:
            rates.add(clip.source_range.start_time.rate)
    if len(rates) > 1:
        errors.append("Frame rates inconsistentes: " + str(rates))

    # Regra 4: Verificar metadata kdenlive em markers (round-trip)
    for marker in timeline.tracks.markers:
        if "kdenlive" not in marker.metadata:
            warnings.append("Marker '" + marker.name + "' sem metadata 'kdenlive' — round-trip pode perder tipo")

    for clip in timeline.find_clips():
        for marker in clip.markers:
            if "kdenlive" not in marker.metadata:
                warnings.append("Clip marker '" + marker.name + "' em '" + clip.name + "' sem metadata 'kdenlive'")

    # Regra 5: Verificar clip markers compartilhados (alerta)
    clip_names = {}
    for clip in timeline.find_clips():
        if clip.name in clip_names:
            if clip.markers != clip_names[clip.name].markers:
                warnings.append("Clip '" + clip.name + "' tem instancias com markers diferentes — Kdenlive ira compartilhar")
        else:
            clip_names[clip.name] = clip

    return errors, warnings

def export_for_kdenlive(otio_path, output_otio_path):
    # Para Kdenlive, nao ha conversao — apenas validacao e copia.
    timeline = otio.adapters.read_from_file(otio_path)
    errors, warnings = validate_capiau_otio_kdenlive(otio_path)
    if errors:
        raise ValueError("Erros de validacao: " + str(errors))
    otio.adapters.write_to_file(timeline, output_otio_path)
    return output_otio_path, warnings
```

---

## 6. CHECKLIST DE COMPATIBILIDADE PARA KDENLIVE

Antes de enviar qualquer .otio para Kdenlive, verificar:

- [ ] Nenhum objeto `Effect` presente
- [ ] Nenhum `MissingReference` (toda midia deve ser `ExternalReference`)
- [ ] Frame rate consistente em todo o documento
- [ ] `source_range` dentro de `available_range` para todos os clips
- [ ] Markers usando cores da lista permitida
- [ ] `target_url` resolvivel pelo Kdenlive (absoluto ou relativo ao projeto)
- [ ] Nesting apenas com `Stack` aninhado
- [ ] Nenhum `LinearTimeWarp` ou `FreezeFrame`
- [ ] Metadados `kdenlive` presentes em markers para round-trip (opcional mas recomendado)
- [ ] Clip markers verificados: mesmo clip em multiplas posicoes tem markers compativeis (Kdenlive compartilha)
- [ ] Timeline markers no `Stack` para guides globais
- [ ] Nomeacao consistente: `CENA_SHOT_TAKE_VERSAO`
- [ ] Gaps calculados para ritmo
- [ ] Audio tracks separados: A1=som direto, A2=musica, A3=efx
- [ ] Testado em Kdenlive 25.04.1+ (ou versao mais recente disponivel)

---

## 7. ROADMAP E FUTURO (KDENLIVE + OTIO)

| Milestone | Status | Impacto no CapIAu-Talho |
|-----------|--------|-------------------------|
| OTIO nativo import/export | ✔ Implementado (25.04) | Pipeline direto, sem conversores |
| Correcao de ordenacao de tracks | ✔ Corrigido (25.04.1+) | Nao precisa mais de script Python de inversao |
| Image Sequence clips | Em roadmap | Futuro: suporte a sequencias de imagens |
| Multi-timeline projects | Em roadmap | Futuro: projetos com multiplas timelines |
| OTIO Archive (.otioz) | Em roadmap | Futuro: entrega portatil com midia embutida |
| Round-trip metadata completo | ✔ Parcial | Usar namespace `kdenlive` para markers |
| Effects via OTIO | ✖ Nao planejado | Continuar usando metadata para intencao |

---

## 8. COMPARACAO FINAL: KDENLIVE VS PREMIERE PRO PARA O CAPAU-TALHO

| Criterio | Kdenlive | Adobe Premiere Pro |
|----------|----------|-------------------|
| **Intercambio OTIO** | Nativo (direto) | Indireto (FCP7 XML adapter) |
| **Complexidade de Pipeline** | Baixa (um arquivo) | Alta (conversao + XML) |
| **Transitions** | Basic data suportado | Perdidas completamente |
| **Clip Markers** | Compartilhados entre instancias | Unicos por instancia |
| **Effects** | Nao transferem | Nao transferem |
| **Speed Changes** | Nao documentado | Nao suportado via FCP7 XML |
| **Multi-cam** | Nao testado | Nao suportado via FCP7 XML |
| **Round-trip** | Suportado (metadata) | Unidirecional |
| **Custo** | Gratuito/Open Source | Assinatura Creative Cloud |
| **Plataforma** | Linux/Windows/macOS | Windows/macOS |
| **Recomendacao CapIAu** | **Excelente para prototipagem e workflows open source** | **Necessario para producoes que exigem Premiere** |

---

## 9. RECURSOS OFICIAIS E COMUNIDADE

| Recurso | URL | Tipo |
|---------|-----|------|
| Documentacao Kdenlive (OTIO Import/Export) | https://docs.kdenlive.org/en/project_and_asset_management/file_management/project_files.html | Oficial |
| Kdenlive File Menu (OTIO) | https://docs.kdenlive.org/zh_TW/user_interface/menu/file_menu.html | Oficial |
| Grizzly Peak 3D — Anuncio OTIO | https://grizzlypeak3d.com/2025/05/04/grizzly-peak-3d-adds-native-opentimelineio-support-to-kdenlives-25-04-0-release/ | Comunidade/Parceiro |
| KDE Discuss — OTIO Track Order Bug | https://discuss.kde.org/t/video-tracks-order-when-importing-exporting-as-opentimelineio-in-kdenlive-25/34745 | Forum |
| GitHub — Adapter Deprecated | https://github.com/KDE/kdenlive-opentimelineio | GitHub (DEPRECATED) |
| OpenTimelineIO Adapters Docs | https://opentimelineio.readthedocs.io/en/latest/tutorials/adapters.html | Oficial OTIO |
| Kdenlive State 2026 | https://kdenlive.org/news/2026/state-2026/ | Blog oficial |
| Ubuntu Handbook — Release 25.04 | https://ubuntuhandbook.org/index.php/2025/04/kdenlive-25-04-0-released/ | Noticia |
| YouTube Tutorial — OTIO Resolve↔Kdenlive | https://www.youtube.com/watch?v=n-AipDa4JhU | Tutorial |

---

*Documento gerado para CapIAu-Talho — Pipeline OTIO ↔ Kdenlive*
*Versao 1.0 | Baseado em Kdenlive 25.04+ | OpenTimelineIO nativo*
