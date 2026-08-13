/**
 * scripts/diag-llm.ts — 诊断 draft 调用为何返回空
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from '../lib/llm.ts';

const envPath = resolve(process.env['USERPROFILE'] ?? 'C:/Users/15050', 'AppData/Local/hermes/profiles/atlas/.env');
const envRaw = readFileSync(envPath, 'utf-8');
const trMatch = envRaw.match(/^TOKENRHYTHM_API_KEY=(.+)$/m);
if (!trMatch) { console.error('❌ 无 TOKENRHYTHM_API_KEY'); process.exit(1); }
process.env['TOKENRHYTHM_API_KEY'] = trMatch[1].trim();
const dsMatch = envRaw.match(/^DEEPSEEK_API_KEY=(.+)$/m);
if (dsMatch) process.env['DEEPSEEK_API_KEY'] = dsMatch[1].trim();
const goMatch = envRaw.match(/^OPENCODE_GO_API_KEY=(.+)$/m);
if (goMatch) process.env['OPENCODE_GO_API_KEY'] = goMatch[1].trim();

// 1) 无 jsonMode，maxTokens 大
console.log('=== 测试1: 无 jsonMode, maxTokens=4000 ===');
try {
  const r1 = await call('T1', [
    { role: 'system', content: '你是简历优化师。只输出JSON。' },
    { role: 'user', content: '{"a":1}' },
  ], { temperature: 0.4, maxTokens: 4000 });
  console.log('text 长度:', r1.text.length);
  console.log('前200字:', JSON.stringify(r1.text.slice(0, 200)));
  console.log('usage:', JSON.stringify(r1.usage));
} catch (e) {
  console.log('❌ 失败:', (e as Error).message.slice(0, 200));
}

// 2) 带 jsonMode
console.log('\n=== 测试2: jsonMode=true, maxTokens=4000 ===');
try {
  const r2 = await call('T1', [
    { role: 'system', content: '只输出JSON。' },
    { role: 'user', content: '{"a":1}' },
  ], { temperature: 0.4, maxTokens: 4000, jsonMode: true });
  console.log('text 长度:', r2.text.length);
  console.log('前200字:', JSON.stringify(r2.text.slice(0, 200)));
  console.log('usage:', JSON.stringify(r2.usage));
} catch (e) {
  console.log('❌ 失败:', (e as Error).message.slice(0, 200));
}
