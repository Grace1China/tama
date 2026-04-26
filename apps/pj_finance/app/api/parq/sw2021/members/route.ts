import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const MEMBER_FILE = path.join(process.cwd(), 'temp/tuShare/index_member_all.parquet');
const CLASSIFY_FILE = path.join(process.cwd(), 'temp/tuShare/index_classify_SW2021.parquet');
const MEMBER_META_FILE = path.join(process.cwd(), 'temp/tuShare/_meta/index_member_all.csv');

const ALLOWED_SORT_FIELDS = new Set([
  'l1_code',
  'l1_name',
  'l2_code',
  'l2_name',
  'l3_code',
  'l3_name',
  'ts_code',
  'name',
  'in_date',
  'out_date',
  'is_new',
]);

type ClassifyRow = {
  index_code: string;
  industry_name: string;
  parent_code: string;
  level: 'L1' | 'L2' | 'L3' | string;
  industry_code: string;
};

function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
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

function parseMemberMeta(): { fields: string[]; labels: string[] } {
  const fallbackFields = ['l1_code', 'l1_name', 'l2_code', 'l2_name', 'l3_code', 'l3_name', 'ts_code', 'name', 'in_date', 'out_date', 'is_new'];
  const fallbackLabels = ['一级行业代码', '一级行业名称', '二级行业代码', '二级行业名称', '三级行业代码', '三级行业名称', '成分股票代码', '成分股票名称', '纳入日期', '剔除日期', '是否最新Y是N否'];
  try {
    if (!fs.existsSync(MEMBER_META_FILE)) return { fields: fallbackFields, labels: fallbackLabels };
    const raw = fs.readFileSync(MEMBER_META_FILE, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return { fields: fallbackFields, labels: fallbackLabels };
    const body = lines.slice(1);
    const fields: string[] = [];
    const labels: string[] = [];
    for (const line of body) {
      const parts = line.split('\t');
      const field = String(parts[0] ?? '').trim();
      const label = String(parts[3] ?? '').trim();
      if (!field) continue;
      fields.push(field);
      labels.push(label || field);
    }
    if (fields.length === 0) return { fields: fallbackFields, labels: fallbackLabels };
    return { fields, labels };
  } catch {
    return { fields: fallbackFields, labels: fallbackLabels };
  }
}

function collectDescendantIndexCodes(rows: ClassifyRow[], root: ClassifyRow): string[] {
  const byParent = new Map<string, ClassifyRow[]>();
  for (const row of rows) {
    const key = String(row.parent_code ?? '');
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  const queue: string[] = [String(root.industry_code)];
  const industryCodes = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const children = byParent.get(current) ?? [];
    for (const child of children) {
      const c = String(child.industry_code ?? '');
      if (!c || industryCodes.has(c)) continue;
      industryCodes.add(c);
      queue.push(c);
    }
  }

  const indexCodes = new Set<string>();
  for (const row of rows) {
    if (!industryCodes.has(String(row.industry_code ?? ''))) continue;
    const code = String(row.index_code ?? '').toUpperCase();
    if (code) indexCodes.add(code);
  }
  return [...indexCodes];
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const code = String(params.get('code') ?? '').trim().toUpperCase();
    const level = String(params.get('level') ?? '').toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    const page = Math.max(1, Math.floor(Number(params.get('page') ?? '1') || 1));
    const size = Math.max(1, Math.min(500, Math.floor(Number(params.get('size') ?? '50') || 50)));
    const offset = (page - 1) * size;

    const sortFieldRaw = String(params.get('sortField') ?? '').trim();
    const sortField = ALLOWED_SORT_FIELDS.has(sortFieldRaw) ? sortFieldRaw : 'ts_code';
    const sortDir = String(params.get('sortDir') ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const { fields: metaFields, labels: metaLabels } = parseMemberMeta();
    const selectedFields = metaFields.filter((f) => ALLOWED_SORT_FIELDS.has(f));
    const safeFields = selectedFields.length > 0 ? selectedFields : ['l1_code', 'l1_name', 'l2_code', 'l2_name', 'l3_code', 'l3_name', 'ts_code', 'name', 'in_date', 'out_date', 'is_new'];
    const headerLabels = safeFields.map((f) => {
      const idx = metaFields.indexOf(f);
      return idx >= 0 ? (metaLabels[idx] || f) : f;
    });

    const classifyPath = path.resolve(CLASSIFY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const escCode = code.replace(/'/g, "''");
    const classifyRows = await queryRows<ClassifyRow>(`
      SELECT index_code, industry_name, parent_code, level, industry_code
      FROM read_parquet('${classifyPath}')
      WHERE src = 'SW2021'
      ORDER BY industry_code ASC
    `);
    const root = classifyRows.find((r) => {
      if (String(r.index_code ?? '').toUpperCase() !== code) return false;
      if (!level) return true;
      return String(r.level ?? '').toUpperCase() === level;
    }) ?? classifyRows.find((r) => String(r.index_code ?? '').toUpperCase() === code);
    if (!root) {
      return NextResponse.json(
        { error: `Classify node not found for code: ${code}` },
        { status: 404 }
      );
    }
    const descendantCodes = collectDescendantIndexCodes(classifyRows, root);
    const codeList = descendantCodes.length > 0 ? descendantCodes : [code];
    const inCodes = codeList.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

    const includeExited = String(params.get('include_exited') ?? '').toLowerCase() === 'true';
    const where: string[] = [`(l1_code IN (${inCodes}) OR l2_code IN (${inCodes}) OR l3_code IN (${inCodes}))`];
    if (!includeExited) where.push('(out_date IS NULL OR CAST(out_date AS VARCHAR) = \'\')');
    where.push(`COALESCE(CAST(name AS VARCHAR), '') NOT LIKE '%退市%'`);
    const whereClause = `WHERE ${where.join(' AND ')}`;

    const filePath = path.resolve(MEMBER_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const countSql = `SELECT COUNT(*) AS cnt FROM read_parquet('${filePath}') ${whereClause}`;
    const dataSql = `
      SELECT ${safeFields.join(', ')}
      FROM read_parquet('${filePath}')
      ${whereClause}
      ORDER BY ${sortField} ${sortDir}
      LIMIT ${size} OFFSET ${offset}
    `;

    const countRows = await queryRows<{ cnt?: number }>(countSql);
    const totalRows = Number(countRows?.[0]?.cnt ?? 0);
    const data = await queryRows<Record<string, unknown>>(dataSql);

    return NextResponse.json({
      category: 'sw2021_members',
      filename: 'index_member_all',
      headers: headerLabels,
      originalHeaders: safeFields,
      data,
      totalRows,
    });
  } catch (error) {
    console.error('[sw2021/members] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query index_member_all parquet',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

