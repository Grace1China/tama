import { NextRequest, NextResponse } from 'next/server';
import { fetchPInfo3085Json } from '@/lib/cninfo/fetchPInfo3085Server';

/** 代理巨潮 p_info3085（需 Accept-Enckey，与 fetch_cninfo_profit.js 同源逻辑） */
export async function GET(req: NextRequest) {
  const scode = req.nextUrl.searchParams.get('scode')?.trim() ?? '';
  const result = await fetchPInfo3085Json(scode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.json);
}
