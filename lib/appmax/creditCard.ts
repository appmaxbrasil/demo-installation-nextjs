import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";

export type PayWithCreditCardInput = {
  orderId: number;
  customerId: number;
  /** Token devolvido pelo Appmax JS no `onSuccess` do form `data-appmax-checkout`. */
  token: string;
  holderDocumentNumber: string;
  holderName: string;
  installments: number; // 1 a 12
  softDescriptor?: string; // opcional, máx. 13 caracteres
};

/**
 * Ver /api-reference/payments/cartao-credito — POST /v1/payments/credit-card.
 * O token em si já foi gerado pelo appmax.min.js (form `data-appmax-checkout`,
 * ver AppleCardForm em app/page.tsx) — o número do cartão/CVV NUNCA passam
 * por este backend, só o token.
 */
export async function payWithCreditCard(input: PayWithCreditCardInput): Promise<unknown> {
  const token = await getMerchantAccessToken();

  return appmaxApiRequest("POST", "/v1/payments/credit-card", {
    token,
    body: {
      order_id: input.orderId,
      customer_id: input.customerId,
      payment_data: {
        credit_card: {
          token: input.token,
          holder_document_number: input.holderDocumentNumber,
          holder_name: input.holderName,
          installments: input.installments,
          soft_descriptor: input.softDescriptor,
        },
      },
    },
  });
}
