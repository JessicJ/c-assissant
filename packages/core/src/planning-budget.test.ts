import assert from 'node:assert/strict';
import test from 'node:test';
import {hasStatedBudgetAmount} from './planning-budget.js';
test('budget detection never mistakes travel dates or headcount for a budget',()=>{
 assert.equal(hasStatedBudgetAmount(undefined),false);
 for(const text of ['October 20–22, 2026. Two adults. No fixed budget.','2026年10月20日至22日，2人，不设固定预算','A 3-day trip, moderate budget','No fixed budget, 2 people']) assert.equal(hasStatedBudgetAmount(text),false);
 for(const text of ['Budget $2,000','预算5000元','2026年10月20日，预算5000元','RMB 3000']) assert.equal(hasStatedBudgetAmount(text),true);
 assert.equal(hasStatedBudgetAmount('5000',true),true);
});
