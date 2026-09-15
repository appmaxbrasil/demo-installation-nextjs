import { NextRequest, NextResponse } from "next/server";
import { upsertCustomer } from "@/lib/appmax/customers";
import { createOrder } from "@/lib/appmax/orders";
import { AppmaxApiError } from "@/lib/appmax/http";
import { TEST_PRODUCT } from "@/lib/checkout/product";

export const runtime = "nodejs";

type CheckoutBody = {
  ip: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  documentNumber?: string;
  address?: {
    postcode?: string;
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
  };
};

/**
 * Cria customer + order na Appmax (nessa ordem — a order precisa de um
 * customer_id existente). Devolve os ids para o front usar depois de
 * autorizar o pagamento no Apple Pay.
 *
 * Todas as chamadas à Appmax acontecem aqui no servidor — o browser nunca
 * vê client_id/client_secret nem o access_token do merchant.
 */
export async function POST(request: NextRequest) {
  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.ip || !body.firstName || !body.lastName || !body.email || !body.phone) {
    return NextResponse.json(
      { error: "Campos obrigatórios: ip, firstName, lastName, email, phone" },
      { status: 400 }
    );
  }

  try {
    const customer = await upsertCustomer({
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      ip: body.ip,
      documentNumber: body.documentNumber,
      address: body.address,
    });

    const order = await createOrder(customer.id);

    return NextResponse.json({
      customerId: customer.id,
      orderId: order.id,
      status: order.status,
      amountCents: TEST_PRODUCT.unitValueCents * TEST_PRODUCT.quantity,
    });
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
