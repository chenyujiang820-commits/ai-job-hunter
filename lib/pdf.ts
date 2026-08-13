/**
 * lib/pdf.ts — 简历 PDF 生成（投递包闭环 A）
 *
 * 流程：txt 文本 → 去重教育背景 → 精美 HTML → Edge 无头转 PDF
 * 依赖：Windows 版 Microsoft Edge（headless 模式），路径可配。
 * 替代：Linux/macOS 可用 chromium/google-chrome，改 EDGE_PATHS 即可。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 常见 Edge/Chromium 路径（按序探测） */
const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

/** 探测可用的浏览器二进制 */
export function findBrowser(): string | null {
  for (const p of EDGE_PATHS) {
    if (existsSync(p)) return p;
  }
  try {
    const r = execFileSync('where', ['msedge'], { encoding: 'utf-8' }).trim().split('\n')[0];
    if (r) return r;
  } catch { /* not on PATH */ }
  return null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 去重教育背景：保留第二个（含完整荣誉），跳过第一个 */
export function dedupeEducation(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let eduCount = 0;
  let skipEdu = false;
  for (const l of lines) {
    if (l.startsWith('【教育背景】')) {
      eduCount += 1;
      if (eduCount === 1) { skipEdu = true; continue; }
      skipEdu = false;
    } else if (skipEdu) {
      if (l.trim() && !l.trim().startsWith('【')) continue;
      skipEdu = false;
    }
    out.push(l);
  }
  return out.join('\n');
}

/** 解析 txt 简历 → 章节列表 [{title, lines}] */
export function parseSections(text: string): Array<{ title: string; lines: string[] }> {
  const sections: Array<{ title: string; lines: string[] }> = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('【') && l.endsWith('】')) {
      cur = { title: l.slice(1, -1), lines: [] };
      sections.push(cur);
    } else if (l.startsWith('=') || l.startsWith('蒋辰宇')) {
      cur = null;
    } else if (cur) {
      cur.lines.push(l.replace(/^[-•]\s*/, ''));
    }
  }
  return sections;
}

/** 生成简历 HTML（内联样式，打印友好） */
export function renderResumeHtml(name: string, contact: string, sections: Array<{ title: string; lines: string[] }>, badge = ''): string {
  const body = sections
    .map((s) => `<h2>${esc(s.title)}</h2><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>${esc(name)} - 简历</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:"Microsoft YaHei","PingFang SC",sans-serif; color:#2c3e50; font-size:13.5px; line-height:1.65; }
.page { max-width:820px; margin:0 auto; padding:36px 44px; }
.header { text-align:center; border-bottom:3px solid #2f5597; padding-bottom:14px; margin-bottom:18px; }
.header h1 { font-size:26px; color:#2f5597; letter-spacing:4px; }
.header .contact { color:#666; font-size:12.5px; margin-top:6px; }
.badge { display:inline-block; background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; border-radius:10px; padding:1px 10px; font-size:11px; margin-top:8px; }
h2 { font-size:15.5px; color:#2f5597; border-left:4px solid #2f5597; padding-left:8px; margin:16px 0 8px; page-break-after:avoid; }
ul { margin-left:18px; }
li { margin-bottom:3px; page-break-inside:avoid; }
.foot { text-align:center; color:#aaa; font-size:11px; margin-top:20px; border-top:1px solid #eee; padding-top:8px; }
</style></head>
<body><div class="page">
<div class="header"><h1>${esc(name)}</h1><div class="contact">${esc(contact)}</div>${badge ? `<div class="badge">${esc(badge)}</div>` : ''}</div>
${body}
<div class="foot">简历生成时间：${new Date().toISOString().slice(0, 10)}</div>
</div></body></html>`;
}

export interface PdfResult {
  htmlPath: string;
  pdfPath: string;
  ok: boolean;
  error?: string;
}

/**
 * 生成投递版 PDF（txt 简历 → PDF）
 * @param txtPath  e2e 输出的 txt 简历路径
 * @param outDir   输出目录（默认 data/out）
 * @param label    定制标签（如"定制岗位：boss-06"）
 */
export function resumeTxtToPdf(txtPath: string, outDir?: string, label?: string): PdfResult {
  const browser = findBrowser();
  if (!browser) return { htmlPath: '', pdfPath: '', ok: false, error: '未找到 Edge/Chromium，无法生成 PDF' };

  const text = readFileSync(txtPath, 'utf-8');
  const deduped = dedupeEducation(text);

  // 头部信息：取前两行（姓名 + 分隔线）
  const lines = deduped.split('\n');
  const name = lines[0]?.trim() || '简历';
  const contact = (lines[2]?.trim() || '').replace(/^=+\s*/, '');

  const sections = parseSections(deduped);
  const html = renderResumeHtml(name, contact, sections, label);

  const dir = outDir ?? resolve(process.cwd(), 'data/out');
  mkdirSync(dir, { recursive: true });
  const base = resolve(dir, txtPath.split(/[\\/]/).pop()?.replace(/\.txt$/, '') ?? 'resume');
  const htmlPath = `${base}.html`;
  const pdfPath = `${base}.pdf`;
  writeFileSync(htmlPath, html, 'utf-8');

  try {
    const url = `file:///${htmlPath.replace(/\\/g, '/')}`;
    execFileSync(browser, [
      '--headless', '--disable-gpu',
      `--print-to-pdf=${pdfPath}`,
      '--no-pdf-header-footer',
      url,
    ], { timeout: 60_000, stdio: 'ignore' });
    return { htmlPath, pdfPath, ok: existsSync(pdfPath) };
  } catch (e) {
    return { htmlPath, pdfPath, ok: false, error: (e as Error).message };
  }
}
