import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConditions, evaluateStocks, parseIntent, validateConditions } from '../lib/screening.ts';
import type { Condition, Metric, Stock } from '../lib/screening.ts';

function stock(overrides: Partial<Record<Metric, number | null>> = {}): Stock {
  return {
    code: '000001', name: '测试公司', industry: '测试行业',
    metrics: { revenueGrowth: 5, profitGrowth: 5, peTtm: 30, roe: 10, volatility: 35, ...overrides },
    provenance: {},
  };
}
function condition(metric: Metric, op: 'gte' | 'lte', value: number, id = 'test'): Condition {
  return { id, metric, op, value };
}

test('thresholds are inclusive, percent values use percentage points, and all conditions are required', () => {
  const [boundary, belowGrowth, highPE] = evaluateStocks([
    stock(), stock({ revenueGrowth: 4.9999 }), stock({ peTtm: 30.0001 }),
  ], defaultConditions);
  assert.equal(boundary.status, 'included');
  assert.equal(boundary.passed, 3);
  assert.equal(belowGrowth.status, 'excluded');
  assert.equal(highPE.status, 'excluded');
  assert.match(belowGrowth.checks[0].reason, /4\.9999%/);
});

test('missing values are unknown, while a definite failure excludes with the missing explanation retained', () => {
  const [unknown, excluded] = evaluateStocks([
    stock({ revenueGrowth: null }), stock({ revenueGrowth: null, peTtm: 31 }),
  ], defaultConditions);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.checks[0].pass, null);
  assert.equal(excluded.status, 'excluded');
  assert.equal(excluded.checks[0].pass, null);
  assert.match(excluded.checks[0].reason, /数据缺失/);
  assert.equal(excluded.checks[2].pass, false);
});

test('non-positive PE cannot incorrectly satisfy a maximum PE condition', () => {
  for (const peTtm of [-100, -1, 0]) {
    const [result] = evaluateStocks([stock({ peTtm })], [condition('peTtm', 'lte', 30)]);
    assert.equal(result.status, 'unknown');
    assert.equal(result.checks[0].pass, null);
    assert.equal(result.checks[0].actual, peTtm);
    assert.match(result.checks[0].reason, /不具可比性/);
  }
});

test('invalid numeric observations never pass and legitimate zero growth remains comparable', () => {
  for (const revenueGrowth of [NaN, Infinity, -Infinity]) {
    assert.equal(evaluateStocks([stock({ revenueGrowth })], defaultConditions)[0].status, 'unknown');
  }
  assert.equal(evaluateStocks([stock({ revenueGrowth: 0 })], [condition('revenueGrowth', 'gte', 0)])[0].status, 'included');
  assert.equal(evaluateStocks([stock({ volatility: -1 })], [condition('volatility', 'lte', 35)])[0].status, 'unknown');
});

test('condition validation rejects contradictions, unsupported metrics, malformed numbers and empty sets', () => {
  assert.ok(validateConditions([]).length);
  assert.ok(validateConditions([condition('roe', 'gte', NaN)]).length);
  assert.ok(validateConditions([condition('peTtm', 'lte', 0)]).length);
  assert.ok(validateConditions([condition('volatility', 'gte', -1)]).length);
  assert.ok(validateConditions([{ ...condition('roe', 'gte', 10), metric: '__proto__' as Metric }]).length);
  assert.ok(validateConditions([{ ...condition('roe', 'gte', 10), value: '10' as unknown as number }]).length);
  assert.ok(validateConditions([condition('roe', 'gte', 15, 'lower'), condition('roe', 'lte', 10, 'upper')]).some((error) => error.includes('冲突')));
  assert.deepEqual(validateConditions([condition('roe', 'gte', 10, 'lower'), condition('roe', 'lte', 10, 'upper')]), []);
  assert.throws(() => evaluateStocks([stock()], []), /至少/);
});

test('editing one threshold deterministically changes membership and explains why', () => {
  const data = [stock({ peTtm: 32 })];
  const before = evaluateStocks(data, defaultConditions)[0];
  const revised = defaultConditions.map((rule) => rule.metric === 'peTtm' ? { ...rule, value: 35 } : rule);
  const after = evaluateStocks(data, revised)[0];
  assert.equal(before.status, 'excluded');
  assert.equal(after.status, 'included');
  assert.match(before.checks[2].reason, /未满足 ≤ 30倍/);
  assert.match(after.checks[2].reason, /满足 ≤ 35倍/);
  assert.equal(defaultConditions[2].value, 30);
});

test('rule parser extracts explicit numeric bounds and makes ambiguous ideas reviewable', () => {
  const numeric = parseIntent('营收同比不低于 5%，归母净利润同比不少于 8%，PE TTM 不超过 30 倍');
  assert.equal(numeric.mode, 'rules');
  assert.equal(numeric.blocked, false);
  assert.deepEqual(numeric.conditions.map(({ metric, op, value }) => ({ metric, op, value })), [
    { metric: 'revenueGrowth', op: 'gte', value: 5 },
    { metric: 'profitGrowth', op: 'gte', value: 8 },
    { metric: 'peTtm', op: 'lte', value: 30 },
  ]);
  assert.deepEqual(numeric.unsupported, []);
  const vague = parseIntent('找经营改善、估值合理、走势稳定的公司');
  assert.equal(vague.conditions.length, 4);
  assert.equal(vague.clarifications.length, 3);
  assert.deepEqual(vague.unsupported, []);
  assert.ok(vague.clarifications.some((message) => message.includes('代理条件')));
});

