import { getAppmaxBaseUrls } from "./config";

/** Erro de API da Appmax, com o status HTTP e o corpo bruto de resposta anexados. */
export class AppmaxApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "AppmaxApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;

    // Formato padrão OAuth2 (RFC 6749 §5.2) — o endpoint /oauth2/token
    // devolve `{ error: "invalid_client", error_description: "..." }`, com
    // `error` como STRING, não objeto. Sem checar isso, um 401 de
    // credenciais erradas virava só "Falha ao autenticar (HTTP 401)",
    // escondendo o motivo real (client_id/secret inválidos, app suspenso
    // etc.) — foi exatamente isso que aconteceu tentando instalar em
    // produção (ver /setup, HTTP 401 sem detalhe nenhum).
    if (typeof obj.error === "string") {
      const description = typeof obj.error_description === "string" ? obj.error_description : null;
      return description ? `${obj.error}: ${description}` : obj.error;
    }

    const error = obj.error as Record<string, unknown> | undefined;
    if (error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

/**
 * POST application/x-www-form-urlencoded contra `auth.*appmax.com.br`.
 * Usado só para obter tokens OAuth2 (client_credentials) — app ou merchant.
 */
export async function appmaxAuthRequest(
  path: string,
  form: Record<string, string>
): Promise<unknown> {
  const { authUrl } = getAppmaxBaseUrls();
  const res = await fetch(`${authUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AppmaxApiError(
      extractErrorMessage(body, `Falha ao autenticar (HTTP ${res.status})`),
      res.status,
      body
    );
  }
  return body;
}

/**
 * Requisição contra `api.*appmax.com.br`, com Bearer token e envelope
 * `{ data: ... }` já resolvido (retorna `body.data` quando presente).
 */
export async function appmaxApiRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { token: string; body?: unknown; unwrap?: boolean }
): Promise<T> {
  const { apiUrl } = getAppmaxBaseUrls();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new AppmaxApiError(
      extractErrorMessage(body, `Requisição Appmax falhou (HTTP ${res.status})`),
      res.status,
      body
    );
  }
  // Desembrulha o envelope `{ data: ... }` por padrão — mas alguns
  // endpoints (ex.: merchant-session) documentam a resposta SEM esse
  // envelope, então isso é opt-out via `unwrap: false`.
  if (
    options.unwrap !== false &&
    body &&
    typeof body === "object" &&
    "data" in (body as Record<string, unknown>)
  ) {
    return (body as Record<string, unknown>).data as T;
  }
  return body as T;
}
