import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackage, humanReview, canSubmit, enqueue, pendingPackages } from '../lib/package.ts';
import type { Job, ScoreResult } from '../shared/schema.ts';

function mkScore(score = 3.5): ScoreResult {
  return {
    score,
    subscores: { s1: 3, s2: 3, s3: 4, s4: 3, s5: 3, s6: 3, s7: 5, s8: 3 },
    flags: [],
    passed: 'pass',
    reasons: ['test'],
    meta: { salary_net: 5000, location_ok: true, model: 'test', scored_at: new Date().toISOString() },
  };
}

const job: Job = {
  id: 'boss-01', title: '售前项目经理', company: '测试公司', industry: '教育',
  salary_text: '6-9K', location: '丽水', remote: false, job_description: 'JD',
};

test('构建投递包: 初始为 pending', () => {
  const pkg = buildPackage({ job, resumeDocx: 'a.docx', resumePdf: 'a.pdf', greeting: '您好', score: mkScore() });
  assert.equal(pkg.human_review.status, 'pending');
  assert.ok(pkg.package_id);
  assert.equal(pkg.job_id, 'boss-01');
});

test('人审门禁: 未确认不能投递', () => {
  const pkg = buildPackage({ job, resumeDocx: 'a.docx', resumePdf: 'a.pdf', greeting: '您好', score: mkScore() });
  assert.equal(canSubmit(pkg), false);
});

test('人审门禁: approved 后可投递，rejected 不可', () => {
  const pkg = buildPackage({ job, resumeDocx: 'a.docx', resumePdf: 'a.pdf', greeting: '您好', score: mkScore() });
  const ok = humanReview(pkg, 'approved');
  assert.equal(canSubmit(ok), true);
  assert.ok(ok.human_review.approved_at);

  const no = humanReview(pkg, 'rejected');
  assert.equal(canSubmit(no), false);
});

test('队列: 待审列表只含 pending', () => {
  const p1 = buildPackage({ job, resumeDocx: 'a.docx', resumePdf: 'a.pdf', greeting: 'hi', score: mkScore() });
  const p2 = buildPackage({ job, resumeDocx: 'b.docx', resumePdf: 'b.pdf', greeting: 'hi', score: mkScore() });
  enqueue(p1);
  enqueue(humanReview(p2, 'approved'));
  const pending = pendingPackages();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.package_id, p1.package_id);
});
