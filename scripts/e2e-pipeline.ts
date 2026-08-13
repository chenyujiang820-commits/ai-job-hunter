/**
 * scripts/e2e-pipeline.ts — M1 端到端流水线实测（Task 11 前置验证）
 * 跑一个真实岗位：起草 → 护栏 → 终检
 * 用法: node --experimental-strip-types scripts/e2e-pipeline.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftResume } from '../lib/draft.ts';
import { guardrail } from '../lib/guardrail.ts';
import { reviewResume } from '../lib/review.ts';

// 安全读取 key（从 profile .env）
const envPath = resolve(process.env['USERPROFILE'] ?? 'C:/Users/15050', 'AppData/Local/hermes/profiles/atlas/.env');
const envRaw = readFileSync(envPath, 'utf-8');
const trMatch = envRaw.match(/^TOKENRHYTHM_API_KEY=(.+)$/m);
if (!trMatch) { console.error('❌ 无 TOKENRHYTHM_API_KEY'); process.exit(1); }
process.env['TOKENRHYTHM_API_KEY'] = trMatch[1].trim();
const dsMatch = envRaw.match(/^DEEPSEEK_API_KEY=(.+)$/m);
if (dsMatch) process.env['DEEPSEEK_API_KEY'] = dsMatch[1].trim();
const goMatch = envRaw.match(/^OPENCODE_GO_API_KEY=(.+)$/m);
if (goMatch) process.env['OPENCODE_GO_API_KEY'] = goMatch[1].trim();

const source = JSON.parse(readFileSync(resolve('data/source_resume.json'), 'utf-8'));
const jobs = JSON.parse(readFileSync(resolve('data/jobs/validation/jobs-2026-08-12.json'), 'utf-8')).jobs;
const job = jobs[0]; // 售前项目经理

console.log('▶ 步骤1: T1 Flash 起草定制简历（真实 LLM）...');
const draft = await draftResume(source, job);
console.log('✅ 草稿生成:', draft.sections.length, '个章节');
for (const s of draft.sections) {
  console.log('  【' + s.title + '】');
  s.lines.forEach((l) => console.log('    - ' + l.slice(0, 60)));
}

console.log('\n▶ 步骤2: 诚实护栏逐条回源校验...');
const gr = guardrail(source, draft.sections, job.id);
console.log('✅', gr.summary);
console.log('   判定:', gr.verdict.toUpperCase());
if (gr.hard_failures.length) {
  console.log('   ⚠️ 硬失败:', gr.hard_failures.map((f) => `${f.line.slice(0, 40)} → ${f.reason}`));
}

console.log('\n▶ 步骤3: T2 Pro 终检（真实 LLM）...');
const rv = await reviewResume(job, draft.sections, gr.summary);
console.log('✅ 终检判定:', rv.verdict.toUpperCase(), '|', rv.summary);
rv.issues.forEach((i) => console.log(`   [${i.severity}] ${i.text.slice(0, 70)}`));

console.log('\n════ 端到端流水线完成 ════');
