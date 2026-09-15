import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";
import { TEST_PRODUCT } from "@/lib/checkout/product";

/** Ver /api-reference/orders/criar-pedido. */
export async function createOrder(customerId: number): Promise<{ id: number; status: string }> {
  const token = await getMerchantAccessToken();

  const result = await appmaxApiRequest<{ order: { id: number; status: string } }>(
    "POST",
    "/v1/orders",
    {
      token,
      body: {
        customer_id: customerId,
        discount_value: 0,
        shipping_value: 0,
        products: [
          {
            sku: TEST_PRODUCT.sku,
            name: TEST_PRODUCT.name,
            quantity: TEST_PRODUCT.quantity,
            unit_value: TEST_PRODUCT.unitValueCents,
            type: TEST_PRODUCT.type,
          },
        ],
      },
    }
  );

  return result.order;
}
