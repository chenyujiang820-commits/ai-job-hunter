/**
 * lib/package.ts — 投递包构建 + 人审门禁（PRD R5 / T7）
 *
 * 第三道防线（人审）：所有投递包必须先经老板确认，未确认绝不进入投递队列。
 * M1 只产出包，不发送（交互层 M2 才实现投递）。
 */
import { randomUUID } from 'node:crypto';
import type { ApplicationPackage, Job, ScoreResult } from '../shared/schema.ts';

export interface BuildPackageInput {
  job: Job;
  resumeDocx: string;      // 人审版 docx 路径
  resumePdf: string;       // 投递版 pdf 路径
  greeting: string;        // 招呼语
  score: ScoreResult;
}

/** 构建投递包（status 恒为 pending，等待人审） */
export function buildPackage(input: BuildPackageInput): ApplicationPackage {
  return {
    package_id: randomUUID(),
    job_id: input.job.id,
    job_snapshot: input.job,
    resume_paths: { docx: input.resumeDocx, pdf: input.resumePdf },
    greeting: input.greeting,
    score: input.score,
    human_review: { status: 'pending' },
    created_at: new Date().toISOString(),
  };
}

/**
 * 人审门禁：老板确认/拒绝。
 * 只有 approved 的包才允许进入投递队列（M2 消费）。
 */
export function humanReview(
  pkg: ApplicationPackage,
  decision: 'approved' | 'rejected',
  reviewer: string = '老板',
): ApplicationPackage {
  const updated: ApplicationPackage = {
    ...pkg,
    human_review: {
      status: decision,
      approved_at: decision === 'approved' ? new Date().toISOString() : undefined,
      reviewed_by: reviewer,
    },
  };
  return updated;
}

/** 是否允许进入投递队列 */
export function canSubmit(pkg: ApplicationPackage): boolean {
  return pkg.human_review.status === 'approved';
}

/** 待审队列（M1 内存版；M2 落 JSONL） */
const queue: ApplicationPackage[] = [];

export function enqueue(pkg: ApplicationPackage): void {
  queue.push(pkg);
}
export function pendingPackages(): ApplicationPackage[] {
  return queue.filter((p) => p.human_review.status === 'pending');
}
