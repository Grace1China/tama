import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { AppConfig } from '../config.js';
import { parseIndustryTaxonomyYaml, type AIIndustryTaxonomyFile } from './parse.js';

const YAML_FILE_RE = /^[a-zA-Z0-9_-]+\.ya?ml$/;

export type TaxonomyRecord = {
  id: string;
  label: string;
  order: number;
  filename: string;
  taxonomy: AIIndustryTaxonomyFile;
};

type TaxonomyMeta = {
  id?: unknown;
  label?: unknown;
  order?: unknown;
  enabled?: unknown;
};

function titleFromId(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeTaxonomyId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.ya?ml$/i, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function metaFromYaml(content: string): TaxonomyMeta {
  const doc = YAML.parse(content);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
  const meta = (doc as Record<string, unknown>).meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as TaxonomyMeta;
}

export function loadCompanyCodeMap(config: AppConfig): Record<string, string> {
  if (!config.companyCodeFile || !fs.existsSync(config.companyCodeFile)) return {};
  const doc = YAML.parse(fs.readFileSync(config.companyCodeFile, 'utf8'));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    const name = String(key).trim();
    const code = String(value ?? '').trim();
    if (name && code) out[name] = code;
  }
  return out;
}

export function listTaxonomies(config: AppConfig): TaxonomyRecord[] {
  if (!config.taxonomyDir) return [];
  const names = fs.readdirSync(config.taxonomyDir);
  const items: TaxonomyRecord[] = [];
  for (const filename of names) {
    if (!YAML_FILE_RE.test(filename)) continue;
    const filePath = path.join(config.taxonomyDir, filename);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(config.taxonomyDir) + path.sep)) continue;
    const content = fs.readFileSync(resolved, 'utf8');
    const meta = metaFromYaml(content);
    if (meta.enabled === false) continue;
    const taxonomy = parseIndustryTaxonomyYaml(content);
    const fallbackId = filename.replace(/\.ya?ml$/i, '');
    const id = normalizeTaxonomyId(typeof meta.id === 'string' ? meta.id : fallbackId) || fallbackId;
    const label = typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim() : titleFromId(id);
    const order = typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : 999;
    items.push({ id, label, order, filename, taxonomy });
  }
  return items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

export function companyCount(taxonomy: AIIndustryTaxonomyFile): number {
  const names = new Set<string>();
  for (const lane of taxonomy.lanes) {
    for (const sub of lane.sub_lanes) {
      for (const company of sub.companies) {
        const name = company.name.trim();
        if (name) names.add(name);
      }
    }
  }
  return names.size;
}
