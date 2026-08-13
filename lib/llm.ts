/**
 * lib/llm.ts — LLM client 统一封装（PRD §7 / §12 前置 1）
 *
 * 铁律（PRD §12）：所有模块只调这一层，禁止直连 opencode。
 *
 * 端点（2026-08-12 晚 Hermes 实测确认，用户澄清后）：
 *  - 主 T1/T2 (flash/pro) → https://tokenrhythm.studio/v1（TokenRhythm 订阅，用户当前主用）
 *  - 兜底1 → https://opencode.ai/zen/go/v1（opencode-go 订阅，未过期！需浏览器 UA 否则 403/1010；边际成本≈0）
 *  - 兜底2 → https://api.deepseek.com/v1（DeepSeek 直连 API）
 *  - ⚠️ 注意：opencode.ai 有 Cloudflare 拦截，必须带浏览器 User-Agent 才能访问；
 *    zen/v1 免费档当前 CreditsError（余额不足），go 端点正常。
 */
import type { ApplicationRecord } from '../shared/schema.ts';

export type Tier = 'T1' | 'T2';

export const ENDPOINTS = {
  tr: 'https://tokenrhythm.studio/v1',
  ds: 'https://api.deepseek.com/v1',
  go: 'https://opencode.ai/zen/go/v1',
} as const;

export const MODELS = {
  T1: 'deepseek-v4-flash-0731', // 起草/量大（TokenRhythm）
  T2: 'deepseek-v4-pro',         // 审查/高敏（TokenRhythm）
  fallback1: 'deepseek-v4-flash', // 兜底1（opencode-go 订阅，边际成本≈0）
  fallback2: 'deepseek-chat',    // 兜底2（DeepSeek 直连）
} as const;

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;       // 请求 JSON 输出（部分模型支持）
  timeoutMs?: number;       // 默认 30_000
  retries?: number;         // 默认 2
  /** 透传的推理相关参数（deepseek 系支持） */
  extra?: Record<string, unknown>;
}

export interface LLMResult {
  text: string;
  model: string;
  endpoint: string;
  usage?: { prompt: number; completion: number; total: number };
  tookMs: number;
  /** 兜底链经过的模型（仅降级时非空） */
  fallbackChain?: string[];
}

export interface LLMStats {
  calls: number;
  tokens: { prompt: number; completion: number; total: number };
  fallbacks: number;
  errors: number;
  lastError?: string;
}

/** 全局 token 统计（对接 §14.4 成本看板） */
export const stats: LLMStats = {
  calls: 0,
  tokens: { prompt: 0, completion: 0, total: 0 },
  fallbacks: 0,
  errors: 0,
};

/** 简易事件记录（落 applications.jsonl，PRD §13.7） */
const events: ApplicationRecord[] = [];
export function getEvents(): ApplicationRecord[] { return events; }
function logEvent(event: ApplicationRecord['event'], payload: Record<string, unknown>) {
  const jid = typeof payload.job_id === 'string' ? payload.job_id : '';
  events.push({ ts: new Date().toISOString(), event, job_id: jid, payload });
}

/** 按端点返回对应 key（主=TokenRhythm，兜底=DeepSeek 直连） */
function apiKey(endpoint: string): string {
  const name = endpoint === ENDPOINTS.ds ? 'DEEPSEEK_API_KEY'
    : endpoint === ENDPOINTS.go ? 'OPENCODE_GO_API_KEY'
    : 'TOKENRHYTHM_API_KEY';
  const k = process.env[name];
  if (!k) throw new Error(`${name} 未设置（检查 .env / 环境变量）`);
  return k;
}

/** 模型 → 端点 路由（三端点核心逻辑：TR 主 → go 兜底1 → DS 兜底2） */
export function endpointFor(model: string): string {
  if (model === MODELS.fallback1) return ENDPOINTS.go;
  if (model === MODELS.fallback2) return ENDPOINTS.ds;
  return ENDPOINTS.tr;
}

