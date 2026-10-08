/** Source equations are parsed, never stripped. KaTeX provides bounded MathML;
 * exporters convert it to native Office math, with explicit lossless fallback. */
import katex from 'katex';
export function equationContent(text) {
  const original=String(text||'').trim();
  const tex=original.replace(/^\$\$|\$\$$/gu,'').replace(/^\\\[|\\\]$/gu,'').trim();
  try {
    const rendered=katex.renderToString(tex,{output:'mathml',displayMode:true,throwOnError:true,trust:false,maxExpand:1000,maxSize:20});
    const mathMl=rendered.match(/<math\b[\s\S]*?<\/math>/u)?.[0];
    if(!mathMl)throw new Error('MathML output missing');
    const displayText=mathMl.replace(/<annotation\b[\s\S]*?<\/annotation>/gu,'').replace(/<[^>]+>/gu,'').replace(/&amp;/gu,'&').replace(/&lt;/gu,'<').replace(/&gt;/gu,'>');
    return {text:original,mathText:original,tex,mathMl,displayText,mathStatus:'native_math'};
  } catch(error) {
    return {text:original,mathText:original,tex,mathStatus:'source_text_fallback',mathWarning:String(error.message).slice(0,200)};
  }
}

export const OFFICE_MATH_SCRIPT=String.raw`
import xml.etree.ElementTree as math_ET
MATH_NS='http://schemas.openxmlformats.org/officeDocument/2006/math'
def office_math(xml, size=18):
    if len(xml)>200000: raise ValueError('math payload too large')
    root=math_ET.fromstring(xml)
    def tag(el): return el.tag.rsplit('}',1)[-1]
    def m(name): return OxmlElement('m:'+name)
    def wrap(name,items):
        node=m(name)
        for item in items: node.append(item)
        return node
    def convert(el):
        name=tag(el); children=list(el)
        if name in ('annotation','annotation-xml'): return []
        if name in ('math','semantics','mrow','mstyle','mpadded','menclose'): return [n for c in children for n in convert(c)]
        if name in ('mi','mn','mo','mtext'):
            run=m('r'); prop=m('rPr'); sty=m('sty');sty.set(qn('m:val'),'p');prop.append(sty);run.append(prop)
            ctrl=OxmlElement('a:rPr');ctrl.set('sz',str(int(size*100)))
            latin=OxmlElement('a:latin');latin.set('typeface',resolve_font('Cambria Math',el.text or '') if 'resolve_font' in globals() else 'Cambria Math');ctrl.append(latin);run.append(ctrl)
            txt=m('t');txt.text=el.text or '';run.append(txt);return [run]
        if name=='mspace':return []
        if name=='mfrac':
            if len(children)!=2:raise ValueError('invalid fraction')
            return [wrap('f',[wrap('num',convert(children[0])),wrap('den',convert(children[1]))])]
        if name in ('msub','msup','msubsup'):
            if len(children)!=(3 if name=='msubsup' else 2):raise ValueError('invalid script')
            roles=['e','sub','sup'] if name=='msubsup' else ['e','sub' if name=='msub' else 'sup']
            return [wrap({'msub':'sSub','msup':'sSup','msubsup':'sSubSup'}[name],[wrap(role,convert(c)) for role,c in zip(roles,children)])]
        if name in ('msqrt','mroot'):
            deg=convert(children[1]) if name=='mroot' else []
            rad=m('rad');pr=m('radPr');hide=m('degHide');hide.set(qn('m:val'),'0' if deg else '1');pr.append(hide);rad.append(pr)
            rad.append(wrap('deg',deg));rad.append(wrap('e',convert(children[0]) if name=='mroot' else [n for c in children for n in convert(c)]));return [rad]
        if name in ('munder','mover','munderover'):
            if len(children)<2:raise ValueError('invalid limit')
            base=convert(children[0])
            if name=='mover' and children[1].text in ('¯','‾','^','ˆ','~','˜','→'):
                acc=m('acc');pr=m('accPr');char=m('chr');char.set(qn('m:val'),children[1].text);pr.append(char);acc.append(pr);acc.append(wrap('e',base));return [acc]
            node=wrap('limLow' if name!='mover' else 'limUpp',[wrap('e',base),wrap('lim',convert(children[1]))])
            return [wrap('limUpp',[wrap('e',[node]),wrap('lim',convert(children[2]))])] if name=='munderover' else [node]
        if name=='mtable':
            matrix=m('m')
            for row in children:
                matrix.append(wrap('mr',[wrap('e',convert(cell)) for cell in row]))
            return [matrix]
        if name in ('mtr','mtd'):return [n for c in children for n in convert(c)]
        if name=='mfenced':
            result=[]
            for index,c in enumerate(children):
                if index: result+=convert(math_ET.fromstring('<mo>'+el.get('separators',',')[0]+'</mo>'))
                result+=convert(c)
            for position,value in ((0,el.get('open','(')),(len(result),el.get('close',')'))):
                if value:
                    token=math_ET.Element('mo');token.text=value
                    if position==0:result=convert(token)+result
                    else:result+=convert(token)
            return result
        raise ValueError('unsupported math node '+name)
    return wrap('oMath',convert(root))

def write_office_math(paragraph,content,size,color=None):
    xml=content.get('mathMl')
    if not xml:return False
    try:
        paragraph.font.size=Pt(size)
        paragraph.space_after=Pt(0)
        # PowerPoint requires a14:m > m:oMathPara; raw oMath inside a:p
        # reopens successfully but is invisible in presentation renderers.
        from lxml import etree as math_lxml
        holder=math_lxml.Element('{http://schemas.microsoft.com/office/drawing/2010/main}m',nsmap={'a14':'http://schemas.microsoft.com/office/drawing/2010/main'})
        para=OxmlElement('m:oMathPara');para.append(office_math(xml,size));holder.append(para)
        if color is not None:
            for rpr in holder.findall('.//'+qn('a:rPr')):
                fill=OxmlElement('a:solidFill');rgb=OxmlElement('a:srgbClr');rgb.set('val',str(color).replace('#',''));fill.append(rgb);rpr.append(fill)
        paragraph._p.append(holder);return True
    except (ValueError,math_ET.ParseError) as error:
        # The complete source remains visible. Failures are returned in the
        # export verification manifest instead of removing mathematical objects.
        content['mathExportWarning']=str(error)
        return False
`;

