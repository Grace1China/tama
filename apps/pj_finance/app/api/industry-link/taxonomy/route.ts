import fs from 'fs/promises';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

import {
  TAXONOMY_YAML_BY_PRESET,
  isTaxonomyYamlPreset,
} from '@/app/industryLink/taxonomyYamlPaths';

const INDUSTRY_LINK_DIR = path.join(process.cwd(), 'app/industryLink');

/** 将 YAML 草稿写入对应产业链配置文件 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体须为 JSON' }, { status: 400 });
  }

  const preset = (body as { preset?: string }).preset;
  const content = (body as { content?: string }).content;

  if (!preset || !isTaxonomyYamlPreset(preset)) {
    return NextResponse.json({ error: '无效的产业链 preset' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: '缺少 content' }, { status: 400 });
  }

  const filename = TAXONOMY_YAML_BY_PRESET[preset];
  const filePath = path.join(INDUSTRY_LINK_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(INDUSTRY_LINK_DIR))) {
    return NextResponse.json({ error: '非法文件路径' }, { status: 400 });
  }

  try {
    await fs.writeFile(resolved, content, 'utf-8');
    return NextResponse.json({ ok: true, file: filename });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `写入 YAML 失败: ${message}` }, { status: 500 });
  }
}
