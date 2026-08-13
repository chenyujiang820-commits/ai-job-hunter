# AI 求职框架（BOSS 直聘 · 半自动）

> **⚠️ 2026-08-13 更新**：项目由 Hermes 全权负责维护（不再双线并行）。
> 权威指南见 `AGENTS.md`；完整背景见 `docs/交接文档-给Codex-2026-08-12.md`。

**项目状态**：✅ M1 智能层完成（63 测试全过）→ 进入真实投递阶段

---

## 🎯 项目定位

为老板（蒋辰宇）个人打造面向 BOSS 直聘的**半自动** AI 求职框架，覆盖：

> 搜岗位 → 评分 → 定制诚实简历(PDF) → 老板审核后投递

**核心原则**：
- ✅ 半自动 + 人审门禁（投递前老板确认，`humanReview('approved')` 才能投）
- ✅ 诚实护栏三重防线：数字白名单（draft）→ 数字回源 + 头衔门禁（guardrail）→ 人审（package）
- ✅ 风险厌恶（稳定性 45% / 薪资 35% / 地点 20%，底线到手 5000/月，地点丽水）
- ⚠️ 单人单号 BOSS 账号，cookies 直连 API（不跑浏览器自动化，避免反爬检测）

## 🏗️ 架构

| 层 | 技术 | 职责 |
|----|------|------|
| 采集层 | Python（cookies API）| BOSS 岗位搜索/一键扫描 |
| 智能层 | TypeScript（node --experimental-strip-types）| 评分、JD 分析、简历起草、诚实护栏、终检、投递包 |
| 输出层 | TS + Edge headless | 简历 txt/HTML/PDF |

**LLM 路由**（`lib/llm.ts`，2026-08-12 起）：
- 主：TokenRhythm（`deepseek-v4-flash-0731` 起草 / `deepseek-v4-pro` 审查）
- 兜底1：opencode-go（需浏览器 UA，否则 Cloudflare 403）
- 兜底2：DeepSeek 直连

## 📂 关键文件

- `data/source_resume.json` — ★真相源（简历所有事实的唯一来源）
- `lib/score.ts` — 评分引擎（8 子维度 + 技能匹配加分，L1-L8 合法性过滤）
- `lib/draft.ts` — 简历起草（诚实铁律 + 数字白名单 + 头衔铁律）
- `lib/guardrail.ts` — 诚实护栏（数字回源 + **头衔技术门禁**）
- `lib/package.ts` — 投递包 + 人审门禁
- `scripts/scan-boss-jobs.py` — 一键扫描（采集→评分→推荐榜）
- `scripts/e2e-one.ts` — 单岗位全流程（评分→JD→起草→护栏→终检→PDF）

## 🚀 常用命令

```bash
npm test                                   # 63/63 单元测试
npm run build                              # tsc 类型检查（0 错误）
node --experimental-strip-types scripts/e2e-one.ts boss-06   # 单岗位全流程
python scripts/scan-boss-jobs.py "课程顾问"   # 一键扫描 BOSS 岗位+评分
```

## 🧪 测试基线

63 个单元测试：llm(6) / score(20) / guardrail(14，含头衔门禁) / package(4) / pdf(4) / risk(2) / jd-analyzer(4) / setup(5) / template(4)

## 🔒 诚实红线（铁律）

1. 简历内容必须能在 `source_resume.json` 找到源头；数字只能原样引用白名单
2. 头衔只允许：市场人员 / 项目成员 / 政企客户经理（guardrail 自动拦截违规）
3. 投递必须经 `humanReview('approved')`，禁止绕过

## 📄 交付物

- `deliverables/software-company/开发日志-2026-08-12.md` — R1-R9 踩坑记录
- `deliverables/software-company/容博日报梳理报告-2026-08-12.md` — 95+37 条日报梳理
- `docs/使用指南-蒋辰宇版.md` — 老板操作手册
