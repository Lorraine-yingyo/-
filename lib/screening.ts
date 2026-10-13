/** Shared, deterministic screening rules. No language model decides membership. */
export type Metric = 'revenueGrowth' | 'profitGrowth' | 'peTtm' | 'roe' | 'volatility';
export type Operator = 'gte' | 'lte';

export const METRICS: Record<Metric, {
  label: string;
  shortLabel: string;
  unit: string;
  description: string;
  defaultOp: Operator;
  defaultValue: number;
}> = {
  revenueGrowth: {
    label: '营业总收入同比', shortLabel: '营收增长', unit: '%',
    description: '报告期营业总收入相对上年同期的变动百分比；5 表示 5%，不是 0.05。',
    defaultOp: 'gte', defaultValue: 5,
  },
  profitGrowth: {
    label: '归母净利润同比', shortLabel: '利润增长', unit: '%',
    description: '报告期归属于母公司股东的净利润同比变动百分比；亏损基数可能影响可比性，请结合财报。',
    defaultOp: 'gte', defaultValue: 5,
  },
  peTtm: {
    label: '市盈率 PE TTM', shortLabel: '市盈率', unit: '倍',
    description: '快照日股价相对过去 12 个月每股收益的倍数；仅正值可比较，非正值和缺失值均不视为满足条件。',
    defaultOp: 'lte', defaultValue: 30,
  },
  roe: {
    label: '净资产收益率 ROE', shortLabel: 'ROE', unit: '%',
    description: '报告期加权平均净资产收益率，采用来源披露口径；不把季度值自动年化。',
    defaultOp: 'gte', defaultValue: 10,
  },
  volatility: {
    label: '近 60 日年化波动率', shortLabel: '年化波动', unit: '%',
    description: '61 个交易日复权收盘价形成 60 个日对数收益率，样本标准差 × √252 × 100；历史低波动不代表未来收益。',
    defaultOp: 'lte', defaultValue: 35,
  },
};

export interface Condition {
  id: string;
  metric: Metric;
  op: Operator;
  value: number;
}

export interface Provenance {
  source: string;
  url: string;
  asOf: string;
  period?: string;
  unit?: string;
  note?: string;
}

export interface Stock {
  code: string;
  name: string;
  industry: string;
  metrics: Record<Metric, number | null>;
  provenance: Record<string, Provenance>;
}

export interface ConditionCheck {
  condition: Condition;
  actual: number | null;
  pass: boolean | null;
  reason: string;
}

export interface EvaluationResult {
  stock: Stock;
  status: 'included' | 'excluded' | 'unknown';
  checks: ConditionCheck[];
  passed: number;
  total: number;
}

export const defaultConditions: Condition[] = [
  { id: 'revenue-growth', metric: 'revenueGrowth', op: 'gte', value: 5 },
  { id: 'profit-growth', metric: 'profitGrowth', op: 'gte', value: 5 },
  { id: 'valuation', metric: 'peTtm', op: 'lte', value: 30 },
];

export function validateConditions(conditions: readonly Condition[]): string[] {
  if (!Array.isArray(conditions) || conditions.length === 0) return ['请至少添加一个筛选条件。'];
  const errors: string[] = [];
  const ids = new Set<string>();
  const bounds = new Map<Metric, { lower: number; upper: number }>();
  for (const [index, condition] of conditions.entries()) {
    const prefix = `第 ${index + 1} 个条件`;
    if (!condition || typeof condition !== 'object') {
      errors.push(`${prefix}格式无效。`);
      continue;
    }
    if (typeof condition.id !== 'string' || condition.id.trim() === '') errors.push(`${prefix}缺少标识。`);
    else if (ids.has(condition.id)) errors.push(`${prefix}标识重复。`);
    else ids.add(condition.id);
    if (!Object.hasOwn(METRICS, condition.metric)) {
      errors.push(`${prefix}使用了不支持的指标。`);
      continue;
    }
    if (condition.op !== 'gte' && condition.op !== 'lte') {
      errors.push(`${prefix}使用了不支持的比较方式，仅支持 ≥ 和 ≤。`);
      continue;
    }
    if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
      errors.push(`${prefix}的阈值必须为有限数值。`);
      continue;
    }
    if (condition.metric === 'peTtm' && condition.value <= 0) errors.push('市盈率阈值必须大于 0，亏损公司的非正市盈率不可直接比较。');
    if (condition.metric === 'volatility' && condition.value < 0) errors.push('波动率阈值不能小于 0。');
    const range = bounds.get(condition.metric) ?? { lower: -Infinity, upper: Infinity };
    if (condition.op === 'gte') range.lower = Math.max(range.lower, condition.value);
    else range.upper = Math.min(range.upper, condition.value);
    bounds.set(condition.metric, range);
  }
  for (const [metric, range] of bounds) {
    if (range.lower > range.upper) errors.push(`${METRICS[metric].label}的下限 ${range.lower} 高于上限 ${range.upper}，请修改冲突条件。`);
  }
  return [...new Set(errors)];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value);
}

