import { NextResponse } from "next/server";
import { getAppmaxBaseUrls, getAppmaxEnvironment } from "@/lib/appmax/config";
import { getExternalId, getMerchantCredentials } from "@/lib/appmax/state";
import { TEST_PRODUCT } from "@/lib/checkout/product";

export const runtime = "nodejs";

/**
 * Config pública para a página de checkout (client-side). Nada sensível
 * trafega aqui — client_id/secret e tokens ficam só no servidor.
 */
export async function GET() {
  const { scriptUrl } = getAppmaxBaseUrls();

  return NextResponse.json({
    environment: getAppmaxEnvironment(),
    scriptUrl,
    externalId: getExternalId(),
    merchantConfigured: Boolean(getMerchantCredentials()),
    product: TEST_PRODUCT,
  });
}
