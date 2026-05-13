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
 * 环境变量写在应用根目录 .env.local（与 package.json 同级，勿改 .env.example）：
 * - HOT_CONCEPTS_LLM: deepseek | local | auto（默认 auto：优先 LOCAL_LLM_BASE_URL，否则 DEEPSEEK_API_KEY）
 * - HOT_CONCEPTS_LLM_TIMEOUT_MS: 超时毫秒（不设时本地默认 600000、云端 180000；上限约 3600000）
 * - DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL
 * - LOCAL_LLM_BASE_URL（如 LM Studio http://127.0.0.1:1234/v1）、LOCAL_LLM_MODEL、LOCAL_LLM_API_KEY（可选）
 */
/** 与热点 LLM 超时对齐：默认 600s 本地推理 + 巨潮与头尾余量；Vercel 等环境仍受套餐上限约束 */
export const maxDuration = 660;

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
          '未配置热点归纳模型：请在 .env.local 中设置 LOCAL_LLM_BASE_URL（OpenAI 兼容 /v1），或 DEEPSEEK_API_KEY（云端）。可选 HOT_CONCEPTS_LLM=local|deepseek|auto。保存后需重启 dev。',
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
      {
        phase: 'cninfo',
        resultcode: j.resultcode,
        error: String(j.resultmsg ?? `巨潮 resultcode=${j.resultcode}`),
      },
      { status: 502 }
    );
  }

  const lines = pickPeriodicDisclosureLines(j.records, 45);
  const user = buildHotConceptsUserPrompt(tsCode, lines);
  const system = buildHotConceptsSystemPrompt();

  // 开发排查：打印入模概要（不落 API Key）；periodicReportTitleLines 即 user 中的公告标题素材（新→旧）
  const userPreviewLimit = 2500;
  console.log('[hot-concepts/from-disclosures] llm_input', {
    tsCode,
    cninfoScode: scode,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKeyConfigured: Boolean(cfg.apiKey?.trim()),
    periodicReportTitleCount: lines.length,
    periodicReportTitleLines: lines,
    systemPrompt: system,
    userPromptCharCount: user.length,
    userPromptPreview:
      user.length <= userPreviewLimit
        ? user
        : `${user.slice(0, userPreviewLimit)}…(${user.length - userPreviewLimit} more chars omitted)`,
  });

  try {
    const summary = await chatOpenAICompatible({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      provider: cfg.provider,
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
    return NextResponse.json({ phase: 'llm', error: msg }, { status: 502 });
  }
}
