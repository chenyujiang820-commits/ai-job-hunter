import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob, parseSalary, scoreSalary, checkLegal, NET_SALARY_RATIO, locationHardFilter, scoreSkillMatch } from '../lib/score.ts';
import { DEFAULT_PROFILE } from '../data/profile.schema.ts';
import type { Job } from '../shared/schema.ts';

const profile = structuredClone(DEFAULT_PROFILE);
profile.preferences.min_net_salary = 5000;
profile.preferences.target_net_salary = 6000;

function mkJob(partial: Partial<Job>): Job {
  return {
    id: 'test-1', title: '产品经理', company: '测试公司', industry: '教育信息化',
    salary_text: '8-13K', location: '丽水', remote: false, job_description: '',
    ...partial,
  };
}

test('薪资解析: 8-13K → 8000-13000', () => {
  const r = parseSalary(mkJob({}));
  assert.deepEqual(r, { min: 8000, max: 13000 });
});

test('薪资解析: 1-2万 → 10000-20000', () => {
  const r = parseSalary(mkJob({ salary_text: '1-2万' }));
  assert.deepEqual(r, { min: 10000, max: 20000 });
});

test('薪资解析: 面议 → null', () => {
  assert.equal(parseSalary(mkJob({ salary_text: '面议' })), null);
});

test('⑤ 薪资水平锚点（到手口径，税前×0.86）', () => {
  // 8K 税前 → 到手 6880 ≥ 6600 → 5分
  assert.equal(scoreSalary(mkJob({ salary_text: '8K' }), profile).score, 5);
  // 7K 税前 → 到手 6020 ∈ [6000,6600) → 4分
  assert.equal(scoreSalary(mkJob({ salary_text: '7K' }), profile).score, 4);
  // 6K 税前 → 到手 5160 ∈ [5000,6000) → 3分
  assert.equal(scoreSalary(mkJob({ salary_text: '6K' }), profile).score, 3);
  // 5.5K 税前 → 到手 4730 ∈ [4500,5000) → 2分
  assert.equal(scoreSalary(mkJob({ salary_text: '5.5K' }), profile).score, 2);
  // 4K 税前 → 到手 3440 < 4500 → 1分
  assert.equal(scoreSalary(mkJob({ salary_text: '4K' }), profile).score, 1);
  // 面议 → 默认 2 分（老板裁定 L1）
  assert.equal(scoreSalary(mkJob({ salary_text: '面议' }), profile).score, 2);
});

test('地点硬过滤: 杭州 → fail，远程 → 过', () => {
  const hz = mkJob({ location: '杭州', remote: false });
  assert.equal(locationHardFilter(hz, profile), false);
  const remote = mkJob({ location: '杭州', remote: true });
  assert.equal(locationHardFilter(remote, profile), true);
  const lishui = mkJob({ location: '丽水' });
  assert.equal(locationHardFilter(lishui, profile), true);
});

test('合法性块: 诈骗关键词 → L2', () => {
  const flags = checkLegal(mkJob({ job_description: '轻松日结，无需经验高薪，垫付' }), profile);
  assert.ok(flags.includes('L2'));
});

test('合法性块: 低薪(<底线90%) → L6', () => {
  const flags = checkLegal(mkJob({ salary_text: '4K' }), profile);
  assert.ok(flags.includes('L6'));
});

test('评分: 高薪稳定岗高分且 pass', () => {
  const good = mkJob({
    salary_text: '10-15K', location: '丽水', industry: '教育信息化',
    employment_type: '全职', job_description: '双休，五险一金，13薪',
    company_meta: { nature: '国企', listed: true, founded_year: 2010, insured_count: 500 },
  });
  const r = scoreJob(good, profile);
  assert.equal(r.passed, 'pass');
  assert.ok(r.score >= 4.0, `score=${r.score} 应≥4`);
  assert.equal(r.meta.location_ok, true);
});

test('评分: 杭州低薪 → fail', () => {
  const bad = mkJob({ location: '杭州', salary_text: '4K' });
  const r = scoreJob(bad, profile);
  assert.equal(r.passed, 'fail');
});

test('评分: 面议+外包 → review', () => {
  const mid = mkJob({ salary_text: '面议', employment_type: '外包' });
  const r = scoreJob(mid, profile);
  assert.equal(r.passed, 'review');
});

