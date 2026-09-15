import { NextRequest, NextResponse } from "next/server";
import { payWithApplePay, type AppleToken } from "@/lib/appmax/applePay";
import { AppmaxApiError } from "@/lib/appmax/http";

export const runtime = "nodejs";

type ApplePayBody = {
  orderId: number;
  customerId: number;
  holderDocumentNumber: string;
  installments?: number;
  softDescriptor?: string;
  appleToken: AppleToken;
};

/**
 * Último passo do fluxo: recebe o `appleToken` devolvido pelo callback
 * `onAuthorize` do Appmax JS (front) e efetiva o pagamento via
 * POST /v1/payments/apple-pay — ver /api-reference/payments/apple-pay.
 */
export async function POST(request: NextRequest) {
  let body: ApplePayBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.orderId || !body.customerId || !body.holderDocumentNumber || !body.appleToken) {
    return NextResponse.json(
      {
        error:
          "Campos obrigatórios: orderId, customerId, holderDocumentNumber, appleToken",
      },
      { status: 400 }
    );
  }

  try {
    const result = await payWithApplePay({
      orderId: body.orderId,
      customerId: body.customerId,
      installments: body.installments ?? 1,
      holderDocumentNumber: body.holderDocumentNumber,
      softDescriptor: body.softDescriptor,
      appleToken: body.appleToken,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AppmaxApiError) {
      return NextResponse.json(
        { error: error.message, detail: error.body },
        { status: error.status >= 400 && error.status < 600 ? error.status : 502 }
      );
    }
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
