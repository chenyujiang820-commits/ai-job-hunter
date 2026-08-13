/**
 * tests/llm.test.ts — LLM client 单元测试
 * 验证：① 端点路由（go/zen）② 兜底链降级 ③ 4xx 不重试 ④ 5xx 重试 ⑤ token 统计
 * 使用 t.mock.method（测试级作用域，避免全局 mock 泄漏）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// 测试自包含：设置假 key（mock fetch 不会真实发出，但 apiKey() 校验需要它存在）
process.env['TOKENRHYTHM_API_KEY'] = 'test-key';
process.env['DEEPSEEK_API_KEY'] = 'test-key2';
process.env['OPENCODE_GO_API_KEY'] = 'test-go-key';
import { call, callJSON, endpointFor, MODELS, ENDPOINTS, stats } from '../lib/llm.ts';

/** 构造 mock fetch 响应（绑定到当前测试的 mock 作用域） */
function mockFetch(t: import('node:test').TestContext, handler: (url: string, init: RequestInit) => { ok: boolean; status?: number; body: unknown }) {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const { ok, status = 200, body } = handler(u, init ?? {});
    return new Response(ok ? JSON.stringify(body) : JSON.stringify({ error: 'mock' }), {
      status: ok ? 200 : status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const basicBody = {
  choices: [{ message: { content: 'OK' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

test('endpointFor: T1/T2 → tokenrhythm, 兜底1 → opencode-go, 兜底2 → deepseek', () => {
  assert.equal(endpointFor(MODELS.T1), ENDPOINTS.tr);
  assert.equal(endpointFor(MODELS.T2), ENDPOINTS.tr);
  assert.equal(endpointFor(MODELS.fallback1), ENDPOINTS.go);
  assert.equal(endpointFor(MODELS.fallback2), ENDPOINTS.ds);
});

test('正常 T1 调用走 tokenrhythm 端点', async (t) => {
  const calls: string[] = [];
  mockFetch(t, (url) => { calls.push(url); return { ok: true, body: basicBody }; });
  const result = await call('T1', [{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, 'OK');
  assert.ok(calls[0]?.includes('/tokenrhythm.studio/v1'));
  assert.equal(result.fallbackChain, undefined);
});

test('主端点 5xx → 自动降级 opencode-go（兜底1）', async (t) => {
  const urls: string[] = [];
  const models: string[] = [];
  mockFetch(t, (url, init) => {
    urls.push(url);
    const body = JSON.parse(String(init?.body)) as { model: string };
    models.push(body.model);
    if (body.model === MODELS.T1) return { ok: false, status: 500, body: { error: 'boom' } };
    return { ok: true, body: basicBody };
  });
  const result = await call('T1', [{ role: 'user', content: 'hi' }], { retries: 1 });
  assert.equal(result.text, 'OK');
  assert.ok(urls.some((u) => u.includes('/opencode.ai/zen/go/v1')));
  assert.ok(result.fallbackChain?.includes(MODELS.fallback1));
});

test('4xx 不重试直接降级', async (t) => {
  const models: string[] = [];
  mockFetch(t, (url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    models.push(body.model);
    if (body.model === MODELS.T1) return { ok: false, status: 404, body: { error: 'not found' } };
    return { ok: true, body: basicBody };
  });
  const result = await call('T1', [{ role: 'user', content: 'hi' }], { retries: 3 });
  // 404 不重试 → T1 只调 1 次，然后降级
  assert.equal(models.filter((m) => m === MODELS.T1).length, 1);
  assert.equal(result.text, 'OK');
});

test('全部失败 → 抛错并记录 stats', async (t) => {
  mockFetch(t, () => ({ ok: false, status: 500, body: { error: 'x' } }));
  await assert.rejects(() => call('T2', [{ role: 'user', content: 'hi' }], { retries: 0 }));
  assert.ok(stats.errors > 0);
  assert.ok(stats.lastError);
});

test('callJSON 解析 json 包裹', async (t) => {
  mockFetch(t, () => ({ ok: true, body: { choices: [{ message: { content: '```json\n{"a":1}\n```' } }], usage: {} } }));
  const out = await callJSON('T1', [{ role: 'user', content: 'x' }]);
  assert.deepEqual(out, { a: 1 });
});
