/**
 * tests/pdf.test.ts — 简历 PDF 生成模块测试
 * 验证：① 教育背景去重 ② 章节解析 ③ 浏览器探测 ④ 端到端 PDF 生成（跳过无浏览器环境）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dedupeEducation, parseSections, findBrowser, resumeTxtToPdf } from '../lib/pdf.ts';

const SAMPLE = `蒋辰宇 ｜ 19818100936 ｜ x@x.com ｜ 丽水
========================================
【个人总结】
- 通信工程专业毕业
【教育背景】
- 中国计量大学现代科技学院 | 通信工程 | 本科
【教育背景】
- 中国计量大学现代科技学院 ｜ 本科 ｜ 通信工程
- 荣誉：省政府奖学金；大唐杯省二等奖
【技能】
- 通信、项目管理`;

test('dedupeEducation: 保留第二个教育背景（含荣誉）', () => {
  const out = dedupeEducation(SAMPLE);
  assert.equal(out.split('【教育背景】').length - 1, 1, '教育背景只应出现一次');
  assert.ok(out.includes('省政府奖学金'), '应保留荣誉行');
  assert.ok(out.includes('中国计量大学现代科技学院 ｜ 本科 ｜ 通信工程'), '应保留详细版');
});

test('parseSections: 正确拆分章节（原始文本保留重复，去重后合并）', () => {
  const sections = parseSections(SAMPLE);
  // 原始文本有两个教育背景 → 解析保留
  assert.equal(sections.filter((s) => s.title === '教育背景').length, 2);
  assert.equal(sections[0]?.title, '个人总结');
  assert.equal(sections[0]?.lines.length, 1);
  // 去重后再解析 → 只剩一个
  const deduped = parseSections(dedupeEducation(SAMPLE));
  assert.equal(deduped.filter((s) => s.title === '教育背景').length, 1);
  assert.equal(deduped.filter((s) => s.title === '教育背景')[0]?.lines.length, 2);
});

test('findBrowser: 探测到浏览器（Windows Edge 或 Chromium）', () => {
  const b = findBrowser();
  // 本机应有 Edge；若无则跳过（如无头 CI）
  if (b === null) {
    console.log('⚠️ 未检测到浏览器，跳过 PDF 端到端测试');
    return;
  }
  assert.ok(b.length > 0);
});

test('resumeTxtToPdf: 端到端生成 PDF（若浏览器可用）', () => {
  const browser = findBrowser();
  if (browser === null) {
    console.log('⚠️ 无浏览器，跳过端到端 PDF 测试');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'aijh-'));
  const txtPath = join(dir, 'test-resume.txt');
  writeFileSync(txtPath, SAMPLE, 'utf-8');
  const r = resumeTxtToPdf(txtPath, dir, '测试标签');
  assert.equal(r.ok, true, r.error ?? '');
  assert.ok(existsSync(r.pdfPath), 'PDF 文件应存在');
  assert.ok(existsSync(r.htmlPath), 'HTML 文件应存在');
});
