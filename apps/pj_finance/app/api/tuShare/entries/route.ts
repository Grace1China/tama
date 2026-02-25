/**
 * TuShare 目录列表 API
 *
 * GET /api/tuShare/entries?path=<相对路径>
 *
 * 列出 temp/tuShare 下指定目录的子目录与数据文件（CSV、Parquet）。
 * - 仅返回子目录名和以 .csv 或 .parquet 结尾的文件名，隐藏文件（以 . 开头）会被忽略。
 * - path 必须为相对路径，禁止 .. 或绝对路径，防止目录穿越。
 * - 响应格式：{ dirs: string[], files: string[], path: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const BASE = 'temp/tuShare';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const rel = request.nextUrl.searchParams.get('path') ?? '';
    if (rel.includes('..') || path.isAbsolute(rel)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const dir = path.join(process.cwd(), BASE, rel);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs: string[] = [];
    const files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        dirs.push(e.name);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        if (lower.endsWith('.csv') || lower.endsWith('.parquet')) {
          files.push(e.name);
        }
      }
    }
    dirs.sort();
    files.sort();
    return NextResponse.json({ dirs, files, path: rel });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list directory' },
      { status: 500 }
    );
  }
}
