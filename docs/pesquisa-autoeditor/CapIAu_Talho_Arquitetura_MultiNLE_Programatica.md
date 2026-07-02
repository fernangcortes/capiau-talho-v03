# CapIAu-Talho: Arquitetura Multi-NLE para Geracao Programatica de Timelines
## Analise Completa: Kdenlive MLT XML, DaVinci Resolve API, Blender VSE, Shotcut e Outros

---

## RESUMO EXECUTIVO

Para o CapIAu-Talho gerar edicoes automaticas via prompt com acesso a **todas as funcoes** (effects, transitions, speed changes, keyframes, compositing), a estrategia varia por NLE:

| NLE | Formato/Codigo | Acesso Completo? | Recomendacao |
|-----|---------------|------------------|--------------|
| **Kdenlive** | MLT XML direto (.kdenlive) | **SIM** — effects, transitions, filters, keyframes, compositing, time remapping | **MELHOR OPCAO OPEN SOURCE** |
| **Blender VSE** | Python API (bpy) | **SIM** — strips, effects, transitions, fades, speed, transform, text, multicam | **MELHOR OPCAO PROGRAMATICA** |
| **DaVinci Resolve** | Python API (Studio) | **PARCIAL** — clips, markers, tracks, compound, Fusion, render. **NAO**: transitions, speed, trim, color nodes | Use para conform/render, nao edicao fina |
| **Shotcut** | MLT XML direto | **SIM** (teoricamente) — mas menos documentado que Kdenlive | Alternativa open source |
| **Premiere Pro** | FCP7 XML / UXP | **LIMITADO** — clips, markers, nesting. **NAO**: transitions, effects, speed | Apenas para workflows Adobe obrigatorios |
| **Olive Editor** | N/A | **NAO** — v0.2 em rewrite, sem API documentada | Evitar por enquanto |
| **Remotion** | React/TypeScript | **SIM** — timeline puramente via codigo, mas nao e NLE tradicional | Para templates/marketing automatizado |

---

## 1. KDENLIVE — ESCRITA DIRETA DE MLT XML (.kdenlive)

### 1.1 Por que OTIO nao e suficiente?
OTIO no Kdenlive e nativo, mas **nao suporta**: effects, complex transitions, speed changes, image sequences, multi-timeline projects. Se o CapIAu-Talho precisa gerar edicoes com dissolves, color grading, keyframes ou time remapping, OTIO e insuficiente.

