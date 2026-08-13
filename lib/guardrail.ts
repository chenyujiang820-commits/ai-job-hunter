/**
 * lib/guardrail.ts — 诚实护栏（PRD §13 / T4）
 *
 * 第二道防线：对 drafter 产出的每条 claim 逐条回源校验。
 *  - HARD（数字/公司/时间/奖项）：精确匹配 source，未命中 → reject
 *  - SOFT（职责/技能描述）：LLM-judge 判断是否可由 source 支撑，未命中 → review
 *
 * 第三道防线（人审）在 lib/package.ts 实现。
 */
import { callJSON } from './llm.ts';
import type { SourceResume } from '../shared/schema.ts';

export interface ClaimCheck {
  line: string;
  refs: string[];
  /** hard | soft */
  kind: 'hard' | 'soft';
  /** pass | fail | review */
  verdict: 'pass' | 'fail' | 'review';
  reason: string;
}

export interface GuardrailResult {
  job_id: string;
  checks: ClaimCheck[];
  /** 硬性：所有 hard 必须 pass；任一 fail → reject */
  hard_failures: ClaimCheck[];
  /** 软性：fail/review 需人审 */
  soft_reviews: ClaimCheck[];
  /** 最终：pass（可人审）| reject（退回重写）| review（人审决定） */
  verdict: 'pass' | 'reject' | 'review';
  summary: string;
}

/** 从简历草稿中抽取所有数字类 claim（HARD 候选） */
export function extractHardClaims(lines: string[]): Array<{ line: string; numbers: string[] }> {
  const out: Array<{ line: string; numbers: string[] }> = [];
  for (const line of lines) {
    // 金额/百分比/数量（万/元/%/间/户/次/人/家等，支持"70余家""30多人"约数词）
    const nums = line.match(/(\d+(?:\.\d+)?\s*(?:余|多|近|约)?\s*(?:万|元|%|间|户|次|人|家|名|位|个|份|期|条|套))/g) ?? [];
    if (nums.length) out.push({ line, numbers: nums });
  }
  return out;
}

/** 数字归一化：去空格、统一"余/多/约"等约数词 */
function normalizeNum(s: string): string {
  return s.replace(/\s+/g, '').replace(/^约/, '').replace(/余/g, '').replace(/多/g, '').replace(/近/g, '');
}

/** 解析数字 → 绝对值（万→×10000），供精确比较 */
interface ParsedNum { abs: number; ok: boolean }
function parseToAbs(s: string): ParsedNum {
  const clean = normalizeNum(s);
  // 金额/百分比/数量 + 单位
  const m = clean.match(/^(\d+(?:\.\d+)?)\s*(万|元|%|间|户|次|人|家|名|位|个|份|期|条|套|员工|年)?/);
  if (!m) return { abs: 0, ok: false };
  let v = parseFloat(m[1]!);
  const unit = m[2] ?? '';
  if (unit === '万') v *= 10_000;
  return { abs: v, ok: true };
}

/**
 * 禁用头衔清单（AGENTS.md 铁律1：头衔只允许 市场人员/项目成员/政企客户经理）。
 * 注意：「客户经理」是合法头衔「政企客户经理」的一部分，不得误禁。
 */
export const BANNED_TITLES = [
  '项目经理', '项目主管', '项目负责人', '团队负责人',
  '部门经理', '部门主管', '市场经理', '销售经理', '商务经理', '总监',
];

/**
 * 头衔违规检测（铁律1 技术门禁，2026-08-13 补上）：
 * 简历行出现禁用头衔 → 违规；否定语境（如「未担任项目经理」）属诚实表述 → 豁免。
 */
export function bannedTitleCheck(line: string): { banned: string[]; negated: string[] } {
  const banned: string[] = [];
  const negated: string[] = [];
  for (const t of BANNED_TITLES) {
    if (!line.includes(t)) continue;
    const neg = new RegExp(`(未|不|非|无)[^，。；,;]{0,8}${t}`);
    if (neg.test(line)) negated.push(t);
    else banned.push(t);
  }
  return { banned, negated };
}

/** 数值化比较：绝对值相等（±1 容差，处理 70余家≈70家 的约数差异） */
function absEqual(a: string, b: string): boolean {
  const pa = parseToAbs(a);
  const pb = parseToAbs(b);
  if (!pa.ok || !pb.ok) {
    // 解析失败（如 3.36/4.0、前5%）→ 退回归一化字符串包含比较
    const na = normalizeNum(a);
    const nb = normalizeNum(b);
    return na === nb || na.includes(nb) || nb.includes(na);
  }
  return Math.abs(pa.abs - pb.abs) <= 1;
}

