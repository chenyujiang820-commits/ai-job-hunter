/**
 * lib/score.ts — 岗位评估引擎（PRD R3 / T2 / §14.1）
 *
 * 八子维度加权（§14.1.1，老板 2026-08-12 裁定，来源《求职岗位评分表_蒋辰宇.xlsx》）：
 *   ①主体性质15% ②行业前景10% ③岗位性质10% ④财务健康10% ⑤薪资水平25% ⑥薪资结构10% ⑦通勤居住12% ⑧工作模式8%
 * 薪资口径=到手（税前 × 0.86）；面议默认 2 分；稳定性需工商数据（JD 推断+可补）。
 * 合法性块 L1–L8 命中即过滤/标记（§14.1）。
 */
import type { Job, ScoreResult, SubDimId, Verdict, FlagId } from '../shared/schema.ts';
import type { UserProfile } from '../data/profile.schema.ts';

/** 子维度权重表（§14.1.1） */
export const SUB_WEIGHTS: Record<SubDimId, number> = {
  s1: 0.15, // 主体性质
  s2: 0.10, // 行业前景
  s3: 0.10, // 岗位性质
  s4: 0.10, // 财务健康
  s5: 0.25, // 薪资水平
  s6: 0.10, // 薪资结构
  s7: 0.12, // 通勤居住
  s8: 0.08, // 工作模式
};

/** 到手换算系数（PRD §14.1.1） */
export const NET_SALARY_RATIO = 0.86;

/** 薪资文本解析：返回税前月薪区间（K=千/月，W=万/月）；时薪/日薪按 22 天×8 时折算月薪 */
export function parseSalary(job: Job): { min: number; max: number } | null {
  if (job.salary_range) {
    const unit = job.salary_range.unit === 'W' ? 10_000 : 1000;
    return {
      min: job.salary_range.min * unit,
      max: job.salary_range.max * unit,
    };
  }
  const t = job.salary_text ?? '';
  // "80-150元/时" / "50-500元/小时" → 折算月薪（22天×8时），区间过大时封顶（防止虚高）
  const hourly = t.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*元\/(?:小?时)/);
  if (hourly) {
    let min = Number(hourly[1]) * 22 * 8;
    let max = Number(hourly[2]) * 22 * 8;
    // 时薪区间过大（上限 > 下限 3 倍）→ 按"中位数×1.5"封顶上限，保守折算
    const mid = (min + max) / 2;
    if (max > min * 3) max = Math.round(mid * 1.5);
    return { min, max };
  }
  // "200-300元/天" → 折算月薪（22天），同样封顶
  const daily = t.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*元\/天/);
  if (daily) {
    let min = Number(daily[1]) * 22;
    let max = Number(daily[2]) * 22;
    const mid = (min + max) / 2;
    if (max > min * 3) max = Math.round(mid * 1.5);
    return { min, max };
  }
  // "8-13K" / "8K-13K" / "8-13k"
  const kMatch = t.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (kMatch) return { min: Number(kMatch[1]) * 1000, max: Number(kMatch[2]) * 1000 };
  // "1-2万" / "10-20K·13薪" 先取 K 模式
  const wMatch = t.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (wMatch) return { min: Number(wMatch[1]) * 10_000, max: Number(wMatch[2]) * 10_000 };
  // 单值 "8K" / "8k以上" / "8k+"
  const single = t.match(/(\d+(?:\.\d+)?)\s*[kK](?:\s*以上|\s*\+)?/);
  if (single) {
    const v = Number(single[1]) * 1000;
    return { min: v, max: v };
  }
  return null;
}

/** 是否面议（无数字区间） */
export function isNegotiable(job: Job): boolean {
  const t = (job.salary_text ?? '').trim();
  return /面议|薪资面议|协商/.test(t) || (!parseSalary(job) && !job.salary_range);
}

/** ⑤ 薪资水平（到手口径）—— 锚点：5=≥6600 4=6000-6599 3=5000-5999 2=4500-4999 1=<4500 */
export function scoreSalary(job: Job, profile: UserProfile): { score: number; net: number } {
  const parsed = parseSalary(job);
  if (!parsed) return { score: 2, net: 0 }; // 面议/无法解析 → 默认 2 分（L1 裁定）
  const gross = parsed.min; // 保守：按区间下限
  const net = Math.round(gross * NET_SALARY_RATIO);
  const min = profile.preferences.min_net_salary;
  const target = profile.preferences.target_net_salary;
  let score: number;
  if (net >= target * 1.1) score = 5;
  else if (net >= target) score = 4;
  else if (net >= min) score = 3;
  else if (net >= min * 0.9) score = 2;
  else score = 1;
  return { score, net };
}

