export type CodeFormat = "python" | "qasm";
export type AnalysisRequest = {
  question: string;
  code: string;
  format?: CodeFormat;
  backend: string;
  top_k?: number;
  web_search?: boolean;
};
export type Source = {
  document_id: string;
  chunk_id: string;
  source: string;
  content: string;
  origin?: "local" | "web";
  title?: string;
  retrieved_at?: string;
};
export type QuantumResult = {
  original: { profundidade: number; total_operacoes: number };
  proposta: { profundidade: number; total_operacoes: number };
  equivalente: boolean | null;
  motivo: string | null;
  circuito_otimizado_qasm: string;
};
export type AnalysisResponse = {
  conversation_id?: string;
  request_id: string;
  status: string;
  answer: string;
  sources: Source[];
  quantum?: QuantumResult;
  warnings: string[];
  web_status?: string;
  search_suggestions_html?: string | null;
};
export class AnalysisError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}
async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ data: T; id: string }> {
  const res = await fetch("/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new AnalysisError(
      data?.message || "Serviço indisponível.",
      res.status,
      data?.request_id,
    );
  if (!data) throw new AnalysisError("Resposta inválida do serviço.", 502);
  return { data, id: res.headers.get("x-request-id") || "" };
}
export async function createConversation(signal: AbortSignal) {
  const session = await post<{ conversation_id: string }>(
    "/conversations",
    {},
    signal,
  );
  return session.data.conversation_id;
}

export async function sendTurn(
  conversationId: string,
  input: string,
  messageId: string,
  settings: { top_k: number; web_search: boolean },
  signal: AbortSignal,
): Promise<AnalysisResponse> {
  const { data, id } = await post<
    Omit<AnalysisResponse, "answer"> & { response: string }
  >(
    "/conversations/" + conversationId + "/messages",
    { input, message_id: messageId, ...settings },
    signal,
  );
  return { ...data, answer: data.response, request_id: data.request_id || id };
}

export async function optimizeCircuit(
  code: string,
  signal: AbortSignal,
): Promise<AnalysisResponse> {
  const { data, id } = await post<QuantumResult>(
    "/qiskit/optimize",
    { qasm: code, optimization_level: 3 },
    signal,
  );
  return {
    request_id: id,
    status: "ok",
    sources: [],
    warnings: [],
    quantum: data,
    answer: "O Qiskit calculou as métricas e gerou a proposta abaixo.",
  };
}
