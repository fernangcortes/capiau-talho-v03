"""Serviço inteligente de Chat Guiador e Onboarding Conversacional do CapIAu-Talho.

Conecta-se a modelos de linguagem via OpenRouter/Gemini com chave de API, possui conhecimento
profundo de todo o funcionamento do CapIAu-Talho (NLE, MLT XML, Sistema 1 Laya, Nemotron 3 Diarization,
Grounding Gemini 0-1000, perfis de intenção, transcrição e timelines) e trata perguntas, dúvidas e
solicitações de explicação com respostas reais e contextuais, jamais confundindo perguntas com nomes de projetos.
"""
import re
import json
import logging
import requests
from typing import Any, Dict, List, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.settings import SettingsRepository
from src.services.settings_service import SettingsService

logger = logging.getLogger("capiau.onboarding")

CAPIAU_TALHO_KNOWLEDGE = """Você é o Copilot de Inteligência Cinematográfica do CapIAu-Talho, uma ilha de edição de vídeo não-linear (NLE - Non-Linear Editor) especializada em cinema documental brasileiro, produções autorais e acervos audiovisuais.

CONHECIMENTO COMPLETO DA ARQUITETURA E RECURSOS DO CAPIAU-TALHO:
1. Workspace NLE:
   - Motor de edição multipista baseado em MLT XML / Kdenlive com reprodução fluida e timeline de precisão matemática (DPR 1:1, sem flicker, sem estiramento).
   - Monitores duplos: Source (visualização e marcação de pontos IN/OUT com atalhos I/O) e Program (reprodução da timeline multipista).
   - Atalhos de ilha profissional de montagem (QWER / ASDF, Numpad para layouts de painel, ferramentas V=Seleção, C=Navalha/Lâmina, B=Ripple).
   - Design System Flat & Seamless (sem bordas duplicadas, linhas restauradoras de 4px para reabrir painéis, tema Neutro/Personalizado, modo escuro glassmorphic).

2. Camadas de Inteligência Artificial SOTA 2026:
   - Sistema 1 Cognitivo Dual: Receptron Laya (ModernBERT ONNX em CPU local, latência ~18ms, custo $0.00) para triagem instantânea Eixo A na ingestão (obra, processo, depoimento, cotidiano, arquivo) com escalação para o Sistema 2 (Gemini 3.8 Flash / DeepSeek V4.1) apenas quando a confiança calibrada for < 0.88.
   - Visão Multimodal & Grounding Espacial: Google Gemini 3.8 Flash, NVIDIA Cosmos, YOLO-World v2, Florence-2 e DINO-X Edge. Todas as coordenadas são padronizadas no formato canônico Gemini [ymin, xmin, ymax, xmax] (0 a 1000) persistidas na tabela detected_object e no Qdrant.
   - Click-to-Search Grounding no Player: O montador pode pausar o vídeo e clicar em qualquer ator ou adereço/objeto detectado no monitor para buscar instantaneamente todas as cenas do projeto onde aquele elemento aparece.
   - Biometria Facial 512-d: Unificação exclusiva com SCRFD + ArcFace (MobileNet Buffalo_sc ONNX CPU em 512 dimensões), descontinuando o antigo SFace 128-d.
   - Áudio, Transcrição e Diarização de Falas Sobrepostas: NVIDIA Nemotron 3 Diarization (100M open weights, até 8 locutores com fala concorrente/overlapping speech modelada relacionalmente na tabela dialogue_utterance) combinado a NVIDIA Canary-1B e Whisper-Large-v3-Turbo com alinhamento de palavras em dialogue_word.
   - Agente de Edição NLE (Copilot de Montagem):
     * Text-Based Editing: O montador seleciona trechos na transcrição e insere cirurgicamente na timeline. Falas sobrepostas de dois locutores são separadas automaticamente em pistas A1 e A2 sem colisão destrutiva.
     * Agentic Rough Cut / Assembly: O assistente pode montar sequências preliminares na timeline a partir de pedidos em linguagem natural, inserindo marcadores com justificativas dramatúrgicas.
     * Timeline Diff & Safety Gatekeeper: Mutações propostas pelo agente geram prévias em trilhas fantasmas translúcidas (ghostTrack) e resumo visual de diff no chat. Nenhuma alteração é gravada no MLT XML sem confirmação explícita do editor.

3. Os 3 Perfis de Intenção Conversacionais (2026 SOTA):
   - "🍃 Documentário Offline Econômico" (doc_offline_eco): 100% local, offline, custo $0.00 de API. Roda na CPU com ONNX Runtime (Laya + ArcFace 512-d + Nemotron 3 Diarization / Whisper-Turbo local). Ideal para dezenas ou centenas de horas de cartões de câmera sem gastar créditos.
   - "⚡ Entrevista Ágil" (entrevista_agil): Prioriza vazão rápida de transcrição, busca textual imediata e decupagem veloz de depoimentos e diálogos.
   - "🎬 Cinema Nuvem SOTA" (cinema_nuvem_sota): Máxima fidelidade estética e raciocínio dramático profundo com modelos em nuvem de fronteira (Gemini 3.8 Flash, DeepSeek V4.1, Claude Sonnet).

SUA MISSÃO NO CHAT GUIADOR DE ENTRADA (ONBOARDING):
1. SE O USUÁRIO FIZER PERGUNTAS, PEDIR EXPLICAÇÃO OU DEMONSTRAR DÚVIDAS (ex: "me explique melhor isso aqui", "o que é isso?", "como funciona?", "o que é perfil de intenção?", "quais formatos aceita?"):
   - RESPONDA DE FORMA CLARA, INTELIGENTE, DIDÁTICA E ELEGANTE EM PORTUGUÊS!
   - Explique o que é o CapIAu-Talho, como ele reduz o trabalho repetitivo da montagem e como a IA auxilia o documentarista.
   - NUNCA, SOB NENHUMA HIPÓTESE, trate uma pergunta, pedido de explicação ou dúvida como se fosse o nome ou título do projeto!
2. Converse naturalmente: ajude a pensar no título, entenda se o usuário está montando um documentário, entrevista, curta, podcast ou making of.
3. Sugira e explique os 3 perfis de intenção quando apropriado.
4. Quando o usuário definir ou aprovar um nome e perfil, convide-o a arrastar as pastas ou arquivos de vídeo para a dropzone, ou avançar direto para a ilha de edição.

ESTRUTURA DE RESPOSTA OBRIGATÓRIA:
Responda em linguagem natural clara, acolhedora e cinematográfica.
Ao final de toda resposta, inclua OBRIGATORIAMENTE um bloco estruturado no formato:
```json:action
{
  "suggested_project_name": "Nome sugerido ou confirmado para o projeto, ou null se o usuário ainda está tirando dúvidas",
  "detected_profile": "doc_offline_eco | entrevista_agil | cinema_nuvem_sota | null",
  "step": "discussing | name_set | profile_set | media_ready | ready_to_create",
  "ready_to_create": false,
  "chips": [
    {"label": "Texto amigável no botão", "value": "Texto enviado se clicar", "action": "browse_folder | browse_files | skip_media | skip_nle | null"}
  ]
}
```"""

