import YAML from 'yaml';
import raw from './industry_company_ts_codes.yaml';

/** 从映射表加载：键为公司展示名，值为 Tushare 风格 ts_code */
function loadNameToTsCode(): Record<string, string> {
  const text = typeof raw === 'string' ? raw : String(raw);
  const doc = YAML.parse(text);
  if (!doc || typeof doc !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    const name = String(k).trim();
    const code = String(v ?? '').trim();
    if (name && code) out[name] = code;
  }
  return out;
}

export const COMPANY_NAME_TO_TS_CODE = loadNameToTsCode();

/** 按 taxonomy / 卡片上的公司名解析公告弹窗用 ts_code */
export function tsCodeForCompanyName(name: string): string | undefined {
  const c = COMPANY_NAME_TO_TS_CODE[String(name).trim()];
  return c || undefined;
}
