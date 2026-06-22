#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { fetchPInfo3085Json } from '../lib/cninfo/fetchPInfo3085Server';

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
type DisclosureRecord = Record<string, string | number | null | undefined>;
type ActiveHttpSession = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

const MCP_DIR = __dirname;
const APP_ROOT = path.resolve(MCP_DIR, '..');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const duckdb = requireFromApp('duckdb') as typeof import('duckdb');
const YAML = requireFromApp('yaml') as typeof import('yaml');
const execFileAsync = promisify(execFile);

const TEMP_DIR = path.join(APP_ROOT, 'temp');
const TUSHARE_DIR = path.join(TEMP_DIR, 'tuShare');
const REPORT_DIR = path.join(TEMP_DIR, 'cninfo', 'report');
const TAXONOMY_DIR = path.join(APP_ROOT, 'app', 'industryLink', 'taxonomies');
const COMPANY_CODE_MAP_PATH = path.join(APP_ROOT, 'app', 'industryLink', 'industry_company_ts_codes.yaml');
const RESEARCH_LOG_DIR = path.join(APP_ROOT, 'app', 'industryLink', 'research_logs');
const INDUSTRY_INDEX_DIR = path.join(MCP_DIR, 'data', 'industry_chain_index');
const INDUSTRY_INDEX_SCRIPT = path.join(MCP_DIR, 'build_industry_chain_index.py');

/** 开发时把运行日志写到 stderr，不干扰 MCP stdio 协议 */
function devLog(message: string, extra?: unknown) {
  if (process.env.MCP_DEV_LOG !== '1') return;
  const suffix = extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  console.error(`[pj-finance-mcp] ${message}${suffix}`);
}

const INDUSTRY_EVIDENCE_KEYWORDS = {
  产品: ['主要产品', '主要產品', '主营业务', '主營業務', '产品系列', '產品系列', '产品及应用', '產品及應用', '主要业务', '主要業務'],
  行业空间: ['行业发展', '行業發展', '市场规模', '市場規模', '市场空间', '市場空間', '市场需求', '市場需求', '发展趋势', '發展趨勢', 'LightCounting', 'Yole', 'MarketsandMarkets', 'CAGR', '复合增长率', '複合增長率'],
  护城河: ['核心竞争力', '核心競爭力', '竞争优势', '競爭優勢', '市场地位', '市場地位', '客户', '客戶', '垂直整合', '規模製造', '规模制造', '质量体系', '質量體系'],
  技术壁垒: ['核心技术', '核心技術', '研发项目', '研發項目', '研发投入', '研發投入', '技术平台', '技術平台', '技术壁垒', '技術壁壘', '关键技术', '關鍵技術', '专利', '專利'],
} as const;

const parquetTables: Record<string, { file: string; defaultDateField?: string; maxRows: number }> = {
  income: { file: 'income_vip_ss.parquet', defaultDateField: 'end_date', maxRows: 200 },
  cashflow: { file: 'cashflow_vip_ss.parquet', defaultDateField: 'end_date', maxRows: 200 },
  balance: { file: 'balancesheet_vip_ss.parquet', defaultDateField: 'end_date', maxRows: 200 },
  fina_indicator: { file: 'fina_indicator_vip_ss.parquet', defaultDateField: 'end_date', maxRows: 200 },
  daily_basic: { file: 'daily_basic.parquet', defaultDateField: 'trade_date', maxRows: 300 },
  sw_daily: { file: 'sw_daily.parquet', defaultDateField: 'trade_date', maxRows: 300 },
  index_member_all: { file: 'index_member_all.parquet', maxRows: 500 },
  index_classify_SW2021: { file: 'index_classify_SW2021.parquet', maxRows: 500 },
};

const tools = [
  {
    name: 'cninfo_list_disclosures',
    description: '获取巨潮 p_info3085 公告列表。输入 Tushare ts_code 或 6 位证券代码。',
    inputSchema: {
      type: 'object',
      properties: {
        ts_code: { type: 'string', description: '如 600176.SH，也可传 600176' },
        limit: { type: 'number', description: '最多返回条数，默认 50' },
      },
      required: ['ts_code'],
    },
  },
  {
    name: 'cninfo_download_annual_report',
    description: '下载指定年份年报 PDF，返回本地路径和巨潮链接。',
    inputSchema: {
      type: 'object',
      properties: {
        ts_code: { type: 'string' },
        year: { type: 'number' },
      },
      required: ['ts_code', 'year'],
    },
  },
  {
    name: 'cninfo_search_pdf',
    description: '在指定年份年报 PDF 中搜索关键词；若本地无 PDF，会先尝试下载。',
    inputSchema: {
      type: 'object',
      properties: {
        ts_code: { type: 'string' },
        year: { type: 'number' },
        keywords: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: '如 T800 / T1100 / 碳纤维 / 预浸料',
        },
        context_chars: { type: 'number', description: '命中上下文长度，默认 80' },
      },
      required: ['ts_code', 'year', 'keywords'],
    },
  },
  {
    name: 'finance_metrics',
    description: '返回收入、利润、毛利率、现金流、资产负债等年度和 TTM 摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        ts_code: { type: 'string' },
        annual_years: { type: 'number', description: '年度条数，默认 5' },
      },
      required: ['ts_code'],
    },
  },
  {
    name: 'parquet_query',
    description: '安全查询白名单 parquet 表，不开放任意 SQL。',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(parquetTables) },
        ts_code: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
        start_date: { type: 'string', description: 'YYYYMMDD，可选' },
        end_date: { type: 'string', description: 'YYYYMMDD，可选' },
        limit: { type: 'number' },
      },
      required: ['table'],
    },
  },
  {
    name: 'industry_taxonomy_list',
    description: '列出当前启用的产业链 taxonomy，包括 id、名称、顺序和公司数量。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'industry_taxonomy_get',
    description: '按 taxonomy id 读取一个产业链 YAML 的完整结构。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '如 optical_communication；也可传文件名不带 .yaml' },
      },
      required: ['id'],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'industry_company_context',
    description: '跨全部 taxonomy 查找公司，返回所在产业链、阶段、子赛道、入选理由、弹性因子和风险。',
    inputSchema: {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
      },
      required: ['company_name'],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'industry_chain_index_preview',
    description: '预览产业链指数成分。读取 taxonomy 中公司及指数纳入、业务纯度、手工权重字段，不取行情、不写文件。',
    inputSchema: {
      type: 'object',
      properties: {
        taxonomy_id: { type: 'string', description: '如 optical_communication、copper、tao' },
      },
      required: ['taxonomy_id'],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'industry_chain_index_build',
    description: '根据产业链 taxonomy 成分构建研究指数，并把日度指数与基日成分权重写入一个 parquet 文件。',
    inputSchema: {
      type: 'object',
      properties: {
        taxonomy_id: { type: 'string' },
        start_date: { type: 'string', description: 'YYYYMMDD' },
        end_date: { type: 'string', description: 'YYYYMMDD' },
        weight_method: {
          type: 'string',
          enum: ['equal', 'float_mv', 'capped_float_mv', 'chain_balanced', 'manual'],
          description: '默认 chain_balanced：子泳道等预算，泳道内按 sqrt(流通市值)×业务纯度分配',
        },
        max_weight: { type: 'number', description: '单一成分权重上限，默认 0.10' },
        base_value: { type: 'number', description: '基点，默认 1000' },
        output_path: { type: 'string', description: '可选；必须位于 pj_finance 目录内，默认 mcp/data/industry_chain_index/<id>_<日期>.parquet' },
        price_parquet: { type: 'string', description: '可选本地测试/缓存行情，字段需含 ts_code/trade_date/close；不传则用 Tushare 前复权行情' },
        market_cap_parquet: { type: 'string', description: '可选本地市值表，字段需含 ts_code/trade_date/circ_mv' },
      },
      required: ['taxonomy_id', 'start_date', 'end_date'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'industry_company_evidence',
    description: '仅处理一个产业链YAML中的一个公司：从年报PDF和本地财务数据抽取证据并生成日志。回写时必须通过 analysis_fields 提交研究归纳后的五个字段，禁止把原始命中切片直接写入 taxonomy。',
    inputSchema: {
      type: 'object',
      properties: {
        taxonomy_id: { type: 'string', description: 'app/industryLink/taxonomies/<taxonomy_id>.yaml，如 tao、copper、optical_communication' },
        company_name: { type: 'string', description: '如 中际旭创；一次只处理一个公司，避免批量触发巨潮反爬' },
        year: { type: 'number', description: '年报年份，默认2025' },
        apply: { type: 'boolean', description: '是否将研究归纳字段回写到对应 taxonomy yaml，默认 false；为 true 时必须传 analysis_fields' },
        analysis_fields: {
          type: 'object',
          description: '研究代理基于证据归纳后的结论，不应粘贴原始年报长切片。',
          properties: {
            产品: { type: 'string' },
            成长性: { type: 'string' },
            行业空间: { type: 'string' },
            护城河: { type: 'string' },
            技术壁垒: { type: 'string' },
          },
          required: ['产品', '成长性', '行业空间', '护城河', '技术壁垒'],
        },
      },
      required: ['taxonomy_id', 'company_name'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
];

function textResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, jsonReplacer, 2) }] };
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function argString(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!required) return '';
  throw new Error(`${key} is required`);
}

