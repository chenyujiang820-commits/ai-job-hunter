/**
 * lib/draft.ts — 简历 drafter（PRD R4 / T3）
 *
 * 铁律（PRD §13 诚实护栏第一道防线）：
 *  1. 只能使用 source_resume.json 中的事实，禁止编造
 *  2. JD 要求但 source 没有 → 不写"精通"，改写"愿意学习/有基础了解"
 *  3. 输出结构化 JSON，后续由 guardrail 逐条回源校验
 */
import { callJSON } from './llm.ts';
import type { SourceResume, Job } from '../shared/schema.ts';

export interface DraftedSection {
  /** 简历章节：summary | experience | skills | education */
  section: string;
  /** 章节标题（如公司名+岗位） */
  title: string;
  /** 正文行（bullet 级） */
  lines: string[];
  /** 每个 line 引用的事实来源 key（供护栏回源），格式如 "experiences[1].duties[0]" */
  claims: string[][];
}

export interface DraftResult {
  job_id: string;
  sections: DraftedSection[];
  /** 系统提示词（用于可审计/复现） */
  prompt_version: string;
  generated_at: string;
}

/** 把源简历压缩成 LLM 可用的紧凑事实清单（只取最相关字段，控制 token 预算） */
function buildFactSheet(source: SourceResume): string {
  const parts: string[] = [];
  parts.push(`${source.name}｜${source.phone}｜${source.email}｜${source.location}｜${source.political ?? ''}`);
  parts.push(`总结:${source.summary.slice(0, 120)}`);
  for (let i = 0; i < source.experiences.length; i++) {
    const e = source.experiences[i];
    if (!e) continue;
    parts.push(`[exp${i}]${e.company}|${e.role}|${e.start}~${e.end}`);
    e.duties.slice(0, 3).forEach((d, j) => parts.push(`[exp${i}.duty${j}]${d.slice(0, 60)}`));
    e.metrics.slice(0, 5).forEach((m, j) => parts.push(`[exp${i}.metric${j}]${m.value}(${m.description.slice(0, 30)})`));
    if (e.education) {
      parts.push(`[edu]${e.education.school}|${e.education.major}|${e.education.period}|GPA:${e.education.gpa ?? ''}`);
      e.education.honors.slice(0, 3).forEach((h) => parts.push(`[honor]${h}`));
    }
  }
  parts.push(`禁用:${source.retracted_claims.join('；').slice(0, 120)}`);
  // 数字白名单：把 source 中所有数字显式列出，LLM 只能原样引用这些数字，出现白名单外的数字即编造
  const numSet = new Set<string>();
  const collect = (s: string) => {
    const nums = s.match(/\d+(?:\.\d+)?\s*(?:万|元|%|余|多|家|所|户|次|人|名|位|个|份|期|条|套|间|年)?/g) ?? [];
    nums.forEach((n) => numSet.add(n.replace(/\s+/g, '')));
  };
  collect(source.summary);
  for (const e of source.experiences) {
    e.duties.forEach(collect);
    e.metrics.forEach((m) => collect(`${m.value}${m.description}`));
    e.skills.forEach(collect);
    if (e.education) {
      collect(e.education.gpa ?? '');
      e.education.honors.forEach(collect);
    }
  }
  parts.push(`【数字白名单】（只能原样引用以下数字，禁止出现白名单外的数字，禁止把多个数字相加）: ${[...numSet].slice(0, 40).join('、')}`);
  return parts.join('\n');
}

