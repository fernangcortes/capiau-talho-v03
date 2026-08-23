"""Glossario de audio para quem monta video (contrato N1; fonte UNICA).

Por que existe: o painel fala em LUFS, dBTP, LRA, speechnorm, alimiter, e quem
monta video nao tem por que saber o que e nada disso. Esta rodada entrega UMA
fonte de verdade usada nos dois lugares: a interface le estas entradas pela
rota do icone (i) (AGENTE M2) e o prompt do chat embute para_prompt()
(AGENTES M5/M6). Texto vivo em dois lugares diverge na primeira correcao;
texto com uma fonte so, nunca.

Verdades MEDIDAS que este glossario conta (contra o documento, quando os dois
divergem, vale a medida - secoes 1 e correcoes da ETAPA 1 do plano):

- Entrevista Julia + Virshna, janela 6:45 a 8:15: loudness -7,4 LUFS (alvo
  -16), pico real +1,7 dBTP, piso de ruido -26,9 dB, LRA 4,5, 36 momentos de
  estouro em 90 s, correlacao entre canais 0,99935 (mono duplicado).
- Depois do preset "resgate_estourado": -16,0 LUFS, -3,0 dBTP, piso -36,4 dB.
- Formula de atenacao CORRETA: clamp(piso - (-45), 6, 18) dB (a do plano
  original estava invertida; a implementacao corrigiu).
- ffmpeg nesta maquina corre a 31x-44x o tempo real (o plano dizia ~90x; nao
  se reproduz). Denoise IA (DPDFNet) a cerca de 0,7x o tempo do audio.
- A regra de clipping por PORCENTAGEM quase nunca dispara neste material
  (~0,00005% contra limiar de 0,05%): quem acusa a distorcao e o pico real.
- loudnorm de 1 passagem errou ~0,7 LU na medicao real: aqui sao SEMPRE 2.
- Auphonic: cota gratis de 2 h/mes; envio nunca e repetido automaticamente.
- ETAPA 4 chegou: sherpa-onnx e o modelo DPDFNet estao instalados, o motor
  responde disponivel e DOIS presets passam pela IA (resgate_ia,
  voz_limpa_ia); os quatro presets antigos SEGUEM no filtro classico DE
  PROPOSITO, para o custo nunca subir em silencio.

Convencoes: texto para TELA, entao acento em portugues e esperado; porem
PROIBIDO seta unicode, <= >= unicode, travessao ou emoji, porque para_prompt()
vai para o prompt do chat, que atravessa log cp1252. Um guarda no fim do
modulo falha na importacao se alguem introduzir caractere proibido.

Secao de cada entrada e uma de: diagnostico | aovivo | tratamento | nuvem.
Os presets aparecem no painel de Tratamento, entao ficam com secao
"tratamento" mesmo formando grupo proprio na cobertura.
"""
import re

# Secoes onde uma entrada pode aparecer na interface.
SECOES_VALIDAS = ("diagnostico", "aovivo", "tratamento", "nuvem")

