# AGENTS.md — AI-job-hunter 项目指南（Codex 自动读取）

> 本文件供 AI 编码 agent（Codex 等）进入项目时自动加载。详细交接见 `docs/交接文档-给Codex-2026-08-12.md`。

## 项目一句话

BOSS 直聘半自动求职系统：搜岗位 → 评分 → 定制诚实简历(PDF) → 老板审核后投递。

## 铁律（违反 = 项目失败）

1. **诚实红线**：简历内容必须能在 `data/source_resume.json` 找到源头。头衔只允许：市场人员/项目成员/政企客户经理。数字只允许白名单内原样引用。
2. **半自动**：`lib/package.ts` 的投递包必须经过 `humanReview('approved')` 才能投递，禁止绕过。
3. **不破坏测试**：改动后必须 `npm test`（59 个测试）+ `npm run build`（tsc 0 错误）全过。

## 常用命令

```bash
npm test                                    # 59/59 测试
npm run build                               # 类型检查
node --experimental-strip-types scripts/e2e-one.ts boss-06   # 单岗位全流程
python scripts/scan-boss-jobs.py "课程顾问"   # 一键扫描 BOSS 岗位+评分
python scripts/fetch-boss-jobs.py "销售"      # 仅采集岗位
```

## 关键文件

- `data/source_resume.json` — ★真相源（改这里 = 改所有简历的事实）
- `lib/llm.ts` — 三端点 LLM（TokenRhythm主 → opencode-go兜底1 → DeepSeek兜底2）
- `lib/score.ts` — 评分引擎（8+1 维度，L1-L8 合法性）
- `lib/draft.ts` — 简历起草（诚实铁律 + 数字白名单）
- `lib/guardrail.ts` — 诚实护栏（数字回源校验）
- `config/cookies/zhipin_20260812.json` — BOSS 登录 cookies（易过期，code:37 时需老板重导）

## 环境注意

- TS 用 `node --experimental-strip-types` 直接跑（无编译步骤）
- opencode.ai 请求必须带浏览器 UA（否则 403）；luna 模型需走代理 7890
- BOSS 采集用 cookies 直连 API（浏览器自动化会被反爬检测）
- Windows 环境：git-bash 语法，路径用 `/c/Users/...` 或 `C:/...`

## 老板画像速查

- 蒋辰宇，求职者，非技术背景（说明要通俗）
- 底线：到手 5000/月，地点丽水（可 `LOCATIONS=丽水,杭州` 放宽）
- 方向：教育科技/信息化/To B销售/项目管理
- 回复用中文 + 表格/emoji，末尾标注 `（模型/provider）`
