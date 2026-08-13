/**
 * lib/jd-analyzer.ts — JD 需求分析器（吸收 ResumeSkills/job-description-analyzer 方法论）
 *
 * 能力：
 *  1. 需求分类：must-have（硬性）/ nice-to-have（加分）/ 软技能文化
 *  2. 关键词提取：从 JD 中提取技能关键词
 *  3. 关键词匹配度：JD 关键词 vs 简历技能/职责的命中率
 *  4. 短板识别：JD 要求但简历没有的能力 → 供 draft 诚实带过 / review 检查
 */
import type { SourceResume, Job } from '../shared/schema.ts';

export interface JDRequirement {
  text: string;
  category: 'must' | 'nice' | 'soft';
}

export interface JDAnalysis {
  job_id: string;
  requirements: JDRequirement[];
  /** 从 JD 提取的关键词（含归一化） */
  keywords: string[];
  /** JD 关键词在简历中的命中情况 */
  keywordMatch: Array<{ keyword: string; hit: boolean }>;
  /** 命中率 0-1 */
  matchRate: number;
  /** JD 要求但简历明显缺失的能力（供 draft 诚实处理） */
  gaps: string[];
}

/** 软技能/文化类词汇（不构成硬门槛） */
const SOFT_WORDS = [
  '沟通', '抗压', '责任心', '团队', '协作', '学习', '主动', '逻辑',
  '表达', '执行', '适应', '细心', '耐心', '乐观', '敬业', '灵活',
];

/** JD 关键词提取（规则版，不调 LLM，保证可测试） */
const NOISE_WORDS = ['力强', '良好', '较好', '优秀的', '相关经验', '能力强', '意识', '能力', '工作', '负责项目', '确保项目', '组织项目', '负责通信类项目'];

export function extractKeywords(jd: string): string[] {
  const kws = new Set<string>();
  // 动词/介词引导的核心词：优先匹配"动词+2-6字名词"（避免整句长短语）
  const verbPatterns = [
    /(?:负责|熟悉|掌握|精通|了解|具备|使用|有|拥有|从事|参与|独立|能|擅长|确保|协调|推动|组织|开展|完成|跟进)\s*([\u4e00-\u9fa5A-Za-z0-9+\-]{2,8})/g,
  ];
  for (const re of verbPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(jd)) !== null) {
      let w = m[1]?.trim() ?? '';
      // 循环裁剪后缀噪音（经验/能力/相关/优先/流程等，可能多个叠加）
      let prev = '';
      while (prev !== w) {
        prev = w;
        w = w.replace(/(经验|能力|工作|相关|的|等|优先|流程|事项|意识|力强)$/g, '');
      }
      // 裁剪前缀噪音（动词残留）
      w = w.replace(/^(负责|有|拥有|参与|从事|使用|具备|熟悉|掌握|精通|确保|协调|推动|组织|开展|完成|跟进)/g, '');
      if (w.length >= 2 && w.length <= 8 && !SOFT_WORDS.some((s) => w.includes(s)) && !NOISE_WORDS.includes(w)) {
        kws.add(w);
      }
    }
  }
  // 补：领域名词模式（XX管理/XX项目/XX系统/XX方案/XX平台）
  const nounPatterns = [
    /([\u4e00-\u9fa5]{2,6}(?:管理|项目|系统|平台|方案|推广|销售|运营|维护|开发|设计|分析|培训|招标|投标|营销|经验))/g,
  ];
  for (const re of nounPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(jd)) !== null) {
      const w0 = m[1];
      if (!w0) continue;
      let w = w0;
      w = w.replace(/(经验)$/g, '');
      if (w.length >= 2 && w.length <= 8 && !SOFT_WORDS.some((s) => w.includes(s)) && !NOISE_WORDS.includes(w)) kws.add(w);
    }
  }
  // 名词模式补充后，做核心词去重：保留最短的关键词
  const deduped = new Set<string>();
  const sorted = [...kws].sort((a, b) => a.length - b.length);
  for (const w of sorted) {
    // 若已有更短词是 w 的子串，跳过（保留更精确的短词）
    if ([...deduped].some((d) => w.includes(d) && d.length >= 2)) continue;
    deduped.add(w);
  }
  return [...deduped].slice(0, 25);
}

