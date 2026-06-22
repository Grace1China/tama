import path from 'path';

import { resolveAdjFactorParquet, resolveBfqDirParquet } from '@/app/lib/tuShareParquetPath';

/** DuckDB read_parquet 路径字面量 */
export function parquetSqlPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "''");
}

export function getQfqSourcePaths(): { bfq: string; adj: string } {
  return {
    bfq: parquetSqlPath(resolveBfqDirParquet()),
    adj: parquetSqlPath(resolveAdjFactorParquet()),
  };
}

function escapeTsCode(code: string): string {
  return code.replace(/'/g, "''");
}

/** YYYYMMDD 或 YYYY-MM-DD → DuckDB DATE 字面量 */
export function toIsoDateLiteral(raw: string): string | null {
  const t = raw.trim();
  if (/^\d{8}$/.test(t)) {
    return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return t;
  }
  return null;
}

/** 前复权价：不复权价 × 当日复权因子 / 该股最新复权因子 */
function qfq(col: string): string {
  return `${col} * a.adj_factor / l.latest_adj`;
}

/** 构建 latest_adj CTE（每只股票取最新 trade_date 的 adj_factor） */
export function buildLatestAdjCte(adjPath: string, tsCodes?: string[]): string {
  const whereTs =
    tsCodes && tsCodes.length > 0
      ? `WHERE ts_code IN (${tsCodes.map((c) => `'${escapeTsCode(c)}'`).join(', ')})`
      : '';
  return `
    latest_adj AS (
      SELECT ts_code, adj_factor AS latest_adj
      FROM (
        SELECT
          ts_code,
          adj_factor,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM read_parquet('${adjPath}')
        ${whereTs}
      ) t
      WHERE rn = 1
    )`;
}

type QfqDailyQueryOpts = {
  bfqPath: string;
  adjPath: string;
  tsCode?: string | null;
  tsCodes?: string[];
  startDate?: string | null;
  endDate?: string | null;
  sortCol?: string;
  sortDir?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
};

function buildBfqWhere(opts: QfqDailyQueryOpts): string {
  const conditions: string[] = [];
  if (opts.tsCode) {
    conditions.push(`b.ts_code = '${escapeTsCode(opts.tsCode)}'`);
  } else if (opts.tsCodes && opts.tsCodes.length > 0) {
    conditions.push(
      `b.ts_code IN (${opts.tsCodes.map((c) => `'${escapeTsCode(c)}'`).join(', ')})`,
    );
  }
  if (opts.startDate) {
    const iso = toIsoDateLiteral(opts.startDate);
    if (iso) conditions.push(`b.trade_date >= DATE '${iso.replace(/'/g, "''")}'`);
  }
  if (opts.endDate) {
    const iso = toIsoDateLiteral(opts.endDate);
    if (iso) conditions.push(`b.trade_date <= DATE '${iso.replace(/'/g, "''")}'`);
  }
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

/** 前复权日线明细 CTE：qfq */
export function buildQfqDailyCte(opts: QfqDailyQueryOpts): string {
  const { bfqPath, adjPath } = opts;
  const whereB = buildBfqWhere(opts);
  const tsCodes = opts.tsCode ? [opts.tsCode] : opts.tsCodes;
  return `
    ${buildLatestAdjCte(adjPath, tsCodes)},
    qfq AS (
      SELECT
        b.ts_code,
        b.trade_date,
        ${qfq('b.open')} AS open,
        ${qfq('b.high')} AS high,
        ${qfq('b.low')} AS low,
        ${qfq('b.close')} AS close,
        ${qfq('b.pre_close')} AS pre_close,
        ${qfq('b.change')} AS change,
        b.pct_chg,
        b.vol,
        b.amount
      FROM read_parquet('${bfqPath}') b
      INNER JOIN read_parquet('${adjPath}') a
        ON b.ts_code = a.ts_code AND b.trade_date = a.trade_date
      INNER JOIN latest_adj l ON b.ts_code = l.ts_code
      ${whereB}
    )`;
}

export function buildQfqDailyCountSql(opts: QfqDailyQueryOpts): string {
  return `WITH ${buildQfqDailyCte(opts)} SELECT COUNT(*) AS cnt FROM qfq`;
}

export function buildQfqDailyDataSql(opts: QfqDailyQueryOpts): string {
  const sortCol = opts.sortCol && /^[a-zA-Z0-9_]+$/.test(opts.sortCol) ? opts.sortCol : 'trade_date';
  const dir = opts.sortDir === 'ASC' ? 'ASC' : 'DESC';
  const limit = Math.max(1, Math.floor(opts.limit ?? 50));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  return `WITH ${buildQfqDailyCte(opts)} SELECT * FROM qfq ORDER BY ${sortCol} ${dir} LIMIT ${limit} OFFSET ${offset}`;
}
