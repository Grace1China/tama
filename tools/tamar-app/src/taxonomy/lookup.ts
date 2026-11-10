import { normalizeTsCode, symbolOf } from '../codes.js';
import type { AICompanyNode, AIIndustryTaxonomyFile } from './parse.js';
import type { TaxonomyRecord } from './registry.js';

export type ChainLocation = {
  taxonomy_id: string;
  taxonomy_label: string;
  source_file: string;
  lane_title: string;
  tier: string;
  sub_lane_title: string;
  position: string | null;
  certainty: string | null;
  elasticity: string | null;
  company_name: string;
  ts_code: string | null;
  company_certainty: string | null;
  company_elasticity: string | null;
};

function text(info: Record<string, string> | undefined, key: string): string | null {
  const value = info?.[key]?.trim();
  return value || null;
}

/** YAML 键是「确定性」，不是「重要性」。两者都出现时分别保留。 */
function certaintyOf(info: Record<string, string> | undefined): string | null {
  return text(info, '确定性');
}

export function resolveCompanyCode(
  company: AICompanyNode,
  nameToCode: Record<string, string>,
): string | null {
  const raw = company.ts_code ?? company.info?.ts_code ?? company.info?.tsCode ?? nameToCode[company.name.trim()] ?? '';
  return normalizeTsCode(String(raw)) ?? (String(raw).trim() ? String(raw).trim().toUpperCase() : null);
}

export function locationsInTaxonomy(
  record: TaxonomyRecord,
  nameToCode: Record<string, string>,
): ChainLocation[] {
  const out: ChainLocation[] = [];
  for (const lane of record.taxonomy.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const company of sub.companies) {
        out.push({
          taxonomy_id: record.id,
          taxonomy_label: record.label,
          source_file: record.filename,
          lane_title: lane.title,
          tier: lane.tier,
          sub_lane_title: sub.title,
          position: text(sub.info, '产业位置'),
          certainty: certaintyOf(sub.info),
          elasticity: text(sub.info, '弹性'),
          company_name: company.name,
          ts_code: resolveCompanyCode(company, nameToCode),
          company_certainty: certaintyOf(company.info),
          company_elasticity: text(company.info, '弹性'),
        });
      }
    }
  }
  return out;
}

function matchesQuery(location: ChainLocation, query: string): boolean {
  const textQuery = query.trim();
  if (!textQuery) return false;
  if (location.company_name === textQuery) return true;
  const code = normalizeTsCode(textQuery);
  if (code && location.ts_code) {
    if (location.ts_code.toUpperCase() === code) return true;
    if (symbolOf(location.ts_code.toUpperCase()) === symbolOf(code)) return true;
  }
  const digits = textQuery.replace(/\D/g, '');
  if (digits.length === 6 && location.ts_code && symbolOf(location.ts_code) === digits) return true;
  return false;
}

/** 返回全部产业链命中。不保留先写入者，tao 与 hbm 同时给出。 */
export function lookupCompany(records: TaxonomyRecord[], nameToCode: Record<string, string>, query: string): ChainLocation[] {
  const hits: ChainLocation[] = [];
  for (const record of records) {
    for (const location of locationsInTaxonomy(record, nameToCode)) {
      if (matchesQuery(location, query)) hits.push(location);
    }
  }
  return hits;
}

export function sublaneCompanies(
  record: TaxonomyRecord,
  nameToCode: Record<string, string>,
  subLane: string,
): ChainLocation[] {
  const needle = subLane.trim();
  return locationsInTaxonomy(record, nameToCode).filter((location) => location.sub_lane_title === needle);
}

export function laneTree(record: TaxonomyRecord, nameToCode: Record<string, string>) {
  return {
    id: record.id,
    label: record.label,
    order: record.order,
    filename: record.filename,
    lanes: record.taxonomy.lanes.map((lane) => ({
      id: lane.id,
      title: lane.title,
      tier: lane.tier,
      sub_lanes: lane.sub_lanes.map((sub) => ({
        id: sub.id,
        title: sub.title,
        position: text(sub.info, '产业位置'),
        certainty: certaintyOf(sub.info),
        elasticity: text(sub.info, '弹性'),
        companies: sub.companies.map((company) => ({
          name: company.name,
          ts_code: resolveCompanyCode(company, nameToCode),
          certainty: certaintyOf(company.info),
          elasticity: text(company.info, '弹性'),
        })),
      })),
    })),
  };
}

export function universeOf(taxonomy: AIIndustryTaxonomyFile, nameToCode: Record<string, string>): {
  codes: string[];
  unmapped: number;
} {
  const names = new Set<string>();
  const codes = new Set<string>();
  let unmapped = 0;
  for (const lane of taxonomy.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const company of sub.companies) {
        const name = company.name.trim();
        if (!name || names.has(name)) continue;
        names.add(name);
        const code = resolveCompanyCode(company, nameToCode);
        if (!code || !/^\d{6}\.(SZ|SH|BJ)$/.test(code)) {
          unmapped += 1;
          continue;
        }
        codes.add(code);
      }
    }
  }
  return { codes: [...codes], unmapped };
}
