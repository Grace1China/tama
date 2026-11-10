import { sqlString } from '../duck.js';

function inList(codes: string[]): string {
  return codes.map((code) => `'${code.replace(/'/g, "''")}'`).join(', ');
}

/** 前复权日线。价格来自 bfqDir 与 adjFactor 的 ASOF，SQL 中不出现 qfqDir。 */
export function qfqDailySql(bfqPath: string, adjPath: string, tsCode: string, limit: number): string {
  const bfq = sqlString(bfqPath);
  const adj = sqlString(adjPath);
  const code = tsCode.replace(/'/g, "''");
  const safeLimit = Math.max(1, Math.floor(limit));
  return `
    WITH latest_adj AS (
      SELECT ts_code, adj_factor AS latest_adj
      FROM (
        SELECT ts_code, adj_factor,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM read_parquet('${adj}')
        WHERE ts_code = '${code}'
      ) t
      WHERE rn = 1
    ),
    qfq AS (
      SELECT
        b.ts_code,
        b.trade_date,
        b.open * a.adj_factor / l.latest_adj AS open,
        b.high * a.adj_factor / l.latest_adj AS high,
        b.low * a.adj_factor / l.latest_adj AS low,
        b.close * a.adj_factor / l.latest_adj AS close,
        b.pre_close * a.adj_factor / l.latest_adj AS pre_close,
        b.change * a.adj_factor / l.latest_adj AS change,
        b.pct_chg,
        b.vol,
        b.amount,
        a.adj_factor,
        l.latest_adj
      FROM read_parquet('${bfq}') b
      ASOF LEFT JOIN read_parquet('${adj}') a
        ON b.ts_code = a.ts_code AND b.trade_date >= a.trade_date
      INNER JOIN latest_adj l ON b.ts_code = l.ts_code
      WHERE b.ts_code = '${code}'
        AND a.adj_factor IS NOT NULL
    )
    SELECT * FROM qfq
    ORDER BY trade_date DESC
    LIMIT ${safeLimit}
  `;
}

/** 产业链涨跌快照。d1 用 bfq.pct_chg，窗口是交易日序号。 */
export function priceSnapshotSql(bfqPath: string, adjPath: string, tsCodes: string[]): string {
  const bfq = sqlString(bfqPath);
  const adj = sqlString(adjPath);
  const codes = inList(tsCodes);
  return `
    WITH latest_adj AS (
      SELECT ts_code, adj_factor AS latest_adj
      FROM (
        SELECT ts_code, adj_factor,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM read_parquet('${adj}')
        WHERE ts_code IN (${codes})
      ) t
      WHERE rn = 1
    ),
    ranked AS (
      SELECT
        b.ts_code,
        b.trade_date,
        b.close * a.adj_factor / l.latest_adj AS close,
        b.pre_close * a.adj_factor / l.latest_adj AS pre_close,
        b.pct_chg,
        ROW_NUMBER() OVER (PARTITION BY b.ts_code ORDER BY b.trade_date DESC) AS rn
      FROM read_parquet('${bfq}') b
      ASOF LEFT JOIN read_parquet('${adj}') a
        ON b.ts_code = a.ts_code AND b.trade_date >= a.trade_date
      INNER JOIN latest_adj l ON b.ts_code = l.ts_code
      WHERE b.ts_code IN (${codes})
        AND b.close IS NOT NULL
        AND a.adj_factor IS NOT NULL
    ),
    pivoted AS (
      SELECT
        ts_code,
        MAX(CASE WHEN rn = 1 THEN strftime(trade_date, '%Y%m%d') END) AS trade_date,
        MAX(CASE WHEN rn = 1 THEN close END) AS latest_close,
        MAX(CASE WHEN rn = 1 THEN pre_close END) AS pre_close,
        MAX(CASE WHEN rn = 1 THEN pct_chg END) AS pct_chg,
        MAX(CASE WHEN rn = 2 THEN close END) AS close_1d,
        MAX(CASE WHEN rn = 6 THEN close END) AS close_5d,
        MAX(CASE WHEN rn = 21 THEN close END) AS close_20d,
        MAX(CASE WHEN rn = 61 THEN close END) AS close_60d
      FROM ranked
      WHERE rn <= 61
      GROUP BY ts_code
    )
    SELECT
      ts_code,
      trade_date,
      latest_close AS close,
      CASE
        WHEN pct_chg IS NOT NULL THEN pct_chg
        WHEN pre_close IS NOT NULL AND pre_close != 0 THEN (latest_close / pre_close - 1) * 100.0
        WHEN close_1d IS NOT NULL AND close_1d != 0 THEN (latest_close / close_1d - 1) * 100.0
        ELSE NULL
      END AS d1,
      CASE WHEN close_5d IS NOT NULL AND close_5d != 0 THEN (latest_close / close_5d - 1) * 100.0 ELSE NULL END AS d5,
      CASE WHEN close_20d IS NOT NULL AND close_20d != 0 THEN (latest_close / close_20d - 1) * 100.0 ELSE NULL END AS d20,
      CASE WHEN close_60d IS NOT NULL AND close_60d != 0 THEN (latest_close / close_60d - 1) * 100.0 ELSE NULL END AS d60
    FROM pivoted
    ORDER BY ts_code ASC
  `;
}

export function weekBreadthSql(bfqPath: string, tsCodes: string[], tradeDays: number): string {
  const bfq = sqlString(bfqPath);
  const codes = inList(tsCodes);
  const days = Math.max(1, Math.floor(tradeDays));
  return `
    WITH trade_days AS (
      SELECT trade_date
      FROM (
        SELECT DISTINCT trade_date
        FROM read_parquet('${bfq}')
        WHERE ts_code IN (${codes})
          AND close IS NOT NULL
        ORDER BY trade_date DESC
        LIMIT ${days}
      ) t
    )
    SELECT
      b.ts_code,
      strftime(b.trade_date, '%Y%m%d') AS trade_date,
      b.pct_chg
    FROM read_parquet('${bfq}') b
    INNER JOIN trade_days d ON b.trade_date = d.trade_date
    WHERE b.ts_code IN (${codes})
      AND b.close IS NOT NULL
  `;
}
