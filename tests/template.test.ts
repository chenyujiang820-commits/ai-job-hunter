import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, atsCheck } from '../lib/template.ts';
import type { SourceResume } from '../shared/schema.ts';
import type { DraftedSection } from '../lib/draft.ts';

const source: SourceResume = {
  schema_version: 1,
  name: '蒋辰宇',
  phone: '19818100936',
  email: 'test@163.com',
  location: '丽水',
  summary: '通信工程',
  experiences: [
    {
      company: '中国电信',
      role: '政企客户经理',
      start: '2024-05',
      end: '2025-03',
      duties: ['负责客户服务'],
      metrics: [{ value: '273.7万', normalized: '2737000', description: '总签约' }],
      skills: ['5G'],
      education: {
        school: '中国计量大学现代科技学院',
        degree: '本科',
        major: '通信工程',
        period: '2020.10-2024.06',
        gpa: '3.36/4.0',
        honors: ['省政府奖学金'],
      },
    },
  ],
  retracted_claims: [],
  updated_at: '2026-08-12T00:00:00.000Z',
};

const sections: DraftedSection[] = [
  {
    section: 'summary',
    title: '个人总结',
    lines: ['通信工程专业，有政企服务经验'],
    claims: [['exp0']],
  },
  {
    section: 'experience',
    title: '中国电信 | 政企客户经理',
    lines: ['负责企业客户通信服务，累计签约273.7万'],
    claims: [['exp0.duty0', 'exp0.metric0']],
  },
  {
    section: 'skills',
    title: '技能',
    lines: ['5G、网络安全'],
    claims: [['exp0.skills']],
  },
];

test('renderText: 包含姓名/电话/邮箱/章节', () => {
  const { text } = render(source, sections);
  assert.ok(text.includes('蒋辰宇'));
  assert.ok(text.includes('19818100936'));
  assert.ok(text.includes('个人总结'));
  assert.ok(text.includes('273.7万'));
});

test('atsCheck: 完整简历通过，缺字段则报告', () => {
  const { text } = render(source, sections);
  const ok = atsCheck(text, source);
  assert.equal(ok.ok, true);

  const bad = atsCheck('没有电话也没有邮箱的文本', source);
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.includes('电话'));
  assert.ok(bad.missing.includes('邮箱'));
});

test('atsCheck: 检测日期格式混用与量化数字缺失', () => {
  const mixed = atsCheck('经历 2024-05 到 2024.06，技能 5G', source);
  assert.ok(mixed.warnings.some((w) => w.includes('日期格式混用')));

  const noNum = atsCheck('教育背景 工作经历 技能 个人总结 无数字', source);
  assert.ok(noNum.warnings.some((w) => w.includes('量化数字')));

  const quantified = atsCheck('教育背景 工作经历 技能 个人总结 负责40+所学校、签约273.7万', source);
  assert.ok(!quantified.warnings.some((w) => w.includes('量化数字')));
});

test('renderHtml: 生成合法 HTML 骨架', () => {
  const { html } = render(source, sections);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<h1>蒋辰宇</h1>'));
  assert.ok(html.includes('</html>'));
});
