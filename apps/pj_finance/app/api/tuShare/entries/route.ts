import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const BASE = 'temp/tuShare';

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
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.csv')) {
        files.push(e.name);
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