function argNumber(args: Record<string, unknown>, key: string, fallback?: number): number {
  const value = args[key];
  if (value == null || value === '') {
    if (fallback != null) return fallback;
    throw new Error(`${key} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

function normalizeTsCode(input: string): string {
  const s = input.trim().toUpperCase();
  if (/^\d{6}\.(SZ|SH|BJ)$/.test(s)) return s;
  if (/^\d{6}$/.test(s)) {
    if (s.startsWith('6')) return `${s}.SH`;
    if (s.startsWith('8') || s.startsWith('4') || s.startsWith('9')) return `${s}.BJ`;
    return `${s}.SZ`;
  }
  throw new Error(`invalid ts_code: ${input}`);
}

function tsCodeToScode(input: string): string {
  const m = input.trim().toUpperCase().match(/^(\d{6})(?:\.(SZ|SH|BJ))?$/);
  if (!m) throw new Error(`invalid ts_code: ${input}`);
  return m[1];
}

function safeFilePart(s: string, maxLen = 80): string {
  return s
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[/\\:*?"<>|]/g, '')
    .slice(0, maxLen)
    .replace(/^\.+|\.+$/g, '') || 'annual_report';
}

function parquetPath(table: string): string {
  const info = parquetTables[table];
  if (!info) throw new Error(`unsupported table: ${table}`);
  const filePath = path.join(TUSHARE_DIR, info.file);
  if (!fs.existsSync(filePath)) throw new Error(`parquet file not found: ${filePath}`);
  return filePath;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/'/g, "''");
}

function dateDigits(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10).replace(/-/g, '');
  }
  return String(value ?? '').replace(/\D/g, '');
}

function rowNumberLatestSql(sourceSql: string): string {
  return `
    SELECT * EXCLUDE(rn)
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ts_code, end_date
        ORDER BY ann_date DESC NULLS LAST, f_ann_date DESC NULLS LAST, report_type ASC NULLS LAST
      ) AS rn
      FROM (${sourceSql})
    )
    WHERE rn = 1
  `;
}

function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    conn.all(sql, (err: Error | null, rows: unknown) => {
      conn.close();
      db.close();
      if (err) reject(new Error(`DuckDB query failed: ${err.message}`));
      else resolve(Array.isArray(rows) ? (rows as T[]) : []);
    });
  });
}

async function describeParquet(table: string): Promise<Array<{ column_name: string; column_type: string }>> {
  const rows = await queryRows<{ column_name: string; column_type: string }>(
    `DESCRIBE SELECT * FROM read_parquet('${sqlPath(parquetPath(table))}')`
  );
  return rows;
}

async function cninfoListDisclosures(args: Record<string, unknown>) {
  const tsCode = normalizeTsCode(argString(args, 'ts_code'));
  const scode = tsCodeToScode(tsCode);
  const limit = Math.max(1, Math.min(500, Math.floor(argNumber(args, 'limit', 50))));
  const result = await fetchPInfo3085Json(scode);
  if (result.ok === false) throw new Error(result.error);
  const records = (result.json.records ?? []).slice(0, limit).map(normalizeDisclosure);
  return {
    ts_code: tsCode,
    scode,
    total: result.json.total ?? records.length,
    records,
  };
}

function normalizeDisclosure(r: DisclosureRecord) {
  return {
    announce_date: String(r.F001D ?? ''),
    title: String(r.F002V ?? ''),
    url: String(r.F003V ?? ''),
    format: String(r.F004V ?? ''),
    raw: r,
  };
}

function isPdfRecord(r: DisclosureRecord): boolean {
  const fmt = String(r.F004V ?? '').toUpperCase();
  const url = String(r.F003V ?? '');
  return fmt.includes('PDF') && /^https?:\/\//i.test(url);
}

function pickAnnualReportPdf(records: DisclosureRecord[], year: number): DisclosureRecord | null {
  const annualRe = /年报|年度报告/;
  const yearRe = new RegExp(String(year));
  const cnYear = String(year).replace(/0/g, '[〇零0]').replace(/1/g, '[一1]').replace(/2/g, '[二2]').replace(/3/g, '[三3]').replace(/4/g, '[四4]').replace(/5/g, '[五5]').replace(/6/g, '[六6]').replace(/7/g, '[七7]').replace(/8/g, '[八8]').replace(/9/g, '[九9]');
  const cnYearRe = new RegExp(cnYear);
  const excludeRe = /摘要|英文版|English|临时公告|审计工作进展|专项说明|提示性公告|业绩说明会|集体接待日|披露提示/;
  const candidates = records
    .filter((rec) => {
      const title = String(rec.F002V ?? '');
      return isPdfRecord(rec) && annualRe.test(title) && (yearRe.test(title) || cnYearRe.test(title)) && !excludeRe.test(title);
    })
    .map((rec) => {
      const t = Date.parse(String(rec.F001D ?? '').replace(/\//g, '-').slice(0, 10));
      return { rec, t: Number.isFinite(t) ? t : 0 };
    })
    .sort((a, b) => b.t - a.t);
  return candidates[0]?.rec ?? null;
}

async function downloadPdf(destPath: string, pdfUrl: string) {
  const res = await fetch(pdfUrl, {
    headers: {
      Referer: 'https://www.cninfo.com.cn/',
      'User-Agent': 'Mozilla/5.0 (pj-finance-mcp)',
    },
  });
  if (!res.ok || !res.body) throw new Error(`PDF HTTP ${res.status}`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const fileStream = fs.createWriteStream(destPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);
}

async function cninfoDownloadAnnualReport(args: Record<string, unknown>) {
  const tsCode = normalizeTsCode(argString(args, 'ts_code'));
  const year = Math.floor(argNumber(args, 'year'));
  const scode = tsCodeToScode(tsCode);
  const result = await fetchPInfo3085Json(scode);
  if (result.ok === false) throw new Error(result.error);
  const picked = pickAnnualReportPdf(result.json.records ?? [], year);
  if (!picked) throw new Error(`no annual report PDF found for ${tsCode} ${year}`);

  const title = String(picked.F002V ?? `${year}年年度报告`);
  const pdfUrl = String(picked.F003V ?? '');
  const slug = crypto.createHash('sha1').update(`${pdfUrl}\n${title}`).digest('hex').slice(0, 12);
  const destPath = path.join(REPORT_DIR, `${tsCode}_${year}_${slug}_${safeFilePart(title)}.pdf`);
  if (!fs.existsSync(destPath)) await downloadPdf(destPath, pdfUrl);
  const st = fs.statSync(destPath);
  return {
    ts_code: tsCode,
    scode,
    year,
    title,
    announce_date: String(picked.F001D ?? ''),
    cninfo_url: pdfUrl,
    local_path: destPath,
    bytes: st.size,
  };
}

function findLocalAnnualReport(tsCode: string, year: number): string | null {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const files = fs.readdirSync(REPORT_DIR);
  const prefix = `${tsCode}_`;
  const yearRe = new RegExp(String(year));
  const excludeRe = /摘要|英文版|English|临时公告|审计工作进展|专项说明|提示性公告|业绩说明会|集体接待日|披露提示/;
  const hit = files.find((name) =>
    name.startsWith(prefix)
    && yearRe.test(name)
    && /\.pdf$/i.test(name)
    && !excludeRe.test(name)
  );
  return hit ? path.join(REPORT_DIR, hit) : null;
}

type PdfPageText = { page: number; text: string };

async function extractPdfPages(pdfPath: string): Promise<PdfPageText[]> {
  const py = [
    'import sys',
    'import json',
    'path=sys.argv[1]',
    'try:',
    '    import fitz',
    '    doc=fitz.open(path)',
    '    pages=[{"page": i + 1, "text": page.get_text("text")} for i, page in enumerate(doc)]',
    '    print(json.dumps(pages, ensure_ascii=False))',
    'except Exception as e:',
    '    try:',
    '        from pypdf import PdfReader',
    '        reader=PdfReader(path)',
    '        pages=[{"page": i + 1, "text": (p.extract_text() or "")} for i, p in enumerate(reader.pages)]',
    '        print(json.dumps(pages, ensure_ascii=False))',
    '    except Exception as e2:',
    '        raise SystemExit(f"PDF text extraction failed: {e}; fallback failed: {e2}")',
  ].join('\n');
  const { stdout } = await execFileAsync('python', ['-c', py, pdfPath], { maxBuffer: 80 * 1024 * 1024 });
  return JSON.parse(stdout) as PdfPageText[];
}

async function cninfoSearchPdf(args: Record<string, unknown>) {
  const tsCode = normalizeTsCode(argString(args, 'ts_code'));
  const year = Math.floor(argNumber(args, 'year'));
  const keywordsRaw = args.keywords;
  const keywords = Array.isArray(keywordsRaw) ? keywordsRaw.map(String).filter(Boolean) : [String(keywordsRaw ?? '').trim()].filter(Boolean);
  if (keywords.length === 0) throw new Error('keywords is required');
  const contextChars = Math.max(20, Math.min(500, Math.floor(argNumber(args, 'context_chars', 80))));
  const local = findLocalAnnualReport(tsCode, year) ?? (await cninfoDownloadAnnualReport({ ts_code: tsCode, year })).local_path;
  const pages = (await extractPdfPages(local)).map((page) => ({
    page: page.page,
    text: page.text.replace(/\s+/g, ' '),
  }));
  const matches = keywords.map((keyword) => {
    const lowerKeyword = keyword.toLowerCase();
    const hits: Array<{ page: number; index: number; context: string }> = [];
    for (const page of pages) {
      const lowerText = page.text.toLowerCase();
      let pos = 0;
      while (hits.length < 30) {
        const idx = lowerText.indexOf(lowerKeyword, pos);
        if (idx < 0) break;
        hits.push({
          page: page.page,
          index: idx,
          context: page.text.slice(Math.max(0, idx - contextChars), Math.min(page.text.length, idx + keyword.length + contextChars)),
        });
        pos = idx + Math.max(1, keyword.length);
      }
      if (hits.length >= 30) break;
    }
    return { keyword, count: hits.length, hits };
  });
  return { ts_code: tsCode, year, local_path: local, keywords, matches };
}

function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yi(v: unknown): number | null {
  const n = numberOrNull(v);
  return n == null ? null : Number((n / 1e8).toFixed(4));
}

function rowByEndDate<T extends Record<string, unknown>>(rows: T[], endDate: string): T | null {
  return rows.find((r) => dateDigits(r.end_date) === endDate) ?? null;
}

function ttmFromYtd(rows: Record<string, unknown>[], latest: Record<string, unknown>, field: string): number | null {
  const end = dateDigits(latest.end_date);
  if (!/^\d{8}$/.test(end)) return null;
  if (end.endsWith('1231')) return numberOrNull(latest[field]);
  const year = Number(end.slice(0, 4));
  const mmdd = end.slice(4);
  const prevAnnual = rowByEndDate(rows, `${year - 1}1231`);
  const prevSameQuarter = rowByEndDate(rows, `${year - 1}${mmdd}`);
  const cur = numberOrNull(latest[field]);
  const prevA = numberOrNull(prevAnnual?.[field]);
  const prevQ = numberOrNull(prevSameQuarter?.[field]);
  if (cur == null || prevA == null || prevQ == null) return null;
  return cur + prevA - prevQ;
}

async function financeMetrics(args: Record<string, unknown>) {
  const tsCode = normalizeTsCode(argString(args, 'ts_code'));
  const annualYears = Math.max(1, Math.min(10, Math.floor(argNumber(args, 'annual_years', 5))));
  const esc = sqlString(tsCode);
  const incomePath = sqlPath(parquetPath('income'));
  const cashflowPath = sqlPath(parquetPath('cashflow'));
  const balancePath = sqlPath(parquetPath('balance'));
  const indicatorPath = sqlPath(parquetPath('fina_indicator'));
  const dailyPath = sqlPath(parquetPath('daily_basic'));

  const income = await queryRows(`${rowNumberLatestSql(`SELECT * FROM read_parquet('${incomePath}') WHERE ts_code=${esc}`)} ORDER BY end_date ASC`);
  const cashflow = await queryRows(`${rowNumberLatestSql(`SELECT * FROM read_parquet('${cashflowPath}') WHERE ts_code=${esc}`)} ORDER BY end_date ASC`);
  const balance = await queryRows(`${rowNumberLatestSql(`SELECT * FROM read_parquet('${balancePath}') WHERE ts_code=${esc}`)} ORDER BY end_date ASC`);
  const indicator = await queryRows(`SELECT * FROM read_parquet('${indicatorPath}') WHERE ts_code=${esc} QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code, end_date ORDER BY ann_date DESC NULLS LAST) = 1 ORDER BY end_date ASC`);
  const marketRows = await queryRows(`SELECT * FROM read_parquet('${dailyPath}') WHERE ts_code=${esc} ORDER BY trade_date DESC LIMIT 1`);

  const annualEndDates = income
    .map((r) => dateDigits(r.end_date))
    .filter((d) => d.endsWith('1231'))
    .sort()
    .slice(-annualYears);

  const annual = annualEndDates.map((endDate) => {
    const inc = rowByEndDate(income, endDate) ?? {};
    const cf = rowByEndDate(cashflow, endDate) ?? {};
    const bal = rowByEndDate(balance, endDate) ?? {};
    const ind = rowByEndDate(indicator, endDate) ?? {};
    return {
      end_date: endDate,
      revenue_yi: yi(inc.total_revenue),
      net_profit_parent_yi: yi(inc.n_income_attr_p),
      gross_margin_pct: numberOrNull(ind.grossprofit_margin ?? ind.gross_margin),
      roe_pct: numberOrNull(ind.roe),
      operating_cashflow_yi: yi(cf.n_cashflow_act),
      total_assets_yi: yi(bal.total_assets),
      total_liab_yi: yi(bal.total_liab),
      debt_to_assets_pct: numberOrNull(ind.debt_to_assets),
    };
  });

  const latestIncome = income.at(-1) ?? {};
  const latestCashflow = cashflow.at(-1) ?? {};
  const latestBalance = balance.at(-1) ?? {};
  const latestIndicator = indicator.at(-1) ?? {};
  const latestMarket = marketRows[0] ?? {};
  const ttmRevenue = ttmFromYtd(income, latestIncome, 'total_revenue');
  const ttmNp = ttmFromYtd(income, latestIncome, 'n_income_attr_p');
  const ttmOcf = ttmFromYtd(cashflow, latestCashflow, 'n_cashflow_act');

  return {
    ts_code: tsCode,
    latest_period: dateDigits(latestIncome.end_date),
    ttm: {
      revenue_yi: yi(ttmRevenue),
      net_profit_parent_yi: yi(ttmNp),
      operating_cashflow_yi: yi(ttmOcf),
      net_margin_pct: ttmRevenue && ttmNp ? Number((ttmNp / ttmRevenue * 100).toFixed(2)) : null,
      gross_margin_pct: numberOrNull(latestIndicator.grossprofit_margin ?? latestIndicator.gross_margin),
      roe_pct: numberOrNull(latestIndicator.roe),
    },
    latest_balance: {
      end_date: dateDigits(latestBalance.end_date),
      money_cap_yi: yi(latestBalance.money_cap),
      inventories_yi: yi(latestBalance.inventories),
      accounts_receiv_yi: yi(latestBalance.accounts_receiv),
      total_assets_yi: yi(latestBalance.total_assets),
      total_liab_yi: yi(latestBalance.total_liab),
      debt_to_assets_pct: numberOrNull(latestIndicator.debt_to_assets),
    },
    market: {
      trade_date: dateDigits(latestMarket.trade_date),
      close: numberOrNull(latestMarket.close),
      pe_ttm: numberOrNull(latestMarket.pe_ttm),
      pb: numberOrNull(latestMarket.pb),
      total_mv_yi: yi(Number(latestMarket.total_mv) * 10000),
    },
    annual,
  };
}

async function parquetQuery(args: Record<string, unknown>) {
  const table = argString(args, 'table');
  const info = parquetTables[table];
  if (!info) throw new Error(`unsupported table: ${table}`);
  const schema = await describeParquet(table);
  const types = new Map(schema.map((c) => [c.column_name, c.column_type]));
  const requestedFields = Array.isArray(args.fields) ? args.fields.map(String) : [];
  const fields = requestedFields.length > 0 ? requestedFields : schema.slice(0, 30).map((c) => c.column_name);
  if (!fields.includes('ts_code') && types.has('ts_code')) fields.unshift('ts_code');
  for (const f of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f) || !types.has(f)) throw new Error(`field not allowed: ${f}`);
  }
  const where: string[] = [];
  const rawTsCode = argString(args, 'ts_code', false);
  if (rawTsCode) where.push(`ts_code=${sqlString(normalizeTsCode(rawTsCode))}`);
  const dateField = info.defaultDateField && types.has(info.defaultDateField) ? info.defaultDateField : null;
  const start = argString(args, 'start_date', false).replace(/\D/g, '');
  const end = argString(args, 'end_date', false).replace(/\D/g, '');
  if ((start || end) && !dateField) throw new Error(`table ${table} has no default date field`);
  if (dateField) {
    const expr = String(types.get(dateField)).includes('DATE') ? `strftime(${dateField}, '%Y%m%d')` : `regexp_replace(CAST(${dateField} AS VARCHAR), '[^0-9]', '', 'g')`;
    if (start) where.push(`${expr} >= ${sqlString(start)}`);
    if (end) where.push(`${expr} <= ${sqlString(end)}`);
  }
  const limit = Math.max(1, Math.min(info.maxRows, Math.floor(argNumber(args, 'limit', 100))));
  const orderBy = dateField ? `ORDER BY ${dateField} DESC` : '';
  const sql = `
    SELECT ${fields.join(', ')}
    FROM read_parquet('${sqlPath(parquetPath(table))}')
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ${orderBy}
    LIMIT ${limit}
  `;
  const rows = await queryRows(sql);
  return { table, fields, rows, limit };
}

function taxonomyPath(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid taxonomy id: ${id}`);
  const filePath = path.join(TAXONOMY_DIR, `${id}.yaml`);
  if (!fs.existsSync(filePath)) throw new Error(`taxonomy not found: ${id}`);
  return filePath;
}

