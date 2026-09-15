import { DatabaseSync } from 'node:sqlite';
import type { SqlClient, SqlRow, SqlValue } from './sql-store.ts';

/**
 * Node-only adapter for local development and integration tests. Domain code
 * still talks to the tiny SqlClient interface, so production can use
 * PostgreSQL, D1, or another driver without changing services.
 */
export class SqliteClient implements SqlClient {
  private readonly database: DatabaseSync;

  constructor(filename = ':memory:', schema = '') {
    this.database = new DatabaseSync(filename);
    this.database.exec('PRAGMA foreign_keys = ON;');
    if (schema) this.database.exec(schema);
  }

  async query<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const statement = this.database.prepare(sql);
    const normalized = sql.trimStart().toUpperCase();
    if (normalized.startsWith('SELECT') || normalized.startsWith('PRAGMA') || normalized.startsWith('WITH')) {
      return statement.all(...params) as T[];
    }
    statement.run(...params);
    return [];
  }

  close(): void { this.database.close(); }
}
