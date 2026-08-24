"""Motor de renderizacao de video da timeline (PLANO_EXPORTACAO_VIDEO.md).

Traduz o `sequence_json` de uma timeline no MESMO resultado que o monitor de
Programa mostra na tela, so que em arquivo. O alvo nao e "um MP4qualquer": e
paridade com o preview, efeito por efeito.

Mapa dos modulos (cada um tem dono e contrato proprio):

  modelo.py    - normaliza o sequence_json para o modelo do render (CONTRATO)
  fade.py      - curvas de fade -> expressoes ffmpeg (CONTRATO)
  cor.py       - filtros CSS de cor -> matrizes/LUTs ffmpeg
  geometria.py - fit/transform/crop/ken_burns -> scale/crop/rotate/overlay
  grafo_video.py - monta a camada de video (uma cadeia por clipe + composicao)
  grafo_audio.py - monta a camada de audio (cadeia por clipe + mixagem)
  midia.py     - resolve original/proxy e as guardas de midia ausente
  comando.py   - presets, encoder e a linha de comando completa do ffmpeg
  execucao.py  - fila, subprocesso, -progress, TASK_MANAGER e cancelamento
  fidelidade.py - relatorio pre-export do que o motor ainda nao sabe fazer

Regra que atravessa tudo: efeito com "disabled": true e BYPASS (sai da cadeia),
nunca mudo/preto. E o que o player faz, e o render tem de fazer igual.
"""