/** ② 行业前景 —— 政策刚需=5 稳定增长=4 成熟饱和=3 夕阳=2 政策风险=1 */
const INDUSTRY_HOT = ['教育', '医疗', '信创', '国产化', '人工智能', 'AI', '智能体', '新能源', '信息化', '数字化', '通信', '智慧', '科技'];
const INDUSTRY_RISK = ['房地产', '教培', 'K12', '课外培训', 'P2P', '金融杠杆', '虚拟货币'];
export function scoreIndustry(job: Job): number {
  const ind = job.industry ?? '';
  const title = job.title ?? '';
  const jd = job.job_description ?? '';
  // 政策风险行业（K12 教培尤其，双减后高危）
  if (INDUSTRY_RISK.some((k) => (ind + title).includes(k))) return 1;
  // 你的核心优势领域（信息化/通信/教育科技）—— 高前景
  if (INDUSTRY_HOT.some((k) => (ind + title).includes(k))) return 5;
  // 温和行业默认 3–4：有实体业务算 4
  if (/制造|软件|信息|服务/.test(ind + jd)) return 4;
  return 3;
}

/** ③ 岗位性质 —— 事业编/直雇=5 直雇=4 高流动=3 外包派遣=2 临时=1 */
export function scoreEmployment(job: Job): number {
  const t = job.employment_type ?? '';
  const jd = job.job_description ?? '';
  const title = job.title ?? '';
  if (/外包|派遣|劳务/.test(t + jd)) return 2;
  // 高流动岗：电销/地推/陌拜/低端销售（To B/商务/客户经理是你强项，不扣分）
  if (/电话销售|电销|地推|陌拜|扫楼|刷单/.test(title + jd)) return 3;
  if (/编制|事业|公务员/.test(t + jd)) return 5;
  if (/全职/.test(t) || t === '') return 4;
  if (/实习|兼职|临时/.test(t)) return 1;
  return 4;
}

/** ④ 财务健康 —— 有工商数据用数据，否则按公司性质推断（M1 由老板补，缺省 3 保守） */
export function scoreFinancial(job: Job): number {
  const m = job.company_meta;
  if (!m) return 3; // 无工商数据 → 保守 3 分（PRD §14.1.1：验证集由老板手动补）
  if (m.legal_risks && m.legal_risks.length > 0) return 1;
  if (m.listed) return 5;
  if (m.insured_count && m.insured_count >= 50) return 4;
  if (m.registered_capital && /实缴/.test(m.registered_capital)) return 4;
  if (m.founded_year && (new Date().getFullYear() - m.founded_year) >= 5) return 3;
  return 2;
}

/** ① 主体性质 —— 公办/国企=5 上市公司/龙头=4 正规民企5年+=3 1-5年=2 初创/皮包=1 */
export function scoreNature(job: Job): number {
  const m = job.company_meta;
  const nature = m?.nature ?? '';
  if (/公办|事业|国企|央企|政府/.test(nature)) return 5;
  if (m?.listed || /上市/.test(nature)) return 4;
  const founded = m?.founded_year;
  if (founded) {
    const age = new Date().getFullYear() - founded;
    if (age >= 5) return 3;
    if (age >= 1) return 2;
    return 1;
  }
  if (/初创|新成立|成立不久/.test(nature)) return 1;
  return 3; // 未知按正规民企保守
}

/** ⑥ 薪资结构 —— 13-16薪+全额=5 13薪=4 最低基数=3 无公积金=2 底薪提成=1 */
export function scoreStructure(job: Job): number {
  const t = (job.job_description ?? '') + (job.salary_text ?? '');
  if (/底薪|全靠提成|无底薪/.test(t)) return 1;
  if (/无公积金|不交公积金/.test(t)) return 2;
  if (/最低基数/.test(t)) return 3;
  if (/1[3-6]薪|年终奖/.test(t)) return /全额|实缴/.test(t) ? 5 : 4;
  if (/五险一金|公积金/.test(t)) return 4;
  return 3;
}

