import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppmaxEnvironment } from "@/lib/appmax/config";
import { getExternalId, writeState } from "@/lib/appmax/state";

export const runtime = "nodejs";

/**
 * URL de validação (health check) — ver /guides/implementar-url-validacao.
 *
 * A Appmax chama este endpoint, server-to-server, durante o processamento
 * de `POST /app/client/generate`. Contrato:
 * - Só `app_id` é garantido no corpo; os demais campos são opcionais.
 * - Precisamos responder EXATAMENTE com HTTP 200 e um `external_id`
 *   (UUID v4, novo a cada chamada) — sem isso a instalação inteira aborta
 *   com 500 e nenhuma credencial de merchant é emitida.
 *
 * Esta URL precisa estar publicamente acessível via HTTPS (não funciona
 * atrás de `localhost` — use um túnel tipo ngrok em desenvolvimento) e
 * cadastrada no painel do app em "Consultar Aplicativo → Desenvolver".
 *
 * UUID NOVO A CADA REQUISIÇÃO — não reusar o que já está salvo. A doc é
 * explícita: "Gere um UUID novo a cada requisição do health check" e "a
 * Appmax rejeita valores repetidos". Quando o `external_id` enviado já
 * existe na base dela, ele é DESCARTADO e substituído pelo `client_id` da
 * instalação — ou seja, reusar não é só redundante, é o que faz o id que
 * guardamos não existir do lado da Appmax.
 *
 * Isso custou caro pra descobrir: a versão anterior fazia
 * `getExternalId() ?? randomUUID()` em nome de "reinstalação idempotente".
 * O efeito real era o oposto — toda reinstalação remandava um id já
 * conhecido, a Appmax descartava, e o front seguia mandando esse id órfão
 * no header `external-id`. Sintoma: `404 {"message":"Merchant not found"}`
 * em toda tokenização, num ponto do fluxo que não aponta em nada pra
 * instalação. Ver FLUXO-INSTALACAO.md.
 *
 * O valor gerado aqui é gravado por cima do anterior (é sempre o mais
 * recente que vale) e é ele que o `AppmaxScripts.init(...)` do front usa
 * depois. Em runtime serverless sem banco compartilhado entre instâncias,
 * isso não se sustenta: a instância que responde o health check não é
 * necessariamente a que serve o checkout — ali o banco precisa ser
 * externo/persistente de verdade.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    console.error("[Appmax][install] health check chamado com JSON inválido");
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  console.log("[Appmax][install] health check recebido (POST /api/appmax/validate):", body);

  const appId = body?.app_id;
  if (appId === undefined || appId === null || appId === "") {
    console.error("[Appmax][install] health check sem app_id — abortando com 400");
    return NextResponse.json({ error: "app_id is required" }, { status: 400 });
  }

  // Sempre novo — ver o bloco acima. Nunca `getExternalId() ?? ...`.
  const externalId = randomUUID();
  const alias = `web-test-apple-pay (${getAppmaxEnvironment()})`;
  const externalKey =
    typeof body.external_key === "string" ? body.external_key : undefined;
  const clientId = typeof body.client_id === "string" ? body.client_id : undefined;
  const clientSecret =
    typeof body.client_secret === "string" ? body.client_secret : undefined;

  writeState({
    externalId,
    externalKey,
    alias,
    // Se a Appmax já mandar as credenciais do merchant aqui, guardamos —
    // mas o fluxo principal as recebe mesmo é na resposta de
    // /app/client/generate (ver app/api/setup/callback/route.ts).
    ...(clientId && clientSecret
      ? { merchantClientId: clientId, merchantClientSecret: clientSecret }
      : {}),
  });

  // O valor devolvido aqui é o que a Appmax REGISTRA. Se a gravação não
  // pegou, devolver 200 mesmo assim cria exatamente a divergência que
  // quebra a tokenização: a Appmax guarda este id, nosso banco guarda
  // outro (ou nenhum), e o SDK passa a mandar um `external-id` órfão —
  // 404 "Merchant not found" em toda chamada, num ponto do fluxo que não
  // aponta em nada pra instalação.
  //
  // Por isso abortamos com 500: a instalação falha na hora, com mensagem
  // clara, em vez de "concluir" e só quebrar no primeiro pagamento.
  const persisted = getExternalId();
  if (persisted !== externalId) {
    console.error(
      `[Appmax][install] ABORTANDO: devolveríamos external_id "${externalId}", mas o banco ficou com "${persisted ?? "(vazio)"}". Sem persistir, a Appmax registra um id que não temos.`
    );
    return NextResponse.json(
      {
        error:
          "external_id não pôde ser persistido (banco indisponível?). Instalação abortada de propósito — seria registrado do lado da Appmax um id que este app não teria.",
      },
      { status: 500 }
    );
  }

  console.log("[Appmax][install] health check respondido com external_id:", externalId, "(persistido e conferido ✓)");
  return NextResponse.json({ external_id: externalId, alias }, { status: 200 });
}
