import { getDb } from "./client";
import type { AppmaxEnvironment } from "../appmax/config";

const ACTIVE_ENV_KEY = "active_environment";

/**
 * Ambiente ativo (sandbox/produção) escolhido em tela (ver
 * `EnvironmentSwitcher` no Header e a seção "Ambiente" em /setup) — vale
 * pra todo o app: instalação, checkout, `/configuracao`. Sobrepõe
 * `APPMAX_ENV` do `.env` (mesma precedência banco > env var já usada pras
 * credenciais, ver lib/appmax/config.ts). `null` quando não há banco ou
 * ainda não foi escolhido — quem chama cai pra `APPMAX_ENV`.
 */
export function getActiveEnvironment(): AppmaxEnvironment | null {
  const db = getDb();
  if (!db) return null;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(ACTIVE_ENV_KEY) as
    | { value: string }
    | undefined;
  if (row?.value === "sandbox" || row?.value === "production") return row.value;
  return null;
}

/** Retorna `false` se não houver banco disponível (mesmo caso dos outros writes em lib/db). */
export function setActiveEnvironment(environment: AppmaxEnvironment): boolean {
  const db = getDb();
  if (!db) return false;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(ACTIVE_ENV_KEY, environment);
  return true;
}
