import { createRequire } from 'node:module';
import type { Database, TableData } from 'duckdb';
import { assertReadOnlySql } from './safety.js';

const require = createRequire(import.meta.url);
const duckdb = require('duckdb') as typeof import('duckdb');

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10).replace(/-/g, '');
    return iso;
  }
  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = normalizeValue(value);
  }
  return out;
}

export function sqlString(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "''");
}

/** 只读内存连接。不会把结果写回 parquet。 */
export function querySql(sql: string): Promise<Array<Record<string, unknown>>> {
  assertReadOnlySql(sql);
  return new Promise((resolve, reject) => {
    const db: Database = new duckdb.Database(':memory:');
    db.all(sql, (err, rows: TableData) => {
      db.close(() => undefined);
      if (err) {
        reject(err);
        return;
      }
      resolve((rows ?? []).map((row) => normalizeRow(row)));
    });
  });
}

/** 测试夹具写 parquet。生产查询不会调用。 */
export function execSql(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db: Database = new duckdb.Database(':memory:');
    db.exec(sql, (err) => {
      db.close(() => undefined);
      if (err) reject(err);
      else resolve();
    });
  });
}
