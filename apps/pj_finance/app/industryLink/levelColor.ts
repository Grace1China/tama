/** 等级着色：高→红、中高→橙、中→黄、低→绿 */
export function getLevelColor(value: string): string {
  const v = value.trim();
  if (/中高|较高/.test(v)) return '#ea580c';
  if (v === '中') return '#ca8a04';
  if (/中低/.test(v)) return '#16a34a';
  if (/低|较低/.test(v)) return '#16a34a';
  if (/高/.test(v)) return '#dc2626';
  if (/中/.test(v)) return '#ca8a04';
  return '#111827';
}
