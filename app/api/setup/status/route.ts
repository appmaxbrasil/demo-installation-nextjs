import { NextResponse } from "next/server";
import { getExternalId, getMerchantCredentials } from "@/lib/appmax/state";
import { getAppmaxEnvironment, getAppBaseUrl, getValidateUrl } from "@/lib/appmax/config";

export const runtime = "nodejs";

function mask(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function GET() {
  // Fonte: os mesmos getters que o resto do app usa (banco pro external_id,
  // banco > env var pro merchant). Antes isto lia `readState()` direto do
  // `state.json` e por isso divergia da página /setup: o banco tinha um
  // external_id e este JSON respondia `null`, porque o espelho em disco
  // estava vazio.
  const externalId = getExternalId();
  const merchant = getMerchantCredentials();

  let appBaseUrl: string | null = null;
  let validateUrl: string | null = null;
  let baseUrlError: string | null = null;
  try {
    appBaseUrl = await getAppBaseUrl();
    validateUrl = await getValidateUrl();
  } catch (error) {
    baseUrlError = error instanceof Error ? error.message : "APP_BASE_URL ausente";
  }

  return NextResponse.json({
    environment: getAppmaxEnvironment(),
    appBaseUrl,
    validateUrl,
    baseUrlError,
    externalId,
    merchantConfigured: Boolean(merchant),
    merchantClientId: mask(merchant?.clientId),
  });
}
