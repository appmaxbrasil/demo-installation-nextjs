import { getMerchantAccessToken } from "./auth";
import { appmaxApiRequest } from "./http";

/** Ver /api-reference/customers/criar-atualizar. */
export type CreateCustomerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ip: string;
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

export async function upsertCustomer(input: CreateCustomerInput): Promise<{ id: number }> {
  const token = await getMerchantAccessToken();

  const result = await appmaxApiRequest<{ customer: { id: number } }>(
    "POST",
    "/v1/customers",
    {
      token,
      body: {
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        ip: input.ip,
        document_number: input.documentNumber,
        address: input.address
          ? {
              postcode: input.address.postcode,
              street: input.address.street,
              number: input.address.number,
              complement: input.address.complement,
              district: input.address.district,
              city: input.address.city,
              state: input.address.state,
            }
          : undefined,
      },
    }
  );

  return result.customer;
}
