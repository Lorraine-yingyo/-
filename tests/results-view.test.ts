import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../data/snapshot.json' with { type: 'json' };
import { evaluateStocks, type Stock, type Condition } from '../lib/screening.ts';
import { metricState, peRelaxation, sortResults, summarizeResults } from '../lib/results-view.ts';
const stocks = snapshot.stocks as unknown as Stock[];
const conditions: Condition[] = [{id:'r',metric:'revenueGrowth',op:'gte',value:10},{id:'p',metric:'profitGrowth',op:'gte',value:10},{id:'pe',metric:'peTtm',op:'lte',value:30},{id:'v',metric:'volatility',op:'lte',value:30}];
test('statistics use included companies and never invent an average for empty results', () => {
 const results = evaluateStocks(stocks,conditions), included = results.filter(x=>x.status==='included');
 const summary=summarizeResults(results);assert.equal(summary.count,2);
 assert.equal(summary.pe,included.reduce((sum,r)=>sum+r.stock.metrics.peTtm!,0)/2);
 assert.deepEqual(summarizeResults([]),{count:0,pe:null,revenue:null,roe:null});
});
test('sorting handles missing values and nonpositive PE last in both directions without mutating input', () => {
 const results=evaluateStocks(stocks,conditions), original=results.map(r=>r.stock.code);
 for (const direction of ['asc','desc'] as const) {
  const sorted=sortResults(results,{metric:'peTtm',direction});assert.equal(sorted.at(-1)?.stock.code,'601012.SH');
  const values=sorted.slice(0,-1).map(r=>r.stock.metrics.peTtm!);
  assert.ok(values.every((v,i)=>i===0||(direction==='asc'?v>=values[i-1]:v<=values[i-1])));
 }
 assert.deepEqual(results.map(r=>r.stock.code),original);
 const missing={...results[0],stock:{...results[0].stock,metrics:{...results[0].stock.metrics,revenueGrowth:null}}};
 assert.equal(sortResults([missing,results[1]],{metric:'revenueGrowth',direction:'desc'}).at(-1),missing);
});
test('cell colors evaluate every bound, preserve neutral metrics and mark unavailable PE', () => {
 const range:Condition[]=[{id:'lower',metric:'revenueGrowth',op:'gte',value:5},{id:'upper',metric:'revenueGrowth',op:'lte',value:10}];
 const results=evaluateStocks(stocks,range);
 assert.equal(metricState(results[0],'revenueGrowth'),'fail');
 assert.equal(metricState(results[2],'revenueGrowth'),'pass');
 assert.equal(metricState(results[2],'roe'),'neutral');
 assert.equal(metricState(results.find(r=>r.stock.code==='601012.SH')!,'peTtm'),'missing');
});
test('PE 35 suggestion recalculates all other constraints and counts only newly included companies', () => {
 assert.equal(peRelaxation(stocks,conditions).added,0);
 const peOnly:Condition[]=[{id:'pe',metric:'peTtm',op:'lte',value:20}];
 assert.equal(peRelaxation(stocks,peOnly).added,4);
 assert.equal(peRelaxation(stocks,[{...peOnly[0],value:40}]).added,null);
 assert.equal(peRelaxation(stocks,[{id:'roe',metric:'roe',op:'gte',value:10}]).added,null);
});
