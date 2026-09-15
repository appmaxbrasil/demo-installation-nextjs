import {
  getAppCredentials,
  getAppmaxBaseUrls,
  getApplePayDomain,
  getExternalKey,
  getInstallCallbackUrl,
} from "./config";
import { getAppAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";

/**
 * Fluxo de instalação do app — ver /guides/instalacao e /guides/callback-instalacao.
 *
 * 1. authorizeInstall(): POST /app/authorize → devolve um hash de uso único.
 *    Redirecionamos o merchant (você mesmo, testando) para a tela de
 *    autorização da Appmax usando esse hash.
 * 2. A Appmax redireciona de volta para `url_callback` com `?token=<hash>`.
 * 3. generateMerchantClient(): troca esse hash pelas credenciais do merchant
 *    via POST /app/client/generate. É NESSA chamada que a Appmax dispara o
 *    health check contra a nossa URL de validação (/api/appmax/validate).
 */

export async function authorizeInstall(): Promise<{ hash: string; redirectUrl: string }> {
  const appToken = await getAppAccessToken();
  const { appUuid } = getAppCredentials();
  const { authorizeRedirectUrl } = getAppmaxBaseUrls();

  const domain = await getApplePayDomain();
  const body = {
    app_id: appUuid, // App UUID aqui — não o Numerical ID (ver guides/instalacao)
    external_key: getExternalKey(),
    url_callback: await getInstallCallbackUrl(),
    // Registra o domínio público deste app para o Apple Pay (modelo
    // integrado) junto ao merchant da Appmax na Apple. A doc é
    // inconsistente sobre o nome do campo — um trecho fala em
    // `domain_name` (singular), o exemplo de curl usa `domain_names`
    // (array) — mandamos os dois pra não depender de qual delas a
    // Appmax realmente lê.
    domain_name: domain,
    domain_names: [domain],
  };
  console.log("[Appmax][install] POST /app/authorize — enviando", body);

  const result = await appmaxApiRequest<{ token: string }>("POST", "/app/authorize", {
    token: appToken,
    body,
  });
  console.log("[Appmax][install] POST /app/authorize — resposta", result);

  return {
    hash: result.token,
    redirectUrl: authorizeRedirectUrl(result.token),
  };
}

/**
 * Procura um campo na resposta da Appmax em vários caminhos possíveis. A API
 * já respondeu em formatos diferentes em testes reais (ora achatado, ora
 * aninhado em `data.client.*`), então checamos todos em vez de quebrar toda
 * vez que a doc e o comportamento real divergem. Mesma abordagem do projeto
 * irmão em PHP (`api_controllers.php::api_install_finish`).
 */
function firstOf(source: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    let cursor: unknown = source;
    for (const segment of path.split(".")) {
      if (cursor === null || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (typeof cursor === "string" && cursor.length > 0) return cursor;
  }
  return undefined;
}

export async function generateMerchantClient(
  hash: string
): Promise<{ clientId: string; clientSecret: string; externalId?: string }> {
  const appToken = await getAppAccessToken();

  console.log("[Appmax][install] POST /app/client/generate — trocando hash pelas credenciais do merchant (dispara o health check em /api/appmax/validate)");
  const result = await appmaxApiRequest<{
    client: { client_id: string; client_secret: string };
  }>("POST", "/app/client/generate", {
    token: appToken,
    body: { token: hash },
  });

  // Se a resposta ecoar o `external_id`, ELE é a verdade: é o valor que
  // ficou registrado do lado da Appmax. Ignorar esse eco foi o que deixou
  // nosso banco com um id diferente do que a Appmax tem — e o SDK mandando
  // esse id órfão no header `external-id`, colhendo 404 "Merchant not
  // found" em toda tokenização. Quando não vier (a resposta quase nunca
  // traz), fica `undefined` e quem chama mantém o do health check.
  const externalId = firstOf(result, [
    "data.client.external_id",
    "data.external_id",
    "client.external_id",
    "external_id",
  ]);
  // client_secret nunca em texto puro no log — só os 4 primeiros/últimos caracteres.
  const mask = (v: string) => (v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : "••••");
  console.log("[Appmax][install] POST /app/client/generate — credenciais do merchant geradas", {
    clientId: mask(result.client.client_id),
    clientSecret: mask(result.client.client_secret),
  });

  return {
    clientId: result.client.client_id,
    clientSecret: result.client.client_secret,
    externalId,
  };
}
