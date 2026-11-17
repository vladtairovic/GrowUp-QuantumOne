"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";

import SettingsPanel from "./SettingsPanel";

const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => <div className="editor-loading">Carregando editor...</div>,
});

import ChatReply, { suggestedCode } from "./ResultsView";
import {
  createConversation,
  optimizeCircuit,
  getCircuitLimits,
  circuitContext,
  sendTurn,
  AnalysisError,
  type AnalysisResponse,
  type CodeFormat,
} from "../../services/analysis-api";

type Turn = {
  input: string;
  code: string;
  format: CodeFormat;
  result: AnalysisResponse;
  applied?: boolean;
};
type Thread = {
  id: string;
  updated: number;
  remote?: string;
  title: string;
  turns: Turn[];
  code: string;
  format: CodeFormat;
  question: string;
  topK: string;
  webSearch: boolean;
};
const prefix = "quantumone.chat.v1.";

export default function AnalysisForm() {
  const [thread, setThread] = useState<Thread | null>(null);
  const [history, setHistory] = useState<Thread[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const pending = useRef<{
    local: string;
    remote?: string;
    key: string;
    messageId: string;
  } | null>(null);
  const locked = useRef(false);
  const scrollArea = useRef<HTMLDivElement>(null);

  function save(change: Omit<Thread, "updated">) {
    const next = { ...change, updated: new Date().getTime() };
    setThread(next);
    try {
      localStorage.setItem(prefix + next.id, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "Não foi possível salvar esta conversa no histórico deste navegador.",
      );
    }
  }

  function openHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    try {
      const saved: Thread[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        try {
          const item = JSON.parse(localStorage.getItem(key) || "null");
          if (item?.id && Array.isArray(item.turns)) saved.push(item);
        } catch {
          /* Uma entrada inválida não bloqueia as demais. */
        }
      }
      setHistory(saved.sort((a, b) => b.updated - a.updated));
    } catch {
      setStorageError("O histórico está indisponível neste navegador.");
    }
  }

  function restore(item: Thread) {
    if (locked.current) return;
    setThread(item);
    setCode(item.code);
    setChosenFormat(item.format);
    setQuestion(item.question);
    setTopK(item.topK);
    setWebSearch(item.webSearch);
    setHistory(null);
    setFeedback(null);
    setEditorMessage("");
    setShowInputErrors(false);
    pending.current = null;
  }

  useEffect(() => {
    const el = scrollArea.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.id, thread?.turns.length, busy]);

  async function run(custom?: string) {
    if (locked.current) return;
    const input = (custom ?? question).trim();
    if (
      (!input && (thread || !code.trim())) ||
      input.length > 18000
    ) {
      setShowInputErrors(true);
      setFeedback({
        type: "error",
        message:
          input.length > 18000
            ? "A pergunta excede 18.000 caracteres. O circuito tem limites próprios."
            : "Escreva uma pergunta ou inicie uma análise com um circuito.",
      });
      return;
    }
    locked.current = true;
    setBusy(true);
    setFeedback(null);
    setHistory(null);
    const controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), 45000);
    const local = thread?.id ?? pending.current?.local ?? crypto.randomUUID();
    const key = JSON.stringify([local, input, code, format, topK, webSearch]);
    if (pending.current?.key !== key) {
      pending.current = {
        local,
        remote: thread?.remote,
        key,
        messageId: crypto.randomUUID(),
      };
    }
    const request = pending.current;
    const label = input || "Analise este circuito e sugira melhorias.";
    let result: AnalysisResponse | undefined;
    try {
      if (code.trim()) {
        const limits = await getCircuitLimits(controller.signal);
        clearTimeout(timeout);
        timeout = setTimeout(() => controller.abort(), limits.optimization_timeout_seconds * 1000 + 120000);
        // The backend is authoritative; no separate hard-coded circuit cap in the editor.
        result = await optimizeCircuit(code, controller.signal, format);
      } else {
        clearTimeout(timeout);
        timeout = setTimeout(() => controller.abort(), 120000);
      }
      if (input || !result) {
        request.remote ??= await createConversation(controller.signal);
        const prompt = label + circuitContext(code, format, result?.quantum);
        const response = await sendTurn(
          request.remote,
          prompt,
          request.messageId,
          { top_k: Number(topK), web_search: webSearch },
          controller.signal,
        );
        result = { ...response, quantum: result?.quantum,
          warnings: [...(result?.warnings || []), ...response.warnings] };
      }
    } catch (e) {
      const message = controller.signal.aborted
        ? "Tempo limite excedido. Tente novamente."
        : e instanceof Error
          ? e.message
          : "Falha na análise.";
      if (!result) {
        setFeedback({
          type: "error",
          message:
            e instanceof AnalysisError && e.requestId
              ? message + " Solicitação: " + e.requestId
              : message,
        });
        return;
      }
      result.warnings.push(message);
    } finally {
      clearTimeout(timeout);
      locked.current = false;
      setBusy(false);
    }
    if (!result) return;
    const turn = { input: label, result, code, format };
    save({
      id: local,
      title:
        thread?.title ||
        (
          input || "Circuito " + (format === "qasm" ? "OpenQASM" : "Qiskit")
        ).slice(0, 80),
      remote: request.remote,
      turns: [...(thread?.turns || []), turn],
      code,
      format,
      question: "",
      topK,
      webSearch,
    });
    setQuestion("");
    setShowInputErrors(false);
    pending.current = null;
  }

  function applyCode(turn: Turn) {
    if (
      !thread ||
      locked.current ||
      turn.code !== code ||
      turn.format !== format
    )
      return;
    const replacement = suggestedCode(turn.result, format);
    if (!replacement || replacement === code) return;
    setCode(replacement);
    const replacementFormat = turn.result.quantum?.formato_saida || format;
    setChosenFormat(replacementFormat);
    save({
      ...thread,
      code: replacement,
      format: replacementFormat,
      turns: thread.turns.map((t) =>
        t === turn ? { ...t, applied: true } : t,
      ),
    });
    setEditorMessage("Alteração aprovada e aplicada ao editor.");
  }
  const [code, setCode] = useState("");
  const [chosenFormat, setChosenFormat] = useState<CodeFormat | null>(null);
  const format =
    chosenFormat ??
    (/^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*OPENQASM\b/i.test(code)
      ? "qasm"
      : "python");
  const [question, setQuestion] = useState("");

  const [backend, setBackend] = useState("reference");
  const [topK, setTopK] = useState("5");
  const [webSearch, setWebSearch] = useState(true);

  const [showInputErrors, setShowInputErrors] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: "error";
    message: string;
  } | null>(null);

  const [editorMessage, setEditorMessage] = useState("");

  // Salva também edições locais e perguntas ainda não enviadas de conversas existentes.
  useEffect(() => {
    if (!thread) return;
    try {
      localStorage.setItem(
        prefix + thread.id,
        JSON.stringify({ ...thread, code, format, question, topK, webSearch }),
      );
    } catch {
      /* save() sinaliza indisponibilidade ao concluir o turno. */
    }
  }, [thread, code, format, question, topK, webSearch]);

  const examples = [
    "Reduzir profundidade",
    "Explicar o circuito",
    "Adaptar ao backend",
  ];

  function selectExample(example: string) {
    setQuestion(example);
    setFeedback(null);
  }

  async function handleCopy() {
    if (!code.trim()) {
      setEditorMessage("Não existe código para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setEditorMessage("Código copiado!");
    } catch {
      setEditorMessage(
        "Não foi possível copiar automaticamente. Utilize Ctrl+C.",
      );
    }
  }

  async function handlePaste() {
    try {
      const clipboardText = await navigator.clipboard.readText();

      if (!clipboardText) {
        setEditorMessage("A área de transferência está vazia.");
        return;
      }

      setCode(clipboardText);
      setEditorMessage("Código inserido!");
      setFeedback(null);
      setShowInputErrors(false);
    } catch {
      setEditorMessage(
        "Não foi possível acessar a área de transferência. Utilize Ctrl+V.",
      );
    }
  }

  function handleClear() {
    setThread(null);
    setHistory(null);
    pending.current = null;
    setCode("");
    setChosenFormat(null);
    setQuestion("");
    setBackend("reference");
    setTopK("5");
    setWebSearch(true);
    setFeedback(null);
    setEditorMessage("");
    setShowInputErrors(false);
  }

  function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Image
              src="/images/logo.png"
              alt="Identidade visual do projeto Agente RAG"
              width={240}
              height={90}
              priority
              style={{
                display: "block",
                width: "220px",
                height: "auto",
                maxHeight: "76px",
                objectFit: "contain",
              }}
            />
          </div>

          <div className="topbar-label">Qiskit · Next-Gen Computing</div>
        </div>
      </header>

      <main className="workspace">
        <section className="page-intro">
          <div>
            <span className="eyebrow">ÁREA DE TRABALHO</span>

            <h1>{thread ? "Análise do circuito" : "Nova análise"}</h1>

            <p>
              Cole seu circuito em Python com Qiskit ou OpenQASM 2, diga o que
              deseja entender ou melhorar e receba uma análise com fontes.
            </p>
          </div>
          <div className="history-menu">
            <button
              type="button"
              className="button-secondary"
              aria-expanded={!!history}
              disabled={busy}
              onClick={openHistory}
            >
              Histórico
            </button>
            {history && (
              <div
                className="history-list"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setHistory(null);
                }}
              >
                <button type="button" onClick={handleClear}>
                  + Nova conversa
                </button>
                {history.length === 0 && <p>Nenhuma conversa salva.</p>}
                {history.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => restore(item)}
                  >
                    {item.title}
                    <small>
                      {new Date(item.updated).toLocaleString("pt-BR")}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        {storageError && <p role="alert">{storageError}</p>}
        <form className="analysis-grid" onSubmit={handleAnalyze} noValidate>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Código do circuito</h2>

                <span>Insira o código que deseja analisar.</span>
              </div>

              <div className="toolbar-actions">
                <button
                  type="button"
                  className="button-quiet"
                  disabled={busy}
                  onClick={handlePaste}
                >
                  Colar
                </button>

                <button
                  type="button"
                  className="button-quiet"
                  onClick={handleCopy}
                >
                  Copiar
                </button>
              </div>
            </div>

            <div
              className={`editor-shell ${
                showInputErrors ? "input-invalid" : ""
              }`}
            >
              <div className="editor-toolbar">
                <label htmlFor="circuit-format">Formato</label>
                <select
                  disabled={busy}
                  id="circuit-format"
                  value={format}
                  onChange={(event) =>
                    setChosenFormat(
                      event.target.value === "qasm" ? "qasm" : "python",
                    )
                  }
                >
                  <option value="python">Python (Qiskit)</option>
                  <option value="qasm">OpenQASM 2</option>
                </select>
              </div>

              <CodeEditor
                readOnly={busy}
                qasm={format === "qasm"}
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setEditorMessage("");

                  if (value.trim()) {
                    setShowInputErrors(false);
                    setFeedback(null);
                  }
                }}
              />
            </div>

            <div className="editor-footer">
              <span>Editor de código</span>
              <span>{code.length} caracteres</span>
            </div>

            {editorMessage && (
              <p className="editor-message" role="status">
                {editorMessage}
              </p>
            )}
          </section>

          <section className="panel side-panel">
            {(thread || busy) && (
              <>
                <h2>Conversa</h2>
                <div
                  className="chat-log"
                  ref={scrollArea}
                  role="log"
                  aria-label="Conversa"
                >
                  {thread?.turns.map((turn, i) => (
                    <article key={i}>
                      <p className="chat-user">{turn.input}</p>
                      <ChatReply result={turn.result} />
                      {i === thread.turns.length - 1 &&
                        code &&
                        turn.code === code &&
                        turn.format === format &&
                        !turn.applied &&
                        !busy &&
                        turn.result.status !== "insufficient_context" &&
                        (suggestedCode(turn.result, format) ? (
                          suggestedCode(turn.result, format) !== code && (
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => applyCode(turn)}
                            >
                              Aprovar alteração no editor
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() =>
                              void run(
                                "Mostre a alteração proposta como um único bloco de código completo no formato atual para que eu possa revisá-la.",
                              )
                            }
                          >
                            Solicitar proposta de código
                          </button>
                        ))}
                      {turn.applied && (
                        <small>Alteração aplicada ao editor.</small>
                      )}
                    </article>
                  ))}
                  {busy && <p role="status">Analisando…</p>}
                </div>
              </>
            )}

            <div className="field-group">
              <label htmlFor="analysis-question">
                {thread ? "Continue a conversa" : "Pergunta / objetivo"}
              </label>

              <textarea
                disabled={busy}
                id="analysis-question"
                className={`question-input ${
                  showInputErrors ? "input-invalid-field" : ""
                }`}
                aria-invalid={showInputErrors}
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  setFeedback(null);

                  if (event.target.value.trim()) {
                    setShowInputErrors(false);
                  }
                }}
                placeholder="O que você gostaria de entender ou melhorar?"
              />
            </div>

            {!thread && (
              <div className="examples-section">
                <span className="section-label">EXEMPLOS DE OBJETIVO</span>

                <div className="example-list">
                  {examples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="example-chip"
                      onClick={() => selectExample(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <SettingsPanel
              backend={backend}
              topK={topK}
              webSearch={webSearch}
              onWebSearchChange={setWebSearch}
              onBackendChange={setBackend}
              onTopKChange={setTopK}
            />

            <div className="form-actions">
              <button type="submit" disabled={busy} className="button-primary">
                {thread ? "Enviar" : "Analisar"}
                <span aria-hidden="true">→</span>
              </button>

              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={handleClear}
              >
                {thread ? "Nova conversa" : "Limpar tudo"}
              </button>
            </div>

            {!thread && (
              <p className="form-hint">
                Preencha ao menos a pergunta ou o código.
              </p>
            )}
          </section>
        </form>

        {feedback && (
          <div className="form-feedback error" role="alert">
            {feedback.message}
          </div>
        )}

        <footer className="page-footer">
          Agente RAG · Qiskit — Ferramenta de apoio ao desenvolvimento quântico.
        </footer>
      </main>
    </>
  );
}