GLOSSARIO: dict[str, dict] = {
    # ------------------------------------------------------------------
    # DIAGNOSTICO (leitura do "Analisar")
    # ------------------------------------------------------------------
    "loudness": {
        "titulo": "Volume médio (loudness)",
        "resumo": "O quanto o som fica alto na média, sem olhar instantes "
                  "isolados; medido em LUFS, é o número que diz se sua "
                  "entrevista sai baixa ou gritando.",
        "detalhe": "O painel compara o volume médio do clipe com o alvo do "
                   "projeto, -16 LUFS. Na janela 6:45 a 8:15 da entrevista "
                   "Julia + Virshna a medição deu -7,4 LUFS: quase 9 pontos "
                   "acima do alvo, e por isso o diagnóstico marca ALTO ao "
                   "lado. Volume médio fora do alvo faz um clipe soar muito "
                   "mais alto ou muito mais baixo que os outros na mesma "
                   "montagem, e o espectador vive mexendo no volume. Depois "
                   "do preset 'Resgate de captação estourada', essa mesma "
                   "janela foi para -16,0 LUFS. A tolerância da casa é de 1 "
                   "LU para cima ou para baixo; dentro dela, ninguém precisa "
                   "mexer em nada.",
        "na_pratica": "Aperte 'Analisar' na seção Diagnóstico e leia o valor "
                      "contra o alvo de -16 LUFS; se passar de 1 LU de "
                      "diferença, aplique um preset com 'Normalizar volume' "
                      "ligado ('Só entrega' quando o áudio já está limpo).",
        "secao": "diagnostico",
        "relacionado": ["pico_real", "dinamica_lra", "loudnorm", "so_entrega"],
    },
    "pico_real": {
        "titulo": "Pico real (dBTP)",
        "resumo": "O instante mais alto do som, medido ponto a ponto; se "
                  "passa de 0 dBTP o áudio distorce, e baixar o volume "
                  "depois não desfaz.",
        "detalhe": "O volume médio pode estar ótimo e mesmo assim um único "
                   "instante estourar. O teto do projeto é -1,5 dBTP. Nesta "
                   "mesma entrevista a medição achou pico real de +1,7 dBTP, "
                   "acima do máximo físico: é isso que dá aquele som rasgado "
                   "de gravação caseira. É também o número mais confiável "
                   "deste acervo: a regra de clipping por porcentagem quase "
                   "nunca dispara nele, então quem acusa o problema é o pico "
                   "real. No material tratado com o preset de resgate, o pico "
                   "caiu para -3,0 dBTP, com folga abaixo do teto.",
        "na_pratica": "Aperte 'Analisar': acima de 0 dBTP é distorção certa, "
                      "aplique o preset 'Resgate de captação estourada'; "
                      "entre 0 e -1,5 está acima do teto e pede limitador no "
                      "fim da cadeia.",
        "secao": "diagnostico",
        "relacionado": ["clipping", "alimiter", "momentos_estouro",
                        "resgate_estourado"],
    },
    "clipping": {
        "titulo": "Clipping (amostras estouradas)",
        "resumo": "A fração do áudio que ficou colada no volume máximo, "
                  "achatada como onda cortada; acima de 0,05% já se ouve.",
        "detalhe": "Tecnicamente conta quantas amostras chegaram ao fundo de "
                   "escala. O aviso honesto: neste acervo a medição real deu "
                   "por volta de 0,00005%, mil vezes abaixo do limiar de "
                   "0,05%, então este selo quase nunca acende mesmo quando o "
                   "som está distorcido. Quem denuncia a distorção aqui é o "
                   "'Pico real' (+1,7 dBTP na entrevista Julia + Virshna), "
                   "não esta porcentagem. Quando dispara de verdade, significa "
                   "onda achatada que nenhum ganho conserta: precisa "
                   "reconstruir o formato da onda.",
        "na_pratica": "Não decida por este selo sozinho: confirme pelo 'Pico "
                      "real'. Havendo distorção, o reparo (adeclip) já vem "
                      "ligado no início do preset 'Resgate de captação "
                      "estourada'.",
        "secao": "diagnostico",
        "relacionado": ["pico_real", "adeclip", "resgate_estourado"],
    },
    "piso_ruido": {
        "titulo": "Piso de ruído",
        "resumo": "O quão alto é o som de fundo entre uma fala e outra: "
                  "ventilador, rua, chiado; quanto mais perto de zero, mais "
                  "sujo está o clipe.",
        "detalhe": "O alvo da casa é -45 dB. A janela analisada da entrevista "
                   "mediu -26,9 dB: sala barulhenta, quase 20 pontos acima do "
                   "ideal, e por isso o diagnóstico marca ALTO e sugere "
                   "limpeza. A força da limpeza sai desta medida pela regra "
                   "clamp(piso - (-45), 6, 18): piso de -26,9 pede os 18 dB "
                   "máximos. Depois do resgate completo o piso foi para "
                   "-36,4 dB, ainda com ambiência viva. Entre -35 e -45 só "
                   "vale limpeza leve; abaixo de -45, o material está limpo e "
                   "não se mexe.",
        "na_pratica": "Aperte 'Analisar' e siga a atenuação sugerida pelo "
                      "programa; acima de -35 dB prefira a limpeza por IA, e "
                      "evite marcar 'sem limite' numa entrevista: ela mata a "
                      "ambiência.",
        "secao": "diagnostico",
        "relacionado": ["denoise_ia", "atenuacao", "ambiencia_preservada",
                        "correlacao_canais"],
    },
    "dinamica_lra": {
        "titulo": "Variação de volume (LRA)",
        "resumo": "A diferença entre os trechos baixos e os altos do clipe; "
                  "LRA baixo é som esmagado, tudo no mesmo nível.",
        "detalhe": "LRA saudável fica entre 5 e 12. Na entrevista Julia + "
                   "Virshna deu 4,5: dinâmica esmagada, por compressão "
                   "anterior ou captação apertada. Daí uma regra que "
                   "contraria o instinto: material assim NÃO deve ser "
                   "comprimido de novo, nem pelo 'Nivelar fala' forte nem por "
                   "compressor ao vivo, porque piora o que já está ruim. Na "
                   "cadeia que funcionou, o LRA terminou em 5,2 sem nova "
                   "compressão agressiva. Acima de 12 é o oposto: sussurro e "
                   "grito no mesmo clipe, e aí nivelar ajuda de verdade.",
        "na_pratica": "Confira o LRA no 'Analisar' antes de qualquer "
                      "compressor: abaixo de 5, deixe 'Nivelar fala' "
                      "desmarcado; acima de 12, ligue o nivelamento ou mande "
                      "para a nuvem com o leveler.",
        "secao": "diagnostico",
        "relacionado": ["loudness", "speechnorm", "compressor", "leveler"],
    },
    "correlacao_canais": {
        "titulo": "Os dois canais são iguais? (correlação estéreo)",
        "resumo": "Mede se esquerdo e direito carregam o mesmo som; perto de "
                  "1 é mono duplicado, e tratar como mono fica mais rápido e "
                  "seguro.",
        "detalhe": "A entrevista Julia + Virshna deu 0,99935: os dois canais "
                   "são cópias, e somar em mono não perde nada. Isso importa "
                   "porque o modelo de limpeza é mono: processar um par "
                   "idêntico gasta máquina dobrada à toa, e processar canais "
                   "DIFERENTES juntos borra as duas vozes. Abaixo de 0,95 o "
                   "programa considera duas fontes distintas e trata cada "
                   "canal separado, caminho seguro porém mais caro (cerca de "
                   "2,6x mais CPU). Sem medida possível, o programa assume o "
                   "pior caso e separa.",
        "na_pratica": "Deixe o programa decidir após o 'Analisar': "
                      "correlação perto de 1, como nesta entrevista, libera o "
                      "caminho rápido em mono; abaixo de 0,95 ele separa os "
                      "canais sozinho, e forçar o contrário estraga a voz.",
        "secao": "diagnostico",
        "relacionado": ["denoise_ia", "piso_ruido", "cache_cadeia"],
    },
    "momentos_estouro": {
        "titulo": "Momentos de estouro",
        "resumo": "A lista dos segundos exatos em que o pico passou do teto, "
                  "para saltar direto ao problema e ouvir com os próprios "
                  "ouvidos.",
        "detalhe": "Na janela de 90 s analisada da entrevista foram 36 "
                   "momentos de estouro (picos vizinhos a menos de meio "
                   "segundo viram um item só). Cada momento traz tipo, "
                   "início, fim e o pico alcançado; estourou de verdade "
                   "(acima de 0) aparece como grave, quase-estouro como "
                   "atenção. Serve para calibrar a decisão: às vezes o "
                   "problema é um objeto batendo em um único ponto, e não "
                   "vale renderizar o clipe inteiro por isso.",
        "na_pratica": "Clique num momento da lista para o playhead saltar ao "
                      "segundo exato, ouça dois ou três casos e só então "
                      "escolha o preset; estouro pontual pode pedir corte de "
                      "edição, não tratamento.",
        "secao": "diagnostico",
        "relacionado": ["pico_real", "previa_15s", "resgate_estourado"],
    },
    # ------------------------------------------------------------------
    # AO VIVO (Tipo A: WebAudio, custo zero, reversivel, nao gera arquivo)
    # ------------------------------------------------------------------
    "hpf": {
        "titulo": "Corte de graves (HPF)",
        "resumo": "Remove o grave que ninguém quer: mesa vibrando, vento, "
                  "manuseio do microfone; a voz fica mais limpa sem mudar de "
                  "timbre.",
        "detalhe": "Funciona ao vivo no navegador sobre o próprio player: "
                   "custo zero, resposta imediata e reversível a qualquer "
                   "momento. O padrão da casa é 80 Hz, porque abaixo disso "
                   "está o tranco de mesa, o vento do exterior e o boom de "
                   "proximidade, não a voz humana. Em documentário de rua "
                   "esse corte costuma ser o primeiro ganho de clareza, antes "
                   "de qualquer limpeza renderizada. Exagerar emagrece a voz: "
                   "cada clipe pede um valor.",
        "na_pratica": "Abra o painel Ao vivo, comece o corte em 80 Hz e suba "
                      "aos poucos ouvindo a fala; pare no exato instante em "
                      "que a voz começar a ficar fina.",
        "secao": "aovivo",
        "relacionado": ["eq_bandas", "ambiencia_preservada", "voz_limpa"],
    },
    "eq_bandas": {
        "titulo": "Equalizador de 3 bandas",
        "resumo": "Três ajustes finos: graves, médios e agudos; servem para "
                  "dar corpo ou brilho à voz sem renderizar nada.",
        "detalhe": "Roda ao vivo via WebAudio junto do corte de graves. Para "
                   "entrevista, mexa pouco: os médios controlam o corpo da "
                   "fala, os agudos dão inteligibilidade, e graves só "
                   "sobram depois do HPF ter feito o serviço pesado. É "
                   "ajuste de gosto por clipe, não conserta ruído nem "
                   "volume; essas tarefas são do diagnóstico e do "
                   "tratamento renderizado. Como tudo ao vivo, tem bypass e "
                   "reset no padrão dos demais efeitos do painel.",
        "na_pratica": "Ajuste banda a banda durante a reprodução e use o "
                      "bypass para comparar; mudança que você não percebe em "
                      "10 segundos de escuta não vale manter.",
        "secao": "aovivo",
        "relacionado": ["hpf", "autoeq", "compressor"],
    },
    "gate": {
        "titulo": "Portão de ruído (gate)",
        "resumo": "Silencia o áudio quando a fala para, cortando o fundo nos "
                  "intervalos; útil quando o ruído incomoda entre as frases.",
        "detalhe": "O padrão abre em -45 dB: abaixo disso, o portão fecha. "
                   "Custo zero e resposta imediata, porque roda ao vivo. O "
                   "limite é conhecido: portão mal regulado engole o começo "
                   "das palavras e as respirações, deixando a fala robótica; "
                   "e em ambiência importante (rua, feira) o silêncio "
                   "artificial entre falas denuncia o corte. Para fundo "
                   "constante e baixo, a limpeza do tratamento costuma ficar "
                   "melhor que o portão.",
        "na_pratica": "Comece em -45 dB e suba devagar até o fundo sumir; se "
                      "a primeira sílaba das frases engolir, volte um pouco, "
                      "ou troque o portão pela limpeza do tratamento.",
        "secao": "aovivo",
        "relacionado": ["compressor", "piso_ruido", "atenuacao"],
    },
    "compressor": {
        "titulo": "Compressor (ao vivo)",
        "resumo": "Achata a diferença entre as partes fortes e fracas da "
                  "fala em tempo real; deixa tudo audível sem tocar no "
                  "volume geral.",
        "detalhe": "Implementação WebAudio com padrões de projeto (razão 2:1, "
                   "limiar -18 dB): instantânea, reversível, custo zero. Mas "
                   "depende do diagnóstico: na entrevista Julia + Virshna a "
                   "variação de volume já estava esmagada (LRA 4,5), e "
                   "comprimir de novo piora, deixa a fala morta. Compressor é "
                   "para material com variação ampla demais, onde o "
                   "entrevistado alterna sussurro e empolgação, não para "
                   "tudo.",
        "na_pratica": "Confira o LRA no 'Analisar' antes: acima de 12, "
                      "comprimir ao vivo ajuda; abaixo de 5, deixe o "
                      "compressor desligado e resolva pelo nivelamento do "
                      "tratamento.",
        "secao": "aovivo",
        "relacionado": ["dinamica_lra", "makeup", "speechnorm"],
    },
    "makeup": {
        "titulo": "Ganho de saída (makeup)",
        "resumo": "O volume extra que se soma depois do compressor ou do "
                  "portão, para compensar o que eles baixaram.",
        "detalhe": "Compressão e portão tendem a deixar o clipe mais quieto; "
                   "o makeup devolve o nível sem desfazer os ajustes. Ao "
                   "vivo e gratuito, como o resto da seção. Cuidado com a "
                   "armadilha clássica: subir o makeup até o pico estourar de "
                   "novo recria exatamente o problema que o diagnóstico "
                   "acusou (o pico real de +1,7 dBTP desta entrevista foi "
                   "medido antes dele). Se a reposição precisa ser grande, o "
                   "problema é outro: falta normalização de volume no "
                   "tratamento.",
        "na_pratica": "Suba o makeup ouvindo os trechos MAIS FORTES do clipe, "
                      "não os fracos; se o pico voltar a distorcer, zere e "
                      "resolva o volume com o preset 'Só entrega'.",
        "secao": "aovivo",
        "relacionado": ["compressor", "loudness", "so_entrega"],
    },
    # ------------------------------------------------------------------
    # TRATAMENTO (Tipo B: renderiza arquivo; o original nunca e tocado)
    # ------------------------------------------------------------------
    "adeclip": {
        "titulo": "Reparo de clipping (adeclip)",
        "resumo": "Reconstrói a onda achatada pelo estouro em vez de só "
                  "disfarçá-la; primeiro passo de qualquer resgate.",
        "detalhe": "Filtro do ffmpeg, praticamente instantâneo (nesta máquina "
                   "os filtros correm a 31x a 44x o tempo real). Regra de "
                   "ordem da casa: reparo SEMPRE antes da limpeza, porque "
                   "denoise sobre onda quebrada não tem do que gostar. Na "
                   "cadeia medida no plano (reparo + limpeza de 12 dB + "
                   "nivelamento + volume), as amostras estouradas caíram para "
                   "praticamente uma e o pico real saiu de +1,7 dBTP para "
                   "-3,0 dBTP no resultado final. Não faz milagre em trecho "
                   "totalmente destruído: reconstrói o contorno, não a cena "
                   "perdida.",
        "na_pratica": "Deixe marcado no preset 'Resgate de captação "
                      "estourada'; a ordem da cadeia é fixada pelo programa, "
                      "não reorganize, e confirme no bloco Resultado se o "
                      "pico caiu abaixo do teto de -1,5 dBTP.",
        "secao": "tratamento",
        "relacionado": ["clipping", "adeclick", "alimiter",
                        "resgate_estourado"],
    },
    "adeclick": {
        "titulo": "Reparo de clicks (adeclick)",
        "resumo": "Tira estalos e cliques curtos: cabo encostando, corte "
                  "brusco de edição, sujeira elétrica.",
        "detalhe": "Viaja junto do adeclip no reparo inicial, também "
                   "instantâneo no ffmpeg. Em captação de campo os estouros "
                   "impulsivos costumam acompanhar o clipping (o mesmo "
                   "incidente que achata a onda faz estalar), por isso os "
                   "dois vão juntos no preset de resgate. Sozinho resolve o "
                   "caso comum do clipe que só tem um clique de edição no "
                   "meio da frase. Não confunde com zumbido elétrico "
                   "contínuo, que é outro problema e mora na nuvem.",
        "na_pratica": "Mantenha marcado junto com o reparo de clipping; ouviu "
                      "um único estalo pontual? Este passo sozinho costuma "
                      "resolver, sem cadeia completa.",
        "secao": "tratamento",
        "relacionado": ["adeclip", "dehum", "resgate_estourado"],
    },
    "deesser": {
        "titulo": "De-esser (domador de SSS)",
        "resumo": "Suaviza os S e CH assobiados da fala, aquele sibilo que "
                  "machuca o ouvido de fone.",
        "detalhe": "Filtro pronto do ffmpeg, entra na cadeia renderizada sem "
                   "custo perceptível. Importa DEPOIS do nivelamento: levantar "
                   "fala baixa costuma levantar junto os sibilantes, e aí o "
                   "de-esser entra como acabamento. Na entrevista Julia + "
                   "Virshna não era o problema central (estouro e ruído "
                   "eram), então não está no preset de resgate; fica "
                   "disponível para vozes que assobiam naturalmente. "
                   "Exagerado, deixa os S surdos e a fala artificial.",
        "na_pratica": "Marque o de-esser na cadeia quando a voz assobiar "
                      "DEPOIS de aplicar o tratamento; compare no A/B tratado "
                      "contra original e desligue se a fala perder "
                      "naturalidade.",
        "secao": "tratamento",
        "relacionado": ["eq_bandas", "speechnorm", "resgate_estourado"],
    },
    "afftdn": {
        "titulo": "Limpeza clássica de ruído (afftdn)",
        "resumo": "Redutor de ruído tradicional do ffmpeg, rápido e sem IA; "
                  "o motor dos quatro presets clássicos da casa.",
        "detalhe": "Ataca ruído de espectro estável (chiado, ventilador "
                   "constante) reduzindo cerca de 12 dB por padrão. Segue no "
                   "comando do 'Resgate de captação estourada' DE PROPÓSITO "
                   "mesmo com a IA funcionando nesta máquina: os quatro "
                   "presets antigos não mudaram para o custo nunca subir em "
                   "silêncio, e quem quer limpeza por rede neural escolhe "
                   "'Resgate com IA' ou 'Voz limpa com IA' pelo nome. É menos "
                   "transparente que a IA: em fundos complexos pode deixar "
                   "aquele efeito subaquático. Compensa pela velocidade, 31x "
                   "a 44x o tempo real, então usar não custa quase nada em "
                   "espera.",
        "na_pratica": "Aceite o afftdn do preset clássico como padrão e "
                      "julgue sempre pelo 'Prever 15 s': artefato "
                      "subaquático ou metálico na prévia é o sinal de trocar "
                      "para um preset de IA.",
        "secao": "tratamento",
        "relacionado": ["anlmdn", "denoise_ia", "atenuacao", "previa_15s"],
    },
    "anlmdn": {
        "titulo": "Limpeza clássica alternativa (anlmdn)",
        "resumo": "Outro redutor de ruído do ffmpeg, com técnica diferente "
                  "(compara trechos parecidos do clipe); bom para chiado "
                  "uniforme.",
        "detalhe": "Non-Local Means: procura padrões de ruído repetidos no "
                   "clipe inteiro em vez de só olhar o espectro no instante. "
                   "Tende a preservar melhor a textura em chiados "
                   "homogêneos, ao custo de ser o mais pesado dos filtros "
                   "clássicos, ainda assim longe do denoise por IA em custo. "
                   "Existe porque nenhum redutor único vence em todo "
                   "material: o teste profissional citado no plano comparou "
                   "oito ferramentas caras e nenhuma venceu nos quatro "
                   "cenários. Ter duas vias clássicas é plano B barato.",
        "na_pratica": "Troque a limpeza clássica para anlmdn quando o afftdn "
                      "deixar artefato metálico na prévia, compare de novo "
                      "com 'Prever 15 s' e mantenha o que preserva melhor a "
                      "voz.",
        "secao": "tratamento",
        "relacionado": ["afftdn", "denoise_ia", "previa_15s"],
    },
    "speechnorm": {
        "titulo": "Nivelar fala (speechnorm)",
        "resumo": "Levanta a fala e iguala os níveis dentro dela, "
                  "aproveitando que o conteúdo é voz; instantâneo no ffmpeg.",
        "detalhe": "É o nivelamento da cadeia local, com freio embutido pela "
                   "regra da casa: com LRA abaixo de 5 o material já vem "
                   "esmagado e o nivelamento forte fica bloqueado, porque "
                   "comprimir de novo só piora (era o caso da entrevista: LRA "
                   "4,5). Na cadeia completa medida no plano ele participou e "
                   "a variação terminou em 5,2, dentro da faixa saudável. "
                   "Para dinâmica ampla (acima de 12) é o remédio certo antes "
                   "da normalização final de volume.",
        "na_pratica": "Marque 'Nivelar fala' quando o LRA do diagnóstico "
                      "passar de 12; com LRA abaixo de 5, respeite o bloqueio "
                      "do programa e resolva só o volume com o loudnorm.",
        "secao": "tratamento",
        "relacionado": ["dinamica_lra", "compressor", "leveler", "loudnorm"],
    },
    "loudnorm": {
        "titulo": "Normalizar volume (loudnorm)",
        "resumo": "Coloca o volume médio do clipe exatamente no alvo do "
                  "projeto (-16 LUFS) respeitando o teto de pico; etapa final "
                  "de praticamente toda cadeia.",
        "detalhe": "Neste programa ele SEMPRE roda em duas passagens: a "
                   "primeira mede, a segunda aplica com base na medição. Uma "
                   "passagem só parece economizar tempo, mas na medição real "
                   "errou cerca de 0,7 LU, o suficiente para sair da "
                   "especificação de entrega. As duas passagens continuam "
                   "rápidas porque o ffmpeg corre a 31x a 44x o tempo real. "
                   "O alvo -16 LUFS e o teto -1,5 dBTP vêm das configurações "
                   "do projeto, não de chute.",
        "na_pratica": "Deixe sempre ligado no fim da cadeia (os presets já o "
                      "trazem); não tente 'economizar' a segunda passagem, e "
                      "confira o volume final no bloco Resultado contra "
                      "-16,0 LUFS.",
        "secao": "tratamento",
        "relacionado": ["loudness", "alimiter", "so_entrega",
                        "resgate_estourado"],
    },
    "alimiter": {
        "titulo": "Teto de pico (alimiter)",
        "resumo": "Guardião final da cadeia: garante que nenhum instante "
                  "passe do teto (-1,5 dBTP), por mais que o resto tenha "
                  "mexido no som.",
        "detalhe": "É sempre o último passo. Detalhe de implementação que "
                   "importa: aqui o reforço automático de volume do "
                   "limitador fica desativado, então ele só SEGURA os picos "
                   "acima do teto em vez de empurrar o áudio todo para cima, "
                   "o que desfaria a folga conquistada. É a garantia de que o "
                   "arquivo entregue não volta a estourar depois do "
                   "tratamento. No caso real, o pico final ficou em -3,0 "
                   "dBTP, folga confortável abaixo do teto.",
        "na_pratica": "Deixe ligado nos presets de entrega e resgate; se um "
                      "resultado final mostrar pico acima do teto no bloco "
                      "Resultado, é defeito a reportar, não coisa de "
                      "compensar na mão com makeup.",
        "secao": "tratamento",
        "relacionado": ["pico_real", "loudnorm", "adeclip", "so_entrega"],
    },
    "denoise_ia": {
        "titulo": "Limpeza de ruído por IA (DPDFNet)",
        "resumo": "Redução de ruído por rede neural rodando no seu "
                  "computador, sem nuvem: a limpeza mais transparente da "
                  "casa, porém a mais cara em tempo.",
        "detalhe": "O modelo (DPDFNet, saída em 48 kHz) preserva a ambiência "
                   "melhor que os filtros clássicos e é o coração do resgate "
                   "de captação ruim. O custo é real: roda a cerca de 0,7x o "
                   "tempo do áudio, uns 15 minutos de máquina para uma "
                   "entrevista de 22 minutos, contra segundos dos filtros "
                   "ffmpeg, cerca de 45 vezes mais rápido que a rede neural. "
                   "Estado desta máquina: sherpa-onnx e o modelo estão "
                   "instalados, o motor responde disponível e DOIS presets "
                   "já passam por ele ('Resgate com IA' e 'Voz limpa com "
                   "IA'). Os outros quatro seguem no filtro clássico DE "
                   "PROPÓSITO, decisão do dono para o custo nunca subir em "
                   "silêncio. Quando o motor falta, o "
                   "programa avisa a indisponibilidade em vez de fingir que "
                   "tratou. Há também o GTCRN, mais rápido, mas que sai "
                   "em 16 kHz: só serve para prévia, nunca para entrega.",
        "na_pratica": "Confira a disponibilidade do motor no painel antes de "
                      "prometer prazo; disponível, escolha entre 'Resgate "
                      "com IA' e 'Voz limpa com IA' depois do 'Prever 15 "
                      "s'; indisponível, fique nos presets clássicos.",
        "secao": "tratamento",
        "relacionado": ["piso_ruido", "atenuacao", "afftdn", "resgate_ia",
                        "voz_limpa_ia", "previa_rapida"],
    },
    "atenuacao": {
        "titulo": "Força da limpeza (atenuação em dB)",
        "resumo": "Quantos decibéis de ruído a limpeza vai tirar; o programa "
                  "calcula a partir do piso de ruído e prende o valor entre "
                  "6 e 18 dB.",
        "detalhe": "A fórmula em produção, clamp(piso - (-45), 6, 18), é "
                   "honesta nos dois sentidos: o piso de -26,9 dB da "
                   "entrevista pediu os 18 dB máximos, e o controle obedece "
                   "ao que você pede (pedidos 12 dB, entregues cerca de "
                   "11,7). O modo 'sem limite' existe e é explicitamente "
                   "avisado: leva o piso a silêncio digital absoluto entre as "
                   "falas e DESTRÓI a ambiência, o que arruína documentário "
                   "onde o ambiente é conteúdo. Por isso o padrão é limitado "
                   "e o modo extremo fica atrás de aviso próprio. A mesma "
                   "régua guia os presets de IA: 'Resgate com IA' nasce nos "
                   "18 dB do teto porque o piso de -26,9 dB da entrevista "
                   "pede o máximo, e 'Voz limpa com IA' fica nos 6 dB da "
                   "limpeza leve.",
        "na_pratica": "Use a atenuação sugerida pela análise; no máximo suba "
                      "até 18 dB manualmente, e deixe o 'sem limite' só para "
                      "sala insuportável, sabendo que a rua some junto.",
        "secao": "tratamento",
        "relacionado": ["piso_ruido", "denoise_ia", "ambiencia_preservada",
                        "denoisemethod"],
    },
    "previa_15s": {
        "titulo": "Prever 15 s",
        "resumo": "Processa só 15 segundos a partir do playhead para você "
                  "ouvir o resultado antes de comprometer minutos de render "
                  "no clipe inteiro.",
        "detalhe": "Existe por causa do custo do denoise por IA (cerca de "
                   "0,7x o tempo do áudio): decidir sem prévia significaria "
                   "esperar uns 15 minutos para descobrir que a atenuação "
                   "ficou forte demais numa entrevista de 22 minutos. Com os "
                   "filtros ffmpeg a prévia é questão de segundos (a máquina "
                   "corre a 31x a 44x o tempo real); com IA, 15 segundos "
                   "custam pouco mais de 10 segundos de espera. É o hábito "
                   "que separa uso profissional de aposta.",
        "na_pratica": "Faça do 'Prever 15 s' ritual obrigatório antes de "
                      "qualquer 'Aplicar' em clipe longo: posicione o "
                      "playhead num trecho representativo, com fala E com "
                      "pausa, e ouça antes de decidir.",
        "secao": "tratamento",
        "relacionado": ["denoise_ia", "cache_cadeia", "previa_rapida",
                        "atenuacao"],
    },
    "cache_cadeia": {
        "titulo": "Cache do tratamento",
        "resumo": "A mesma cadeia aplicada ao mesmo trecho reaproveita o "
                  "arquivo já renderizado em vez de processar tudo de novo.",
        "detalhe": "O programa identifica o tratamento por hash do clipe "
                   "mais intervalo mais cadeia, guarda o WAV em "
                   "data/audio_tratado e o clipe passa a APONTAR para ele; o "
                   "original nunca é tocado. Repetir o mesmo 'Aplicar' é "
                   "instantâneo. Consequência prática: para refazer de "
                   "verdade depois de mudar de ideia, mude um parâmetro da "
                   "cadeia (mais atenuação, outro alvo) ou descarte o "
                   "resultado, senão você só reabre o arquivo antigo. O A/B "
                   "do player compara tratado contra original usando esse "
                   "mesmo arquivo.",
        "na_pratica": "Mude um parâmetro de cada vez entre um render e outro "
                      "para testar variações; quer voltar atrás de vez? Use "
                      "'Descartar' no bloco Resultado, que mantém o original "
                      "intacto.",
        "secao": "tratamento",
        "relacionado": ["previa_15s", "adeclip", "loudnorm"],
    },
    # ------------------------------------------------------------------
    # NUVEM (Auphonic)
    # ------------------------------------------------------------------
    "auphonic": {
        "titulo": "Tratamento na nuvem (Auphonic)",
        "resumo": "Serviço online de acabamento de áudio integrado à casa; "
                  "traz o que não existe bem localmente, e gasta a cota "
                  "grátis de 2 horas por mês.",
        "detalhe": "O Auphonic é o único provedor integrado de propósito: faz "
                   "leveler, AutoEQ, recomposição de agudos, StudioVoice e "
                   "detector de zumbido, funções sem equivalente local "
                   "decente. O free tier renova 2 horas por mês, e cada envio "
                   "consome a duração do áudio enviado. Regra de segurança da "
                   "integração: envio NUNCA é repetido automaticamente, "
                   "porque um envio que falhou no caminho pode ter criado a "
                   "produção lá, e reenviar gastaria cota em dobro. A chave "
                   "fica nas configurações, campo 'Chave Auphonic'.",
        "na_pratica": "Reserve a nuvem para as peças finais e para os clipes "
                      "resistentes ao tratamento local; antes de enviar, "
                      "confira quanto resta de cota no painel, e erro de "
                      "envio pede conferência no site antes de reenviar.",
        "secao": "nuvem",
        "relacionado": ["cota", "leveler", "autoeq", "studiovoice",
                        "denoisemethod"],
    },
    "leveler": {
        "titulo": "Nivelador (leveler)",
        "resumo": "O equalizador de volume do Auphonic: ergue os trechos "
                  "baixos e segura os altos, com força escolhida em degraus.",
        "detalhe": "O programa já dosa sozinho: força proporcional à variação "
                   "medida (LRA), e com LRA abaixo de 5 ele DESLIGA o "
                   "leveler, porque material esmagado não aceita nova "
                   "compressão (era o caso da entrevista, LRA 4,5). Os "
                   "valores aceitos são degraus discretos do serviço (0 a "
                   "120, de 10 em 10), não números livres; valor fora da "
                   "grade é recusado antes do envio, pois produção recusada "
                   "gasta cota do mesmo jeito. Força alta demais apaga a "
                   "expressão natural da fala.",
        "na_pratica": "Deixe o automático; se sobrescrever na tela de "
                      "ajustes manuais, escolha um valor da grade "
                      "apresentada, e não ligue leveler quando o LRA do "
                      "diagnóstico já estiver abaixo de 5.",
        "secao": "nuvem",
        "relacionado": ["auphonic", "dinamica_lra", "speechnorm", "cota"],
    },
    "autoeq": {
        "titulo": "AutoEQ (voz equilibrada)",
        "resumo": "Acabamento de timbre do Auphonic que equilibra a voz "
                  "gravada em campo, aproximando-a de uma gravação de "
                  "estúdio.",
        "detalhe": "É o filtro padrão para material de entrevista na "
                   "integração, junto do método de limpeza 'static'. Detalhe "
                   "que já deu defeito e foi corrigido: o filtro só age com o "
                   "'Realce de voz' ligado, então a integração agora envia os "
                   "dois juntos; antes, o tipo de filtro ia inerte. Não "
                   "conserta ruído nem volume, só timbre; por isso não "
                   "substitui a cadeia local, complementa na peça final. "
                   "Alternativas do mesmo seletor: recomposição de agudos "
                   "(bwe), som de estúdio e corte simples de graves.",
        "na_pratica": "Mantenha o AutoEQ como padrão das peças finais "
                      "enviadas à nuvem; troque para BWE só em material de "
                      "arquivo sem agudos, pelo ajuste manual do clipe.",
        "secao": "nuvem",
        "relacionado": ["bwe", "studiovoice", "eq_bandas", "auphonic"],
    },
    "bwe": {
        "titulo": "Recompor agudos (BWE)",
        "resumo": "Reconstrói os agudos que a gravação nunca captou: fita "
                  "antiga, telefone ou arquivo de baixa qualidade.",
        "detalhe": "Bandwidth extension: o serviço estima o brilho que "
                   "deveria existir acima do que o material tem. Útil no "
                   "documentário quando entra material de acervo, telefônico "
                   "ou VHS, que soa abafado e destoa do resto da peça. Não é "
                   "mágica: inventa um agudo PLAUSÍVEL a partir do padrão da "
                   "voz, e em música pode colorir errado. Para entrevista "
                   "normal de campo os agudos já existem e o certo é AutoEQ, "
                   "não BWE.",
        "na_pratica": "Escolha BWE só quando o clipe for material antigo ou "
                      "abafado de verdade; ouvido o resultado, se soar "
                      "sintético, volte para AutoEQ.",
        "secao": "nuvem",
        "relacionado": ["autoeq", "studiovoice", "auphonic"],
    },
    "studiovoice": {
        "titulo": "Som de estúdio (StudioVoice)",
        "resumo": "Modo pesado de resgate do Auphonic: isola a voz e aplica "
                  "acabamento de estúdio; o fundo da cena desaparece.",
        "detalhe": "Pareado com o método de limpeza 'speech_isolation', é a "
                   "última cartada para captação tão ruim que a alternativa é "
                   "perder a cena. A integração liga os dois automaticamente "
                   "no resgate extremo detectado pelas medidas (pico "
                   "estourado, sala muito ruidosa, piso acima de -25 dB, e "
                   "clipping audível ao mesmo tempo). Custa a mesma cota de "
                   "nuvem, mas devolve material radicalmente diferente: voz "
                   "limpa sobre silêncio, sem ambiência. Em documentário isso "
                   "é decisão editorial, não técnica.",
        "na_pratica": "Use só em resgate extremo e consciente: se a "
                      "ambiência da cena importa, fique no tratamento local; "
                      "se a fala é insubstituível, mande para a nuvem com "
                      "StudioVoice e assuma a perda do fundo.",
        "secao": "nuvem",
        "relacionado": ["denoisemethod", "auphonic", "resgate_estourado",
                        "cota"],
    },
    "denoisemethod": {
        "titulo": "Jeito de limpar da nuvem (método de denoise)",
        "resumo": "Como o Auphonic remove o ruído: preservando música e "
                  "ambiência, seguindo um ruído que muda, ou isolando só a "
                  "voz.",
        "detalhe": "'static' é o padrão da casa em documentário: remove "
                   "chiado e ventilador MANTENDO música e ambiência, "
                   "exatamente a função que a limpeza local por IA não tem, "
                   "e o motivo principal de valer a pena levar as peças "
                   "finais à nuvem. 'dynamic' segue ruídos que variam "
                   "(tráfego, plateia). 'speech_isolation' deixa somente a "
                   "voz, para resgates desesperados, e mata o resto. A "
                   "escolha muda o caráter da cena tanto quanto qualquer "
                   "efeito de vídeo.",
        "na_pratica": "Prefira 'static' nas peças finais; ruído que muda de "
                      "intensidade pede 'dynamic'; isole a voz só quando a "
                      "cena já estiver perdida sem isso.",
        "secao": "nuvem",
        "relacionado": ["atenuacao", "ambiencia_preservada", "studiovoice",
                        "auphonic"],
    },
    "dehum": {
        "titulo": "Zumbido da rede elétrica (dehum)",
        "resumo": "Remove o tom grave constante que luzes e tomadas pescam "
                  "na gravação, o bordão elétrico de 50 ou 60 Hz.",
        "detalhe": "A detecção LOCAL desse zumbido foi tentada e reprovada "
                   "nesta casa: o filtro não separava 60 de 65 Hz, o ganho "
                   "medido ficou irrisório e havia falso positivo até no "
                   "arquivo limpo. Por isso a integração deixa o detector do "
                   "Auphonic decidir, em modo Automático, com força também "
                   "automática. Se você ouve um tom elétrico constante por "
                   "baixo da fala (luminária, refrigerador, gerador), é este "
                   "o remédio; estalos e cliques são assunto do adeclick.",
        "na_pratica": "Ouviu zumbido elétrico constante? Leve o clipe para a "
                      "nuvem deixando o dehum em Automático; não tente tirar "
                      "com equalizador local, o detector da nuvem é mais "
                      "preciso.",
        "secao": "nuvem",
        "relacionado": ["auphonic", "piso_ruido", "adeclick", "cota"],
    },
    "cota": {
        "titulo": "Cota grátis do Auphonic (2 h/mês)",
        "resumo": "Todo mês você tem 2 horas gratuitas de processamento na "
                  "nuvem; cada envio consome a duração do áudio enviado.",
        "detalhe": "O consumo fica registrado localmente (data/audio_cloud/) "
                   "e o painel mostra quanto resta, avisando perto dos 80%. "
                   "Estourou, o programa bloqueia o envio ANTES de falar com "
                   "a rede. Duas pegadinhas cobertas pela integração: "
                   "produção recusada por parâmetro inválido gasta o envio "
                   "do mesmo jeito (por isso os valores são validados aqui, "
                   "contra a grade oficial do serviço), e envio que falhou no "
                   "caminho pode ter criado a produção lá, então confira o "
                   "site antes de reenviar.",
        "na_pratica": "Olhe a cota no painel antes de mandar qualquer clipe e "
                      "priorize: gaste as 2 horas nas peças finais, não em "
                      "testes; para experimentar, use o 'Prever 15 s' local.",
        "secao": "nuvem",
        "relacionado": ["auphonic", "previa_15s", "leveler"],
    },
    # ------------------------------------------------------------------
    # PRESETS (moram no painel de Tratamento; grupo proprio na cobertura)
    # ------------------------------------------------------------------
    "voz_limpa": {
        "titulo": "Preset: Voz limpa",
        "resumo": "A receita da entrevista bem captada: corte de graves ao "
                  "vivo, limpeza leve de 6 dB e volume no alvo; hoje "
                  "realizada pelo preset 'Voz limpa com IA'.",
        "detalhe": "No plano era 'HPF 80 + denoise 6 dB + loudnorm'. A parte "
                   "renderizada dessa receita agora existe de verdade: o "
                   "preset 'Voz limpa com IA' executa a limpeza leve de 6 dB "
                   "por rede neural mais o volume no alvo, e o corte de "
                   "graves segue ao vivo no painel Ao vivo, onde é "
                   "reversível. Quem não pode pagar os minutos da IA tem o "
                   "caminho antigo intacto: HPF ao vivo mais 'Ambiência "
                   "preservada', que faz limpeza leve e volume com filtros "
                   "clássicos em segundos. As duas portas levam ao mesmo "
                   "lugar; a diferença é transparência da limpeza contra os "
                   "15 minutos de máquina numa entrevista de 22.",
        "na_pratica": "Comece pelo corte de graves em 80 Hz ao vivo; se o "
                      "chiado resistir, aplique 'Voz limpa com IA' depois do "
                      "'Prever 15 s', senão fique em 'Ambiência "
                      "preservada'.",
        "secao": "tratamento",
        "relacionado": ["hpf", "voz_limpa_ia", "ambiencia_preservada",
                        "denoise_ia"],
    },
    "resgate_estourado": {
        "titulo": "Preset: Resgate de captação estourada",
        "resumo": "O socorro completo para áudio distorcido e sujo: repara, "
                  "limpa e entrega no alvo; é o caso real da entrevista "
                  "Julia + Virshna.",
        "detalhe": "Cadeia: reparo de clipping e clicks, limpeza de 12 a 18 "
                   "dB pelo filtro clássico afftdn, DE PROPÓSITO mesmo com a "
                   "IA instalada: os quatro presets antigos não mudaram para "
                   "o custo nunca subir em silêncio; a versão cara e mais "
                   "transparente é o 'Resgate com IA'), volume no alvo e "
                   "teto no fim. Sem "
                   "nivelamento forte DE PROPÓSITO, porque a variação da "
                   "entrevista já estava esmagada (LRA 4,5). Resultado "
                   "medido na janela real: de -7,4 LUFS, pico +1,7 dBTP e "
                   "piso -26,9 dB para -16,0 LUFS, -3,0 dBTP e piso -36,4 "
                   "dB. Ele não devolve a cena original: devolve uma cena "
                   "utilizável.",
        "na_pratica": "Veja pico acima de 0 dBTP no diagnóstico? Aplique "
                      "este preset, confirme com 'Prever 15 s' e julgue no "
                      "A/B; espere chegar perto de -16,0 LUFS e -3,0 dBTP no "
                      "bloco Resultado.",
        "secao": "tratamento",
        "relacionado": ["clipping", "pico_real", "adeclip", "loudnorm",
                        "alimiter", "atenuacao"],
    },
    "ambiencia_preservada": {
        "titulo": "Preset: Ambiência preservada",
        "resumo": "Para som de rua, feira e direto: limpeza leve de 6 dB e "
                  "volume no alvo, sem nivelamento e sem limitador, para o "
                  "fundo continuar vivo.",
        "detalhe": "Quando o ambiente É conteúdo (plano rua, feira, reação de "
                   "plateia), limpeza forte e limitador matam a história. "
                   "Aqui só entram a limpeza leve fixa de 6 dB e a "
                   "normalização de volume, que permanece porque áudio sem "
                   "alvo volta fora da especificação de entrega. 'Sem "
                   "limite' jamais: piso em silêncio digital transformaria a "
                   "feira em estúdio morto. Na nuvem, o equivalente é o "
                   "método de limpeza 'static', feito justamente para "
                   "preservar música e ambiente.",
        "na_pratica": "Use este preset em som direto com ambiência "
                      "importante e NÃO marque atenuação sem limite; se for "
                      "enviar à nuvem, mantenha o método de limpeza em "
                      "'static'.",
        "secao": "tratamento",
        "relacionado": ["atenuacao", "denoisemethod", "piso_ruido",
                        "voz_limpa"],
    },
    "so_entrega": {
        "titulo": "Preset: Só entrega",
        "resumo": "Áudio já bom, só fora da especificação: normaliza o "
                  "volume para -16 LUFS com teto de pico e não toca em mais "
                  "nada.",
        "detalhe": "Duas peças apenas: loudnorm de duas passagens e "
                   "limitador. Nenhum timbre, nenhum ruído, nenhum "
                   "nivelamento mexido. É o preset mais rápido da casa, "
                   "porque roda só filtros ffmpeg a 31x a 44x o tempo real: "
                   "um clipe inteiro de entrevista em segundos. Serve para o "
                   "material captado certo de primeira, ou como etapa final "
                   "garantida quando o tratamento pesado já aconteceu em "
                   "outro fluxo (local ou nuvem).",
        "na_pratica": "Aplique 'Só entrega' direto quando o diagnóstico "
                      "acusar apenas loudness fora do alvo (mais de 1 LU de "
                      "diferença) e nada grave: em segundos o clipe está na "
                      "especificação.",
        "secao": "tratamento",
        "relacionado": ["loudnorm", "alimiter", "loudness", "voz_limpa",
                        "previa_rapida"],
    },
    "previa_rapida": {
        "titulo": "Preset: Prévia rápida",
        "resumo": "O jeito mais veloz de ouvir como o clipe ficará, sem "
                  "esperar render longo; hoje executa só a normalização de "
                  "volume.",
        "detalhe": "No plano ele seria GTCRN (IA rápida) mais loudnorm; o "
                   "GTCRN segue sem preset que o invoque, então hoje executa "
                   "só a normalização, que corre a 31x-44x o tempo real. Os "
                   "dois presets de IA que existem ('Resgate com IA' e 'Voz "
                   "limpa com IA') usam o DPDFNet de entrega, cujos 11 "
                   "minutos por entrevista de 22 são o oposto de prévia. O "
                   "aviso fica de pé: o GTCRN sai em 16 kHz, qualidade de "
                   "prévia, NUNCA entregue o resultado dele como arquivo "
                   "final. Para julgar limpeza com fidelidade total, use "
                   "'Prever 15 s' com a cadeia completa.",
        "na_pratica": "Quer sensação imediata do resultado no clipe inteiro? "
                      "Rode este preset; para decidir limpeza de verdade, "
                      "use 'Prever 15 s' com a cadeia completa, e nunca "
                      "entregue a prévia como final.",
        "secao": "tratamento",
        "relacionado": ["previa_15s", "denoise_ia", "so_entrega"],
    },
    "resgate_ia": {
        "titulo": "Preset: Resgate com IA",
        "resumo": "O socorro completo do resgate com a limpeza feita por "
                  "rede neural em vez do filtro clássico; resultado mais "
                  "transparente, espera muito maior.",
        "detalhe": "Cadeia: reparo de clipping e clicks, limpeza por IA com "
                   "18 dB (o teto da regra clamp(piso - (-45), 6, 18): o "
                   "piso de -26,9 dB da entrevista Julia + Virshna pede o "
                   "máximo), volume no alvo e teto no fim; sem nivelamento "
                   "forte porque o LRA 4,5 já vem esmagado. O ponto que "
                   "decide é o CUSTO: os filtros clássicos correm a 31x a "
                   "44x o tempo real e a entrevista de 22 minutos sai em "
                   "cerca de 30 segundos, enquanto a IA corre a cerca de "
                   "0,7x o tempo do áudio, uns 15 minutos de máquina para os "
                   "mesmos 22 minutos, cerca de 45 vezes mais lento. Vale "
                   "quando o chiado ou o ar-condicionado incomodam de "
                   "verdade e o filtro clássico deixou artefato na prévia; "
                   "no resto, o 'Resgate de captação estourada' chega perto "
                   "em segundos.",
        "na_pratica": "Use o 'Prever 15 s' nos dois caminhos antes de "
                      "decidir: se a limpeza clássica já agrada, aplique o "
                      "'Resgate de captação estourada' e poupe os 11 "
                      "minutos; se ela deixar artefato, aplique este preset "
                      "e assuma a espera de propósito.",
        "secao": "tratamento",
        "relacionado": ["resgate_estourado", "denoise_ia", "adeclip",
                        "loudnorm", "alimiter", "previa_15s"],
    },
    "voz_limpa_ia": {
        "titulo": "Preset: Voz limpa com IA",
        "resumo": "Para entrevista já bem captada em que só o chiado "
                  "incomoda: limpeza leve de 6 dB por rede neural e volume "
                  "no alvo, sem limitador e sem compressão.",
        "detalhe": "É a receita completa do plano para captação boa: "
                   "limpeza leve de 6 dB (o mesmo valor do 'Ambiência "
                   "preservada') executada pela IA, mais a normalização de "
                   "volume; o corte de graves de 80 Hz segue morando ao vivo "
                   "no painel Ao vivo, onde é reversível. O cuidado é o "
                   "custo, e é ele que decide o uso: o passo de IA domina a "
                   "conta, cerca de 0,7x o tempo do áudio, uns 15 minutos "
                   "para uma entrevista de 22 minutos que os filtros "
                   "resolvem em torno de 30 segundos a 31x-44x tempo real, "
                   "perto de 45 vezes mais lento. Faz sentido quando o "
                   "chiado incomoda de verdade na cena final; se incomoda "
                   "pouco, 'Ambiência preservada' faz quase o mesmo em "
                   "segundos.",
        "na_pratica": "Comece pelo 'Prever 15 s' com a limpeza clássica "
                      "barata: o chiado sumiu e ninguém sente? Fique no "
                      "'Ambiência preservada'; o fundo ainda incomoda depois "
                      "de ouvido com calma? Aplique este preset e aceite os "
                      "15 minutos.",
        "secao": "tratamento",
        "relacionado": ["voz_limpa", "denoise_ia", "atenuacao",
                        "ambiencia_preservada", "previa_15s"],
    },
}