/** All conditions are ANDed. Missing values never produce a passing check. */
export function evaluateStocks(stocks: readonly Stock[], conditions: readonly Condition[]): EvaluationResult[] {
  const errors = validateConditions(conditions);
  if (errors.length) throw new Error(errors.join(' '));
  return stocks.map((stock) => {
    const checks = conditions.map((condition): ConditionCheck => {
      const metadata = METRICS[condition.metric];
      const raw = stock.metrics[condition.metric];
      const actual = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      const threshold = `${condition.op === 'gte' ? '≥' : '≤'} ${formatNumber(condition.value)}${metadata.unit}`;
      if (actual === null) return {
        condition, actual, pass: null,
        reason: `${metadata.label}数据缺失或不可用，无法判断是否满足 ${threshold}；不以 0 替代。`,
      };
      if (condition.metric === 'peTtm' && actual <= 0) return {
        condition, actual, pass: null,
        reason: `市盈率为 ${formatNumber(actual)} 倍，非正市盈率不具可比性，无法判断是否满足 ${threshold}。`,
      };
      if (condition.metric === 'volatility' && actual < 0) return {
        condition, actual, pass: null,
        reason: '波动率为负值，数据口径异常，无法判断；不视为低波动。',
      };
      const pass = condition.op === 'gte' ? actual >= condition.value : actual <= condition.value;
      return {
        condition, actual, pass,
        reason: `${metadata.label} ${formatNumber(actual)}${metadata.unit}，${pass ? '满足' : '未满足'} ${threshold}。`,
      };
    });
    const status = checks.some((check) => check.pass === false) ? 'excluded'
      : checks.some((check) => check.pass === null) ? 'unknown' : 'included';
    return { stock, status, checks, passed: checks.filter((check) => check.pass === true).length, total: checks.length };
  });
}

export interface IntentResult {
  conditions: Condition[];
  clarifications: string[];
  unsupported: string[];
  blocked: boolean;
  message: string;
  mode: 'rules' | 'llm';
}

const METRIC_ALIASES: Record<Metric, string> = {
  revenueGrowth: '(?:营业总收入|营业收入|营收|收入)(?:同比(?:增长率|增长|增速)?|(?:增长率|增长|增速)(?:同比)?)',
  profitGrowth: '(?:归母净利润|归属于母公司股东的净利润|净利润|利润)(?:同比(?:增长率|增长|增速)?|(?:增长率|增长|增速)(?:同比)?)',
  peTtm: '(?:市盈率(?:\\s*PE)?(?:\\s*TTM)?|PE(?:\\s*TTM)?)',
  roe: '(?:(?:加权平均)?净资产收益率(?:\\s*ROE)?|(?:加权平均)?ROE)',
  volatility: '(?:(?:近|最近|过去)?\\s*60\\s*(?:个)?(?:交易)?日\\s*)?(?:年化)?(?:波动率|波动)',
};

