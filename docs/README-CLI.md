# QuantumOne CLI · beta 0.2.2

A CLI abre projetos Python/Qiskit e OpenQASM 2 pelo terminal. Você pode conversar sobre um arquivo, consultar as fontes da base documental, medir um circuito com Qiskit e revisar alterações antes de gravá-las no disco.

## Iniciar no Windows com Git Bash

Abra o terminal na raiz do projeto, onde estão `compose.yaml`, `cli.py`, `qone_core.py` e `qone_store.py`. Use Python 3.10 ou superior e inicie o Docker Desktop.

1. Na primeira instalação do projeto, se ainda precisar criar o arquivo de configuração, execute `cp -n .env.example .env`. Configure `GEMINI_API_KEY` no `.env` para usar o chat e as propostas. A busca documental usa o ChromaDB. O comando de otimização usa o serviço Qiskit.
2. Inicie a API e confira a resposta do serviço.

   ```bash
   docker compose up -d --build --wait api
   curl -fsS http://localhost:8000/health
   ```

3. Abra o chat diretamente pelo código.

   ```bash
   python cli.py --repo . --chat
   ```

## Instalar o comando qone

Na raiz que contém o `pyproject.toml` da CLI, execute:

```bash
python -m venv .venv-cli
source .venv-cli/Scripts/activate
python -m pip install .
qone --repo . --chat
```

Em um novo terminal, ative esse ambiente novamente antes de usar `qone`. Se já instalou o pacote em `.venv-cli-teste`, use `source .venv-cli-teste/Scripts/activate`. Quem recebeu o instalador da beta também pode instalar com `python -m pip install --no-index --no-deps ./quantumone_cli-0.2.2-py3-none-any.whl` na pasta que contém esse arquivo.

Confira a versão instalada no ambiente ativo:

```bash
python -m pip show quantumone-cli
```

O campo `Version` deve mostrar `0.2.2`. Ao abrir o chat, você verá o circuito de Bell e o prompt **Você >**. Os indicadores `Pensando...`, `Abrindo pastas...` e `Alterando arquivos...` aparecem durante as respectivas operações no terminal e desaparecem ao terminar.

## Primeira análise

Quando aparecer **Você >**, digite uma linha por vez:

```text
/arquivos
/abrir exemplos/circuito_validado_10q.qasm
Quantos qubits estão declarados e quais são as três primeiras portas?
/fontes
/qiskit 1
```

A pergunta usa o código selecionado e o histórico. O chat envia o conteúdo selecionado à API e ao Gemini, com a busca web desativada. `/fontes` mostra os trechos recuperados. `/qiskit 1` solicita à API uma otimização de nível 1 e exibe operações, profundidade e situação da equivalência. Para experimentar com Python, use `/abrir exemplos/circuito_validado_6q.py`.

## Revisar uma alteração

Com um arquivo aberto, use `/propor` seguido do pedido. Leia o plano e o diff. Digite `/aplicar` para gravar ou `/cancelar` para descartar. Use `/desfazer` para restaurar a última edição da CLI. Para executar os testes do projeto, use `/testar unittest` ou `/testar pytest` conforme a suíte e instale as dependências de teste no mesmo ambiente da CLI. A execução pede autorização e usa as permissões da sua conta.

## Comandos úteis

| Comando | Função |
|---|---|
| `/help` | Lista os comandos disponíveis. |
| `/status` | Mostra projeto, API, arquivos selecionados e estado da busca web. |
| `/history` e `/retomar ID` | Lista conversas e retoma uma sessão pelo identificador. |
| `/sair` | Volta ao terminal do sistema. |

No Git Bash, use os comandos que começam com barra dentro do prompt **Você >**. Para executar a otimização em uma única linha no prompt **$**, use:

```bash
MSYS2_ARG_CONV_EXCL='*' qone --repo . exemplos/circuito_validado_10q.qasm "/qiskit 1"
```

## Integração com o desktop

Este guia atende quem desenvolve ou testa a CLI independente. A instalação única e o botão para abrir o terminal pelo aplicativo dependem do empacotamento pelo desktop e da disponibilidade da API.
