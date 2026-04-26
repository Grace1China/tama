import type { FinancialData, MetricEngine, MetricValue } from '@/lib/metrics/engine';

type PeriodTable = Record<string, Record<string, MetricValue>>;

export type IndustryStockData = {
  stockCode: string;
  data: FinancialData;
};

export type IndustryMetricFilter = {
  metricName: string;
  min?: number;
  max?: number;
};

export type BuildIndustryMetricsArgs = {
  engine: MetricEngine;
  stocks: IndustryStockData[];
  metricNames: string[];
  period: string;
  params?: Record<string, unknown>;
  industryCode?: string;
  filter?: IndustryMetricFilter;
};

export type BuildIndustryMetricsResult = {
  industryStockCode: string;
  selectedStockCodes: string[];
  excludedStockCodes: string[];
  selectedCount: number;
  totalCount: number;
  aggregatedData: FinancialData;
  values: Record<string, MetricValue>;
};

function normalizeNumber(v: MetricValue): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function aggregateTableBySum(tables: Array<PeriodTable | undefined>): PeriodTable {
  type AggField = { sum: number; hasValue: boolean };
  const agg = new Map<string, Map<string, AggField>>();

  for (const table of tables) {
    if (!table) continue;
    for (const [period, fields] of Object.entries(table)) {
      if (!agg.has(period)) agg.set(period, new Map<string, AggField>());
      const periodAgg = agg.get(period)!;
      for (const [field, raw] of Object.entries(fields ?? {})) {
        if (!periodAgg.has(field)) periodAgg.set(field, { sum: 0, hasValue: false });
        const slot = periodAgg.get(field)!;
        const n = normalizeNumber(raw);
        if (n == null) continue;
        slot.sum += n;
        slot.hasValue = true;
      }
    }
  }

  const out: PeriodTable = {};
  for (const [period, fields] of agg.entries()) {
    out[period] = {};
    for (const [field, state] of fields.entries()) {
      out[period][field] = state.hasValue ? state.sum : null;
    }
  }
  return out;
}

export function aggregateFinancialDataBySum(stocks: FinancialData[]): FinancialData {
  return {
    income: aggregateTableBySum(stocks.map((s) => s.income)),
    balance: aggregateTableBySum(stocks.map((s) => s.balance)),
    cashflow: aggregateTableBySum(stocks.map((s) => s.cashflow)),
    dividend: aggregateTableBySum(stocks.map((s) => s.dividend)),
    market: aggregateTableBySum(stocks.map((s) => s.market)),
  };
}

function passMetricFilter(
  engine: MetricEngine,
  stock: IndustryStockData,
  period: string,
  params: Record<string, unknown> | undefined,
  filter: IndustryMetricFilter
): boolean {
  const value = engine.calculate(filter.metricName, {
    stockCode: stock.stockCode,
    period,
    data: stock.data,
    params,
  });
  const n = normalizeNumber(value);
  if (n == null) return false;
  if (filter.min != null && !(n > filter.min)) return false;
  if (filter.max != null && !(n < filter.max)) return false;
  return true;
}

export function buildIndustryMetrics(args: BuildIndustryMetricsArgs): BuildIndustryMetricsResult {
  const { engine, stocks, metricNames, period, params, industryCode, filter } = args;
  const selected = filter
    ? stocks.filter((s) => passMetricFilter(engine, s, period, params, filter))
    : stocks;
  const selectedStockCodes = selected.map((s) => s.stockCode);
  const selectedSet = new Set(selectedStockCodes);
  const excludedStockCodes = stocks.map((s) => s.stockCode).filter((code) => !selectedSet.has(code));
  const aggregatedData = aggregateFinancialDataBySum(selected.map((s) => s.data));
  const industryStockCode = `IND:${String(industryCode ?? 'AGG').trim().toUpperCase() || 'AGG'}`;
  const values = engine.calculateMany(metricNames, {
    stockCode: industryStockCode,
    period,
    data: aggregatedData,
    params,
  });

  return {
    industryStockCode,
    selectedStockCodes,
    excludedStockCodes,
    selectedCount: selectedStockCodes.length,
    totalCount: stocks.length,
    aggregatedData,
    values,
  };
}
