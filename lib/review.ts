/**
 * lib/review.ts — 简历 reviewer（PRD R4 / T5）
 *
 * T2 Pro 终检：对 drafter 产出 + 护栏结果做最后审查。
 * 关注：夸大风险、贴 JD 度、结构完整性。输出 issues[] + verdict。
 */
import { callJSON } from './llm.ts';
import type { Job } from '../shared/schema.ts';

export interface ReviewIssue {
  severity: 'error' | 'warn' | 'info';
  section?: string;
  text: string;
}

export interface ReviewResult {
  job_id: string;
  issues: ReviewIssue[];
  verdict: 'pass' | 'fix' | 'rewrite';
  summary: string;
}

const SYSTEM_PROMPT = `你是严格的简历终审官。审查要点：
1. 夸大风险：是否有"精通/主导/负责全部"等超出事实的表述（特别是把"项目成员"夸大为"主导"）。
2. 贴 JD 度：简历是否回应了 JD 的核心要求；没回应的关键点要提示。
3. 结构完整性：个人总结/经历/技能/教育是否齐全。
4. 数字合理性：金额/数量是否看起来自洽（明显矛盾要标 error）。
输出严格 JSON：{"issues":[{"severity":"error|warn|info","section":"章节","text":"问题"}],"verdict":"pass|fix|rewrite","summary":"一句话总结"}
- error → rewrite；warn → fix；无问题 → pass
- verdict 必须与 issues 严重度一致`;

export async function reviewResume(
  job: Job,
  draftSections: Array<{ section: string; title: string; lines: string[] }>,
  guardrailSummary: string,
): Promise<ReviewResult> {
  const resumeText = draftSections
    .map((s) => `【${s.title}】\n${s.lines.map((l) => `- ${l}`).join('\n')}`)
    .join('\n\n');

  const out = await callJSON<ReviewResult>('T2', [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【岗位】${job.title} @ ${job.company}（${job.industry}）\n【JD】${job.job_description}\n\n【护栏摘要】${guardrailSummary}\n\n【简历草稿】\n${resumeText}`,
    },
  ], { temperature: 0.2 });

  return { job_id: job.id, issues: out.issues, verdict: out.verdict, summary: out.summary };
}
