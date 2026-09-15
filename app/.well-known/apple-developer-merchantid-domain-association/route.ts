import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Arquivo de verificação de domínio para o Apple Pay — ver
 * https://appmax.readme.io/reference/configuração-de-domínios-para-apple-pay-via-appmax
 *
 * É o MESMO conteúdo (literal, essa string hex) em qualquer domínio que
 * use a Appmax — não é gerado por nós, não é por loja/merchant. A doc é
 * explícita: "Não altere o conteúdo do arquivo: o hash interno é validado
 * pela Apple." — por isso está hardcoded aqui, byte a byte, em vez de vir
 * de env var ou de qualquer lugar que alguém possa editar sem querer.
 *
 * Requisitos da doc (por isso Route Handler em vez de public/, pra
 * controlar o Content-Type exato):
 * - HTTP 200 direto, sem redirecionamento
 * - Content-Type: text/plain
 * - HTTPS (garantido pelo próprio deploy)
 */
const DOMAIN_ASSOCIATION_CONTENT =
  "7b2276657273696f6e223a312c227073704964223a2238383637324534354136323336423032384645463731323938334343354338354339334633353231433430374142313338414543354144434641334330334442222c22637265617465644f6e223a313735323630333939333937337d";

export async function GET() {
  return new NextResponse(DOMAIN_ASSOCIATION_CONTENT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
