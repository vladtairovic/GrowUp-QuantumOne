import json
import unittest
from rag.consulta_focada import termos_da_busca, evidencias_inversas


class BuscaFocada(unittest.TestCase):
    def test_seguimento(self):
        h = [{"role":"user","content":"qc.h(0)\nqc.x(1)\nqc.x(1)\nqc.cx(0,1)"},
             {"role":"assistant","content":"CircuitInstruction e copy()"}]
        p = "Histórico:\n" + json.dumps(h) + "\nMensagem atual do usuário:\nPosso remover essas duas chamadas?"
        consulta, portas = termos_da_busca(p)
        self.assertEqual(portas,["XGate"])
        self.assertNotIn("copy",consulta)
        self.assertIn("self-inverse",consulta)

    def test_evidencia_sem_inventar(self):
        class Colecao:
            def get(self,where,include):
                if where["document_id"].endswith("XGate"):
                    m={"document_id":where["document_id"],"secao":"17. inverse"}
                    return {"ids":["c65","c66"],"documents":["inverse(annotated=False)","Return inverted X gate (itself)."],
                            "metadatas":[{**m,"indice":65},{**m,"indice":66}]}
                return {"ids":[],"documents":[],"metadatas":[]}
        self.assertEqual(evidencias_inversas(Colecao(),["XGate"],3)[0]["id"],"c66")
        self.assertEqual(evidencias_inversas(Colecao(),["HGate"],3),[])
        self.assertEqual(termos_da_busca("Qual a etapa de routing?")[1],[])
