'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataGrid, { type CSVData } from '../components/DataGrid';
import { StockDetailModal } from '../components/StockDetailModal';
import { StockBasicInfoCell } from '../components/StockBasicInfoCell';
import type { KlineBar } from '../components/StockBasicMiniKLine';
import {
  buildChainContextMapsFromSubLaneLink,
  extractChainCompaniesFromTaxonomy,
  lookupChainContext,
  parseTaxonomyYamlContent,
  type ChainCompanyContext,
  type ChainContextMaps,
  type SubLaneDeepLinkContext,
} from '../industryLink/chainCompanyContext';
import type { IndustryTaxonomyRegistryItem } from '../industryLink/taxonomyRegistryTypes';
import {
  SW_TREE_ROW_COLS,
  formatSwChgPct,
  swChgClass,
  useSwIndexPriceSnapshots,
} from '../lib/swIndexPriceSnapshots';
import { formatDateYYMM } from '@/lib/dateFormat';
import { metrics } from '@/lib/metrics/definitions';
import { ChevronDown, X } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  Line,
  LineChart,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
} from 'recharts';

/** 输入侧股票名称规整：去空白、全角字母数字转半角，便于与基础库名称对齐 */
function normalizeStockNameInput(s: string): string {
  return s
    .trim()
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

type StockListRow = Record<string, string>;

type StockResolveIndex = {
  bySymbol: Map<string, string>;
  byNormalizedName: Map<string, string[]>;
  rowsListed: Array<{ ts: string; normalizedName: string }>;
};

/** 基于 ts_a_stock_list 构建：6 位代码、规范化后的完整名称 -> ts_code（仅上市 L） */
function buildStockResolveIndex(rows: StockListRow[]): StockResolveIndex {
  const bySymbol = new Map<string, string>();
  const byNormalizedName = new Map<string, string[]>();
  const rowsListed: Array<{ ts: string; normalizedName: string }> = [];

  for (const r of rows) {
    const ts = String(r.ts_code ?? '').trim().toUpperCase();
    const rawName = String(r.name ?? '').trim();
    const symbol = String(r.symbol ?? '').trim();
    const status = String(r.list_status ?? '').trim().toUpperCase();
    if (!/^\d{6}\.(SZ|SH|BJ)$/.test(ts)) continue;
    if (status !== 'L') continue;
    if (symbol && !bySymbol.has(symbol)) bySymbol.set(symbol, ts);
    const nk = normalizeStockNameInput(rawName);
    if (nk) {
      const prev = byNormalizedName.get(nk) ?? [];
      prev.push(ts);
      byNormalizedName.set(nk, prev);
      rowsListed.push({ ts, normalizedName: nk });
    }
  }

  return { bySymbol, byNormalizedName, rowsListed };
}

/** 条件输入框：股票代码/名称分隔符（空格、斜杠、中英文逗号/分号、换行等） */
const STOCK_INPUT_SEP_RE = /[\s/,，;；\n\r\t|、]+/;

/**
 * 顶部「开始对比」单段输入：优先完整 ts_code；否则 6 位数字代码；否则按股票名称（全名精确，或全表唯一包含匹配）。
 */
function resolveStockToken(token: string, idx: StockResolveIndex): { ok: string } | { err: string } {
  const trimmed = token.trim();
  if (!trimmed) return { err: '空项' };
  const up = trimmed.toUpperCase();
  if (/^\d{6}\.(SZ|SH|BJ)$/.test(up)) return { ok: up };
  if (/^\d{6}$/.test(trimmed)) {
    const ts = idx.bySymbol.get(trimmed);
    return ts ? { ok: ts } : { err: trimmed };
  }
  const nk = normalizeStockNameInput(trimmed);
  const exact = idx.byNormalizedName.get(nk);
  if (exact?.length === 1) return { ok: exact[0] };
  if (exact && exact.length > 1)
    return { err: `${trimmed}（同名上市${exact.length}只，请改用代码）` };

  const hits = idx.rowsListed.filter((x) => x.normalizedName.includes(nk));
  if (hits.length === 1) return { ok: hits[0].ts };
  if (hits.length > 1)
    return { err: `${trimmed}（名称含关键词 ${hits.length} 只，请写全名或代码）` };
  return { err: trimmed };
}

/** 解析顶部输入框文本为 ts_code 列表 */
function resolveInputTextToCodes(
  text: string,
  idx: StockResolveIndex | null,
  stockListLoading: boolean,
  stockListLoadError: string | null,
): { codes: string[]; errors: string[]; blockingError: string | null } {
  if (stockListLoading) {
    return { codes: [], errors: [], blockingError: '股票基础列表加载中，请稍后再点「开始对比」。' };
  }
  if (!idx) {
    return {
      codes: [],
      errors: [],
      blockingError: stockListLoadError ?? '股票基础列表不可用，无法按名称或 6 位代码解析。',
    };
  }
  const parts = text
    .split(STOCK_INPUT_SEP_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const resolved: string[] = [];
  const errors: string[] = [];
  for (const token of parts) {
    const r = resolveStockToken(token, idx);
    if ('ok' in r) resolved.push(r.ok);
    else errors.push(r.err);
  }
  const codes = Array.from(new Set(resolved.map((s) => s.trim().toUpperCase())));
  return { codes, errors, blockingError: null };
}

/** 图轴为 26Q1 时展开为 2026Q1，便于 tooltip 首行展示 */
function expandTooltipPeriod(axisLabel: string): string {
  const t = String(axisLabel ?? '').trim();
  if (/^\d{4}Q[1-4]$/.test(t)) return t;
  const m = t.match(/^(\d{2})Q([1-4])$/);
  if (m) return `20${m[1]}Q${m[2]}`;
  return t;
}

/** 与 definitions 中 meta.label 一致（DCF tooltip 用） */
function metricLabel(key: keyof typeof metrics): string {
  const m = metrics[key] as { meta?: { label?: string } } | undefined;
  return m?.meta?.label ?? String(key);
}

/** DCF tooltip：标签只保留连续的前四个汉字 */
function first4Han(text: string): string {
  const out: string[] = [];
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      out.push(ch);
      if (out.length >= 4) break;
    }
  }
  return out.join('') || text.slice(0, 4);
}

type StockInfo = {
  name: string;
  area: string;
  industry: string;
};

/** 行情快照：价格/涨跌幅来自 qfqDir（前复权），市值/PE/PB 来自 daily_basic 最近一条 */
type MarketSnapshot = {
  trade_date: string | null;
  close: number | null;
  total_mv_yi: number | null;
  pe: number | null;
  pb: number | null;
  returns: {
    d1: number | null;
    d5: number | null;
    d20: number | null;
    d60: number | null;
  };
};

type MetricChart = {
  x: string[];
  series: number[][];
  labels: string[];
  latest: string[];
  note?: string;
  _stats?: { mean: number; high: number; low: number };
  history?: Array<{ period: string; values: number[] }>;
  /** DCF 列：与 x 同序，tooltip 核对用（金额为财报元） */
  dcfTooltipRows?: Array<{
    n_cashflow_act_ttm: number | null;
    c_pay_acq_const_fiolta_ttm: number | null;
    fcff_ttm: number | null;
    net_debt: number | null;
    st_borr: number | null;
    lt_borr: number | null;
    st_bonds_payable: number | null;
    bond_payable: number | null;
    money_cap: number | null;
    trad_asset: number | null;
    /** DCF净利基数列：与同季 n_income_attr_p_ttm 报表元口径一致 */
    n_income_attr_p_ttm?: number | null;
    /** dcf_r 列：与引擎 profit_growth 一致（%；五年利润复合增长率） */
    profit_growth_5y_pct?: number | null;
    /** DCF(TTM) 列启用分类表行业增速时：与请求 industry_growth_pct 一致（%） */
    industry_growth_csv_pct?: number | null;
    /** DCF(分红基数) 列：dividend_ttm 原为万元口径，_tooltip 填入时已 ×1e4 为元人民币便于读 */
    dividend_ttm_yuan?: number | null;
  }>;
};

type MetricKey =
  | 'rev_mv'
  | 'rev_cashflow'
  | 'cost_margin'
  | 'fee_revenue'
  | 'dividend_yield'
  | 'growth_summary'
  | 'growth_trend'
  | 'balance_structure'
  | 'biz_comp'
  | 'ps_valuation'
  | 'pe_valuation'
  | 'pb_valuation'
  | 'vol_turnover_40d'
  | 'dupont'
  | 'dcf_valuation'
  | 'dcf_r'
  | 'dcf_r_ni'
  | 'dcf_div'
  | 'forecast_signal';

type ContrastRow = {
  tsCode: string;
  loading: boolean;
  error?: string;
  stockInfo: StockInfo | null;
  marketSnapshot: MarketSnapshot | null;
  klineBars: KlineBar[];
  charts: Record<MetricKey, MetricChart>;
};

/** 固定列「热点概念」单元格状态（定期报告标题 + LLM 归纳） */
type HotConceptsCellState = { state: 'loading' } | { state: 'ready'; summary: string } | { state: 'error'; err: string };

/** 附带热点：更新走 displayGridData，避免 customCellRenderers 随热点变化触发整表 columnDefs 重建（闪动） */
type StockBasicGridValue = ContrastRow & {
  __hotConcepts?: HotConceptsCellState;
  __chainContext?: ChainCompanyContext;
};

function hotConceptsEqual(a: HotConceptsCellState | undefined, b: HotConceptsCellState | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (a.state !== b.state) return false;
  if (a.state === 'loading' && b.state === 'loading') return true;
  if (a.state === 'error' && b.state === 'error') return a.err === b.err;
  if (a.state === 'ready' && b.state === 'ready') return a.summary === b.summary;
  return false;
}

type ContrastGridRow = {
  pin_top: string;
  stock_basic: StockBasicGridValue;
} & Record<MetricKey, MetricChart>;

const COLORS = ['#2563eb', '#ef4444', '#16a34a', '#f59e0b', '#7c3aed', '#0ea5e9'];
const BALANCE_FULL_LABELS: Record<string, string> = {
  '现': '现金', '预': '预付款', '应': '应收账款', '存': '存货',
  '他流': '其他流动资产', '长投': '长期股权投资', '固资': '固定资产',
  '无形': '无形资产', '非流': '其他非流动资产', '短借': '短期借款',
  '应付': '应付账款', '合同': '合同负债', '薪税': '薪酬及税费',
  '他流负': '其他流动负债', '长借': '长期借款', '长负': '其他非流动负债',
};

/** 表头顺序：紧挨「置顶 + 股票基本信息」后为营收现金流、增长趋势、杜邦、DCF，其余保持原相对顺序 */
const METRIC_COLUMNS: Array<{ key: MetricKey; label: string }> = [
  { key: 'rev_cashflow', label: '营收和现金流' },
  { key: 'growth_trend', label: '综合增长率趋势' },
  { key: 'dupont', label: '杜邦分析' },
  { key: 'dcf_valuation', label: 'DCF估值(TTM)' },
  { key: 'dcf_r', label: 'DCF估值(五年利润增速)' },
  { key: 'dcf_r_ni', label: 'DCF估值(净利TTM+利润增速)' },
  { key: 'dcf_div', label: 'DCF估值(分红TTM)' },
  { key: 'rev_mv', label: '营收和市值' },
  { key: 'cost_margin', label: '成本与毛利率' },
  { key: 'fee_revenue', label: '三费与营收' },
  { key: 'dividend_yield', label: '股息率' },
  { key: 'growth_summary', label: '综合增长率' },
  { key: 'balance_structure', label: '资产负债结构' },
  { key: 'biz_comp', label: '业务构成' },
  { key: 'ps_valuation', label: '市销率估值' },
  { key: 'pe_valuation', label: '滚动市盈率估值' },
  { key: 'pb_valuation', label: '市净率估值' },
  { key: 'vol_turnover_40d', label: '40日成交/换手' },
  { key: 'forecast_signal', label: '预测列(三表信号)' },
];

const PINNED_CODES_STORAGE_KEY = 'incomeContrast:pinnedCodes';

function readPinnedCodesFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = window.localStorage.getItem(PINNED_CODES_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    const source: unknown[] = [];
    if (Array.isArray(parsed)) {
      source.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      // Backward-compatible: flatten old format { industryKey: string[] }.
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(value)) source.push(...value);
      }
    } else {
      return new Set<string>();
    }
    const next = new Set<string>();
    for (const code of source) {
      const s = String(code ?? '').trim().toUpperCase();
      if (/^\d{6}\.(SZ|SH|BJ)$/.test(s)) next.add(s);
    }
    return next;
  } catch {
    return new Set<string>();
  }
}

