export type MetricValue = number | null;

export interface FinancialData {
  income: Record<string, Record<string, MetricValue>>;
  balance: Record<string, Record<string, MetricValue>>;
  cashflow: Record<string, Record<string, MetricValue>>;
  /** 额外：非财报但按季度归档的数据（如市值） */
  market?: Record<string, Record<string, MetricValue>>;
}

export interface MetricContext {
  stockCode: string;
  period: string;
  data: FinancialData;
  engine: MetricEngine;
  /** 可选：由 API 传入的计算参数，如 years */
  params?: Record<string, unknown>;
}

export interface MetricDefinition {
  deps?: string[];
  /**
   * args 同时包含：
   * - MetricContext（stockCode/period/data/engine/params）
   * - deps 的计算结果（以 dep 名称为 key）
   *
   * 这里用 Record<string, unknown> 避免 index signature 与 engine/data 等字段冲突。
   */
  compute: (args: MetricContext & Record<string, unknown>) => MetricValue;
  meta?: {
    label: string;
    unit?: '%' | 'CNY' | 'times';
    precision?: number;
  };
}

export type MetricRegistry = Record<string, MetricDefinition>;

export interface MetricEngine {
  calculate: (metricName: string, ctx: Omit<MetricContext, 'engine'>) => MetricValue;
  calculateMany: (metricNames: string[], ctx: Omit<MetricContext, 'engine'>) => Record<string, MetricValue>;
}

function assertNoCycle(metrics: MetricRegistry): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected at metric: ${name}`);
    }
    const metric = metrics[name];
    if (!metric) {
      throw new Error(`Metric not found during dependency validation: ${name}`);
    }

    visiting.add(name);
    for (const dep of metric.deps ?? []) {
      dfs(dep);
    }
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of Object.keys(metrics)) {
    dfs(name);
  }
}

export function createMetricEngine(metrics: MetricRegistry): MetricEngine {
  assertNoCycle(metrics);

  const memo = new Map<string, MetricValue>();

  const calculateInternal = (metricName: string, ctx: Omit<MetricContext, 'engine'>): MetricValue => {
    const paramsKey = ctx.params ? JSON.stringify(ctx.params) : '';
    const key = `${ctx.stockCode}:${ctx.period}:${metricName}:${paramsKey}`;
    if (memo.has(key)) {
      return memo.get(key) ?? null;
    }

    const metric = metrics[metricName];
    if (!metric) {
      throw new Error(`Unknown metric: ${metricName}`);
    }

    const depValues: Record<string, MetricValue> = {};
    for (const dep of metric.deps ?? []) {
      depValues[dep] = calculateInternal(dep, ctx);
    }

    const engineRef: MetricEngine = {
      calculate: (nextMetricName, nextCtx) => calculateInternal(nextMetricName, nextCtx),
      calculateMany: (metricNames, nextCtx) =>
        metricNames.reduce<Record<string, MetricValue>>((acc, name) => {
          acc[name] = calculateInternal(name, nextCtx);
          return acc;
        }, {}),
    };

    const value = metric.compute({
      ...ctx,
      ...depValues,
      engine: engineRef,
    });
    memo.set(key, value);
    return value;
  };

  return {
    calculate: (metricName, ctx) => calculateInternal(metricName, ctx),
    calculateMany: (metricNames, ctx) =>
      metricNames.reduce<Record<string, MetricValue>>((acc, metricName) => {
        acc[metricName] = calculateInternal(metricName, ctx);
        return acc;
      }, {}),
  };
}
