import fs from 'node:fs';
import path from 'node:path';

export class SafeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SafeError';
  }
}

/** 解析后的真实路径必须仍在根目录内，拒绝符号链接跳出。 */
export function resolveInsideRoot(rootReal: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new SafeError('path_rejected', '只允许数据根内的相对路径');
  }
  const parts = relativePath.split(/[\\/]+/);
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    throw new SafeError('path_traversal', '路径不允许 . 或 ..');
  }
  const lexical = path.resolve(rootReal, relativePath);
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (lexical !== rootReal && !lexical.startsWith(rootPrefix)) {
    throw new SafeError('path_outside_root', '路径超出数据根');
  }
  if (!fs.existsSync(lexical)) return lexical;
  const real = fs.realpathSync(lexical);
  if (real !== rootReal && !real.startsWith(rootPrefix)) {
    throw new SafeError('path_outside_root', '符号链接指向数据根之外');
  }
  return real;
}

export function isInside(parentReal: string, childReal: string): boolean {
  const prefix = parentReal.endsWith(path.sep) ? parentReal : parentReal + path.sep;
  return childReal === parentReal || childReal.startsWith(prefix);
}

export function assertHomeOutsideData(homeReal: string, dataRootReal: string | null): void {
  if (dataRootReal && isInside(dataRootReal, homeReal)) {
    throw new SafeError('home_inside_data_root', '缓存目录不能位于数据根内');
  }
  if (dataRootReal && isInside(homeReal, dataRootReal)) {
    throw new SafeError('data_root_inside_home', '数据根不能位于缓存目录内');
  }
}

/** 生产查询只允许读。写入、导出和改表语句直接拒绝。 */
export function assertReadOnlySql(sql: string): void {
  const stripped = sql.replace(/'(?:''|[^'])*'/g, "''");
  if (/\b(insert|update|delete|copy|create|drop|alter|attach|export|truncate|merge)\b/i.test(stripped)) {
    throw new SafeError('sql_rejected', '只允许读取查询');
  }
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
