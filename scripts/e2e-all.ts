/**
 * scripts/e2e-all.ts — 验证集全量端到端跑批（Task 11）
 * 每个岗位：评分 → (pass/review) 起草 → 护栏 → 终检 → 投递包
 * fail 岗位：跳过简历（不进投递池，PRD §14.1）
 * 限流纪律：LLM 调用间间隔 15s（免费档 RPM 3-5）
 * 用法: node --experimental-strip-types scripts/e2e-all.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftResume } from '../lib/draft.ts';
import { guardrail } from '../lib/guardrail.ts';
import { reviewResume } from '../lib/review.ts';
import { scoreJob } from '../lib/score.ts';
import { buildPackage, enqueue, humanReview } from '../lib/package.ts';
import { resumeTxtToPdf } from '../lib/pdf.ts';
import { render } from '../lib/template.ts';
import { DEFAULT_PROFILE } from '../data/profile.schema.ts';

// 安全读取 key
const envPath = resolve(process.env['USERPROFILE'] ?? 'C:/Users/15050', 'AppData/Local/hermes/profiles/atlas/.env');
const envRaw = readFileSync(envPath, 'utf-8');
const trMatch = envRaw.match(/^TOKENRHYTHM_API_KEY=(.+)$/m);
if (!trMatch) { console.error('❌ 无 TOKENRHYTHM_API_KEY'); process.exit(1); }
process.env['TOKENRHYTHM_API_KEY'] = trMatch[1].trim();
const dsMatch = envRaw.match(/^DEEPSEEK_API_KEY=(.+)$/m);
if (dsMatch) process.env['DEEPSEEK_API_KEY'] = dsMatch[1].trim();
const goMatch = envRaw.match(/^OPENCODE_GO_API_KEY=(.+)$/m);
if (goMatch) process.env['OPENCODE_GO_API_KEY'] = goMatch[1].trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const source = JSON.parse(readFileSync(resolve('data/source_resume.json'), 'utf-8'));
const jobs = JSON.parse(readFileSync(resolve('data/jobs/validation/jobs-2026-08-12.json'), 'utf-8')).jobs;
const profile = structuredClone(DEFAULT_PROFILE);
profile.preferences.min_net_salary = 5000;
profile.preferences.target_net_salary = 6000;
// 地点可临时放宽：LOCATIONS 环境变量（逗号分隔），默认丽水；如 LOCATIONS=丽水,杭州
profile.preferences.locations = (process.env['LOCATIONS'] ?? '丽水').split(',').map((s) => s.trim());

const results: Array<Record<string, string>> = [];
let llmCalls = 0;

for (const job of jobs) {
  console.log(`\n${'='.repeat(66)}`);
  console.log(`▶ ${job.id}｜${job.title}｜${job.company}`);
  console.log('='.repeat(66));

  // 步骤0: 评分（纯规则，不耗 LLM）
  const score = scoreJob(job, profile);
  console.log(`[评分] ${score.score} 分 | ${score.passed.toUpperCase()}${score.flags.length ? ` | flags: ${score.flags.join(',')}` : ''}`);

  if (score.passed === 'fail') {
    console.log('⏭  fail → 跳过简历生成（不进投递池）');
    results.push({ id: job.id, title: job.title, score: String(score.score), verdict: 'FAIL(跳过)', guardrail: '-', review: '-', pkg: '-' });
    continue;
  }

  // 步骤1: 起草（T1）
  console.log('[起草] T1 Flash 生成中...');
  const draft = await draftResume(source, job);
  llmCalls++;
  console.log(`  ✅ ${draft.sections.length} 章节`);

  await sleep(15_000); // 限流间隔

  // 步骤2: 护栏
  const gr = guardrail(source, draft.sections, job.id);
  console.log(`[护栏] ${gr.summary}`);
  console.log(`  判定: ${gr.verdict.toUpperCase()}`);
  if (gr.hard_failures.length) {
    gr.hard_failures.forEach((f) => console.log(`  ⚠️ ${f.line.slice(0, 50)} → ${f.reason}`));
  }

  // 步骤3: 终检（T2）— 护栏 reject 也跑（收集完整反馈），但标记
  await sleep(15_000);
  console.log('[终检] T2 Pro 审查中...');
  const rv = await reviewResume(job, draft.sections, gr.summary);
  llmCalls++;
  console.log(`  ✅ ${rv.verdict.toUpperCase()} | ${rv.summary.slice(0, 80)}`);

  // 步骤4: 投递包（仅护栏通过才打包，reject 记录原因）
  let pkgStatus = '-';
  if (gr.verdict !== 'reject') {
    const { text } = render(source, draft.sections);
    const txtPath = resolve(`data/out/${job.id}-resume.txt`);
    writeFileSync(txtPath, text, 'utf-8');
    // 自动生成 PDF（投递包闭环）
    const pdf = resumeTxtToPdf(txtPath, undefined, `定制岗位：${job.id}`);
    const pkg = buildPackage({
      job,
      resumeDocx: `data/out/${job.id}-resume.docx`,
      resumePdf: pdf.ok ? pdf.pdfPath : `data/out/${job.id}-resume.pdf`,
      greeting: '您好，看到贵司岗位，冒昧自荐，盼沟通。',
      score,
    });
    enqueue(pkg);
    pkgStatus = 'pending(待人审)';
    // 落盘简历文本（人审用）
    console.log(`[投递包] ✅ ${pkg.package_id.slice(0, 8)} | ${pkgStatus} | ${pdf.ok ? '简历txt+PDF已存 data/out/' : 'PDF生成失败(仅txt)'}`);
  } else {
    console.log(`[投递包] ⛔ 护栏 REJECT，未打包（原因: ${gr.hard_failures.map((f) => f.reason).join('; ')})`);
  }

  results.push({
    id: job.id, title: job.title, score: String(score.score), verdict: score.passed.toUpperCase(),
    guardrail: gr.verdict.toUpperCase(), review: rv.verdict.toUpperCase(), pkg: pkgStatus,
  });

  await sleep(15_000); // 岗位间间隔
}

// 汇总
console.log(`\n\n${'═'.repeat(66)}`);
console.log('📊 验证集全量跑批汇总');
console.log('═'.repeat(66));
console.log('岗位 | 评分 | 判定 | 护栏 | 终检 | 投递包');
results.forEach((r) => {
  console.log(`${r.id} ${r.title.slice(0, 12)} | ${r.score} | ${r.verdict} | ${r.guardrail} | ${r.review} | ${r.pkg}`);
});
console.log(`\nLLM 调用次数: ${llmCalls}（限流间隔已遵守）`);

// 存结果
writeFileSync(resolve('data/out/e2e-all-results.json'), JSON.stringify(results, null, 2), 'utf-8');
console.log('结果已存: data/out/e2e-all-results.json');
