export type Quarter = 1 | 2 | 3 | 4;
export type Period = `${number}Q${Quarter}`;

const PERIOD_RE = /^(\d{4})Q([1-4])$/;

export function isValidPeriod(period: string): period is Period {
  return PERIOD_RE.test(period);
}

export function parsePeriod(period: string): { year: number; quarter: Quarter } {
  const match = period.match(PERIOD_RE);
  if (!match) {
    throw new Error(`Invalid period: ${period}. Expected format YYYYQ[1-4].`);
  }
  return {
    year: Number(match[1]),
    quarter: Number(match[2]) as Quarter,
  };
}

export function formatPeriod(year: number, quarter: Quarter): Period {
  return `${year}Q${quarter}`;
}

export function prevQuarter(period: string): Period {
  const { year, quarter } = parsePeriod(period);
  if (quarter === 1) {
    return formatPeriod(year - 1, 4);
  }
  return formatPeriod(year, (quarter - 1) as Quarter);
}

export function sameQuarterLastYear(period: string): Period {
  const { year, quarter } = parsePeriod(period);
  return formatPeriod(year - 1, quarter);
}

export function lastNQuarters(period: string, n: number): Period[] {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`n must be a positive integer, received: ${n}`);
  }
  const periods: Period[] = [];
  let cursor = parsePeriod(period);
  for (let i = 0; i < n; i += 1) {
    periods.push(formatPeriod(cursor.year, cursor.quarter));
    if (cursor.quarter === 1) {
      cursor = { year: cursor.year - 1, quarter: 4 };
    } else {
      cursor = { year: cursor.year, quarter: (cursor.quarter - 1) as Quarter };
    }
  }
  return periods;
}