/** 解析 response JSON（兼容 reasoning 模型返回） */
function extractText(data: unknown): { text: string; usage?: LLMResult['usage'] } {
  const d = data as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const content = d.choices?.[0]?.message?.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    // 部分模型返回 content 数组（含 reasoning_content）
    text = content.map((c) => {
      const item = c as { type?: string; text?: string };
      return item.type === 'text' || typeof item.text === 'string' ? (item.text ?? '') : '';
    }).join('');
  }
  const u = d.usage;
  const usage = u ? { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 } : undefined;
  return { text, usage };
}

async function doCall(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: LLMCallOptions,
): Promise<LLMResult> {
  const endpoint = endpointFor(model);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    // opencode.ai 有 Cloudflare 拦截，必须带浏览器 UA（否则 403/1010）
    const ua = endpoint === ENDPOINTS.go
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      : 'ai-job-hunter/1.0';
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey(endpoint)}`,
        'Content-Type': 'application/json',
        'User-Agent': ua,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.extra ?? {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    const data = await res.json() as unknown;
    const { text, usage } = extractText(data);
    const tookMs = Date.now() - started;

    // token 统计
    if (usage) {
      stats.tokens.prompt += usage.prompt;
      stats.tokens.completion += usage.completion;
      stats.tokens.total += usage.total;
    }

    return { text, model, endpoint, usage, tookMs };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 统一入口。T1/T2 正常调用；失败按 flash → flash-free → mimo-free 兜底（PRD §7）。
 * 同层重试（网络/5xx）→ 跨层降级（模型切换）两层分离（P6 工程约定）。
 */
export async function call(
  tier: Tier,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: LLMCallOptions = {},
): Promise<LLMResult> {
  const primary = MODELS[tier];
  const fallbacks = [MODELS.fallback1, MODELS.fallback2];
  const retries = opts.retries ?? 2;
  const chain: string[] = [];
  let lastErr: Error | undefined;

  stats.calls++;

  // 1) 主模型 + 同层重试（仅对可重试错误：网络/5xx/超时；4xx 不重试直接降级）
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await doCall(primary, messages, opts);
      if (chain.length > 0) result.fallbackChain = chain;
      logEvent('scored', { job_id: '', model: result.model, endpoint: result.endpoint });
      return result;
    } catch (e) {
      lastErr = e as Error;
      const status = (e as Error & { status?: number }).status;
      // 429 = 限流（RPM/TPM/账号级），退避重试；5xx 网络类也重试；4xx 不重试直接降级
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable) break;
      if (attempt < retries) {
        // 429 用指数退避（3s→6s→12s），其余 500ms 递增
        const base = status === 429 ? 3000 : 500;
        await sleep(base * (attempt + 1));
        continue;
      }
    }
  }

  // 2) 跨层降级：flash-free → mimo-free（仅 zen 端点）
  for (const fb of fallbacks) {
    try {
      chain.push(fb);
      const result = await doCall(fb, messages, { ...opts, timeoutMs: opts.timeoutMs ?? 45_000 });
      stats.fallbacks++;
      result.fallbackChain = [...chain];
      logEvent('scored', { job_id: '', model: result.model, endpoint: result.endpoint, degraded: true });
      return result;
    } catch (e) {
      lastErr = e as Error;
    }
  }

  stats.errors++;
  stats.lastError = lastErr?.message;
  throw new Error(`LLM 全部降级失败（${tier}）: ${lastErr?.message ?? '未知错误'}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 便捷：JSON 模式调用并解析 */
export async function callJSON<T>(
  tier: Tier,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: LLMCallOptions = {},
): Promise<T> {
  const result = await call(tier, messages, { ...opts, jsonMode: true });
  try {
    // 容忍 ```json 包裹
    const cleaned = result.text.trim().replace(/^```json\s*/i, '').replace(/```$/m, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`LLM JSON 解析失败，原文: ${result.text.slice(0, 300)}`);
  }
}
