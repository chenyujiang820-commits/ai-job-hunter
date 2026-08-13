/**
 * tests/guardrail.test.ts — 诚实护栏单元测试
 * 验证：HARD 数字回源拦截编造；SOFT 引用有效性；verdict 判定
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardrail, hardCheck, extractHardClaims } from '../lib/guardrail.ts';
import type { SourceResume } from '../shared/schema.ts';

const source: SourceResume = {
  schema_version: 1,
  name: '蒋辰宇',
  phone: '19818100936',
  email: 'test@163.com',
  location: '丽水',
  summary: '通信工程专业',
  experiences: [
    {
      company: '中国电信义乌分公司',
      role: '政企客户经理',
      start: '2024-05',
      end: '2025-03',
      duties: ['负责企业客户通信服务'],
      metrics: [
        { value: '245.8万', normalized: '2458000', description: '一期项目签约额' },
        { value: '7.9万', normalized: '79000', description: '二期增补' },
        { value: '273.7万', normalized: '2737000', description: '总签约额' },
        { value: '70余家', normalized: '70', description: '走访企业数' },
      ],
      skills: ['5G', '网络安全'],
    },
  ],
  retracted_claims: ['不得把项目成员写成项目负责人'],
  updated_at: '2026-08-12T00:00:00.000Z',
};

test('extractHardClaims: 提取数字类 claim', () => {
  const r = extractHardClaims(['累计签约245.8万，走访70余家企业']);
  assert.equal(r[0]?.numbers.length, 2);
});

test('hardCheck: source 存在的数字 → matched，编造数字 → missing', () => {
  // 真实数字
  const ok = hardCheck('项目总签约273.7万', source);
  assert.equal(ok.missing.length, 0);
  // 编造数字
  const bad = hardCheck('项目总签约500万', source);
  assert.equal(bad.missing.length, 1);
  assert.ok(bad.missing[0]?.includes('500'));
});

test('hardCheck: 约数词归一化（70余家 vs 70余家）', () => {
  const r = hardCheck('赋能走访70余家企业', source);
  assert.equal(r.missing.length, 0);
});

test('guardrail: 编造数字 → reject', () => {
  const r = guardrail(source, [
    { lines: ['项目总签约500万'], claims: [['exp0.metric0']] },
  ], 'job-x');
  assert.equal(r.verdict, 'reject');
  assert.equal(r.hard_failures.length, 1);
});

test('guardrail: 真实数字 + 有效引用 → pass', () => {
  const r = guardrail(source, [
    { lines: ['一期项目签约245.8万'], claims: [['exp0.metric0']] },
  ], 'job-x');
  assert.equal(r.verdict, 'pass');
  assert.equal(r.hard_failures.length, 0);
});

test('guardrail: 无效引用 key → review（人审）', () => {
  const r = guardrail(source, [
    { lines: ['负责企业客户通信服务'], claims: [['exp5.duty9']] }, // 不存在的 key
  ], 'job-x');
  assert.equal(r.verdict, 'review');
  assert.equal(r.soft_reviews.length, 1);
});

test('防回归: 273.9 必须被拦截（子串误判修复）', () => {
  // 273.9 不在 source（正确值 273.7）——旧实现会被 "7.9万" 子串误放行
  const r = hardCheck('共计273.9万', source);
  assert.equal(r.missing.length, 1, '273.9 应被拦截');
  // 273.7 在 source → 放行
  const ok = hardCheck('共计273.7万', source);
  assert.equal(ok.missing.length, 0, '273.7 应放行');
});

test('防回归: 245.8万 和 7.9万 各自独立匹配（不被对方包含）', () => {
  const r1 = hardCheck('一期签约245.8万', source);
  assert.equal(r1.missing.length, 0);
  const r2 = hardCheck('增补二期签约7.9万', source);
  assert.equal(r2.missing.length, 0);
  // 编造的 245.9 应拦截
  const bad = hardCheck('一期签约245.9万', source);
  assert.equal(bad.missing.length, 1);
});

test('约数容差: 70余家 匹配 70余家', () => {
  const r = hardCheck('赋能走访70余家企业', source);
  assert.equal(r.missing.length, 0);
});

test('护栏: 重复章节被标记 review', () => {
  const sections = [
    { section: 'summary', title: '个人总结', lines: ['测试'], claims: [[]] },
    { section: 'education', title: '教育背景', lines: ['学校'], claims: [['edu']] },
    { section: 'education', title: '教育背景', lines: ['学校 荣誉'], claims: [['edu']] },
  ];
  const r = guardrail(source as never, sections as never, 'test-dup');
  const dup = r.checks.find((c) => c.reason?.includes('重复章节'));
  assert.ok(dup, '应检测到重复章节');
  assert.equal(dup?.verdict, 'review');
});

// ===== 铁律1 头衔技术门禁（2026-08-13 新增）=====
import { bannedTitleCheck, BANNED_TITLES } from '../lib/guardrail.ts';

test('头衔门禁: 出现「项目经理」→ 硬失败 reject', () => {
  const r = guardrail(source, [
    { lines: ['担任项目经理，负责团队管理'], claims: [['exp0.duty0']] },
  ], 'title-bad');
  assert.equal(r.verdict, 'reject');
  const c = r.checks.find((c) => c.reason.includes('铁律1'));
  assert.ok(c, '应有铁律1 违规记录');
});

test('头衔门禁: 否定语境「未担任项目经理」→ 豁免放行（诚实表述）', () => {
  const c = bannedTitleCheck('未担任正式项目经理，但深度参与项目全流程');
  assert.equal(c.banned.length, 0);
  assert.equal(c.negated.length, 1);
});

test('头衔门禁: 合法头衔「政企客户经理」不被误禁', () => {
  const c = bannedTitleCheck('担任政企客户经理，走访70余家企业');
  assert.equal(c.banned.length, 0);
  // 全量 guardrail 应 pass（70余家 在 source）
  const r = guardrail(source, [
    { lines: ['担任政企客户经理，走访70余家企业'], claims: [['exp0.metric3']] },
  ], 'title-ok');
  assert.equal(r.verdict, 'pass');
});

test('头衔门禁: BANNED_TITLES 不含合法词根（客户经理/市场人员/项目成员）', () => {
  assert.ok(!BANNED_TITLES.includes('客户经理'));
  assert.ok(!BANNED_TITLES.includes('市场人员'));
  assert.ok(!BANNED_TITLES.includes('项目成员'));
  assert.ok(BANNED_TITLES.includes('项目经理'));
});