/** ⑦ 通勤居住 —— 丽水本地<30min=5 同城30-60=4 省内异地=3 省外2h=2 远距离=1 */
export function scoreLocation(job: Job, profile: UserProfile): number {
  if (job.remote) return 3; // 远程=3（老板裁定）
  const loc = job.location ?? '';
  const home = profile.preferences.locations;
  if (home.some((h) => loc.includes(h))) return 5;
  if (/杭州|金华|温州|台州|衢州|宁波/.test(loc)) return 3; // 省内
  if (/上海|江苏|福建|江西|安徽/.test(loc)) return 2; // 省外近邻
  return 1;
}

/** ⑧ 工作模式 —— 双休+弹性=5 双休=4 大小周=3 单休=2 单休+出差=1 */
export function scoreSchedule(job: Job): number {
  const t = (job.job_description ?? '') + (job.work_schedule ?? '');
  if (/单休|上六休一/.test(t)) return /出差|加班频繁/.test(t) ? 1 : 2;
  if (/大小周/.test(t)) return 3;
  if (/双休/.test(t)) return /弹性|不打卡/.test(t) ? 5 : 4;
  return 3; // 未说明默认 3
}

/** ⑨ 技能匹配 —— 岗位 JD 命中你的核心优势领域（通信/信息化/教育/AI/招投标/客户/方案） */
const SKILL_KEYWORDS: Array<[RegExp, string]> = [
  [/通信|5G|网络|基站|宽带|光缆|物联网/, '通信'],
  [/信息化|数字化|智慧|系统集成|项目集成|解决方案/, '信息化'],
  [/教育|学校|教学|培训|课程/, '教育'],
  [/AI|人工智能|智能体|大模型|智能/, 'AI'],
  [/招标|投标|标书|采购流程|合同/, '招投标'],
  [/客户|政企|销售|商务|市场|推广/, '客户市场'],
  [/方案|需求分析|项目管理|协调|汇报/, '方案协调'],
];
export function scoreSkillMatch(job: Job): number {
  const text = `${job.title ?? ''} ${job.job_description ?? ''} ${job.industry ?? ''}`;
  let hits = 0;
  for (const [re] of SKILL_KEYWORDS) {
    if (re.test(text)) hits++;
  }
  if (hits >= 4) return 5;
  if (hits === 3) return 4;
  if (hits === 2) return 3;
  if (hits === 1) return 2;
  return 1;
}

/** 地点硬过滤（L4）：工作地 ≠ 丽水 且非远程 → fail */
export function locationHardFilter(job: Job, profile: UserProfile): boolean {
  if (job.remote && profile.preferences.remote_ok) return true;
  const loc = job.location ?? '';
  return profile.preferences.locations.some((h) => loc.includes(h));
}

