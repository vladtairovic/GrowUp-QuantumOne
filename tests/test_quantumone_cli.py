import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from qone_core import Workspace, desfazer, editar_linhas, gravar, ultima_edicao
from qone_store import Registro

CLI = Path(__file__).resolve().parents[1] / "cli.py"


class FluxoCLI(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.repo = Path(t.name, "projeto")
        self.repo.mkdir()
        self.env = dict(os.environ, QONE_STATE_DIR=str(Path(t.name, "estado")), PYTHONIOENCODING="utf-8")
        self.src = self.repo / "circuito.py"
        self.src.write_bytes(b"def aplicar(x):\r\n    return x+1\r\n")
        (self.repo / "test_circuito.py").write_text(
            "import unittest\nfrom circuito import aplicar\n"
            "class Caso(unittest.TestCase):\n    def test_resultado(self):\n"
            "        self.assertEqual(aplicar(1), 1)\n")
        calls = self.calls = []
        class API(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, data))
                if self.path == "/query":
                    resultado = {"response": json.dumps({
                        "plano":"Corrigir a operação.", "riscos":"Muda o retorno.",
                        "verificacao":"Rodar Caso.test_resultado.",
                        "arquivos":{"circuito.py":[{"inicio":2,"fim":2,"linhas":["    return x"]}]}
                    })}
                elif self.path=="/qiskit/optimize":
                    resultado={"original":{"total_operacoes":4,"profundidade":3},
                               "proposta":{"total_operacoes":2,"profundidade":2},
                               "status_verificacao":"nao_verificada","motivo":"orçamento"}
                elif self.path=="/conversations":
                    resultado={"conversation_id":"teste"}
                else:
                    resultado={"response":"Resposta local de teste","sources":[]}
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(resultado).encode())
        server=ThreadingHTTPServer(("127.0.0.1",0),API)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.api=f"http://127.0.0.1:{server.server_port}"

    def cli(self,*args,stdin=""):
        return subprocess.run([sys.executable,str(CLI),"--api",self.api,"--repo",str(self.repo),*args],
                              cwd=self.repo,input=stdin,capture_output=True,encoding="utf-8",env=self.env,timeout=25)

    def test_git_projeto_plano_aprovacao_teste_e_reversao(self):
        subprocess.run(["git","init","-q",str(self.repo)],check=True)
        subprocess.run(["git","add","."],cwd=self.repo,check=True)
        subprocess.run(["git","-c","user.name=Teste","-c","user.email=teste@example.invalid",
                        "commit","-qm","Fixture"],cwd=self.repo,check=True)
        clone=self.repo.with_name("clone")
        subprocess.run(["git","clone","--quiet","--local",str(self.repo),str(clone)],check=True)
        self.repo=clone
        self.src=clone/"circuito.py"
        antes=self.src.read_bytes()
        comandos=["/git","/testar unittest test_circuito.py","sim","analise este repositório e corrija os testes",
                  "/aplicar","/testar unittest test_circuito.py","sim","/sair"]
        r=self.cli("--chat",stdin="\n".join(comandos)+"\n")
        self.assertEqual(r.returncode,0,r.stderr)
        for valor in ("Contexto selecionado:", "Plano:", "-    return x+1", "+    return x", "saída 1", "saída 0"):
            self.assertIn(valor,r.stdout)
        self.assertEqual(self.src.read_bytes(),antes.replace(b"x+1",b"x"))
        entrada=self.calls[0][1]["input"]
        self.assertIn("test_circuito.py",entrada)
        self.assertIn("AssertionError",entrada)
        self.assertFalse(self.calls[0][1]["web_search"])
        r=self.cli("--chat",stdin="/desfazer\nsim\n/sair\n")
        self.assertIn("restaurada",r.stdout)
        self.assertEqual(self.src.read_bytes(),antes)

    def test_sessao_fontes_e_qiskit(self):
        r=self.cli("circuito.py","liste")
        self.assertEqual(r.returncode,0,r.stderr)
        h=self.cli("--chat",stdin="/history\n/sair\n").stdout
        import re
        sid=re.search(r"[a-f0-9-]{36}",h)[0]
        r=self.cli("--chat",stdin=f"/retomar {sid}\ne agora?\n/qiskit\n/sair\n")
        self.assertIn("retomada",r.stdout)
        self.assertEqual(self.calls[2][1]["input"],"e agora?")
        self.assertEqual(self.calls[-1][1]["format"],"python")
        self.assertIn("nao_verificada",r.stdout)
        self.assertIn("orçamento",r.stdout)

    def test_negacao_e_sem_efeitos(self):
        r=self.cli("--chat",stdin="/testar unittest test_circuito.py\nn\n/abrir ../fora.py\n/sair\n")
        self.assertIn("cancelada",r.stderr)
        self.assertIn("fora do escopo",r.stderr)
        self.assertNotIn("AssertionError",r.stdout)
        self.assertEqual(self.calls,[])
        roteiro=self.repo/"roteiro.txt"
        roteiro.write_text("/criar novo.py\n/aplicar\n")
        r=self.cli("--roteiro",str(roteiro))
        self.assertEqual(r.returncode,1)
        self.assertFalse((self.repo/"novo.py").exists())
        r=self.cli("--roteiro",str(roteiro),"--permitir","editar")
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertTrue((self.repo/"novo.py").exists())

    def test_edicao_multipla_conflito_e_rollback(self):
        with patch.dict(os.environ,self.env):
            ws=Workspace(self.repo)
            db=Registro(ws.raiz,self.api)
            a=self.src.read_bytes()
            b=(self.repo/"test_circuito.py").read_bytes()
            mudancas={"circuito.py":(a,b"pass\n"),"test_circuito.py":(b,b"# novo\n")}
            from qone_core import substituir
            def falhar(ws,nome,antes,depois,modo):
                if nome=="test_circuito.py":
                    raise OSError("falha de teste")
                substituir(ws,nome,antes,depois,modo)
            with patch("qone_core.substituir",falhar), self.assertRaises(OSError):
                gravar(ws,db,"teste",mudancas)
            self.assertEqual(self.src.read_bytes(),a)
            gravar(ws,db,"teste",mudancas)
            eid=ultima_edicao(ws,db)["id"]
            self.src.write_text("# edição externa")
            with self.assertRaisesRegex(ValueError,"mudou"):
                desfazer(ws,db,eid)
            self.assertEqual(self.src.read_text(),"# edição externa")
            self.assertEqual((self.repo/"test_circuito.py").read_bytes(),b"# novo\n")

    def test_cancelamento_proposta_e_caminho(self):
        r=self.cli("--chat",stdin="/abrir circuito.py\n/propor corrigir\n/cancelar\n/aplicar\n/sair\n")
        self.assertIn("Nenhuma proposta",r.stdout)
        self.assertIn(b"x+1",self.src.read_bytes())
        self.assertEqual(editar_linhas("vazio.py",b"",[{"inicio":1,"fim":0,"linhas":["pass"]}]),b"pass\n")

    def test_qasm_e_bloqueio_de_credencial(self):
        (self.repo / "a.qasm").write_text("OPENQASM 2.0;")
        r = self.cli("--chat", stdin="/abrir a.qasm\n/qiskit 1\n/sair\n")
        self.assertEqual(self.calls, [("/qiskit/optimize", {"qasm": "OPENQASM 2.0;", "optimization_level": 1})])
        self.assertIn("total_operacoes", r.stdout)
        self.src.write_text('API_KEY = "valor_ficticio_de_teste"')
        r = self.cli("circuito.py", "liste")
        self.assertEqual(r.returncode, 1)
        self.assertIn("credencial", r.stderr)
        r = self.cli("circuito.py", "/qiskit")
        self.assertEqual(r.returncode, 1)
        self.assertIn("credencial", r.stderr)
        self.assertEqual(len(self.calls), 1)

    def test_proposta_malformada_e_sintaxe(self):
        import qone_core
        ws = Workspace(self.repo)
        antes = self.src.read_bytes()
        for retorno in ["JSON incompleto", json.dumps({
            "plano": "editar", "riscos": "teste", "verificacao": "testar",
            "arquivos": {"circuito.py": [{"inicio": 1, "fim": 2, "linhas": ["def ("]}]}
        })]:
            with self.assertRaises((SyntaxError, ValueError)):
                qone_core.proposta(ws, ["circuito.py"], "corrigir", lambda _: {"response": retorno})
            self.assertEqual(antes, self.src.read_bytes())

    def test_aplicar_e_reverter_dois_arquivos(self):
        ws = Workspace(self.repo)
        with patch.dict(os.environ, self.env):
            db = Registro(ws.raiz, self.api)
            orig = self.src.read_bytes()
            alteracoes = {"circuito.py": (orig, b"pass\n"), "exemplos/novo.py": (None, b"pass\n")}
            gravar(ws, db, "teste", alteracoes)
            self.assertEqual((self.repo / "exemplos/novo.py").read_bytes(), b"pass\n")
            desfazer(ws, db, ultima_edicao(ws, db)["id"])
            self.assertFalse((self.repo / "exemplos/novo.py").exists())
            self.assertEqual(self.src.read_bytes(), orig)

    def test_timeout(self):
        alvo=self.repo/"test_lento.py"
        alvo.write_text("import time, unittest\nclass Lento(unittest.TestCase):\n def test_demora(self): time.sleep(30)\n")
        r=self.cli("--chat","--timeout-testes","1",stdin="/testar unittest test_lento.py\ns\n/sair\n")
        self.assertIn("tempo excedido",r.stdout)


if __name__=="__main__":
    unittest.main()
