import crypto from 'node:crypto';

const BASE_URL = 'https://webapi.cninfo.com.cn';
const SLATKEY_URL = `${BASE_URL}/api/mcode/slatkey`;

function buildAcceptEnckey(slatkey: string): string {
  const key = Buffer.from(slatkey, 'utf8');
  const iv = Buffer.from(slatkey, 'utf8');
  const payload = Math.floor(Date.now() / 1000).toString();
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(payload, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

export type PInfo3085Json = {
  resultcode?: number;
  resultmsg?: string;
  total?: number;
  records?: Array<Record<string, string | number | null | undefined>>;
};

/**
 * 服务端拉取巨潮 p_info3085 全量 JSON（须 Enckey）
 * @param scode 6 位证券代码
 */
export async function fetchPInfo3085Json(
  scode: string
): Promise<{ ok: true; json: PInfo3085Json } | { ok: false; error: string; status: number }> {
  if (!/^\d{6}$/.test(scode)) {
    return { ok: false, error: 'scode 须为 6 位数字', status: 400 };
  }

  try {
    const slatkeyResp = await fetch(SLATKEY_URL);
    if (!slatkeyResp.ok) {
      return { ok: false, error: `获取 slatkey 失败 HTTP ${slatkeyResp.status}`, status: 502 };
    }
    const slatkey = (await slatkeyResp.text()).trim();
    if (!slatkey) {
      return { ok: false, error: 'slatkey 为空', status: 502 };
    }

    const acceptEnckey = buildAcceptEnckey(slatkey);
    const url = `${BASE_URL}/api/info/p_info3085?scode=${encodeURIComponent(scode)}`;
    const resp = await fetch(url, {
      headers: {
        'Accept-Enckey': acceptEnckey,
        Referer: `${BASE_URL}/#/dataBrowse`,
        Origin: BASE_URL,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const text = await resp.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: '巨潮接口返回非 JSON', status: 502 };
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: `巨潮 HTTP ${resp.status}`,
        status: resp.status >= 400 && resp.status < 600 ? resp.status : 502,
      };
    }

    return { ok: true, json: json as PInfo3085Json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 500 };
  }
}
