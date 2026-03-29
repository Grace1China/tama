import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';
import { createMetricEngine, type FinancialData, type MetricValue } from '@/lib/metrics/engine';
import { metrics } from '@/lib/metrics/definitions';
import { isValidPeriod, parsePeriod } from '@/lib/metrics/period';

export const dynamic = 'force-dynamic';

type RawRow = Record<string, unknown>;

function normalizeEndDateToPeriod(endDate: unknown): string | null {
  if (endDate == null) return null;
  const text = String(endDate).replace(/\D/g, '');
  if (!/^\d{8}$/.test(text)) return null;
  const year = text.slice(0, 4);
  const mmdd = text.slice(4);
  const map: Record<string, string> = {
    '0331': 'Q1',
    '0630': 'Q2',
    '0930': 'Q3',
    '1231': 'Q4',
  };
  const q = map[mmdd];
  return q ? `${year}${q}` : null;
}

function endDateSortKey(endDate: unknown): number {
  const text = String(endDate ?? '').replace(/\D/g, '');
  if (/^\d{8}$/.test(text)) return Number(text);
  return 0;
}

/** 同报告年度内上一季度 period，Q1 无上一季 */
function previousQuarterSameYear(period: string): string | null {
  const { year, quarter } = parsePeriod(period);
  if (quarter <= 1) return null;
  return `${year}Q${quarter - 1}`;
}

