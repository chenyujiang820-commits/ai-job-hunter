/**
 * data/profile.schema.ts — 用户画像（PRD R1 / T1）
 * 老板已裁定参数（2026-08-12）：
 *   底线到手 5000 / 期望到手 6000
 *   权重：稳定 0.45 / 薪资 0.35 / 地点 0.20
 */
export interface UserProfile {
  schema_version: 1;
  name: string;
  /** 求职偏好 */
  preferences: {
    /** 到手底线薪资（元/月） */
    min_net_salary: number;
    /** 到手期望薪资（元/月） */
    target_net_salary: number;
    /** 评估权重（PRD §14.1） */
    weights: {
      stability: number;
      salary: number;
      location: number;
    };
    /** 地点硬过滤：接受的工作地（空数组 = 仅丽水+远程） */
    locations: string[];
    /** 是否接受远程 */
    remote_ok: boolean;
    /** 优先级阈值：≥此分进投递池（PRD §14.1） */
    pool_threshold: number;
  };
  /** 简历文风样本（可选，R1 文风字段） */
  writing_style?: {
    greeting_tone: 'formal' | 'casual' | 'professional';
    resume_style_notes: string[];
    sample_greetings: string[];
  };
  /** 黑名单公司（R9） */
  blacklist: string[];
  updated_at: string;
}

/** 默认画像（老板 2026-08-12 裁定值） */
export const DEFAULT_PROFILE: UserProfile = {
  schema_version: 1,
  name: '',
  preferences: {
    min_net_salary: 5000,
    target_net_salary: 6000,
    weights: { stability: 0.45, salary: 0.35, location: 0.20 },
    locations: ['丽水'],
    remote_ok: true,
    pool_threshold: 4.0,
  },
  writing_style: undefined,
  blacklist: [],
  updated_at: new Date().toISOString(),
};

/** 校验画像合法性（T1 验收） */
export function validateProfile(p: UserProfile): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (p.preferences.min_net_salary <= 0) errors.push('底线薪资必须 > 0');
  if (p.preferences.target_net_salary <= p.preferences.min_net_salary)
    errors.push('期望薪资必须 > 底线薪资');
  const w = p.preferences.weights;
  const sum = w.stability + w.salary + w.location;
  if (Math.abs(sum - 1) > 0.001) errors.push(`权重之和须=1，当前 ${sum.toFixed(3)}`);
  if (p.preferences.pool_threshold < 1 || p.preferences.pool_threshold > 5)
    errors.push('投递池阈值须在 1–5');
  if (!p.preferences.locations.length && !p.preferences.remote_ok)
    errors.push('至少接受一个地点或远程');
  return { ok: errors.length === 0, errors };
}
