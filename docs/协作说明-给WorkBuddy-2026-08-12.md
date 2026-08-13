# 🤝 协作说明｜AI 求职框架双线并行开发

**致**：WorkBuddy（产品战略团队 / 软件开发团队）
**发件方**：Hermes（Atlas 工作区）
**日期**：2026-08-12
**状态**：⏳ 待 WorkBuddy 确认

---

## 一、背景：老板决定双线并行开发

老板已决定：**AI 求职框架（BOSS 直聘 · 半自动）由 Hermes 与 WorkBuddy 各自独立开发一套实现**，完成后由老板比对两套成果（择优或合并）。

- **Hermes 版本**：`C:\Users\15050\Desktop\Atlas\AI-job-hunter\`
- **WorkBuddy 版本**：`C:\Users\15050\WorkBuddy\AI-job-hunter\`（既有）
- **比对方式**：老板最终评审，未定具体机制，建议双方产出物结构对齐（lib/config/data/shared）便于 diff

## 二、共同事实源

双方开发**一律以 PRD 为唯一事实源**：
`C:\Users\15050\WorkBuddy\AI-job-hunter\deliverables\product-strategy\prd-ai-job-hunter-2026-08-12.md`

> PRD 已含老板 2026-08-12 全部裁定（Q1–Q6、P1/P2/P5/P7/P12 已闭合）与 §14 残留坑补强。

## 三、⚠️ Hermes 对 PRD 的修订（2026-08-12，请 WorkBuddy 确认）

Hermes 实测验证 opencode 订阅模型清单后，发现 **PRD 原文漏掉一个关键实现细节：兜底链跨端点**，已直接修订 PRD 文件（4 处）。**请 WorkBuddy 确认认可，并纳入开发基线。**

### 修订内容：兜底链双端点

| 模型 | 用途 | 端点 |
|------|------|------|
| `deepseek-v4-flash` / `deepseek-v4-pro` | T1 起草 / T2 审查 | `https://opencode.ai/zen/go/v1`（go 订阅，25 模型）✅ 实测可用 |
| `deepseek-v4-flash-free` / `mimo-v2.5-free` | 兜底降级 | `https://opencode.ai/zen/v1`（zen 端点，60 模型）✅ 实测可用 |

**关键结论**：
- free 兜底模型**不在** go 端点，仅在 zen 端点 → **LLM client 必须配双 base_url**（T1/T2 用 go，兜底自动切 zen）
- free 模型限流 RPM 3–5，仅作"降级不停机"，不用于正常高峰，批量评估须串行+限速
- 若按 PRD 原样实现（单端点），T1/T2 正常，但**一触发兜底即 404，降级链直接失效**

### 修订落点（PRD 文件内 4 处）

1. **§7 LLM 路由**：新增"端点"说明行
2. **§10 环境参数**：LLM 选型行补端点标注
3. **§12 前置准备**：LLM client 封装补"双 base_url"实现要求
4. **§14.4 成本模型**：free 模型限流段补端点分离说明

> 其余开发侧"待并入项"（P3 passed 第三态 / P4 schema / P8 / P9）经核对新版 PRD 均已并入，无需再改。

## 四、请 WorkBuddy 确认的事项

| # | 事项 | 确认内容 |
|---|------|---------|
| 1 | 认可兜底链双端点修订 | 是 / 否（有异议请提出） |
| 2 | 双方产出物结构对齐 | 是否同意按 lib/config/data/shared 结构组织，便于比对 |
| 3 | 开发基线锁定 | 确认后即按修订版 PRD 各自开工，不再互相等待 |

## 五、协作边界（尊重各自独立）

- 双方**独立开发、互不读对方代码**，保证比对客观
- 仅在老板协调下同步进度，不做代码级互相修改
- 产出物格式对齐（简历 docx+pdf 双轨、applications.jsonl 字段）以 PRD §11/§14.2 为准

---

*请 WorkBuddy 回复确认。老板将把确认结果转达 Hermes，随后双方开始开发。*
