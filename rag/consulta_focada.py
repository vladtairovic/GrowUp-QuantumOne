"""Recuperação documental a partir da pergunta atual e de código do usuário."""
import json
import re
import unicodedata


def separar_consulta(texto):
    marcador = "\nMensagem atual do usuário:\n"
    prefixo, presente, atual = texto.rpartition(marcador)
    if not presente:
        return texto, ""
    # A função conversas.preparar serializa as mensagens em uma lista JSON.
    historico = []
    for linha in reversed(prefixo.splitlines()):
        if linha.startswith("["):
            try:
                historico = json.loads(linha)
            except ValueError:
                pass
            break
    anteriores = [m["content"] for m in historico if isinstance(m, dict)
                  and m.get("role") == "user" and isinstance(m.get("content"), str)]
    return atual, "\n".join(anteriores)


def termos_da_busca(pergunta):
    atual, historico = separar_consulta(pergunta)
    titulo = atual.split("\n", 1)[0].strip() or atual
    normal = unicodedata.normalize("NFKD", titulo.casefold()).encode("ascii","ignore").decode()
    inversas = re.search(r"invers|self.adjoint|involut|cancel|anul|redundan|remov|remoc|retir|elimin", normal)
    if not inversas:
        # Mensagens com arquivos ou seguimentos conservam o assunto da pergunta.
        return atual, []
    padrao = r"\b(?:[a-zA-Z_]\w*\.)?(h|x|y|z|cx|cy|cz|swap|ccx|s|sdg|t|tdg)\s*\(([^()\n]*)\)"
    citadas = re.findall(padrao, titulo.lower())
    # Apenas nomes explícitos de porta no texto ou métodos no código.
    explicitas = re.findall(r"(?:\bporta\s+|\bpauli[- ])(ccx|swap|cx|cy|cz|sdg|tdg|[hxyzst])\b|\b(ccx|swap|cx|cy|cz|sdg|tdg|[hxyzst])gate\b",titulo,re.I)
    nomes = [n for n,_ in citadas] + [(a or b).lower() for a,b in explicitas]
    if not nomes:
        chamadas = re.findall(padrao, (historico + "\n" + atual).lower())
        nomes = [a[0] for a,b in zip(chamadas,chamadas[1:]) if a==b]
    classes = {"swap":"SwapGate","sdg":"SdgGate","tdg":"TdgGate"}
    portas = list(dict.fromkeys(classes.get(n, n.upper()+"Gate") for n in nomes))
    if not portas:
        return atual, []
    return " ".join(portas) + " inverse self-inverse inverse cancellation", portas


def evidencias_inversas(colecao, portas, limite):
    evidencias = []
    for porta in portas[:limite]:
        doc = "ibm_qiskit_circuit_library_" + porta
        linhas = colecao.get(where={"document_id": doc},include=["documents","metadatas"])
        partes = sorted(zip(linhas["ids"],linhas["documents"],linhas["metadatas"]),
                        key=lambda linha: linha[2].get("indice",0))
        partes = [(i,t,m) for i,t,m in partes if
                  re.search(r"\binverse\s*$",str(m.get("secao","")),re.I)]
        if not partes:
            continue
        probantes = [i for i,t,m in partes if re.search(r"itself|self[- ]inverse|self[- ]adjoint|return.*inverse",t,re.I)]
        if not probantes:
            continue
        secao = partes[0][2]["secao"]
        evidencia = "\n".join(t.removeprefix(secao + "\n\n") for _,t,_ in partes)
        evidencias.append({"id":probantes[0], "ids_contexto":[i for i,_,_ in partes],
                           "texto":secao+"\n\n"+evidencia,"metadados":partes[0][2]})
    return evidencias
