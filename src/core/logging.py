"""Configuração centralizada de logs para o CapIAu-Talho."""
import logging
import sys

def setup_logging(level: int = logging.INFO) -> None:
    """Configura o formato e destino dos logs padrão no console."""
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
