type ChatMessage = { role: 'system' | 'user'; content: string };

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

export async function chatOpenAICompatible(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.25,
      messages: opts.messages,
    }),
  });
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

export type HotConceptsProviderName = 'deepseek' | 'local';

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
      model: (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
    };
  }
  if (explicit === 'local' && localBase) {
    return {
      provider: 'local',
      baseUrl: localBase.replace(/\/$/, ''),
      apiKey: (process.env.LOCAL_LLM_API_KEY || '').trim(),
      model: (process.env.LOCAL_LLM_MODEL || 'gemma3:4b').trim(),
    };
  }

  if (!explicit || explicit === 'auto') {
    if (dsKey) {
      return {
        provider: 'deepseek',
        baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
        apiKey: dsKey,
        model: (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
      };
    }
    if (localBase) {
      return {
        provider: 'local',
        baseUrl: localBase.replace(/\/$/, ''),
        apiKey: (process.env.LOCAL_LLM_API_KEY || '').trim(),
        model: (process.env.LOCAL_LLM_MODEL || 'gemma3:4b').trim(),
      };
    }
  }

  return null;
}