# ---------------------------------------------------------------------------
# Consultas (contrato N1)
# ---------------------------------------------------------------------------

def entrada(chave: str) -> dict | None:
    """Devolve uma COPIA da entrada do glossario; None se a chave nao existe.

    Copia (incluindo a lista de relacionados) para quem receber nao conseguir
    corromper o modulo por referencia. Chave nao-string tambem devolve None,
    sem excecao: a rota da UI e o chat consultam com texto do usuario.
    """
    if not isinstance(chave, str):
        return None
    item = GLOSSARIO.get(chave)
    if item is None:
        return None
    copia = dict(item)
    copia["relacionado"] = list(item["relacionado"])
    return copia


def por_secao(secao: str) -> dict:
    """Devolve {chave: copia} das entradas da secao, na ordem do glossario.

    Secao fora das quatro validas levanta ValueError com a lista valida: quem
    chama e codigo da casa (rota/UI/chat), e secao invalida ali e bug de
    programacao, nao dado de usuario.
    """
    if secao not in SECOES_VALIDAS:
        raise ValueError(
            f"Secao desconhecida: {secao!r}. Validas: {', '.join(SECOES_VALIDAS)}.")
    return {chave: entrada(chave) for chave in GLOSSARIO
            if GLOSSARIO[chave]["secao"] == secao}