async function industryTaxonomyGet(args: Record<string, unknown>) {
  const id = argString(args, 'id').replace(/\.ya?ml$/i, '');
  const filePath = taxonomyPath(id);
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return { id, file_path: filePath, taxonomy: YAML.parse(raw) };
}

function listTaxonomyIds(): string[] {
  return fs.readdirSync(TAXONOMY_DIR)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => name.replace(/\.ya?ml$/i, ''));
}

function countTaxonomyCompanies(taxonomy: Record<string, unknown>): number {
  const names = new Set<string>();
  for (const [stage, stageValue] of Object.entries(taxonomy)) {
    if (stage === 'meta') continue;
    for (const trackValue of Object.values(asObject(stageValue))) {
      const companies = Array.isArray(asObject(trackValue)['公司']) ? asObject(trackValue)['公司'] as unknown[] : [];
      for (const item of companies) {
        for (const companyName of Object.keys(asObject(item))) names.add(companyName);
      }
    }
  }
  return names.size;
}

async function industryTaxonomyList() {
  const items: Array<{
    id: string;
    label: string;
    order: number;
    company_count: number;
  }> = [];
  for (const id of listTaxonomyIds()) {
    const taxonomy = await readTaxonomyById(id);
    const meta = asObject(taxonomy.meta);
    if (meta.enabled === false) continue;
    items.push({
      id,
      label: String(meta.label ?? id),
      order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 999,
      company_count: countTaxonomyCompanies(taxonomy),
    });
  }
  items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  return { count: items.length, taxonomies: items };
}

