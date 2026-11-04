/** Only explicit source list syntax establishes point cardinality; section
 * cues distinguish a checklist from an ordered process, never an inferred edge. */
export function sourcePointListKind(item){
 if(['CodeBlock','TableBlock','EquationBlock'].includes(item?.type))return null;
 const lines=String(item?.text||'').split('\n').map(s=>s.trim()).filter(Boolean),points=lines.filter(s=>/^(?:[-*+]\s+|\d+[.)]\s+)/u.test(s));
 if(points.length<2)return null;
 const section=(item.sectionPath||[]).at(-1)||'';
 if(/checklist|gauntlet|evaluation|acceptance|test(?:ing)?|gate|principles?|guidelines?|关卡|關卡|评估|評估|验收|驗收|检查|檢查|原则|原則/iu.test(section))return 'ChecklistBlock';
 if(points.every(s=>/^\d+[.)]\s/u.test(s))&&/workflow|process|procedure|流程|步骤|步驟/iu.test(section))return 'ProcessBlock';
 return 'TaxonomyBlock';
}

export function isSourceReferenceList(item){
 if(!/\breferences?\b|\bbibliography\b|参考(?:来源|文献)|參考(?:來源|文獻)/iu.test((item?.sectionPath||[]).at(-1)||''))return false;
 const lines=String(item?.text||'').split('\n').map(line=>line.trim()).filter(Boolean);
 return lines.length>1&&lines.every(line=>/^(?:[-*+]\s+|\d+[.)]\s+)\[[^\]]+\]\(https?:\/\/[^\s)]+\)$/u.test(line));
}