const SYSTEM_PROMPT = `你是资深简历优化师。根据【事实清单】为指定岗位定制简历。
铁律：
1. 只允许使用事实清单中出现的内容；数字、公司名、时间、奖项一律不得改动或编造。
2. JD 要求但事实清单没有的 → 禁止写"精通/擅长/主导"，可写"有基础了解/愿意学习/相关经历"。
3. 禁止出现事实清单「禁用表述」中的措辞（如把"项目成员"写成"项目负责人"）。
4. JD 对齐：逐条对照 JD 的职责与要求，从事实清单中挑选最相关的事实来呼应（如 JD 要"方案编写"就突出方案/材料相关经历）；呼应不了的 JD 要求，用一句"愿意学习/有基础了解"诚实带过，不要硬凑。
5. 数字必须与事实清单完全一致，出现"总计"时确保与明细之和相符（例如 245.8+7.9+20=273.7）。
6. 禁止自行汇总/推导新数字（如把多个项目金额相加得到"900万"），只允许原样引用事实清单中已存在的单一数字；确需总述时，引用清单中已有的"合计"条目。
6b. 数字清单制：事实清单中列出的每个金额/数量是"独立事实"，写简历时只能逐个原样引用，绝不允许把多个数字相加、相乘或合并成新数字。写完每行后自查：这行里的每个数字是否都能在事实清单中逐字找到？找不到就是编造，删掉。
7. 输出严格 JSON，不要 markdown 包裹。
7b. 章节唯一性：sections 中每个 section 类型（summary/experience/skills/education）只能出现一次；education 只输出一个章节，荣誉合并在该章节的 lines 里。禁止重复输出相同章节。
8. 身份诚实（最高铁律）：经历中的角色头衔（如"市场人员""项目成员"）必须与事实清单完全一致，禁止因岗位是"项目经理/主管/负责人"就自行升格为"项目经理/项目负责人/主管"。JD 要求的管理岗位，用"参与项目全流程/协调资源/推动落地"等真实经历来呼应，明确写出"在实际工作中承担项目协调与推进职责（未担任正式管理职务）"或类似诚实表述，让 HR 从真实经历中判断你的管理潜力，而不是虚构头衔。

写作方法论（在铁律内最大化表达力）：
A. X-Y-Z 公式（谷歌方法）：每一条职责优先按"完成[X]，以[Y]衡量，通过[Z]实现"组织——X=做了什么，Y=量化结果（必须来自事实清单），Z=怎么做。例："负责丽水地区40+所学校、7+区县教育局市场开拓（X），覆盖方案设计-招投标-验收全流程（Z）"。
B. 量化优先：职责行尽量带上事实清单中已有的数字（金额/数量/次数/覆盖范围），数字必须原样引用，禁止新造。
C. 动词强化：行首用强动词（负责/主导/跟进/推动/落地/完成/达成），避免"参与/协助/了解"开头的弱表述（除非事实清单本身就是"参与"）。
D. 技能栏重排：把 JD 中出现的技能关键词排在最前，其余技能按相关度降序，技能名必须来自事实清单。
E. 个人总结定制：用 2-3 条呼应 JD 核心要求（必须基于事实清单），JD 没有的经验领域用"有基础了解/愿意学习"诚实提及。
F. 每条职责只写一件具体事，不写空话套话（如"具有良好的沟通能力"这类无事实支撑的形容词句）。

输出格式：
{"sections":[{"section":"summary","title":"个人总结","lines":["..."],"claims":[["exp0.duty0"],...]},
{"section":"experience","title":"公司 | 岗位","lines":["职责改写（保留原数字）","..."],"claims":[["exp1.duty0","exp1.metric0"],...]},
{"section":"skills","title":"技能","lines":["技能1、技能2"],"claims":[["exp1.skills"],...]},
{"section":"education","title":"教育背景","lines":["学校 | 专业 | 学历 | 时间"],"claims":[["edu"],...]}]}
每条 lines 必须给出 claims（引用事实清单中的 key 列表）。`;

/**
 * 生成岗位定制简历（T1 Flash 起草）
 * @param source 源简历（真相源）
 * @param job 目标岗位
 * @param extraConstraints 岗位级诚实约束（可选，如 boss-06 的 honest_constraints）
 */
export async function draftResume(source: SourceResume, job: Job, extraConstraints: string[] = []): Promise<DraftResult> {
  const factSheet = buildFactSheet(source);
  const constraintsBlock = extraConstraints.length
    ? `\n【岗位专属诚实约束】（必须逐条遵守，与铁律同优先级）\n${extraConstraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : '';
  const userPrompt = `【岗位信息】
标题:${job.title}
公司:${job.company}
行业:${job.industry}
JD:${job.job_description}
${constraintsBlock}
【事实清单】
${factSheet}

请为该岗位生成定制简历 JSON。`;

  const out = await callJSON<{ sections: DraftedSection[] }>('T1', [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], {
    temperature: 0.4,
    maxTokens: 3000,
    // draft 是生成任务，关闭推理节省 token（避免 reasoning 耗尽预算导致空 content）
    extra: { reasoning_effort: 'none' },
  });

  return {
    job_id: job.id,
    sections: out.sections,
    prompt_version: 'draft-v1',
    generated_at: new Date().toISOString(),
  };
}

/** 从源简历提取所有事实 key（供护栏校验引用有效性） */
export function collectFactKeys(source: SourceResume): Set<string> {
  const keys = new Set<string>();
  source.experiences.forEach((e, i) => {
    keys.add(`exp${i}`);
    e.duties.forEach((_, j) => keys.add(`exp${i}.duty${j}`));
    e.metrics.forEach((_, j) => keys.add(`exp${i}.metric${j}`));
    if (e.education) {
      keys.add('edu');
      e.education.honors.forEach((_, j) => keys.add(`honor${j}`));
    }
    e.skills.forEach((_, j) => keys.add(`exp${i}.skills`));
  });
  return keys;
}
