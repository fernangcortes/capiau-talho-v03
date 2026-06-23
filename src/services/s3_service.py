"""Serviço de Integração com Amazon S3 para armazenamento em Nuvem Híbrida e Backups."""
import os
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any
from botocore.exceptions import ClientError
from src.config import CONFIG

class S3Service:
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.enabled = os.getenv("USE_S3_STORAGE", "false").lower() == "true"
        self.key_id = os.getenv("AWS_ACCESS_KEY_ID")
        self.secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.bucket_name = None
        self._s3_client = None
        
        if not self.enabled:
            return

        if not self.key_id or not self.secret_key:
            print("[S3_SERVICE] S3 habilitado no .env, mas credenciais AWS_ACCESS_KEY_ID ou AWS_SECRET_ACCESS_KEY estao ausentes.")
            self.enabled = False
            return

        # Gerar nome de bucket deterministico e unico
        bucket_prefix = os.getenv("AWS_S3_BUCKET", "capiau-talho-storage").lower()
        if bucket_prefix == "capiau-talho-storage":
            key_hash = hashlib.md5(self.key_id.encode()).hexdigest()[:8]
            self.bucket_name = f"{bucket_prefix}-{key_hash}"
        else:
            self.bucket_name = bucket_prefix

        try:
            import boto3
            self._s3_client = boto3.client(
                "s3",
                aws_access_key_id=self.key_id,
                aws_secret_access_key=self.secret_key,
                region_name=self.region
            )
            # Garantir existencia do bucket
            self._ensure_bucket_exists()
        except ImportError:
            print("[S3_SERVICE] boto3 nao instalado. Instale: pip install boto3")
            self.enabled = False
        except Exception as e:
            print(f"[S3_SERVICE] Erro ao inicializar cliente S3: {e}")
            self.enabled = False

    def _ensure_bucket_exists(self):
        try:
            self._s3_client.head_bucket(Bucket=self.bucket_name)
            print(f"[S3_SERVICE] Bucket existente detectado: {self.bucket_name}")
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                print(f"[S3_SERVICE] Bucket {self.bucket_name} nao encontrado. Criando...")
                try:
                    if self.region == "us-east-1":
                        self._s3_client.create_bucket(Bucket=self.bucket_name)
                    else:
                        self._s3_client.create_bucket(
                            Bucket=self.bucket_name,
                            CreateBucketConfiguration={'LocationConstraint': self.region}
                        )
                    # Forcar privacidade (Block Public Access)
                    self._s3_client.put_public_access_block(
                        Bucket=self.bucket_name,
                        PublicAccessBlockConfiguration={
                            'BlockPublicAcls': True,
                            'IgnorePublicAcls': True,
                            'BlockPublicPolicy': True,
                            'RestrictPublicBuckets': True
                        }
                    )
                    print(f"[S3_SERVICE] Bucket {self.bucket_name} criado com sucesso e trancado como privado.")
                except Exception as ce:
                    print(f"[S3_SERVICE] Falha ao criar bucket S3: {ce}")
                    self.enabled = False
            else:
                print(f"[S3_SERVICE] Erro ao verificar bucket: {e}")
                self.enabled = False

    def get_bucket_total_size_gb(self) -> float:
        """Calcula o tamanho acumulado dos objetos no bucket em GB."""
        if not self.enabled or not self._s3_client:
            return 0.0
        try:
            total_size_bytes = 0
            paginator = self._s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=self.bucket_name):
                if 'Contents' in page:
                    for obj in page['Contents']:
                        total_size_bytes += obj['Size']
            return total_size_bytes / (1024 ** 3)
        except Exception as e:
            print(f"[S3_SERVICE] Erro ao calcular tamanho do bucket: {e}")
            return 0.0

    def upload_file(self, local_path: Path, s3_key: str) -> bool:
        """Faz upload de um arquivo para o S3 com travas de seguranca de custos ($10 USD / 150 GB)."""
        if not self.enabled or not self._s3_client:
            return False

        if not local_path.exists():
            print(f"[S3_SERVICE] Arquivo local nao encontrado para upload: {local_path}")
            return False

        # Travas de Seguranca Financeira
        # 1. Filtro de Seguranca de Pasta (nunca subir originais grandes)
        if "originals" in str(local_path).lower():
            print(f"[S3_SERVICE] TRAVA DE SEGURANCA: Bloqueado upload de arquivo original RAW para evitar custos: {local_path}")
            return False

        # 2. Limite Unitario: maximo 1.5 GB por arquivo
        file_size_gb = local_path.stat().st_size / (1024 ** 3)
        if file_size_gb > 1.5:
            print(f"[S3_SERVICE] TRAVA DE SEGURANCA: Bloqueado upload de arquivo individual com {file_size_gb:.2f} GB (limite maximo eh 1.5 GB): {local_path}")
            return False

        # 3. Limite Acumulado: maximo 150 GB no bucket
        total_size_gb = self.get_bucket_total_size_gb()
        if total_size_gb + file_size_gb > 150.0:
            print(f"[S3_SERVICE] TRAVA DE SEGURANCA: Upload rejeitado! O tamanho acumulado do bucket ultrapassara 150 GB (Total atual: {total_size_gb:.2f} GB). Evitando exceder limite de custo de $10 USD.")
            return False

        try:
            print(f"[S3_SERVICE] Iniciando upload de {local_path.name} ({file_size_gb * 1024:.1f} MB) para s3://{self.bucket_name}/{s3_key}")
            self._s3_client.upload_file(str(local_path), self.bucket_name, s3_key)
            print(f"[S3_SERVICE] Upload concluido: {s3_key}")
            return True
        except Exception as e:
            print(f"[S3_SERVICE] Erro no upload para o S3: {e}")
            return False

    def generate_presigned_url(self, s3_key: str, expiration_seconds: int = 3600) -> Optional[str]:
        """Gera uma URL assinada temporaria para visualizacao/streaming privado."""
        if not self.enabled or not self._s3_client:
            return None
        try:
            url = self._s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': s3_key},
                ExpiresIn=expiration_seconds
            )
            return url
        except Exception as e:
            print(f"[S3_SERVICE] Erro ao gerar URL assinada para {s3_key}: {e}")
            return None

    def file_exists_in_s3(self, s3_key: str) -> bool:
        """Verifica se um arquivo ja existe no bucket do S3."""
        if not self.enabled or not self._s3_client:
            return False
        try:
            self._s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == "404":
                return False
            raise e
        except Exception:
            return False
