import assert from 'node:assert/strict';
import {obligationProblems,obligationSelectionIssues,obligationCoverage} from './lib/ppt-explanation-obligations.mjs';
import {surfaceFill} from './lib/ppt/surface-fill.mjs';
import {normalizeCommand} from './lib/ppt/command-schema.mjs';
const texts=['Uniqueness corrects overlap.','Decay corrects stale observations.','For classification, multiply uniqueness, decay and class weights.'];
const items=texts.map((text,i)=>({id:'u'+i,text})),o={label:'Combine independent weights with the classification condition',sourceUnitIds:['u0','u1','u2'],triggerSourceUnitIds:['u0','u1'],relationType:'composition',placement:'same_page',evidence:items.map(i=>({sourceUnitId:i.id,quote:i.text,start:0,end:i.text.length}))};
const p={source:{sha256:'immutable',semantic:{inventory:{items}}},inputUnderstanding:{explanationObligations:[o]}};
assert.deepEqual(obligationProblems(p,[o]),[]);
assert.ok(obligationProblems(p,[{...o,evidence:[{...o.evidence[0],quote:'invented'}]}]).length);
const raw={selection:items.map(i=>({sourceUnitId:i.id,destination:i.id==='u2'?'excluded':'slides',reason:'overview'})),slides:[{id:'page',sourceUnitIds:['u0','u1']}]};
assert.equal(obligationSelectionIssues(p,raw)[0].details.missingSourceUnitIds[0],'u2','legal exclusions cannot hide a combination condition');
raw.slides[0].sourceUnitIds.push('u2');assert.equal(obligationSelectionIssues(p,raw).length,0);
raw.slides=[{id:'a',sourceUnitIds:['u0','u1']},{id:'b',sourceUnitIds:['u2']}];assert.equal(obligationSelectionIssues(p,raw)[0].details.split,true);
const outside={...raw,slides:[]};assert.equal(obligationCoverage(p,outside)[0].status,'outside_selected_scope');
assert.equal(surfaceFill({type:'text'}).mode,'none');assert.equal(surfaceFill({type:'text',nativeRef:{shapeId:1}}).mode,'preserve_native');
assert.equal(surfaceFill({type:'text',nativeRef:{shapeId:1},style:{fill:'#ffffff'}}).color,'#ffffff');
assert.equal(surfaceFill({type:'text',style:{fill:'#ffffff',fillMode:'none'}}).mode,'none');
const project={revision:1,deck:{slides:[{id:'s',nodes:[{id:'t',type:'text'}]}]}};
assert.throws(()=>normalizeCommand({type:'node.setStyle',baseRevision:1,payload:{slideId:'s',nodeId:'t',style:{fillMode:'none',fill:'#fff'}}},project));
console.log('PASS source-quoted explanation closure, scope selection, same-page composition and new/native/explicit surface semantics');
// Qwen's structured-output subset rejects uniqueItems, but local evidence
// contracts must continue rejecting duplicates after that wire hint is omitted.
const {obligationSchema}=await import('./lib/ppt-explanation-obligations.mjs');
assert.equal(JSON.stringify(obligationSchema({type:'string'})).includes('uniqueItems'),false);
assert.ok(obligationProblems(p,[{...o,triggerSourceUnitIds:['u0','u0']}]).some(message=>message.includes('triggerSourceUnitIds')));
assert.ok(obligationProblems(p,[{...o,sourceUnitIds:['u0','u0']}]).some(message=>message.includes('sourceUnitIds')));