/** 把简历内容展平成可搜索文本（技能 + 职责 + 总结） */
function resumeText(source: SourceResume): string {
  const parts: string[] = [source.summary];
  for (const e of source.experiences) {
    parts.push(...e.duties, ...e.skills);
  }
  return parts.join('\n');
}

/** 通用词：子串匹配时跳过（避免"项目/管理"这类泛词误命中） */
const GENERIC_WORDS = ['项目', '管理', '系统', '平台', '方案', '工作', '相关', '能力', '经验', '推进', '协调', '确保', '负责', '良好', '组织', '需求', '客户', '团队', '沟通', '计划', '实施', '交付', '资源', '直接', '参与'];

/** 核心词命中判断：精确包含，或关键词中 3-6 字非通用子串出现在简历文本中 */
export function coreHit(keyword: string, text: string): boolean {
  // ① 精确包含（最高优先级）
  if (text.includes(keyword)) return true;
  // ② 关键词去掉通用后缀后的核心部分（如"项目管理"→"项目"仅剩泛词则放弃）
  const core = keyword.replace(/(经验|能力|工作|相关|的|等|优先|流程|事项|管理|项目)$/g, '');
  if (core.length >= 2 && !GENERIC_WORDS.includes(core) && text.includes(core)) return true;
  // ③ 子串匹配：优先 3-6 字非通用子串；若无命中，再试 2 字实义词
  const maxLen = Math.min(6, keyword.length);
  for (let len = maxLen; len >= 3; len--) {
    for (let i = 0; i + len <= keyword.length; i++) {
      const sub = keyword.slice(i, i + len);
      if (GENERIC_WORDS.some((g) => sub.includes(g))) continue; // 跳过含通用词的片段
      if (text.includes(sub)) return true;
    }
  }
  // 2 字实义词（如"通信""销售"）——跳过纯泛词（项目/管理/工作/方案等已在 GENERIC_WORDS）
  for (let i = 0; i + 2 <= keyword.length; i++) {
    const sub = keyword.slice(i, i + 2);
    if (GENERIC_WORDS.includes(sub) || NOISE_WORDS.includes(sub)) continue;
    if (text.includes(sub)) return true;
  }
  return false;
}

/**
 * 分析 JD 与简历匹配度
 */
export function analyzeJD(job: Job, source: SourceResume): JDAnalysis {
  const jd = job.job_description ?? '';
  const requirements: JDRequirement[] = [];

  // 需求分类：按行拆 JD，含"优先/加分/了解即可"→ nice；含软词且短句 → soft；否则 must
  const lines = jd.split(/[\n。；;]/).map((s) => s.trim()).filter((s) => s.length >= 4);
  for (const line of lines) {
    let category: JDRequirement['category'] = 'must';
    if (/优先|加分|了解即可|熟悉更佳|有.*更好|可放宽/.test(line)) category = 'nice';
    else if (SOFT_WORDS.some((w) => line.includes(w)) && line.length < 30) category = 'soft';
    requirements.push({ text: line.slice(0, 60), category });
  }

  const keywords = extractKeywords(jd);
  const text = resumeText(source);

  const keywordMatch = keywords.map((kw) => ({ keyword: kw, hit: coreHit(kw, text) }));
  const hits = keywordMatch.filter((k) => k.hit).length;
  const matchRate = keywords.length > 0 ? hits / keywords.length : 0;

  // 短板：must 类关键词未命中 → gap（同样用核心词判断）
  const mustKws = requirements
    .filter((r) => r.category === 'must')
    .flatMap((r) => extractKeywords(r.text));
  const gaps = [...new Set(mustKws)].filter((kw) => !coreHit(kw, text)).slice(0, 8);

  return { job_id: job.id, requirements, keywords, keywordMatch, matchRate, gaps };
}

/** 匹配度 → 投递建议（借鉴 ResumeSkills：70-90% 为黄金区间） */
export function matchAdvice(matchRate: number): string {
  if (matchRate >= 0.7) return '高匹配（70%+）：值得深度定制后投递';
  if (matchRate >= 0.5) return '中匹配（50-70%）：可投，需在总结中诚实补强';
  if (matchRate >= 0.3) return '低匹配（30-50%）：谨慎投递，优先补短板';
  return '极低匹配（<30%）：不建议投递，避免无效消耗';
}
