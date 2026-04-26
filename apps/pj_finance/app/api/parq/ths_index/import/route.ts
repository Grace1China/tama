import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

type ThsIndexRow = {
  ts_code: string;
  name: string;
  count: number;
  exchange: string;
  list_date: string;
  type: string;
};

type ThsIndexMemberRow = {
  ts_code: string;
  con_code: string;
  con_name: string;
  note: string;
  weight: number | null;
  in_date: string;
  out_date: string;
  is_new: string;
};

function sqlString(value: string): string {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function todayYYYYMMDD(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function parseIndexInfoFromFileName(fileName: string): { tsCode: string; indexName: string } {
  const base = path.basename(fileName, path.extname(fileName)).trim();
  const firstDash = base.indexOf('-');
  if (firstDash < 0) {
    throw new Error('文件名格式错误，期望为: ts_code-概念名称.xlsx');
  }
  const tsCode = base.slice(0, firstDash).trim();
  const indexName = base.slice(firstDash + 1).trim();
  if (!tsCode || !indexName) {
    throw new Error('文件名缺少 ts_code 或概念名称');
  }
  return { tsCode, indexName };
}

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

async function readIndexRows(parquetPath: string): Promise<ThsIndexRow[]> {
  if (!fs.existsSync(parquetPath)) return [];
  const safe = path.resolve(parquetPath).replace(/\\/g, '/').replace(/'/g, "''");
  return queryRows<ThsIndexRow>(`
    SELECT
      CAST(ts_code AS VARCHAR) AS ts_code,
      CAST(name AS VARCHAR) AS name,
      CAST(count AS BIGINT) AS count,
      CAST(exchange AS VARCHAR) AS exchange,
      CAST(list_date AS VARCHAR) AS list_date,
      CAST(type AS VARCHAR) AS type
    FROM read_parquet('${safe}')
  `);
}

async function readMemberRows(parquetPath: string): Promise<ThsIndexMemberRow[]> {
  if (!fs.existsSync(parquetPath)) return [];
  const safe = path.resolve(parquetPath).replace(/\\/g, '/').replace(/'/g, "''");
  return queryRows<ThsIndexMemberRow>(`
    SELECT
      CAST(ts_code AS VARCHAR) AS ts_code,
      CAST(con_code AS VARCHAR) AS con_code,
      CAST(con_name AS VARCHAR) AS con_name,
      CAST(note AS VARCHAR) AS note,
      CAST(weight AS DOUBLE) AS weight,
      CAST(in_date AS VARCHAR) AS in_date,
      CAST(out_date AS VARCHAR) AS out_date,
      CAST(is_new AS VARCHAR) AS is_new
    FROM read_parquet('${safe}')
  `);
}

function buildCreateAndInsertSqlForIndex(rows: ThsIndexRow[], parquetPath: string): string {
  const safeOut = path.resolve(parquetPath).replace(/\\/g, '/').replace(/'/g, "''");
  const values =
    rows.length > 0
      ? rows
          .map(
            (r) =>
              `(${sqlString(r.ts_code)}, ${sqlString(r.name)}, ${Number.isFinite(Number(r.count)) ? Number(r.count) : 0}, ${sqlString(
                r.exchange
              )}, ${sqlString(r.list_date)}, ${sqlString(r.type)})`
          )
          .join(', ')
      : null;

  if (!values) {
    return `
      CREATE OR REPLACE TABLE t(
        ts_code VARCHAR,
        name VARCHAR,
        count BIGINT,
        exchange VARCHAR,
        list_date VARCHAR,
        type VARCHAR
      );
      COPY t TO '${safeOut}' (FORMAT PARQUET);
    `;
  }

  return `
    CREATE OR REPLACE TABLE t AS
    SELECT * FROM (VALUES
      ${values}
    ) AS v(ts_code, name, count, exchange, list_date, type);
    COPY t TO '${safeOut}' (FORMAT PARQUET);
  `;
}

function buildCreateAndInsertSqlForMember(rows: ThsIndexMemberRow[], parquetPath: string): string {
  const safeOut = path.resolve(parquetPath).replace(/\\/g, '/').replace(/'/g, "''");
  const values =
    rows.length > 0
      ? rows
          .map((r) => {
            const weight = r.weight == null || !Number.isFinite(Number(r.weight)) ? 'NULL' : String(Number(r.weight));
            return `(${sqlString(r.ts_code)}, ${sqlString(r.con_code)}, ${sqlString(r.con_name)}, ${sqlString(r.note)}, ${weight}, ${sqlString(
              r.in_date
            )}, ${sqlString(r.out_date)}, ${sqlString(r.is_new)})`;
          })
          .join(', ')
      : null;

  if (!values) {
    return `
      CREATE OR REPLACE TABLE t(
        ts_code VARCHAR,
        con_code VARCHAR,
        con_name VARCHAR,
        note VARCHAR,
        weight DOUBLE,
        in_date VARCHAR,
        out_date VARCHAR,
        is_new VARCHAR
      );
      COPY t TO '${safeOut}' (FORMAT PARQUET);
    `;
  }

  return `
    CREATE OR REPLACE TABLE t AS
    SELECT * FROM (VALUES
      ${values}
    ) AS v(ts_code, con_code, con_name, note, weight, in_date, out_date, is_new);
    COPY t TO '${safeOut}' (FORMAT PARQUET);
  `;
}

async function executeSql(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    conn.exec(sql, (err: Error | null) => {
      conn.close();
      db.close();
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少上传文件 file' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json({ error: '仅支持 .xlsx 文件' }, { status: 400 });
    }

    const { tsCode, indexName } = parseIndexInfoFromFileName(file.name);
    const importDate = todayYYYYMMDD();
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: 'Excel 文件无工作表' }, { status: 400 });
    }

    const sheet = workbook.Sheets[sheetName];
    const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const importedMemberMap = new Map<string, ThsIndexMemberRow>();
    for (const row of parsedRows) {
      const conCode = String(row['股票代码'] ?? '').trim().toUpperCase();
      if (!conCode) continue;
      const conName = String(row['股票简称'] ?? '').trim();
      const note = String(row['概念解析'] ?? '').trim();
      importedMemberMap.set(conCode, {
        ts_code: tsCode,
        con_code: conCode,
        con_name: conName,
        note,
        weight: null,
        in_date: importDate,
        out_date: '',
        is_new: 'Y',
      });
    }

    const importedMembers = [...importedMemberMap.values()];
    if (importedMembers.length === 0) {
      return NextResponse.json({ error: 'Excel 中未解析到有效成员（股票代码列为空）' }, { status: 400 });
    }

    const baseDir = path.join(process.cwd(), 'temp/tuShare');
    const indexParquetPath = path.join(baseDir, 'ths_index.parquet');
    const memberParquetPath = path.join(baseDir, 'ths_index_member.parquet');
    fs.mkdirSync(baseDir, { recursive: true });

    const existingMembers = await readMemberRows(memberParquetPath);
    const mergedMembers = new Map<string, ThsIndexMemberRow>();
    for (const row of existingMembers) {
      const key = `${String(row.ts_code ?? '').toUpperCase()}|${String(row.con_code ?? '').toUpperCase()}`;
      mergedMembers.set(key, {
        ts_code: String(row.ts_code ?? '').toUpperCase(),
        con_code: String(row.con_code ?? '').toUpperCase(),
        con_name: String(row.con_name ?? '').trim(),
        note: String(row.note ?? '').trim(),
        weight: row.weight == null ? null : Number(row.weight),
        in_date: String(row.in_date ?? '').trim(),
        out_date: String(row.out_date ?? '').trim(),
        is_new: String(row.is_new ?? '').trim() || 'Y',
      });
    }
    for (const row of importedMembers) {
      const key = `${row.ts_code}|${row.con_code}`;
      const old = mergedMembers.get(key);
      mergedMembers.set(key, {
        ...row,
        weight: old?.weight ?? null,
        out_date: '',
        is_new: 'Y',
      });
    }
    const finalMembers = [...mergedMembers.values()].sort((a, b) => {
      if (a.ts_code !== b.ts_code) return a.ts_code.localeCompare(b.ts_code);
      return a.con_code.localeCompare(b.con_code);
    });

    const tsMembers = finalMembers.filter((r) => r.ts_code === tsCode && String(r.is_new ?? 'Y').toUpperCase() === 'Y');
    const conceptCount = new Set(tsMembers.map((r) => r.con_code)).size;

    const existingIndex = await readIndexRows(indexParquetPath);
    const indexMap = new Map<string, ThsIndexRow>();
    for (const row of existingIndex) {
      const code = String(row.ts_code ?? '').trim().toUpperCase();
      if (!code) continue;
      indexMap.set(code, {
        ts_code: code,
        name: String(row.name ?? '').trim(),
        count: Number(row.count ?? 0) || 0,
        exchange: String(row.exchange ?? '').trim(),
        list_date: String(row.list_date ?? '').trim(),
        type: String(row.type ?? '').trim(),
      });
    }

    const oldIndex = indexMap.get(tsCode);
    indexMap.set(tsCode, {
      ts_code: tsCode,
      name: indexName,
      count: conceptCount,
      exchange: oldIndex?.exchange ?? '',
      list_date: oldIndex?.list_date || importDate,
      type: oldIndex?.type || 'N',
    });
    const finalIndex = [...indexMap.values()].sort((a, b) => a.ts_code.localeCompare(b.ts_code));

    await executeSql(buildCreateAndInsertSqlForMember(finalMembers, memberParquetPath));
    await executeSql(buildCreateAndInsertSqlForIndex(finalIndex, indexParquetPath));

    return NextResponse.json({
      ok: true,
      ts_code: tsCode,
      name: indexName,
      importDate,
      importedRows: importedMembers.length,
      currentCount: conceptCount,
      totalIndexRows: finalIndex.length,
      totalMemberRows: finalMembers.length,
      files: {
        ths_index: indexParquetPath,
        ths_index_member: memberParquetPath,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '导入 ths_index 失败',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
