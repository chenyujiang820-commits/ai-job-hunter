/**
 * lib/setup.ts — 画像导入三路径（PRD R1 / T1）
 * 路径1: 粘贴文本 路径2: 文件导入 路径3: 问答式（LLM 引导）
 */
import type { UserProfile } from '../data/profile.schema.ts';
import { DEFAULT_PROFILE, validateProfile } from '../data/profile.schema.ts';

/** 从用户粘贴的偏好文本解析画像（路径1） */
export function parseProfileFromText(text: string): UserProfile {
  const p: UserProfile = structuredClone(DEFAULT_PROFILE);

  // 薪资解析：底线 X 期望 Y
  const salaryMatch = text.match(/底线[^\d]*(\d+)/);
  const targetMatch = text.match(/期望[^\d]*(\d+)/);
  if (salaryMatch) p.preferences.min_net_salary = Number(salaryMatch[1]);
  if (targetMatch) p.preferences.target_net_salary = Number(targetMatch[1]);

  // 地点解析：丽水 / 杭州 / 远程（去掉"地点"前缀词）
  const locMatch = text.match(/地点[^，。;；]*/);
  if (locMatch) {
    const raw = locMatch[0].replace(/^地点/, '');
    const locs = raw.match(/[\u4e00-\u9fa5]{2,4}(?=市|区|县)?/g) ?? [];
    if (locs.length) p.preferences.locations = locs.filter((l) => !['接受', '可以', '远程'].includes(l));
  }
  if (/远程/.test(text)) p.preferences.remote_ok = true;

  // 权重解析（可选覆盖）：必须出现"权重"字样才解析，避免误抓"薪资5000"
  if (/权重/.test(text)) {
    const stab = text.match(/稳定(?:性)?权重?[^\d]*(\d+(?:\.\d+)?)/);
    const sal = text.match(/薪资权重[^\d]*(\d+(?:\.\d+)?)/);
    const locW = text.match(/地点权重[^\d]*(\d+(?:\.\d+)?)/);
    if (stab) p.preferences.weights.stability = Number(stab[1]);
    if (sal) p.preferences.weights.salary = Number(sal[1]);
    if (locW) p.preferences.weights.location = Number(locW[1]);
  }

  p.updated_at = new Date().toISOString();
  return p;
}

/** 三路径统一入口（路径2/3 由 CLI 层调用 LLM 后转此） */
export function buildProfile(input: { name?: string; text?: string; base?: UserProfile }): UserProfile {
  const base = input.base ? structuredClone(input.base) : structuredClone(DEFAULT_PROFILE);
  if (input.name) base.name = input.name;
  if (input.text) {
    const parsed = parseProfileFromText(input.text);
    base.preferences = parsed.preferences;
    base.blacklist = parsed.blacklist;
  }
  base.updated_at = new Date().toISOString();
  return base;
}

export { validateProfile };
