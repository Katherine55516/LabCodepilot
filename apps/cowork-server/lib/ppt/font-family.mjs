const quoted=value=>JSON.stringify(String(value||''));
export function previewFontFamily(project,family){
 const substitutions=project.templateFidelity?.fontSubstitutions||project.externalPptx?.fontSubstitutions||[];
 return substitutions.find(item=>item.family===family&&item.usedFamily!=='default')?.usedFamily;
}
export function cssFontFamily(family,eastAsia,substitute){
 // A missing Latin face must not fall straight to the CJK serif font. The
 // declared, measured substitute precedes generic Latin and CJK fallbacks.
 return [...new Set([family,substitute,'Arial',eastAsia,'Noto Sans CJK SC','PingFang SC','Hiragino Sans'].filter(Boolean))].map(quoted).join(',')+',sans-serif';
}
