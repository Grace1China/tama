/** Tushare 代码转巨潮查询用 6 位证券代码 */
export function tsCodeToCninfoScode(tsCode: string): string | null {
  const s = String(tsCode ?? '')
    .trim()
    .toUpperCase();
  const m = s.match(/^(\d{6})\.(SZ|SH|BJ)$/);
  if (m) return m[1];
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 6) return digits.slice(0, 6);
  return null;
}