function readIncomeField(
  income: FinancialData['income'],
  period: string,
  keys: string[]
): number | null {
  const slice = income[period];
  if (!slice) return null;
  for (const key of keys) {
    const v = slice[key as keyof typeof slice];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * 从行里取数；可选 `deaccumulateQuarterly`：把利润表「当年累计」转为单季
 * （Q1=当期累计；Q2/Q3/Q4=当期累计−同年前一季度累计）。需按 end_date 升序遍历，且先写入累计列。
 */
function pickNumber(
  row: RawRow,
  keys: string[],
  opts?: { deaccumulateQuarterly?: boolean },
  ctx?: { income: FinancialData['income']; period: string }
): number | null {
  let current: number | null = null;
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const n = Number(value);
    if (!Number.isNaN(n)) {
      current = n;
      break;
    }
  }
  if (current == null) return null;
  if (!opts?.deaccumulateQuarterly || !ctx) return current;

  const { quarter } = parsePeriod(ctx.period);
  const prevP = previousQuarterSameYear(ctx.period);
  const prevYtd = prevP ? readIncomeField(ctx.income, prevP, keys) : null;
  if (quarter === 1) return current;
  if (prevYtd == null) return null;
  return current - prevYtd;
}

function latestPeriod(data: FinancialData): string | null {
  const periods = new Set<string>([
    ...Object.keys(data.income),
    ...Object.keys(data.balance),
    ...Object.keys(data.cashflow),
  ]);
  return Array.from(periods).sort().at(-1) ?? null;
}

function allPeriods(data: FinancialData): string[] {
  const periods = new Set<string>([
    ...Object.keys(data.income),
    ...Object.keys(data.balance),
    ...Object.keys(data.cashflow),
  ]);
  return Array.from(periods).sort();
}

function comparePeriod(a: string, b: string): number {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.quarter - pb.quarter;
}

function filterPeriodsInRange(periods: string[], from?: string | null, to?: string | null): string[] {
  const sorted = periods.slice().sort(comparePeriod);
  const start = from ? parsePeriod(from) : null;
  const end = to ? parsePeriod(to) : null;

  return sorted.filter((p) => {
    const cur = parsePeriod(p);
    if (start) {
      if (cur.year < start.year) return false;
      if (cur.year === start.year && cur.quarter < start.quarter) return false;
    }
    if (end) {
      if (cur.year > end.year) return false;
      if (cur.year === end.year && cur.quarter > end.quarter) return false;
    }
    return true;
  });
}

function queryParquetRows(parquetPath: string, stockCode: string): Promise<RawRow[]> {
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found: ${parquetPath}`);
  }
  const absolutePath = path.resolve(parquetPath).replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    const escapedStockCode = stockCode.replace(/'/g, "''");
    const sql = `SELECT * FROM read_parquet('${absolutePath}') WHERE ts_code='${escapedStockCode}'`;
    conn.all(sql, (err: Error | null, rows: RawRow[]) => {
      conn.close();
      db.close();
      if (err) {
        reject(new Error(`DuckDB query failed: ${err.message}`));
        return;
      }
      resolve(rows ?? []);
    });
  });
}

function normalizeFinancialData(
  incomeRows: RawRow[],
  balanceRows: RawRow[],
  cashflowRows: RawRow[]
): FinancialData {
  const data: FinancialData = {
    income: {},
    balance: {},
    cashflow: {},
  };

  const incomeSorted = [...incomeRows].sort(
    (a, b) => endDateSortKey(a.end_date) - endDateSortKey(b.end_date)
  );
  for (const row of incomeSorted) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.income[period] = {
      total_revenue: pickNumber(row, ['total_revenue']),
      total_cogs: pickNumber(row, ['total_cogs']),
      oper_cost: pickNumber(row, ['oper_cost']),
      n_income_attr_p: pickNumber(row, ['n_income_attr_p']),
      total_revenue_q: pickNumber(row, ['total_revenue'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      total_cogs_q: pickNumber(row, ['total_cogs'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      oper_cost_q: pickNumber(row, ['oper_cost'], { deaccumulateQuarterly: true }, { income: data.income, period }),
    };
  }

  for (const row of balanceRows) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.balance[period] = {
      total_hldr_eqy_exc_min_int: pickNumber(row, ['total_hldr_eqy_exc_min_int']),
    };
  }

  for (const row of cashflowRows) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.cashflow[period] = {
      n_cashflow_act: pickNumber(row, ['n_cashflow_act']),
    };
  }

  return data;
}

function toResult(metricName: string, value: MetricValue) {
  const meta = metrics[metricName]?.meta;
  return {
    value,
    label: meta?.label ?? metricName,
    unit: meta?.unit ?? null,
    precision: meta?.precision ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const stockCode = url.searchParams.get('stock') ?? url.searchParams.get('ts_code');
    const metric = url.searchParams.get('metric');
    const metricsParam = url.searchParams.get('metrics');
    const periodParam = url.searchParams.get('period');
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const periodsParam = url.searchParams.get('periods'); // comma-separated
    const series = url.searchParams.get('series') === 'true' || Boolean(fromParam || toParam || periodsParam);

    if (!stockCode) {
      return NextResponse.json({ error: 'Missing required query param: stock (or ts_code)' }, { status: 400 });
    }
    if (!metric && !metricsParam) {
      return NextResponse.json({ error: 'Missing required query param: metric or metrics' }, { status: 400 });
    }
    if (periodParam && !isValidPeriod(periodParam)) {
      return NextResponse.json({ error: 'Invalid period. Expected YYYYQ[1-4].' }, { status: 400 });
    }
    if (fromParam && !isValidPeriod(fromParam)) {
      return NextResponse.json({ error: 'Invalid from. Expected YYYYQ[1-4].' }, { status: 400 });
    }
    if (toParam && !isValidPeriod(toParam)) {
      return NextResponse.json({ error: 'Invalid to. Expected YYYYQ[1-4].' }, { status: 400 });
    }
    if (periodsParam) {
      const invalid = periodsParam
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .find((p) => !isValidPeriod(p));
      if (invalid) {
        return NextResponse.json({ error: `Invalid periods entry: ${invalid}. Expected YYYYQ[1-4].` }, { status: 400 });
      }
    }

    const [incomeRows, balanceRows, cashflowRows] = await Promise.all([
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/income_vip_ss.parquet'), stockCode),
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/balanceSheet_vip.parquet'), stockCode),
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/cashflow_vip_ss.parquet'), stockCode),
    ]);

    const data = normalizeFinancialData(incomeRows, balanceRows, cashflowRows);
    const available = allPeriods(data);
    if (available.length === 0) {
      return NextResponse.json({ error: `No financial rows found for stock ${stockCode}` }, { status: 404 });
    }

    const metricNames = metric
      ? [metric]
      : (metricsParam ?? '')
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);

    const engine = createMetricEngine(metrics);

    if (!series) {
      const period = periodParam ?? latestPeriod(data);
      if (!period) {
        return NextResponse.json({ error: `No financial rows found for stock ${stockCode}` }, { status: 404 });
      }
      const values = engine.calculateMany(metricNames, { stockCode, period, data });
      const results = Object.fromEntries(metricNames.map((name) => [name, toResult(name, values[name] ?? null)]));
      return NextResponse.json({
        stock: stockCode,
        period,
        results,
        diagnostics: {
          availablePeriods: {
            income: Object.keys(data.income).sort(),
            balance: Object.keys(data.balance).sort(),
            cashflow: Object.keys(data.cashflow).sort(),
          },
        },
      });
    }

    const periods = periodsParam
      ? periodsParam
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .sort(comparePeriod)
      : filterPeriodsInRange(available, fromParam, toParam);

    const points = periods.map((period) => {
      const values = engine.calculateMany(metricNames, { stockCode, period, data });
      const row: Record<string, unknown> = { period };
      for (const name of metricNames) {
        row[name] = values[name] ?? null;
      }
      return row;
    });

    return NextResponse.json({
      stock: stockCode,
      periods,
      metrics: Object.fromEntries(metricNames.map((name) => [name, metrics[name]?.meta ?? null])),
      points,
      diagnostics: {
        availablePeriods: {
          income: Object.keys(data.income).sort(),
          balance: Object.keys(data.balance).sort(),
          cashflow: Object.keys(data.cashflow).sort(),
        },
      },
    });
  } catch (error) {
    console.error('[Metrics API] Failed to calculate metrics', error);
    return NextResponse.json(
      {
        error: 'Failed to calculate metrics',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
