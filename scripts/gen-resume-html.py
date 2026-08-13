#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 source_resume.json 生成精美 HTML 简历 → 供 Edge 无头转 PDF"""
import json, sys, io, html, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
# 项目根目录 = 脚本所在目录的上一级（不再硬编码绝对路径，可移植）
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(BASE, "data/source_resume.json"), encoding="utf-8") as f:
    src = json.load(f)

e = html.escape

def render_exp(exp):
    period = f"{exp['start']} ~ {exp['end']}"
    skills = "、".join(exp.get("skills", []))
    metrics_html = ""
    for m in exp.get("metrics", []):
        metrics_html += f'<span class="metric">{e(m["value"])}</span>'
    duties = "".join(f"<li>{e(d)}</li>" for d in exp.get("duties", []))
    return f"""
    <div class="exp">
      <div class="exp-head">
        <span class="exp-company">{e(exp['company'])}</span>
        <span class="exp-role">{e(exp.get('role',''))}</span>
        <span class="exp-period">{e(period)}</span>
      </div>
      {f'<div class="metrics">{metrics_html}</div>' if metrics_html else ''}
      <ul class="duties">{duties}</ul>
      {f'<div class="skills">技能：{e(skills)}</div>' if skills else ''}
    </div>"""

# 经历排序：容博(最近)在前，教育放最后
exps = [x for x in src["experiences"] if "education" not in x]
edu = [x for x in src["experiences"] if "education" in x]

summary_items = "".join(f"<li>{e(s.strip('- '))}</li>" for s in src["summary"].split("\n") if s.strip())
exps_html = "".join(render_exp(x) for x in exps)
edu_html = "".join(render_exp(x) for x in edu)

# 荣誉
honors = edu[0].get("education", {}).get("honors", []) if edu else []
honors_html = "".join(f"<li>{e(h)}</li>" for h in honors)

html_doc = f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>{e(src['name'])} - 个人简历</title>
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ font-family:"Microsoft YaHei","PingFang SC",sans-serif; color:#2c3e50; font-size:13.5px; line-height:1.65; background:#fff; }}
  .page {{ max-width:820px; margin:0 auto; padding:36px 44px; }}
  .header {{ text-align:center; border-bottom:3px solid #2f5597; padding-bottom:14px; margin-bottom:18px; }}
  .header h1 {{ font-size:26px; color:#2f5597; letter-spacing:4px; }}
  .header .contact {{ color:#666; font-size:12.5px; margin-top:6px; }}
  .header .contact span {{ margin:0 10px; }}
  h2 {{ font-size:15.5px; color:#2f5597; border-left:4px solid #2f5597; padding-left:8px; margin:18px 0 10px; }}
  .summary li {{ margin-bottom:3px; }}
  .exp {{ margin-bottom:14px; page-break-inside:avoid; }}
  h2 {{ page-break-after:avoid; }}
  .exp-head {{ display:flex; align-items:baseline; }}
  .exp-company {{ font-weight:bold; font-size:14px; }}
  .exp-role {{ color:#2f5597; margin-left:10px; font-size:13px; }}
  .exp-period {{ margin-left:auto; color:#888; font-size:12px; white-space:nowrap; }}
  .metrics {{ margin:4px 0 2px; }}
  .metric {{ display:inline-block; background:#eef3fb; color:#2f5597; border:1px solid #c5d5ee; border-radius:10px; padding:1px 10px; font-size:12px; margin-right:6px; }}
  .duties {{ margin:4px 0 2px 18px; }}
  .duties li {{ margin-bottom:2px; }}
  .skills {{ color:#666; font-size:12px; margin-top:3px; }}
  ul {{ list-style:disc; }}
  .edu {{ margin-bottom:10px; }}
  .honors {{ margin-left:18px; }}
  .honors li {{ color:#444; }}
  .foot {{ text-align:center; color:#aaa; font-size:11px; margin-top:24px; border-top:1px solid #eee; padding-top:8px; }}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>{e(src['name'])}</h1>
    <div class="contact">
      <span>📞 {e(src['phone'])}</span>
      <span>✉️ {e(src['email'])}</span>
      <span>📍 {e(src['location'])}</span>
      <span>🎖 {e(src.get('political',''))}</span>
    </div>
  </div>

  <h2>个人总结</h2>
  <ul class="summary">{summary_items}</ul>

  <h2>工作经历</h2>
  {exps_html}

  <h2>教育背景</h2>
  {edu_html}
  <ul class="honors">{honors_html}</ul>

  <div class="foot">简历生成时间：2026-08-12</div>
</div>
</body>
</html>"""

out_html = os.path.join(BASE, "data/out/简历预览_蒋辰宇.html")
with open(out_html, "w", encoding="utf-8") as f:
    f.write(html_doc)
print("✅ HTML 已生成:", out_html, os.path.getsize(out_html), "bytes")
