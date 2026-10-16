import assert from 'node:assert/strict';
import {inspectContent} from './lib/ppt-content-qa.mjs';
const source='Geometry: full table from the original source. max(alpha + beta, gamma)';
const check=text=>inspectContent({source:{text:source},deck:{slides:[{id:'s',title:text,nodes:[{id:'t',type:'text',content:{text}}]}]}}).issues.filter(issue=>issue.code==='visible_formula_unverified');
for(const locator of ['Geometry (Rows 1-3)','Architecture (Pages 2–4)','Source Code (Lines 12—20)'])assert.equal(check(locator).length,0,locator);
assert.equal(check('max(alpha + beta, gamma)').length,0);
for(const changed of ['max(alpha - beta, gamma)','max (alpha - beta, gamma)','Geometry(Rows1-3 + offset)','Geometry (Rows + 1 - 3)'])assert.ok(check(changed).length>0,changed);
console.log('Editorial range locators do not bypass arithmetic source verification: OK');