test('numeric instructions are not overwritten by qualitative defaults', () => {
  const result = parseIntent('经营改善，营收同比至少 20%，估值合理，PE 不超过 18 倍');
  assert.equal(result.conditions.filter((rule) => rule.metric === 'revenueGrowth').length, 1);
  assert.equal(result.conditions.find((rule) => rule.metric === 'revenueGrowth')?.value, 20);
  assert.equal(result.conditions.find((rule) => rule.metric === 'peTtm')?.value, 18);
});

test('unsupported intent is disclosed and is never silently interpreted as a valid condition', () => {
  const unknown = parseIntent('寻找有护城河的半导体龙头');
  assert.equal(unknown.conditions.length, 0);
  assert.ok(unknown.unsupported.length);
  const partial = parseIntent('营收同比至少 5%，只要半导体行业');
  assert.equal(partial.conditions.length, 1);
  assert.match(partial.unsupported.join(' '), /半导体/);
  const units = parseIntent('营收增长不低于 10 倍，市盈率低于 20%');
  assert.equal(units.conditions.length, 0);
  assert.equal(units.unsupported.length, 2);
});

test('strict comparisons, unspecified units, and conflicting bounds require clarification', () => {
  assert.ok(parseIntent('营收同比超过 10%').clarifications.some((message) => message.includes('严格比较')));
  assert.ok(parseIntent('ROE 至少 10').clarifications.some((message) => message.includes('单位')));
  const conflict = parseIntent('ROE 不低于 20%，ROE 不高于 10%');
  assert.ok(validateConditions(conflict.conditions).length);
  assert.match(conflict.message, /冲突/);
});

test('rule fallback blocks buy/sell predictions and return guarantees', () => {
  for (const prompt of ['明天会涨的股票', '推荐我买入哪只股票', '稳赚的公司', '预测下个月股价翻倍', '市盈率低于30倍，现在该卖吗']) {
    const result = parseIntent(prompt);
    assert.equal(result.blocked, true, prompt);
    assert.equal(result.conditions.length, 0, prompt);
  }
  assert.equal(parseIntent('筛选营收同比不低于 5% 的公司').blocked, false);
});

test('OR and negation are not silently converted to positive AND conditions', () => {
  for (const prompt of ['营收同比至少10%或者PE不超过30倍', 'ROE至少10% OR PE不超过20倍', '不要营收同比超过10%的公司', '排除低估值公司']) {
    const result = parseIntent(prompt);
    assert.equal(result.blocked, true, prompt);
    assert.deepEqual(result.conditions, [], prompt);
    assert.ok(result.unsupported.length, prompt);
  }
  assert.equal(parseIntent('营收同比不超过10%').blocked, false);
});

test('unsupported metric variants and numeric notation never produce truncated or substituted conditions', () => {
  for (const prompt of ['扣非净利润同比至少10%', '扣非归母净利润同比至少10%', '静态PE不超过30倍', '行业平均PE不超过30倍', '摊薄ROE至少10%', '近30日年化波动率不超过20%', '主营业务收入同比至少10%', '营收同比至少1e2%', '市盈率不超过1,000倍', 'ROE10%~20%', 'ROE不低于10%以下']) {
    const result = parseIntent(prompt);
    assert.equal(result.conditions.length, 0, prompt);
    assert.ok(result.unsupported.length, prompt);
  }
  assert.equal(parseIntent('加权平均ROE至少10%').conditions.length, 1);
  assert.equal(parseIntent('扣非净利润增长较快').conditions.length, 0);
});

test('growth descriptions only add requested metrics and clarifications preserve explicit thresholds', () => {
  const revenue = parseIntent('营收增长较快的公司');
  assert.deepEqual(revenue.conditions.map((condition) => condition.metric), ['revenueGrowth']);
  assert.deepEqual(revenue.unsupported, []);
  const mixed = parseIntent('经营改善，营收同比至少20%');
  assert.ok(mixed.clarifications.some((message) => message.includes('归母净利润同比 ≥ 5%')));
  assert.ok(!mixed.clarifications.some((message) => message.includes('营业总收入同比 ≥ 5%')));
  assert.equal(parseIntent('ROE至少10%且ROE至少10%').conditions.length, 1);
});

test('the visible qualitative preset recognizes relative stability and leaves unknown emoji text disclosed', () => {
  const preset = parseIntent('经营改善、估值合理、走势相对稳定');
  assert.equal(preset.conditions.length, 4);
  assert.deepEqual(preset.unsupported, []);
  const emoji = parseIntent('🔎营收同比至少10%');
  assert.equal(emoji.conditions[0].value, 10);
  assert.ok(emoji.unsupported.some((message) => message.includes('🔎')));
});