/** Math renderers scale equations to their frame. Use the built-up expression's
 * aspect ratio instead of stretching a short formula across the body width. */
export function equationDimensions(content,fontSizePt) {
  const root={name:'math',children:[]},stack=[root];
  for(const token of String(content.mathMl||'').match(/<[^>]+>|[^<]+/gu)||[]) {
    if(token.startsWith('</')){if(stack.length>1)stack.pop();}
    else if(token.startsWith('<')){
      const name=token.match(/^<([\w:-]+)/u)?.[1];if(!name)continue;
      const node={name:name.split(':').at(-1),children:[]};stack.at(-1).children.push(node);
      if(!token.endsWith('/>'))stack.push(node);
    }else stack.at(-1).children.push({text:token});
  }
  const measure=node=>{
    if(node.text!==undefined)return {w:[...node.text].reduce((n,c)=>n+(/[il.,:;'|]/u.test(c)?.3:/[MW∑∏]/u.test(c)?.9:/\s/u.test(c)?.25:/\p{Script=Han}/u.test(c)?1:.56),0),h:1};
    if(/^annotation/u.test(node.name))return {w:0,h:0};
    const c=node.children.map(measure),sum=c.reduce((n,v)=>n+v.w,0),high=Math.max(1,...c.map(v=>v.h));
    if(node.name==='mfrac')return {w:Math.max(...c.map(v=>v.w),0)+.45,h:c.reduce((n,v)=>n+v.h*.85,0)+.5};
    if(['msub','msup','msubsup'].includes(node.name))return {w:(c[0]?.w||0)+Math.max(...c.slice(1).map(v=>v.w*.65),0),h:high+.45};
    if(['mover','munder','munderover'].includes(node.name))return {w:Math.max(...c.map(v=>v.w),0),h:high+.5};
    if(['msqrt','mroot'].includes(node.name))return {w:sum+.7,h:high+.25};
    if(node.name==='mtable')return {w:Math.max(...c.map(v=>v.w),0),h:c.reduce((n,v)=>n+v.h,0)+Math.max(0,c.length-1)*.35};
    if(node.name==='mtr')return {w:sum+Math.max(0,c.length-1)*1.4,h:high};
    return {w:sum,h:high};
  };
  const m=measure(root);return {widthPt:Math.max(fontSizePt,(m.w+.25)*fontSizePt),heightPt:Math.max(fontSizePt*1.3,m.h*fontSizePt)};
}