function scanCompany(node: unknown, companyName: string, trail: string[], taxonomyMeta: Record<string, unknown>, out: unknown[]) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'meta') continue;
    if (key === '公司' && Array.isArray(value)) {
      const parent = asObject(node);
      for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        for (const [company, companyValue] of Object.entries(item as Record<string, unknown>)) {
          if (company !== companyName) continue;
          const valueObj = asObject(companyValue);
          const info = asObject(valueObj.info);
          out.push({
            taxonomy_id: String(taxonomyMeta.id ?? ''),
            taxonomy_label: String(taxonomyMeta.label ?? ''),
            path: trail,
            stage: trail[0] ?? null,
            sub_track: trail[1] ?? trail.at(-1) ?? null,
            company_name: company,
            selected_reason: info['入选说明'] ?? null,
            industry_role: info['产业作用'] ?? null,
            certainty: info['确定性'] ?? null,
            elasticity: info['弹性'] ?? null,
            elasticity_factors: parent['弹性因子'] ?? null,
            track_position: parent['产业位置'] ?? null,
            reasons: info['理由'] ?? null,
            risks: info['风险'] ?? null,
            links: valueObj.link ?? null,
          });
        }
      }
      continue;
    }
    scanCompany(value, companyName, [...trail, key], taxonomyMeta, out);
  }
}

