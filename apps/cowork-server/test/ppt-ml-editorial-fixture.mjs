/** A registered engineering narrative, not a simulated claim of model quality.
 * Assertions live in independent tests. No production input-specific routing. */
export const ML_EDITORIAL_PAGES=[
 ['Small signals and effective samples','b_0002 b_0004 b_0010 b_0013 b_0029 b_0031 b_0034','Why can a flexible learner fit noise despite a large row count?'],
 ['Drift requires refreshed validation','b_0021 b_0022','Why must an old financial model be refreshed and revalidated?'],
 ['Choose the prediction task','b_0042 b_0044 b_0045','Which prediction unit matches cross-sectional stock selection?'],
 ['Residual-return labels','b_0048 b_0065','Why align the residual-return label with the eventual portfolio?'],
 ['Three barriers','b_0069 b_0070 b_0071','How does the first barrier reached determine the outcome?'],
 ['Match horizon to trading costs','b_0079 b_0080','Which horizon trades off execution costs and independent samples?'],
 ['Choose regression or classification','b_0076 b_0077 b_0083 b_0086','When does a classification threshold justify losing return magnitude?'],
 ['Date transforms','b_0091 b_0095 b_0098 b_0100 b_0101 b_0106','Which date-local transforms avoid future-distribution leakage?'],
 ['Feature interactions','b_0115','Which feature interactions have an economic interpretation?'],
 ['Encode industries without leakage','b_0124 b_0125','When can industry encoding use past targets or embeddings?'],
 ['Control exposures at the right stage','b_0130 b_0131 b_0135 b_0136 b_0137 b_0138','How do pre- and post-model neutralization change preserved interactions?'],
 ['Weight overlapping observations','b_0141 b_0144 b_0147 b_0150 b_0153','How does overlap change observation uniqueness?'],
 ['Combine sample-weight corrections','b_0162 b_0165 b_0167 b_0170 b_0172','How do independent weight corrections combine, and when is class weighting applicable?'],
 ['Why random folds leak','b_0175 b_0178','Why do overlapping forward labels share information across random folds?'],
 ['Purge and embargo','b_0188 b_0191 b_0192','Which distinct time boundaries do purge and embargo protect?'],
 ['Compare walk-forward with CPCV','b_0195 b_0199','Which validation answers deployment realism versus robustness?'],
 ['PIT and trading constraints','b_0260','What was knowable and executable at the historical decision time?'],
 ['Model families and capacity','b_0207 b_0209','How should capacity be controlled before adding model complexity?'],
 ['Turn predictions into positions','b_0213 b_0215','Which transformations and constraints separate a prediction from a portfolio?'],
 ['Rolling evaluation and metrics','b_0219 b_0225 b_0227','How are forward predictions generated and evaluated without tuning on the future?'],
 ['Interpret risks','b_0231 b_0233 b_0237 b_0239','How can interpretation identify artifacts and constrain advanced-method degrees of freedom?'],
 ['Production controls','b_0243 b_0245 b_0250 b_0254 b_0255','What must be reproducible, monitored and controlled before a research skeleton is deployed?'],
];
export function mlReadingObligations(items){
 const ids=['b_0162','b_0167','b_0170','b_0172'];
 return [{label:'Combine uniqueness, decay and class weights with the classification condition',sourceUnitIds:ids,triggerSourceUnitIds:['b_0167','b_0170'],relationType:'composition',placement:'same_page',evidence:ids.map(id=>{const item=items.find(i=>i.id===id);if(!item)throw Error('ML original unit missing '+id);return {sourceUnitId:id,start:0,end:item.text.length,quote:item.text};})}];
}
export function mlProseMedia(item){
 const node=(id,label,body='')=>({id,label,body,evidence:{start:0,end:item.text.length,quote:item.text}}),edge=(from,to)=>({from,to,evidence:{start:0,end:item.text.length,quote:item.text}});
 if(item.id==='b_0021'){
  const definitions=[['Regime shifts','all change which features matter and with what sign.'],['Alpha decay','a signal that worked because it was undiscovered will mechanically decay as more capital chases it'],['The Adaptive Markets Hypothesis','reframes market efficiency itself as an evolutionary, time-varying equilibrium rather than a fixed state']];
  return {kind:'parallel',nodes:definitions.map(([label,body],i)=>{const line=item.text.split('\n').find(line=>line.includes('**'+label));if(!line)throw Error('Missing registered drift member');const start=item.text.indexOf(line);return {id:'driver'+i,label,body,evidence:{start,end:start+line.length,quote:line}};}),edges:[]};
 }
 if(item.id==='b_0178')return {kind:'overlap',nodes:[node('train','training fold','$[t, t+h]$'),node('validation','validation fold',"date $t+3$ (within the same label's window, $h=21$)"),node('shared','overlaps',"the training observation's label is computed using price data that overlaps the validation observation's entire future path")],edges:[edge('train','shared'),edge('validation','shared')]};
 if(item.id==='b_0070')return {kind:'branch',nodes:[node('first','first','Whichever of the three lines the price path crosses first determines the label'),node('upper','upper line','touching the upper line first → label $+1$ (win)'),node('lower','lower line','touching the lower line first → label $-1$ (loss)'),node('time','vertical line','reaching the vertical line first without touching either horizontal line → label given by the sign (or magnitude) of the return realized at $t+h_{\\max}$')],edges:[edge('first','upper'),edge('first','lower'),edge('first','time')]};
 if(item.id==='b_0213')return {kind:'dependency',nodes:[node('score','predictions','Model output is not a portfolio.'),node('positions','positions','ranking, volatility scaling, risk-model constraints, turnover penalties, and cost-aware optimization'),node('limits','liquidity and sector limits','The simplest mapping is rank to target active weight, clipped by liquidity and sector limits.')],edges:[edge('score','positions'),edge('positions','limits')]};
 if(item.id==='b_0219')return {kind:'cycle',nodes:[node('train','training windows','expanding or rolling training windows'),node('validate','validation window','a validation window for hyperparameters'),node('forward','forward test window','a forward test window'),node('advance','clock advances','Then the clock advances and the process repeats. This produces a sequence of truly out-of-sample predictions.')],edges:[edge('train','validate'),edge('validate','forward'),edge('forward','advance'),edge('advance','train')]};
 if(item.id==='b_0243')return {kind:'parallel',nodes:[...['feature generation','model training','prediction storage','portfolio construction','monitoring','rollback'].map((label,i)=>node('stage'+i,label)),node('reproduce','Every prediction','Every prediction should be reproducible from a model version, feature snapshot, code hash, and data timestamp.')],edges:[]};
 return null;
}

export function mlPresentationSection(ids){const n=Number(ids[0]?.slice(2));return n<42?'Financial learning':n<91?'Targets and horizons':n<141?'Features and exposures':n<175?'Sample weighting':n<207?'Leakage-safe validation':n<231?'Models and evaluation':n<260?'Production discipline':'Point-in-time controls';}
