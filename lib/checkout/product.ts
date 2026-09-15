/**
 * Produto único, fixo, só para validar o fluxo de pagamento via Apple Pay.
 * Compartilhado entre client e server — por isso não importa nada de
 * `lib/appmax/*` (que é server-only).
 */
export const TEST_PRODUCT = {
  sku: "TEST-001",
  name: "Produto de teste — fluxo Apple Pay",
  quantity: 1,
  unitValueCents: 500, // R$ 5,00
  type: "digital" as const,
};

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