async function industryCompanyContext(args: Record<string, unknown>) {
  const companyName = argString(args, 'company_name');
  const matches: unknown[] = [];
  for (const id of listTaxonomyIds()) {
    const filePath = taxonomyPath(id);
    const taxonomy = YAML.parse(await fs.promises.readFile(filePath, 'utf8'));
    const meta = asObject(taxonomy?.meta);
    scanCompany(taxonomy, companyName, [], meta, matches);
  }
  return { company_name: companyName, matches };
}

function loadIndustryCompanyCodeMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(COMPANY_CODE_MAP_PATH)) return map;
  const text = fs.readFileSync(COMPANY_CODE_MAP_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !line.includes(':')) continue;
    const [name, ...rest] = line.split(':');
    const tsCode = rest.join(':').trim();
    if (name.trim() && tsCode) map.set(name.trim(), tsCode);
  }
  return map;
}

type IndustryIndexMember = {
  company_name: string;
  ts_code: string;
  stage: string;
  sub_track: string;
  purity_score: number;
  manual_weight: number | null;
};

function falseLike(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['否', '不纳入', 'false', '0', 'no', 'exclude'].includes(normalized);
}

function ratioValue(value: unknown, fallback: number | null): number | null {
  if (value == null || value === '') return fallback;
  const text = String(value).trim();
  const pct = text.endsWith('%');
  const n = Number(text.replace(/%$/, ''));
  if (!Number.isFinite(n)) return fallback;
  return pct ? n / 100 : n;
}

function extractIndustryIndexMembers(
  taxonomy: Record<string, unknown>,
  codeMap: Map<string, string>,
): { members: IndustryIndexMember[]; excluded: unknown[]; missing_ts_code: unknown[] } {
  const members: IndustryIndexMember[] = [];
  const excluded: unknown[] = [];
  const missingTsCode: unknown[] = [];
  for (const [stage, stageValue] of Object.entries(taxonomy)) {
    if (stage === 'meta') continue;
    for (const [subTrack, trackValue] of Object.entries(asObject(stageValue))) {
      const companies = Array.isArray(asObject(trackValue)['公司']) ? asObject(trackValue)['公司'] as unknown[] : [];
      for (const item of companies) {
        const itemObj = asObject(item);
        for (const [companyName, companyValue] of Object.entries(itemObj)) {
          const companyObj = asObject(companyValue);
          const info = asObject(companyObj.info);
          if (falseLike(info['指数纳入'])) {
            excluded.push({ company_name: companyName, stage, sub_track: subTrack, reason: '指数纳入字段排除' });
            continue;
          }
          const rawCode = String(companyObj.ts_code ?? info.ts_code ?? codeMap.get(companyName) ?? '').trim();
          let tsCode = '';
          try {
            tsCode = normalizeTsCode(rawCode);
          } catch {
            missingTsCode.push({ company_name: companyName, stage, sub_track: subTrack });
            continue;
          }
          const purityScore = Math.max(0, Math.min(1, ratioValue(info['业务纯度'], 1) ?? 1));
          const manualWeight = ratioValue(info['指数权重'], null);
          members.push({
            company_name: companyName,
            ts_code: tsCode,
            stage,
            sub_track: subTrack,
            purity_score: purityScore,
            manual_weight: manualWeight,
          });
        }
      }
    }
  }
  const deduped = [...new Map(members.map((member) => [member.ts_code, member])).values()];
  return { members: deduped, excluded, missing_ts_code: missingTsCode };
}