function writePinnedCodesToStorage(pinnedCodes: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const values = [...pinnedCodes].map((code) => String(code ?? '').trim().toUpperCase()).filter((code) => /^\d{6}\.(SZ|SH|BJ)$/.test(code));
    window.localStorage.setItem(PINNED_CODES_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Ignore storage errors to avoid blocking interaction.
  }
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function parseDateNum(v: unknown): number {
  const raw = String(v ?? '').trim();
  if (!raw) return NaN;
  if (/^\d{8}$/.test(raw)) return Number(raw);
  const m1 = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return Number(`${m1[1]}${String(m1[2]).padStart(2, '0')}${String(m1[3]).padStart(2, '0')}`);
  const m2 = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return Number(`${m2[1]}${String(m2[2]).padStart(2, '0')}${String(m2[3]).padStart(2, '0')}`);
  const dt = new Date(raw.replace(/-/g, '/'));
  if (Number.isNaN(dt.getTime())) return NaN;
  const y = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return Number(`${y}${mm}${dd}`);
}

function parseQuarterPeriod(v: unknown): { year: number; quarter: number } | null {
  const raw = String(v ?? '').trim().toUpperCase();
  const m = raw.match(/^(\d{4})Q([1-4])$/);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

function shiftQuarterPeriod(period: string, yearsBack: number): string | null {
  const p = parseQuarterPeriod(period);
  if (!p) return null;
  return `${p.year - yearsBack}Q${p.quarter}`;
}

function buildCodesKey(list: string[]): string {
  return list.map((code) => String(code ?? '').trim().toUpperCase()).join('|');
}

function pickSeries(values: Array<number | null | undefined>, maxPoints = 52): number[] {
  const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (filtered.length <= maxPoints) return filtered;
  const picked: number[] = [];
  const step = (filtered.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    picked.push(filtered[Math.round(i * step)]);
  }
  return picked;
}

function sampleWithLabels(values: number[], labels: string[], maxPoints = 52): { values: number[]; labels: string[] } {
  if (values.length <= maxPoints) return { values, labels };
  const sampledValues: number[] = [];
  const sampledLabels: string[] = [];
  const step = (values.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    sampledValues.push(values[idx]);
    sampledLabels.push(labels[idx] ?? String(i + 1));
  }
  return { values: sampledValues, labels: sampledLabels };
}

function fmt(v: number | null, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}${suffix}`;
}

function emptyChart(note = '暂无数据'): MetricChart {
  return { x: [], series: [], labels: [], latest: [], note };
}

function emptyCharts(): Record<MetricKey, MetricChart> {
  return {
    rev_mv: emptyChart(),
    rev_cashflow: emptyChart(),
    cost_margin: emptyChart(),
    fee_revenue: emptyChart(),
    dividend_yield: emptyChart(),
    growth_summary: emptyChart(),
    growth_trend: emptyChart(),
    balance_structure: emptyChart(),
    biz_comp: emptyChart(),
    ps_valuation: emptyChart(),
    pe_valuation: emptyChart(),
    pb_valuation: emptyChart(),
    vol_turnover_40d: emptyChart(),
    dupont: emptyChart(),
    dcf_valuation: emptyChart(),
    dcf_r: emptyChart(),
    dcf_r_ni: emptyChart(),
    dcf_div: emptyChart(),
    forecast_signal: emptyChart(),
  };
}

function calcMeanStd(values: number[]): { mean: number; std: number } | null {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const IncomeChartCell = memo(function IncomeChartCell({
  chart,
  metricKey,
  onOpenBalanceHistory,
  balanceHistoryTitle,
}: {
  chart: MetricChart;
  metricKey: MetricKey;
  onOpenBalanceHistory?: (chart: MetricChart, title: string) => void;
  balanceHistoryTitle?: string;
}) {
  const all = chart.series.flat().filter((v) => Number.isFinite(v));
  if (!all.length) return <div className="text-xs text-gray-400">{chart.note ?? '暂无数据'}</div>;
  const len = Math.max(...chart.series.map((s) => s.length), chart.x.length);
  const chartData = Array.from({ length: len }, (_, i) => {
    const row: Record<string, any> = { idx: i + 1 };
    row.xLabel = chart.x[i] ?? String(i + 1);
    chart.series.forEach((s, si) => {
      row[`s${si}`] = s[i] ?? null;
    });
    if (
      (metricKey === 'dcf_valuation' ||
        metricKey === 'dcf_r' ||
        metricKey === 'dcf_r_ni' ||
        metricKey === 'dcf_div') &&
      chart.dcfTooltipRows?.[i] != null
    ) {
      row._dcfDetail = chart.dcfTooltipRows[i];
    }
    return row;
  });
  // console.log('chartData',metricKey,chartData);
  const darkTooltip =
    metricKey === 'rev_cashflow' ||
    metricKey === 'cost_margin' ||
    metricKey === 'fee_revenue' ||
    metricKey === 'growth_summary' ||
    metricKey === 'growth_trend' ||
    metricKey === 'vol_turnover_40d' ||
    metricKey === 'dupont' ||
    metricKey === 'forecast_signal';
  const valuationTooltip =
    metricKey === 'ps_valuation' ||
    metricKey === 'pe_valuation' ||
    metricKey === 'pb_valuation';
  const compactTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div
        style={{
          background: darkTooltip ? '#1e293b' : '#fff',
          border: darkTooltip ? '1px solid #475569' : '1px solid #ddd',
          borderRadius: 3,
          padding: '3px 6px',
          fontSize: 10,
          lineHeight: '14px',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 1,
            color: darkTooltip ? '#e2e8f0' : '#334155',
            WebkitTextStroke: '0.35px rgba(255,255,255,0.95)',
            textShadow: '0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          {label}
        </div>
        {payload.map((p: any, i: number) => {
          const n = Number(p.value);
          const suffix = valuationTooltip
            ? '倍'
            : /万手/.test(p.name)
              ? '万手'
              : /CAGR|毛利率|%|得分|增速/.test(p.name)
                ? '%'
                : /周转率|权益乘数/.test(p.name)
                  ? ''
                  : '亿';
          return (
            <div
              key={i}
              style={{
                color: p.color,
                whiteSpace: 'nowrap',
                WebkitTextStroke: '0.35px rgba(255,255,255,0.95)',
                textShadow: '0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              {p.name}:{' '}
              {Number.isFinite(n) ? (
                <>
                  {n.toFixed(2)}
                  {suffix ? <span style={{ color: suffix === '倍' ? '#111827' : undefined }}>{suffix}</span> : null}
                </>
              ) : '—'}
            </div>
          );
        })}
      </div>
    );
  };
  const formatYi = (v: any) => `${Number(v).toFixed(0)}亿`;
  const formatPct = (v: any) => `${Number(v).toFixed(1)}%`;

  /** DCF 列 tooltip：首行为期间+股权价值+总市值；下为两列分项（左 FCF 相关、右净负债相关，无前缀） */
  const formatYiFromYuan = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : `${(v / 1e8).toFixed(2)}亿`;

  const dcfDetailTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const rowPayload = payload.find((p: any) => p?.payload?._dcfDetail)?.payload ?? payload[0]?.payload;
    const d = rowPayload?._dcfDetail as NonNullable<MetricChart['dcfTooltipRows']>[number] | undefined;
    const headRows = payload.map((p: any) => {
      const n = Number(p?.value);
      const valStr = Number.isFinite(n) ? `${n.toFixed(2)}亿` : '—';
      return { valStr };
    });
    const fcfRows: Array<{ k: string; v: string }> = [];
    const ndRows: Array<{ k: string; v: string }> = [];
    if (d) {
      if (metricKey === 'dcf_div') {
        fcfRows.push({ k: '分红TTM', v: formatYiFromYuan(d.dividend_ttm_yuan ?? null) });
      } else if (metricKey === 'dcf_r_ni') {
        fcfRows.push({
          k: first4Han(metricLabel('n_income_attr_p_ttm')),
          v: formatYiFromYuan(d.n_income_attr_p_ttm ?? null),
        });
      } else {
        fcfRows.push(
          { k: first4Han(metricLabel('n_cashflow_act_ttm')), v: formatYiFromYuan(d.n_cashflow_act_ttm) },
          { k: first4Han(metricLabel('c_pay_acq_const_fiolta_ttm')), v: formatYiFromYuan(d.c_pay_acq_const_fiolta_ttm) },
          { k: first4Han(metricLabel('fcff_ttm')), v: formatYiFromYuan(d.fcff_ttm) },
        );
      }
      ndRows.push(
        { k: first4Han(metricLabel('st_borr')), v: formatYiFromYuan(d.st_borr) },
        { k: first4Han(metricLabel('lt_borr')), v: formatYiFromYuan(d.lt_borr) },
        { k: first4Han(metricLabel('st_bonds_payable')), v: formatYiFromYuan(d.st_bonds_payable) },
        { k: first4Han(metricLabel('bond_payable')), v: formatYiFromYuan(d.bond_payable) },
        { k: first4Han(metricLabel('money_cap')), v: formatYiFromYuan(d.money_cap) },
        { k: first4Han(metricLabel('trad_asset')), v: formatYiFromYuan(d.trad_asset) },
      );
    }
    /** DCF 明细行：标签与数值用中文冒号紧靠，不按整列两端对齐以免单列出现大缝隙 */
    const dcfKvLineStyle = { lineHeight: '15px', overflowWrap: 'break-word' as const };
    const dcfHead = headRows[0];
    const mvHead = headRows[1];
    const periodFull = expandTooltipPeriod(String(label ?? ''));
    const headline =
      metricKey === 'dcf_valuation' && headRows.length >= 3
        ? `${periodFull}DCF(阶段一15%)：${headRows[0]?.valStr ?? '—'}，总市值：${headRows[1]?.valStr ?? '—'}，DCF(行业)：${headRows[2]?.valStr ?? '—'}`
        : metricKey === 'dcf_valuation'
          ? `${periodFull}DCF(阶段一15%)：${headRows[0]?.valStr ?? '—'}，总市值：${headRows[1]?.valStr ?? '—'}`
          : `${periodFull}股权价值：${dcfHead?.valStr ?? '—'}，总市值：${mvHead?.valStr ?? '—'}`;
    const pg5 = d?.profit_growth_5y_pct;
    const igCsv = d?.industry_growth_csv_pct;
    const extraLines: string[] = [];
    if (igCsv != null && Number.isFinite(igCsv)) {
      extraLines.push(`阶段一：申万分类 industry_growth ${igCsv}%（dcf_equity_value_ttm_growth_ind）`);
    }
    if ((metricKey === 'dcf_r' || metricKey === 'dcf_r_ni') && pg5 != null && Number.isFinite(pg5)) {
      const baseHint =
        metricKey === 'dcf_r'
          ? '自由现金流基数、与 dcf_equity_value_ttm_growth_r 一致'
          : '归母净利润TTM基数、与 dcf_equity_value_ttm_ni_growth_r 一致';
      extraLines.push(`阶段一：五年利润CAGR ${pg5.toFixed(2)}%（${baseHint}）`);
    }
    if (metricKey === 'dcf_div') {
      extraLines.push('基数：dividend_ttm（滚动四季之和，原版数据为「万元」，引擎内已折算为「元」代入 DCF）；阶段一默认 g1=15%');
    }
    const hasExtra = extraLines.length > 0;
    return (
      <div
        style={{
          background: '#1e293b',
          border: '1px solid #475569',
          borderRadius: 3,
          padding: '8px 10px',
          fontSize: 10,
          lineHeight: '16px',
          color: '#e2e8f0',
          /* 不超图表宽度：外层配合 Tooltip allowEscapeViewBox；内容区吃满外层限宽 */
          maxWidth: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: hasExtra || d ? 6 : 0,
            fontSize: 11,
            /* 收窄 tooltip 时在框内折行，避免撑出图表 */
            whiteSpace: 'normal',
          }}
        >
          {headline}
        </div>
        {hasExtra ? (
          <div style={{ fontSize: 10, opacity: 0.92, marginBottom: d ? 8 : 0, whiteSpace: 'normal' }}>
            {extraLines.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        ) : null}
        {d ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', minWidth: 0 }}>
            <div
              style={{
                flex: '1 1 0',
                minWidth: 0,
                borderRight: '1px solid #475569',
                paddingRight: 8,
                overflow: 'hidden',
              }}
            >
              {fcfRows.map((r: { k: string; v: string }, i: number) => (
                <div key={`f${i}`} style={dcfKvLineStyle}>{`${r.k}：${r.v}`}</div>
              ))}
            </div>
            <div style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>
              {ndRows.map((r: { k: string; v: string }, i: number) => (
                <div key={`n${i}`} style={dcfKvLineStyle}>{`${r.k}：${r.v}`}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  if (metricKey === 'rev_mv') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: '#82ca9d' }}
              width={52}
              tickFormatter={formatYi}
              label={{ value: '市值(亿)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#82ca9d' } }}
            />
            <YAxis
              yAxisId="right"
              tick={{ fontSize: 10, fill: '#3b82f6' }}
              width={52}
              orientation="right"
              tickFormatter={formatYi}
              label={{ value: '营收(蓝)/利润(红)(亿)', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#3b82f6' } }}
            />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="right" dataKey="s0" barSize={3} fill="#3b82f6" name={chart.labels[0] ?? 'TTM营收(亿)'} />
            <Bar yAxisId="right" dataKey="s1" barSize={3} fill="#ef4444" name={chart.labels[1] ?? 'TTM归母净利润(亿)'} />
            <Line yAxisId="left" type="monotone" dataKey="s2" stroke="#82ca9d" strokeWidth={2} dot={false} name={chart.labels[2] ?? '总市值(亿)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'rev_cashflow') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="left"
              tick={{ fill: '#60a5fa', fontSize: 10 }}
              width={52}
              tickFormatter={formatYi}
              label={{ value: '营收/现金流入(亿)', angle: -90, position: 'insideLeft', style: { fill: '#60a5fa', fontSize: 10 } }}
            />
            <YAxis
              yAxisId="right"
              tick={{ fill: '#ef4444', fontSize: 10 }}
              width={52}
              orientation="right"
              tickFormatter={formatYi}
              label={{ value: '利润/经营净额/自由现金(亿)', angle: 90, position: 'insideRight', style: { fill: '#ef4444', fontSize: 10 } }}
            />
            <Tooltip content={compactTooltip} />
            <Line yAxisId="left" type="monotone" dataKey="s0" stroke="#1e40af" strokeWidth={2} dot={false} name={chart.labels[0] ?? '滚动总营收 TTM'} />
            <Line yAxisId="left" type="monotone" dataKey="s1" stroke="#60a5fa" strokeWidth={2} dot={false} name={chart.labels[1] ?? '经营现金流入 TTM'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#9a3412" strokeWidth={2} dot={false} name={chart.labels[2] ?? '归母净利润 TTM'} />
            <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#fb923c" strokeWidth={2} dot={false} name={chart.labels[3] ?? '经营现金流净额 TTM'} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="s4"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              connectNulls
              name={chart.labels[4] ?? '自由现金流TTM(亿)'}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'biz_comp') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <Tooltip content={compactTooltip} />
            {chart.series.map((_, idx) => (
              <Line key={idx} type="monotone" dataKey={`s${idx}`} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={false} name={chart.labels[idx] ?? `S${idx + 1}`} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'dividend_yield') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Line type="monotone" dataKey="s0" stroke="#22c55e" strokeWidth={2.5} dot={false} name={chart.labels[0] ?? '股息率TTM(%)'} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'ps_valuation' || metricKey === 'pe_valuation' || metricKey === 'pb_valuation') {
    const vStats = chart._stats;
    const valuationData = chartData.map((d: Record<string, any>) => ({
      ...d,
      ...(vStats ? { _mean: vStats.mean, _high: vStats.high, _low: vStats.low } : {}),
    }));
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={valuationData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v: any) => Number(v).toFixed(1)} />
            <Tooltip content={compactTooltip} />
            <Line type="monotone" dataKey="s0" stroke={COLORS[0]} strokeWidth={2} dot={false} name={chart.labels[0] ?? 'S1'} />
            {vStats && (
              <>
                <Line type="monotone" dataKey="_mean" stroke="#facc15" strokeWidth={1.5} dot={false} name="均值" />
                <Line type="monotone" dataKey="_high" stroke="#ef4444" strokeWidth={1.5} dot={false} name="高估线(均值+1σ)" />
                <Line type="monotone" dataKey="_low" stroke="#111827" strokeWidth={1.5} dot={false} name="低估线(均值-1σ)" />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'vol_turnover_40d') {
    const noteText = chart.note?.trim();
    const formatWan = (v: any) => `${Number(v).toFixed(1)}万手`;
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        {noteText ? <div className="px-1 pb-0.5 text-[10px] text-slate-400">{noteText}</div> : null}
        <div className={noteText ? 'h-[calc(100%-16px)]' : 'h-full'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis
                yAxisId="left"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                width={48}
                tickFormatter={formatWan}
                label={{ value: '成交量(万手)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 10 } }}
              />
              <YAxis
                yAxisId="right"
                tick={{ fill: '#cbd5e1', fontSize: 10 }}
                width={40}
                orientation="right"
                tickFormatter={formatPct}
                label={{ value: '换手(%)', angle: 90, position: 'insideRight', style: { fill: '#cbd5e1', fontSize: 10 } }}
              />
              <Tooltip content={compactTooltip} />
              <Bar yAxisId="left" dataKey="s0" barSize={4} fill="#6366f1" name={chart.labels[0] ?? '成交量(万手)'} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="s1"
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
                connectNulls
                name={chart.labels[1] ?? '换手率(%)'}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (metricKey === 'cost_margin') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis
              yAxisId="right"
              tick={{ fill: '#cbd5e1', fontSize: 10 }}
              width={44}
              orientation="right"
              domain={['dataMin', 100]}
              tickFormatter={formatPct}
            />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#38bdf8" name={chart.labels[0] ?? '营收TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s1" barSize={3} fill="#f97316" name={chart.labels[1] ?? '成本TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#f8fafc" strokeWidth={2} dot={false} name={chart.labels[2] ?? '毛利率TTM(%)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'fee_revenue') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" tick={{ fill: '#cbd5e1', fontSize: 10 }} width={44} orientation="right" tickFormatter={formatYi} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#38bdf8" name={chart.labels[0] ?? '营收TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s1" stroke="#fb923c" strokeWidth={2} dot={false} name={chart.labels[1] ?? '销售费TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#94a3b8" strokeWidth={2} dot={false} name={chart.labels[2] ?? '管理费TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#f43f5e" strokeWidth={2.5} dot={false} name={chart.labels[3] ?? '研发费TTM(亿)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'growth_summary') {
    const GROWTH_BAR_COLORS = ['#94a3b8', '#3b82f6', '#ef4444', '#22c55e'];
    const bars = (chart.series[0] ?? []).map((v, idx) => ({ idx: chart.x[idx] ?? String(idx + 1), value: v }));
    const periodText = chart.note?.trim();
    const growthXAxisTick = (props: any) => {
      const { x, y, payload } = props;
      const idx = bars.findIndex((b) => String(b.idx) === String(payload?.value));
      const c = GROWTH_BAR_COLORS[idx >= 0 ? idx % GROWTH_BAR_COLORS.length : 0];
      return (
        <text
          x={x}
          y={y}
          dy={16}
          textAnchor="end"
          fill={c}
          fontSize={10}
          transform={`rotate(-90, ${x}, ${y})`}
        >
          {payload?.value}
        </text>
      );
    };
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        {periodText && <div className="px-1 pb-1 text-[10px] text-slate-300">期间: {periodText}</div>}
        <div className={periodText ? 'h-[calc(100%-18px)]' : 'h-full'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 16, right: 8, left: 0, bottom: 14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="idx" tick={growthXAxisTick} interval={0} height={50} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatPct} />
              <Tooltip content={compactTooltip} />
              <Bar dataKey="value" name={chart.labels[0] ?? '数值'}>
                {bars.map((_, idx) => (
                  <Cell key={idx} fill={GROWTH_BAR_COLORS[idx % GROWTH_BAR_COLORS.length]} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '')}
                  style={{ fill: '#e2e8f0', fontSize: 9, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (metricKey === 'balance_structure') {
    const bars = (chart.series[0] ?? []).map((v, idx) => ({ idx: chart.x[idx] ?? chart.labels[idx] ?? String(idx + 1), value: v }));
    const periodText = chart.note?.trim();
    const historyPeriods = (chart.history ?? []).slice().reverse();
    const balanceTooltip = ({ active, payload, label }: any) => {
      if (!active || !payload?.length) return null;
      const fullLabel = BALANCE_FULL_LABELS[label] ?? label;
      return (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 10, lineHeight: '14px' }}>
          <div style={{ fontWeight: 600, marginBottom: 1, color: '#334155' }}>{fullLabel}</div>
          {payload.map((p: any, i: number) => (
            <div key={i} style={{ color: p.color, whiteSpace: 'nowrap' }}>
              {p.name}: {Number.isFinite(Number(p.value)) ? `${Number(p.value).toFixed(2)}亿` : '—'}
            </div>
          ))}
        </div>
      );
    };
    return (
      <>
      <div className="h-[190px] w-full">
        <div className="relative z-10 flex items-center justify-between px-1 pb-1">
          <div className="text-[10px] text-gray-500">{periodText ? `期间: ${periodText}` : '期间: —'}</div>
          <button
            type="button"
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenBalanceHistory?.(chart, balanceHistoryTitle ?? '资产负债结构历史');
            }}
            disabled={historyPeriods.length === 0}
            title={historyPeriods.length === 0 ? '暂无历史数据' : '查看最近3年历史'}
          >
            历史
          </button>
        </div>
        <div className="h-[calc(100%-18px)]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 6, right: 8, left: 0, bottom: 14 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="idx" tick={{ fontSize: 10 }} interval={0} angle={-90} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={formatYi} />
              <Tooltip content={balanceTooltip} />
              <Bar dataKey="value" name={chart.labels[0] ?? '数值'}>
                {bars.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </>
    );
  }

  if (metricKey === 'growth_trend') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" tick={{ fill: '#cbd5e1', fontSize: 10 }} width={44} orientation="right" tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={2} fill="#ef4444" name={chart.labels[0] ?? '归母净利润TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s1" barSize={2} fill="#3b82f6" name={chart.labels[1] ?? '营收TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s2" barSize={2} fill="#22c55e" name={chart.labels[2] ?? '归母所有者权益(亿)'} />
            <Bar yAxisId="left" dataKey="s3" barSize={2} fill="#94a3b8" name={chart.labels[3] ?? '总市值(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s4" stroke="#fb7185" strokeWidth={2.5} dot={false} name={chart.labels[4] ?? '利润5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s5" stroke="#60a5fa" strokeWidth={2} dot={false} name={chart.labels[5] ?? '营收5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s6" stroke="#34d399" strokeWidth={2} dot={false} name={chart.labels[6] ?? '净资产5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s7" stroke="#cbd5e1" strokeWidth={1.5} dot={false} name={chart.labels[7] ?? '市值5年CAGR'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'dupont') {
    const dupontData = chartData.map((d: any) => ({
      ...d,
      turnover: d.s0,
      multiplier: d.s1,
      netMargin: d.s2,
      roe: d.s3,
    }));
    const fmtTimes = (v: any) => Number(v).toFixed(2);
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dupontData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={fmtTimes} label={{ value: '次', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 9 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} domain={[-2, 'auto']} tickFormatter={formatPct} label={{ value: '%', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 9 }} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="turnover" barSize={3} fill="#3b82f6" opacity={0.85} name={chart.labels[0] ?? '总资产周转率(TTM)'} />
            <Bar yAxisId="left" dataKey="multiplier" barSize={3} fill="#22c55e" opacity={0.85} name={chart.labels[1] ?? '权益乘数(TTM)'} />
            <Line yAxisId="right" type="monotone" dataKey="netMargin" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[2] ?? '销售净利率(TTM)%'} />
            <Line yAxisId="right" type="monotone" dataKey="roe" stroke="#ef4444" strokeWidth={2.5} dot={false} name={chart.labels[3] ?? '杜邦ROE%'} />
            <ReferenceLine yAxisId="right" y={0} stroke="#6b7280" strokeWidth={2} />
            <ReferenceLine yAxisId="right" y={10} stroke="#c0c0c0" strokeWidth={1.5} />
            <ReferenceLine yAxisId="right" y={15} stroke="#facc15" strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // DCF：红线=默认阶段一15%；绿线=总市值；橙线=分类表 industry_growth（仅传入 industry_growth_pct 时）
  if (metricKey === 'dcf_valuation' || metricKey === 'dcf_r' || metricKey === 'dcf_r_ni' || metricKey === 'dcf_div') {
    const showIndustryLine = metricKey === 'dcf_valuation' && chart.series.length >= 3;
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <Tooltip
              content={dcfDetailTooltip}
              allowEscapeViewBox={{ x: false, y: true }}
              wrapperStyle={{ maxWidth: '100%', pointerEvents: 'none' }}
            />
            <Line
              type="monotone"
              dataKey="s0"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
              name={chart.labels[0] ?? 'DCF股权价值(阶段一15%)(亿)'}
            />
            <Line
              type="monotone"
              dataKey="s1"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
              name={chart.labels[1] ?? '总市值(亿)'}
            />
            {showIndustryLine ? (
              <Line
                type="monotone"
                dataKey="s2"
                stroke="#f97316"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
                name={chart.labels[2] ?? 'DCF股权价值(行业增速)(亿)'}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'forecast_signal') {
    const scoreLabels = ['利润表', '资产负债', '现金流', '综合'];
    const scoreValues = scoreLabels.map((_, idx) => chart.series[0]?.[idx] ?? NaN);
    const growthPct = chart.series[0]?.[4] ?? NaN;
    const nextProfitYi = chart.series[0]?.[5] ?? NaN;
    const scoreData = scoreLabels.map((name, idx) => ({ name, value: scoreValues[idx] }));
    const scoreColor = (v: number) => (v >= 70 ? '#22c55e' : v >= 50 ? '#f59e0b' : '#ef4444');
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <div className="grid grid-cols-2 gap-1 px-1 pb-1 text-[10px]">
          <div>预测净利增速: <span className="font-semibold">{Number.isFinite(growthPct) ? `${growthPct.toFixed(1)}%` : '—'}</span></div>
          <div>预测净利润: <span className="font-semibold">{Number.isFinite(nextProfitYi) ? `${nextProfitYi.toFixed(2)}亿` : '—'}</span></div>
        </div>
        {chart.note && <div className="px-1 pb-1 text-[10px] text-slate-300">{chart.note}</div>}
        <div className={chart.note ? 'h-[calc(100%-48px)]' : 'h-[calc(100%-32px)]'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scoreData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={0} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={30} domain={[0, 100]} />
              <Tooltip content={compactTooltip} />
              <Bar dataKey="value" name="信号得分(0-100)">
                {scoreData.map((d, idx) => (
                  <Cell key={idx} fill={scoreColor(d.value)} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: number) => (Number.isFinite(v) ? v.toFixed(0) : '')}
                  style={{ fill: '#e2e8f0', fontSize: 9, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={44} tickFormatter={formatYi} />
          <YAxis yAxisId="right" tick={{ fontSize: 10 }} width={44} orientation="right" tickFormatter={formatPct} />
          <Tooltip content={compactTooltip} />
          <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#38bdf8" name={chart.labels[0] ?? 'S1'} />
          {chart.series[1] && <Line yAxisId="left" type="monotone" dataKey="s1" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[1] ?? 'S2'} />}
          {chart.series[2] && <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#f8fafc" strokeWidth={2} dot={false} name={chart.labels[2] ?? 'S3'} />}
          {chart.series[3] && <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#ef4444" strokeWidth={2} dot={false} name={chart.labels[3] ?? 'S4'} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}, (prev, next) => {
  if (prev.metricKey !== next.metricKey) return false;
  if (prev.chart !== next.chart) return false;
  if ((prev.chart.history?.length ?? 0) !== (next.chart.history?.length ?? 0)) return false;
  if (prev.balanceHistoryTitle !== next.balanceHistoryTitle) return false;
  if (prev.onOpenBalanceHistory !== next.onOpenBalanceHistory) return false;
  return true;
});

type SwTreeNode = {
  indexCode: string;
  industryCode: string;
  parentCode: string;
  name: string;
  level: 'L1' | 'L2' | 'L3';
  memberCount: number;
  /** 与树接口 industry_growth 一致（百分比，来自 index_classify_SW2021.parquet） */
  industry_growth?: number | null;
  children: SwTreeNode[];
};

type TreeSelection = {
  kind: 'node';
  level: 'L1' | 'L2' | 'L3';
  name: string;
  indexCode: string;
  memberCount: number;
  industry_growth?: number | null;
};

function swNodeKey(node: SwTreeNode): string {
  return `${node.level}-${node.industryCode}-${node.indexCode}`;
}

/** 收集树中所有可展开节点 key（有子节点） */
function collectExpandableSwNodeKeys(nodes: SwTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: SwTreeNode[]) => {
    for (const n of list) {
      if ((n.children?.length ?? 0) > 0) {
        keys.push(swNodeKey(n));
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

/** 与 taxonomyRegistry.server 一致的 id 规范化 */
function normalizeTaxonomyId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function IncomeContrastPage() {
  const [inputText, setInputText] = useState('603983.SH, 600519.SH');
  /** 产业链 deep link 传入的子泳道名称（仅展示） */
  const [urlLaneLabel, setUrlLaneLabel] = useState<string | null>(null);
  /** null：加载中；[]：加载失败或无数据 */
  const [stockListRows, setStockListRows] = useState<StockListRow[] | null>(null);
  const [stockListLoadError, setStockListLoadError] = useState<string | null>(null);
  /** 解析名称/代码时部分失败时在输入区下方提示 */
  const [compareParseError, setCompareParseError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<ContrastRow[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  // industry tree state
  const [swTree, setSwTree] = useState<SwTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeLoadError, setTreeLoadError] = useState<string | null>(null);
  const [treeNodeLoading, setTreeNodeLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [treeSelection, setTreeSelection] = useState<TreeSelection | null>(null);
  const [treeFilter, setTreeFilter] = useState('');
  const [memberMatchedNodeCodes, setMemberMatchedNodeCodes] = useState<Set<string>>(new Set());
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [treePaneWidth, setTreePaneWidth] = useState(480);
  const { snapshots: swIndexSnapshots, loading: swIndexSnapshotsLoading, tradeDate: swIndexTradeDate } =
    useSwIndexPriceSnapshots();
  const dragSplitRef = useRef<{ startX: number; startW: number } | null>(null);
  /** 左侧申万节点 industry_growth（%）；顶部「开始对比」会清空 */
  const industryGrowthPctRef = useRef<number | null>(null);

  // metric filter state
  const [filterExpr, setFilterExpr] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pinnedCodes, setPinnedCodes] = useState<Set<string>>(new Set());
  const [autoPinByRoeTargetKey, setAutoPinByRoeTargetKey] = useState<string | null>(null);
  const [balanceHistoryModal, setBalanceHistoryModal] = useState<{ title: string; chart: MetricChart } | null>(null);
  const openBalanceHistoryModal = useCallback((chartPayload: MetricChart, title: string) => {
    setBalanceHistoryModal({ title, chart: chartPayload });
  }, []);

  /** 证券详情弹窗（巨潮 / K线 / 三大报表） */
  const [stockDetail, setStockDetail] = useState<{ tsCode: string; stockName?: string } | null>(null);
  const closeStockDetailModal = useCallback(() => setStockDetail(null), []);
  const openStockDetailModal = useCallback((tsCode: string, stockName?: string) => {
    const c = String(tsCode ?? '').trim().toUpperCase();
    if (!c) return;
    const name = String(stockName ?? '').trim();
    setStockDetail({ tsCode: c, stockName: name || undefined });
  }, []);

  /** 基于定期报告标题归纳的热点概念（键为 tsCode 大写） */
  const [hotConceptsByCode, setHotConceptsByCode] = useState<Record<string, HotConceptsCellState>>({});
  const hotConceptsRequestedRef = useRef<Set<string>>(new Set());
  /** 热点结果合并到每帧一次 setState，减少 displayGridData 与 DataGrid 连锁刷新 */
  const hotConceptsBatchRef = useRef<Record<string, HotConceptsCellState>>({});
  const hotConceptsRafRef = useRef<number | null>(null);
  const codesKeyForHotConcepts = useMemo(() => buildCodesKey(codes), [codes]);

  const scheduleHotConceptsUpdate = useCallback((code: string, next: HotConceptsCellState) => {
    hotConceptsBatchRef.current[code] = next;
    if (hotConceptsRafRef.current != null) return;
    hotConceptsRafRef.current = requestAnimationFrame(() => {
      hotConceptsRafRef.current = null;
      const batch = hotConceptsBatchRef.current;
      hotConceptsBatchRef.current = {};
      const keys = Object.keys(batch);
      if (keys.length === 0) return;
      setHotConceptsByCode((prev) => {
        let out: Record<string, HotConceptsCellState> | null = null;
        for (const k of keys) {
          const v = batch[k];
          if (hotConceptsEqual(prev[k], v)) continue;
          if (!out) out = { ...prev };
          out[k] = v;
        }
        return out ?? prev;
      });
    });
  }, []);

  const displayGridStableRef = useRef<CSVData | null>(null);
  const displayGridRowByCodeRef = useRef<Map<string, ContrastGridRow>>(new Map());

  /** 顶部控制区（代码输入、指标过滤）展开/收起，收起后下方分栏占满剩余高度 */
  const [controlPanelExpanded, setControlPanelExpanded] = useState(true);
  /** 产业链 deep link：隐藏左侧行业树，表格占满内容区 */
  const [gridLayoutFullscreen, setGridLayoutFullscreen] = useState(false);

  /** 仅勾选时对已加载行请求公告热点归纳（走本地大模型，较慢）；不勾选则不请求 */
  const [hotConceptsLlmEnabled, setHotConceptsLlmEnabled] = useState(false);

  const urlBootstrapRef = useRef(false);
  const autoComparePendingRef = useRef(false);
  const autoCompareDoneRef = useRef(false);
  const hasTaxonomyParamRef = useRef(false);
  const taxonomyBootstrapReadyRef = useRef(false);
  /** 子泳道 stocks deep link 携带的产业链上下文（确定性/弹性等） */
  const subLaneDeepLinkRef = useRef<SubLaneDeepLinkContext | null>(null);
  /** taxonomy 解析出的对比输入文本（避免 setState 与 auto 对比竞态） */
  const taxonomyCompareTextRef = useRef<string | null>(null);
  const [taxonomyBootstrapVersion, setTaxonomyBootstrapVersion] = useState(0);
  const [chainContextMaps, setChainContextMaps] = useState<ChainContextMaps | null>(null);
  const [taxonomyBootstrapError, setTaxonomyBootstrapError] = useState<string | null>(null);

  const stockResolveIdx = useMemo(() => {
    if (stockListRows === null || stockListRows.length === 0) return null;
    return buildStockResolveIndex(stockListRows);
  }, [stockListRows]);

  // 产业链页 deep link：?stocks=...&auto=1&lane=子泳道名&gridFull=1；或 ?taxonomy=...&auto=1
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('gridFull') === '1') {
      setGridLayoutFullscreen(true);
      setControlPanelExpanded(false);
    }
    const taxonomyRaw = params.get('taxonomy')?.trim();
    if (taxonomyRaw) {
      const taxonomyId = normalizeTaxonomyId(taxonomyRaw);
      hasTaxonomyParamRef.current = true;
      const lane = params.get('lane')?.trim();
      if (lane) setUrlLaneLabel(lane);
      if (params.get('auto') === '1') autoComparePendingRef.current = true;

      let cancelled = false;
      fetch('/api/industry-link/taxonomies')
        .then(async (res) => {
          const payload = (await res.json().catch(() => ({}))) as {
            taxonomies?: IndustryTaxonomyRegistryItem[];
            error?: string;
          };
          if (!res.ok) throw new Error(payload.error ?? `读取产业链失败 (${res.status})`);
          const item = (payload.taxonomies ?? []).find((t) => normalizeTaxonomyId(t.id) === taxonomyId);
          if (!item) throw new Error(`未找到产业链 taxonomy: ${taxonomyRaw}`);
          return item;
        })
        .then((item) => {
          if (cancelled) return;
          const tax = parseTaxonomyYamlContent(item.content);
          const extracted = extractChainCompaniesFromTaxonomy(tax);
          if (extracted.inputTokens.length === 0) {
            throw new Error('该产业链 YAML 中暂无企业');
          }
          const compareText = extracted.inputTokens.join(',');
          taxonomyCompareTextRef.current = compareText;
          setInputText(compareText);
          setChainContextMaps({
            byTsCode: extracted.contextByTsCode,
            byCompanyName: extracted.contextByCompanyName,
          });
          setUrlLaneLabel((prev) => prev ?? item.label);
          setTaxonomyBootstrapError(null);
          taxonomyBootstrapReadyRef.current = true;
          setTaxonomyBootstrapVersion((v) => v + 1);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setTaxonomyBootstrapError(msg);
          autoComparePendingRef.current = false;
          autoCompareDoneRef.current = true;
          taxonomyBootstrapReadyRef.current = true;
          setTaxonomyBootstrapVersion((v) => v + 1);
        });

      return () => {
        cancelled = true;
      };
    }

    if (urlBootstrapRef.current) return;
    const stocks = params.get('stocks')?.trim();
    if (!stocks) return;
    urlBootstrapRef.current = true;
    setInputText(stocks);
    const lane = params.get('lane')?.trim();
    if (lane) setUrlLaneLabel(lane);
    const subCertainty = params.get('subCertainty')?.trim() || undefined;
    const subElasticity = params.get('subElasticity')?.trim() || undefined;
    const coCtxRaw = params.get('coCtx')?.trim() || undefined;
    if (lane || subCertainty || subElasticity || coCtxRaw) {
      subLaneDeepLinkRef.current = {
        lane: lane ?? '',
        subCertainty,
        subElasticity,
        coCtxRaw,
      };
    }
    if (params.get('auto') === '1') autoComparePendingRef.current = true;
  }, []);

  useEffect(() => {
    if (hasTaxonomyParamRef.current) return;
    const sub = subLaneDeepLinkRef.current;
    if (!sub || codes.length === 0) return;
    setChainContextMaps(buildChainContextMapsFromSubLaneLink(sub, codes, stockListRows));
  }, [codes, stockListRows]);

  const applyCompareFromInput = useCallback(
    (text: string, opts?: { clearIndustryGrowth?: boolean }) => {
      if (opts?.clearIndustryGrowth !== false) industryGrowthPctRef.current = null;
      setCompareParseError(null);
      const { codes: parsed, errors, blockingError } = resolveInputTextToCodes(
        text,
        stockResolveIdx,
        stockListRows === null,
        stockListLoadError,
      );
      if (blockingError) {
        setCompareParseError(blockingError);
        return false;
      }
      if (errors.length > 0) {
        setCompareParseError(`以下未能解析（代码与名称可混写，空格/斜杠/逗号/分号等分隔）：${errors.join('、')}`);
      }
      setCodes(parsed);
      setAutoPinByRoeTargetKey(parsed.length ? buildCodesKey(parsed) : null);
      return parsed.length > 0;
    },
    [stockListRows, stockResolveIdx, stockListLoadError],
  );

  useEffect(() => {
    if (!autoComparePendingRef.current || autoCompareDoneRef.current) return;
    if (stockListRows === null) return;
    if (hasTaxonomyParamRef.current && !taxonomyBootstrapReadyRef.current) return;
    autoCompareDoneRef.current = true;
    autoComparePendingRef.current = false;
    const text = taxonomyCompareTextRef.current ?? inputText;
    applyCompareFromInput(text);
  }, [stockListRows, inputText, applyCompareFromInput, taxonomyBootstrapVersion]);

  // 股票列表（用于顶部输入按名称解析 ts_code）
  useEffect(() => {
    let cancelled = false;
    fetch('/api/csv/stockList')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data?: StockListRow[] }>;
      })
      .then((j) => {
        if (cancelled) return;
        const data = Array.isArray(j?.data) ? j.data : [];
        setStockListRows(data);
        setStockListLoadError(data.length === 0 ? '股票基础列表为空' : null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStockListRows([]);
        setStockListLoadError(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // load sw tree once
  useEffect(() => {
    setTreeLoading(true);
    setTreeLoadError(null);
    fetch('/api/parq/sw2021/tree')
      .then((r) => r.json())
      .then((json) => {
        const tree = Array.isArray(json?.tree) ? (json.tree as SwTreeNode[]) : [];
        setSwTree(tree);
        setExpandedNodes(new Set(tree.map((n) => swNodeKey(n))));
      })
      .catch((e) => {
        setTreeLoadError(e instanceof Error ? e.message : '加载申万分类失败');
      })
      .finally(() => setTreeLoading(false));
  }, []);

  useEffect(() => {
    const q = treeFilter.trim();
    if (!q) {
      setMemberMatchedNodeCodes(new Set());
      setMemberSearchLoading(false);
      return;
    }
    let cancelled = false;
    setMemberSearchLoading(true);
    const id = setTimeout(() => {
      fetch(`/api/parq/sw2021/search-members?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          const arr = Array.isArray(json?.nodeCodes) ? json.nodeCodes : [];
          const next = new Set<string>();
          for (const code of arr) {
            const s = String(code ?? '').trim().toUpperCase();
            if (s) next.add(s);
          }
          setMemberMatchedNodeCodes(next);
        })
        .catch(() => {
          if (!cancelled) setMemberMatchedNodeCodes(new Set());
        })
        .finally(() => {
          if (!cancelled) setMemberSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [treeFilter]);

  const industryTree = useMemo(() => {
    const filter = treeFilter.toLowerCase();
    const walk = (nodes: SwTreeNode[]): SwTreeNode[] =>
      nodes
        .map((n) => {
          const children = walk(n.children ?? []);
          if (!filter) return { ...n, children };
          const matched =
            n.name.toLowerCase().includes(filter) ||
            n.indexCode.toLowerCase().includes(filter) ||
            n.level.toLowerCase().includes(filter);
          const stockMatched = memberMatchedNodeCodes.has(String(n.indexCode ?? '').toUpperCase());
          if (matched || stockMatched || children.length > 0) return { ...n, children };
          return null;
        })
        .filter((n): n is SwTreeNode => n != null);
    return walk(swTree);
  }, [swTree, treeFilter, memberMatchedNodeCodes]);

  const swTreeExpandableKeys = useMemo(() => collectExpandableSwNodeKeys(swTree), [swTree]);

  const swTreeAllExpanded = useMemo(() => {
    if (swTreeExpandableKeys.length === 0) return false;
    return swTreeExpandableKeys.every((k) => expandedNodes.has(k));
  }, [swTreeExpandableKeys, expandedNodes]);

  const toggleExpandAllSwTree = useCallback(() => {
    setExpandedNodes(swTreeAllExpanded ? new Set() : new Set(swTreeExpandableKeys));
  }, [swTreeAllExpanded, swTreeExpandableKeys]);

  const fetchNodeStockCodes = useCallback(async (node: SwTreeNode): Promise<string[]> => {
    const size = 500;
    let page = 1;
    let totalRows = 0;
    const set = new Set<string>();

    while (true) {
      const query = new URLSearchParams({
        level: node.level,
        code: node.indexCode,
        page: String(page),
        size: String(size),
      });
      const res = await fetch(`/api/parq/sw2021/members?${query.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      totalRows = Number(json?.totalRows ?? 0);
      for (const r of data) {
        const code = String(r?.ts_code ?? '').trim().toUpperCase();
        if (/^\d{6}\.(SZ|SH|BJ)$/.test(code)) set.add(code);
      }
      if (page * size >= totalRows || data.length === 0) break;
      page += 1;
    }
    return [...set].sort();
  }, []);

  const applyTreeCodes = useCallback((nextCodes: string[], sel: TreeSelection) => {
    industryGrowthPctRef.current =
      sel.industry_growth != null && Number.isFinite(sel.industry_growth) ? sel.industry_growth : null;
    setTreeSelection(sel);
    setInputText(nextCodes.join(', '));
    setCodes(nextCodes);
    setAutoPinByRoeTargetKey(nextCodes.length ? buildCodesKey(nextCodes) : null);
  }, []);

  const onSelectNode = useCallback(
    async (node: SwTreeNode) => {
      const sel: TreeSelection = {
        kind: 'node',
        level: node.level,
        name: node.name,
        indexCode: node.indexCode,
        memberCount: node.memberCount,
        industry_growth: node.industry_growth ?? null,
      };
      setTreeSelection(sel);
      setTreeNodeLoading(true);
      try {
        const next = await fetchNodeStockCodes(node);
        applyTreeCodes(next, sel);
      } catch {
        applyTreeCodes([], sel);
      } finally {
        setTreeNodeLoading(false);
      }
    },
    [applyTreeCodes, fetchNodeStockCodes]
  );

  // 左右分栏拖动
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragSplitRef.current) return;
      const dx = e.clientX - dragSplitRef.current.startX;
      const maxW = typeof window !== 'undefined' ? window.innerWidth * 0.55 : 800;
      const w = Math.min(Math.max(dragSplitRef.current.startW + dx, 200), maxW);
      setTreePaneWidth(w);
    };
    const onUp = () => {
      dragSplitRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startSplitDrag = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragSplitRef.current = { startX: e.clientX, startW: treePaneWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [treePaneWidth]);

  const progressText = useMemo(() => {
    if (!codes.length) return '未开始';
    if (!running) return `完成 ${doneCount}/${codes.length}`;
    return `加载中 ${doneCount}/${codes.length}`;
  }, [codes.length, doneCount, running]);

  const renderTreeNode = useCallback((node: SwTreeNode, depth = 0): React.ReactNode => {
    const key = swNodeKey(node);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const expanded = expandedNodes.has(key);
    const selected = treeSelection?.kind === 'node' && treeSelection.indexCode === node.indexCode;
    const snap = swIndexSnapshots.get(String(node.indexCode ?? '').toUpperCase());
    const rets = snap?.returns;
    const displayName =
      node.industry_growth != null && Number.isFinite(node.industry_growth)
        ? `${node.name}-${node.industry_growth}%`
        : node.name;

    return (
      <div key={key}>
        <div
          className={`flex items-stretch rounded-md mb-0.5 ${selected ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
          style={{ marginLeft: `${depth * 10}px` }}
        >
          <button
            type="button"
            className="w-7 shrink-0 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-l-md"
            aria-label={expanded ? '折叠' : '展开'}
            disabled={!hasChildren}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!hasChildren) return;
              setExpandedNodes((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
          >
            {hasChildren ? (expanded ? '▼' : '▶') : '·'}
          </button>
          <button
            type="button"
            className={`min-w-0 flex-1 text-left px-1 py-1.5 text-sm text-gray-800 hover:bg-gray-50/80 rounded-r-md ${SW_TREE_ROW_COLS}`}
            onClick={() => { void onSelectNode(node); }}
            title={`${displayName} ${node.indexCode}${node.industry_growth != null && Number.isFinite(node.industry_growth) ? ` 行业增速 ${node.industry_growth}%（分类表）` : ''}`}
          >
            <span className="truncate font-medium">{displayName}</span>
            <span className="truncate text-[11px] text-gray-500">{node.indexCode}</span>
            <span className={`text-[11px] tabular-nums text-right ${swChgClass(rets?.d1)}`}>
              {formatSwChgPct(rets?.d1)}
            </span>
            <span className={`text-[11px] tabular-nums text-right ${swChgClass(rets?.d5)}`}>
              {formatSwChgPct(rets?.d5)}
            </span>
            <span className={`text-[11px] tabular-nums text-right ${swChgClass(rets?.d20)}`}>
              {formatSwChgPct(rets?.d20)}
            </span>
            <span className="text-[11px] text-gray-400 text-right tabular-nums">({node.memberCount})</span>
          </button>
        </div>
        {hasChildren && expanded && (
          <div className="space-y-0.5">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }, [expandedNodes, onSelectNode, swIndexSnapshots, treeSelection]);

  const columnOrder = useMemo(
    () => ['pin_top', 'stock_basic', ...METRIC_COLUMNS.map((c) => c.key)],
    []
  );

  const toggleRowPin = useCallback((tsCode: string, checked: boolean) => {
    setPinnedCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(tsCode);
      else next.delete(tsCode);
      return next;
    });
  }, []);

  const cellRenderers = useMemo(() => {
    const pinRenderer = (params: any) => {
      const tsCode = String(params?.data?.stock_basic?.tsCode ?? params?.value ?? '').toUpperCase();
      if (!tsCode) return null;
      const checked = pinnedCodes.has(tsCode);
      return (
        <div className="flex h-full items-start justify-center pt-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => toggleRowPin(tsCode, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${tsCode} 置顶`}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>
      );
    };

    const stockRenderer = (params: any) => {
      const row = params?.value as StockBasicGridValue | undefined;
      if (!row) return <div className="text-xs text-gray-400">—</div>;
      const seq = (params.node?.rowIndex ?? 0) + 1;
      return (
        <StockBasicInfoCell
          seq={seq}
          tsCode={row.tsCode}
          loading={row.loading}
          error={row.error}
          stockInfo={row.stockInfo}
          marketSnapshot={row.marketSnapshot}
          klineBars={row.klineBars ?? []}
          hot={row.__hotConcepts}
          chainContext={row.__chainContext}
          onOpenDetail={openStockDetailModal}
        />
      );
    };

    const renderers: Record<string, (params: any) => any> = {
      pin_top: pinRenderer,
      stock_basic: stockRenderer,
    };
    for (const c of METRIC_COLUMNS) {
      renderers[c.key] = (params: any) => {
        const chart = params?.value as MetricChart | undefined;
        const row = params?.data?.stock_basic as ContrastRow | undefined;
        const rowTitle = row?.stockInfo?.name
          ? `${row.tsCode} ${row.stockInfo.name} 资产负债结构历史（最近3年，12期）`
          : `${row?.tsCode ?? ''} 资产负债结构历史（最近3年，12期）`;
        return (
          <IncomeChartCell
            metricKey={c.key}
            chart={chart ?? emptyChart()}
            balanceHistoryTitle={rowTitle}
            onOpenBalanceHistory={c.key === 'balance_structure' ? openBalanceHistoryModal : undefined}
          />
        );
      };
    }
    return renderers;
    // 热点不进依赖：由行数据 __hotConcepts（displayGridData）刷新，避免每只股票 loading/ready 都换 renderers 引用导致 DataGrid 整表重建列
  }, [pinnedCodes, toggleRowPin, openBalanceHistoryModal, openStockDetailModal]);

  const rowsRef = useRef<ContrastRow[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CONCURRENCY = 5;
  const FLUSH_INTERVAL_MS = 600;

  const flushRows = useCallback(() => {
    setRows([...rowsRef.current]);
  }, []);

  useEffect(() => {
    if (!codes.length) {
      rowsRef.current = [];
      setRows([]);
      setDoneCount(0);
      return;
    }
    let cancelled = false;

    const initialRows = codes.map((tsCode) => ({
      tsCode,
      loading: true,
      stockInfo: null,
      marketSnapshot: null,
      klineBars: [],
      charts: emptyCharts(),
    }));
    rowsRef.current = initialRows;
    setRows(initialRows);
    setRunning(true);
    setDoneCount(0);

    const codeIdx = { next: 0, done: 0 };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        if (!cancelled) flushRows();
      }, FLUSH_INTERVAL_MS);
    };

    const processNext = async (): Promise<void> => {
      while (codeIdx.next < codes.length && !cancelled) {
        const i = codeIdx.next++;
        const tsCode = codes[i];
        const row = await buildContrastRow(tsCode, industryGrowthPctRef.current);
        if (cancelled) break;
        rowsRef.current = rowsRef.current.map((r) => (r.tsCode === tsCode ? row : r));
        codeIdx.done++;
        if (!cancelled) setDoneCount(codeIdx.done);
        scheduleFlush();
      }
    };

    const run = async () => {
      const workers = Array.from({ length: Math.min(CONCURRENCY, codes.length) }, () => processNext());
      await Promise.all(workers);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (!cancelled) {
        flushRows();
        setRunning(false);
      }
    };
    run();

    return () => {
      cancelled = true;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setRunning(false);
    };
  }, [codes, flushRows]);

  /** 对比股票集合变化时清空热点请求记录与结果 */
  useEffect(() => {
    hotConceptsRequestedRef.current.clear();
    hotConceptsBatchRef.current = {};
    if (hotConceptsRafRef.current != null) {
      cancelAnimationFrame(hotConceptsRafRef.current);
      hotConceptsRafRef.current = null;
    }
    displayGridStableRef.current = null;
    displayGridRowByCodeRef.current = new Map();
    setHotConceptsByCode({});
  }, [codesKeyForHotConcepts]);

  /** 关闭热点 LLM 时清空在途请求状态与已展示结果，避免仍显示旧归纳或占满请求表 */
  useEffect(() => {
    if (hotConceptsLlmEnabled) return;
    hotConceptsRequestedRef.current.clear();
    hotConceptsBatchRef.current = {};
    if (hotConceptsRafRef.current != null) {
      cancelAnimationFrame(hotConceptsRafRef.current);
      hotConceptsRafRef.current = null;
    }
    setHotConceptsByCode({});
  }, [hotConceptsLlmEnabled]);

  /** 行加载完成后按代码请求热点归纳（仅 hotConceptsLlmEnabled 为真；结果写入 displayGridData.__hotConcepts） */
  useEffect(() => {
    if (!hotConceptsLlmEnabled) return;
    const ready = rows.filter((r) => !r.loading);
    for (const row of ready) {
      const code = row.tsCode.trim().toUpperCase();
      if (hotConceptsRequestedRef.current.has(code)) continue;
      hotConceptsRequestedRef.current.add(code);
      scheduleHotConceptsUpdate(code, { state: 'loading' });
      void fetch('/api/hot-concepts/from-disclosures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsCode: code }),
      })
        .then(async (res) => {
          const j = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
          if (!res.ok) {
            const err = typeof j?.error === 'string' ? j.error : `HTTP ${res.status}`;
            scheduleHotConceptsUpdate(code, { state: 'error', err });
            return;
          }
          const summary = typeof j?.summary === 'string' ? j.summary.trim() : '';
          scheduleHotConceptsUpdate(code, { state: 'ready', summary });
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          scheduleHotConceptsUpdate(code, { state: 'error', err: msg });
        });
    }
  }, [rows, scheduleHotConceptsUpdate, hotConceptsLlmEnabled]);

  // metric filter: evaluate expression against latest metrics
  const { filteredRows, filterErr } = useMemo(() => {
    if (!filterExpr.trim()) return { filteredRows: rows, filterErr: null as string | null };
    try {
      const expr = filterExpr.trim();
      const lastFinite = (series: number[]) => { for (let i = series.length - 1; i >= 0; i--) if (Number.isFinite(series[i])) return series[i]; return null; };
      const filtered = rows.filter((row) => {
        const ctx: Record<string, number | null> = {};
        const revMv = row.charts.rev_mv;
        const costM = row.charts.cost_margin;
        const fee = row.charts.fee_revenue;
        const dy = row.charts.dividend_yield;
        const gs = row.charts.growth_summary;
        const dp = row.charts.dupont;
        ctx['营收'] = ctx['revenue'] = revMv.series[0] ? lastFinite(revMv.series[0]) : null;
        ctx['利润'] = ctx['profit'] = revMv.series[1] ? lastFinite(revMv.series[1]) : null;
        ctx['市值'] = ctx['mv'] = revMv.series[2] ? lastFinite(revMv.series[2]) : null;
        ctx['毛利率'] = costM.series[2] ? lastFinite(costM.series[2]) : null;
        ctx['销售费率'] = fee.series[1] && fee.series[0] ? (() => { const s = lastFinite(fee.series[1]); const r = lastFinite(fee.series[0]); return s != null && r != null && r !== 0 ? (s / r) * 100 : null; })() : null;
        ctx['研发费率'] = fee.series[3] && fee.series[0] ? (() => { const s = lastFinite(fee.series[3]); const r = lastFinite(fee.series[0]); return s != null && r != null && r !== 0 ? (s / r) * 100 : null; })() : null;
        ctx['股息率'] = ctx['dividendYield'] = dy.series[0] ? lastFinite(dy.series[0]) : null;
        ctx['市值CAGR'] = gs.series[0]?.[0] ?? null;
        ctx['营收CAGR'] = gs.series[0]?.[1] ?? null;
        ctx['利润CAGR'] = gs.series[0]?.[2] ?? null;
        ctx['净资产CAGR'] = gs.series[0]?.[3] ?? null;
        ctx['周转率'] = ctx['turnover'] = dp.series[0] ? lastFinite(dp.series[0]) : null;
        ctx['权益乘数'] = ctx['multiplier'] = dp.series[1] ? lastFinite(dp.series[1]) : null;
        ctx['净利率'] = ctx['netMargin'] = dp.series[2] ? lastFinite(dp.series[2]) : null;
        ctx['ROE'] = ctx['roe'] = dp.series[3] ? lastFinite(dp.series[3]) : null;
        const fs = row.charts.forecast_signal;
        ctx['预测得分'] = ctx['forecastScore'] = fs.series[0]?.[3] ?? null;
        ctx['预测净利增速'] = ctx['forecastProfitGrowth'] = fs.series[0]?.[4] ?? null;
        ctx['预测净利润'] = ctx['forecastProfit'] = fs.series[0]?.[5] ?? null;
        const keys = Object.keys(ctx);
        const vals = keys.map((k) => ctx[k] ?? NaN);
        const fn = new Function(...keys, `"use strict"; return (${expr});`);
        return !!fn(...vals);
      });
      return { filteredRows: filtered, filterErr: null as string | null };
    } catch (e) {
      return { filteredRows: rows, filterErr: e instanceof Error ? e.message : '表达式错误' };
    }
  }, [rows, filterExpr]);

  useEffect(() => { setFilterError(filterErr); }, [filterErr]);

  useEffect(() => {
    setPinnedCodes(readPinnedCodesFromStorage());
  }, []);

  useEffect(() => {
    writePinnedCodesToStorage(pinnedCodes);
  }, [pinnedCodes]);

  useEffect(() => {
    if (!balanceHistoryModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBalanceHistoryModal(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [balanceHistoryModal]);

  useEffect(() => {
    if (!autoPinByRoeTargetKey) return;
    if (buildCodesKey(codes) !== autoPinByRoeTargetKey) return;

    if (codes.length === 0) {
      setAutoPinByRoeTargetKey(null);
      return;
    }

    const targetSet = new Set(codes.map((c) => c.toUpperCase()));
    const targetRows = rows.filter((r) => targetSet.has(r.tsCode.toUpperCase()));
    const allReady = targetRows.length === targetSet.size && targetRows.every((r) => !r.loading);
    if (!allReady) return;

    const lastFinite = (series: number[]) => {
      for (let i = series.length - 1; i >= 0; i -= 1) {
        if (Number.isFinite(series[i])) return series[i];
      }
      return null;
    };

    const picked = targetRows
      .map((row) => {
        const roeSeries = row.charts.dupont.series[3] ?? [];
        const roePct = lastFinite(roeSeries);
        return roePct != null && roePct >= 10 ? row.tsCode.toUpperCase() : null;
      })
      .filter((code): code is string => code != null);

    if (picked.length > 0) {
      setPinnedCodes((prev) => {
        const next = new Set(prev);
        for (const code of picked) next.add(code);
        return next;
      });
    }
    setAutoPinByRoeTargetKey(null);
  }, [autoPinByRoeTargetKey, codes, rows]);

  const startCompare = useCallback(() => {
    applyCompareFromInput(inputText);
  }, [inputText, applyCompareFromInput]);

  const orderedFilteredRows = useMemo(() => {
    if (pinnedCodes.size === 0) return filteredRows;
    const pinned: ContrastRow[] = [];
    const normal: ContrastRow[] = [];
    for (const row of filteredRows) {
      if (pinnedCodes.has(row.tsCode.toUpperCase())) pinned.push(row);
      else normal.push(row);
    }
    return [...pinned, ...normal];
  }, [filteredRows, pinnedCodes]);

  /** 股票集合或置顶集合变化时让 AG Grid 去掉列排序，否则「置顶 / ROE 自动置顶」的行序会被排序状态盖住 */
  const gridClientSortResetKey = useMemo(() => {
    const pinPart = [...pinnedCodes].map((c) => String(c).trim().toUpperCase()).sort().join('|');
    return `${buildCodesKey(codes)}#${pinPart}`;
  }, [codes, pinnedCodes]);

  // grid uses filteredRows：行级复用引用 + 整表未变时复用 CSVData，减轻 AG Grid / DataGrid 重刷
  const displayGridData = useMemo<CSVData>(() => {
    const headers = ['置顶', '股票基本信息', ...METRIC_COLUMNS.map((c) => c.label)];
    const rowCache = displayGridRowByCodeRef.current;
    const nextRowCache = new Map<string, ContrastGridRow>();

    const nextData: ContrastGridRow[] = orderedFilteredRows.map((row) => {
      const code = row.tsCode.trim().toUpperCase();
      const hot = hotConceptsByCode[code];
      const chainCtx = lookupChainContext(code, row.stockInfo?.name, chainContextMaps);
      const metricData = Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, row.charts[c.key]])) as Record<MetricKey, MetricChart>;
      const pin = row.tsCode.toUpperCase();
      const prevRow = rowCache.get(code);
      if (prevRow) {
        const sb = prevRow.stock_basic;
        const baseSame =
          sb.tsCode === row.tsCode &&
          sb.loading === row.loading &&
          sb.error === row.error &&
          sb.stockInfo === row.stockInfo &&
          sb.marketSnapshot === row.marketSnapshot &&
          sb.klineBars === row.klineBars &&
          sb.charts === row.charts;
        const hotSame = hotConceptsEqual(sb.__hotConcepts, hot);
        const chainSame = sb.__chainContext === chainCtx;
        const pinSame = prevRow.pin_top === pin;
        let metricsSame = true;
        for (const c of METRIC_COLUMNS) {
          if (prevRow[c.key] !== metricData[c.key]) {
            metricsSame = false;
            break;
          }
        }
        if (baseSame && hotSame && chainSame && pinSame && metricsSame) {
          nextRowCache.set(code, prevRow);
          return prevRow;
        }
      }
      const built = {
        pin_top: pin,
        stock_basic: { ...row, __hotConcepts: hot, __chainContext: chainCtx },
        ...metricData,
      } as ContrastGridRow;
      nextRowCache.set(code, built);
      return built;
    });
    displayGridRowByCodeRef.current = nextRowCache;

    const prevCsv = displayGridStableRef.current;
    if (prevCsv && prevCsv.data.length === nextData.length) {
      let identical = true;
      for (let i = 0; i < nextData.length; i += 1) {
        if (prevCsv.data[i] !== nextData[i]) {
          identical = false;
          break;
        }
      }
      if (identical) {
        return prevCsv;
      }
    }

    const csv: CSVData = {
      category: 'incomeContrast',
      filename: 'incomeContrast',
      headers,
      originalHeaders: columnOrder,
      data: nextData,
      totalRows: nextData.length,
    };
    displayGridStableRef.current = csv;
    return csv;
  }, [orderedFilteredRows, columnOrder, hotConceptsByCode, chainContextMaps]);

  const gridRowHeight = chainContextMaps ? 360 : 320;

  return (
    <div className="box-border flex max-h-full min-h-0 min-w-0 max-w-full flex-1 basis-0 flex-col gap-4 overflow-hidden p-4">
      {/* control panel — 可折叠 */}
      <div className="w-full max-w-full shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setControlPanelExpanded((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/90"
          aria-expanded={controlPanelExpanded}
          aria-controls="income-contrast-control-panel"
          id="income-contrast-control-panel-toggle"
        >
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-gray-500 transition-transform duration-200 ${controlPanelExpanded ? '' : '-rotate-90'}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-900">
              条件{urlLaneLabel ? ` · ${urlLaneLabel}` : ''}
            </h2>
            {!controlPanelExpanded && (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {progressText}
                {codes.length > 0 ? ` · ${codes.length} 只股票` : ''}
                {filterExpr.trim() && !filterError ? ` · 过滤 ${filteredRows.length}/${rows.length}` : ''}
              </p>
            )}
          </div>
        </button>
        {controlPanelExpanded && (
          <div
            id="income-contrast-control-panel"
            role="region"
            aria-labelledby="income-contrast-control-panel-toggle"
            className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-2"
          >
            <p className="text-sm text-gray-600">
              左侧行业树点击枝干（一级/二级行业）或叶子（个股）即可在右侧加载对比；亦可手动输入股票代码或股票名称（空格、斜杠、逗号、分号或换行分隔）后点「开始对比」。指标过滤作用于右侧已加载数据。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (compareParseError) setCompareParseError(null);
                }}
                placeholder="例如：600519.SH 贵州茅台 / 600519; 海天味业（空格、斜杠、逗号、分号、换行均可分隔）"
                className="min-w-[24rem] flex-1"
                aria-invalid={!!compareParseError}
              />
              <Button onClick={startCompare} disabled={running}>
                {running ? '加载中...' : '开始对比'}
              </Button>
              <span className="text-sm text-gray-500">{progressText}</span>
            </div>
            <div className="space-y-1 text-xs">
              {stockListRows === null && (
                <p className="text-gray-500">正在加载股票基础列表（用于名称与 6 位代码解析）…</p>
              )}
              {stockListRows !== null && stockListLoadError && (
                <p className="text-red-600">股票列表不可用：{stockListLoadError}</p>
              )}
              {compareParseError && <p className="text-amber-700">{compareParseError}</p>}
              {taxonomyBootstrapError && <p className="text-red-600">产业链加载失败：{taxonomyBootstrapError}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">指标过滤:</span>
              <Input
                value={filterExpr}
                onChange={(e) => setFilterExpr(e.target.value)}
                placeholder="例: 毛利率 > 30 && 利润CAGR > 10 && ROE > 15"
                className="min-w-[28rem] flex-1 font-mono text-sm"
              />
              {filterExpr.trim() && (
                <span className="text-xs text-gray-500">
                  {filterError ? <span className="text-red-500">{filterError}</span> : `${filteredRows.length}/${rows.length} 条匹配`}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400">
              可用变量: 营收, 利润, 市值 (亿) | 毛利率, 净利率, ROE, 股息率 (%) | 周转率, 权益乘数 (次) | 营收CAGR, 利润CAGR, 净资产CAGR, 市值CAGR (%) | 销售费率, 研发费率 (%)
            </div>
            <div className="text-xs text-gray-400">
              预测变量: 预测得分(0-100), 预测净利增速(%), 预测净利润(亿)
            </div>
          </div>
        )}
      </div>

      {/* 左侧行业树 + 可拖动分隔条 + 右侧表格：限高避免树展开撑高整页，滚动在左右栏内部 */}
      <div className="flex min-h-0 min-w-0 max-h-full w-full flex-1 basis-0 flex-row overflow-hidden rounded-lg border border-gray-200 bg-white">
        {!gridLayoutFullscreen && (
        <div
          className="flex min-h-0 max-h-full min-w-0 shrink-0 flex-col self-stretch overflow-hidden border-r border-gray-100 bg-white"
          style={{ width: treePaneWidth }}
        >
          <div className="p-3 border-b border-gray-100 shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900 shrink-0">申万行业分类</h3>
                <button
                  type="button"
                  onClick={toggleExpandAllSwTree}
                  disabled={swTree.length === 0 || treeLoading}
                  className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title={swTreeAllExpanded ? '收起全部申万指数节点' : '展开全部申万指数节点'}
                  aria-pressed={swTreeAllExpanded}
                >
                  {swTreeAllExpanded ? '收起全部' : '展开全部'}
                </button>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hotConceptsLlmEnabled}
                  onChange={(e) => setHotConceptsLlmEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  aria-label="公告热点归纳使用大模型"
                />
                <span className="text-[11px] text-gray-600 whitespace-nowrap" title="勾选后对表格中已加载股票请求公告热点归纳（调用本地大模型，可能较慢）">
                  热点(LLM)
                </span>
              </label>
            </div>
            <Input
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              placeholder="搜索行业/指数/股票名称/股票代码"
              className="text-sm"
            />
            {treeFilter.trim() && memberSearchLoading && (
              <div className="text-[11px] text-gray-400">正在匹配股票名称/代码...</div>
            )}
            {treeSelection && (
              <div className="text-xs text-gray-500 leading-relaxed">
                已选 {treeSelection.level}「{treeSelection.name}」({treeSelection.indexCode})
                {treeSelection.industry_growth != null && Number.isFinite(treeSelection.industry_growth)
                  ? ` · 行业增速 ${treeSelection.industry_growth}%（分类表）`
                  : ''}{' '}
                — 预计 {treeSelection.memberCount} 只股票
                {treeNodeLoading ? '，正在加载成分...' : ''}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
            {industryTree.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-6">
                {treeLoading ? '加载分类树中...' : treeLoadError ? treeLoadError : '无匹配结果'}
              </div>
            ) : (
              <>
                <div
                  className={`sticky top-0 z-10 mb-1 border-b border-gray-100 bg-white py-1 pl-7 pr-1 text-[10px] text-gray-500 ${SW_TREE_ROW_COLS}`}
                >
                  <span>名称</span>
                  <span>代码</span>
                  <span className="text-right">1D</span>
                  <span className="text-right">5D</span>
                  <span className="text-right">20D</span>
                  <span className="text-right">支数</span>
                </div>
                {swIndexSnapshotsLoading && (
                  <div className="px-2 pb-1 text-[10px] text-gray-400">加载指数涨跌幅...</div>
                )}
                {!swIndexSnapshotsLoading && swIndexTradeDate && (
                  <div className="px-2 pb-1 text-[10px] text-gray-400">行情截至 {swIndexTradeDate}</div>
                )}
                {industryTree.map((n) => renderTreeNode(n))}
              </>
            )}
          </div>
        </div>
        )}

        {!gridLayoutFullscreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整左右宽度"
          onMouseDown={startSplitDrag}
          className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-sky-300 active:bg-sky-400 border-x border-gray-200 transition-colors"
        />
        )}

        <div className="flex min-h-0 min-w-0 max-h-full flex-1 basis-0 flex-col overflow-hidden bg-white">
          {codes.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-400">
              在左侧点击一级行业、二级行业或个股，右侧将加载对应股票对比；也可在上方输入股票代码或名称后点「开始对比」。
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 max-h-full flex-1 basis-0 overflow-x-auto">
              <DataGrid
                category="incomeContrast"
                tabId="incomeContrast_grid"
                title="利润对比"
                tightChrome
                localData={displayGridData}
                useServerPagination={false}
                columnOrder={columnOrder}
                fieldLabelMap={Object.fromEntries([
                  ['pin_top', '置顶'],
                  ['stock_basic', '股票基本信息'],
                  ...METRIC_COLUMNS.map((c) => [c.key, c.label]),
                ])}
                customCellRenderers={cellRenderers}
                rowHeight={gridRowHeight}
                gridHeight="100%"
                uniformColumnWidth={360}
                columnWidthByField={{ pin_top: 72, stock_basic: 360 }}
                cellStyleByField={{ stock_basic: { overflow: 'visible', padding: '2px 4px' } }}
                pinnedLeftFields={['pin_top', 'stock_basic']}
                clientSortResetKey={gridClientSortResetKey}
                animateRows={false}
                autoFullscreen={gridLayoutFullscreen}
                getRowId={(params: any) => params.data?.stock_basic?.tsCode ?? String(params.rowIndex)}
              />
            </div>
          )}
        </div>
      </div>

      <StockDetailModal
        open={stockDetail != null}
        tsCode={stockDetail?.tsCode ?? ''}
        stockName={stockDetail?.stockName}
        onClose={closeStockDetailModal}
      />

      {balanceHistoryModal &&
        createPortal(
          <div className="fixed inset-0 z-[1400] flex h-screen w-screen flex-col bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="text-sm font-semibold text-gray-900">{balanceHistoryModal.title}</div>
              <button
                type="button"
                onClick={() => setBalanceHistoryModal(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="关闭历史弹窗"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(balanceHistoryModal.chart.history ?? []).slice().reverse().map((item) => {
                  const miniBars = item.values.map((v, idx) => ({
                    idx: balanceHistoryModal.chart.x[idx] ?? String(idx + 1),
                    value: v,
                  }));
                  const balanceTooltip = ({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null;
                    const fullLabel = BALANCE_FULL_LABELS[label] ?? label;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 10, lineHeight: '14px' }}>
                        <div style={{ fontWeight: 600, marginBottom: 1, color: '#334155' }}>{fullLabel}</div>
                        {payload.map((p: any, i: number) => (
                          <div key={i} style={{ color: p.color, whiteSpace: 'nowrap' }}>
                            {p.name}: {Number.isFinite(Number(p.value)) ? `${Number(p.value).toFixed(2)}亿` : '—'}
                          </div>
                        ))}
                      </div>
                    );
                  };
                  return (
                    <div key={item.period} className="rounded border border-gray-200 p-2">
                      <div className="mb-1 text-xs font-medium text-gray-700">{item.period}</div>
                      <div className="h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={miniBars} margin={{ top: 6, right: 8, left: 0, bottom: 14 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="idx" tick={{ fontSize: 9 }} interval={0} angle={-90} textAnchor="end" height={46} />
                            <YAxis tick={{ fontSize: 9 }} width={38} tickFormatter={(v: any) => `${Number(v).toFixed(0)}亿`} />
                            <Tooltip content={balanceTooltip} />
                            <Bar dataKey="value" name="资产负债结构(亿)">
                              {miniBars.map((_, idx) => (
                                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                              ))}
                              <LabelList
                                dataKey="value"
                                position="top"
                                formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}亿` : '')}
                                style={{ fill: '#334155', fontSize: 9, fontWeight: 600 }}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-gray-200 px-4 py-2">
              <button
                type="button"
                onClick={() => setBalanceHistoryModal(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                关闭
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** All time-series metric names merged into one API call */
const ALL_SERIES_METRICS = [
  'total_revenue_ttm', 'n_income_attr_p_ttm', 'total_mv',
  'c_inf_fr_operate_a_ttm', 'n_cashflow_act_ttm',
  'oper_cost_ttm', 'grossMargin_ttm',
  'sell_exp_ttm', 'admin_exp_ttm', 'rd_exp_ttm',
  'total_hldr_eqy_exc_min_int',
  'dividend_ttm_rate',
  'mv_growth', 'revenue_growth', 'profit_growth', 'net_assets_growth',
  'netMargin_ttm', 'totalAsset_turnover_ttm', 'equity_multiplier_ttm', 'roe_dupont',
  'dcf_equity_value_ttm',
  'dcf_equity_value_ttm_growth_r',
  'dcf_equity_value_ttm_ni_growth_r',
  'dcf_equity_value_ttm_growth_ind',
  'dcf_equity_value_ttm_dividend',
  'dividend_ttm',
  'fcff_ttm', 'c_pay_acq_const_fiolta_ttm', 'net_debt',
  'st_borr', 'lt_borr', 'st_bonds_payable', 'bond_payable', 'money_cap', 'trad_asset',
].join(',');

/** Single-period snapshot metrics (balance structure) */
const BALANCE_METRICS = [
  'total_cash', 'prepayment', 'accounts_receiv', 'inventories',
  'oth_cur_assets', 'lt_eqt_invest', 'fix_assets', 'intan_assets', 'oth_nca',
  'st_borr', 'accounts_pay', 'contract_liab', 'payroll_taxes_payable',
  'oth_cur_liab', 'lt_borr', 'oth_ncl',
].join(',');

function parseKlineBars(rows: unknown[]): KlineBar[] {
  return rows
    .map((r: any) => {
      const open = parseNum(r?.open);
      const high = parseNum(r?.high);
      const low = parseNum(r?.low);
      const close = parseNum(r?.close);
      const vol = parseNum(r?.vol);
      if (open == null || high == null || low == null || close == null || vol == null) return null;
      return {
        trade_date: String(r?.trade_date ?? ''),
        open,
        high,
        low,
        close,
        vol,
      };
    })
    .filter((b): b is KlineBar => b != null)
    .reverse();
}

/** 按 trade_date 合并 daily_basic 换手率（日期统一为 YYYYMMDD 数值键） */
function mergeKlineTurnoverFromDaily(bars: KlineBar[], dailyRows: unknown[]): KlineBar[] {
  const turnoverByDate = new Map<number, number>();
  for (const r of dailyRows as any[]) {
    const d = parseDateNum(r?.trade_date);
    const rate = parseNum(r?.turnover_rate);
    if (!Number.isFinite(d) || rate == null) continue;
    turnoverByDate.set(d, rate);
  }
  if (turnoverByDate.size === 0) return bars;
  return bars.map((b) => {
    const d = parseDateNum(b.trade_date);
    const rate = Number.isFinite(d) ? turnoverByDate.get(d) : undefined;
    return rate == null ? b : { ...b, turnover_rate: rate };
  });
}

async function buildContrastRow(tsCode: string, industryGrowthPct?: number | null): Promise<ContrastRow> {
  const charts = emptyCharts();
  try {
    const enc = encodeURIComponent(tsCode);
    const useIndustryDcf =
      industryGrowthPct != null && Number.isFinite(industryGrowthPct);
    const metricsBase = `/api/metrics?stock=${enc}&metrics=${ALL_SERIES_METRICS}&from=2014Q1&to=2026Q4&years=5`;
    const metricsUrl =
      useIndustryDcf ? `${metricsBase}&industry_growth_pct=${encodeURIComponent(String(industryGrowthPct))}` : metricsBase;

    const [stockJson, allMetricsJson, balanceJson, dailyJson, mainBizJson, priceJson, klineJson, klineDailyJson] = await Promise.all([
      fetchJson(`/api/csv/stockList?ts_code=${enc}`),
      fetchJson(metricsUrl),
      fetchJson(`/api/metrics?stock=${enc}&metrics=${BALANCE_METRICS}&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/parq/daily_basic?ts_code=${enc}&page=1&size=1000000&sortField=trade_date&sortDir=asc&start_date=20140101`),
      fetchJson(`/api/parq/finaMainbzVip?ts_code=${enc}&page=1&size=1000000&sortField=end_date&sortDir=asc&start_date=20140101`),
      fetchJson(`/api/industry-link/price-snapshots?ts_codes=${enc}`),
      fetchJson(`/api/parq/qfqDir?ts_code=${enc}&page=1&size=60&sortField=trade_date&sortDir=desc`),
      // 完整 daily_basic 比 ss 快照更新，用于 K 线 tip 换手率（ss 可能停在较早日期）
      fetchJson(`/api/parq/daily_basic?ts_code=${enc}&page=1&size=90&sortField=trade_date&sortDir=desc&variant=full`),
    ]);

    const stockRow = Array.isArray(stockJson?.data) ? stockJson.data[0] : null;
    const stockInfo: StockInfo | null = stockRow
      ? {
          name: String(stockRow?.name ?? '').trim() || '—',
          area: String(stockRow?.area ?? '').trim() || '—',
          industry: String(stockRow?.industry ?? '').trim() || '—',
        }
      : null;

    const pts = (Array.isArray(allMetricsJson?.points) ? allMetricsJson.points : [])
      .slice()
      .sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const dailyRows = (Array.isArray(dailyJson?.data) ? dailyJson.data : [])
      .slice()
      .sort((a: any, b: any) => parseDateNum(a?.trade_date) - parseDateNum(b?.trade_date));
    const latestDaily = dailyRows.at(-1);
    const priceRow = Array.isArray(priceJson?.rows) ? priceJson.rows[0] : null;
    const marketSnapshot: MarketSnapshot = {
      trade_date: priceRow?.trade_date ? String(priceRow.trade_date) : null,
      close: parseNum(priceRow?.close),
      total_mv_yi: (() => {
        const n = parseNum(latestDaily?.total_mv);
        return n == null ? null : n / 1e4;
      })(),
      pe: parseNum(latestDaily?.pe_ttm) ?? parseNum(latestDaily?.pe),
      pb: parseNum(latestDaily?.pb),
      returns: {
        d1: parseNum(priceRow?.returns?.d1),
        d5: parseNum(priceRow?.returns?.d5),
        d20: parseNum(priceRow?.returns?.d20),
        d60: parseNum(priceRow?.returns?.d60),
      },
    };
    const klineBars = mergeKlineTurnoverFromDaily(
      parseKlineBars(Array.isArray(klineJson?.data) ? klineJson.data : []),
      Array.isArray(klineDailyJson?.data) ? klineDailyJson.data : [],
    );
    const mainBizRows = (Array.isArray(mainBizJson?.data) ? mainBizJson.data : [])
      .slice()
      .sort((a: any, b: any) => parseDateNum(a?.end_date) - parseDateNum(b?.end_date));

    const toYi = (r: any, k: string) => { const n = parseNum(r?.[k]); return n == null ? null : n / 1e8; };
    const toYiMv = (r: any) => { const n = parseNum(r?.total_mv); return n == null ? null : n / 1e4; };
    const toPct = (r: any, k: string) => { const n = parseNum(r?.[k]); return n == null ? null : n * 100; };
    const toVal = (r: any, k: string) => parseNum(r?.[k]);
    const labels = pts.map((r: any) => formatDateYYMM(r?.period));
    const sampled = sampleWithLabels(pts.map(() => 1), labels);
    const sampledIdx = sampled.labels.map((lbl: string) => pts.findIndex((r: any) => formatDateYYMM(r?.period) === lbl)).filter((i: number) => i >= 0);
    const sp = sampledIdx.map((i: number) => pts[i]);
    const spLabels = sampledIdx.map((i: number) => labels[i]);

    // rev_mv (all points, no sampling for this chart)
    {
      type RevMvPt = { x: string; rev: number; profit: number; mv: number };
      const allPts: RevMvPt[] = pts.map((r: any) => {
        const q = formatDateYYMM(r?.period);
        if (!q) return null;
        const rev = parseNum(r?.total_revenue_ttm);
        const profit = parseNum(r?.n_income_attr_p_ttm);
        const mv = parseNum(r?.total_mv);
        return { x: q, rev: rev == null ? NaN : rev / 1e8, profit: profit == null ? NaN : profit / 1e8, mv: mv == null ? NaN : mv / 1e4 };
      }).filter((p: RevMvPt | null): p is RevMvPt => p != null);

      charts.rev_mv = {
        x: allPts.map((p) => p.x),
        series: [allPts.map((p) => p.rev), allPts.map((p) => p.profit), allPts.map((p) => p.mv)],
        labels: ['TTM营收(亿)', 'TTM归母净利润(亿)', '总市值(亿)'],
        latest: [
          fmt(allPts.filter((p) => Number.isFinite(p.rev)).at(-1)?.rev ?? null, '亿'),
          fmt(allPts.filter((p) => Number.isFinite(p.profit)).at(-1)?.profit ?? null, '亿'),
          fmt(allPts.filter((p) => Number.isFinite(p.mv)).at(-1)?.mv ?? null, '亿'),
        ],
      };
    }

    // rev_cashflow（含 fcff_ttm，与 definitions 企业自由现金流 TTM 一致）
    charts.rev_cashflow = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'c_inf_fr_operate_a_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'n_income_attr_p_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'n_cashflow_act_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'fcff_ttm') ?? NaN),
      ],
      labels: ['营收TTM(亿)', '经营现金流TTM(亿)', '净利润TTM(亿)', '经营现金流净额TTM(亿)', '自由现金流TTM(亿)'],
      latest: [
        fmt(toYi(pts.at(-1), 'total_revenue_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'c_inf_fr_operate_a_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'n_income_attr_p_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'n_cashflow_act_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'fcff_ttm'), '亿'),
      ],
    };

    // cost_margin
    charts.cost_margin = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'oper_cost_ttm') ?? NaN),
        sp.map((r: any) => toPct(r, 'grossMargin_ttm') ?? NaN),
      ],
      labels: ['营收TTM(亿)', '成本TTM(亿)', '毛利率TTM(%)'],
      latest: [
        fmt(toYi(pts.at(-1), 'total_revenue_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'oper_cost_ttm'), '亿'),
        fmt(toPct(pts.at(-1), 'grossMargin_ttm'), '%'),
      ],
    };

    // fee_revenue
    charts.fee_revenue = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'sell_exp_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'admin_exp_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'rd_exp_ttm') ?? NaN),
      ],
      labels: ['营收TTM(亿)', '销售费TTM(亿)', '管理费TTM(亿)', '研发费TTM(亿)'],
      latest: [
        fmt(toYi(pts.at(-1), 'total_revenue_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'sell_exp_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'admin_exp_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'rd_exp_ttm'), '亿'),
      ],
    };

    // dividend_yield
    charts.dividend_yield = {
      x: spLabels,
      series: [sp.map((r: any) => toPct(r, 'dividend_ttm_rate') ?? NaN)],
      labels: ['股息率TTM(%)'],
      latest: [fmt(toPct(pts.at(-1), 'dividend_ttm_rate'), '%')],
    };

    // growth_summary (single anchor period + fallback year window: 5y -> 1y)
    {
      const periodMap = new Map<string, any>();
      for (const r of pts) {
        const p = String(r?.period ?? '').trim();
        if (p) periodMap.set(p, r);
      }
      const growthKeys = ['total_mv', 'total_revenue_ttm', 'n_income_attr_p_ttm', 'total_hldr_eqy_exc_min_int'] as const;
      const anchorPoint = pts
        .slice()
        .reverse()
        .find((r: any) => growthKeys.every((k) => parseNum(r?.[k]) != null))
        ?? pts
          .slice()
          .reverse()
          .find((r: any) => growthKeys.some((k) => parseNum(r?.[k]) != null))
        ?? pts.at(-1);
      const anchorPeriod = String(anchorPoint?.period ?? '').trim();

      const calcFallbackCagr = (currentKey: string): { value: number | null; years: number | null } => {
        const cur = parseNum(anchorPoint?.[currentKey]);
        if (cur == null || cur <= 0 || !anchorPeriod) return { value: null, years: null };
        for (let years = 5; years >= 1; years--) {
          const pastPeriod = shiftQuarterPeriod(anchorPeriod, years);
          if (!pastPeriod) continue;
          const pastRow = periodMap.get(pastPeriod);
          const past = parseNum(pastRow?.[currentKey]);
          if (past == null || past <= 0) continue;
          const ratio = cur / past;
          if (!(ratio > 0)) continue;
          return { value: (Math.pow(ratio, 1 / years) - 1) * 100, years };
        }
        return { value: null, years: null };
      };

      const mv = calcFallbackCagr('total_mv');
      const rev = calcFallbackCagr('total_revenue_ttm');
      // 与同页 profit_growth 序列及 DCF估值(五年利润增速) 同源：metrics.profit_growth（五年前同季后顺延后按实际相距年数算的 CAGR）。
      // 仅当该行无 profit_growth 时才用锚点行的 TTM 点值按「5年→4年→…」回退推算，避免出现柱图≈四年点值 CAGR 与 DCF≈引擎口径不一致。
      const profManual = calcFallbackCagr('n_income_attr_p_ttm');
      const profFromMetric = parseNum(anchorPoint?.profit_growth);
      const prof =
        profFromMetric != null && Number.isFinite(profFromMetric)
          ? { value: profFromMetric, years: 5 }
          : profManual;
      const eqy = calcFallbackCagr('total_hldr_eqy_exc_min_int');
      const growthValuesRaw: Array<number | null> = [mv.value, rev.value, prof.value, eqy.value];
      const growthValues = growthValuesRaw.map((v) => (v == null ? NaN : v));
      const yearNote = `市值${mv.years ?? '-'}年 / 营收${rev.years ?? '-'}年 / 利润${prof.years ?? '-'}年 / 净资产${eqy.years ?? '-'}年`;
      charts.growth_summary = {
        x: ['市值', '营收', '净利润', '净资产'],
        series: [growthValues],
        labels: [`市值/营收/净利润/净资产 CAGR(%)${anchorPeriod ? ` @ ${anchorPeriod}` : ''}`],
        latest: [growthValuesRaw.map((v) => fmt(v, '%')).join(' | ')],
        note: anchorPeriod ? `${anchorPeriod} · ${yearNote}` : undefined,
      };
    }

    // growth_trend
    charts.growth_trend = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'n_income_attr_p_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'total_hldr_eqy_exc_min_int') ?? NaN),
        sp.map((r: any) => toYiMv(r) ?? NaN),
        sp.map((r: any) => toVal(r, 'profit_growth') ?? 0),
        sp.map((r: any) => toVal(r, 'revenue_growth') ?? 0),
        sp.map((r: any) => toVal(r, 'net_assets_growth') ?? 0),
        sp.map((r: any) => toVal(r, 'mv_growth') ?? 0),
      ],
      labels: [
        '归母净利润TTM(亿)', '营收TTM(亿)', '归母所有者权益(亿)', '总市值(亿)',
        '利润5年CAGR', '营收5年CAGR', '净资产5年CAGR', '市值5年CAGR',
      ],
      latest: [
        fmt(toVal(pts.at(-1), 'profit_growth'), '%'), fmt(toVal(pts.at(-1), 'revenue_growth'), '%'),
        fmt(toVal(pts.at(-1), 'net_assets_growth'), '%'), fmt(toVal(pts.at(-1), 'mv_growth'), '%'),
      ],
    };

    // balance_structure (single-period snapshot): choose latest period with non-null balance values
    const balanceKeys = [
      'total_cash', 'prepayment', 'accounts_receiv', 'inventories', 'oth_cur_assets',
      'lt_eqt_invest', 'fix_assets', 'intan_assets', 'oth_nca',
      'st_borr', 'accounts_pay', 'contract_liab', 'payroll_taxes_payable', 'oth_cur_liab', 'lt_borr', 'oth_ncl',
    ];
    const balancePoints = (Array.isArray(balanceJson?.points) ? balanceJson.points : [])
      .slice()
      .sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const latestBalancePoint = balancePoints
      .slice()
      .reverse()
      .find((p: any) => balanceKeys.some((k) => parseNum(p?.[k]) != null));
    const balanceResults = balanceJson?.results ?? {};
    const balanceSource = latestBalancePoint ?? Object.fromEntries(balanceKeys.map((k) => [k, balanceResults?.[k]?.value ?? null]));
    const balanceVals = balanceKeys.map((k) => (parseNum((balanceSource as any)?.[k]) ?? 0) / 1e8);
    const balanceHistory = balancePoints
      .filter((p: any) => balanceKeys.some((k) => parseNum(p?.[k]) != null))
      .slice(-12)
      .map((p: any) => ({
        period: String(p?.period ?? ''),
        values: balanceKeys.map((k) => (parseNum(p?.[k]) ?? 0) / 1e8),
      }));
    charts.balance_structure = {
      x: ['现', '预', '应', '存', '他流', '长投', '固资', '无形', '非流', '短借', '应付', '合同', '薪税', '他流负', '长借', '长负'],
      series: [balanceVals],
      labels: ['资产负债结构(亿)'],
      latest: [fmt(balanceVals.reduce((acc, v) => acc + v, 0), '亿(合计)')],
      note: latestBalancePoint?.period ? `@ ${String(latestBalancePoint.period)}` : undefined,
      history: balanceHistory,
    };

    // biz_comp
    {
      const latestDateNum = Math.max(
        ...mainBizRows.map((r: any) => parseDateNum(r?.end_date)).filter((n: number) => Number.isFinite(n)), -Infinity,
      );
      const latestDateRows = mainBizRows.filter((r: any) => parseDateNum(r?.end_date) === latestDateNum);
      const topItems: string[] = latestDateRows
        .map((r: any) => ({ item: String(r?.bz_item ?? ''), sales: parseNum(r?.bz_sales) ?? 0 }))
        .sort((a: any, b: any) => b.sales - a.sales).slice(0, 4)
        .map((x: any) => x.item).filter(Boolean);

      const byDate = new Map<string, Record<string, number>>();
      for (const row of mainBizRows) {
        const d = String(row?.end_date ?? '').trim();
        const item = String(row?.bz_item ?? '').trim();
        const sales = parseNum(row?.bz_sales);
        if (!d || !item || sales == null) continue;
        if (!byDate.has(d)) byDate.set(d, {});
        byDate.get(d)![item] = (byDate.get(d)![item] ?? 0) + sales / 1e8;
      }
      const dates = [...byDate.keys()].sort((a, b) => parseDateNum(a) - parseDateNum(b));
      const bizSeries = topItems.map((item: string) => pickSeries(dates.map((d) => byDate.get(d)?.[item] ?? 0)));
      charts.biz_comp = {
        x: sampleWithLabels(dates.map((d) => parseDateNum(d)), dates.map((d) => formatDateYYMM(d))).labels,
        series: bizSeries, labels: topItems.length ? topItems : ['主营业务'],
        latest: topItems.map((item: string) => fmt(dates.length ? byDate.get(dates.at(-1)!)?.[item] ?? null : null, '亿')),
        note: topItems.length ? undefined : '暂无主营业务构成',
      };
    }

    // valuation charts (ps/pe/pb) — from daily_basic
    const buildValuationChart = (rawValues: Array<number | null>, label: string): MetricChart => {
      const dailyLabels = dailyRows.map((r: any) => formatDateYYMM(r?.trade_date));
      const paired: { val: number; lbl: string }[] = [];
      for (let i = 0; i < rawValues.length; i++) {
        const v = rawValues[i];
        if (typeof v === 'number' && Number.isFinite(v)) paired.push({ val: v, lbl: dailyLabels[i] ?? String(i + 1) });
      }
      if (!paired.length) return { ...emptyChart('暂无数据'), labels: [label] };
      const maxP = 24;
      let s = paired;
      if (paired.length > maxP) { const step = (paired.length - 1) / (maxP - 1); s = Array.from({ length: maxP }, (_, i) => paired[Math.round(i * step)]); }
      const vals = s.map((p) => p.val);
      const firstStats = calcMeanStd(vals);
      if (!firstStats) return { x: s.map((p) => p.lbl), series: [vals], labels: [label], latest: [fmt(vals.at(-1) ?? null)] };
      const upperCap = firstStats.mean + firstStats.std + 1;
      const lowerCap = firstStats.mean - firstStats.std - 1;
      const capped = vals.map((v) => Math.max(lowerCap, Math.min(upperCap, v)));
      const stats = calcMeanStd(capped) ?? firstStats;
      return { x: s.map((p) => p.lbl), series: [capped], labels: [label], latest: [fmt(capped.at(-1) ?? null)], _stats: { mean: stats.mean, high: stats.mean + stats.std, low: stats.mean - stats.std } };
    };
    charts.ps_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.ps_ttm) ?? parseNum(r?.ps)), 'PS/PS_TTM');
    charts.pe_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.pe_ttm) ?? parseNum(r?.pe)), 'PE/PE_TTM');
    charts.pb_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.pb)), 'PB');

    // 近 40 个交易日：daily_basic 成交量（手→万手）与换手率（%）
    {
      const n = 40;
      const tail = dailyRows.slice(-n);
      const x40 = tail.map((r: any) => formatDateYYMM(r?.trade_date));
      const volWan = tail.map((r: any) => {
        const v = parseNum(r?.vol);
        return v == null ? NaN : v / 10000;
      });
      const turnoverPct = tail.map((r: any) => parseNum(r?.turnover_rate) ?? NaN);
      const lastVol = [...volWan].reverse().find((v) => Number.isFinite(v));
      const lastTo = [...turnoverPct].reverse().find((v) => Number.isFinite(v));
      charts.vol_turnover_40d = {
        x: x40,
        series: [volWan, turnoverPct],
        labels: ['成交量(万手)', '换手率(%)'],
        latest: [
          lastVol == null ? '—' : fmt(lastVol, '万手'),
          lastTo == null ? '—' : `${lastTo.toFixed(2)}%`,
        ],
        note: tail.length ? `最近${tail.length}个交易日` : undefined,
      };
    }

    // dupont
    {
      const dpPts = sp.map((r: any) => ({
        x: formatDateYYMM(r?.period),
        turnover: toVal(r, 'totalAsset_turnover_ttm') ?? NaN,
        multiplier: toVal(r, 'equity_multiplier_ttm') ?? NaN,
        netMargin: (toPct(r, 'netMargin_ttm')) ?? NaN,
        roe: (toPct(r, 'roe_dupont')) ?? NaN,
      })).filter((p: any) => !!p.x);
      charts.dupont = {
        x: dpPts.map((p: any) => p.x),
        series: [dpPts.map((p: any) => p.turnover), dpPts.map((p: any) => p.multiplier), dpPts.map((p: any) => p.netMargin), dpPts.map((p: any) => p.roe)],
        labels: ['总资产周转率(TTM)', '权益乘数(TTM)', '销售净利率(TTM)%', '杜邦ROE%'],
        latest: [
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.turnover)).at(-1)?.turnover; return v == null ? '—' : v.toFixed(3); })(),
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.multiplier)).at(-1)?.multiplier; return v == null ? '—' : v.toFixed(3); })(),
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.netMargin)).at(-1)?.netMargin; return v == null ? '—' : `${v.toFixed(2)}%`; })(),
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.roe)).at(-1)?.roe; return v == null ? '—' : `${v.toFixed(2)}%`; })(),
        ],
      };
    }

    // DCF(TTM) 列：红线=dcf_equity_value_ttm（阶段一默认15%）；绿线=总市值；传入 industry_growth 时橙线=dcf_equity_value_ttm_growth_ind
    {
      type DcfTooltipItem = NonNullable<MetricChart['dcfTooltipRows']>[number];
      type DcfRow = { x: string; dcfDefaultYi: number; mvYi: number; dcfIndustryYi: number };
      const dcfRows: DcfRow[] = [];
      const dcfTooltipRows: DcfTooltipItem[] = [];
      for (const r of pts) {
        const x = formatDateYYMM(r?.period);
        if (!x) continue;
        const rawDefault = parseNum(r?.dcf_equity_value_ttm);
        const dcfDefaultYi = rawDefault == null ? NaN : rawDefault / 1e8;
        const rawMv = parseNum(r?.total_mv);
        const mvYi = rawMv == null ? NaN : rawMv / 1e4;
        const rawInd =
          useIndustryDcf ? parseNum(r?.dcf_equity_value_ttm_growth_ind) : null;
        const dcfIndustryYi = rawInd == null ? NaN : rawInd / 1e8;
        dcfRows.push({ x, dcfDefaultYi, mvYi, dcfIndustryYi });
        dcfTooltipRows.push({
          n_cashflow_act_ttm: parseNum(r?.n_cashflow_act_ttm),
          c_pay_acq_const_fiolta_ttm: parseNum(r?.c_pay_acq_const_fiolta_ttm),
          fcff_ttm: parseNum(r?.fcff_ttm),
          net_debt: parseNum(r?.net_debt),
          st_borr: parseNum(r?.st_borr),
          lt_borr: parseNum(r?.lt_borr),
          st_bonds_payable: parseNum(r?.st_bonds_payable),
          bond_payable: parseNum(r?.bond_payable),
          money_cap: parseNum(r?.money_cap),
          trad_asset: parseNum(r?.trad_asset),
          industry_growth_csv_pct: useIndustryDcf ? industryGrowthPct ?? null : undefined,
        });
      }
      const lastDefault = [...dcfRows].reverse().find((p) => Number.isFinite(p.dcfDefaultYi))?.dcfDefaultYi;
      const lastMv = [...dcfRows].reverse().find((p) => Number.isFinite(p.mvYi))?.mvYi;
      const lastIndustry = [...dcfRows].reverse().find((p) => Number.isFinite(p.dcfIndustryYi))?.dcfIndustryYi;

      const series: number[][] = [
        dcfRows.map((p) => p.dcfDefaultYi),
        dcfRows.map((p) => p.mvYi),
      ];
      const labels = ['DCF股权价值(阶段一15%默认)(亿)', '总市值(亿)'];
      const latest = [fmt(lastDefault ?? null, '亿'), fmt(lastMv ?? null, '亿')];
      if (useIndustryDcf) {
        series.push(dcfRows.map((p) => p.dcfIndustryYi));
        labels.push(`DCF股权价值(行业增速${industryGrowthPct}%)(亿)`);
        latest.push(fmt(lastIndustry ?? null, '亿'));
      }

      charts.dcf_valuation = {
        x: dcfRows.map((p) => p.x),
        series,
        labels,
        latest,
        note: useIndustryDcf
          ? `红：阶段一默认15%（dcf_equity_value_ttm）；橙：分类 industry_growth=${industryGrowthPct}%（dcf_equity_value_ttm_growth_ind）；绿：总市值；其余假设一致。`
          : '红：DCF股权价值（阶段一默认15%）；绿：总市值。FCF=经营现金流TTM−购建长期资产支出TTM；两阶段增长+终值，再减净负债。',
        dcfTooltipRows,
      };
    }

    // DCF 股权价值（阶段一增速 = 各期五年利润 CAGR，与 metrics.dcf_equity_value_ttm_growth_r 一致）
    {
      type DcfRPt = { x: string; dcfYi: number; mvYi: number };
      type DcfTooltipItem = NonNullable<MetricChart['dcfTooltipRows']>[number];
      const dcfRPts: DcfRPt[] = [];
      const dcfRTooltipRows: DcfTooltipItem[] = [];
      for (const r of pts) {
        const x = formatDateYYMM(r?.period);
        if (!x) continue;
        const rawDcf = parseNum(r?.dcf_equity_value_ttm_growth_r);
        const dcfYi = rawDcf == null ? NaN : rawDcf / 1e8;
        const rawMv = parseNum(r?.total_mv);
        const mvYi = rawMv == null ? NaN : rawMv / 1e4;
        dcfRPts.push({ x, dcfYi, mvYi });
        dcfRTooltipRows.push({
          n_cashflow_act_ttm: parseNum(r?.n_cashflow_act_ttm),
          c_pay_acq_const_fiolta_ttm: parseNum(r?.c_pay_acq_const_fiolta_ttm),
          fcff_ttm: parseNum(r?.fcff_ttm),
          net_debt: parseNum(r?.net_debt),
          st_borr: parseNum(r?.st_borr),
          lt_borr: parseNum(r?.lt_borr),
          st_bonds_payable: parseNum(r?.st_bonds_payable),
          bond_payable: parseNum(r?.bond_payable),
          money_cap: parseNum(r?.money_cap),
          trad_asset: parseNum(r?.trad_asset),
          profit_growth_5y_pct: parseNum(r?.profit_growth),
        });
      }
      const lastDcfR = [...dcfRPts].reverse().find((p) => Number.isFinite(p.dcfYi))?.dcfYi;
      const lastMvR = [...dcfRPts].reverse().find((p) => Number.isFinite(p.mvYi))?.mvYi;
      charts.dcf_r = {
        x: dcfRPts.map((p) => p.x),
        series: [dcfRPts.map((p) => p.dcfYi), dcfRPts.map((p) => p.mvYi)],
        labels: ['DCF股权价值(五年利润增速阶段一)(亿)', '总市值(亿)'],
        latest: [fmt(lastDcfR ?? null, '亿'), fmt(lastMvR ?? null, '亿')],
        note:
          '与 DCF(TTM) 相同的 FCF、WACC、终值增长假设；阶段一 g1 取 profit_growth：以五年前同季为锚，若该季净利润 TTM 不可算则从锚点后顺延至多 12 个季度再找基准，复合增长率按两点实际相距年份计算；仍为缺失时沿用 15%。',
        dcfTooltipRows: dcfRTooltipRows,
      };
    }

    // DCF：阶段一 g1 = profit_growth（与上一列一致），现金流基数改为归母净利润 TTM（与 dcf_equity_value_ttm_ni_growth_r 一致）
    {
      type DcfRNiPt = { x: string; dcfYi: number; mvYi: number };
      type DcfTooltipItem = NonNullable<MetricChart['dcfTooltipRows']>[number];
      const dcfRNiPts: DcfRNiPt[] = [];
      const dcfRNiTooltipRows: DcfTooltipItem[] = [];
      for (const r of pts) {
        const x = formatDateYYMM(r?.period);
        if (!x) continue;
        const rawDcf = parseNum(r?.dcf_equity_value_ttm_ni_growth_r);
        const dcfYi = rawDcf == null ? NaN : rawDcf / 1e8;
        const rawMv = parseNum(r?.total_mv);
        const mvYi = rawMv == null ? NaN : rawMv / 1e4;
        dcfRNiPts.push({ x, dcfYi, mvYi });
        dcfRNiTooltipRows.push({
          n_cashflow_act_ttm: parseNum(r?.n_cashflow_act_ttm),
          c_pay_acq_const_fiolta_ttm: parseNum(r?.c_pay_acq_const_fiolta_ttm),
          fcff_ttm: parseNum(r?.fcff_ttm),
          net_debt: parseNum(r?.net_debt),
          st_borr: parseNum(r?.st_borr),
          lt_borr: parseNum(r?.lt_borr),
          st_bonds_payable: parseNum(r?.st_bonds_payable),
          bond_payable: parseNum(r?.bond_payable),
          money_cap: parseNum(r?.money_cap),
          trad_asset: parseNum(r?.trad_asset),
          n_income_attr_p_ttm: parseNum(r?.n_income_attr_p_ttm),
          profit_growth_5y_pct: parseNum(r?.profit_growth),
        });
      }
      const lastDcfNi = [...dcfRNiPts].reverse().find((p) => Number.isFinite(p.dcfYi))?.dcfYi;
      const lastMvNi = [...dcfRNiPts].reverse().find((p) => Number.isFinite(p.mvYi))?.mvYi;
      charts.dcf_r_ni = {
        x: dcfRNiPts.map((p) => p.x),
        series: [dcfRNiPts.map((p) => p.dcfYi), dcfRNiPts.map((p) => p.mvYi)],
        labels: ['DCF股权价值(净利TTM+五年利润增速)(亿)', '总市值(亿)'],
        latest: [fmt(lastDcfNi ?? null, '亿'), fmt(lastMvNi ?? null, '亿')],
        note:
          '与「DCF估值(五年利润增速)」相同的 profit_growth 阶段一、WACC、终值假设与净负债调整；差异仅是将第 0 年现金流由 FCFF 换为「归母净利润 TTM」（元）；净利≤0 的时点不展示该股该期 DCF 值。',
        dcfTooltipRows: dcfRNiTooltipRows,
      };
    }

    // DCF（分红 TTM 为第 0 年现金流基数，与 definitions.dcf_equity_value_ttm_dividend 一致）
    {
      type DcfDivPt = { x: string; dcfYi: number; mvYi: number };
      type DcfTooltipItem = NonNullable<MetricChart['dcfTooltipRows']>[number];
      const divPts: DcfDivPt[] = [];
      const divTooltipRows: DcfTooltipItem[] = [];
      for (const r of pts) {
        const x = formatDateYYMM(r?.period);
        if (!x) continue;
        const rawDcf = parseNum(r?.dcf_equity_value_ttm_dividend);
        const dcfYi = rawDcf == null ? NaN : rawDcf / 1e8;
        const rawMv = parseNum(r?.total_mv);
        const mvYi = rawMv == null ? NaN : rawMv / 1e4;
        divPts.push({ x, dcfYi, mvYi });
        divTooltipRows.push({
          n_cashflow_act_ttm: parseNum(r?.n_cashflow_act_ttm),
          c_pay_acq_const_fiolta_ttm: parseNum(r?.c_pay_acq_const_fiolta_ttm),
          fcff_ttm: parseNum(r?.fcff_ttm),
          net_debt: parseNum(r?.net_debt),
          st_borr: parseNum(r?.st_borr),
          lt_borr: parseNum(r?.lt_borr),
          st_bonds_payable: parseNum(r?.st_bonds_payable),
          bond_payable: parseNum(r?.bond_payable),
          money_cap: parseNum(r?.money_cap),
          trad_asset: parseNum(r?.trad_asset),
          dividend_ttm_yuan: (() => {
            const wan = parseNum(r?.dividend_ttm);
            return wan == null ? null : wan * 1e4;
          })(),
        });
      }
      const lastDcfDiv = [...divPts].reverse().find((p) => Number.isFinite(p.dcfYi))?.dcfYi;
      const lastMvDiv = [...divPts].reverse().find((p) => Number.isFinite(p.mvYi))?.mvYi;
      charts.dcf_div = {
        x: divPts.map((p) => p.x),
        series: [divPts.map((p) => p.dcfYi), divPts.map((p) => p.mvYi)],
        labels: ['DCF股权价值(分红TTM基数,阶段一15%默认)(亿)', '总市值(亿)'],
        latest: [fmt(lastDcfDiv ?? null, '亿'), fmt(lastMvDiv ?? null, '亿')],
        note:
          '现金流基数取分红TTM（滚动四季股息现金合计）；WACC、g1 默认、g2、预测年数及净负债调整与「DCF估值(TTM)」相同，仅替换 FCFF。',
        dcfTooltipRows: divTooltipRows,
      };
    }

    // forecast_signal: 从利润表、资产负债表、现金流三类信号合成预测值
    {
      const latestPoint = pts.at(-1);
      const latestPeriod = String(latestPoint?.period ?? '').trim();
      const prevYearPeriod = latestPeriod ? shiftQuarterPeriod(latestPeriod, 1) : null;
      const prevYearPoint = prevYearPeriod ? pts.find((p: any) => String(p?.period ?? '').trim() === prevYearPeriod) : null;

      const revYi = toYi(latestPoint, 'total_revenue_ttm');
      const profitYi = toYi(latestPoint, 'n_income_attr_p_ttm');
      const grossMarginPct = toPct(latestPoint, 'grossMargin_ttm');
      const netMarginPct = toPct(latestPoint, 'netMargin_ttm');
      const opInYi = toYi(latestPoint, 'c_inf_fr_operate_a_ttm');
      const opNetYi = toYi(latestPoint, 'n_cashflow_act_ttm');

      const sellYi = toYi(latestPoint, 'sell_exp_ttm');
      const adminYi = toYi(latestPoint, 'admin_exp_ttm');
      const rdYi = toYi(latestPoint, 'rd_exp_ttm');
      const feeRatePct = revYi != null && revYi !== 0
        ? (((sellYi ?? 0) + (adminYi ?? 0) + (rdYi ?? 0)) / revYi) * 100
        : null;

      const revenueGrowthPct = toVal(latestPoint, 'revenue_growth');
      const profitGrowthPct5y = toVal(latestPoint, 'profit_growth');
      const prevProfitYi = toYi(prevYearPoint, 'n_income_attr_p_ttm');
      const yoyProfitPct = profitYi != null && prevProfitYi != null && prevProfitYi !== 0
        ? ((profitYi - prevProfitYi) / Math.abs(prevProfitYi)) * 100
        : null;

      const scoreFromRange = (value: number | null, min: number, max: number): number | null => {
        if (value == null || !Number.isFinite(value)) return null;
        if (max <= min) return null;
        const ratio = (value - min) / (max - min);
        return clamp(ratio * 100, 0, 100);
      };
      const scoreFromInverseRange = (value: number | null, min: number, max: number): number | null => {
        if (value == null || !Number.isFinite(value)) return null;
        return 100 - (scoreFromRange(value, min, max) ?? 50);
      };
      const avgScore = (arr: Array<number | null>, fallback = 50): number => {
        const vals = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (!vals.length) return fallback;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      };

      // 利润表信号
      const profitSignal = avgScore([
        scoreFromRange(revenueGrowthPct, -10, 30),
        scoreFromRange(grossMarginPct, 10, 50),
        scoreFromInverseRange(feeRatePct, 8, 35),
        scoreFromRange(netMarginPct, 3, 20),
      ]);

      // 资产负债表信号（使用可得的领先项）
      const contractLiabYi = (parseNum((balanceSource as any)?.contract_liab) ?? NaN) / 1e8;
      const receivYi = (parseNum((balanceSource as any)?.accounts_receiv) ?? NaN) / 1e8;
      const inventoryYi = (parseNum((balanceSource as any)?.inventories) ?? NaN) / 1e8;
      const payablesYi = (parseNum((balanceSource as any)?.accounts_pay) ?? NaN) / 1e8;
      const contractLiabRatioPct = revYi != null && revYi !== 0 && Number.isFinite(contractLiabYi) ? (contractLiabYi / revYi) * 100 : null;
      const receivRatioPct = revYi != null && revYi !== 0 && Number.isFinite(receivYi) ? (receivYi / revYi) * 100 : null;
      const inventoryRatioPct = revYi != null && revYi !== 0 && Number.isFinite(inventoryYi) ? (inventoryYi / revYi) * 100 : null;
      const payableCoveragePct = Number.isFinite(payablesYi) && Number.isFinite(inventoryYi) && inventoryYi > 0 ? (payablesYi / inventoryYi) * 100 : null;
      const balanceSignal = avgScore([
        scoreFromRange(contractLiabRatioPct, 2, 20),
        scoreFromInverseRange(receivRatioPct, 8, 45),
        scoreFromInverseRange(inventoryRatioPct, 8, 55),
        scoreFromRange(payableCoveragePct, 30, 100),
      ]);

      // 现金流信号（验证营收/利润含金量）
      const inflowCoveragePct = revYi != null && revYi !== 0 && opInYi != null ? (opInYi / revYi) * 100 : null;
      const cfoMarginPct = revYi != null && revYi !== 0 && opNetYi != null ? (opNetYi / revYi) * 100 : null;
      const profitCashRatioPct = profitYi != null && profitYi !== 0 && opNetYi != null ? (opNetYi / profitYi) * 100 : null;
      const cashflowSignal = avgScore([
        scoreFromRange(inflowCoveragePct, 70, 110),
        scoreFromRange(cfoMarginPct, 2, 18),
        scoreFromRange(profitCashRatioPct, 50, 150),
      ]);

      const overallScoreRaw = profitSignal * 0.5 + balanceSignal * 0.2 + cashflowSignal * 0.3;
      const overallScore = clamp(overallScoreRaw, 0, 100);

      const baseGrowthCandidates = [yoyProfitPct, revenueGrowthPct, profitGrowthPct5y].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v)
      );
      const baseGrowth = baseGrowthCandidates.length
        ? baseGrowthCandidates.reduce((a, b) => a + b, 0) / baseGrowthCandidates.length
        : 8;

      const scoreAdjustGrowth = (overallScore - 50) * 0.5;
      const predictedGrowthPct = clamp(baseGrowth * 0.55 + scoreAdjustGrowth, -35, 45);
      const predictedProfitYi = profitYi != null ? profitYi * (1 + predictedGrowthPct / 100) : null;

      charts.forecast_signal = {
        x: ['利润表', '资产负债', '现金流', '综合', '预测增速', '预测净利润'],
        series: [[
          profitSignal,
          balanceSignal,
          cashflowSignal,
          overallScore,
          predictedGrowthPct,
          predictedProfitYi ?? NaN,
        ]],
        labels: ['三表预测评分/结果'],
        latest: [
          `综合得分 ${fmt(overallScore, '')}`,
          `预测净利增速 ${fmt(predictedGrowthPct, '%')}`,
          `预测净利润 ${fmt(predictedProfitYi, '亿')}`,
        ],
        note: `${latestPeriod || '最近期'} · 利润+资产负债+现金流信号合成`,
      };
    }

    return { tsCode, loading: false, stockInfo, marketSnapshot, klineBars, charts };
  } catch (e) {
    return {
      tsCode,
      loading: false,
      stockInfo: null,
      marketSnapshot: null,
      klineBars: [],
      error: e instanceof Error ? e.message : '拉取失败',
      charts,
    };
  }
}
