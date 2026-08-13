/**
 * scripts/e2e-one.ts — 重跑单岗位端到端（验证护栏修复）
 * 用法: node --experimental-strip-types scripts/e2e-one.ts <job-id>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftResume } from '../lib/draft.ts';
import { guardrail } from '../lib/guardrail.ts';
import { reviewResume } from '../lib/review.ts';
import { scoreJob } from '../lib/score.ts';
import { analyzeJD, matchAdvice } from '../lib/jd-analyzer.ts';
import { buildPackage, enqueue } from '../lib/package.ts';
import { resumeTxtToPdf, dedupeEducation, parseSections } from '../lib/pdf.ts';
import { render } from '../lib/template.ts';
import { DEFAULT_PROFILE } from '../data/profile.schema.ts';

const envPath = resolve(process.env['USERPROFILE'] ?? 'C:/Users/15050', 'AppData/Local/hermes/profiles/atlas/.env');
const envRaw = readFileSync(envPath, 'utf-8');
// 2026-08-12 订阅变更：主=TokenRhythm，兜底1=DeepSeek 直连，兜底2=opencode-go（未过期，需浏览器UA）
const trMatch = envRaw.match(/^TOKENRHYTHM_API_KEY=(.+)$/m);
if (!trMatch) { console.error('❌ 无 TOKENRHYTHM_API_KEY'); process.exit(1); }
process.env['TOKENRHYTHM_API_KEY'] = trMatch[1].trim();
const dsMatch = envRaw.match(/^DEEPSEEK_API_KEY=(.+)$/m);
if (dsMatch) process.env['DEEPSEEK_API_KEY'] = dsMatch[1].trim();
const goMatch = envRaw.match(/^OPENCODE_GO_API_KEY=(.+)$/m);
if (goMatch) process.env['OPENCODE_GO_API_KEY'] = goMatch[1].trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jobId = process.argv[2] ?? 'boss-02';
const source = JSON.parse(readFileSync(resolve('data/source_resume.json'), 'utf-8'));
const jobs = JSON.parse(readFileSync(resolve('data/jobs/validation/jobs-2026-08-12.json'), 'utf-8')).jobs;
const job = jobs.find((j: { id: string }) => j.id === jobId);
if (!job) { console.error(`❌ 找不到岗位 ${jobId}`); process.exit(1); }

console.log(`▶ ${job.id}｜${job.title}`);
const profile = structuredClone(DEFAULT_PROFILE);
profile.preferences.min_net_salary = 5000;
profile.preferences.target_net_salary = 6000;
// 地点可临时放宽：LOCATIONS 环境变量（逗号分隔），默认丽水；如 LOCATIONS=丽水,杭州
profile.preferences.locations = (process.env['LOCATIONS'] ?? '丽水').split(',').map((s) => s.trim());
const score = scoreJob(job, profile);
console.log(`[评分] ${score.score} | ${score.passed}`);

// JD 匹配度分析（ResumeSkills 方法论增强）
const jda = analyzeJD(job, source);
console.log(`[JD分析] 关键词 ${jda.keywords.length} 个，命中 ${jda.keywordMatch.filter((k) => k.hit).length} 个，匹配率 ${(jda.matchRate * 100).toFixed(0)}%`);
console.log(`  建议: ${matchAdvice(jda.matchRate)}`);
if (jda.gaps.length > 0) console.log(`  短板(诚实带过): ${jda.gaps.slice(0, 5).join('、')}`);

const draft = await draftResume(source, job, (job as { honest_constraints?: string[] }).honest_constraints ?? []);
console.log('[起草] ✅', draft.sections.length, '章节');
await sleep(15_000);

const gr = guardrail(source, draft.sections, job.id);
console.log(`[护栏] ${gr.summary}`);
console.log(`  判定: ${gr.verdict.toUpperCase()}`);
gr.hard_failures.forEach((f) => console.log(`  ⚠️ ${f.line.slice(0, 60)} → ${f.reason}`));
gr.checks.filter((c) => c.verdict === 'pass' && c.kind === 'hard').forEach((c) => console.log(`  ✅ ${c.line.slice(0, 50)}`));

await sleep(15_000);
const rv = await reviewResume(job, draft.sections, gr.summary);
console.log(`[终检] ${rv.verdict.toUpperCase()} | ${rv.summary.slice(0, 90)}`);

if (gr.verdict !== 'reject') {
  const { text } = render(source, draft.sections);
  const txtPath = resolve(`data/out/${job.id}-resume.txt`);
  writeFileSync(txtPath, text, 'utf-8');
  // 投递包闭环 A：txt → PDF（去重教育背景）
  const label = (job as { honest_constraints?: string[] }).honest_constraints ? '诚实版（如实标注角色）' : undefined;
  const pdf = resumeTxtToPdf(txtPath, undefined, label ? `定制岗位：${job.id}｜诚实版` : `定制岗位：${job.id}`);
  if (pdf.ok) {
    console.log(`[PDF] ✅ ${pdf.pdfPath}`);
  } else {
    console.log(`[PDF] ⚠️ 生成失败: ${pdf.error ?? '未知错误'}（投递包用 txt 占位）`);
  }
  const pkg = buildPackage({ job, resumeDocx: `data/out/${job.id}-resume.docx`, resumePdf: pdf.pdfPath || `data/out/${job.id}-resume.pdf`, greeting: '您好，冒昧自荐。', score });
  enqueue(pkg);
  console.log('[投递包] ✅', pkg.package_id.slice(0, 8), '| 简历txt+PDF已更新');
}