async function industryChainIndexPreview(args: Record<string, unknown>) {
  const taxonomyId = argString(args, 'taxonomy_id').replace(/\.ya?ml$/i, '');
  const taxonomy = await readTaxonomyById(taxonomyId);
  const meta = asObject(taxonomy.meta);
  const result = extractIndustryIndexMembers(taxonomy, loadIndustryCompanyCodeMap());
  return {
    taxonomy_id: taxonomyId,
    taxonomy_label: String(meta.label ?? taxonomyId),
    constituent_count: result.members.length,
    ...result,
  };
}

function resolveAppLocalPath(input: string, fallback: string): string {
  const resolved = path.resolve(input ? input : fallback);
  const root = `${path.resolve(APP_ROOT)}${path.sep}`;
  if (resolved !== path.resolve(APP_ROOT) && !resolved.startsWith(root)) {
    throw new Error(`path must be inside ${APP_ROOT}: ${resolved}`);
  }
  return resolved;
}

async function industryChainIndexBuild(args: Record<string, unknown>) {
  const preview = await industryChainIndexPreview(args) as Record<string, unknown>;
  const members = Array.isArray(preview.members) ? preview.members : [];
  if (members.length === 0) throw new Error('no eligible industry-chain index members');
  const taxonomyId = String(preview.taxonomy_id);
  const startDate = argString(args, 'start_date').replace(/\D/g, '');
  const endDate = argString(args, 'end_date').replace(/\D/g, '');
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start_date/end_date must be valid YYYYMMDD and start_date <= end_date');
  }
  const weightMethod = argString(args, 'weight_method', false) || 'chain_balanced';
  const allowedMethods = new Set(['equal', 'float_mv', 'capped_float_mv', 'chain_balanced', 'manual']);
  if (!allowedMethods.has(weightMethod)) throw new Error(`unsupported weight_method: ${weightMethod}`);
  const maxWeight = argNumber(args, 'max_weight', 0.10);
  const baseValue = argNumber(args, 'base_value', 1000);
  const defaultOutput = path.join(INDUSTRY_INDEX_DIR, `${taxonomyId}_${startDate}_${endDate}.parquet`);
  const outputPath = resolveAppLocalPath(argString(args, 'output_path', false), defaultOutput);
  const priceInput = argString(args, 'price_parquet', false);
  const marketCapInput = argString(args, 'market_cap_parquet', false);
  const priceParquet = priceInput ? resolveAppLocalPath(priceInput, priceInput) : '';
  const marketCapParquet = marketCapInput ? resolveAppLocalPath(marketCapInput, marketCapInput) : '';
  for (const inputPath of [priceParquet, marketCapParquet].filter(Boolean)) {
    if (!fs.existsSync(inputPath)) throw new Error(`input parquet not found: ${inputPath}`);
  }

  await fs.promises.mkdir(INDUSTRY_INDEX_DIR, { recursive: true });
  const membersPath = path.join(INDUSTRY_INDEX_DIR, `.${taxonomyId}_${process.pid}_${Date.now()}_members.json`);
  await fs.promises.writeFile(membersPath, JSON.stringify(members), 'utf8');
  const pyArgs = [
    INDUSTRY_INDEX_SCRIPT,
    '--taxonomy-id', taxonomyId,
    '--taxonomy-label', String(preview.taxonomy_label ?? taxonomyId),
    '--members-json', membersPath,
    '--start-date', startDate,
    '--end-date', endDate,
    '--weight-method', weightMethod,
    '--max-weight', String(maxWeight),
    '--base-value', String(baseValue),
    '--output', outputPath,
  ];
  if (priceParquet) pyArgs.push('--price-parquet', priceParquet);
  if (marketCapParquet) pyArgs.push('--market-cap-parquet', marketCapParquet);
  try {
    const { stdout, stderr } = await execFileAsync('python', pyArgs, {
      cwd: APP_ROOT,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    const meta = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}');
    return {
      ...preview,
      members: undefined,
      build: meta,
      warnings: stderr.trim() ? stderr.trim().split(/\r?\n/).slice(-20) : [],
    };
  } finally {
    await fs.promises.rm(membersPath, { force: true });
  }
}

type TaxonomyCompanyContext = {
  stage: string;
  track: string;
  companyInfo: Record<string, unknown>;
  trackInfo: Record<string, unknown>;
};

function taxonomyFilePathById(taxonomyId: string): string {
  return taxonomyPath(taxonomyId.replace(/\.ya?ml$/i, ''));
}

async function readTaxonomyById(taxonomyId: string): Promise<Record<string, unknown>> {
  return YAML.parse(await fs.promises.readFile(taxonomyFilePathById(taxonomyId), 'utf8')) as Record<string, unknown>;
}

function findTaxonomyCompanyContext(taxonomy: Record<string, unknown>, companyName: string): TaxonomyCompanyContext {
  for (const [stage, stageValue] of Object.entries(taxonomy)) {
    if (stage === 'meta') continue;
    const stageObj = asObject(stageValue);
    for (const [track, trackValue] of Object.entries(stageObj)) {
      const trackObj = asObject(trackValue);
      const companies = Array.isArray(trackObj['公司']) ? trackObj['公司'] as unknown[] : [];
      for (const item of companies) {
        const itemObj = asObject(item);
        if (!(companyName in itemObj)) continue;
        const companyObj = asObject(itemObj[companyName]);
        return {
          stage,
          track,
          companyInfo: asObject(companyObj.info),
          trackInfo: trackObj,
        };
      }
    }
  }
  throw new Error(`company not found in taxonomy: ${companyName}`);
}

