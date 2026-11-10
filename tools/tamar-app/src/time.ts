const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把绝对时间格式化为 Asia/Shanghai 的日历时间，不依赖本机时区。 */
export function formatCst(ms: number): string {
  const shifted = new Date(ms + CST_OFFSET_MS);
  const iso = shifted.toISOString().slice(0, 19);
  return `${iso.replace('T', ' ')}+08:00`;
}

export function nowCst(ms: number = Date.now()): string {
  return formatCst(ms);
}

function cstParts(ms: number): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const shifted = new Date(ms + CST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * 预期最近 A 股交易日（只跳过周末，不含节假日）。
 * 工作日 15:00（含）之后视为当日已收盘；此前回退到上一个工作日。
 */
export function expectedLastSession(nowMs: number = Date.now()): string {
  const parts = cstParts(nowMs);
  const afterClose = parts.hour > 15 || (parts.hour === 15 && parts.minute >= 0);
  const cursor = new Date(Date.UTC(parts.year, parts.month, parts.day));
  const isWeekend = parts.weekday === 0 || parts.weekday === 6;
  if (isWeekend || !afterClose) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const year = cursor.getUTCFullYear();
  const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cursor.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function dateDigits(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10).replace(/-/g, '');
  }
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : '';
}

export function maxDate(values: Array<string | null | undefined>): string | null {
  let best = '';
  for (const value of values) {
    const digits = dateDigits(value);
    if (digits && digits > best) best = digits;
  }
  return best || null;
}
