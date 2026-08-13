#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
scripts/scan-boss-jobs.py — M2 一键扫描：采集岗位 → 评分 → 排序 → 输出推荐榜

用法:
  python scripts/scan-boss-jobs.py "教育" --city 101210800
  python scripts/scan-boss-jobs.py "项目经理" --city 101210800 --size 30

输出: 控制台推荐榜 + data/out/岗位推荐榜_<query>.json
"""
import sys, io, json, os, time, subprocess, argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
BASE = r"C:/Users/15050/Desktop/Atlas/AI-job-hunter"

def main():
    ap = argparse.ArgumentParser(description="BOSS岗位一键扫描+评分")
    ap.add_argument("query", help="搜索关键词")
    ap.add_argument("--city", default="101210800", help="城市代码（默认丽水）")
    ap.add_argument("--size", type=int, default=20)
    args = ap.parse_args()

    # 1. 采集
    print(f"🔍 步骤1: 采集 '{args.query}' 岗位...")
    fetched_file = os.path.join(BASE, "data", "jobs", "fetched", f"{args.query}_{args.city}.json")
    r = subprocess.run(
        [sys.executable, os.path.join(BASE, "scripts", "fetch-boss-jobs.py"),
         args.query, "--city", args.city, "--size", str(args.size)],
        capture_output=True, text=True, encoding="utf-8", timeout=120)
    if r.stdout:
        print(r.stdout[-600:])
    if r.stderr:
        print(r.stderr[-300:])
    # 子进程退出码 2 = cookies 过期（fetch 已打印完整提示）
    if r.returncode == 2:
        print("❌ 采集中止：cookies 已失效，请按上面步骤重新导出后再试")
        sys.exit(2)
    if r.returncode != 0:
        print("❌ 采集失败（请检查网络/风控后重试）")
        sys.exit(1)
    if not os.path.exists(fetched_file):
        print("❌ 采集失败：未生成岗位文件"); sys.exit(1)
    with open(fetched_file, encoding="utf-8") as f:
        jobs = json.load(f)["jobs"]
    print(f"📦 共 {len(jobs)} 个岗位待评分")

    # 2. 生成评分用 job 文件（合并进验证集临时文件）
    score_file = os.path.join(BASE, "data", "jobs", "scan-tmp.json")
    with open(score_file, "w", encoding="utf-8") as f:
        json.dump({"jobs": jobs}, f, ensure_ascii=False, indent=2)

    # 3. 写一个临时 TS 评分脚本（复用 lib/score.ts 规则）
    ts_script = os.path.join(BASE, "scripts", "scan-score.ts")
    with open(ts_script, "w", encoding="utf-8") as f:
        f.write(f"""import {{ readFileSync, writeFileSync }} from 'node:fs';
import {{ resolve }} from 'node:path';
import {{ scoreJob }} from '../lib/score.ts';
import {{ DEFAULT_PROFILE }} from '../data/profile.schema.ts';
const jobs = JSON.parse(readFileSync(resolve('{score_file.replace(chr(92), '/')}'), 'utf-8')).jobs;
const profile = structuredClone(DEFAULT_PROFILE);
profile.preferences.min_net_salary = 5000;
profile.preferences.target_net_salary = 6000;
profile.preferences.locations = (process.env['LOCATIONS'] ?? '丽水').split(',').map((s) => s.trim());
const scored = jobs.map((j) => {{
  const s = scoreJob(j, profile);
  return {{ id: j.id, title: j.title, company: j.company, salary: j.salary_text, location: j.location,
           score: s.score, passed: s.passed, flags: s.flags, reasons: s.reasons?.slice(0,2) }};
}}).sort((a, b) => b.score - a.score);
writeFileSync(resolve('{os.path.join(BASE, 'data/out', f'岗位推荐榜_{args.query}.json').replace(chr(92), '/')}'), JSON.stringify(scored, null, 2), 'utf-8');
console.log(JSON.stringify(scored, null, 1));
""")
    print("⚖️  步骤2: 评分排序...")
    r = subprocess.run(["node", "--experimental-strip-types", ts_script],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    if r.returncode != 0:
        print("❌ 评分失败:", r.stderr[-800:]); sys.exit(1)

    # 4. 展示推荐榜
    scored = json.loads(r.stdout)
    print("\n" + "=" * 70)
    print(f"🏆 岗位推荐榜（{args.query} · 按匹配分排序）")
    print("=" * 70)
    for i, s in enumerate(scored, 1):
        mark = "✅" if s["passed"] == "pass" else "⛔"
        flags = f" | flags:{','.join(s['flags'])}" if s["flags"] else ""
        print(f"{i:>2}. {mark} {s['score']:.1f}分 | {s['title']} | {s['salary']} | {s['company']}{flags}")
    print(f"\n💾 完整结果: data/out/岗位推荐榜_{args.query}.json")

if __name__ == "__main__":
    main()
