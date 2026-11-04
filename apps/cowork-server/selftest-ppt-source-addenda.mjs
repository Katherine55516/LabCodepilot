import assert from 'node:assert/strict';
import {rehomeClosingAddenda} from './lib/ppt-source-addenda.mjs';
const path=['Tutorial','4.7 Attention-augmented LSTM (ALSTM)'],end=['Tutorial','12. Decision Table and Closing Reminders'];
const items=[{id:'earlier',type:'MechanismBlock',sectionPath:path,text:'Architecture.'},{id:'table',type:'TableBlock',sectionPath:end,text:'ALSTM baseline'},{id:'closing',type:'MechanismBlock',sectionPath:end,text:'Use disciplined financial statistics.'},
 {id:'english',type:'MechanismBlock',sectionPath:end,text:'ALSTM combines all hidden states:'},{id:'chinese',type:'MechanismBlock',sectionPath:end,text:'ALSTM 对全部隐藏状态加权：'},{id:'equation',type:'EquationBlock',sectionPath:end,text:'alpha = exp(u h)'},{id:'explain',type:'MechanismBlock',sectionPath:end,text:'with u learned. ALSTM reads the weighted state.'},{id:'translation',type:'ExampleBlock',sectionPath:end,text:'其中 u 是可学习参数。ALSTM 的预测。'},{id:'code',type:'CodeBlock',sectionPath:end,text:'class ALSTM(nn.Module): pass'}].map((item,k)=>({...item,source_ref:['segment'+k],chunkRefs:['chunk'+k]}));
const original=structuredClone(items),inventory=rehomeClosingAddenda({items:structuredClone(items)});
assert.equal(inventory.presentationRelocations.length,6);
assert.deepEqual(inventory.items.slice(0,3),original.slice(0,3),'closing prose and comparison table stay');
for(const [k,item]of inventory.items.slice(3).entries()){
 assert.deepEqual(item.sectionPath,path);assert.deepEqual(item.originalSectionPath,end);
 for(const field of ['id','text','source_ref','chunkRefs'])assert.deepEqual(item[field],original[k+3][field]);
}
const ambiguous=structuredClone(items);ambiguous.unshift({...ambiguous[0],id:'other',sectionPath:['Tutorial','Another (ALSTM)']});assert.equal(rehomeClosingAddenda({items:ambiguous}).presentationRelocations,undefined);
const noObject=items.filter(item=>!['EquationBlock','CodeBlock'].includes(item.type));assert.equal(rehomeClosingAddenda({items:structuredClone(noObject)}).presentationRelocations,undefined);
const unrelated=structuredClone(items);unrelated.push({id:'other',type:'MechanismBlock',sectionPath:end,text:'A separate closing reminder.'});assert.equal(rehomeClosingAddenda({items:unrelated}).presentationRelocations,undefined);
console.log('PASS technical addenda: bilingual context/formula/code together; raw citation identity preserved; ambiguous and closing-only cases unchanged');