function unsupportedMetricQualifier(metric: Metric, prefix: string): boolean {
  if (metric === 'profitGrowth') return /(?:扣非(?:后)?(?:的)?|扣除非经常性损益后)\s*$/.test(prefix);
  if (metric === 'revenueGrowth') return /(?:主营业务|海外|境外|国内|分部|经营活动)\s*$/.test(prefix);
  if (metric === 'peTtm') return /(?:静态|动态|预测|远期|forward|static|行业(?:平均|中位数)?|同业(?:平均|中位数)?)\s*$/i.test(prefix);
  if (metric === 'roe') return /(?:摊薄|平均|单季度|季度|年化)\s*$/.test(prefix);
  if (metric === 'volatility') return /(?:\d+|[一二三四五六七八九十]+)\s*(?:个)?(?:交易)?(?:日|天|周|月|年)\s*$/.test(prefix);
  return false;
}

/**
 * Deliberately bounded rule parser for offline use, not an LLM.
 * Conditions are proposals. The caller must display clarifications and let the
 * user confirm them before replacing an existing screening configuration.
 */
export function parseIntent(input: string): IntentResult {
  const text = (typeof input === 'string' ? input : '').trim().replace(/％/g, '%').replace(/＝/g, '=');
  const result: IntentResult = {
    conditions: [], clarifications: [], unsupported: [], blocked: false, mode: 'rules',
    message: '由本地规则生成候选条件，请检查指标口径和阈值后确认。',
  };
  if (!text) {
    result.message = '请描述希望筛选的财务或估值条件。';
    return result;
  }
  if (/(稳赚|保证.{0,8}(收益|盈利|赚钱)|必涨|必赚|包赚|涨停|翻倍|买入|卖出|该买|该卖|买哪|卖哪|买什么|卖什么|直接买|直接卖|预测.{0,12}(涨|跌|股价|收益)|(?:明天|明日|下周|下个月).{0,10}(?:涨|跌|赚钱)|推荐.{0,8}(?:买|卖))/i.test(text)) {
    result.blocked = true;
    result.message = '这里提供可核验的条件筛选，不生成买卖指令、价格预测或收益承诺。请改为财务、估值或历史波动条件。';
    return result;
  }
  // A partial AND interpretation would reverse or narrow these intents. Do not
  // offer executable fragments of a logical expression we cannot represent.
  if (/(?:或者|或是|或|\bOR\b|二选一|任意(?:一个|一项)|满足其一)/i.test(text)) {
    result.blocked = true;
    result.unsupported.push('“或 / 任一满足”的逻辑暂不支持，不能自动转换为全部同时满足。');
    result.message = '当前规则仅支持所有条件同时满足（AND）。请分别建立两组条件，或改写为需要同时满足的条件。';
    return result;
  }
  if (/(?:不要|排除|剔除|不满足|不符合|并非|除了|除外|不包含|不包括|无需|不要求|(?:非|不)(?:经营改善|估值合理|低估值|高\s*ROE))/i.test(text)) {
    result.blocked = true;
    result.unsupported.push('否定或排除条件的作用范围尚无法可靠解析，不会生成方向相反的候选条件。');
    result.message = '请把排除要求改写为明确的指标上下限，例如“营收同比不超过 10%”。';
    return result;
  }
  const consumed = new Array<boolean>(text.length).fill(false);
  const mark = (start: number, length: number) => { for (let i = start; i < start + length; i++) consumed[i] = true; };
  const numericMetrics = new Set<Metric>();
  const operatorPattern = '(大于等于|小于等于|不低于|不高于|不少于|不超过|至少|最多|>=|<=|≥|≤|高于|低于|超过|大于|小于|>|<|控制在|在)?';
  for (const metric of Object.keys(METRIC_ALIASES) as Metric[]) {
    const expression = new RegExp(`${METRIC_ALIASES[metric]}\\s*(?:为|需|要|要求|应)?\\s*${operatorPattern}\\s*(-?\\d+(?:\\.\\d+)?)\\s*(%|倍)?\\s*(以上|以下|以内)?`, 'gi');
    for (const match of text.matchAll(expression)) {
      const [matched, operator, number, unit, suffix] = match;
      mark(match.index!, matched.length);
      numericMetrics.add(metric);
      const metadata = METRICS[metric];
      const prefix = text.slice(0, match.index!);
      const after = text.slice(match.index! + matched.length);
      if (unsupportedMetricQualifier(metric, prefix)) {
        result.unsupported.push(`“${matched.trim()}”带有当前不支持的指标口径限定，不能替换为${metadata.label}。`);
        continue;
      }
      if (/^(?:[eE][+-]?\d|[.,，]\d|亿|万|元|(?:~|～|至|到|-)\s*\d)/.test(after)) {
        result.unsupported.push(`“${matched.trim()}”后的数值单位或表示方式尚不支持，未截断数字生成条件。`);
        continue;
      }
      if ((unit === '倍' && metric !== 'peTtm') || (unit === '%' && metric === 'peTtm')) {
        result.unsupported.push(`“${matched.trim()}”的单位与${metadata.label}不一致，应使用${metadata.unit}。`);
        continue;
      }
      const value = Number(number);
      let op: Operator = metadata.defaultOp;
      if (operator && /^(不低于|不少于|至少|大于等于|>=|≥|高于|超过|大于|>)$/.test(operator)) op = 'gte';
      else if (operator && /^(不高于|不超过|最多|小于等于|<=|≤|低于|小于|<|控制在)$/.test(operator)) op = 'lte';
      else if (suffix) op = suffix === '以上' ? 'gte' : 'lte';
      else result.clarifications.push(`“${matched.trim()}”未明确上下限，暂建议 ${metadata.label} ${op === 'gte' ? '≥' : '≤'} ${value}${metadata.unit}，请确认。`);
      if (operator && suffix && (suffix === '以上' ? 'gte' : 'lte') !== op) {
        result.unsupported.push(`“${matched.trim()}”的比较方向互相矛盾，请明确上限或下限。`);
        continue;
      }
      if (operator && /^(高于|低于|超过|大于|小于|>|<)$/.test(operator)) {
        result.clarifications.push(`“${matched.trim()}”使用严格比较；当前引擎仅支持含边界的 ≥ / ≤，候选条件暂为 ${op === 'gte' ? '≥' : '≤'} ${value}${metadata.unit}，请确认或修改。`);
      }
      if (!unit) result.clarifications.push(`${metadata.label}的数值 ${value} 按${metadata.unit}解释，请确认单位。`);
      if (metric === 'profitGrowth' && !/归母|归属于/.test(matched)) result.clarifications.push('“利润同比”按归属于母公司股东的净利润同比解释，不是扣非净利润同比，请确认口径。');
      if (metric === 'volatility') result.clarifications.push('波动率固定采用近 60 个交易日日对数收益率的年化口径，请确认。');
      result.conditions.push({ id: `intent-${metric}-${result.conditions.length + 1}`, metric, op, value });
    }
  }
  const suggestions: { pattern: RegExp; metrics: Metric[]; clarification: string }[] = [
    {
      pattern: /(?:营业总收入|营业收入|营收|收入)(?:同比)?(?:增长(?:较快|较好|稳健|良好)|增速较快)/g,
      metrics: ['revenueGrowth'],
      clarification: '营收增长的定性描述暂用营业总收入同比 ≥ 5% 作为代理条件，请确认或调整。',
    },
    {
      pattern: /(?:归母净利润|净利润|利润)(?:同比)?(?:增长(?:较快|较好|稳健|良好)|增速较快)/g,
      metrics: ['profitGrowth'],
      clarification: '利润增长的定性描述暂用归母净利润同比 ≥ 5% 作为代理条件，请确认指标口径或调整阈值。',
    },
    {
      pattern: /经营改善|基本面改善|业绩改善|业绩向好|业绩增长|增长较快|成长性好|成长股/g,
      metrics: ['revenueGrowth', 'profitGrowth'],
      clarification: '“经营改善”暂用营业总收入同比 ≥ 5%、归母净利润同比 ≥ 5% 作为代理条件；这不代表现金流或利润质量改善，请确认或调整。',
    },
    {
      pattern: /估值合理|合理估值|估值不贵|低估值|估值较低|便宜|有性价比/g,
      metrics: ['peTtm'],
      clarification: '“估值合理”没有统一标准，暂建议正市盈率 PE TTM ≤ 30 倍；未做行业相对估值判断，请确认或调整。',
    },
    {
      pattern: /走势(?:相对|比较|较为)?稳定|走势稳健|波动较小|低波动|比较稳|较稳定|稳健/g,
      metrics: ['volatility'],
      clarification: '“走势稳定”暂用近 60 个交易日年化波动率 ≤ 35% 作为代理条件；历史波动不预测未来走势，请确认或调整。',
    },
    {
      pattern: /盈利能力强|盈利能力较好|高\s*ROE|ROE\s*高|高净资产收益率/gi,
      metrics: ['roe'],
      clarification: '“盈利能力强”暂用报告期加权平均 ROE ≥ 10% 作为代理条件，请确认或调整。',
    },
  ];
  for (const suggestion of suggestions) {
    const matches = [...text.matchAll(suggestion.pattern)].filter((match) => {
      if (consumed.slice(match.index!, match.index! + match[0].length).some(Boolean)) return false;
      if (suggestion.metrics.some((metric) => unsupportedMetricQualifier(metric, text.slice(0, match.index!)))) {
        mark(match.index!, match[0].length);
        result.unsupported.push(`“${match[0]}”带有当前不支持的指标口径限定，未生成替代条件。`);
        return false;
      }
      return true;
    });
    if (!matches.length) continue;
    for (const match of matches) mark(match.index!, match[0].length);
    const added: Condition[] = [];
    for (const metric of suggestion.metrics) {
      if (numericMetrics.has(metric) || result.conditions.some((condition) => condition.metric === metric)) continue;
      const condition = { id: `intent-${metric}-${result.conditions.length + 1}`, metric, op: METRICS[metric].defaultOp, value: METRICS[metric].defaultValue };
      result.conditions.push(condition);
      added.push(condition);
    }
    if (added.length === suggestion.metrics.length) result.clarifications.push(suggestion.clarification);
    else if (added.length) result.clarifications.push(`“经营改善”中未指定的部分暂补充 ${added.map((condition) => `${METRICS[condition.metric].label} ≥ ${condition.value}%`).join('、')}；已明确的指标阈值保留，请确认。`);
  }
  // RegExp offsets are UTF-16 indices; keep the same indexing for emoji input.
  const remaining = text.split('').map((character, index) => consumed[index] ? ' ' : character).join('')
    .replace(/帮我|请|我想要|我想|想要|希望|筛选出|筛选|选出|选一下|找一下|找出|找|一些|一批|几家|公司|股票|标的|满足|并且|同时|而且|以及|并|且|和|与|的|要求|看看|一下|A股/gi, '')
    .replace(/[\s，,。；;：:、!！?？()（）“”"「」]/g, '')
    .trim();
  if (remaining) result.unsupported.push(`尚未解析：“${remaining}”。当前仅支持营收同比、归母净利润同比、PE TTM、ROE 和近 60 日年化波动率。`);
  if (!result.conditions.length) result.message = '未得到可执行条件。请使用支持的指标，例如“营收同比不低于 5%，市盈率不超过 30 倍”。';
  else if (result.unsupported.length) result.message = '只解析出部分候选条件，未识别的内容不会参与筛选；请补充或调整后确认。';
  result.conditions = result.conditions.filter((condition, index, conditions) => conditions.findIndex((other) => other.metric === condition.metric && other.op === condition.op && other.value === condition.value) === index);
  const validation = result.conditions.length ? validateConditions(result.conditions) : [];
  if (validation.length) {
    result.clarifications.push(...validation);
    result.message = '候选条件存在冲突或无效阈值，修改后才能执行。';
  }
  result.clarifications = [...new Set(result.clarifications)];
  return result;
}
