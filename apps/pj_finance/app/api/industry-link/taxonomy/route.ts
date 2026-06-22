import fs from 'fs/promises';

import { NextRequest, NextResponse } from 'next/server';

import {
  getIndustryTaxonomyById,
  resolveTaxonomyFilePath,
} from '@/app/industryLink/taxonomyRegistry.server';
import { parseIndustryTaxonomyYaml } from '@/app/industryLink/aiIndustryTaxonomy';

/** 将 YAML 草稿写入对应产业链配置文件 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体须为 JSON' }, { status: 400 });
  }

  const taxonomyId = (body as { taxonomyId?: string; preset?: string }).taxonomyId ?? (body as { preset?: string }).preset;
  const content = (body as { content?: string }).content;

  if (!taxonomyId) {
    return NextResponse.json({ error: '缺少 taxonomyId' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: '缺少 content' }, { status: 400 });
  }

  try {
    parseIndustryTaxonomyYaml(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `YAML 解析失败: ${message}` }, { status: 400 });
  }

  const taxonomy = await getIndustryTaxonomyById(taxonomyId);
  if (!taxonomy) {
    return NextResponse.json({ error: '无效的产业链 taxonomyId' }, { status: 400 });
  }

  const resolved = resolveTaxonomyFilePath(taxonomy.filename);
  if (!resolved) {
    return NextResponse.json({ error: '非法文件路径' }, { status: 400 });
  }

  try {
    await fs.writeFile(resolved, content, 'utf-8');
    return NextResponse.json({ ok: true, file: taxonomy.filename });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `写入 YAML 失败: ${message}` }, { status: 500 });
  }
}