def para_prompt() -> str:
    """Versao condensada para o prompt do chat (AGENTES M5/M6).

    Cabecalho com os numeros reais da casa + uma linha por entrada no formato
    "chave: resumo". Deterministica (mesma ordem sempre), menor que o
    glossario inteiro e sem caractere proibido de log cp1252.
    """
    linhas = [
        "GLOSSARIO DE AUDIO DA CASA (termos do painel; explique com estes "
        "nomes e aja pelos presets):",
        "Numeros reais de referencia (entrevista Julia + Virshna, janela "
        "6:45-8:15): alvo -16 LUFS, teto -1,5 dBTP; antes: -7,4 LUFS, pico "
        "+1,7 dBTP, piso -26,9 dB, LRA 4,5, 36 estouros em 90 s; depois do "
        "preset de resgate: -16,0 LUFS, -3,0 dBTP, piso -36,4 dB.",
        "Custos: filtros ffmpeg a 31x-44x o tempo real (entrevista de 22 "
        "min sai em cerca de 30 s); denoise IA instalada, a cerca de 0,7x o "
        "tempo do audio, uns 15 min nos mesmos 22 min, cerca de 45x mais "
        "lento; os presets resgate_ia e voz_limpa_ia passam pela IA, os "
        "quatro classicos ficam no ffmpeg de proposito; Auphonic gasta cota "
        "gratis de 2 h/mes; atenacao de limpeza presa entre 6 e 18 dB; "
        "loudnorm sempre em 2 passagens.",
    ]
    for secao in SECOES_VALIDAS:
        linhas.append(f"[{secao}]")
        for chave, item in por_secao(secao).items():
            linhas.append(f"{chave}: {item['resumo']}")
    return "\n".join(linhas)


