type ChatMessage = { role: 'system' | 'user'; content: string };

export type HotConceptsProviderName = 'deepseek' | 'local';

/** 展开 Node fetch 的错误链（含 ECONNREFUSED 等），便于排查「fetch failed」 */
function formatFetchFailure(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 6 && cur != null; depth += 1) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const code = (cur as NodeJS.ErrnoException).code;
      if (code) parts.push(`syscall_code=${code}`);
      cur = 'cause' in cur ? (cur as Error & { cause?: unknown }).cause : undefined;
    } else if (typeof cur === 'object' && cur !== null && 'message' in cur) {
      parts.push(String((cur as { message: unknown }).message));
      cur = 'cause' in cur ? (cur as { cause?: unknown }).cause : undefined;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.filter(Boolean).join(' ');
}

/** Mac 上 localhost 可能解析到 IPv6，而 LM 只监听 127.0.0.1 时会导致 fetch failed */
function normalizeOpenAiBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/$/, '')
    .replace(/^(https?):\/\/localhost(?=[:/]|$)/i, '$1://127.0.0.1');
}

function stripToOneLine(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/** 未设置 HOT_CONCEPTS_LLM_TIMEOUT_MS 时：云端默认 180s，本地默认 600s（本机推理常更慢） */
export function resolveHotConceptsLlmTimeoutMs(provider: HotConceptsProviderName): number {
  const maxCap = 3_600_000;
  const fallback = provider === 'local' ? 600_000 : 180_000;
  const raw = process.env.HOT_CONCEPTS_LLM_TIMEOUT_MS?.trim();
  if (!raw) {
    return Math.min(maxCap, Math.max(10_000, fallback));
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return Math.min(maxCap, Math.max(10_000, fallback));
  }
  return Math.min(maxCap, Math.max(10_000, n));
}

export async function chatOpenAICompatible(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** 未传时按 provider 与 HOT_CONCEPTS_LLM_TIMEOUT_MS 计算（省略 provider 时按本地 600s 兜底，避免超时过短） */
  timeoutMs?: number;
  /** 与 resolveHotConceptsLlmTimeoutMs 一致，用于未传 timeoutMs 时的默认云端/本地超时 */
  provider?: HotConceptsProviderName;
}): Promise<string> {
  const base = normalizeOpenAiBaseUrl(opts.baseUrl);
  const timeoutMs = Math.max(
    10_000,
    Math.min(
      3_600_000,
      opts.timeoutMs ?? resolveHotConceptsLlmTimeoutMs(opts.provider ?? 'local')
    )
  );
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        temperature: opts.temperature ?? 0.25,
        messages: opts.messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const detail = formatFetchFailure(err);
    const hintTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? `（已超过 ${timeoutMs}ms，可在 pj_finance/.env.local 设置 HOT_CONCEPTS_LLM_TIMEOUT_MS，本地最高约 3600000）`
        : '';
    const proxyHint =
      /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|certificate/i.test(detail) ||
      (err instanceof Error && /fetch failed/i.test(err.message))
        ? ' 若已确认 LM Studio/Ollama 在运行：请在 pj_finance/.env.local 增加 NO_PROXY=127.0.0.1,localhost（系统代理常导致 Node 访问本机失败）；LOCAL_LLM_BASE_URL 建议使用 http://127.0.0.1:端口/v1。'
        : '';
    throw new Error(
      `连接本地/云端 LLM 失败${hintTimeout}: ${detail || 'fetch failed'}。` +
        ` 请确认 pj_finance/.env.local 中 LOCAL_LLM_BASE_URL 为 OpenAI 兼容根路径（示例 http://127.0.0.1:1234/v1），且能访问 ${base}/chat/completions；LOCAL_LLM_MODEL 与本地列表一致。` +
        proxyHint
    );
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data?.choices?.[0]?.message?.content ?? '';
  return stripToOneLine(String(raw));
}

export function resolveHotConceptsLlmConfig(): {
  provider: HotConceptsProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const explicit = (process.env.HOT_CONCEPTS_LLM || '').trim().toLowerCase();
  const dsKey = (process.env.DEEPSEEK_API_KEY || '').trim();
  const localBase = (process.env.LOCAL_LLM_BASE_URL || '').trim();

  if (explicit === 'deepseek' && dsKey) {
    return {
      provider: 'deepseek',
      baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      apiKey: dsKey,
      model: (process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro').trim(),
    };
  }
  if (explicit === 'local' && localBase) {
    return {
      provider: 'local',
      baseUrl: normalizeOpenAiBaseUrl(localBase),
      apiKey: (process.env.LOCAL_LLM_API_KEY || '').trim(),
      model: (process.env.LOCAL_LLM_MODEL || 'gemma4').trim(),
    };
  }

  // auto 或未设置：优先本地（LOCAL_LLM_BASE_URL），其次 DeepSeek，便于开发环境先走本机
  if (!explicit || explicit === 'auto') {
    if (localBase) {
      return {
        provider: 'local',
        baseUrl: normalizeOpenAiBaseUrl(localBase),
        apiKey: (process.env.LOCAL_LLM_API_KEY || '').trim(),
        model: (process.env.LOCAL_LLM_MODEL || 'gemma4').trim(),
      };
    }
    if (dsKey) {
      return {
        provider: 'deepseek',
        baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
        apiKey: dsKey,
        model: (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
      };
    }
  }

  return null;
}
