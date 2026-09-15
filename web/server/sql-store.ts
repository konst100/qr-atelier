import type { AccountStore, AccountRecord } from './account-service.ts';
import type { PasswordDigest } from '../lib/account.ts';
import type { QrDestination, QrRecord, QrStore } from './qr-service.ts';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;

/**
 * Small driver-neutral boundary. A PostgreSQL, D1, or SQLite adapter can
 * implement this one method and keep the domain services unchanged.
 */
export type SqlClient = {
  query<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[]): Promise<T[]>;
};

function stringValue(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Invalid SQL row field: ${key}`);
  return value;
}

function nullableString(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Invalid SQL row field: ${key}`);
  return value;
}

function numberValue(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`Invalid SQL row field: ${key}`);
  return value;
}

function accountFromRow(row: SqlRow): AccountRecord {
  const password: PasswordDigest = {
    algorithm: stringValue(row, 'password_algorithm') as PasswordDigest['algorithm'],
    iterations: numberValue(row, 'password_iterations'),
    salt: stringValue(row, 'password_salt'),
    hash: stringValue(row, 'password_hash'),
  };
  return {
    id: stringValue(row, 'id'),
    email: stringValue(row, 'email'),
    displayName: stringValue(row, 'display_name'),
    password,
    emailVerifiedAt: nullableString(row, 'email_verified_at'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

export class SqlAccountStore implements AccountStore {
  private readonly client: SqlClient;

  constructor(client: SqlClient) {
    this.client = client;
  }

  async findByEmail(email: string): Promise<AccountRecord | null> {
    const rows = await this.client.query(
      `SELECT id, email, display_name, password_algorithm, password_iterations,
       password_salt, password_hash, email_verified_at, created_at, updated_at
       FROM users WHERE email = ? LIMIT 1`,
      [email],
    );
    return rows[0] ? accountFromRow(rows[0]) : null;
  }

  async create(account: AccountRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO users
       (id, email, display_name, password_algorithm, password_iterations,
        password_salt, password_hash, email_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [account.id, account.email, account.displayName, account.password.algorithm,
        account.password.iterations, account.password.salt, account.password.hash,
        account.emailVerifiedAt, account.createdAt, account.updatedAt],
    );
  }
}

function qrFromRow(row: SqlRow): QrRecord {
  return {
    id: stringValue(row, 'id'),
    workspaceId: stringValue(row, 'workspace_id'),
    slug: stringValue(row, 'slug'),
    kind: stringValue(row, 'kind'),
    name: stringValue(row, 'name'),
    status: stringValue(row, 'status') as QrRecord['status'],
    designJson: stringValue(row, 'design_json'),
    folderId: nullableString(row, 'folder_id'),
    campaignId: nullableString(row, 'campaign_id'),
    expiresAt: nullableString(row, 'expires_at'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function destinationFromRow(row: SqlRow): QrDestination {
  return {
    id: stringValue(row, 'id'),
    qrCodeId: stringValue(row, 'qr_code_id'),
    destinationUrl: stringValue(row, 'destination_url'),
    startsAt: stringValue(row, 'starts_at'),
    endsAt: nullableString(row, 'ends_at'),
    createdAt: stringValue(row, 'created_at'),
  };
}

const qrColumns = `id, workspace_id, slug, kind, name, status, design_json,
  folder_id, campaign_id, expires_at, created_at, updated_at`;

export class SqlQrStore implements QrStore {
  private readonly client: SqlClient;

  constructor(client: SqlClient) {
    this.client = client;
  }

  async createQr(record: QrRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO qr_codes (${qrColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.workspaceId, record.slug, record.kind, record.name,
        record.status, record.designJson, record.folderId, record.campaignId,
        record.expiresAt, record.createdAt, record.updatedAt],
    );
  }

  async getQrInWorkspace(workspaceId: string, id: string): Promise<QrRecord | null> {
    const rows = await this.client.query(
      `SELECT ${qrColumns} FROM qr_codes WHERE workspace_id = ? AND id = ? LIMIT 1`,
      [workspaceId, id],
    );
    return rows[0] ? qrFromRow(rows[0]) : null;
  }

  async getQrBySlug(slug: string): Promise<QrRecord | null> {
    const rows = await this.client.query(
      `SELECT ${qrColumns} FROM qr_codes WHERE slug = ? LIMIT 1`,
      [slug],
    );
    return rows[0] ? qrFromRow(rows[0]) : null;
  }

  async listQrInWorkspace(workspaceId: string): Promise<QrRecord[]> {
    const rows = await this.client.query(
      `SELECT ${qrColumns} FROM qr_codes WHERE workspace_id = ? ORDER BY updated_at DESC`,
      [workspaceId],
    );
    return rows.map(qrFromRow);
  }

  async createDestination(destination: QrDestination): Promise<void> {
    await this.client.query(
      `INSERT INTO qr_destinations
       (id, qr_code_id, destination_url, starts_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [destination.id, destination.qrCodeId, destination.destinationUrl,
        destination.startsAt, destination.endsAt, destination.createdAt],
    );
  }

  async listDestinations(qrCodeId: string): Promise<QrDestination[]> {
    const rows = await this.client.query(
      `SELECT id, qr_code_id, destination_url, starts_at, ends_at, created_at
       FROM qr_destinations WHERE qr_code_id = ? ORDER BY starts_at DESC`,
      [qrCodeId],
    );
    return rows.map(destinationFromRow);
  }
}
