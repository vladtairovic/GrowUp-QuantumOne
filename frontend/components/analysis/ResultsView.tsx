"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SourceDrawer, { type SourceDetails } from "./SourceDrawer";
import type { AnalysisResponse, CodeFormat } from "../../services/analysis-api";

export function suggestedCode(result: AnalysisResponse, format: CodeFormat) {
  if (result.quantum) return result.quantum.circuito_otimizado_qasm;
  const blocks = Array.from(
    result.answer.matchAll(
      /^```(python|py|qasm|openqasm)[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/gim,
    ),
  );
  if (blocks.length !== 1) return "";
  const [, language, code] = blocks[0];
  return /^(python|py)$/i.test(language) === (format === "python")
    ? code.trimEnd()
    : "";
}

export default function ChatReply({ result }: { result: AnalysisResponse }) {
  const [source, select] = useState<SourceDetails | null>(null);
  const [notice, setNotice] = useState("");
  const q = result.quantum;
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        q?.circuito_otimizado_qasm || result.answer,
      );
      setNotice("Resultado copiado.");
    } catch {
      setNotice("Selecione o texto e use Ctrl+C.");
    }
  }
  return (
    <div className="chat-reply">
      <Markdown remarkPlugins={[remarkGfm]}>{result.answer}</Markdown>
      {q && (
        <details open>
          <summary>Métricas Qiskit e circuito otimizado</summary>
          <p>
            Qubits: {q.original.qubits}. Tempo: {q.tempo_processamento_segundos?.toFixed(2)} s.
            <br />
            Profundidade: {q.original.profundidade} → {q.proposta.profundidade}
            <br />
            Operações: {q.original.total_operacoes} →{" "}
            {q.proposta.total_operacoes}
          </p>
          <p>
            Equivalência:{" "}
            {q.equivalente === null
              ? "não verificada"
              : q.equivalente
                ? "confirmada"
                : "não equivalente"}
            . {q.motivo}
          </p>
          <pre>
            <code>{q.circuito_otimizado_qasm}</code>
          </pre>
          {q.circuito_otimizado_qasm && <small>Saída em OpenQASM 2. Ao aplicar, o formato do editor será atualizado.</small>}
        </details>
      )}
      {result.warnings.map((w, i) => (
        <p key={i}>{w}</p>
      ))}
      {result.web_status && (
        <small>
          Busca web:{" "}
          {result.web_status === "used"
            ? "utilizada"
            : result.web_status === "disabled"
              ? "desativada"
              : "sem resultados"}
        </small>
      )}
      {result.search_suggestions_html && (
        <iframe
          title="Sugestões de pesquisa"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'\">" +
            result.search_suggestions_html
          }
        />
      )}
      {!!result.sources.length && (
        <details>
          <summary>Ver fontes ({result.sources.length})</summary>
          {result.sources.map((f, i) => (
            <button
              key={i}
              className="source-item-button"
              type="button"
              onClick={() =>
                select({
                  id: f.chunk_id,
                  title: f.title || f.source,
                  origin: f.origin === "web" ? "Web" : "Base local",
                  category: "Documentação",
                  type: "documentation",
                  excerpt: f.content,
                  relationship: "Trecho recuperado para esta resposta.",
                  url: /^https?:\/\//.test(f.source) ? f.source : null,
                })
              }
            >
              {i + 1}. {f.title || f.source}
            </button>
          ))}
        </details>
      )}
      <button type="button" className="button-quiet" onClick={copy}>
        Copiar resultado
      </button>
      <small role="status">{notice}</small>
      <SourceDrawer key={source?.id || "closed"} source={source} onClose={() => select(null)} />
    </div>
  );
}
