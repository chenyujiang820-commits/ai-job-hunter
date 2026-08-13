# AI-job-hunter M1 实施计划（Hermes 版）

> **For Hermes:** 按本计划分任务开发，TDD 驱动，每任务验证后再提交。
> **事实源**：`C:\Users\15050\WorkBuddy\AI-job-hunter\deliverables\product-strategy\prd-ai-job-hunter-2026-08-12.md`

**Goal:** M1 智能层骨架——画像(R1) + 评估(R3) + 简历 drafter-reviewer(R4) + 投递包+人审(R5)，纵切最小闭环，不发实际投递。

**Architecture:** 双模块中的智能层（TS/Node）。LLM 走 opencode 双端点（go: T1/T2，zen: free 兜底）。所有模块只通过 `lib/llm.ts` 调模型，禁止直连。

**Tech Stack:** TypeScript + Node v24 + node:test（零重依赖）+ docx（简历模板，后期）+ opencode API（fetch）

---

## 前置依赖（用户资料，阻塞 T3/T4）

- [ ] P1: 源简历 docx（原始版，非定制版）→ `data/source_resume.json` 真相源
- [ ] P2: 验证集 5–10 个 BOSS 岗位 JSON → `data/jobs/validation/`（T2/T8 验收）
- [ ] P3: 文风样本（可选）→ R1 画像文风字段

## 任务清单

### Task 0: 项目初始化
- Create: `package.json`、`tsconfig.json`、`shared/schema.ts`（三份跨层 schema 类型）
- 验证: `npx tsc --noEmit` 通过

### Task 1: LLM client 封装（`lib/llm.ts`）
- 接口: `call(tier: 'T1'|'T2', prompt, opts?) → string`
- 双 base_url：T1/T2 → go；free 兜底 → zen
- 重试(2) + 超时(30s) + token 计数 + 兜底链 `flash→flash-free→mimo-free`
- 测试: mock fetch 验证端点选择与兜底切换

### Task 2: 风控 config（`config/risk.ts`）
- 常量: 随机延时 4000–10000ms、日上限 150、Cookie 路径、验证码人工标志
- 测试: 常量存在性 + 随机延时区间

### Task 3: 画像建模（T1, R1）— 部分阻塞 P3
- Create: `data/profile.schema.ts` + `lib/setup.ts`
- 三路径: 粘贴/文件/问答；字段: 薪资(到手5000/期望6000)、稳定性权重、地点、文风
- 测试: schema 校验

### Task 4: 评估引擎（T2, R3）
- Create: `lib/score.ts` — 八子维度加权（§14.1.1）+ 合法性块 L1–L8 + 地点硬过滤
- 薪资换算: 税前 × 0.86 = 到手；面议默认 2 分
- 输出: `{score, subscores, flags, passed: pass|fail|review}`
- 测试: 各维度锚点样例 + L 规则命中 + 阈值过滤

### Task 5: 源简历结构化（前置, 阻塞 P1）
- Create: `data/source_resume.json` — 每条经历 {公司,角色,时间,职责动词,量化结果,技能}
- 输入: 用户提供的源简历 docx → 人工/LLM 辅助拆解 + 老板确认
- 测试: schema 校验 + 字段完整性

### Task 6: 简历 drafter（T3, R4）
- Create: `lib/draft.ts` — Flash 起草，基于源简历，禁编造
- 系统提示硬约束: 只可用 source 事实；JD 要求而 source 没有 → "愿意学习"
- 测试: mock 输出不含 source 外事实

### Task 7: 诚实护栏（T4, R4）
- Create: `lib/guardrail.ts` — claim 抽取 + HARD 精确匹配 / SOFT LLM-judge
- 输出: `{claims, matched, unmatched_hard, unmatched_soft, verdict}`
- HARD 未命中 → reject；SOFT 未命中 → review
- 测试: 编造数字/公司被 HARD 拦截；合理改写放行

### Task 8: 简历 reviewer（T5, R4）
- Create: `lib/review.ts` — Pro 终检，输出 issues[] + verdict
- 测试: mock 夸大/不贴切被挑出

### Task 9: 模板引擎（T6, R4）— 降级先做纯文本/HTML
- Create: `lib/template.ts` — 渲染 docx（后续）+ ATS 文本校验
- 测试: 文本版字段完整

### Task 10: 投递包+人审（T7, R5）
- Create: `lib/package.ts` — build_package(job, resume, greeting) → package.json + CLI 确认门禁
- 测试: 未确认不进队列；package 字段完整

### Task 11: 验证集跑通（T8）
- 5–10 真实岗位端到端：评分 → 简历 → 护栏 → 投递包
- 指标: 打分一致率≥0.7、诚实度≥98%、端到端<5min

---

## 验收标准（PRD §12.5）
1. 打分合理性: M1 评分 vs 老板人工排序一致率 ≥ 0.7
2. 简历诚实度: claim 回源命中率 ≥ 98%
3. ATS 可解析: pdf 字段可抽取 ≥ 95%（M2 前验证）
4. 端到端耗时: 单岗 < 5 min（不含人审）

## 风险
- P1/P2 用户资料延迟 → 阻塞 T5/T11，先做不依赖的部分
- free 模型 RPM 3–5 → 仅降级用
- docx 模板依赖 → M1 先文本/HTML 降级，M2 前补 libreoffice
