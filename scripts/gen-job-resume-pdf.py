#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""将 e2e 生成的岗位定制简历 txt → 去重教育背景 → 精美 HTML → PDF
用法: python scripts/gen-job-resume-pdf.py <job-id>
"""
import sys, io, html, os, subprocess, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
# 项目根目录 = 脚本所在目录的上一级（不再硬编码绝对路径，可移植）
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
job_id = sys.argv[1] if len(sys.argv) > 1 else "boss-06"
txt_path = os.path.join(BASE, "data/out", f"{job_id}-resume.txt")
with open(txt_path, encoding="utf-8") as f:
    text = f.read()

# 去重教育背景：保留第二个（含完整荣誉），跳过第一个
lines = text.split("\n")
deduped = []
edu_count = 0
skip_edu = False
for l in lines:
    if l.startswith("【教育背景】"):
        edu_count += 1
        if edu_count == 1:
            skip_edu = True
            continue
        skip_edu = False
    elif skip_edu:
        if l.strip() and not l.strip().startswith("【"):
            continue
        skip_edu = False
    deduped.append(l)
text = "\n".join(deduped)

e = html.escape
sections = []
cur_title = None
cur_lines = []
for l in text.split("\n"):
    l = l.rstrip()
    if not l.strip():
        continue
    if l.startswith("【") and l.endswith("】"):
        if cur_title:
            sections.append((cur_title, cur_lines))
        cur_title = l.strip("【】")
        cur_lines = []
    elif l.startswith("=") or l.startswith("蒋辰宇"):
        if cur_title:
            sections.append((cur_title, cur_lines))
        cur_title = None
        cur_lines = []
    elif cur_title:
        cur_lines.append(l.strip("- ").strip())
if cur_title:
    sections.append((cur_title, cur_lines))

body = ""
for title, ls in sections:
    items = "".join(f"<li>{e(l)}</li>" for l in ls if l)
    body += f'<h2>{e(title)}</h2><ul>{items}</ul>'

html_doc = f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>蒋辰宇 - 定制简历（{e(job_id)}）</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family:"Microsoft YaHei",sans-serif; color:#2c3e50; font-size:13.5px; line-height:1.65; }}
.page {{ max-width:820px; margin:0 auto; padding:36px 44px; }}
.header {{ text-align:center; border-bottom:3px solid #2f5597; padding-bottom:14px; margin-bottom:18px; }}
.header h1 {{ font-size:26px; color:#2f5597; letter-spacing:4px; }}
.header .contact {{ color:#666; font-size:12.5px; margin-top:6px; }}
h2 {{ font-size:15.5px; color:#2f5597; border-left:4px solid #2f5597; padding-left:8px; margin:16px 0 8px; page-break-after:avoid; }}
ul {{ margin-left:18px; }}
li {{ margin-bottom:3px; page-break-inside:avoid; }}
.tag {{ display:inline-block; background:#fff3e0; color:#e65100; border:1px solid #ffcc80; border-radius:10px; padding:1px 8px; font-size:11px; margin:0 4px 4px 0; }}
.badge {{ display:inline-block; background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; border-radius:10px; padding:1px 8px; font-size:11px; margin-left:8px; }}
</style></head>
<body><div class="page">
<div class="header">
  <h1>蒋辰宇</h1>
  <div class="contact">📞 19818100936 ｜ ✉️ 19818100936@163.com ｜ 📍 丽水 ｜ 🎖 中共党员</div>
  <div style="margin-top:8px;"><span class="tag">定制岗位：{e(job_id)}</span><span class="badge">诚实版（如实标注角色）</span></div>
</div>
{body}
<div class="foot" style="text-align:center;color:#aaa;font-size:11px;margin-top:20px;border-top:1px solid #eee;padding-top:8px;">AI-job-hunter 定制简历 ｜ 2026-08-12</div>
</div></body></html>"""

html_path = os.path.join(BASE, "data/out", f"定制简历_{job_id}_蒋辰宇.html")
pdf_path = os.path.join(BASE, "data/out", f"定制简历_{job_id}_蒋辰宇.pdf")
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_doc)
print(f"✅ HTML: {html_path}")

edge = r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
url = f"file:///{html_path.replace(os.sep, '/')}"
r = subprocess.run([edge, "--headless", "--disable-gpu", f"--print-to-pdf={pdf_path}", "--no-pdf-header-footer", url],
                   capture_output=True, timeout=60)
if os.path.exists(pdf_path):
    print(f"✅ PDF: {pdf_path} ({os.path.getsize(pdf_path)} bytes)")
else:
    print("❌ PDF 生成失败")
