"""Adaptadores de backends de reconhecimento facial para pipeline em cascata."""
from src.vision.backends.local_backend import LocalBackend
from src.vision.backends.azure_backend import AzureBackend
from src.vision.backends.aws_backend import AWSBackend
from src.vision.backends.insightface_backend import InsightFaceBackend

__all__ = ["LocalBackend", "AzureBackend", "AWSBackend", "InsightFaceBackend"]