function firstPdfHit(searchResult: Record<string, unknown>): { keyword: string; page: number; context: string } | null {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as unknown[] : [];
  for (const match of matches) {
    const matchObj = asObject(match);
    const hits = Array.isArray(matchObj.hits) ? matchObj.hits as unknown[] : [];
    const hit = asObject(hits[0]);
    if (!hit || hit.page == null) continue;
    return {
      keyword: String(matchObj.keyword ?? ''),
      page: Math.floor(Number(hit.page)),
      context: String(hit.context ?? '').replace(/\s+/g, ' ').trim(),
    };
  }
  return null;
}

function evidenceLine(searchResult: Record<string, unknown>, fallback: string, maxLen = 150): string {
  const hit = firstPdfHit(searchResult);
  if (!hit) return fallback;
  return `年报P${hit.page}「${hit.keyword}」：${hit.context.slice(0, maxLen)}`;
}

function summarizePdfMatches(searchResult: Record<string, unknown>): string {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches as unknown[] : [];
  const lines: string[] = [];
  for (const match of matches) {
    const matchObj = asObject(match);
    const hits = Array.isArray(matchObj.hits) ? matchObj.hits.slice(0, 3) : [];
    if (hits.length === 0) continue;
    lines.push(`- ${String(matchObj.keyword ?? '')}：${String(matchObj.count ?? hits.length)} 处`);
    for (const hitRaw of hits) {
      const hit = asObject(hitRaw);
      const page = hit.page == null ? '?' : String(hit.page);
      const context = String(hit.context ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      lines.push(`  - P${page}：${context}`);
    }
  }
  return lines.join('\n') || '- 未命中；需要人工补充关键词或改用年报目录定位。';
}

function formatAnnualFinance(metrics: Record<string, unknown>): string {
  const annual = Array.isArray(metrics.annual) ? metrics.annual.map(asObject) : [];
  const latest = annual.at(-1);
  const prev = annual.at(-2);
  if (!latest) return '未取得 finance_metrics 年度数据。';
  const latestRevenue = numberOrNull(latest.revenue_yi);
  const prevRevenue = numberOrNull(prev?.revenue_yi);
  const latestProfit = numberOrNull(latest.net_profit_parent_yi ?? latest.parent_net_profit_yi);
  const prevProfit = numberOrNull(prev?.net_profit_parent_yi ?? prev?.parent_net_profit_yi);
  const revYoY = latestRevenue != null && prevRevenue ? (latestRevenue / prevRevenue - 1) * 100 : null;
  const profitYoY = latestProfit != null && prevProfit != null && prevProfit > 0
    ? (latestProfit / prevProfit - 1) * 100
    : null;
  const fmt = (v: number | null, digits = 2) => v == null ? '--' : v.toFixed(digits);
  let profitText = `归母净利润 ${fmt(latestProfit)} 亿元`;
  if (latestProfit != null && prevProfit != null && prevProfit < 0 && latestProfit > 0) {
    profitText += `，上年亏损 ${fmt(Math.abs(prevProfit))} 亿元，本年扭亏为盈`;
  } else if (latestProfit != null && prevProfit != null && prevProfit > 0 && latestProfit < 0) {
    profitText += `，上年盈利 ${fmt(prevProfit)} 亿元，本年转亏`;
  } else {
    profitText += `，同比 ${fmt(profitYoY)}%`;
  }
  return `${String(latest.end_date ?? '最新年报')}：营收 ${fmt(latestRevenue)} 亿元，同比 ${fmt(revYoY)}%；${profitText}。`;
}

function applyIndustryEvidenceFields(
  taxonomy: Record<string, unknown>,
  companyName: string,
  fields: Record<string, string>,
): Record<string, unknown> {
  let changed = false;
  for (const [stage, stageValue] of Object.entries(taxonomy)) {
    if (stage === 'meta') continue;
    for (const trackValue of Object.values(asObject(stageValue))) {
      const trackObj = asObject(trackValue);
      const companies = Array.isArray(trackObj['公司']) ? trackObj['公司'] as unknown[] : [];
      for (const item of companies) {
        const itemObj = asObject(item);
        if (!(companyName in itemObj)) continue;
        const companyObj = asObject(itemObj[companyName]);
        const info = asObject(companyObj.info);
        const nextInfo: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(info)) {
          if (key === '产品' && fields['产品']) {
            nextInfo[key] = fields['产品'];
            continue;
          }
          nextInfo[key] = value;
          if (key === '产业作用' && fields['产品']) nextInfo['产品'] = fields['产品'];
        }
        if (!('产品' in nextInfo) && fields['产品']) nextInfo['产品'] = fields['产品'];
        for (const key of ['成长性', '行业空间', '护城河', '技术壁垒']) nextInfo[key] = fields[key];
        companyObj.info = nextInfo;
        itemObj[companyName] = companyObj;
        changed = true;
      }
    }
  }
  if (!changed) throw new Error(`company not found when applying industry evidence: ${companyName}`);
  return taxonomy;
}

