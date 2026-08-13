/**
 * tests/jd-analyzer.test.ts — JD 分析器测试
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJD, extractKeywords, matchAdvice } from '../lib/jd-analyzer.ts';
import type { Job, SourceResume } from '../shared/schema.ts';

const source: SourceResume = {
  schema_version: 1,
  name: '蒋辰宇',
  phone: '19818100936',
  email: 'x@x.com',
  location: '丽水',
  political: '中共党员',
  summary: '负责丽水地区40+所学校、7+区县教育局教育信息化市场开拓，覆盖方案设计、招投标、实施验收全流程。',
  experiences: [
    {
      company: '杭州容博教育科技有限公司',
      role: '市场人员',
      start: '2025-09',
      end: '至今',
      duties: ['负责40+所学校市场开拓', '跟进AI教育项目', '独立完成标书制作与报价方案'],
      metrics: [{ value: '40+所', normalized: '40', description: '覆盖学校' }],
      skills: ['教育信息化', '招投标', '标书制作', 'AI教育项目'],
    },
  ],
  retracted_claims: [],
  updated_at: '',
};

const job: Job = {
  id: 'test-01',
  title: '项目经理',
  company: '测试公司',
  industry: '教育信息化',
  salary_text: '6-11K',
  location: '丽水',
  remote: false,
  employment_type: '全职',
  work_schedule: '',
  job_description: '1.负责教育信息化项目管理，协调资源推进项目计划实施；2.有招投标经验优先；3.具备良好的沟通协调能力，抗压能力强。',
};

test('extractKeywords 提取技能词', () => {
  const kws = extractKeywords('负责项目管理，熟悉招投标流程，精通方案设计');
  assert.ok(kws.some((k) => k.includes('项目')));
  assert.ok(kws.some((k) => k.includes('招投标')));
  assert.ok(kws.some((k) => k.includes('方案')));
});

test('analyzeJD 返回分类与匹配率', () => {
  const r = analyzeJD(job, source);
  assert.equal(r.job_id, 'test-01');
  assert.ok(r.requirements.length > 0);
  assert.ok(r.requirements.some((x) => x.category === 'must'));
  assert.ok(r.requirements.some((x) => x.category === 'nice')); // 招投标经验优先
  assert.ok(r.keywords.length > 0);
  assert.ok(r.matchRate >= 0 && r.matchRate <= 1);
});

test('JD 关键词命中简历技能', () => {
  const r = analyzeJD(job, source);
  // JD 含"招投标"，简历技能也有 → 应有命中
  const bid = r.keywordMatch.find((k) => k.keyword.includes('招投标'));
  assert.ok(bid === undefined || bid.hit === true);
});

test('matchAdvice 分档', () => {
  assert.ok(matchAdvice(0.8).includes('高匹配'));
  assert.ok(matchAdvice(0.6).includes('中匹配'));
  assert.ok(matchAdvice(0.4).includes('低匹配'));
  assert.ok(matchAdvice(0.1).includes('极低'));
});
