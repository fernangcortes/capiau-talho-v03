"""Utilitários de processamento de imagem para conversão e compressão de fotos."""
from pathlib import Path

def generate_photo_proxy(original_path: Path, proxy_path: Path, max_size: int = 1024) -> bool:
    """Gera um proxy leve WebP (1024px no maior eixo) a partir de fotos (incluindo formatos RAW)."""
    ext = original_path.suffix.lower()
    raw_extensions = {'.arw', '.cr2', '.nef', '.dng', '.pef', '.raf', '.orf', '.rw2', '.raw'}
    
    try:
        if ext in raw_extensions:
            import rawpy
            from PIL import Image
            print(f"[ImageProc] Processando foto RAW via rawpy: {original_path.name}")
            with rawpy.imread(str(original_path)) as raw:
                # use_camera_wb=True costuma dar o melhor balanço de branco automático
                rgb = raw.postprocess(use_camera_wb=True)
                img = Image.fromarray(rgb)
        else:
            from PIL import Image
            print(f"[ImageProc] Processando foto normal via Pillow: {original_path.name}")
            img = Image.open(str(original_path))
            
        # Redimensiona mantendo a proporção (thumbnail)
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        # Converte para RGB se necessário (ex: PNG com canal alpha)
        if img.mode != 'RGB':
            img = img.convert('RGB')
            
        # Salva como WebP otimizado no diretório destino
        proxy_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(str(proxy_path), 'WEBP', quality=85)
        print(f"  [OK] Proxy de foto gerado em: {proxy_path.name}")
        return True
    except ImportError as ie:
        print(f"[ImageProc] Erro de importação: Para processar RAW, instale rawpy/pillow. Detalhe: {ie}")
        return False
    except Exception as e:
        print(f"[ImageProc] Falha ao processar imagem {original_path.name}: {e}")
        return False
