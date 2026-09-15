import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";

/**
 * Formato do objeto devolvido pelo callback `onAuthorize(appleToken)` do
 * Appmax JS — ver /api-reference/payments/apple-pay ("Mapeamento do Apple
 * Token para o payload"). É o mesmo shape do `ApplePayPaymentToken` nativo
 * do Safari, repassado como veio.
 */
export type AppleToken = {
  paymentData: {
    version: string;
    data: string;
    signature: string;
    header: {
      publicKeyHash?: string;
      ephemeralPublicKey: string;
      transactionId: string;
    };
  };
  paymentMethod: {
    displayName: string;
    network: string;
    type: string;
  };
  transactionIdentifier: string;
};

export type PayApplePayInput = {
  orderId: number;
  customerId: number;
  installments: number; // 1 a 12
  holderDocumentNumber: string;
  softDescriptor?: string; // opcional, máx. 13 caracteres
  appleToken: AppleToken;
};

/**
 * getMerchantSession() foi REMOVIDA daqui de propósito.
 *
 * Ela chamava POST /v1/apple-pay/merchant-session em api.sandboxappmax.com.br
 * com o Bearer do merchant, seguindo /api-reference/payments/
 * apple-pay-merchant-session ao pé da letra — mas isso não é o que o
 * appmax.min.js faz de verdade. Vasculhando o script (ele não é ofuscado,
 * só minificado) achei que a Merchant Session real vem de uma Lambda
 * pública separada:
 *
 *   POST https://hdixjlm06b.execute-api.sa-east-1.amazonaws.com/production/v1/apple-pay/merchant-session
 *   headers: { "Content-Type": "application/json", "external-id": <externalId> }
 *   body:    { store_url: window.location.hostname, external_id: <externalId> }
 *
 * Sem Bearer nenhum — só o header/campo `external-id` — e o `store_url` é
 * só o hostname, não a URL completa como o exemplo da doc sugere. Como não
 * precisa de segredo nenhum, essa chamada agora é feita direto do client
 * em app/page.tsx (dentro do `session.onvalidatemerchant`), sem passar
 * pelo nosso backend. Guardei essa nota aqui pra quem for procurar essa
 * função sentir falta dela e entender o motivo.
 */

/** Ver /api-reference/payments/apple-pay — POST /v1/payments/apple-pay. */
export async function payWithApplePay(input: PayApplePayInput): Promise<unknown> {
  const token = await getMerchantAccessToken();

  return appmaxApiRequest("POST", "/v1/payments/apple-pay", {
    token,
    body: {
      order_id: input.orderId,
      customer_id: input.customerId,
      payment_data: {
        apple_pay: {
          installments: String(input.installments),
          holder_document_number: input.holderDocumentNumber,
          soft_descriptor: input.softDescriptor,
          payment_data: input.appleToken.paymentData,
          payment_method: input.appleToken.paymentMethod,
          transaction_identifier: input.appleToken.transactionIdentifier,
        },
      },
    },
  });
}
