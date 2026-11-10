import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHomeOutsideData, SafeError } from './safety.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type AppConfig = {
  packageRoot: string;
  host: '127.0.0.1';
  port: number;
  dataRoot: string | null;
  home: string;
  taxonomyDir: string | null;
  companyCodeFile: string | null;
  auctionFile: string | null;
  /** 集合竞价文件的预期路径。文件不存在时仍保留，便于返回 missing。 */
  auctionExpected: string | null;
  token: string | null;
};

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  const value = raw == null || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SafeError('bad_env', `${key} 必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

function realDirIfExists(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const lexical = path.resolve(text);
  if (!fs.existsSync(lexical)) return null;
  const real = fs.realpathSync(lexical);
  if (!fs.statSync(real).isDirectory()) {
    throw new SafeError('not_directory', `${text} 必须是目录`);
  }
  return real;
}

function realFileIfExists(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const lexical = path.resolve(text);
  if (!fs.existsSync(lexical)) return null;
  const real = fs.realpathSync(lexical);
  if (!fs.statSync(real).isFile()) {
    throw new SafeError('not_file', `${text} 必须是文件`);
  }
  return real;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = (env.TAMAR_APP_HOST ?? '127.0.0.1').trim();
  if (host !== '127.0.0.1') {
    throw new SafeError('host_rejected', '只绑定 127.0.0.1');
  }
  const port = intEnv(env, 'TAMAR_APP_PORT', 3012, 1, 65535);
  if (port === 3000 || port === 3001 || port === 3011) {
    throw new SafeError('port_conflict', '端口不能使用 3000、3001 或 3011');
  }

  const homeLexical = path.resolve(PACKAGE_ROOT, env.TAMAR_APP_HOME?.trim() || 'var');
  fs.mkdirSync(homeLexical, { recursive: true });
  const home = fs.realpathSync(homeLexical);

  let dataRoot: string | null = null;
  const dataRaw = env.TAMA_DATA_ROOT?.trim();
  if (dataRaw) {
    const dataLexical = path.resolve(dataRaw);
    if (!fs.existsSync(dataLexical)) {
      throw new SafeError('data_root_missing', 'TAMA_DATA_ROOT 不存在');
    }
    dataRoot = fs.realpathSync(dataLexical);
    if (!fs.statSync(dataRoot).isDirectory()) {
      throw new SafeError('data_root_not_directory', 'TAMA_DATA_ROOT 必须是目录');
    }
  }
  assertHomeOutsideData(home, dataRoot);

  const bundledTaxonomy = path.resolve(PACKAGE_ROOT, '../../apps/pj_finance/app/industryLink/taxonomies');
  const taxonomyDir = realDirIfExists(env.TAMAR_TAXONOMY_DIR) ?? realDirIfExists(bundledTaxonomy);
  const companyCodeFile =
    realFileIfExists(env.TAMAR_COMPANY_CODE_FILE) ??
    (taxonomyDir ? realFileIfExists(path.join(taxonomyDir, 'industry_company_ts_codes.yaml')) : null) ??
    (taxonomyDir ? realFileIfExists(path.join(path.dirname(taxonomyDir), 'industry_company_ts_codes.yaml')) : null);

  const auctionExpected = env.TAMAR_AUCTION_FILE?.trim()
    ? path.resolve(env.TAMAR_AUCTION_FILE.trim())
    : taxonomyDir
      ? path.join(path.dirname(taxonomyDir), 'auction', 'latest.json')
      : dataRoot
        ? path.join(dataRoot, 'auction', 'latest.json')
        : null;
  const auctionFile = auctionExpected && fs.existsSync(auctionExpected) ? fs.realpathSync(auctionExpected) : null;

  return {
    packageRoot: PACKAGE_ROOT,
    host: '127.0.0.1',
    port,
    dataRoot,
    home,
    taxonomyDir,
    companyCodeFile,
    auctionFile,
    auctionExpected,
    token: env.TAMAR_APP_TOKEN?.trim() || null,
  };
}
