import { NextResponse } from "next/server";
import { getAppmaxEnvironment } from "@/lib/appmax/config";
import { clearInstall } from "@/lib/appmax/state";

export const runtime = "nodejs";

/**
 * Zera a instalação do ambiente ativo pra poder recomeçar do zero —
 * equivalente ao `api_install_delete` do projeto irmão em PHP.
 *
 * O `external_id` já se renova sozinho a cada health check (ver
 * `app/api/appmax/validate/route.ts`), então não é ele o motivo daqui. O
 * que isto resolve é o resto do estado da instalação: descartar as
 * credenciais do merchant de uma instalação antiga pra recomeçar limpo, e
 * deixar o checkout explicitamente bloqueado (o front exige `external_id`
 * no banco) até a nova instalação terminar.
 *
 * POST (e não GET) de propósito: destrói estado, então não pode ser
 * disparado por prefetch de link nem por visita acidental à URL.
 */
export async function POST() {
  const environment = getAppmaxEnvironment();
  const cleared = clearInstall(environment);

  if (!cleared) {
    return NextResponse.json(
      {
        error:
          "Não foi possível abrir o banco local (.appmax/appmax.db) — filesystem provavelmente somente-leitura neste runtime.",
      },
      { status: 500 }
    );
  }

  console.log(`[Appmax][install] instalação de ${environment} zerada (external_id + credenciais do merchant)`);
  return NextResponse.json({
    cleared: true,
    environment,
    message: `Instalação de ${environment} removida. Rode a instalação de novo pra gerar um external_id novo.`,
  });
}