# ---------------------------------------------------------------------------
# Guarda de texto limpo (log cp1252): falha NA IMPORTACAO se alguém
# introduzir seta unicode, travessao, simbolo matematico ou emoji.
# ---------------------------------------------------------------------------

_RE_CARACTERE_PROIBIDO = re.compile(
    "["
    "\u2190-\u21FF"            # setas (->, <= sao os permitidos)
    "\u2010-\u2015\u2043"      # tracos/travessoes nao-ascii
    "\u2022\u2023\u25AA\u25CF" # bullets decorativos
    "\u2248\u2260\u2264\u2265" # simbolos matematicos banidos em log
    "\u2600-\u27BF"            # simbolos diversos e dingbats (emoji antigo)
    "\uFE0F\u2B00-\u2BFF"      # variacao de emoji e setas de bloco
    "\U0001F000-\U0001FAFF"    # emoji propriamente dito
    "]"
)


def _verificar_texto_limpo() -> None:
    """Levantara ValueError apontando chave/campo/codigo do primeiro proibido."""
    alvos = []
    for chave, item in GLOSSARIO.items():
        for campo in ("titulo", "resumo", "detalhe", "na_pratica"):
            alvos.append((chave, campo, item[campo]))
    alvos.append(("?", "para_prompt", para_prompt()))
    for chave, campo, texto in alvos:
        achou = _RE_CARACTERE_PROIBIDO.search(texto)
        if achou:
            raise ValueError(
                f"Glossario com caractere proibido de log cp1252 em "
                f"'{chave}' ({campo}): U+{ord(achou.group(0)):04X}. "
                "Use texto plano, '->' e '<='.")
        try:
            texto.encode("cp1252")
        except UnicodeEncodeError as e:
            raise ValueError(
                f"Glossario com caractere fora de cp1252 em '{chave}' "
                f"({campo}): {e}") from None


_verificar_texto_limpo()