/** 合法性块 L1–L8（命中返回 flag id，未命中 null） */
export function checkLegal(job: Job, profile: UserProfile): FlagId[] {
  const flags: FlagId[] = [];
  const t = (job.job_description ?? '') + (job.salary_text ?? '') + (job.title ?? '');
  if (isNegotiable(job)) flags.push('L1'); // 面议 → 2分不滤（老板裁定）
  if (/垫付|押金|培训费|入会费|轻松日结|无需经验高薪|刷单/.test(t)) flags.push('L2');
  if (/押金|保证金|服装费|体检费/.test(t)) flags.push('L3');
  if (!locationHardFilter(job, profile)) flags.push('L4');
  if (/包过|guaranteed offer|100%录取|保录取/.test(t)) flags.push('L8');
  // L5 低相关：标题/行业与你的职业方向（市场/销售/项目/教育信息化/客户/方案）明显无关 → 过滤
  // 方向关键词：命中任一即相关；无关信号词（医生/护士/老师授课/监理/施工/厨师等）→ 低相关
  const title = job.title ?? '';
  const ind = job.industry ?? '';
  const dirRelevant = /市场|销售|商务|客户|项目|方案|教育|培训|课程|信息化|数字化|运营|推广|顾问|咨询|经理|专员|主管|助理/.test(title + ind);
  // 无关信号词（注意：课程顾问/教育咨询 是相关方向，不能误伤；纯授课/纯导购/医疗/施工 才是无关）
  const dirIrrelevant =
    /医生|护士|药师|护理|康复治疗|监理|施工员|土建|厨师|司机|保安|保洁|讲解员|导购(?!顾问)|家教老师|授课老师|一对一授课|线上授课/.test(title);
  // 时薪/日薪 + 兼职/线上 特征 → 非全职方向，标 L5（你要全职，时薪家教/兼职岗不符）
  const isHourly = /元\/(?:小?时|天)/.test(job.salary_text ?? '');
  const isPartTime = /兼职|日结|家教|线上授课|一对一|1对1|时间自由|可居家/.test(title);
  if ((!dirRelevant || dirIrrelevant) || (isHourly && isPartTime)) flags.push('L5');
  // L6 低于底线 / L7 空壳 —— 在 score() 中结合其他维度判定
  const parsed = parseSalary(job);
  if (parsed && parsed.min * NET_SALARY_RATIO < profile.preferences.min_net_salary * 0.9) flags.push('L6');
  // L7 空壳/高风险：未认证、新注册、外包派遣（外包→review 进人审，老板裁定）
  if (
    job.company_meta?.insured_count === 0 ||
    /未认证|新注册/.test(job.company_meta?.nature ?? '') ||
    /外包|派遣|劳务/.test((job.employment_type ?? '') + (job.job_description ?? ''))
  ) {
    flags.push('L7'); // 同一岗位只标记一次（2026-08-13 修复重复 push）
  }
  return flags;
}

/** 主入口：评估一个岗位 */
export function scoreJob(job: Job, profile: UserProfile): ScoreResult {
  // 地点硬过滤前置
  if (!locationHardFilter(job, profile)) {
    return {
      score: 0, subscores: { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0, s7: 0, s8: 0 },
      flags: ['L4'], passed: 'fail',
      reasons: [`地点硬过滤：${job.location ?? '未知'} 不在接受列表`],
      meta: { location_ok: false, model: 'rule-based', scored_at: new Date().toISOString() },
    };
  }

  const s1 = scoreNature(job);
  const s2 = scoreIndustry(job);
  const s3 = scoreEmployment(job);
  const s4 = scoreFinancial(job);
  const { score: s5, net } = scoreSalary(job, profile);
  const s6 = scoreStructure(job);
  const s7 = scoreLocation(job, profile);
  const s8 = scoreSchedule(job);
  // ⑨ 技能匹配加分（不进 subscores/权重表，作为加分项）：命中≥4类 +0.5，3类 +0.3，2类 +0.1
  const s9 = scoreSkillMatch(job);
  const matchBonus = s9 >= 4 ? 0.5 : s9 === 3 ? 0.3 : s9 === 2 ? 0.1 : 0;

  const subscores = { s1, s2, s3, s4, s5, s6, s7, s8 };
  const total = (Object.keys(SUB_WEIGHTS) as SubDimId[]).reduce((acc, k) => acc + subscores[k] * SUB_WEIGHTS[k], 0);
  const score = Math.round((total + matchBonus) * 10) / 10;

  const flags = checkLegal(job, profile);
  const reasons: string[] = [
    `①主体性质${s1} ②行业${s2} ③岗位性质${s3} ④财务${s4}`,
    `⑤薪资${s5}(到手${net}) ⑥结构${s6} ⑦通勤${s7} ⑧模式${s8}`,
    `⑨技能匹配${s9}类(加分${matchBonus > 0 ? '+' + matchBonus : 0})`,
  ];
  if (flags.length) reasons.push(`合法性: ${flags.join(',')}`);

  // passed 判定：L2/L3/L5/L8 硬滤 → fail；L4 已前置；L6 低薪 → fail；L7 → review（外包进人审）
  let passed: Verdict = 'pass';
  if (flags.some((f) => ['L2', 'L3', 'L5', 'L8'].includes(f))) passed = 'fail';
  else if (flags.includes('L6')) passed = 'fail';
  else if (flags.some((f) => ['L7'].includes(f))) passed = 'review';

  return {
    score, subscores, flags, passed, reasons,
    meta: { salary_net: net, location_ok: true, model: 'rule-based', scored_at: new Date().toISOString() },
  };
}
