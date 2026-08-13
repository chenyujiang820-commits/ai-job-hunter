/**
 * lib/template.ts — 简历模板渲染（PRD R4 / T6）
 *
 * M1 降级：先做纯文本/HTML 版（ATS 可解析优先），docx 渲染在 M2 前补齐（libreoffice）。
 * 输出：
 *  - plain text：用于 ATS 校验、人审快速阅读
 *  - HTML：可另存/打印
 */
import type { SourceResume } from '../shared/schema.ts';
import type { DraftedSection } from './draft.ts';

export interface RenderedResume {
  text: string;
  html: string;
  /** 文本版字段完整性检查结果 */
  atsCheck: { missing: string[]; ok: boolean };
}

/** 渲染纯文本版简历 */
export function renderText(source: SourceResume, sections: DraftedSection[]): string {
  const parts: string[] = [];
  parts.push(`${source.name} ｜ ${source.phone} ｜ ${source.email} ｜ ${source.location}`);
  parts.push('='.repeat(40));

  for (const s of sections) {
    const prefix = s.section === 'experience' ? '经历｜' : '';
    parts.push(`【${prefix}${s.title}】`);
    s.lines.forEach((l) => parts.push(`- ${l}`));
    parts.push('');
  }

  // 教育（若 drafter 未包含则从 source 兜底）
  const edu = source.experiences.find((e) => e.education);
  if (edu?.education) {
    const ed = edu.education;
    parts.push('【教育背景】');
    parts.push(`- ${ed.school} ｜ ${ed.degree} ｜ ${ed.major} ｜ ${ed.period}${ed.gpa ? ` ｜ GPA ${ed.gpa}` : ''}`);
    if (ed.honors.length) parts.push(`- 荣誉：${ed.honors.join('；')}`);
  }
  return parts.join('\n');
}

/** 渲染 HTML 版（简单可打印） */
export function renderHtml(source: SourceResume, sections: DraftedSection[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = sections
    .map(
      (s) =>
        `<h3>${esc(s.title)}</h3><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
    )
    .join('');
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${esc(source.name)} - 简历</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;max-width:800px;margin:20px auto;line-height:1.6}h1{color:#2f5597}ul{margin:4px 0}</style>
</head><body><h1>${esc(source.name)}</h1><p>${esc(source.phone)} ｜ ${esc(source.email)} ｜ ${esc(source.location)}</p>${body}</body></html>`;
}

/** ATS 字段完整性校验：检查实际值（姓名/电话/邮箱/教育/经历/技能）是否出现在文本中 */
/**
 * ATS 兼容性检查（增强版，吸收 ResumeSkills/ats-optimizer 方法论）
 * 检查内容：必填字段 + 标准章节名 + 日期格式一致性 + 数字量化存在性
 */
export function atsCheck(text: string, source?: SourceResume): { missing: string[]; warnings: string[]; ok: boolean } {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (source) {
    if (source.name && !text.includes(source.name)) missing.push('姓名');
    if (source.phone && !text.includes(source.phone)) missing.push('电话');
    if (source.email && !text.includes(source.email)) missing.push('邮箱');
  }
  // 标准章节名（ATS 可识别的标题，而非花哨别名）
  const stdSections: Array<[string, string[]]> = [
    ['教育', ['教育', '教育背景', 'Education']],
    ['经历', ['经历', '工作经历', '项目经历', 'Experience']],
    ['技能', ['技能', 'Skills']],
    ['总结', ['总结', '个人总结', 'Summary', 'Professional Summary']],
  ];
  for (const [label, aliases] of stdSections) {
    if (!aliases.some((a) => text.includes(a))) missing.push(label);
  }
  // 日期格式一致性：MM/YYYY 或 YYYY-MM 风格，不能混用
  const yyyyMm = (text.match(/\d{4}-\d{2}/g) ?? []).length;
  const slashFmt = (text.match(/\d{4}\/\d{1,2}/g) ?? []).length;
  const dotFmt = (text.match(/\d{4}\.\d{1,2}/g) ?? []).length;
  const formats = [yyyyMm, slashFmt, dotFmt].filter((n) => n > 0);
  if (formats.length > 1) warnings.push('日期格式混用（YYYY-MM 与 YYYY/MM 或 YYYY.MM 并存），ATS 解析可能错乱');
  if (formats.length === 0) warnings.push('未检测到标准日期格式（建议 YYYY-MM 或 YYYY/MM）');
  // 量化存在性：简历正文至少出现 1 个数字（金额/数量/百分比）
  const numbers = (text.match(/\d+(?:\.\d+)?\s*(?:万|%|家|所|户|次|个|年|K)/g) ?? []).length;
  if (numbers === 0) warnings.push('正文未检测到量化数字（金额/数量/百分比），建议补充指标增强说服力');
  // 标准项目符号
  if (!text.includes('•') && !text.includes('- ')) warnings.push('未检测到标准项目符号（• 或 -），建议使用统一 bullet');
  return { missing, warnings, ok: missing.length === 0 };
}

/** 统一渲染入口 */
export function render(source: SourceResume, sections: DraftedSection[]): RenderedResume {
  const text = renderText(source, sections);
  return {
    text,
    html: renderHtml(source, sections),
    atsCheck: atsCheck(text, source),
  };
}
