"""Configuração centralizada de logs para o CapIAu-Talho."""
import logging
import sys


def make_console_crash_proof() -> None:
    """Impede que um caractere impossível de codificar no console derrube a aplicação.

    O console do Windows aqui usa cp1252, que não codifica '→', '≤', emojis etc.
    Sem isto, um simples print de log levanta UnicodeEncodeError — e se esse print
    estiver dentro de um try/except (como estava o da segmentação), o erro é
    engolido e a função inteira cai no caminho de fallback. Log nunca pode mudar
    o comportamento do pipeline.

    Mantém o encoding do console (acentos continuam corretos em cp1252, sem
    mojibake) e só troca o que não couber por '?'.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass  # stream capturado/substituído (testes, pipes): nada a fazer


def setup_logging(level: int = logging.INFO) -> None:
    """Configura o formato e destino dos logs padrão no console."""
    make_console_crash_proof()
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        datefmt="%H:%M:%S"
    )
    
    # Stream handler escrevendo direto no stdout
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    
    # Obter logger principal da aplicação
    root_logger = logging.getLogger("capiau")
    root_logger.setLevel(level)
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.propagate = False

def get_logger(module_name: str) -> logging.Logger:
    """Retorna um logger configurado para o módulo específico."""
    return logging.getLogger(f"capiau.{module_name}")
