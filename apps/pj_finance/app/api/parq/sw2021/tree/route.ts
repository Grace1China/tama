import { NextResponse } from 'next/server';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

type ClassifyRow = {
  index_code: string;
  industry_name: string;
  parent_code: string;
  level: 'L1' | 'L2' | 'L3' | string;
  industry_code: string;
  /** parquet 原始 industry_growth（可为小数增长率）；解析后见 TreeNode.industry_growth */
  industry_growth?: number | null;
};

type TreeNode = {
  indexCode: string;
  industryCode: string;
  parentCode: string;
  name: string;
  level: 'L1' | 'L2' | 'L3' | string;
  memberCount: number;
  /** 百分数口径（如 24 表示 24%）；来自 parquet 小数增长率时已换算；无字段或空则为 null */
  industry_growth: number | null;
  children: TreeNode[];
};

const CLASSIFY_FILE = path.join(process.cwd(), 'temp/tuShare/index_classify_SW2021.parquet');
const MEMBER_FILE = path.join(process.cwd(), 'temp/tuShare/index_member_all.parquet');

type MemberRow = {
  l1_code: string | null;
  l2_code: string | null;
  l3_code: string | null;
  ts_code: string | null;
};

function queryAll<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    conn.all(sql, (err: Error | null, rows: Record<string, unknown>[] | undefined) => {
      conn.close();
      db.close();
      if (err) {
        reject(err);
        return;
      }
      resolve((rows ?? []) as T[]);
    });
  });
}

function parseIndustryGrowth(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  // Tushare 分类表多为小数增长率（0.24 表示 24%）；已是「百分数书写」且 |n|>1 时不再放大，避免重复缩放
  if (Math.abs(n) <= 1) return n * 100;
  return n;
}

async function queryClassifyRows(classifyPathEscaped: string): Promise<ClassifyRow[]> {
  const sqlWithGrowth = `
    SELECT index_code, industry_name, parent_code, level, industry_code,
           TRY_CAST(industry_growth AS DOUBLE) AS industry_growth
    FROM read_parquet('${classifyPathEscaped}')
    WHERE src = 'SW2021'
    ORDER BY industry_code ASC
  `;
  const sqlBase = `
    SELECT index_code, industry_name, parent_code, level, industry_code
    FROM read_parquet('${classifyPathEscaped}')
    WHERE src = 'SW2021'
    ORDER BY industry_code ASC
  `;
  try {
    const rows = await queryAll<ClassifyRow>(sqlWithGrowth);
    return rows.map((r) => ({
      ...r,
      industry_growth: parseIndustryGrowth(r.industry_growth),
    }));
  } catch {
    const rows = await queryAll<Omit<ClassifyRow, 'industry_growth'>>(sqlBase);
    return rows.map((r) => ({ ...r, industry_growth: null }));
  }
}

export async function GET() {
  try {
    const classifyPath = path.resolve(CLASSIFY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const memberPath = path.resolve(MEMBER_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const memberSql = `
      SELECT l1_code, l2_code, l3_code, ts_code
      FROM read_parquet('${memberPath}')
      WHERE out_date IS NULL OR CAST(out_date AS VARCHAR) = ''
    `;
    const [rows, memberRows] = await Promise.all([
      queryClassifyRows(classifyPath),
      queryAll<MemberRow>(memberSql),
    ]);

    const directStocks = new Map<string, Set<string>>();
    const addStock = (indexCode: string | null, tsCode: string | null) => {
      const idx = String(indexCode ?? '').trim().toUpperCase();
      const ts = String(tsCode ?? '').trim().toUpperCase();
      if (!idx || !ts) return;
      const set = directStocks.get(idx) ?? new Set<string>();
      set.add(ts);
      directStocks.set(idx, set);
    };
    for (const m of memberRows) {
      addStock(m.l1_code, m.ts_code);
      addStock(m.l2_code, m.ts_code);
      addStock(m.l3_code, m.ts_code);
    }

    const byParent = new Map<string, ClassifyRow[]>();
    for (const row of rows) {
      const key = String(row.parent_code ?? '');
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    const build = (parentCode: string): Array<{ node: TreeNode; stocks: Set<string> }> => {
      const children = byParent.get(parentCode) ?? [];
      return children.map((row) => ({
        ...(() => {
          const indexCode = String(row.index_code ?? '');
          const childBuilt = build(String(row.industry_code ?? ''));
          const stocks = new Set<string>(directStocks.get(indexCode) ?? []);
          for (const child of childBuilt) {
            child.stocks.forEach((s) => stocks.add(s));
          }
          const industry_growth = row.industry_growth ?? null;
          const node: TreeNode = {
            indexCode,
            industryCode: String(row.industry_code ?? ''),
            parentCode: String(row.parent_code ?? ''),
            name: String(row.industry_name ?? ''),
            level: row.level,
            memberCount: stocks.size,
            industry_growth,
            children: childBuilt.map((c) => c.node),
          };
          return { node, stocks };
        })(),
      }));
    };

    const tree = build('0').map((x) => x.node);
    return NextResponse.json({
      tree,
      totalRows: rows.length,
      levels: {
        l1: rows.filter((r) => r.level === 'L1').length,
        l2: rows.filter((r) => r.level === 'L2').length,
        l3: rows.filter((r) => r.level === 'L3').length,
      },
    });
  } catch (error) {
    console.error('[sw2021/tree] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to load SW2021 classify tree',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

