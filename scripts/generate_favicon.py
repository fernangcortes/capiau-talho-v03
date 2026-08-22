"""
Script gerador de favicons e ícones de alta fidelidade para o CapIAu-Talho.
Gera SVG vetorial moderno e renders PNG/ICO otimizados para todos os navegadores.
"""
import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SVG_CONTENT = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <!-- Gradiente do Fundo Squircle -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18142a" />
      <stop offset="50%" stop-color="#0f0d1a" />
      <stop offset="100%" stop-color="#08070d" />
    </linearGradient>

    <!-- Borda sutil de vidro / Neon Glow -->
    <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.8" />
      <stop offset="50%" stop-color="#3b82f6" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.8" />
    </linearGradient>

    <!-- Gradientes de Destaque Neon -->
    <linearGradient id="violetCyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#c084fc" />
      <stop offset="50%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>

    <linearGradient id="cyanNeon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#67e8f9" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>

    <linearGradient id="violetNeon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e879f9" />
      <stop offset="100%" stop-color="#a855f7" />
    </linearGradient>

    <linearGradient id="stripeLight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#cbd5e1" />
    </linearGradient>

    <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#161324" />
      <stop offset="100%" stop-color="#0d0b16" />
    </linearGradient>

    <!-- Radial Glow de Fundo -->
    <radialGradient id="ambientGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.25" />
      <stop offset="60%" stop-color="#06b6d4" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>

    <!-- Filtro de Sombra Suave -->
    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.6" />
    </filter>

    <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <!-- Base Squircle -->
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bgGrad)" stroke="url(#rimGrad)" stroke-width="6" />

  <!-- Ambient Central Glow -->
  <circle cx="256" cy="256" r="210" fill="url(#ambientGlow)" />

  <!-- Grupo Principal do Ícone Claquete & Talho -->
  <g filter="url(#dropShadow)">
    <!-- Corpo da Claquete (Base Inferior) -->
    <rect x="88" y="220" width="336" height="196" rx="20" fill="url(#bodyGrad)" stroke="rgba(255,255,255,0.12)" stroke-width="3" />

    <!-- Linhas decorativas do NLE / Grid no corpo da claquete -->
    <line x1="88" y1="275" x2="424" y2="275" stroke="rgba(255,255,255,0.06)" stroke-width="2" />
    <line x1="230" y1="275" x2="230" y2="416" stroke="rgba(255,255,255,0.06)" stroke-width="2" />

    <!-- Barra Inferior Fixa da Claquete com Listras -->
    <g id="bottomBar">
      <path d="M 90 178 L 422 178 Q 424 178 424 180 L 424 212 Q 424 216 420 216 L 92 216 Q 88 216 88 212 L 88 180 Q 88 178 90 178 Z" fill="#141122" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
      
      <!-- Listras diagonais na barra fixa -->
      <g clip-path="url(#bottomBarClip)">
        <clipPath id="bottomBarClip">
          <rect x="88" y="178" width="336" height="38" rx="4" />
        </clipPath>
        <polygon points="120,220 150,220 120,174 90,174" fill="url(#violetNeon)" />
        <polygon points="190,220 220,220 190,174 160,174" fill="url(#stripeLight)" />
        <polygon points="260,220 290,220 260,174 230,174" fill="url(#cyanNeon)" />
        <polygon points="330,220 360,220 330,174 300,174" fill="url(#violetNeon)" />
        <polygon points="400,220 430,220 400,174 370,174" fill="url(#stripeLight)" />
      </g>
    </g>

    <!-- Braço Superior Articulado (Clap Stick Aberto em Ângulo) -->
    <g transform="rotate(-15 106 172)">
      <path d="M 90 134 L 422 134 Q 426 134 426 138 L 426 170 Q 426 174 422 174 L 90 174 Q 86 174 86 170 L 86 138 Q 86 134 90 134 Z" fill="#18142a" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
      
      <g clip-path="url(#topBarClip)">
        <clipPath id="topBarClip">
          <rect x="86" y="134" width="340" height="40" rx="4" />
        </clipPath>
        <polygon points="115,178 145,178 115,130 85,130" fill="url(#violetNeon)" />
        <polygon points="185,178 215,178 185,130 155,130" fill="url(#stripeLight)" />
        <polygon points="255,178 285,178 255,130 225,130" fill="url(#cyanNeon)" />
        <polygon points="325,178 355,178 325,130 295,130" fill="url(#violetNeon)" />
        <polygon points="395,178 425,178 395,130 365,130" fill="url(#stripeLight)" />
      </g>
    </g>

    <!-- Pino de Articulação / Dobradiça Metálica -->
    <circle cx="106" cy="176" r="11" fill="#2d2844" stroke="#c084fc" stroke-width="3" />
    <circle cx="106" cy="176" r="4" fill="#67e8f9" />

    <!-- Símbolo Central: "Talho" (Corte de Precisão Neon + Play Glyph) -->
    <g transform="translate(256, 346)">
      <!-- Brilho Neon de Fundo do Glifo -->
      <polygon points="-38,-48 48,0 -38,48" fill="url(#violetCyan)" opacity="0.3" filter="url(#neonGlow)" transform="scale(1.2)" />
      
      <!-- Metade Superior Esquerda do Play com Corte ("Talho") -->
      <path d="M -36 -46 L 38 0 L -8 0 L -36 -28 Z" fill="url(#violetNeon)" />
      
      <!-- Metade Inferior Direita do Play após o Corte ("Talho") -->
      <path d="M -8 10 L 46 10 L -36 50 L -36 20 Z" fill="url(#cyanNeon)" />

      <!-- Linha do Corte ("Talho") Laser Brilhante -->
      <line x1="-48" y1="-32" x2="52" y2="28" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" filter="url(#neonGlow)" />
      <circle cx="2" cy="-2" r="3.5" fill="#ffffff" />
    </g>

    <!-- Indicador de Status AI / Gravação (Ponto Esmeralda e Ciano) -->
    <circle cx="120" cy="248" r="5" fill="#10b981" filter="url(#neonGlow)" />
    <rect x="134" y="244" width="48" height="8" rx="4" fill="rgba(255,255,255,0.2)" />
    
    <rect x="340" y="244" width="60" height="8" rx="4" fill="rgba(6,182,212,0.3)" />
  </g>
</svg>
"""


def render_crisp_icon(size: int) -> Image.Image:
    """
    Renderiza um ícone rasterizado em alta definição com supersampling 4x.
    Garante máxima nitidez em resoluções como 16x16, 32x32, 48x48, 180x180, 512x512.
    """
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Cores
    bg_start = (24, 20, 42, 255)
    bg_end = (8, 7, 13, 255)
    violet_neon = (168, 85, 247, 255)
    violet_bright = (192, 132, 252, 255)
    cyan_neon = (6, 182, 212, 255)
    cyan_bright = (103, 232, 249, 255)
    white = (255, 255, 255, 255)
    body_col = (19, 17, 31, 255)
    dark_bar = (22, 19, 36, 255)

    pad = int(16 * (canvas_size / 512))
    corner_r = int(108 * (canvas_size / 512))

    # 1. Fundo com Gradiente Diagonal no Squircle
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [pad, pad, canvas_size - pad, canvas_size - pad],
        radius=corner_r,
        fill=255
    )

    # Cria gradiente para o fundo
    bg_layer = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg_layer)
    for y in range(canvas_size):
        ratio = y / canvas_size
        r = int(bg_start[0] * (1 - ratio) + bg_end[0] * ratio)
        g = int(bg_start[1] * (1 - ratio) + bg_end[1] * ratio)
        b = int(bg_start[2] * (1 - ratio) + bg_end[2] * ratio)
        bg_draw.line([(0, y), (canvas_size, y)], fill=(r, g, b, 255))
    
    # Aplica máscara do squircle
    img.paste(bg_layer, (0, 0), mask)

    # 2. Borda Neon Violet/Cyan no Squircle
    stroke_w = max(1, int(6 * (canvas_size / 512)))
    draw.rounded_rectangle(
        [pad, pad, canvas_size - pad, canvas_size - pad],
        radius=corner_r,
        outline=(168, 85, 247, 200),
        width=stroke_w
    )

    # 3. Ambient Central Glow
    glow_radius = int(160 * (canvas_size / 512))
    center = (canvas_size // 2, canvas_size // 2)
    glow_layer = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    glow_draw.ellipse(
        [center[0] - glow_radius, center[1] - glow_radius, center[0] + glow_radius, center[1] + glow_radius],
        fill=(139, 92, 246, 50)
    )
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(max(1, int(20 * (canvas_size / 512)))))
    img = Image.alpha_composite(img, glow_layer)
    draw = ImageDraw.Draw(img)

    # Escala de coordenadas relativas a 512
    def sx(x): return int(x * (canvas_size / 512))
    def sy(y): return int(y * (canvas_size / 512))

    # 4. Corpo da Claquete
    body_box = [sx(88), sy(220), sx(424), sy(416)]
    draw.rounded_rectangle(body_box, radius=sx(20), fill=body_col, outline=(255, 255, 255, 35), width=max(1, sx(3)))

    # Linha divisória sutil NLE
    draw.line([(sx(88), sy(275)), (sx(424), sy(275))], fill=(255, 255, 255, 18), width=max(1, sx(2)))
    draw.line([(sx(230), sy(275)), (sx(230), sy(416))], fill=(255, 255, 255, 18), width=max(1, sx(2)))

    # 5. Barra Inferior Fixa da Claquete
    fixed_bar_box = [sx(88), sy(178), sx(424), sy(216)]
    draw.rounded_rectangle(fixed_bar_box, radius=sx(4), fill=dark_bar, outline=(255, 255, 255, 40), width=max(1, sx(2)))

    # Listras da barra fixa
    stripes = [
        ([(sx(120), sy(216)), (sx(150), sy(216)), (sx(120), sy(178)), (sx(90), sy(178))], violet_neon),
        ([(sx(190), sy(216)), (sx(220), sy(216)), (sx(190), sy(178)), (sx(160), sy(178))], white),
        ([(sx(260), sy(216)), (sx(290), sy(216)), (sx(260), sy(178)), (sx(230), sy(178))], cyan_neon),
        ([(sx(330), sy(216)), (sx(360), sy(216)), (sx(330), sy(178)), (sx(300), sy(178))], violet_neon),
        ([(sx(400), sy(216)), (sx(424), sy(216)), (sx(400), sy(178)), (sx(370), sy(178))], white),
    ]
    for pts, col in stripes:
        draw.polygon(pts, fill=col)

    # 6. Braço Superior da Claquete (Rotacionado ~ -14 graus)
    top_bar_img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    top_draw = ImageDraw.Draw(top_bar_img)
    top_box = [sx(86), sy(134), sx(426), sy(174)]
    top_draw.rounded_rectangle(top_box, radius=sx(4), fill=(24, 20, 42, 255), outline=(255, 255, 255, 60), width=max(1, sx(2)))

    top_stripes = [
        ([(sx(115), sy(174)), (sx(145), sy(174)), (sx(115), sy(134)), (sx(85), sy(134))], violet_bright),
        ([(sx(185), sy(174)), (sx(215), sy(174)), (sx(185), sy(134)), (sx(155), sy(134))], white),
        ([(sx(255), sy(174)), (sx(285), sy(174)), (sx(255), sy(134)), (sx(225), sy(134))], cyan_bright),
        ([(sx(325), sy(174)), (sx(355), sy(174)), (sx(325), sy(134)), (sx(295), sy(134))], violet_bright),
        ([(sx(395), sy(174)), (sx(425), sy(174)), (sx(395), sy(134)), (sx(365), sy(134))], white),
    ]
    for pts, col in top_stripes:
        top_draw.polygon(pts, fill=col)

    # Rotaciona em torno do pivô (sx(106), sy(172))
    pivot_x, pivot_y = sx(106), sy(172)
    rotated_top = top_bar_img.rotate(14, resample=Image.BICUBIC, center=(pivot_x, pivot_y))
    img = Image.alpha_composite(img, rotated_top)
    draw = ImageDraw.Draw(img)

    # Pino de articulação
    draw.ellipse([sx(96), sy(166), sx(116), sy(186)], fill=(45, 40, 68, 255), outline=violet_bright, width=max(1, sx(3)))
    draw.ellipse([sx(102), sy(172), sx(110), sy(180)], fill=cyan_bright)

    # 7. Símbolo Central: Play com Corte / Talho Neon
    c_x, c_y = sx(256), sy(346)
    
    # Metade superior
    poly_top = [
        (c_x - sx(36), c_y - sy(46)),
        (c_x + sx(38), c_y),
        (c_x - sx(8), c_y),
        (c_x - sx(36), c_y - sy(28))
    ]
    draw.polygon(poly_top, fill=violet_neon)

    # Metade inferior
    poly_bot = [
        (c_x - sx(8), c_y + sy(10)),
        (c_x + sx(46), c_y + sy(10)),
        (c_x - sx(36), c_y + sy(50)),
        (c_x - sx(36), c_y + sy(20))
    ]
    draw.polygon(poly_bot, fill=cyan_neon)

    # Linha laser do corte "Talho"
    draw.line(
        [(c_x - sx(48), c_y - sy(32)), (c_x + sx(52), c_y + sy(28))],
        fill=white,
        width=max(2, sx(4))
    )
    draw.ellipse([c_x + sx(2) - sx(3), c_y - sy(2) - sx(3), c_x + sx(2) + sx(3), c_y - sy(2) + sx(3)], fill=white)

    # 8. Detalhes de status
    draw.ellipse([sx(115), sy(243), sx(125), sy(253)], fill=(16, 185, 129, 255))
    draw.rounded_rectangle([sx(134), sx(244), sx(182), sx(252)], radius=sx(4), fill=(255, 255, 255, 50))
    draw.rounded_rectangle([sx(340), sx(244), sx(400), sx(252)], radius=sx(4), fill=(6, 182, 212, 80))

    # Downsampling de alta qualidade com Lanczos
    return img.resize((size, size), Image.LANCZOS)


def generate_all_icons(ui_dir: Path):
    """Gera todo o pacote de favicons e ícones para o diretório src/ui."""
    ui_dir.mkdir(parents=True, exist_ok=True)

    # 1. Favicon SVG Principal
    svg_path = ui_dir / "favicon.svg"
    svg_path.write_text(SVG_CONTENT.strip(), encoding="utf-8")
    print(f"[OK] Gerado SVG: {svg_path}")

    # 2. Resoluções PNG
    sizes = {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "favicon-48x48.png": 48,
        "apple-touch-icon.png": 180,
        "icon-192.png": 192,
        "icon-512.png": 512,
    }

    rendered_images = {}
    for filename, s in sizes.items():
        rendered = render_crisp_icon(s)
        rendered_images[s] = rendered
        out_path = ui_dir / filename
        rendered.save(out_path, format="PNG")
        print(f"[OK] Gerado PNG ({s}x{s}): {out_path}")

    # 3. favicon.ico multi-resolução padrão Windows/Browser (16, 32, 48, 64)
    ico_path = ui_dir / "favicon.ico"
    img_256 = render_crisp_icon(256)
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img_256.save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"[OK] Gerado Favicon Multi-Resolução ICO: {ico_path}")

    # 4. site.webmanifest para Progressive Web Apps / Mobile
    manifest_content = """{
  "name": "CapIAu-Talho — Motor de Inteligência Cinematográfica",
  "short_name": "CapIAu-Talho",
  "icons": [
    {
      "src": "/favicon-32x32.png",
      "sizes": "32x32",
      "type": "image/png"
    },
    {
      "src": "/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png"
    },
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#8b5cf6",
  "background_color": "#0b0f19",
  "display": "standalone"
}
"""
    manifest_path = ui_dir / "site.webmanifest"
    manifest_path.write_text(manifest_content.strip(), encoding="utf-8")
    print(f"[OK] Gerado Webmanifest: {manifest_path}")


if __name__ == "__main__":
    target = Path("src/ui").resolve()
    generate_all_icons(target)
