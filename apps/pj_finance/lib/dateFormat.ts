export function formatDateYYQn(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  // support YYYYQn / YYYY-Qn
  const quarterText = raw.match(/^(\d{4})\s*[-/]?\s*Q([1-4])$/i);
  if (quarterText) return `${quarterText[1].slice(2, 4)}Q${quarterText[2]}`;

  // support YYYYMMDD / YYYYMM
  if (/^\d{8}$/.test(raw)) {
    const mm = Number(raw.slice(4, 6));
    if (mm >= 1 && mm <= 12) return `${raw.slice(2, 4)}Q${Math.floor((mm - 1) / 3) + 1}`;
  }
  if (/^\d{6}$/.test(raw)) {
    const mm = Number(raw.slice(4, 6));
    if (mm >= 1 && mm <= 12) return `${raw.slice(2, 4)}Q${Math.floor((mm - 1) / 3) + 1}`;
  }

  // support YYYY-MM-DD / YYYY-MM
  const dashDate = raw.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (dashDate) {
    const mm = Number(dashDate[2]);
    if (mm >= 1 && mm <= 12) return `${dashDate[1].slice(2, 4)}Q${Math.floor((mm - 1) / 3) + 1}`;
  }

  // support YYYY/M/D / YYYY/M
  const slashDate = raw.match(/^(\d{4})\/(\d{1,2})(?:\/\d{1,2})?/);
  if (slashDate) {
    const mm = Number(slashDate[2]);
    if (mm >= 1 && mm <= 12) return `${slashDate[1].slice(2, 4)}Q${Math.floor((mm - 1) / 3) + 1}`;
  }
  return raw;
}

// Backward-compatible alias name used in income1 page.
export const formatDateYYMM = formatDateYYQn;
