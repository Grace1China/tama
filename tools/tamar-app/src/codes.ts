const QUALIFIED = /^(\d{6})\.(SZ|SH|BJ)$/;

/** 6 位代码按交易所前缀补全。688/6/9 为上交所，0/3 为深交所，4/8 为北交所。 */
export function exchangeForSymbol(symbol: string): 'SH' | 'SZ' | 'BJ' | null {
  if (symbol.startsWith('6') || symbol.startsWith('9')) return 'SH';
  if (symbol.startsWith('0') || symbol.startsWith('3')) return 'SZ';
  if (symbol.startsWith('4') || symbol.startsWith('8')) return 'BJ';
  return null;
}

/** 接受 688072.SH、688072.sh 或 6 位代码。无法识别时返回 null。 */
export function normalizeTsCode(raw: string): string | null {
  const text = String(raw ?? '').trim().toUpperCase();
  const qualified = text.match(QUALIFIED);
  if (qualified) return `${qualified[1]}.${qualified[2]}`;
  const loose = text.match(/^(\d{6})(?:[\s._-]*(SZ|SH|BJ))?$/);
  if (!loose) return null;
  const symbol = loose[1];
  const hinted = loose[2] as 'SH' | 'SZ' | 'BJ' | undefined;
  const exchange = hinted ?? exchangeForSymbol(symbol);
  if (!exchange) return null;
  return `${symbol}.${exchange}`;
}

export function symbolOf(tsCode: string): string {
  return tsCode.slice(0, 6);
}

export function uniqueCodes(raw: Iterable<string>, maxCodes?: number): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const item of raw) {
    const code = normalizeTsCode(item);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (maxCodes != null && codes.length >= maxCodes) break;
  }
  return codes;
}
