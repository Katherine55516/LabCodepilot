/** Only explicit source list syntax establishes point cardinality; section
 * cues distinguish a checklist from an ordered process, never an inferred edge. */
export function sourcePointListKind(item){
 if(['CodeBlock','TableBlock','EquationBlock'].includes(item?.type))return null;
 const lines=String(item?.text||'').split('\n').map(s=>s.trim()).filter(Boolean),points=lines.filter(s=>/^(?:[-*+]\s+|\d+[.)]\s+)/u.test(s));
 if(points.length<2)return null;
 const section=(item.sectionPath||[]).join(' ');
 if(/checklist|gauntlet|evaluation|acceptance|test(?:ing)?|gate|关卡|關卡|评估|評估|验收|驗收|检查|檢查/iu.test(section))return 'ChecklistBlock';
 if(points.every(s=>/^\d+[.)]\s/u.test(s))&&/workflow|process|procedure|流程|步骤|步驟/iu.test(section))return 'ProcessBlock';
 return 'TaxonomyBlock';
}
