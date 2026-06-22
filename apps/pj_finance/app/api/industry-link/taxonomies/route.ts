import { NextResponse } from 'next/server';

import { listIndustryTaxonomies } from '@/app/industryLink/taxonomyRegistry.server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const taxonomies = await listIndustryTaxonomies();
    return NextResponse.json({ taxonomies });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `读取产业链 YAML 失败: ${message}` }, { status: 500 });
  }
}
