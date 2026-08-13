import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RISK, randomDelayMs } from '../config/risk.ts';

test('风控常量存在且符合 PRD §5 阈值', () => {
  assert.equal(RISK.minDelayMs, 4000);
  assert.equal(RISK.maxDelayMs, 10_000);
  assert.equal(RISK.dailyLimit, 150);
  assert.equal(RISK.recruiterActiveDays, 14);
  assert.equal(RISK.captchaMode, 'manual');
});

test('randomDelayMs 在 4–10s 区间', () => {
  for (let i = 0; i < 100; i++) {
    const d = randomDelayMs();
    assert.ok(d >= 4000 && d <= 10_000, `delay ${d} 超出区间`);
  }
});
