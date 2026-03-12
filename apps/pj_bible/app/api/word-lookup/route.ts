import { NextRequest, NextResponse } from 'next/server';

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';

export async function POST(req: NextRequest) {
  try {
    const { word } = await req.json();

    if (!word || typeof word !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "word"' },
        { status: 400 },
      );
    }

    const prompt = `你是一个英汉词典。请给出下面这个英文单词的音标和简明中文释义。

单词: ${word}

请用如下格式回答（不要加多余说明）：
音标: /.../
中文释义: ...`;

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
      console.error('Ollama error', res.status, text);
      return NextResponse.json(
        { error: 'Ollama request failed' },
        { status: 500 },
      );
    }

    const data = await res.json() as any;
    const content =
      data?.message?.content ??
      data?.choices?.[0]?.message?.content ??
      '';

    return NextResponse.json({ word, text: content });
  } catch (err) {
    console.error('word-lookup error', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}