test('评分: 单休+出差 → ⑧低分', () => {
  const hard = mkJob({ job_description: '单休，频繁出差' });
  const r = scoreJob(hard, profile);
  assert.equal(r.subscores.s8, 1);
});

test('NET_SALARY_RATIO = 0.86', () => {
  assert.equal(NET_SALARY_RATIO, 0.86);
});

test('scoreSkillMatch: 信息化/通信岗位高匹配', () => {
  const job = {
    id: 't', title: '信息化项目经理', company: '世纪鼎利', industry: '信息技术服务',
    salary_text: '7-10K', location: '丽水', remote: false, employment_type: '全职',
    work_schedule: '', job_description: '负责智慧校园系统集成项目，与客户沟通方案，协调团队推进项目验收',
  };
  // 信息化+教育(校园)+客户+方案协调 = 4类 → 4分（高匹配）
  assert.equal(scoreSkillMatch(job as never), 4);
});

test('scoreSkillMatch: 建筑项目经理低匹配', () => {
  const job = {
    id: 't', title: '土建项目经理', company: '某建筑公司', industry: '建筑工程',
    salary_text: '8-13K', location: '丽水', remote: false, employment_type: '全职',
    work_schedule: '', job_description: '负责土建施工管理，把控工程质量与进度',
  };
  assert.equal(scoreSkillMatch(job as never), 1); // 无优势领域词
});

test('scoreSkillMatch: 教育课程顾问匹配教育+客户', () => {
  const job = {
    id: 't', title: '课程顾问', company: '乐博乐博', industry: '教育培训',
    salary_text: '10-15K', location: '杭州', remote: false, employment_type: '全职',
    work_schedule: '', job_description: '了解家长需求，推荐课程方案，达成销售目标',
  };
  assert.equal(scoreSkillMatch(job as never), 4); // 教育+客户市场+方案 = 3类以上
});

test('parseSalary: 时薪折算月薪', () => {
  const r = parseSalary({ salary_text: '80-150元/时' } as never);
  assert.ok(r && r.min === 80 * 22 * 8 && r.max === 150 * 22 * 8);
});

test('parseSalary: 日薪折算月薪', () => {
  const r = parseSalary({ salary_text: '200-300元/天' } as never);
  assert.ok(r && r.min === 200 * 22 && r.max === 300 * 22);
});

test('parseSalary: 时薪区间过大封顶', () => {
  const r = parseSalary({ salary_text: '50-500元/时' } as never);
  // 50*176=8800, 500*176=88000; 上限>下限3倍 → 封顶为 (8800+88000)/2*1.5 = 72600
  assert.ok(r && r.max <= 72600, `max=${r?.max} 应封顶`);
  assert.equal(r.min, 8800);
});

test('checkLegal: 无关岗位标 L5（口腔助理/监理）', () => {
  const profile = DEFAULT_PROFILE;
  const job1 = { id: 't', title: '口腔助理医生', company: '口腔医院', industry: '医疗',
    salary_text: '8-12K', location: '丽水', remote: false, employment_type: '全职', work_schedule: '', job_description: '协助医生诊疗' };
  const f1 = checkLegal(job1 as never, profile);
  assert.ok(f1.includes('L5'), '口腔助理应低相关');

  const job2 = { id: 't', title: '教育咨询师', company: '培训学校', industry: '教育培训',
    salary_text: '5-8K', location: '丽水', remote: false, employment_type: '全职', work_schedule: '', job_description: '为家长提供课程咨询' };
  const f2 = checkLegal(job2 as never, profile);
  assert.ok(!f2.includes('L5'), '教育咨询师应相关');
});

test('scoreJob: 无关岗位 passed=fail', () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.preferences.min_net_salary = 5000;
  profile.preferences.locations = ['丽水'];
  const job = { id: 't', title: '土建施工员', company: '建筑公司', industry: '建筑工程',
    salary_text: '8-12K', location: '丽水', remote: false, employment_type: '全职', work_schedule: '', job_description: '负责工地施工管理' };
  const r = scoreJob(job as never, profile);
  assert.equal(r.passed, 'fail');
  assert.ok(r.flags.includes('L5'));
});