async function industryCompanyEvidence(args: Record<string, unknown>) {
  const taxonomyId = argString(args, 'taxonomy_id').replace(/\.ya?ml$/i, '');
  const companyName = argString(args, 'company_name');
  const year = Math.floor(argNumber(args, 'year', 2025));
  const apply = Boolean(args.apply);
  const analysisFieldsArg = asObject(args.analysis_fields);
  const taxonomy = await readTaxonomyById(taxonomyId);
  const taxonomyMeta = asObject(taxonomy.meta);
  const context = findTaxonomyCompanyContext(taxonomy, companyName);
  const tsCode = loadIndustryCompanyCodeMap().get(companyName);
  if (!tsCode) throw new Error(`No ts_code mapping for ${companyName}`);

  const metrics = await financeMetrics({ ts_code: tsCode, annual_years: 6 }) as Record<string, unknown>;
  const searches: Record<string, Record<string, unknown>> = {};
  for (const [field, keywords] of Object.entries(INDUSTRY_EVIDENCE_KEYWORDS)) {
    searches[field] = await cninfoSearchPdf({
      ts_code: tsCode,
      year,
      keywords: [...keywords],
      context_chars: 90,
    }) as Record<string, unknown>;
  }

  const financeLine = formatAnnualFinance(metrics);
  const roleFallback = String(context.companyInfo['产业作用'] ?? context.companyInfo['入选说明'] ?? '');
  const evidenceDraft = {
    产品: evidenceLine(searches['产品'], roleFallback),
    成长性: `${financeLine} ${evidenceLine(searches['产品'], '年报产品和经营讨论待进一步人工核验。', 120)}`,
    行业空间: evidenceLine(searches['行业空间'], String(context.trackInfo['产业位置'] ?? '')),
    护城河: evidenceLine(searches['护城河'], roleFallback),
    技术壁垒: evidenceLine(searches['技术壁垒'], roleFallback),
  };
  const requiredAnalysisFields = ['产品', '成长性', '行业空间', '护城河', '技术壁垒'] as const;
  const hasAnalysisFields = requiredAnalysisFields.every((key) => String(analysisFieldsArg[key] ?? '').trim());
  if (apply && !hasAnalysisFields) {
    throw new Error('apply=true requires complete analysis_fields; raw PDF hit slices cannot be written directly to taxonomy');
  }
  const fields = hasAnalysisFields
    ? Object.fromEntries(requiredAnalysisFields.map((key) => [key, String(analysisFieldsArg[key]).trim()]))
    : evidenceDraft;

  await fs.promises.mkdir(RESEARCH_LOG_DIR, { recursive: true });
  const logPath = path.join(RESEARCH_LOG_DIR, `${taxonomyId}_${companyName}_${year}_evidence.md`);
  const localPath = String(searches['产品'].local_path ?? '');
  const log = [
    `# ${companyName}（${tsCode}）${year} 年报证据草稿`,
    '',
    `- 产业链：${String(taxonomyMeta.label ?? taxonomyId)}（${taxonomyId}）`,
    `- 产业链位置：${context.stage} / ${context.track}`,
    `- 年报路径：${localPath}`,
    `- 财务成长：${financeLine}`,
    '',
    '## 产品',
    summarizePdfMatches(searches['产品']),
    '',
    '## 行业空间',
    summarizePdfMatches(searches['行业空间']),
    '',
    '## 护城河',
    summarizePdfMatches(searches['护城河']),
    '',
    '## 技术壁垒',
    summarizePdfMatches(searches['技术壁垒']),
    '',
    hasAnalysisFields ? '## 研究归纳与回写字段' : '## 证据初稿（不可直接回写）',
    '```yaml',
    YAML.stringify(fields).trim(),
    '```',
    '',
  ].join('\n');
  await fs.promises.writeFile(logPath, log, 'utf8');

  if (apply) {
    const nextTaxonomy = applyIndustryEvidenceFields(taxonomy, companyName, fields);
    await fs.promises.writeFile(taxonomyFilePathById(taxonomyId), YAML.stringify(nextTaxonomy, { lineWidth: 0 }), 'utf8');
  }

  return {
    taxonomy_id: taxonomyId,
    taxonomy_label: String(taxonomyMeta.label ?? ''),
    company_name: companyName,
    ts_code: tsCode,
    year,
    applied: apply,
    log_path: logPath,
    annual_report_path: localPath,
    fields,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'cninfo_list_disclosures': return textResult(await cninfoListDisclosures(args));
    case 'cninfo_download_annual_report': return textResult(await cninfoDownloadAnnualReport(args));
    case 'cninfo_search_pdf': return textResult(await cninfoSearchPdf(args));
    case 'finance_metrics': return textResult(await financeMetrics(args));
    case 'parquet_query': return textResult(await parquetQuery(args));
    case 'industry_taxonomy_list': return textResult(await industryTaxonomyList());
    case 'industry_taxonomy_get': return textResult(await industryTaxonomyGet(args));
    case 'industry_company_context': return textResult(await industryCompanyContext(args));
    case 'industry_chain_index_preview': return textResult(await industryChainIndexPreview(args));
    case 'industry_chain_index_build': return textResult(await industryChainIndexBuild(args));
    case 'industry_company_evidence': return textResult(await industryCompanyEvidence(args));
    default: throw new Error(`unknown tool: ${name}`);
  }
}

function createFinanceMcpServer(): Server {
  const server = new Server(
    { name: 'tama-finance-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = asObject(request.params.arguments);
    devLog(`tool ${name}`, args);
    const t0 = Date.now();
    try {
      const result = await callTool(name, args);
      devLog(`tool ${name} ok (${Date.now() - t0}ms)`);
      return result;
    } catch (err) {
      devLog(`tool ${name} failed (${Date.now() - t0}ms)`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
  return server;
}

async function startStdioServer() {
  const server = createFinanceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  devLog('ready on stdio');
}

function bearerAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.MCP_AUTH_TOKEN?.trim();
  if (!expected) return next();
  const auth = req.header('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function originGuard(req: Request, res: Response, next: NextFunction) {
  const origin = req.header('origin');
  if (!origin) return next();
  const configured = (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const localOrigins = [
    'http://127.0.0.1',
    'http://localhost',
    `http://127.0.0.1:${process.env.MCP_PORT ?? '3001'}`,
    `http://localhost:${process.env.MCP_PORT ?? '3001'}`,
  ];
  if (![...configured, ...localOrigins].includes(origin)) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }
  next();
}

async function startHttpServer() {
  const host = process.env.MCP_HOST?.trim() || '127.0.0.1';
  const port = Math.max(1, Math.min(65535, Number(process.env.MCP_PORT ?? 3001)));
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if ((host === '0.0.0.0' || host === '::') && allowedHosts.length === 0) {
    throw new Error('MCP_ALLOWED_HOSTS is required when MCP_HOST listens on all interfaces');
  }
  const app = createMcpExpressApp({
    host,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  });
  const sessions = new Map<string, ActiveHttpSession>();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'tama-finance-mcp',
      transport: 'streamable-http',
      sessions: sessions.size,
    });
  });
  app.use('/mcp', originGuard, bearerAuth);

  app.post('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    try {
      if (sessionId) {
        const active = sessions.get(sessionId);
        if (!active) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'MCP session not found' },
            id: null,
          });
          return;
        }
        await active.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Missing MCP session ID or initialize request' },
          id: null,
        });
        return;
      }

      const server = createFinanceMcpServer();
      let transport: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
          devLog(`HTTP session initialized ${newSessionId}`);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      devLog('HTTP MCP request failed', err instanceof Error ? err.message : String(err));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const active = sessions.get(req.header('mcp-session-id') ?? '');
    if (!active) {
      res.status(404).send('MCP session not found');
      return;
    }
    await active.transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const active = sessions.get(req.header('mcp-session-id') ?? '');
    if (!active) {
      res.status(404).send('MCP session not found');
      return;
    }
    await active.transport.handleRequest(req, res);
  });

  const httpServer = app.listen(port, host, () => {
    console.error(`[tama-finance-mcp] Streamable HTTP listening at http://${host}:${port}/mcp`);
  });
  const shutdown = async () => {
    for (const [sessionId, active] of sessions) {
      await active.transport.close().catch(() => undefined);
      await active.server.close().catch(() => undefined);
      sessions.delete(sessionId);
    }
    httpServer.close(() => process.exit(0));
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

const transportMode = (process.env.MCP_TRANSPORT ?? 'http').toLowerCase();
if (transportMode === 'stdio') {
  void startStdioServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  void startHttpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
