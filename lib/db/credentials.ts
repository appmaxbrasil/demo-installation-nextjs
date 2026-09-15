import { getDb } from "./client";
import type { AppmaxEnvironment } from "../appmax/config";

export type CredentialRow = {
  environment: AppmaxEnvironment;
  appUuid: string | null;
  appNumericalId: string | null;
  appClientId: string | null;
  appClientSecret: string | null;
  externalKey: string | null;
  externalId: string | null;
  merchantClientId: string | null;
  merchantClientSecret: string | null;
  updatedAt: string | null;
};

type Row = {
  environment: string;
  app_uuid: string | null;
  app_numerical_id: string | null;
  app_client_id: string | null;
  app_client_secret: string | null;
  external_key: string | null;
  external_id: string | null;
  merchant_client_id: string | null;
  merchant_client_secret: string | null;
  updated_at: string | null;
};

function fromRow(row: Row): CredentialRow {
  return {
    environment: row.environment as AppmaxEnvironment,
    appUuid: row.app_uuid,
    appNumericalId: row.app_numerical_id,
    appClientId: row.app_client_id,
    appClientSecret: row.app_client_secret,
    externalKey: row.external_key,
    externalId: row.external_id,
    merchantClientId: row.merchant_client_id,
    merchantClientSecret: row.merchant_client_secret,
    updatedAt: row.updated_at,
  };
}

/** Lê as credenciais salvas em banco para um ambiente. `null` se não houver banco ou linha. */
export function getCredentials(environment: AppmaxEnvironment): CredentialRow | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare("SELECT * FROM credentials WHERE environment = ?")
    .get(environment) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function getAllCredentials(): CredentialRow[] {
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare("SELECT * FROM credentials").all() as Row[];
  return rows.map(fromRow);
}

/** Faz upsert parcial (merge) na linha do ambiente. Retorna `false` se não houver banco disponível. */
export function saveCredentials(
  environment: AppmaxEnvironment,
  patch: Partial<Omit<CredentialRow, "environment" | "updatedAt">>
): boolean {
  const db = getDb();
  if (!db) return false;

  const current = getCredentials(environment);
  const next: CredentialRow = {
    environment,
    appUuid: patch.appUuid ?? current?.appUuid ?? null,
    appNumericalId: patch.appNumericalId ?? current?.appNumericalId ?? null,
    appClientId: patch.appClientId ?? current?.appClientId ?? null,
    appClientSecret: patch.appClientSecret ?? current?.appClientSecret ?? null,
    externalKey: patch.externalKey ?? current?.externalKey ?? null,
    externalId: patch.externalId ?? current?.externalId ?? null,
    merchantClientId: patch.merchantClientId ?? current?.merchantClientId ?? null,
    merchantClientSecret: patch.merchantClientSecret ?? current?.merchantClientSecret ?? null,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO credentials (
       environment, app_uuid, app_numerical_id, app_client_id, app_client_secret,
       external_key, external_id, merchant_client_id, merchant_client_secret, updated_at
     ) VALUES (@environment, @appUuid, @appNumericalId, @appClientId, @appClientSecret,
               @externalKey, @externalId, @merchantClientId, @merchantClientSecret, @updatedAt)
     ON CONFLICT(environment) DO UPDATE SET
       app_uuid = excluded.app_uuid,
       app_numerical_id = excluded.app_numerical_id,
       app_client_id = excluded.app_client_id,
       app_client_secret = excluded.app_client_secret,
       external_key = excluded.external_key,
       external_id = excluded.external_id,
       merchant_client_id = excluded.merchant_client_id,
       merchant_client_secret = excluded.merchant_client_secret,
       updated_at = excluded.updated_at`
  ).run(next);

  return true;
}

/**
 * Zera os dados da INSTALAÇÃO de um ambiente (`external_id` + credenciais do
 * merchant), preservando as credenciais do APP (app_uuid/client_id/secret) e
 * a `external_key` — essas vêm do painel da Appmax e não mudam quando você
 * reinstala. Retorna `false` se não houver banco disponível.
 */
export function clearInstallCredentials(environment: AppmaxEnvironment): boolean {
  const db = getDb();
  if (!db) return false;

  db.prepare(
    `UPDATE credentials
        SET external_id = NULL,
            merchant_client_id = NULL,
            merchant_client_secret = NULL,
            updated_at = ?
      WHERE environment = ?`
  ).run(new Date().toISOString(), environment);

  return true;
}