/**
 * HARD 校验：line 中出现的每个数字，必须在 source 中能找到（允许约数词）
 * 数值化比较（绝对值相等），修复子串误判（273.9 不再被 7.9 误匹配）
 */
export function hardCheck(line: string, source: SourceResume): { missing: string[]; matched: string[] } {
  const allSourceNums: string[] = [];
  for (const e of source.experiences) {
    for (const m of e.metrics) {
      allSourceNums.push(normalizeNum(m.value));
      allSourceNums.push(normalizeNum(m.normalized));
    }
  }
  const found: string[] = [];
  const missing: string[] = [];
  const claims = extractHardClaims([line])[0];
  if (!claims) return { missing, matched: found };
  for (const rawNum of claims.numbers) {
    const hit = allSourceNums.some((sn) => absEqual(sn, rawNum));
    if (hit) found.push(rawNum);
    else missing.push(rawNum);
  }
  return { missing, matched: found };
}

/**
 * 全量护栏：对草稿所有 lines 校验。
 *  - hard claim（含数字）→ hardCheck
 *  - 其余 → soft（标记需 LLM-judge；M1 先用规则：引用 key 有效即 pass，否则 review）
 */
export function guardrail(source: SourceResume, sections: Array<{ lines: string[]; claims: string[][] }>, jobId: string): GuardrailResult {
  const checks: ClaimCheck[] = [];
  // 章节唯一性检测：同一 section 类型重复 → 结构性问题，直接 review 提示
  const sectionTypes = sections.map((s) => (s as { section?: string }).section ?? '');
  const dupSections = sectionTypes.filter((t, i) => t && sectionTypes.indexOf(t) !== i);
  if (dupSections.length > 0) {
    checks.push({
      line: `重复章节: ${[...new Set(dupSections)].join(', ')}（每个 section 只能出现一次，需合并）`,
      refs: [], kind: 'soft', verdict: 'review',
      reason: '结构问题：重复章节',
    });
  }
  const validKeys = new Set<string>();
  source.experiences.forEach((e, i) => {
    validKeys.add(`exp${i}`);
    e.duties.forEach((_, j) => validKeys.add(`exp${i}.duty${j}`));
    e.metrics.forEach((_, j) => validKeys.add(`exp${i}.metric${j}`));
    e.skills.forEach(() => validKeys.add(`exp${i}.skills`));
    if (e.education) validKeys.add('edu');
    e.education?.honors.forEach((_, j) => validKeys.add(`honor${j}`));
  });

  sections.forEach((sec, si) => {
    sec.lines.forEach((line, li) => {
      const refs = sec.claims[li] ?? [];
      // 引用有效性（key 必须存在于 source）
      const badRefs = refs.filter((r) => !validKeys.has(r));
      const hasNumber = extractHardClaims([line]).length > 0;

      // 铁律1 技术门禁：禁用头衔（如「项目经理」）→ 硬失败 reject；否定语境豁免
      const titleCheck = bannedTitleCheck(line);
      if (titleCheck.banned.length) {
        checks.push({
          line, refs, kind: 'hard', verdict: 'fail',
          reason: `头衔违反铁律1（只允许：市场人员/项目成员/政企客户经理）: ${titleCheck.banned.join(', ')}`,
        });
        return;
      }

      let verdict: ClaimCheck['verdict'] = 'pass';
      let reason = '';

      if (hasNumber) {
        const { missing } = hardCheck(line, source);
        if (missing.length) {
          verdict = 'fail';
          reason = `HARD 未命中 source 数字: ${missing.join(', ')}`;
        } else {
          verdict = 'pass';
          reason = 'HARD 数字全部可回源';
        }
      } else if (badRefs.length) {
        verdict = 'review';
        reason = `引用无效 key: ${badRefs.join(', ')}`;
      } else {
        // SOFT：引用有效即放行（M1 简化，P9 后续加 LLM-judge）
        verdict = 'pass';
        reason = 'SOFT 引用有效';
      }

      checks.push({ line, refs, kind: hasNumber ? 'hard' : 'soft', verdict, reason });
    });
  });

  const hard_failures = checks.filter((c) => c.kind === 'hard' && c.verdict === 'fail');
  const soft_reviews = checks.filter((c) => c.verdict === 'review');

  let verdict: GuardrailResult['verdict'] = 'pass';
  if (hard_failures.length) verdict = 'reject';
  else if (soft_reviews.length) verdict = 'review';

  return {
    job_id: jobId,
    checks,
    hard_failures,
    soft_reviews,
    verdict,
    summary: `共${checks.length}条 claim：HARD ${checks.filter((c) => c.kind === 'hard').length}条，SOFT ${checks.filter((c) => c.kind === 'soft').length}条；硬失败${hard_failures.length}，软复核${soft_reviews.length}`,
  };
}
