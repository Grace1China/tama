import fs from 'fs/promises';
import path from 'path';

import YAML from 'yaml';

import { parseIndustryTaxonomyYaml } from './aiIndustryTaxonomy';
import type { IndustryTaxonomyRegistryItem } from './taxonomyRegistryTypes';

const TAXONOMY_DIR = path.join(process.cwd(), 'app/industryLink/taxonomies');
const YAML_FILE_RE = /^[a-zA-Z0-9_-]+\.ya?ml$/;

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

function normalizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
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

export async function listIndustryTaxonomies(): Promise<IndustryTaxonomyRegistryItem[]> {
  const names = await fs.readdir(TAXONOMY_DIR);
  const items: IndustryTaxonomyRegistryItem[] = [];

  for (const filename of names) {
    if (!YAML_FILE_RE.test(filename)) continue;

    const filePath = path.join(TAXONOMY_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const meta = metaFromYaml(content);
    if (meta.enabled === false) continue;

    parseIndustryTaxonomyYaml(content);

    const fallbackId = filename.replace(/\.ya?ml$/i, '');
    const id = normalizeId(typeof meta.id === 'string' ? meta.id : fallbackId) || fallbackId;
    const label = typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim() : titleFromId(id);
    const order = typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : 999;

    items.push({ id, label, order, filename, content });
  }

  return items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

export async function getIndustryTaxonomyById(id: string): Promise<IndustryTaxonomyRegistryItem | null> {
  const normalized = normalizeId(id);
  const items = await listIndustryTaxonomies();
  return items.find((item) => item.id === normalized) ?? null;
}

export function resolveTaxonomyFilePath(filename: string): string | null {
  if (!YAML_FILE_RE.test(filename)) return null;
  const resolved = path.resolve(TAXONOMY_DIR, filename);
  if (!resolved.startsWith(path.resolve(TAXONOMY_DIR) + path.sep)) return null;
  return resolved;
}
