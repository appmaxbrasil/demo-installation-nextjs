import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAppmaxEnvironment, type AppmaxEnvironment } from "./config";
import {
  clearInstallCredentials,
  getCredentials,
  saveCredentials,
} from "../db/credentials";

/**
 * Estado local do projeto de teste: guarda o `external_id` gerado no health
 * check e as credenciais do MERCHANT obtidas ao final do fluxo de
 * instalação (POST /app/client/generate).
 *
 * Desde a adição do SQLite (/configuracao), o destino principal de escrita é
 * o banco (lib/db/credentials.ts) — cada ambiente (sandbox/produção) tem sua
 * própria linha. `state.json` continua existindo como fallback/histórico
 * best-effort para quando o banco não pôde ser aberto (ex.: filesystem
 * somente-leitura), e é sempre escrito como espelho, nunca como fonte
 * primária de leitura.
 *
 * Nada aqui é apropriado para produção real — ali isso deve virar uma tabela
 * vinculada ao merchant de verdade, com os devidos controles de acesso, como
 * os próprios guias da Appmax recomendam.
 */

export type AppmaxState = {
  externalId?: string;
  externalKey?: string;
  alias?: string;
  merchantClientId?: string;
  merchantClientSecret?: string;
  updatedAt?: string;
};

const STATE_DIR = path.join(process.cwd(), ".appmax");
const STATE_FILE = path.join(STATE_DIR, "state.json");

export function readState(): AppmaxState {
  try {
    if (!existsSync(STATE_FILE)) return {};
    const raw = readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as AppmaxState;
  } catch {
    return {};
  }
}

export function writeState(patch: Partial<AppmaxState>): AppmaxState {
  const next: AppmaxState = {
    ...readState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  // Fonte primária: banco (uma linha por ambiente). Se não puder abrir
  // (filesystem somente-leitura), segue só com o espelho em JSON abaixo.
  //
  // Vai o `patch` CRU, nunca o `next`. `next` é o merge com `state.json`, e
  // mandar esse merge pro banco reabria pela porta dos fundos exatamente o
  // problema que `getExternalId()` fechou: um `externalId` velho parado no
  // state.json era reinjetado no banco a cada `writeState()` — inclusive nos
  // que só queriam gravar credencial de merchant — e o SDK voltava a mandar
  // um id que a Appmax não conhece. `saveCredentials` faz upsert parcial
  // (campo ausente/null = mantém o que está lá), então passar só o patch é
  // suficiente e não apaga nada.
  saveCredentials(getAppmaxEnvironment(), {
    externalId: patch.externalId ?? null,
    externalKey: patch.externalKey ?? null,
    merchantClientId: patch.merchantClientId ?? null,
    merchantClientSecret: patch.merchantClientSecret ?? null,
  });

  // Best-effort: em runtimes com filesystem somente-leitura (ex.: funções
  // serverless da Vercel), isso falha — e não pode derrubar quem chamou.
  // Falhar aqui, por exemplo, quebraria o health check da Appmax (precisa
  // responder 200 + external_id de qualquer forma) e abortaria a instalação
  // inteira com 500. Nesses ambientes, credencial de merchant ainda aceita
  // APPMAX_MERCHANT_CLIENT_ID / APPMAX_MERCHANT_CLIENT_SECRET via env var; o
  // `external_id`, não — ele é lido só do banco (ver `getExternalId()`), então
  // lá o banco precisa ser persistente de verdade.
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf-8");
  } catch (error) {
    console.warn(
      "[appmax/state] não foi possível persistir .appmax/state.json (filesystem provavelmente somente-leitura neste runtime — normal na Vercel). Valor mantido só em memória para esta requisição.",
      error
    );
  }
  return next;
}

/**
 * Credenciais do merchant. Precedência: banco (linha do ambiente ativo,
 * editada em /setup ou /configuracao) > env var > espelho em `state.json` —
 * mesmo critério de `getAppCredentials()` em `lib/appmax/config.ts`.
 *
 * Já foi env var > banco, mas isso causava um bug real: uma
 * `APPMAX_MERCHANT_CLIENT_ID`/`SECRET` velha esquecida no `.env` (de uma
 * instalação anterior, ou de outro ambiente) silenciosamente vencia
 * credenciais **novas e corretas** recém-geradas pelo `/setup` e salvas no
 * banco — o checkout quebrava com `invalid_client` mesmo com a instalação
 * tendo acabado de funcionar. Banco primeiro evita essa pegadinha: o que
 * está em `/configuracao` pro ambiente ativo é sempre a fonte mais recente.
 * Em runtime serverless (Vercel), onde o banco não persiste entre
 * invocações, a env var continua funcionando normalmente como único
 * fallback disponível.
 */
export function getMerchantCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const row = getCredentials(getAppmaxEnvironment());
  const state = readState();
  const clientId =
    row?.merchantClientId ?? process.env.APPMAX_MERCHANT_CLIENT_ID ?? state.merchantClientId;
  const clientSecret =
    row?.merchantClientSecret ??
    process.env.APPMAX_MERCHANT_CLIENT_SECRET ??
    state.merchantClientSecret;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * `external_id` da loja — o identificador que a Appmax associa ao merchant
 * na instalação e que o `AppmaxScripts.init()` manda no header `external-id`
 * de toda chamada do SDK (tokenização de cartão, merchant session).
 *
 * Fonte ÚNICA: a linha do ambiente ativo no banco (editável em
 * `/configuracao`). Nada de env var nem de `state.json` como fallback — um
 * `APPMAX_EXTERNAL_ID` esquecido no `.env` vencia silenciosamente o valor
 * salvo pela instalação e o SDK acabava mandando um id que a Appmax não
 * conhece; o sintoma era um `404 {"message":"Merchant not found"}` no
 * `.../v1/payments/tokenize`, que parecia (e foi documentado como) endpoint
 * fora do ar. Mesma pegadinha que `getMerchantCredentials()` já sofreu com
 * credencial velha de merchant.
 *
 * Sem linha no banco isto devolve `null` e o checkout nem carrega o SDK —
 * ver o guard em `app/page.tsx`.
 */
export function getExternalId(): string | null {
  return getCredentials(getAppmaxEnvironment())?.externalId ?? null;
}

/**
 * Apaga o que a instalação produziu no ambiente dado: `external_id` e
 * credenciais do merchant. Usado pelo `/api/setup/reset` pra recomeçar uma
 * instalação do zero sem carregar credencial de merchant antiga.
 *
 * Limpa também o espelho em `state.json`, senão ele ressuscitaria valores
 * velhos no próximo `writeState()`.
 */
export function clearInstall(environment: AppmaxEnvironment): boolean {
  const cleared = clearInstallCredentials(environment);

  try {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  } catch (error) {
    console.warn("[appmax/state] não foi possível apagar .appmax/state.json", error);
  }

  return cleared;
}
