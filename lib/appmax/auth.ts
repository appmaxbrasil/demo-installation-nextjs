import { getAppCredentials, getAppmaxEnvironment, type AppmaxEnvironment } from "./config";
import { getMerchantCredentials } from "./state";
import { appmaxAuthRequest } from "./http";

/**
 * Tokens OAuth2 (client_credentials) da Appmax — ver /guides/autenticacao.
 *
 * Existem DOIS pares de credenciais com escopos diferentes:
 * - App:      só serve para o fluxo de instalação (/app/authorize, /app/client/generate).
 * - Merchant: serve para as rotas transacionais (/v1/customers, /v1/orders, /v1/payments/*).
 *
 * Os tokens expiram em 1h e a API não usa refresh token — por isso cacheamos
 * em memória do processo e renovamos pouco antes de expirar.
 *
 * O cache é POR AMBIENTE. Sandbox e produção têm credenciais diferentes e
 * emissores diferentes (`auth.sandboxappmax` × `auth.appmax`), e o ambiente
 * ativo troca em runtime pelo seletor do Header — sem essa chave, trocar de
 * ambiente continuaria servindo o token do anterior por até 1h, mandando um
 * Bearer de sandbox pra API de produção (e vice-versa). O sintoma seria um
 * 401 intermitente que some sozinho quando o token expira, ou seja, quase
 * impossível de reproduzir na hora que acontece.
 */

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type CachedToken = { accessToken: string; expiresAt: number };

type TokenCacheByEnv = Partial<Record<AppmaxEnvironment, CachedToken>>;

const appTokenCache: TokenCacheByEnv = {};
const merchantTokenCache: TokenCacheByEnv = {};

const SAFETY_MARGIN_MS = 30_000;

async function requestToken(clientId: string, clientSecret: string): Promise<CachedToken> {
  const body = (await appmaxAuthRequest("/oauth2/token", {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  })) as TokenResponse;

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000 - SAFETY_MARGIN_MS,
  };
}

export async function getAppAccessToken(): Promise<string> {
  const environment = getAppmaxEnvironment();
  const cached = appTokenCache[environment];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  const { clientId, clientSecret } = getAppCredentials();
  const fresh = await requestToken(clientId, clientSecret);
  appTokenCache[environment] = fresh;
  return fresh.accessToken;
}

export async function getMerchantAccessToken(): Promise<string> {
  const environment = getAppmaxEnvironment();
  const cached = merchantTokenCache[environment];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  const credentials = getMerchantCredentials();
  if (!credentials) {
    throw new Error(
      "Credenciais do merchant ainda não configuradas. Conclua o fluxo em /setup primeiro."
    );
  }
  const fresh = await requestToken(credentials.clientId, credentials.clientSecret);
  merchantTokenCache[environment] = fresh;
  return fresh.accessToken;
}

/**
 * Usado pelo /setup depois de gerar novas credenciais de merchant, para não
 * servir um token velho em cache. Limpa os dois ambientes: a instalação pode
 * ter trocado o ambiente ativo no meio do caminho, e um token órfão do outro
 * ambiente não tem por que sobreviver a uma reinstalação.
 */
export function resetMerchantTokenCache() {
  delete merchantTokenCache.sandbox;
  delete merchantTokenCache.production;
}
