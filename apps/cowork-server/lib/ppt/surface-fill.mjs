/** A missing fill on NEW text is transparent. Missing native fill is not
 * permission to erase a theme/picture/gradient from the source package. */
export function surfaceFill(node) {
  const style=node.style||{},kind=node.kind||node.type;
  if(!['text','shape'].includes(kind))return null;
  if(style.fillMode==='none')return {version:1,mode:'none',basis:'explicit_clear'};
  if(/^#[0-9a-f]{6}$/iu.test(style.fill||''))return {version:1,mode:'solid',color:style.fill.toLowerCase(),basis:'explicit_color'};
  if(node.nativeRef)return {version:1,mode:'preserve_native',basis:'native_no_override'};
  return {version:1,mode:kind==='text'?'none':'solid',...(kind==='text'?{}:{color:'#64748b'}),basis:'new_object_default'};
}
