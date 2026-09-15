import { readFile } from 'node:fs/promises';
import { handleAppRequest, type AppRouterDependencies } from './router.ts';
import { SqliteClient } from './sqlite-client.ts';
import { SqlAccountStore, SqlQrStore, SqlScanStore, SqlSessionStore, SqlWorkspaceAccess } from './sql-store.ts';

export class LocalRuntime {
  readonly client: SqliteClient;
  readonly dependencies: AppRouterDependencies;

  private constructor(client: SqliteClient) {
    this.client = client;
    const accounts = new SqlAccountStore(client);
    const sessions = new SqlSessionStore(client);
    const qrs = new SqlQrStore(client);
    const workspaces = new SqlWorkspaceAccess(client);
    this.dependencies = {
      auth: { accounts, sessions },
      qr: { sessions, workspaces, qrs },
      stats: { sessions, workspaces, qrs, scans: new SqlScanStore(client) },
    };
  }

  static async open(filename = ':memory:'): Promise<LocalRuntime> {
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    return new LocalRuntime(new SqliteClient(filename, schema));
  }

  handle(request: Request): Promise<Response> { return handleAppRequest(request, this.dependencies); }
  close(): void { this.client.close(); }
}
