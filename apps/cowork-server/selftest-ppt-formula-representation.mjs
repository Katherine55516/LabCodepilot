import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';import {sourceComponent} from './lib/ppt-density-capacity.mjs';import {inspectContent} from './lib/ppt-content-qa.mjs';import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
const equation=String.raw`\overline{IC} = \frac{1}{T}\sum_{t=1}^{T} IC_t, \qquad \sigma(IC) = \sqrt{\frac{1}{T-1}\sum_t (IC_t - \overline{IC})^2}`;
const source=normalizePaste('# IC statistics\n\n$$\n'+equation+'\n$$'),item=source.semantic.inventory.items.find(i=>i.type==='EquationBlock');assert.ok(item);
const node={id:'equation',...sourceComponent(item),sourceArtifact:{sourceUnitId:item.id,type:item.type}},p={source,outline:[{id:'s',title:'IC statistics',sourceUnitIds:[item.id]}],planning:{slidePlan:[{slideId:'s',sourceArtifacts:[{sourceUnitId:item.id}]}]},deck:{slides:[{id:'s',title:'IC statistics',nodes:[node]}]}};
assert.deepEqual(inspectContent(p).issues.filter(i=>i.code==='visible_formula_unverified'),[],'an exact raw TeX subexpression must not be compared only with flattened Unicode math');assert.deepEqual(inspectObjectIntegrity(p).issues,[]);
const wrong=structuredClone(p),altered={...item,text:item.text.replace('IC_t -','IC_t +')};wrong.deck.slides[0].nodes[0]={id:node.id,...sourceComponent(altered),sourceArtifact:node.sourceArtifact};
assert.ok(inspectContent(wrong).issues.some(i=>i.code==='visible_formula_unverified'),'a changed sign remains unverified');assert.ok(inspectObjectIntegrity(wrong).issues.some(i=>i.sourceUnitId===item.id),'native math identity independently rejects the changed formula');
console.log('Exact source TeX and display projections use matching representations; changed-sign and native-structure negatives stay blocked.');
