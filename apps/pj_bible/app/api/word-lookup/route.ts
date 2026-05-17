import { NextRequest, NextResponse } from 'next/server';

/** 远端 OpenAI 兼容（含 NVIDIA NIM integrate）或本地 Ollama */
type Provider = 'nvidia' | 'openai' | 'ollama';

/** 动态读取 env，避免部分构建流程对服务端变量静态替换不完整 */
function readEnvTrim(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = readEnvTrim('OPENAI_API_KEY');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const NVIDIA_CHAT_BASE_URL =
  readEnvTrim('NVIDIA_CHAT_BASE_URL') || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_API_KEY = readEnvTrim('NVIDIA_API_KEY');
const NVIDIA_CHAT_MODEL = readEnvTrim('NVIDIA_CHAT_MODEL');

const WORD_LOOKUP_PROVIDER = readEnvTrim('WORD_LOOKUP_PROVIDER').toLowerCase();
/** 已在 .env 显式写 nvidia/openai：不向本地 Ollama 静默降级，便于看到远端真实报错 */
const isExplicitRemoteProvider =
  WORD_LOOKUP_PROVIDER === 'nvidia' || WORD_LOOKUP_PROVIDER === 'openai';

/**
 * NVIDIA NIM LLM：https://integrate.api.nvidia.com + POST `/v1/chat/completions`
 * （见 https://docs.api.nvidia.com/nim/reference/llm-apis ）
 * - 裸 host 会自动补 `/v1`
 * - 勿把整条 `…/chat/completions` 再拼一次后缀（本会去重）
 * 注意：远端对 **错误或空的 model** 也会返回 `404 page not found`，易被误认为 URL 错了。
 */
function nvidiaNimChatCompletionsUrl(baseFromEnv: string): string {
  let s = baseFromEnv.trim();
  while (s.endsWith('/')) s = s.slice(0, -1);
  const sl = s.toLowerCase();
  if (sl.endsWith('/chat/completions')) {
    return s;
  }
  try {
    const u = new URL(s);
    const p = u.pathname.replace(/\/$/, '') || '';
    if (u.hostname === 'integrate.api.nvidia.com') {
      if (!p || p === '/') {
        return `${u.origin}/v1/chat/completions`;
      }
      if (p === '/v1') {
        return `${u.origin}/v1/chat/completions`;
      }
    }
    return `${s}/chat/completions`;
  } catch {
    return `${s}/v1/chat/completions`;
  }
}

function buildPrompt(word: string): string {
  return `你是一个英汉词典。请给出下面这个英文单词的音标和简明中文释义。

单词: ${word}

请用如下格式回答（不要加多余说明）：
音标: /.../
中文释义: ...`;
}

/** OpenAI / NIM：请求完整路径 `…/chat/completions`（base 通常为 `…/v1`） */
async function lookupWithChatCompletions(
  word: string,
  chatCompletionsUrl: string,
  apiKey: string,
  model: string,
  errorLabel: string,
): Promise<string> {
  const prompt = buildPrompt(word);
  const modelUse = typeof model === 'string' ? model.trim() : model;
  const res = await fetch(chatCompletionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelUse,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const pathOnly = (() => {
      try {
        return new URL(chatCompletionsUrl).pathname;
      } catch {
        return chatCompletionsUrl;
      }
    })();
    const nvidia404Hint =
      errorLabel === 'NVIDIA' && res.status === 404
        ? ' 常见原因：NVIDIA_CHAT_MODEL 与控制台/LLM APIs 列表不一致、未开通该模型，或值为空；正确示例见 meta/llama-3.1-8b-instruct。'
        : '';
    throw new Error(
      `${errorLabel} request failed: ${res.status} ${text}${nvidia404Hint} [path=${pathOnly} model=${modelUse || '(empty)'}]`,
    );
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content ?? '';
  return String(content ?? '');
}

async function lookupWithOpenAI(word: string): Promise<string> {
  const url = `${OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  return lookupWithChatCompletions(
    word,
    url,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    'OpenAI',
  );
}

async function lookupWithNvidia(word: string): Promise<string> {
  const url = nvidiaNimChatCompletionsUrl(NVIDIA_CHAT_BASE_URL);
  return lookupWithChatCompletions(
    word,
    url,
    NVIDIA_API_KEY,
    NVIDIA_CHAT_MODEL,
    'NVIDIA',
  );
}

async function lookupWithOllama(word: string): Promise<string> {
  const prompt = buildPrompt(word);
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;
  const content =
    data?.message?.content ??
    data?.choices?.[0]?.message?.content ??
    '';
  return String(content ?? '');
}

/** WORD_LOOKUP_PROVIDER 优先；否则有 NVIDIA Key 用 nvidia，有 OpenAI Key 用 openai，否则 Ollama */
function resolvePrimaryProvider(): Provider {
  const w = WORD_LOOKUP_PROVIDER;
  if (w === 'nvidia' || w === 'openai' || w === 'ollama') {
    return w;
  }
  if (NVIDIA_API_KEY) return 'nvidia';
  if (OPENAI_API_KEY) return 'openai';
  return 'ollama';
}

export async function POST(req: NextRequest) {
  try {
    const { word } = await req.json();

    if (!word || typeof word !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "word"' },
        { status: 400 },
      );
    }

    const trimmed = word.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: 'Missing or invalid "word"' },
        { status: 400 },
      );
    }

    const provider = resolvePrimaryProvider();

    // 强制指定远端时校验环境变量（避免误配后 silent 失败）
    if (provider === 'nvidia' && (!NVIDIA_API_KEY || !NVIDIA_CHAT_MODEL)) {
      return NextResponse.json(
        {
          error:
            '当前使用 NVIDIA Provider，但未配置 NVIDIA_API_KEY 或 NVIDIA_CHAT_MODEL（修改 .env.local 后请重启 dev）',
        },
        { status: 503 },
      );
    }
    if (provider === 'openai' && !OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            '当前使用 OpenAI Provider，但未配置 OPENAI_API_KEY（修改 .env.local 后请重启 dev）',
        },
        { status: 503 },
      );
    }

    const runPrimary = (): Promise<string> => {
      if (provider === 'nvidia') return lookupWithNvidia(trimmed);
      if (provider === 'openai') return lookupWithOpenAI(trimmed);
      return lookupWithOllama(trimmed);
    };

    try {
      const text = await runPrimary();
      return NextResponse.json({ word: trimmed, text, provider, degraded: false });
    } catch (e) {
      // 未显式写 nvidia/openai 时，远端失败可降级 Ollama；显式写则返回上游错误便于排查
      if (
        (provider === 'openai' || provider === 'nvidia') &&
        !isExplicitRemoteProvider
      ) {
        try {
          const text = await lookupWithOllama(trimmed);
          return NextResponse.json({
            word: trimmed,
            text,
            provider: 'ollama',
            degraded: true,
            attemptedProvider: provider,
          });
        } catch (e2) {
          console.error('word-lookup error (remote+ollama)', e, e2);
          return NextResponse.json(
            { error: 'Word lookup failed' },
            { status: 500 },
          );
        }
      }
      console.error('word-lookup error', provider, e);
      const msg = e instanceof Error ? e.message : 'Word lookup failed';
      const status =
        provider === 'openai' || provider === 'nvidia' ? 502 : 500;
      return NextResponse.json(
        { error: msg, upstream: provider },
        { status },
      );
    }
  } catch (err) {
    console.error('word-lookup error', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
