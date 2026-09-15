/**
 * Configuração central da integração Appmax.
 *
 * Toda a leitura de variáveis de ambiente relacionadas à Appmax passa por
 * aqui, para termos um único lugar que sabe resolver sandbox x produção e
 * validar o que é obrigatório em cada etapa do fluxo.
 *
 * Documentação usada como referência (docs.appmax.com.br):
 * - /api-reference/introduction
 * - /guides/ambientes
 * - /guides/autenticacao
 */

export type AppmaxEnvironment = "sandbox" | "production";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Lazy import: evita puxar `better-sqlite3` (binário nativo) em qualquer
 * módulo que só precise de `getAppmaxEnvironment`/URLs, e principalmente
 * evita quebrar em runtimes que não suportam módulos nativos (ex.: Edge).
 */
function dbCredentials() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCredentials } = require("../db/credentials") as typeof import("../db/credentials");
  return getCredentials(getAppmaxEnvironment());
}

/**
 * Ambiente ativo. Precedência: banco (escolhido no seletor do Header/`/setup`)
 * > `APPMAX_ENV` > `"sandbox"`. Fica em `lib/db/settings.ts` — uma linha só,
 * global — em vez de `dbCredentials()` (que já é por-ambiente e dependeria
 * de saber o ambiente pra se ler, uma referência circular).
 */
export function getAppmaxEnvironment(): AppmaxEnvironment {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getActiveEnvironment } = require("../db/settings") as typeof import("../db/settings");
  const active = getActiveEnvironment();
  if (active) return active;

  const raw = (env("APPMAX_ENV") ?? "sandbox").toLowerCase();
  return raw === "production" ? "production" : "sandbox";
}

export function getAppmaxBaseUrls() {
  const isProd = getAppmaxEnvironment() === "production";
  return {
    authUrl: isProd
      ? "https://auth.appmax.com.br"
      : "https://auth.sandboxappmax.com.br",
    apiUrl: isProd
      ? "https://api.appmax.com.br"
      : "https://api.sandboxappmax.com.br",
    scriptUrl: isProd
      ? "https://scripts.appmax.com.br/appmax.min.js"
      : "https://scripts.sandboxappmax.com.br/appmax.min.js",
    // URL de autorização (redirect do merchant durante a instalação)
    authorizeRedirectUrl: (hash: string) =>
      isProd
        ? `https://admin.appmax.com.br/appstore/integration/${hash}`
        : `https://breakingcode.sandboxappmax.com.br/appstore/integration/${hash}`,
  };
}

/**
 * Credenciais do APLICATIVO — usadas só no fluxo de instalação (/app/authorize,
 * /app/client/generate). Precedência: banco (editado em /configuracao) > env
 * var, pra dar pra trocar de app sem mexer em .env/redeploy. Lança se não
 * houver nenhuma das duas fontes.
 */
export function getAppCredentials() {
  const row = dbCredentials();
  const appUuid = row?.appUuid ?? env("APPMAX_APP_UUID");
  const clientId = row?.appClientId ?? env("APPMAX_APP_CLIENT_ID");
  const clientSecret = row?.appClientSecret ?? env("APPMAX_APP_CLIENT_SECRET");
  if (!appUuid || !clientId || !clientSecret) {
    throw new Error(
      "Credenciais do app da Appmax ausentes. Preencha em /configuracao ou defina APPMAX_APP_UUID/APPMAX_APP_CLIENT_ID/APPMAX_APP_CLIENT_SECRET (veja .env.example)."
    );
  }
  return {
    appUuid,
    appNumericalId: row?.appNumericalId ?? env("APPMAX_APP_NUMERICAL_ID"),
    clientId,
    clientSecret,
  };
}

/** Chave usada para identificar esta instalação (equivalente a um store_id/merchant_id seu). */
export function getExternalKey(): string {
  const row = dbCredentials();
  return row?.externalKey ?? env("APPMAX_EXTERNAL_KEY") ?? "web-test-apple-pay";
}

/**
 * URL pública onde este app Next.js está acessível AGORA — derivada do
 * `Host`/`X-Forwarded-*` da requisição em andamento (via `headers()` do
 * `next/headers`, que funciona em qualquer função chamada durante o
 * processamento de uma Request/Server Component, sem precisar passar o
 * `NextRequest` manualmente por toda a cadeia de chamadas).
 *
 * De propósito NÃO fixa num valor salvo em `.env`: este projeto é rodado ora
 * via `localhost`, ora atrás de um túnel ngrok que muda de URL a cada `ngrok
 * http 3000` — se essa função devolvesse um `APP_BASE_URL` estático, o
 * `url_callback` da instalação (e o domínio registrado pro Apple Pay)
 * ficariam apontando pra uma URL antiga/errada assim que o túnel mudasse (foi
 * exatamente isso que quebrou uma instalação real — a env var ainda apontava
 * pra um deploy velho na Vercel enquanto o teste rodava contra outro host).
 *
 * `APP_BASE_URL` continua existindo só como fallback manual, pros raros casos
 * em que a requisição chega sem `Host` utilizável (proxy mal configurado).
 *
 * Necessária para:
 * - registrar a URL de validação (health check) no painel do app;
 * - servir de `url_callback` no fluxo de instalação;
 * - registrar o(s) domínio(s) do Apple Pay (`domain_names` em /app/authorize).
 */
export async function getAppBaseUrl(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { headers } = require("next/headers") as typeof import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");

  if (host) {
    const proto =
      h.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const fallback = env("APP_BASE_URL");
  if (fallback) return fallback.replace(/\/+$/, "");

  throw new Error(
    "Não foi possível determinar a URL pública deste app a partir da requisição (sem header Host), e APP_BASE_URL não está definida como fallback."
  );
}

export async function getValidateUrl(): Promise<string> {
  return `${await getAppBaseUrl()}/api/appmax/validate`;
}

export async function getInstallCallbackUrl(): Promise<string> {
  return `${await getAppBaseUrl()}/api/setup/callback`;
}

export async function getApplePayDomain(): Promise<string> {
  return new URL(await getAppBaseUrl()).host;
}
