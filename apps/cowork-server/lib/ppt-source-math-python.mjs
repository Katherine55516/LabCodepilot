/** Shared source-only Office math and text decoder; unsupported structures fail explicitly. */
export const SOURCE_MATH_SCRIPT=String.raw`
def source_math(element):
    local=element.tag.rsplit('}',1)[-1];children=list(element)
    role=lambda name:next((child for child in children if child.tag.rsplit('}',1)[-1]==name),None)
    value=lambda child:source_math(child) if child is not None else ''
    if local in ('rPr','ctrlPr','fPr','sSubPr','sSupPr','sSubSupPr','mPr','radPr','accPr','oMathParaPr'):return ''
    if local=='t':return element.text or ''
    if local=='f':return r'\frac{'+value(role('num'))+'}{'+value(role('den'))+'}'
    if local in ('sSub','sSup','sSubSup'):return '{'+value(role('e'))+'}'+('_{'+value(role('sub'))+'}' if local!='sSup' else '')+('^{'+value(role('sup'))+'}' if local!='sSub' else '')
    if local=='rad':return r'\sqrt'+('['+value(role('deg'))+']' if value(role('deg')) else '')+'{'+value(role('e'))+'}'
    if local=='d':
        prop=role('dPr')
        def delimiter(name,default):
            found=next((n for n in prop if n.tag.rsplit('}',1)[-1]==name),None) if prop is not None else None
            char=found.get('{http://schemas.openxmlformats.org/officeDocument/2006/math}val',default) if found is not None else default
            return {'{':r'\{','}':r'\}','':' .'.strip()}.get(char,char)
        return r'\left'+delimiter('begChr','(')+delimiter('sepChr','|').join(value(e) for e in children if e.tag.rsplit('}',1)[-1]=='e')+r'\right'+delimiter('endChr',')')
    if local=='bar':
        prop=role('barPr');pos=prop.find('{http://schemas.openxmlformats.org/officeDocument/2006/math}pos') if prop is not None else None
        return (r'\underline' if pos is not None and pos.get('{http://schemas.openxmlformats.org/officeDocument/2006/math}val')=='bot' else r'\overline')+'{'+value(role('e'))+'}'
    if local=='nary':
        prop=role('naryPr');symbol=prop.find('{http://schemas.openxmlformats.org/officeDocument/2006/math}chr') if prop is not None else None
        char=symbol.get('{http://schemas.openxmlformats.org/officeDocument/2006/math}val') if symbol is not None else '∫'
        command={'∑':r'\sum','∏':r'\prod','∫':r'\int','⋃':r'\bigcup','⋂':r'\bigcap'}.get(char)
        if not command:raise ValueError('unsupported source nary operator')
        return command+('_{'+value(role('sub'))+'}' if value(role('sub')) else '')+('^{'+value(role('sup'))+'}' if value(role('sup')) else '')+' '+value(role('e'))
    if local=='m':return r'\begin{matrix}'+r'\\'.join('&'.join(source_math(cell) for cell in row if cell.tag.rsplit('}',1)[-1]=='e') for row in children if row.tag.rsplit('}',1)[-1]=='mr')+r'\end{matrix}'
    if local in ('limLow','limUpp'):return '{'+value(role('e'))+'}'+('_{' if local=='limLow' else '^{')+value(role('lim'))+'}'
    if local=='acc':
        char=element.find('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}chr');accent=char.get('{http://schemas.openxmlformats.org/officeDocument/2006/math}val') if char is not None else None
        command={'¯':r'\overline','‾':r'\overline','^':r'\hat','ˆ':r'\hat','~':r'\tilde','˜':r'\tilde','→':r'\vec'}.get(accent)
        if not command:raise ValueError('unsupported source equation accent')
        return command+'{'+value(role('e'))+'}'
    if local in ('oMath','oMathPara','r','e','num','den','sub','sup','deg','lim'):return ''.join(source_math(child) for child in children)
    raise ValueError('unsupported source equation structure: '+local)
def source_inline(element):
    local=element.tag.rsplit('}',1)[-1]
    if local=='AlternateContent':
        choice=next((c for c in element if c.tag.rsplit('}',1)[-1]=='Choice'),None)
        fallback=next((c for c in element if c.tag.rsplit('}',1)[-1]=='Fallback'),None)
        return source_inline(choice if choice is not None else fallback) if choice is not None or fallback is not None else ''
    if local=='oMath':return '$'+source_math(element)+'$'
    if local=='t':return element.text or ''
    if local=='r' and not element.tag.startswith('{http://schemas.openxmlformats.org/officeDocument/2006/math}'):
        text=''.join(source_inline(c) for c in element)
        if not text.strip():return text
        pr=next((c for c in element if c.tag.rsplit('}',1)[-1]=='rPr'),None)
        if pr is not None:
            def enabled(name):
                child=next((c for c in pr if c.tag.rsplit('}',1)[-1]==name),None)
                return pr.get(name) in ('1','true') or child is not None and child.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val','1') not in ('0','false','off')
            if enabled('i'):text='*'+text+'*'
            if enabled('b'):text='**'+text+'**'
        return text
    if local in ('br','tab'):return '\n' if local=='br' else '\t'
    if local in ('pPr','rPr','endParaRPr','ctrlPr'):return ''
    parts=[source_inline(c) for c in element]
    return '\n'.join(parts) if local in ('txBody','tc') else ''.join(parts)

def source_formula_text(element,location):
    try:
        value=source_inline(element)
        trimmed=value.strip()
        if trimmed.startswith('$') and trimmed.endswith('$') and trimmed.count('$')==2:value='$'+trimmed+'$'
        return value
    except ValueError as error:
        media_warnings.append({'code':'source_math_decode','required':True,'location':location,'message':str(error)})
        return ''.join(t.text or '' for t in element.iter() if t.tag.rsplit('}',1)[-1]=='t')

`;
