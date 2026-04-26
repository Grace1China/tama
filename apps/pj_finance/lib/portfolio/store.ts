import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'temp', 'portfolio');
const HOLDINGS_FILE = path.join(DATA_DIR, 'holdings.json');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'suggestions.json');
const LOG_FILE = path.join(DATA_DIR, 'execution_log.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface Holding {
  ts_code: string;
  name: string;
  pool: 'growth' | 'cashflow';
  quantity: number;
  cost_price: number;
  latest_close?: number;
}

export interface PortfolioMeta {
  cash: number;
  target_growth_pct: number;
  target_cashflow_pct: number;
}

export interface PortfolioData {
  meta: PortfolioMeta;
  holdings: Holding[];
}

export interface Suggestion {
  id: string;
  type: 'rebalance' | 'swap';
  action: 'buy' | 'sell';
  ts_code: string;
  name: string;
  shares: number;
  reason: string;
  created_at: string;
}

export interface ExecutionLog {
  id: string;
  suggestion_id: string;
  action: 'approved' | 'rejected';
  ts_code: string;
  name: string;
  shares: number;
  type: string;
  reason: string;
  timestamp: string;
}

function readJson<T>(filepath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filepath)) return fallback;
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filepath: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

const DEFAULT_PORTFOLIO: PortfolioData = {
  meta: { cash: 100000, target_growth_pct: 50, target_cashflow_pct: 50 },
  holdings: [
    { ts_code: '600519.SH', name: '贵州茅台', pool: 'cashflow', quantity: 100, cost_price: 1700 },
    { ts_code: '000858.SZ', name: '五粮液', pool: 'cashflow', quantity: 300, cost_price: 155 },
    { ts_code: '603983.SH', name: '丸美股份', pool: 'growth', quantity: 500, cost_price: 35 },
    { ts_code: '300750.SZ', name: '宁德时代', pool: 'growth', quantity: 50, cost_price: 210 },
    { ts_code: '002415.SZ', name: '海康威视', pool: 'growth', quantity: 400, cost_price: 32 },
    { ts_code: '601318.SH', name: '中国平安', pool: 'cashflow', quantity: 200, cost_price: 48 },
    { ts_code: '000651.SZ', name: '格力电器', pool: 'cashflow', quantity: 300, cost_price: 38 },
    { ts_code: '002594.SZ', name: '比亚迪', pool: 'growth', quantity: 80, cost_price: 250 },
  ],
};

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  {
    id: 'sug_001',
    type: 'rebalance',
    action: 'sell',
    ts_code: '600519.SH',
    name: '贵州茅台',
    shares: 10,
    reason: '当前现金流池超配 5.2%，减持市值最大持仓以回归目标比例',
    created_at: new Date().toISOString(),
  },
  {
    id: 'sug_002',
    type: 'rebalance',
    action: 'buy',
    ts_code: '300750.SZ',
    name: '宁德时代',
    shares: 20,
    reason: '成长池低配 5.2%，宁德时代综合评分最高，增持以补足成长仓位',
    created_at: new Date().toISOString(),
  },
  {
    id: 'sug_003',
    type: 'swap',
    action: 'sell',
    ts_code: '603983.SH',
    name: '丸美股份',
    shares: 200,
    reason: '成长池内部优胜劣汰：丸美股份近 2 季营收增速转负，综合评分降至池内最低，建议减持',
    created_at: new Date().toISOString(),
  },
  {
    id: 'sug_004',
    type: 'swap',
    action: 'buy',
    ts_code: '002594.SZ',
    name: '比亚迪',
    shares: 30,
    reason: '成长池内部优胜劣汰：比亚迪营收增速及 ROE 双升，综合评分池内最高，建议加仓',
    created_at: new Date().toISOString(),
  },
];

export function getPortfolio(): PortfolioData {
  return readJson(HOLDINGS_FILE, DEFAULT_PORTFOLIO);
}

export function savePortfolio(data: PortfolioData) {
  writeJson(HOLDINGS_FILE, data);
}

export function getSuggestions(): Suggestion[] {
  return readJson(SUGGESTIONS_FILE, DEFAULT_SUGGESTIONS);
}

export function saveSuggestions(data: Suggestion[]) {
  writeJson(SUGGESTIONS_FILE, data);
}

export function getExecutionLog(): ExecutionLog[] {
  return readJson(LOG_FILE, []);
}

export function appendExecutionLog(entry: ExecutionLog) {
  const log = getExecutionLog();
  log.push(entry);
  writeJson(LOG_FILE, log);
}
