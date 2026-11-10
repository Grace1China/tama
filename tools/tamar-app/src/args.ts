import { normalizeTsCode, uniqueCodes } from './codes.js';
import { SafeError } from './safety.js';

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return value == null ? '' : String(value).trim();
}

export function argStrings(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value == null || String(value).trim() === '') return [];
  return String(value).split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
}

export function argLimit(args: Record<string, unknown>, fallback: number, max: number): number {
  const raw = args.limit;
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new SafeError('bad_limit', 'limit 必须是数字');
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export function argCodes(args: Record<string, unknown>, max = 240): string[] {
  const direct = argStrings(args, 'ts_codes');
  const one = argString(args, 'ts_code');
  const codes = uniqueCodes(one ? [one, ...direct] : direct, max);
  if (!codes.length) throw new SafeError('bad_ts_code', '需要 ts_code，例如 688072.SH 或 688072');
  return codes;
}

export function argCode(args: Record<string, unknown>): string {
  const code = normalizeTsCode(argString(args, 'ts_code') || argString(args, 'code'));
  if (!code) throw new SafeError('bad_ts_code', 'ts_code 需要 688072.SH 或 6 位代码');
  return code;
}
