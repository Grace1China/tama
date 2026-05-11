import { NextRequest, NextResponse } from 'next/server';
import { fetchPInfo3085Json } from '@/lib/cninfo/fetchPInfo3085Server';
import { tsCodeToCninfoScode } from '@/lib/cninfoScode';
import {
  buildHotConceptsSystemPrompt,
  buildHotConceptsUserPrompt,
  pickPeriodicDisclosureLines,
} from '@/lib/hotConcepts/disclosureTitles';
import { chatOpenAICompatible, resolveHotConceptsLlmConfig } from '@/lib/hotConcepts/llmChat';

/**
 * POST JSON: { tsCode: string }
 * 从巨潮 p_info3085 中筛定期报告类标题，经 DeepSeek 或本地 OpenAI 兼容接口归纳热点概念词。
 *
 * 环境变量：
 * - HOT_CONCEPTS_LLM: deepseek | local | auto（默认 auto：有 DEEPSEEK_API_KEY 则 DeepSeek，否则 LOCAL_LLM_BASE_URL）
 * - DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL
 * - LOCAL_LLM_BASE_URL（如 LM Studio http://127.0.0.1:1234/v1）、LOCAL_LLM_MODEL、LOCAL_LLM_API_KEY（可选）
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体须为 JSON' }, { status: 400 });
  }
  const tsCode = String((body as { tsCode?: string })?.tsCode ?? '').trim().toUpperCase();
  if (!/^\d{6}\.(SZ|SH|BJ)$/.test(tsCode)) {
    return NextResponse.json({ error: 'tsCode 格式须为 000001.SZ 形式' }, { status: 400 });
  }

  const cfg = resolveHotConceptsLlmConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          '未配置热点归纳模型：请设置 DEEPSEEK_API_KEY，或设置 LOCAL_LLM_BASE_URL（OpenAI 兼容 /v1，如本地 Gemma）',
      },
      { status: 503 }
    );
  }

  const scode = tsCodeToCninfoScode(tsCode);
  if (!scode) {
    return NextResponse.json({ error: '无法解析巨潮 6 位证券代码' }, { status: 400 });
  }

  const cn = await fetchPInfo3085Json(scode);
  if (!cn.ok) {
    return NextResponse.json({ error: cn.error }, { status: cn.status });
  }
  const j = cn.json;
  if (j.resultcode != null && j.resultcode !== 200) {
    return NextResponse.json(
      { error: String(j.resultmsg ?? `巨潮 resultcode=${j.resultcode}`) },
      { status: 502 }
    );
  }

  const lines = pickPeriodicDisclosureLines(j.records, 45);
  const user = buildHotConceptsUserPrompt(tsCode, lines);
  const system = buildHotConceptsSystemPrompt();

  try {
    const summary = await chatOpenAICompatible({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return NextResponse.json({
      tsCode,
      provider: cfg.provider,
      periodicTitleCount: lines.length,
      summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
