#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
scripts/fetch-boss-jobs.py — BOSS直聘岗位采集器（M2 核心）

用登录 cookies 直接调 BOSS 内部 API 搜索岗位（绕开浏览器自动化检测）。
用法:
  python scripts/fetch-boss-jobs.py "教育" --city 101210800 --page 1 --size 20
  python scripts/fetch-boss-jobs.py "销售" --city 101210800 --size 50 --out data/jobs/fetched/教育_丽水.json

城市代码（常用）:
  101210800 = 丽水   101210100 = 杭州   101210900 = 义乌   101210700 = 温州

输出: 标准 Job JSON（可直接进 AI-job-hunter 评分/起草流程）
"""
import sys, io, json, os, re, time, argparse, urllib.request, urllib.parse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
BASE = r"C:/Users/15050/Desktop/Atlas/AI-job-hunter"

# ---------- cookies 加载 ----------
COOKIE_FILES = [
    r"C:\Users\15050\.hermes-web-ui\upload\atlas\4a699022493d3097.json",  # 用户最近一次导出
]
COOKIE_DIR = os.path.join(BASE, "config", "cookies")
if os.path.isdir(COOKIE_DIR):
    for fn in sorted(os.listdir(COOKIE_DIR)):
        if fn.endswith(".json"):
            COOKIE_FILES.insert(0, os.path.join(COOKIE_DIR, fn))

COOKIE_EXPIRE_HINT = """
╔══════════════════════════════════════════════════════════╗
║  ⚠️  BOSS 登录 cookies 已失效（接口返回 code:37）          ║
║                                                          ║
║  重新导出一份新 cookies（约 30 秒）：                      ║
║  ① Chrome/Edge 打开 https://www.zhipin.com/              ║
║  ② 确认右上角有你的头像（已登录），必要时 F5 刷新          ║
║  ③ F12 → Console → 输入 document.cookie → 回车           ║
║  ④ 复制结果，发给我或保存为 config/cookies/xxx.json       ║
║                                                          ║
║  💡 若 F12 白屏（反调试）：改用 Edge，或先开空白页按 F12   ║
║     再新开标签访问 BOSS                                    ║
╚══════════════════════════════════════════════════════════╝
"""

def load_cookie_str() -> str:
    """加载 cookies 并检查时效。返回 cookie 字符串 + 加载的文件路径。"""
    for path in COOKIE_FILES:
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in data)
                elif isinstance(data, dict):
                    cookie_str = "; ".join(f"{k}={v}" for k, v in data.items())
                else:
                    continue
                # 检查关键登录字段
                names = {c.get('name') for c in data} if isinstance(data, list) else set(data.keys())
                has_login = bool(names & {'__zp_stoken__', 'zp_at', 'wt2'})
                mtime = os.path.getmtime(path)
                age_h = (time.time() - mtime) / 3600
                print(f"🍪 cookies: {os.path.basename(path)}（{age_h:.1f} 小时前导出，{'含登录字段' if has_login else '⚠️ 缺关键字段'}）")
                if not has_login:
                    print("⚠️  cookies 缺少登录字段（__zp_stoken__/zp_at/wt2），可能无法通过接口校验")
                return cookie_str
            except Exception:
                continue
    raise RuntimeError("找不到 cookies 文件！请先导出 BOSS 登录 cookies 到 config/cookies/ 或上传后告知路径")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

class CookieExpiredError(RuntimeError):
    """cookies 过期专用异常"""

def fetch_jobs(query: str, city: str, page: int, page_size: int) -> list:
    cookie_str = load_cookie_str()
    q = urllib.parse.quote(query)
    url = (f"https://www.zhipin.com/wapi/zpgeek/search/joblist.json"
           f"?scene=1&query={q}&city={city}&page={page}&pageSize={page_size}")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Cookie": cookie_str,
        "Referer": "https://www.zhipin.com/",
        "Accept": "application/json, text/plain, */*",
    })
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read())
    code = data.get("code")
    if code != 0:
        msg = data.get("message", "")
        # code:37 = cookies 过期/环境异常 → 友好提示
        if code == 37 or "环境" in str(msg) or "异常" in str(msg):
            raise CookieExpiredError(f"cookies 已失效（code={code}）{COOKIE_EXPIRE_HINT}")
        raise RuntimeError(f"接口返回错误: code={code} msg={msg}")
    return data.get("zpData", {}).get("jobList", [])

def to_job(j: dict, source_tag: str) -> dict:
    """BOSS 岗位 → AI-job-hunter Job 标准格式"""
    salary = j.get("salaryDesc", "")
    loc = j.get("cityName", "") + (j.get("areaDistrict", "") or "")
    # 公司信息
    brand = j.get("brandName", "")
    brand_info = j.get("brandInfo") or {}
    return {
        "id": f"boss-fetched-{j.get('encryptJobId', j.get('jobId', ''))[:12]}",
        "title": j.get("jobName", ""),
        "company": brand,
        "industry": brand_info.get("industryName", ""),
        "salary_text": salary,
        "location": loc,
        "remote": False,
        "employment_type": "全职",
        "work_schedule": "",
        "job_description": _build_jd(j),
        "tags": [],
        "source": source_tag,
        "company_meta": {
            "employees": brand_info.get("sizeName", ""),
            "nature": brand_info.get("brandStageName", ""),
            "listed": bool(brand_info.get("brandCompose", "").get("isListed", False)) if brand_info.get("brandCompose") else False,
        },
    }

def _build_jd(j: dict) -> str:
    """从岗位详情字段拼 JD 文本"""
    parts = []
    desc = j.get("jobDesc", "") or j.get("jobDescription", "")
    if desc: parts.append(f"岗位职责：{desc}")
    # 任职要求从技能标签/学历经验拼
    skill_tags = [t for t in (j.get("skills") or []) if t]
    edu = j.get("jobDegree", "")
    exp = j.get("jobExperience", "")
    reqs = []
    if edu: reqs.append(f"{edu}学历")
    if exp: reqs.append(f"{exp}")
    if skill_tags: reqs.append("熟悉：" + "、".join(skill_tags[:8]))
    if reqs: parts.append("任职要求：" + "；".join(reqs))
    return "\n".join(parts) if parts else (desc or "")

def main():
    ap = argparse.ArgumentParser(description="BOSS直聘岗位采集器")
    ap.add_argument("query", help="搜索关键词，如 教育/销售/项目经理")
    ap.add_argument("--city", default="101210800", help="城市代码（默认丽水 101210800）")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--size", type=int, default=20, help="每页数量（最大30）")
    ap.add_argument("--out", default="", help="输出 JSON 文件路径（默认 data/jobs/fetched/<query>_<city>.json）")
    args = ap.parse_args()

    print(f"🔍 搜索: {args.query} | 城市代码: {args.city} | 页码: {args.page} | 数量: {args.size}")
    try:
        jobs = fetch_jobs(args.query, args.city, args.page, min(args.size, 30))
    except CookieExpiredError as e:
        print(str(e))
        sys.exit(2)
    except Exception as e:
        print(f"❌ 采集失败: {e}")
        print("\n💡 提示：检查网络/代理后重试；若持续失败可能是接口风控，稍后再试")
        sys.exit(1)
    print(f"✅ 拿到 {len(jobs)} 个岗位")

    converted = [to_job(j, "boss-api") for j in jobs]
    # 去重
    seen = set()
    deduped = []
    for cj in converted:
        if cj["title"] + cj["company"] not in seen:
            seen.add(cj["title"] + cj["company"])
            deduped.append(cj)

    out_path = args.out or os.path.join(BASE, "data", "jobs", "fetched", f"{args.query}_{args.city}.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"jobs": deduped, "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S")}, f, ensure_ascii=False, indent=2)
    print(f"💾 已保存 {len(deduped)} 个岗位 → {out_path}")
    print("\n📋 岗位预览：")
    for j in deduped[:10]:
        print(f"  - {j['title']} | {j['salary_text']} | {j['company']} | {j['location']}")

if __name__ == "__main__":
    main()
