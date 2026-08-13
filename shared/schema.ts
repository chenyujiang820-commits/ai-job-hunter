/**
 * shared/schema.ts — 跨层共享契约（PRD §14.2 P4）
 * 智能层(TS) 与 交互层(Python) 共同遵守，禁止单方私自扩展字段。
 * 修订：2026-08-12 Hermes
 */

/** 源简历「可佐证经历库」—— 诚实护栏唯一真相源（PRD §13.1） */
export interface SourceExperience {
  company: string;        // 公司名
  role: string;           // 角色/职位
  start: string;          // YYYY-MM
  end: string;            // YYYY-MM 或 "至今"
  duties: string[];       // 职责动词列表（SOFT 可变区依据）
  metrics: Metric[];      // 量化结果（HARD 不可变）
  skills: string[];       // 技能（有/无二值）
  education?: Education;  // 教育经历（可选，放首条时用）
}

export interface Metric {
  value: string;          // 原始数字+单位，如 "30%"
  normalized: string;     // 归一化值，如 "30%" / "200000"
  description: string;    // 该数字描述的事实
}

export interface Education {
  school: string;
  degree: string;
  major: string;
  period: string;         // "2020.10 - 2024.06"
  gpa?: string;
  honors: string[];       // 荣誉奖项
}

export interface SourceResume {
  schema_version: 1;
  name: string;
  phone: string;
  email: string;
  location: string;       // 现居地
  political?: string;     // 政治面貌
  summary: string;        // 个人总结（可改写）
  experiences: SourceExperience[];
  retracted_claims: string[];  // 明确禁止使用的表述（PRD §13 retracted-claims 硬门禁）
  updated_at: string;     // ISO
}

/** 岗位（来自 BOSS 交互层或人工粘贴，M1 为人工 JSON） */
export interface Job {
  id: string;             // 唯一 ID（BOSS 岗位码或 hash）
  title: string;
  company: string;
  company_meta?: {
    founded_year?: number;   // 成立年限（稳定性①）
    nature?: string;         // 公司性质：公办/国企/民企/初创...
    employees?: string;      // 规模
    listed?: boolean;        // 是否上市
    registered_capital?: string; // 注册资本（实缴/认缴）
    insured_count?: number;  // 参保人数
    legal_risks?: string[];  // 司法风险
  };
  industry: string;       // 行业（稳定性②）
  salary_range?: {        // BOSS 显示（税前）
    min: number;
    max: number;
    unit: 'K' | 'W';      // K=千/月, W=万/月
  };
  salary_text?: string;   // 原始薪资文本（"8-13K" / "面议"）
  location: string;       // 工作地（硬过滤）
  remote: boolean;        // 是否远程
  work_schedule?: string; // 双休/大小周/单休（工作模式⑧）
  employment_type?: string; // 全职/外包/派遣（岗位性质③）
  job_description: string;  // JD 原文
  posted_at?: string;
  recruiter_active?: boolean; // 14 天活跃过滤
  source_url?: string;
}

/** 评估结果（PRD §14.1 签名） */
export type Verdict = 'pass' | 'fail' | 'review';
export type FlagId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8';

export interface ScoreResult {
  score: number;          // 1–5 加权总分
  subscores: Record<SubDimId, number>; // 八子维度分
  flags: FlagId[];        // 命中的合法性块
  passed: Verdict;        // pass / fail / review
  reasons: string[];      // 打分依据（可审计）
  meta: {
    salary_net?: number;  // 换算后到手薪资
    location_ok: boolean;
    model: string;        // 评估所用模型
    scored_at: string;
  };
}

export type SubDimId = 's1'|'s2'|'s3'|'s4'|'s5'|'s6'|'s7'|'s8';

/** 投递包（PRD R5 / T7）—— M1 只产出，不发送 */
export interface ApplicationPackage {
  package_id: string;         // uuid
  job_id: string;
  job_snapshot: Job;
  resume_paths: {
    docx: string;             // 人审版
    pdf: string;              // 投递版
  };
  greeting: string;           // 招呼语
  score: ScoreResult;
  human_review: {
    status: 'pending' | 'approved' | 'rejected';
    approved_at?: string;
    reviewed_by?: string;
  };
  created_at: string;
}

/** applications 落库行（PRD R9 / §13.7） */
export interface ApplicationRecord {
  ts: string;                 // ISO 时间
  event: 'scored' | 'drafted' | 'guardrailed' | 'packaged' | 'human_approved' | 'human_rejected' | 'submitted' | 'hr_message' | 'interview' | 'outcome';
  job_id: string;
  package_id?: string;
  payload: Record<string, unknown>;  // 事件负载（含 claim 核对结果等）
}
