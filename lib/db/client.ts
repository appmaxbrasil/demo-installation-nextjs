import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Banco local (SQLite) usado só por este projeto de demonstração para guardar
 * as credenciais da Appmax editadas em tela (/configuracao), uma linha por
 * ambiente (sandbox/produção).
 *
 * Isso existe para deixar o fluxo de teste cômodo: trocar de app/merchant
 * sem editar .env nem reiniciar o `next dev`. NÃO é um padrão de produção —
 * segredos ficam em texto plano no arquivo .db (ver aviso no README) e o
 * arquivo não sobrevive a deploys serverless com filesystem somente-leitura
 * (ex.: Vercel). Nesses casos, use env vars (ver lib/appmax/config.ts).
 */

const DB_DIR = path.join(process.cwd(), ".appmax");
const DB_FILE = path.join(DB_DIR, "appmax.db");

let instance: Database.Database | null = null;
let triedAndFailed = false;

/**
 * Retorna `null` (em vez de lançar) quando o filesystem não permite abrir/criar
 * o arquivo — mesmo caso do `.appmax/state.json` antigo em runtimes serverless
 * somente-leitura. Quem chama deve tratar `null` como "sem banco, cai pra env
 * var", nunca deixar isso quebrar uma rota que precisa responder 200 (ex.: o
 * health check da Appmax em /api/appmax/validate).
 */
export function getDb(): Database.Database | null {
  if (instance) return instance;
  if (triedAndFailed) return null;

  try {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
    instance = new Database(DB_FILE);
    instance.pragma("journal_mode = WAL");
    instance.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        environment TEXT PRIMARY KEY,
        app_uuid TEXT,
        app_numerical_id TEXT,
        app_client_id TEXT,
        app_client_secret TEXT,
        external_key TEXT,
        external_id TEXT,
        merchant_client_id TEXT,
        merchant_client_secret TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    return instance;
  } catch (error) {
    triedAndFailed = true;
    console.warn(
      "[appmax/db] não foi possível abrir .appmax/appmax.db (filesystem provavelmente somente-leitura neste runtime — normal na Vercel). Credenciais devem vir de env vars.",
      error
    );
    return null;
  }
}