### 1.2 A Solucao: MLT XML Nativo
O arquivo `.kdenlive` e um arquivo XML baseado no formato **MLT** (Media Lovin' Toolkit), com anotacoes especificas do Kdenlive. Ele descreve:
- Profile de renderizacao (resolucao, frame rate)
- Producers (referencias de midia)
- Playlists (tracks da timeline)
- Tractors (composicao de tracks + transitions)
- Filters (effects em clips e tracks)
- Transitions (composicoes entre tracks)
- Markers e metadata

### 1.3 Documentacao Oficial

| Recurso | URL | Tipo |
|---------|-----|------|
| **Kdenlive File Format (GitHub)** | https://github.com/KDE/kdenlive/blob/master/dev-docs/fileformat.md | **S** — Documentacao oficial completa |
| **Inside Kdenlive Projects (Blog)** | https://thediveo-e.blogspot.com/2016/07/inside-kdenlive-projects.html | **B** — Analise profunda da estrutura XML |
| **MLT Framework Docs** | https://www.mltframework.org/docs/ | Oficial MLT |
| **Kdenlive Effects XML** | `/usr/share/kdenlive/effects/` (local) | Definicoes de effects e parametros |
| **MLT XML DTD** | MLT source | Estrutura base do XML |

### 1.4 Estrutura do Arquivo .kdenlive (Generation 4+)

```xml
<?xml version='1.0' encoding='utf-8'?>
<mlt xmlns:kdenlive="http://www.kdenlive.org/project" producer="main_bin">
  <!-- Profile do projeto -->
  <profile frame_rate_num="24" frame_rate_den="1" width="1920" height="1080"/>

  <!-- Producers = referencias de midia -->
  <producer id="producer0" resource="/media/entrevista_rose.mov">
    <property name="kdenlive:id">1</property>
  </producer>

  <!-- Playlists = tracks da timeline -->
  <playlist id="playlist0">
    <property name="shotcut:name">V1_ENTREVISTAS</property>
    <entry producer="producer0" in="00:00:05.000" out="00:00:10.000">
      <property name="kdenlive:id">3</property>
      <!-- FILTROS (effects) aplicados ao clip -->
      <filter id="filter0">
        <property name="mlt_service">brightness</property>
        <property name="level">0.5</property>
        <property name="kdenlive:effect">brightness</property>
      </filter>
    </entry>
    <blank length="00:00:00.250"/> <!-- Gap -->
  </playlist>

  <!-- Tractor = composicao de tracks + transitions -->
  <tractor id="tractor0">
    <property name="kdenlive:uuid">...</property>
    <track hide="audio" producer="playlist0"/>
    <track hide="audio" producer="playlist1"/>
    <!-- Transitions entre tracks -->
    <transition id="transition0">
      <property name="mlt_service">composite</property>
      <property name="a_track">0</property>
      <property name="b_track">1</property>
    </transition>
  </tractor>

  <!-- Main Bin = playlist com todos os clips e sequences -->
  <playlist id="main_bin">
    <property name="kdenlive:documentproperty.version">1.1</property>
    <entry producer="producer0"/>
    <entry producer="tractor0"/>
  </playlist>
</mlt>
```

### 1.5 Features Acessiveis via MLT XML (TODAS)

| Feature | Elemento XML | Status |
|---------|-------------|--------|
| Multiplas tracks V/A | `<playlist>` + `<tractor><track>` | ✔ |
| Clips com In/Out | `<entry producer="..." in="..." out="...">` | ✔ |
| Gaps | `<blank length="...">` | ✔ |
| **Video Effects** | `<filter>` dentro de `<entry>` ou `<playlist>` | ✔ |
| **Audio Effects** | `<filter>` com `mlt_service` audio | ✔ |
| **Transitions** | `<transition>` dentro de `<tractor>` | ✔ |
| **Keyframes** | Propriedades animadas via `keyframes` no MLT | ✔ |
| **Compositing** | `composite`, `affine`, `qtblend` services | ✔ |
| **Time Remapping** | `timeremap` service ou `speed` property | ✔ |
| **Color Correction** | `lift_gamma_gain`, `colorbalance`, `brightness` | ✔ |
| **Text/Titles** | `qtext`, `kdenlive:title` producers | ✔ |
| **Nesting** | Tractors aninhados | ✔ |
| **Markers** | `kdenlive:markers` properties | ✔ |
| **Proxy clips** | `kdenlive:proxy` properties | ✔ |

### 1.6 Gotchas e Limitacoes

1. **Namespace XML nao declarado**: Kdenlive usa atributos `kdenlive:*` sem declarar o namespace no inicio do XML. Para processar com ferramentas XML padrao, voce deve adicionar manualmente:
   ```xml
   <mlt xmlns:kdenlive="http://www.kdenlive.org/project" ...>
   ```

2. **Geracoes de formato**: Gen 2 (15.04+), Gen 3 (19.04+), Gen 4 (20.08+). Cada geracao muda a estrutura. Gerar para Gen 4 (document version 1.1) e o mais estavel.

3. **Filters vs Kdenlive UI**: Nem todo filter MLT aparece automaticamente na UI do Kdenlive. Para aparecer, precisa de metadata QML adicional em `/usr/share/kdenlive/effects/`.

4. **MLT services**: Os effects disponiveis dependem dos plugins MLT instalados (frei0r, ladspa, avfilter, etc.).

### 1.7 Pipeline Recomendado para CapIAu-Talho

```
CapIAu-Talho (IA)
  |
  v
Gerador MLT XML (.kdenlive)
  |-- Estrutura: <mlt> -> <producer>s -> <playlist>s -> <tractor>s
  |-- Effects: <filter> com mlt_service e parametros
  |-- Transitions: <transition> com composite/affine/luma
  |-- Keyframes: propriedades animadas
  |
  v
Kdenlive (abre nativamente)
  |-- Todos os effects, transitions, keyframes preservados
  |-- Edicao manual possivel
  |-- Render via MLT (melt) ou GUI
```

---

## 2. DAVINCI RESOLVE — PYTHON API (STUDIO ONLY)

### 2.1 Visao Geral
DaVinci Resolve possui uma **API Python completa e hierarquica** que permite criar projetos, timelines, importar midia, posicionar clips, adicionar markers, criar compound clips, configurar renders e acessar Fusion. No entanto, **a API nao permite operacoes de edicao fina**: nao ha cortar, split, razor, trim, mover clips, adicionar transitions, fades, speed changes ou retiming via script.

### 2.2 Hierarquia da API

```
Resolve
├── GetMediaStorage()        -> MediaStorage
├── GetProjectManager()      -> ProjectManager
│   ├── CreateProject()      -> Project
│   ├── LoadProject()        -> Project
│   └── GetCurrentProject()  -> Project
│       ├── GetMediaPool()   -> MediaPool
│       │   ├── ImportMedia()         -> [MediaPoolItem]
│       │   ├── CreateEmptyTimeline() -> Timeline
│       │   ├── CreateTimelineFromClips() -> Timeline
│       │   ├── AppendToTimeline()    -> [TimelineItem]
│       │   └── ImportTimelineFromFile() -> Timeline (AAF/XML/EDL/FCPXML/OTIO/DRT)
│       ├── GetCurrentTimeline()      -> Timeline
│       │   ├── GetItemListInTrack()  -> [TimelineItem]
│       │   ├── AddTrack()            -> Bool
│       │   ├── AddMarker()           -> Bool
│       │   ├── CreateCompoundClip()  -> TimelineItem
│       │   ├── Export()              -> Bool (EDL/XML/AAF/OTIO/etc)
│       │   └── DeleteClips()         -> Bool
│       ├── GetGallery()              -> Gallery
│       ├── AddRenderJob()            -> str
│       └── SetRenderSettings()       -> Bool
└── OpenPage("edit"|"color"|"fairlight"|"deliver")
```

### 2.3 Documentacao Oficial

| Recurso | URL | Tipo |
|---------|-----|------|
| **DaVinci Resolve Python API Reference (Gist)** | https://gist.github.com/mhadifilms/2b84d469135315793220dbf2226cbe63 | **S** — API completa com exemplos |
| **Wild Lion Media — Scripting Guide** | https://wildlion.media/davinci-resolve-python-scripting-the-complete-guide-to-the-api/ | Guia pratico de producao |
| **ExtremRaym — API Docs** | https://extremraym.com/cloud/resolve-scripting-doc/ | Referencia rapida de metodos |
| **Blackmagic Forum — OTIO** | https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=150057 | Discussao comunidade |
| **Resolve Manual — OTIO Import** | https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part1411.htm | Oficial (mirror) |

### 2.4 O que a API FAZ (e NAO faz)

| Operacao | Suporte | Notas |
|----------|---------|-------|
| Criar projeto | ✔ | Full control |
| Importar midia | ✔ | MediaPool.ImportMedia() |
| Criar timeline vazia | ✔ | CreateEmptyTimeline() |
| Criar timeline de clips | ✔ | CreateTimelineFromClips() |
| Adicionar clips a timeline | ✔ | AppendToTimeline() com frame_start, endFrame, trackIndex, recordFrame |
| Adicionar tracks | ✔ | AddTrack("video"|"audio"|"subtitle") |
| Renomear tracks | ✔ | SetTrackName() |
| Adicionar markers | ✔ | AddMarker(frame, color, name, note, duration, customData) |
| Criar compound clips | ✔ | CreateCompoundClip() |
| Criar Fusion clips | ✔ | CreateFusionClip() |
| Exportar timeline | ✔ | Export() para EDL/XML/AAF/OTIO/FCPXML |
| Importar timeline | ✔ | ImportTimelineFromFile() |
| Configurar render | ✔ | SetRenderSettings() + AddRenderJob() |
| **Cortar/Split/Razor** | **✖** | NAO EXISTE na API |
| **Trim In/Out** | **✖** | NAO EXISTE na API |
| **Mover clips** | **✖** | NAO EXISTE na API |
| **Transitions** | **✖** | NAO EXISTE na API |
| **Speed changes** | **✖** | NAO EXISTE na API |
| **Color grading nodes** | **✖** | Apenas CDL e LUT via API |
| **Fairlight EQ/mixer** | **✖** | NAO EXISTE na API |
| **OFX plugins** | **✖** | Invisivel a API |

### 2.5 OTIO no Resolve
Resolve suporta import/export nativo de `.otio` e `.otioz` (bundled com midia). E a melhor ponte para interoperabilidade, mas com as mesmas limitacoes de OTIO (sem effects, transitions limitadas).

### 2.6 Pipeline Recomendado para CapIAu-Talho

```
CapIAu-Talho (IA)
  |
  v
Python Script Resolve API
  |-- ImportMedia() -> MediaPool
  |-- CreateEmptyTimeline()
  |-- AppendToTimeline() com posicoes exatas
  |-- AddMarker() para soundbites/notas
  |-- SetRenderSettings() + AddRenderJob()
  |
  v
DaVinci Resolve Studio
  |-- Edicao fina manual (transitions, speed, color) ou
  |-- Export OTIO para outro NLE
```

**Use Resolve API para**: conform automatico, organizacao de media, posicionamento rough-cut, markers, render batch.
**NAO use para**: edicao fina automatizada (transitions, speed, complex color).

---

## 3. BLENDER — VIDEO SEQUENCE EDITOR (VSE) PYTHON API

### 3.1 Por que Blender?
Blender possui a **API Python mais completa e documentada** para criacao programatica de timelines com acesso a **todas** as funcoes: strips, effects, transitions, fades, speed changes, transform, text, multicam, adjustment layers, compositing via nodes, keyframes, e render.

### 3.2 Documentacao Oficial

| Recurso | URL | Tipo |
|---------|-----|------|
| **Blender Python API — Sequencer Operators** | https://docs.blender.org/api/current/bpy.ops.sequencer.html | **S** — Oficial, completa |
| **Blender 2.79 Sequencer API** | https://shuvit.org/python_api/bpy.ops.sequencer.html | Referencia historica |
| **Stack Overflow — VSE Python Effects** | https://stackoverflow.com/questions/53215355/ | Exemplos praticos |
| **Blender Docs — VSE** | https://docs.blender.org/manual/en/latest/video_editing/ | Manual de usuario |

### 3.3 Capacidades da API (TODAS)

| Feature | Metodo/Classe | Exemplo |
|---------|---------------|---------|
| Adicionar movie strip | `bpy.ops.sequencer.movie_strip_add()` | filepath, frame_start, channel |
| Adicionar image strip | `bpy.ops.sequencer.image_strip_add()` | directory, files, frame_start |
| Adicionar sound strip | `bpy.ops.sequencer.sound_strip_add()` | filepath, frame_start |
| Adicionar effect strip | `bpy.ops.sequencer.effect_strip_add()` | type='CROSS'|'WIPE'|'GLOW'|'TRANSFORM'|'SPEED'|'TEXT'|'ADJUSTMENT' |
| Adicionar text strip | `bpy.ops.sequencer.effect_strip_add(type='TEXT')` | Texto overlay |
| Cortar strips | `bpy.ops.sequencer.cut(frame, type='SOFT'|'HARD')` | Split/razor |
| Duplicar | `bpy.ops.sequencer.duplicate()` | Copia strips |
| Fade in/out | `bpy.ops.sequencer.fades_add(duration_seconds, type='IN_OUT'|'IN'|'OUT')` | Volume/opacity fade |
| Remover fades | `bpy.ops.sequencer.fades_clear()` | Limpa animacoes |
| Meta strips (nesting) | `bpy.ops.sequencer.meta_make()` | Group strips |
| Transform | `bpy.ops.sequencer.effect_strip_add(type='TRANSFORM')` | Position, scale, rotation |
| Speed | `bpy.ops.sequencer.effect_strip_add(type='SPEED')` | Time remapping |
| Multicam | `bpy.ops.sequencer.effect_strip_add(type='MULTICAM')` | Camera switching |
| Adjustment Layer | `bpy.ops.sequencer.effect_strip_add(type='ADJUSTMENT')` | Non-destructive effects |
| Gaussian Blur | `bpy.ops.sequencer.effect_strip_add(type='GAUSSIAN_BLUR')` | Blur effect |
| Color Mix | `bpy.ops.sequencer.effect_strip_add(type='COLORMIX')` | Blend modes |
| Gap insert/remove | `bpy.ops.sequencer.gap_insert()` / `gap_remove()` | Ripple edit |
| Mute/unmute | `bpy.ops.sequencer.mute()` / `unmute()` | Desabilitar strips |
| Rebuild proxy | `bpy.ops.sequencer.rebuild_proxy()` | Gerar proxies |
| Render | `bpy.ops.render.render()` | Output final |

### 3.4 Acesso a Propriedades via bpy.data

```python
import bpy

# Acessar sequence editor
seq = bpy.context.scene.sequence_editor

# Listar todas as strips
for strip in seq.sequences_all:
    print(strip.name, strip.type, strip.frame_start, strip.frame_final_end)

# Modificar propriedades de um effect strip
wipe = seq.sequences_all["Wipe.001"]
wipe.transition_type = 'IRIS'
wipe.direction = 'IN'
wipe.angle = 0.785398

# Modificar transform
transform = seq.sequences_all["Transform.001"]
transform.translate_start_x = 100
transform.scale_start_x = 1.5

# Keyframes em propriedades
strip = seq.sequences_all["Movie.001"]
strip.blend_alpha = 0.5
strip.keyframe_insert(data_path="blend_alpha", frame=1)
strip.blend_alpha = 1.0
strip.keyframe_insert(data_path="blend_alpha", frame=50)
```

### 3.5 Pipeline Recomendado para CapIAu-Talho

```
CapIAu-Talho (IA)
  |
  v
Python Script Blender API
  |-- bpy.ops.sequencer.movie_strip_add() -> clips
  |-- bpy.ops.sequencer.effect_strip_add(type='CROSS') -> transitions
  |-- bpy.ops.sequencer.effect_strip_add(type='TRANSFORM') -> motion/position
  |-- bpy.ops.sequencer.effect_strip_add(type='SPEED') -> time remapping
  |-- bpy.ops.sequencer.fades_add() -> audio/video fades
  |-- bpy.ops.sequencer.cut() -> split edits
  |-- bpy.ops.sequencer.meta_make() -> nesting
  |-- keyframe_insert() -> animacoes
  |
  v
Blender VSE
  |-- Edicao completa via codigo
  |-- Render via bpy.ops.render.render()
  |-- Export para outros formatos se necessario
```

**Blender e a opcao mais poderosa para geracao 100% programatica de timelines complexas.**

---

## 4. SHOTCUT — MLT XML PROGRAMATICO

### 4.1 Status
Shotcut tambem usa MLT XML como formato nativo. Nao ha API oficial Python, mas e possivel gerar arquivos `.mlt` programaticamente que o Shotcut abre nativamente.

### 4.2 Documentacao

| Recurso | URL | Tipo |
|---------|-----|------|
| **MLT XML Annotations (Shotcut)** | https://www.shotcut.org/notes/mltxml-annotations/ | Oficial Shotcut |
| **MLT Framework Docs** | https://www.mltframework.org/docs/ | Oficial MLT |
| **Forum — Generate MLT by script** | https://forum.shotcut.org/t/generate-mlt-project-by-script/35520 | Discussao |
| **Forum — EDL to MLT** | https://forum.shotcut.org/t/edl-to-mlt/18285 | Exemplo de conversao |
| **MCP Skill Shotcut CLI** | https://mcpmarket.com/tools/skills/shotcut-cli-video-editor | Skill para Claude |

### 4.3 Anotacoes Shotcut em MLT XML

Shotcut usa propriedades especificas no XML para identificar elementos editaveis:

| Propriedade | Significado |
|-------------|-------------|
| `<property name="shotcut">1</property>` | Identifica tractor editavel pelo Shotcut |
| `<property name="shotcut:virtual">1</property>` | Forca carregamento como virtual clip |
| `<property name="shotcut:name">Track Name</property>` | Nome da track na UI |
| `<property name="shotcut:audio">1</property>` | Track e audio-only |
| `<property name="shotcut:video">1</property>` | Track e video |
| `<property name="shotcut:filter">...</property>` | Identificador de filter na UI |
| `<property name="shotcut:transition">...</property>` | Identificador de transition |
| `<property name="shotcut:markers">...</property>` | Markers da timeline |
| `<property name="shotcut:comment">...</property>` | Comentarios do clip |

### 4.4 Limitacoes
- Menos documentado que Kdenlive
- Estrutura de tractor/playlist similar mas com convencoes diferentes
- Filters e transitions dependem dos plugins MLT disponiveis
- Nao ha garantia de estabilidade do formato entre versoes

---

## 5. OLIVE EDITOR

### 5.1 Status
Olive esta em rewrite total (v0.2, "The Rewrite"). A v0.1 e instavel. A v0.2 planeja suporte a OTIO, mas ainda nao ha API documentada para geracao programatica de timelines. **Nao recomendado para CapIAu-Talho no momento.**

---

## 6. REMOTION — VIDEO PROGRAMATICO VIA REACT

### 6.1 Conceito
Remotion permite criar videos programaticamente usando componentes React. Nao e um NLE tradicional, mas permite timeline, composicoes, effects, transitions, text, audio — tudo via codigo TypeScript/React.

### 6.2 Documentacao
- https://www.remotion.dev/
- Ideal para: templates de marketing, videos automatizados, SaaS video generation
- Limitacao: Nao e um NLE interativo; edicao manual posterior e dificil

---

## 7. COMPARATIVO FINAL: FORMATOS E APIs PARA CAPAU-TALHO

| Criterio | Kdenlive MLT XML | Blender VSE Python | DaVinci Resolve Python | Premiere FCP7 XML | Shotcut MLT XML | Remotion |
|----------|------------------|-------------------|------------------------|-------------------|-----------------|----------|
| **Formato** | XML | Python API | Python API | XML | XML | React/TS |
| **Criar timeline** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Multi-tracks** | ✔ | ✔ (128 canais) | ✔ | ✔ | ✔ | ✔ |
| **Clips In/Out** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Gaps** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Markers** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Transitions** | ✔ | ✔ | ✖ (API) | ✖ | ✔ | ✔ |
| **Effects/Filters** | ✔ | ✔ | ✖ (API) | ✖ | ✔ | ✔ |
| **Keyframes** | ✔ | ✔ | ✖ (API) | ✖ | ✔ | ✔ |
| **Speed/Time** | ✔ | ✔ | ✖ (API) | ✖ | ✔ | ✔ |
| **Compositing** | ✔ | ✔ (nodes) | ✔ (Fusion) | ✖ | ✔ | ✔ |
| **Text/Titles** | ✔ | ✔ | ✔ (API) | ✖ | ✔ | ✔ |
| **Nesting** | ✔ | ✔ (meta) | ✔ (compound) | ✔ | ✔ | ✔ |
| **Render via codigo** | ✔ (melt) | ✔ | ✔ | ✖ | ✔ (melt) | ✔ |
| **Custo** | Gratis | Gratis | Pago (Studio) | Pago (CC) | Gratis | Gratis |
| **Documentacao** | Boa | Excelente | Boa | Regular | Regular | Boa |
| **Recomendacao** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

---

## 8. ESTRATEGIA ARQUITETURAL RECOMENDADA PARA CAPAU-TALHO

### 8.1 Arquitetura Multi-Backend

```
CapIAu-Talho (IA Core)
  |
  +---> Gerador Kdenlive MLT XML (.kdenlive)
  |       |-- Para: workflows open source, Linux, maxima compatibilidade
  |       |-- Features: effects, transitions, keyframes, speed, compositing
  |       |-- Documentacao: dev-docs/fileformat.md (GitHub KDE)
  |
  +---> Gerador Blender VSE Python (.py)
  |       |-- Para: prototipagem rapida, VFX integration, render 3D
  |       |-- Features: TODAS (effects, transitions, speed, transform, text, multicam)
  |       |-- Documentacao: docs.blender.org/api/current/bpy.ops.sequencer.html
  |
  +---> Gerador DaVinci Resolve Python (.py)
  |       |-- Para: conform, color grading, delivery professional
  |       |-- Features: rough-cut, markers, compound clips, render batch
  |       |-- Limitacao: edicao fina manual obrigatoria
  |       |-- Documentacao: gist mhadifilms + wildlion.media
  |
  +---> Gerador OTIO (.otio) [LEGADO/INTERCAMBIO]
          |-- Para: ponte entre NLEs, arquivamento, interoperabilidade
          |-- Limitacao: sem effects, transitions, speed
          |-- Usar apenas quando interoperabilidade > funcionalidade
```

### 8.2 Prompt Engineering Multi-Backend

O CapIAu-Talho deve receber o prompt do usuario e decidir qual backend usar:

```
INPUT: "Criar documentario com dissolves, color grading leve, 
        textos de entrada, e speed ramping nos soundbites"

DECISAO DA IA:
- Precisa de transitions? -> NAO use OTIO/Premiere XML
- Precisa de effects? -> NAO use OTIO/Premiere XML
- Precisa de speed changes? -> NAO use Resolve API
- Precisa de edicao fina 100% automatica? -> Use Kdenlive MLT XML ou Blender VSE
- Precisa de delivery professional com color? -> Use Resolve API + edicao manual posterior
- Precisa de open source total? -> Use Kdenlive MLT XML

OUTPUT: Gerar .kdenlive OU script Blender .py OU script Resolve .py
```

### 8.3 Documentos para Treinamento dos Agentes

1. **Schema MLT XML Kdenlive** — estrutura completa de .kdenlive (producers, playlists, tractors, filters, transitions)
2. **Blender VSE API Cheat Sheet** — todos os bpy.ops.sequencer.* relevantes
3. **Resolve API Cheat Sheet** — metodos permitidos e proibidos
4. **Matriz de Decisao de Backend** — qual gerador usar baseado nas features requisitadas
5. **Templates de Projeto** — .kdenlive base, .blend base, .py Resolve base

---

## 9. RECURSOS OFICIAIS E DOCUMENTACAO DETALHADA

### Kdenlive / MLT XML
- Kdenlive File Format: https://github.com/KDE/kdenlive/blob/master/dev-docs/fileformat.md
- Inside Kdenlive Projects: https://thediveo-e.blogspot.com/2016/07/inside-kdenlive-projects.html
- MLT Framework: https://www.mltframework.org/docs/
- Kdenlive Effects: `/usr/share/kdenlive/effects/` (instalacao local)

### Blender VSE Python
- Blender Python API Sequencer: https://docs.blender.org/api/current/bpy.ops.sequencer.html
- Blender Manual VSE: https://docs.blender.org/manual/en/latest/video_editing/

### DaVinci Resolve Python
- API Reference (Gist): https://gist.github.com/mhadifilms/2b84d469135315793220dbf2226cbe63
- Wild Lion Guide: https://wildlion.media/davinci-resolve-python-scripting-the-complete-guide-to-the-api/
- ExtremRaym Docs: https://extremraym.com/cloud/resolve-scripting-doc/

### Shotcut / MLT
- MLT XML Annotations: https://www.shotcut.org/notes/mltxml-annotations/
- MLT Docs: https://www.mltframework.org/docs/

### Remotion
- https://www.remotion.dev/

---

*Documento gerado para CapIAu-Talho — Arquitetura Multi-NLE para Geracao Programatica*
*Versao 1.0 | Junho 2026*
