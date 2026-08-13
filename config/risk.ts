/**
 * config/risk.ts — 风控配置（PRD §12 前置 3 / §14.3）
 * BOSS 安全阈值（来自 boss-auto-apply 对标，PRD §5）：
 *   4–10s 随机间隔、150 份/日上限、14 天活跃过滤
 */
export const RISK = {
  /** 投递间隔随机区间（ms）—— 4–10s */
  minDelayMs: 4000,
  maxDelayMs: 10_000,

  /** 每日投递上限（BOSS 安全阈值，非目标量） */
  dailyLimit: 150,

  /** 招人方 14 天活跃过滤 */
  recruiterActiveDays: 14,

  /** Cookie / 登录态持久化路径（M2 交互层用） */
  cookiePath: 'data/session/cookies.json',

  /** 验证码人工介入标志：触发即暂停批次并通知老板（PRD §14.3） */
  captchaMode: 'manual' as 'manual' | 'auto',

  /** 熔断配置（PRD §14.3）：连续异常次数 → cooldown */
  circuitBreaker: {
    consecutiveErrors: 3,
    cooldownMs: 30 * 60 * 1000,   // 30min
    probeBatchSize: 5,            // 熔断后小批量试探
  },

  /** 请求指纹伪装（M2 用，M1 不涉及） */
  fingerprint: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  },
} as const;

/** 随机延时（4–10s 区间内） */
export function randomDelayMs(): number {
  return Math.floor(RISK.minDelayMs + Math.random() * (RISK.maxDelayMs - RISK.minDelayMs));
}
