# AI 求职框架（BOSS 直聘 · 半自动）

**项目状态**：⚙️ 开发中（双线并行开发模式）
**事实源**：`C:\Users\15050\WorkBuddy\AI-job-hunter\deliverables\product-strategy\prd-ai-job-hunter-2026-08-12.md`（PRD 唯一事实源）
**开发方**：Hermes（本工作区）‖ WorkBuddy（`C:\Users\15050\WorkBuddy\AI-job-hunter`）
**评审方式**：两套实现完成后由老板比对

---

## 🎯 项目定位

为老板个人打造面向 BOSS 直聘的**半自动** AI 求职框架，覆盖：

> 画像 → 评估 → 简历 → 投递(人审) → HR 回复(人审) → 面试评估 → 邮件通知 全链路

**核心原则**：
- ✅ 半自动 + 人审门禁（投递前 / HR 回复前老板确认）
- ✅ 诚实护栏（简历绝不虚构，retracted-claims 硬门禁）
- ✅ 风险厌恶（稳定性 45% / 薪资 35% / 地点 20%，地点硬过滤前置）
- ⚠️ 单人单号 BOSS 账号，风控保守（限频 / 验证码人工 / 不批量爬）

## 🏗️ 架构（双模块）

| 层 | 技术 | 职责 |
|----|------|------|
| 智能层 | TS / Claude Code Skills | 画像解析、评估评分、简历 drafter-reviewer、诚实护栏 |
| 交互层 | Python / Playwright | BOSS session 复用、投递、邮件、JSONL 落库、docx→pdf |

**LLM 路由（2026-08-12 实测确认）**：
- T1 `deepseek-v4-flash`（起草/量大）→ `https://opencode.ai/zen/go/v1`
- T2 `deepseek-v4-pro`（审查/高敏）→ `https://opencode.ai/zen/go/v1`
- 兜底 `flash-free` → `mimo-free` → `https://opencode.ai/zen/v1`（**注意：free 模型仅在 zen 端点，需双 base_url**）

## 📁 目录结构

```
AI-job-hunter/
├── README.md            ← 本文件
├── docs/                ← 开发文档、协作说明
├── lib/                 ← LLM client 封装（双 base_url）、核心逻辑
├── config/              ← weights.json、risk 配置
├── data/                ← 源简历结构化、岗位数据、验证集
├── shared/              ← 跨层 schema（投递包/源简历/applications.jsonl）
└── deliverables/        ← 产出物（评审、PRD 补充、开发报告）
```

## 🤝 与 WorkBuddy 的协作约定

1. **PRD 为唯一事实源**，双方均以 `prd-ai-job-hunter-2026-08-12.md` 为准
2. Hermes 对 PRD 的 4 处修订（兜底链双端点）已并入 PRD 文件，WorkBuddy 需确认
3. 双方独立开发，产出物结构对齐（lib/config/data/shared），便于比对
4. 最终由老板比对两套实现，择优或合并

## 📅 里程碑（与 PRD §9 一致）

| 里程碑 | 主题 | 状态 |
|--------|------|------|
| M0 | 需求锁定 | ✅ 已完成 |
| M1 | 智能层骨架（画像+评估+简历+人审） | 🔄 进行中 |
| M2 | 交互层 BOSS 薄层（抓取+投递+风控） | ⏳ |
| M3 | 通知 + HR 回复 | ⏳ |
| M4 | 追踪 / outcome 闭环 | ⏳ |

---
*本工作区为 Hermes 开发版本。WorkBuddy 版本见 `C:\Users\15050\WorkBuddy\AI-job-hunter`。*
