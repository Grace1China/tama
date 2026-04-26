import { NextRequest, NextResponse } from 'next/server';

type Provider = 'openai' | 'ollama';

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const WORD_LOOKUP_PROVIDER = (process.env.WORD_LOOKUP_PROVIDER || '').toLowerCase() as Provider | '';

function buildPrompt(word: string): string {
  return `你是一个英汉词典。请给出下面这个英文单词的音标和简明中文释义。

单词: ${word}

请用如下格式回答（不要加多余说明）：
音标: /.../
中文释义: ...`;
}

async function lookupWithOpenAI(word: string): Promise<string> {
  const prompt = buildPrompt(word);
  const res = await fetch(`${OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content ?? '';
  return String(content ?? '');
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

    const provider: Provider =
      WORD_LOOKUP_PROVIDER === 'openai' || WORD_LOOKUP_PROVIDER === 'ollama'
        ? WORD_LOOKUP_PROVIDER
        : (OPENAI_API_KEY ? 'openai' : 'ollama');

    try {
      const text =
        provider === 'openai'
          ? await lookupWithOpenAI(trimmed)
          : await lookupWithOllama(trimmed);
      return NextResponse.json({ word: trimmed, text, provider });
    } catch (e) {
      // 自动降级：在线模型失败时尝试本地 ollama
      if (provider === 'openai') {
        try {
          const text = await lookupWithOllama(trimmed);
          return NextResponse.json({ word: trimmed, text, provider: 'ollama' });
        } catch (e2) {
          console.error('word-lookup error (openai+ollama)', e, e2);
          return NextResponse.json({ error: 'Word lookup failed' }, { status: 500 });
        }
      }
      console.error('word-lookup error (ollama)', e);
      return NextResponse.json({ error: 'Word lookup failed' }, { status: 500 });
    }
  } catch (err) {
    console.error('word-lookup error', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}

