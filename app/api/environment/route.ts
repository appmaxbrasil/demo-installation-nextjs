import { NextRequest, NextResponse } from "next/server";
import { getAppmaxEnvironment } from "@/lib/appmax/config";
import { setActiveEnvironment } from "@/lib/db/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ environment: getAppmaxEnvironment() });
}

/** Troca o ambiente ativo (sandbox/produção) — ver EnvironmentSwitcher no Header. */
export async function POST(request: NextRequest) {
  let body: { environment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.environment !== "sandbox" && body.environment !== "production") {
    return NextResponse.json(
      { error: "environment deve ser 'sandbox' ou 'production'" },
      { status: 400 }
    );
  }

  const saved = setActiveEnvironment(body.environment);
  if (!saved) {
    return NextResponse.json(
      {
        error:
          "Não foi possível abrir o banco local (.appmax/appmax.db) — filesystem provavelmente somente-leitura neste runtime. Use a env var APPMAX_ENV em vez deste seletor.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, environment: body.environment });
}
