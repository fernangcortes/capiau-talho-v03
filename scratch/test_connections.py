"""Script para testar a conexão com as APIs do OpenRouter e AssemblyAI."""
import os
import sys
import requests
from pathlib import Path
from dotenv import load_dotenv

# Caminho para carregar o .env
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env')

def test_openrouter():
    print("[OPENROUTER] Testando conexão...")
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key or api_key == "your_openrouter_api_key_here":
        print("  ❌ OPENROUTER_API_KEY não foi configurada no .env")
        return False
        
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    # Payload simples enviando uma chamada para o DeepSeek Chat
    data = {
        "model": "deepseek/deepseek-chat",
        "messages": [{"role": "user", "content": "Diga 'Conexão OK' em uma palavra."}]
    }
    
    try:
        response = requests.post(url, headers=headers, json=data, timeout=10)
        if response.status_code == 200:
            res_json = response.json()
            content = res_json['choices'][0]['message']['content'].strip()
            print(f"  ✅ Conectado com sucesso! Resposta: {content}")
            return True
        else:
            print(f"  ❌ Erro de conexão (Status: {response.status_code}): {response.text}")
            return False
    except Exception as e:
        print(f"  ❌ Falha crítica de requisição: {e}")
        return False

def test_assemblyai():
    print("[ASSEMBLYAI] Testando conexão...")
    api_key = os.getenv("ASSEMBLYAI_API_KEY", "")
    if not api_key or api_key == "your_assemblyai_api_key_here":
        print("  ❌ ASSEMBLYAI_API_KEY não foi configurada no .env")
        return False
        
    url = "https://api.assemblyai.com/v2/transcript"
    headers = {
        "authorization": api_key,
        "content-type": "application/json"
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        # Se retornar 200, a autenticação foi bem-sucedida (pode ser uma lista vazia de transcrições)
        if response.status_code == 200:
            print("  ✅ Conectado com sucesso ao painel da AssemblyAI!")
            return True
        else:
            print(f"  ❌ Erro de conexão (Status: {response.status_code}): {response.text}")
            return False
    except Exception as e:
        print(f"  ❌ Falha crítica de requisição: {e}")
        return False

if __name__ == "__main__":
    print("="*60)
    print("           TESTE DE CONEXÃO CAPIAU APIs")
    print("="*60)
    
    openrouter_ok = test_openrouter()
    print("-"*60)
    assembly_ok = test_assemblyai()
    print("="*60)
    
    if openrouter_ok and assembly_ok:
        print("🎉 Ambas as conexões estão OK! O ambiente está pronto.")
    else:
        print("⚠️ Verifique os erros acima antes de rodar o pipeline completo.")
