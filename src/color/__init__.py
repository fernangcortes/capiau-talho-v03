"""Gerenciamento de cor do CapIAu-Talho (docs/PLANO_COR_OCIO.md).

Este pacote é a CAMADA TÉCNICA de cor: ele responde "esses números representam
qual luz?". Ele NÃO tem opinião estética -- quem tem é a camada criativa, que já
existe em src/export/video_render/cor.py (bloco {"type":"color"} do clipe) e no
filtro CSS do player.

Na Fase 0 o pacote só SABE (deteccao.py); não muda pixel nenhum.
"""
