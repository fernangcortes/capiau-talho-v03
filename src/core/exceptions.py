"""Exceções customizadas e centralizadas para o ecossistema CapIAu-Talho."""

class CapIAuError(Exception):
    """Classe base para todas as exceções do CapIAu-Talho."""
    def __init__(self, message: str = "Ocorreu um erro interno no CapIAu-Talho.") -> None:
        self.message = message
        super().__init__(self.message)


class IngestError(CapIAuError):
    """Exceção levantada durante falhas no pipeline de ingestão de arquivos."""
    pass


class PipelineError(CapIAuError):
    """Exceção levantada por falhas em processamento externo ou em segundo plano (ASR, Visão)."""
    pass


class SearchError(CapIAuError):
    """Exceção para falhas ocorridas em buscas SQLite ou no Qdrant."""
    pass