INTENT_EXPLANATION_KEYWORDS = [
    "explique", "explicar", "entender", "o que é", "oq é", "como funciona",
    "ajuda", "socorro", "duvida", "dúvida", "quem é você", "quem e vc",
    "não sei", "nao sei", "o que faz", "para que serve", "qual a diferenca",
    "qual a diferença", "funciona como", "tutorial", "oque"
]

class OnboardingAgentService:
    """Orquestrador do Chat Guiador de Entrada com suporte a LLMs em nuvem e inteligência local especializada."""

    @staticmethod
    def _is_api_key_string(text: str) -> Optional[tuple[str, str]]:
        """Identifica se o usuário colou diretamente uma chave de API."""
        cleaned = text.strip()
        if cleaned.startswith("sk-or-v1-") or (cleaned.startswith("sk-") and len(cleaned) > 25):
            return ("openrouter", cleaned)
        if cleaned.startswith("AIzaSy") and len(cleaned) >= 35:
            return ("gemini", cleaned)
        return None

    @staticmethod
    def _save_api_key(provider: str, key_val: str) -> bool:
        """Salva a chave no app_setting global e invalida cache."""
        try:
            target_key = "api.openrouter_key" if provider == "openrouter" else "api.gemini_key"
            with get_db() as conn:
                SettingsRepository.upsert_global(conn, target_key, key_val)
                conn.commit()
            SettingsService.invalidate()
            return True
        except Exception as e:
            logger.error(f"[OnboardingAgent] Falha ao persistir chave de API: {e}")
            return False

    @staticmethod
    def _build_intelligent_fallback(message: str, history: List[Dict[str, str]], 
                                    current_name: Optional[str], current_profile: Optional[str]) -> Dict[str, Any]:
        """Motor especializado de conhecimento nativo do CapIAu-Talho quando offline ou sem API key ativa."""
        lower = message.lower().strip()
        is_question = any(kw in lower for kw in INTENT_EXPLANATION_KEYWORDS) or lower.endswith("?")

        # 1. Usuário pediu explicação geral sobre o CapIAu-Talho ou a tela atual
        if is_question or "isso aqui" in lower or "o que" in lower:
            reply = (
                "👋 **Com certeza! Vou te explicar exatamente como o CapIAu-Talho funciona:**\n\n"
                "O **CapIAu-Talho** é uma ilha de edição de vídeo (NLE) profissional desenhada sob medida para documentários "
                "e produções autorais. Em vez de você gastar dias assistindo a centenas de horas de gravações brutas manualmente, "
                "o Talho conta com agentes de inteligência artificial que trabalham em conjunto com você:\n\n"
                "• **⚡ Triagem Instantânea (Sistema 1):** Classifica seus cartões de câmera em material de cena, making of, entrevistas "
                "e bastidores em menos de 20 milissegundos por arquivo sem nenhum custo de API.\n"
                "• **🎙️ Transcrição com Fala Sobreposta:** Identifica automaticamente quem está falando mesmo quando duas pessoas falam "
                "ao mesmo tempo (usando o modelo *NVIDIA Nemotron 3 Diarization*), permitindo montar direto pelo texto da fala.\n"
                "• **👁️ Reconhecimento e Busca Visual:** Encontra atores, personagens, figurinos e objetos de cena pelo monitor do player.\n"
                "• **🎬 Copilot de Montagem:** Sugere cortes preliminares (*rough cut*) e projeta prévias em trilhas fantasmas transparentes "
                "para você aprovar antes de alterar sua timeline real.\n\n"
                "Para começarmos, precisamos apenas de um **título ou tema** para a sua produção e da escolha do **perfil de IA** "
                "(ex: 100% gratuito e offline em CPU, ou usando modelos de nuvem). Que tipo de projeto você vai montar hoje?"
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name,
                "detected_profile": current_profile,
                "step": "discussing",
                "ready_to_create": False,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "🍃 Usar Perfil Offline Econômico", "value": "Quero usar o perfil Documentário Offline Econômico"},
                    {"label": "⚡ Usar Perfil Entrevista Ágil", "value": "Quero o perfil Entrevista Ágil"},
                    {"label": "🎬 Usar Perfil Cinema Nuvem", "value": "Quero usar Cinema Nuvem SOTA"},
                    {"label": "💡 Sugerir Nome de Projeto", "value": "Me dê 3 sugestões de títulos para documentário"},
                    {"label": "⏭️ Pular para o Editor", "action": "skip_nle"}
                ]
            }

        # 1.1 Usuário pediu para pular ingestão ou avançar
        is_skip = any(kw in lower for kw in ["pular", "skip", "depois", "sem mídia", "sem midia", "avançar", "avancar", "continuar"])
        if is_skip:
            reply = (
                f"Entendido! Vamos iniciar o projeto **{current_name or 'Novo Projeto'}** sem importar mídias agora.\n\n"
                "Você poderá importar pastas, vídeos e cartões de memória a qualquer momento na ilha de edição."
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name or "Novo Projeto",
                "detected_profile": current_profile or "doc_offline_eco",
                "step": "ready",
                "ready_to_create": True,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "🚀 Entrar na Ilha de Edição (NLE)", "action": "transition_nle"}
                ]
            }

        # 2. Usuário pediu sugestão de nomes
        if "sugest" in lower or "sugir" in lower or "ideia" in lower or "nomes" in lower:
            reply = (
                "Aqui estão 3 ideias de títulos clássicos de cinema documental brasileiro que você pode adotar ou se inspirar:\n\n"
                "1. **Vozes da Terra: Memórias Vivas** (Ideal para histórias orais, comunidades e patrimônio)\n"
                "2. **Corte Profundo: Os Bastidores da Criação** (Ideal para making of, processos artísticos e ensaios)\n"
                "3. **Diálogos no Tempo** (Ideal para entrevistas biográficas e debates contemporâneos)\n\n"
                "Gostou de algum desses ou prefere dar um nome próprio à sua produção?"
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name,
                "detected_profile": current_profile,
                "step": "discussing",
                "ready_to_create": False,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "Adotar: Vozes da Terra", "value": "Vozes da Terra: Memórias Vivas"},
                    {"label": "Adotar: Corte Profundo", "value": "Corte Profundo: Os Bastidores da Criação"},
                    {"label": "Adotar: Diálogos no Tempo", "value": "Diálogos no Tempo"}
                ]
            }

        # 3. Usuário escolheu ou mencionou um perfil de intenção
        if "offline" in lower or "economico" in lower or "econômico" in lower or "doc_offline" in lower:
            chosen_profile = "doc_offline_eco"
            reply = (
                "Excelente escolha! O perfil **🍃 Documentário Offline Econômico** foi selecionado.\n\n"
                "Ele opera 100% de forma local na sua CPU com ONNX Runtime (custo $0.00 de API), utilizando o Sistema 1 Laya, "
                "reconhecimento facial ArcFace 512-d e diarização local. Perfeito para acervos extensos com privacidade total.\n\n"
                "Agora, **arraste sua pasta de mídias brutas ou cartões de câmera** para a área ao lado, ou clique em pular se quiser importar depois no editor."
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name or "Documentário Raízes",
                "detected_profile": chosen_profile,
                "step": "profile_set",
                "ready_to_create": False,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "📁 Selecionar Pasta...", "action": "browse_folder"},
                    {"label": "🎬 Selecionar Arquivos...", "action": "browse_files"},
                    {"label": "⏭️ Pular Ingestão por Enquanto", "action": "skip_media"}
                ]
            }

        if "agil" in lower or "ágil" in lower or "entrevista" in lower:
            chosen_profile = "entrevista_agil"
            reply = (
                "Ótimo! O perfil **⚡ Entrevista Ágil** foi selecionado.\n\n"
                "Configurado com foco em velocidade de transcrição, identificação rápida de locutores e decupagem dinâmica de falas.\n\n"
                "Agora você pode **arrastar os vídeos da entrevista** para a dropzone ao lado, ou avançar diretamente para a ilha de edição."
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name or "Entrevista de Campo",
                "detected_profile": chosen_profile,
                "step": "profile_set",
                "ready_to_create": False,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "📁 Selecionar Pasta...", "action": "browse_folder"},
                    {"label": "🎬 Selecionar Arquivos...", "action": "browse_files"},
                    {"label": "⏭️ Pular Ingestão por Enquanto", "action": "skip_media"}
                ]
            }

        if "nuvem" in lower or "sota" in lower or "cinema" in lower:
            chosen_profile = "cinema_nuvem_sota"
            reply = (
                "Perfeito! O perfil **🎬 Cinema Nuvem SOTA** foi selecionado.\n\n"
                "Habilita a máxima resolução de entendimento audiovisual através de modelos de fronteira em nuvem (Gemini 3.8 Flash e DeepSeek V4.1).\n\n"
                "Arraste suas mídias para a dropzone ao lado ou avance para ingressar no editor."
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name or "Produção Cinema SOTA",
                "detected_profile": chosen_profile,
                "step": "profile_set",
                "ready_to_create": False,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "📁 Selecionar Pasta...", "action": "browse_folder"},
                    {"label": "🎬 Selecionar Arquivos...", "action": "browse_files"},
                    {"label": "⏭️ Pular Ingestão por Enquanto", "action": "skip_media"}
                ]
            }

        # 4. Se o nome já foi definido mas o perfil ainda não, e a entrada não casou com nenhum perfil
        if current_name and not current_profile:
            reply = (
                f"O título **{current_name}** está registrado! No entanto, não identifiquei o perfil de IA correspondente a '{message}'.\n\n"
                "Por favor, escolha um dos 3 perfis recomendados abaixo para calibrar seu ambiente:"
            )
            return {
                "reply": reply,
                "suggested_project_name": current_name,
                "detected_profile": None,
                "step": "awaiting_profile",
                "ready_to_create": False,
                "api_status": "offline_mode",
                "chips": [
                    {"label": "🍃 Documentário Offline Econômico", "value": "doc_offline_eco"},
                    {"label": "⚡ Entrevista Ágil", "value": "entrevista_agil"},
                    {"label": "🎬 Cinema Nuvem SOTA", "value": "cinema_nuvem_sota"}
                ]
            }

        # 5. Tratamento de nome de projeto (somente se ainda não houver nome definido)
        candidate_name = re.sub(r'["\']', '', message).strip()
        if not current_name:
            if not candidate_name:
                return {
                    "reply": "⚠️ Por favor, informe um título válido para o projeto.",
                    "suggested_project_name": None,
                    "detected_profile": current_profile,
                    "step": "awaiting_name",
                    "ready_to_create": False,
                    "api_status": "offline_mode",
                    "chips": [
                        {"label": "Documentário Raízes", "value": "Documentário Raízes"},
                        {"label": "Entrevista de Campo", "value": "Entrevista de Campo"},
                        {"label": "Making Of Oficial", "value": "Making Of Oficial"}
                    ]
                }

            if len(candidate_name) >= 3 and len(candidate_name) <= 60 and not is_question:
                reply = (
                    f"Perfeito! Registrei o título do seu projeto como: **{candidate_name}**.\n\n"
                    "Para calibrarmos os motores de IA e otimizarmos o uso da sua máquina, **qual perfil de intenção melhor descreve sua produção?**"
                )
                return {
                    "reply": reply,
                    "suggested_project_name": candidate_name,
                    "detected_profile": current_profile,
                    "step": "name_set",
                    "ready_to_create": False,
                    "api_status": "offline_mode",
                    "chips": [
                        {"label": "🍃 Documentário Offline Econômico", "value": "Documentário Offline Econômico"},
                        {"label": "⚡ Entrevista Ágil", "value": "Entrevista Ágil"},
                        {"label": "🎬 Cinema Nuvem SOTA", "value": "Cinema Nuvem SOTA"}
                    ]
                }

        # Resposta padrão orientadora
        return {
            "reply": (
                "Entendido! Estou aqui para conduzir o início da sua produção.\n\n"
                "Podemos definir o **título da sua obra** ou, se preferir, explorar primeiro como a inteligência artificial "
                "do Talho pode auxiliar seu documentário. O que prefere?"
            ),
            "suggested_project_name": current_name,
            "detected_profile": current_profile,
            "step": "discussing",
            "ready_to_create": False,
            "api_status": "offline_mode",
            "chips": [
                {"label": "Como o Talho me ajuda?", "value": "me explique melhor como o programa funciona"},
                {"label": "🍃 Começar com Modo Offline", "value": "Quero o perfil Documentário Offline Econômico"},
                {"label": "⏭️ Pular para o Editor", "action": "skip_nle"}
            ]
        }

    @classmethod
    def chat(cls, message: str, history: List[Dict[str, str]] = None,
             current_project_name: Optional[str] = None,
             current_profile: Optional[str] = None,
             custom_api_key: Optional[str] = None) -> Dict[str, Any]:
        """Ponto de entrada do chat guiador com resolução de chave de API e inteligência profunda."""
        history = history or []
        msg_str = (message or "").strip()

        # 1. Verifica se o usuário colou uma chave de API diretamente no chat
        key_detected = cls._is_api_key_string(msg_str)
        if key_detected:
            provider, api_token = key_detected
            saved = cls._save_api_key(provider, api_token)
            if saved:
                return {
                    "reply": (
                        f"🔒 **Chave de API ({provider.capitalize()}) configurada com sucesso no banco local!**\n\n"
                        f"Por proteção de privacidade, a chave foi gravada diretamente nas configurações globais locais e "
                        f"mascarada no chat, não sendo salva no histórico de mensagens nem enviada a outros modelos. "
                        f"Agora o CapIAu-Talho está conectado à inteligência em nuvem.\n\n"
                        f"Você também pode gerenciar suas chaves com segurança no botão **Chaves de API** no topo do Welcome Hub.\n\n"
                        f"Qual o título ou tema do seu projeto?"
                    ),
                    "suggested_project_name": current_project_name,
                    "detected_profile": current_profile or "cinema_nuvem_sota",
                    "step": "discussing",
                    "ready_to_create": False,
                    "api_status": "ok",
                    "chips": [
                        {"label": "🔑 Gerenciar Chaves de API", "action": "open_api_keys"},
                        {"label": "🍃 Usar Modo Offline", "value": "Documentário Offline Econômico"},
                        {"label": "🎬 Usar Cinema Nuvem", "value": "Cinema Nuvem SOTA"}
                    ]
                }

        # 2. Resolução da chave de API configurada. A chamada vai para a OpenRouter, então só a
        # chave da OpenRouter serve: a do Gemini voltaria 401 e cairia sempre no motor local.
        S = SettingsService.get_settings()
        api_key = (custom_api_key or S.api_key("openrouter") or "").strip()
        model_name = S.get("llm.text_model") or CONFIG.TEXT_MODEL

        def _local(status: str, note: str = "") -> Dict[str, Any]:
            fb = cls._build_intelligent_fallback(msg_str, history, current_project_name, current_profile)
            fb["api_status"] = status
            fb["model"] = None
            fb["requested_model"] = model_name
            if note:
                fb["reply"] = note + "\n\n" + fb["reply"]
            return fb

        if not api_key or api_key == "your_openrouter_api_key_here":
            # Sem chave ativa: executa o motor nativo especializado de conhecimento
            return _local("missing_key")

        # 3. Execução via LLM em Nuvem com System Prompt de Especialista
        system_content = CAPIAU_TALHO_KNOWLEDGE
        if current_project_name:
            system_content += f"\n\n[ESTADO ATUAL]: O usuário já sugeriu o título: '{current_project_name}'."
        if current_profile:
            system_content += f"\n[ESTADO ATUAL]: O perfil de intenção já selecionado é: '{current_profile}'."

        def _sanitize_secrets(t: str) -> str:
            if not t:
                return ""
            t = re.sub(r'sk-or-v1-[a-zA-Z0-9_\-]+', '[CHAVE_API_REDACTED]', t)
            t = re.sub(r'sk-[a-zA-Z0-9_\-]{20,}', '[CHAVE_API_REDACTED]', t)
            t = re.sub(r'AIzaSy[a-zA-Z0-9_\-]{30,}', '[CHAVE_API_REDACTED]', t)
            return t

        messages = [{"role": "system", "content": system_content}]
        # Histórico recente para continuidade com higienização estrita de segredos
        for h in history[-8:]:
            messages.append({
                "role": h.get("role", "user"),
                "content": _sanitize_secrets(h.get("content", ""))
            })
        messages.append({"role": "user", "content": _sanitize_secrets(msg_str)})

        # Endpoint e modelo
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/capiau/talho",
            "X-Title": "CapIAu-Talho NLE"
        }
        payload = {
            "model": model_name,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 1200
        }

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=12)
            if resp.status_code == 200:
                res_data = resp.json()
                raw_text = res_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

                # Extrai o bloco JSON estruturado se presente
                action_data = {}
                action_match = re.search(r"```json:action\s*([\s\S]*?)\s*```", raw_text)
                clean_reply = raw_text

                if action_match:
                    try:
                        action_data = json.loads(action_match.group(1))
                        clean_reply = raw_text[:action_match.start()].strip()
                    except Exception as json_err:
                        logger.warning(f"[OnboardingAgent] Falha ao parsear json:action da IA: {json_err}")

                suggested_name = action_data.get("suggested_project_name") or current_project_name
                detected_prof = action_data.get("detected_profile") or current_profile
                chips = action_data.get("chips") or []
                step = action_data.get("step") or "discussing"
                ready_to_create = bool(action_data.get("ready_to_create"))

                # Fallback de chips se a IA não gerou
                if not chips:
                    if not current_project_name and not suggested_name:
                        chips = [
                            {"label": "Como o Talho me ajuda?", "value": "me explique melhor como o programa funciona"},
                            {"label": "🍃 Usar Modo Offline", "value": "Quero o perfil Documentário Offline Econômico"},
                            {"label": "⏭️ Pular para o Editor", "action": "skip_nle"}
                        ]
                    elif not current_profile and not detected_prof:
                        chips = [
                            {"label": "🍃 Documentário Offline Econômico", "value": "Documentário Offline Econômico"},
                            {"label": "⚡ Entrevista Ágil", "value": "Entrevista Ágil"},
                            {"label": "🎬 Cinema Nuvem SOTA", "value": "Cinema Nuvem SOTA"}
                        ]

                return {
                    "reply": clean_reply,
                    "suggested_project_name": suggested_name,
                    "detected_profile": detected_prof,
                    "step": step,
                    "chips": chips,
                    "ready_to_create": ready_to_create,
                    "api_status": "ok",
                    # Modelo que de fato respondeu (a OpenRouter devolve o ID resolvido, útil com aliases ~…-latest)
                    "model": res_data.get("model") or model_name,
                    "requested_model": model_name,
                }

            elif resp.status_code == 401:
                logger.warning("[OnboardingAgent] Chave OpenRouter expirada ou inválida (401). Recorrendo ao motor nativo.")
                return _local(
                    "expired_key",
                    "**A chave da OpenRouter foi recusada** (expirada ou inválida), então quem responde é o assistente local. "
                    "Cole uma chave nova aqui na conversa ou em Chaves e modelos."
                )
            else:
                logger.warning(f"[OnboardingAgent] Erro na API OpenRouter ({resp.status_code}) com {model_name}: {resp.text[:120]}")
                return _local(
                    "model_error",
                    f"**O modelo {model_name} não respondeu** (erro {resp.status_code} da OpenRouter), então quem responde é o assistente local. "
                    "Confira o modelo de texto em Chaves e modelos."
                )

        except requests.Timeout:
            logger.error(f"[OnboardingAgent] {model_name} passou de 12 s sem responder.")
            return _local(
                "timeout",
                f"**O modelo {model_name} demorou mais de 12 s**, então quem responde é o assistente local."
            )
        except Exception as e:
            logger.error(f"[OnboardingAgent] Exceção na chamada LLM: {e}")
            return _local("offline_mode")
