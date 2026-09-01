#!/usr/bin/env python3
"""
deploy_wiki.py — Sincronizador Automático da Wiki do CapIAu-Talho para o GitHub

Este script sincroniza todos os arquivos markdown da pasta local `wiki/` diretamente
para o repositório Git da Wiki do GitHub (https://github.com/fernangcortes/capiau-talho-v03.wiki.git).

Uso:
    python scripts/deploy_wiki.py
"""

import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

# Garante saída UTF-8 no Windows para evitar erros de codificação de emojis
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Configurações do Repositório
REPO_WIKI_URL = "https://github.com/fernangcortes/capiau-talho-v03.wiki.git"
ROOT_DIR = Path(__file__).resolve().parent.parent
WIKI_SRC_DIR = ROOT_DIR / "wiki"
TEMP_WIKI_DIR = ROOT_DIR / "scratch" / "wiki_git"

def safe_rmtree(path):
    """Remove uma pasta tratando permissões de leitura no Windows."""
    def remove_readonly(func, path_to_remove, excinfo=None):
        try:
            os.chmod(path_to_remove, stat.S_IWRITE)
            func(path_to_remove)
        except Exception:
            pass

    if os.path.exists(path):
        try:
            if sys.version_info >= (3, 12):
                shutil.rmtree(path, onexc=lambda fn, p, exc: remove_readonly(fn, p, exc))
            else:
                shutil.rmtree(path, onerror=remove_readonly)
        except Exception:
            subprocess.run(f'cmd /c "rmdir /s /q \"{path}\""', shell=True)

def run_cmd(cmd, cwd=None):
    """Executa um comando de shell e retorna o output."""
    res = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, shell=True, encoding="utf-8", errors="replace")
    return res

def main():
    print("=" * 65)
    print("Sincronizador da Wiki Oficial do CapIAu-Talho")
    print(f"Pasta de Origem: {WIKI_SRC_DIR}")
    print(f"Destino: {REPO_WIKI_URL}")
    print("=" * 65)

    if not WIKI_SRC_DIR.exists():
        print(f"[ERRO] Diretório de origem '{WIKI_SRC_DIR}' não encontrado.")
        sys.exit(1)

    wiki_files = list(WIKI_SRC_DIR.glob("*.md"))
    if not wiki_files:
        print(f"[ERRO] Nenhum arquivo .md encontrado em '{WIKI_SRC_DIR}'.")
        sys.exit(1)

    print(f"\nEncontrados {len(wiki_files)} arquivos para sincronização:")
    for f in sorted(wiki_files):
        print(f"  * {f.name}")

    TEMP_WIKI_DIR.parent.mkdir(parents=True, exist_ok=True)

    # Se já existir um clone válido com .git, atualiza via pull/fetch
    if (TEMP_WIKI_DIR / ".git").exists():
        print("\nAtualizando repositório da Wiki já clonado...")
        run_cmd("git fetch origin", cwd=TEMP_WIKI_DIR)
        res_pull = run_cmd("git pull --rebase origin master", cwd=TEMP_WIKI_DIR)
        if res_pull.returncode != 0:
            run_cmd("git pull --rebase origin main", cwd=TEMP_WIKI_DIR)
    else:
        # Se pasta corrompida existir sem .git, limpa com segurança
        if TEMP_WIKI_DIR.exists():
            safe_rmtree(TEMP_WIKI_DIR)

        print("\nClonando o repositório da Wiki do GitHub...")
        res = run_cmd(f"git clone {REPO_WIKI_URL} {TEMP_WIKI_DIR}")

        if res.returncode != 0:
            print("\nAviso: Não foi possível clonar diretamente.")
            print("Se esta é a primeira vez que a Wiki está sendo criada:")
            print("   1. Acesse: https://github.com/fernangcortes/capiau-talho-v03/wiki/_new")
            print("   2. Crie qualquer página inicial no GitHub para inicializar o repositório da Wiki.")
            print("   3. Em seguida, execute este script novamente.\n")
            
            choice = input("Deseja tentar inicializar um repositório git local e fazer push forçado? (s/N): ").strip().lower()
            if choice == 's':
                TEMP_WIKI_DIR.mkdir(parents=True, exist_ok=True)
                run_cmd("git init", cwd=TEMP_WIKI_DIR)
                run_cmd(f"git remote add origin {REPO_WIKI_URL}", cwd=TEMP_WIKI_DIR)
            else:
                print("Operação cancelada.")
                sys.exit(1)

    print("\nCopiando arquivos markdown e imagens para o repositório da Wiki...")
    for f in wiki_files:
        dest = TEMP_WIKI_DIR / f.name
        shutil.copy2(f, dest)

    img_src = WIKI_SRC_DIR / "images"
    if img_src.exists():
        img_dest = TEMP_WIKI_DIR / "images"
        shutil.copytree(img_src, img_dest, dirs_exist_ok=True)

    print("Registrando alterações no Git...")
    run_cmd("git add .", cwd=TEMP_WIKI_DIR)
    
    status = run_cmd("git status --porcelain", cwd=TEMP_WIKI_DIR).stdout.strip()
    if not status:
        print("[OK] A Wiki já está 100% sincronizada com o GitHub. Nenhuma alteração pendente.")
        return

    commit_msg = "docs(wiki): atualizacao de diagramas e paginas oficiais do CapIAu-Talho"
    run_cmd(f'git commit -m "{commit_msg}"', cwd=TEMP_WIKI_DIR)

    print("Enviando alterações para o GitHub (git push)...")
    push_res = run_cmd("git push origin master", cwd=TEMP_WIKI_DIR)
    if push_res.returncode != 0:
        push_res = run_cmd("git push origin main", cwd=TEMP_WIKI_DIR)

    if push_res.returncode == 0:
        print("\n" + "=" * 65)
        print("SUCESSO! A Wiki do CapIAu-Talho foi publicada com sucesso!")
        print("Acesse agora: https://github.com/fernangcortes/capiau-talho-v03/wiki")
        print("=" * 65)
    else:
        print("\n[ERRO] Falha ao enviar alterações (push). Detalhes:")
        print(push_res.stderr or push_res.stdout)
        print("\nDica: Verifique se você possui permissão de escrita e se suas credenciais Git estão configuradas.")

if __name__ == "__main__":
    main()
