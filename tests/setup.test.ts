import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, validateProfile } from '../data/profile.schema.ts';
import { parseProfileFromText, buildProfile } from '../lib/setup.ts';

test('默认画像合法', () => {
  const r = validateProfile(DEFAULT_PROFILE);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('权重之和必须=1', () => {
  const bad = structuredClone(DEFAULT_PROFILE);
  bad.preferences.weights.stability = 0.9;
  const r = validateProfile(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('权重')));
});

test('期望须大于底线', () => {
  const bad = structuredClone(DEFAULT_PROFILE);
  bad.preferences.target_net_salary = 4000;
  const r = validateProfile(bad);
  assert.equal(r.ok, false);
});

test('文本解析：底线5000期望6000（老板实参）', () => {
  const p = parseProfileFromText('底线薪资到手5000，期望到手6000，地点丽水，接受远程');
  assert.equal(p.preferences.min_net_salary, 5000);
  assert.equal(p.preferences.target_net_salary, 6000);
  assert.ok(p.preferences.locations.includes('丽水'));
  assert.equal(p.preferences.remote_ok, true);
  assert.equal(validateProfile(p).ok, true);
});

test('buildProfile 合并 base 与文本', () => {
  const p = buildProfile({ name: '蒋辰宇', text: '底线到手5000 期望到手6000' });
  assert.equal(p.name, '蒋辰宇');
  assert.equal(p.preferences.min_net_salary, 5000);
  assert.equal(validateProfile(p).ok, true);
});
