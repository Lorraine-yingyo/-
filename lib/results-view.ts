import { evaluateStocks, validateConditions, type Condition, type EvaluationResult, type Metric, type Stock } from './screening.ts';

export type SortState = { metric: Metric; direction: 'asc' | 'desc' } | null;
export const TABLE_METRICS: Metric[] = ['revenueGrowth', 'profitGrowth', 'peTtm', 'volatility'];
export function metricValue(stock: Stock, metric: Metric): number | null {
  const value = stock.metrics[metric];
  return typeof value !== 'number' || !Number.isFinite(value) || (metric === 'peTtm' && value <= 0) ? null : value;
}
export function metricState(result: EvaluationResult, metric: Metric) {
  if (metricValue(result.stock, metric) === null) return 'missing';
  const checks = result.checks.filter(check => check.condition.metric === metric);
  if (checks.some(check => check.pass === false)) return 'fail';
  if (checks.some(check => check.pass === null)) return 'missing';
  return checks.length ? 'pass' : 'neutral';
}
export function sortResults(results: EvaluationResult[], sort: SortState): EvaluationResult[] {
  if (!sort) return results;
  return [...results].sort((a, b) => {
    const left = metricValue(a.stock, sort.metric), right = metricValue(b.stock, sort.metric);
    // Missing and non-comparable values stay last in either direction; ties are stable.
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return (left - right) * (sort.direction === 'asc' ? 1 : -1);
  });
}
export function summarizeResults(results: EvaluationResult[]) {
  const included = results.filter(result => result.status === 'included');
  const average = (metric: Metric) => {
    const values = included.map(result => metricValue(result.stock, metric)).filter((v): v is number => v !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return { count: included.length, pe: average('peTtm'), revenue: average('revenueGrowth'), roe: average('roe') };
}
export function peRelaxation(stocks: Stock[], conditions: Condition[]) {
  const upper = conditions.filter(condition => condition.metric === 'peTtm' && condition.op === 'lte');
  if (!upper.length) return { added: null, reason: '添加 PE 上限条件，查看调整估值门槛的影响。' };
  if (Math.min(...upper.map(condition => condition.value)) >= 35) return { added: null, reason: '当前 PE 上限已达到或超过 35 倍，可继续调整其他条件。' };
  const relaxed = conditions.map(condition => condition.metric === 'peTtm' && condition.op === 'lte' ? { ...condition, value: Math.max(condition.value, 35) } : condition);
  if (validateConditions(relaxed).length) return { added: null, reason: '请先修正条件冲突，再查看 PE 调整的影响。' };
  const existing = new Set(evaluateStocks(stocks, conditions).filter(result => result.status === 'included').map(result => result.stock.code));
  return { added: evaluateStocks(stocks, relaxed).filter(result => result.status === 'included' && !existing.has(result.stock.code)).length, reason: '' };
}
