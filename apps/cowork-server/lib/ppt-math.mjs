/** Source equations are parsed, never stripped. KaTeX provides bounded MathML;
 * exporters convert it to native Office math, with explicit lossless fallback. */
import katex from 'katex';
/** KaTeX versions may serialize attributes in a different order. Canonicalize
 * only attribute ordering, preserving every tag, value and text character. */
export function mathMarkupKey(value) {
  return String(value||'').replace(/<([A-Za-z][\w:.-]*)(\s+[^<>]*?)?(\/?)>/gu,(whole,name,body='',closing)=>{
    const attributes=[...body.matchAll(/([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/gu)];
    if(body.replace(/([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/gu,'').trim())return whole;
    return '<'+name+attributes.map(match=>[match[1],match[2]]).sort(([a],[b])=>a.localeCompare(b)).map(([key,text])=>' '+key+'='+text).join('')+closing+'>';
  });
}
// Names spelled as letters are one upright identifier (Fable review fz-r15:
// KaTeX sets "SMB", "MKT_i", "Cov" as separate italic letters, read as products).
const NAMED=new Set(['Cov','Var','Corr','Std','cov','var','corr','std','max','min','log','exp','sgn','Prob','tr','rank']);
const SUBSCRIPT='(?:<mi>[^<]*</mi>|<mn>[^<]*</mn>|<mrow>(?:(?!<mrow>)[\\s\\S])*?</mrow>)';
const LETTER='<mi(?: mathvariant="normal")?>[A-Za-z]</mi>';
const IDENTIFIER_RUN=new RegExp(`((?:${LETTER}){2,})(?:<msub><mi>([A-Za-z])</mi>(${SUBSCRIPT})</msub>)?`,'gu');
// A letter-only subscript or superscript of 3+ letters, or a known 2-letter
// name, is one upright label (Fable plan T21, fz p8 "w_mkt" read as m·k·t);
// two index letters (w_ij) stay separate.
const SCRIPT_NAMES=new Set([...NAMED,'mkt','smb','hml','umd','rmw','cma','bm','me','op','inv','min','max','avg','ret','vol','ann','idx','obs','mom']);
const SCRIPT_LETTERS=/(<(?:msub|msup|msubsup)>(?:<mi(?: mathvariant="normal")?>[^<]*<\/mi>|<mn>[^<]*<\/mn>))<mrow>((?:<mi>[A-Za-z]<\/mi>){2,})<\/mrow>/gu;
export function mergeIdentifierRuns(mathMl){
  return String(mathMl||'').replace(SCRIPT_LETTERS,(whole,head,letters)=>{const word=[...letters.matchAll(/<mi>([A-Za-z])<\/mi>/gu)].map(match=>match[1]).join('');return word.length>=3||SCRIPT_NAMES.has(word)?`${head}<mi mathvariant="normal">${word}</mi>`:whole;}).replace(IDENTIFIER_RUN,(whole,run,last,sub)=>{
    const word=[...run.matchAll(/<mi(?: mathvariant="normal")?>([A-Za-z])<\/mi>/gu)].map(match=>match[1]).join('')+(last||'');
    // Upright letters (\mathrm{Cov}), capitals (SMB), a known name, or four or
    // more letters in any case (SmallHigh) are one name (Fable review r16).
    if(!(/mathvariant="normal"/u.test(run)||/^[A-Z]+$/u.test(word)||NAMED.has(word)||word.length>=4))return whole;
    const name=`<mi mathvariant="normal">${word}</mi>`;
    return sub?`<msub>${name}${sub}</msub>`:name;
  });
}
/** \underbrace{X}_{label} and \overbrace{X}^{label}: X stays in the formula
 * and the labels become a legend under it (Fable r19 H, mlq p2: Office math
 * from the stretched brace and its label drew as an unreadable glyph row with
 * "¿" marks in LibreOffice). Returns the formula without braces and the
 * [{expression,label}] legend, in order. */
export function braceLegend(tex){
 const legend=[];let out='',at=0;const source=String(tex||'');
 const group=start=>{if(source[start]!=='{')return null;let depth=0;for(let k=start;k<source.length;k++){if(source[k]==='\\'){k++;continue;}if(source[k]==='{')depth++;else if(source[k]==='}'&&--depth===0)return{body:source.slice(start+1,k),end:k+1};}return null;};
 const brace=/\\(under|over)brace(?![A-Za-z])\s*/gu;let match;
 while((match=brace.exec(source))){
  const body=group(brace.lastIndex);if(!body)continue;
  let end=body.end,label='';const mark=source.slice(end).match(/^\s*([_^])\s*/u);
  if(mark&&(mark[1]==='_')===(match[1]==='under')){const lab=group(end+mark[0].length);if(lab){label=lab.body;end=lab.end;}else{const single=source.slice(end+mark[0].length).match(/^\\?[A-Za-z0-9]/u);if(single){label=single[0];end+=mark[0].length+single[0].length;}}}
  out+=source.slice(at,match.index)+body.body;at=end;brace.lastIndex=end;
  if(label)legend.push({expression:body.body.trim(),label:label.replace(/\\(?:text|mathrm|textrm)\{([^{}]*)\}/gu,'$1').replace(/\s+/gu,' ').trim()});
 }
 return{tex:out+source.slice(at),legend};
}
export function equationContent(text,{displayMode=true}={}) {
  const original=String(text||'').trim();
  const braced=braceLegend(original.replace(/^\$\$|\$\$$/gu,'').replace(/^\\\[|\\\]$/gu,'').trim()),tex=braced.tex;
  try {
    const rendered=katex.renderToString(tex,{output:'mathml',displayMode,throwOnError:true,trust:false,maxExpand:1000,maxSize:20,
      // CJK labels inside formulas (净利润/总资产) are rendered as upright text; not a warning.
      strict:code=>code==='unicodeTextInMathMode'?'ignore':'warn'});
    const mathMl=mergeIdentifierRuns(rendered.match(/<math\b[\s\S]*?<\/math>/u)?.[0]);
    if(!mathMl)throw new Error('MathML output missing');
    const displayText=mathMl.replace(/<annotation\b[\s\S]*?<\/annotation>/gu,'').replace(/<[^>]+>/gu,'').replace(/&amp;/gu,'&').replace(/&lt;/gu,'<').replace(/&gt;/gu,'>');
    return {text:original,mathText:original,tex,mathMl,displayText,mathStatus:'native_math',...(braced.legend.length?{braceLegend:braced.legend}:{})};
  } catch(error) {
    return {text:original,mathText:original,tex,mathStatus:'source_text_fallback',mathWarning:String(error.message).slice(0,200)};
  }
}

export const OFFICE_MATH_SCRIPT=String.raw`
import xml.etree.ElementTree as math_ET
import re as math_re
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
            # MathML token semantics: a single-letter identifier is italic,
            # numbers/operators/text are upright, and mathvariant selects the
            # Office script (calligraphic F is not the letter F).
            variant=el.get('mathvariant') or ''
            style=('i' if name=='mi' and len(el.text or '')==1 and math_re.match(r'[A-Za-z\u0370-\u03ff]',el.text or '') else 'p') if not variant else {'normal':'p','italic':'i','bold':'b','bold-italic':'bi','bold-script':'b','bold-fraktur':'b','bold-sans-serif':'b','sans-serif-bold-italic':'bi'}.get(variant,'p')
            script={'script':'script','bold-script':'script','double-struck':'double-struck','fraktur':'fraktur','bold-fraktur':'fraktur','sans-serif':'sans-serif','bold-sans-serif':'sans-serif','sans-serif-italic':'sans-serif','sans-serif-bold-italic':'sans-serif','monospace':'monospace'}.get(variant)
            run=m('r'); prop=m('rPr')
            if script:scr=m('scr');scr.set(qn('m:val'),script);prop.append(scr)
            # An upright word (\\text, \\mathrm, \\operatorname, a merged identifier)
            # is normal text: LibreOffice draws sty="p" italic (Fable r19 G). In
            # OMML m:nor and m:sty are alternatives, never both.
            if style=='p' and not script and len(math_re.findall(r'[A-Za-z]',el.text or ''))>=2:prop.append(m('nor'))
            else:sty=m('sty');sty.set(qn('m:val'),style);prop.append(sty)
            run.append(prop)
            ctrl=OxmlElement('a:rPr');ctrl.set('sz',str(int(size*100)))
            latin=OxmlElement('a:latin');latin.set('typeface',resolve_font('Cambria Math',el.text or '') if 'resolve_font' in globals() else 'Cambria Math');ctrl.append(latin);run.append(ctrl)
            txt=m('t');txt.text=el.text or '';run.append(txt);return [run]
        if name=='mspace':return []
        if name=='mfrac':
            if len(children)!=2:raise ValueError('invalid fraction')
            return [wrap('f',[wrap('num',convert(children[0])),wrap('den',convert(children[1]))])]
        if name in ('msub','msup','msubsup'):
            # KaTeX writes h_{\max} as <msub><mi>h</mi><mi>max</mi><mo>&#x2061;</mo></msub>;
            # the invisible function-application operator is not a script argument.
            children=[c for c in children if not (tag(c)=='mo' and (c.text or '').strip()=='\u2061')]
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
        if color is not None:paragraph.font.color.rgb=RGBColor.from_string(str(color).replace('#',''))
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

RICH_MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
def rich_visible_text(element):
    if element.tag==qn('a:txBody') or element.tag==qn('p:txBody'):
        return '\n'.join(rich_visible_text(child) for child in element if child.tag==qn('a:p'))
    local=element.tag.rsplit('}',1)[-1]
    if local=='AlternateContent':
        fallback=element.find('{'+RICH_MC+'}Fallback')
        return rich_visible_text(fallback) if fallback is not None else ''
    if local=='t':return (element.text or '').replace('\u2060','')
    if local=='br':return '\n'
    return ''.join(rich_visible_text(child) for child in element)

def write_rich_text(paragraph,rich,size,color=None,family='Calibri',bold=False):
    if rich.get('diagnostics'):raise ValueError('unsupported rich text: '+str(rich['diagnostics'][0]['code']))
    # python-pptx Paragraph.clear() removes only its known run/field/break
    # elements. Imported Office math lives in MC/a14 children and would survive
    # that call, duplicating the old equation after an edit.
    for child in list(paragraph._p):
        if child.tag!=qn('a:pPr'):paragraph._p.remove(child)
    def add_run(spec,parent=None):
        # Inline code breaks only after . _ , (Fable plan T29, mlq p46 "KFold(shuffle=True"):
        # word joiners hold the rest of the span together in PowerPoint and LibreOffice.
        text=spec.get('text','')
        if spec.get('code'):text=''.join(ch+('\u2060' if k+1<len(text) and ch not in '._, \t' and not text[k+1].isspace() else '') for k,ch in enumerate(text))
        run=paragraph.add_run();run.text=text
        run.font.size=Pt(float(spec.get('fontSizePt',size))*float(spec.get('scale',1)))
        run.font.name=spec.get('fontFamily') or family;run.font.bold=bool(spec.get('bold',bold));run.font.italic=bool(spec.get('italic',False))
        if spec.get('href'):
            run.hyperlink.address=spec['href']
            # Office's hyperlink theme otherwise overrides explicit text paint
            # in both PowerPoint and LibreOffice/PDF. Use the run's measured
            # foreground (also correct inside light table cells on dark slides).
            # MS-ODRAWXML 2.35.1.1 / 5.33: hlinkClr val=tx.
            from lxml import etree as hyperlink_ET
            link=run._r.get_or_add_rPr().find(qn('a:hlinkClick'))
            ext_list=OxmlElement('a:extLst');extension=OxmlElement('a:ext')
            extension.set('uri','{A12FA001-AC4F-418D-AE19-62706E023703}')
            paint=hyperlink_ET.Element('{http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor}hlinkClr',nsmap={'ahyp':'http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor'})
            paint.set('val','tx');extension.append(paint);ext_list.append(extension);link.append(ext_list)
        pr=run._r.get_or_add_rPr();pr.set('baseline',str(spec.get('baseline',0)))
        # DrawingML stores hundredths of a point; python-pptx truncates through EMU.
        # Write the nearest representable value directly, exactly as verified.
        pr.set('sz',str(int(round(float(spec.get('fontSizePt',size))*float(spec.get('scale',1)),2)*100+0.5)))
        if spec.get('strike'):pr.set('strike','sngStrike')
        if spec.get('underline') is not None:run.font.underline=bool(spec['underline'])
        if spec.get('color') or color is not None:run.font.color.rgb=RGBColor.from_string(str(spec.get('color') or color).replace('#',''))
        if parent is not None:paragraph._p.remove(run._r);parent.append(run._r)
        requested='Consolas' if spec.get('code') else spec.get('fontFamily') or family
        if 'font_runs' in globals():
            for part,actual in font_runs(run,requested):
                part.font.name=actual
                ea=OxmlElement('a:ea');ea.set('typeface',actual);part._r.get_or_add_rPr().append(ea)
        return run
    for spec in rich.get('runs',[]):
        if spec.get('kind')!='math':
            # DrawingML line breaks are a:br, not newline-only a:t runs. A
            # newline run was resolved to the CJK fallback font, inflating line
            # metrics even in an otherwise Latin card and clipping its tail.
            for index,part in enumerate(str(spec.get('text','')).split('\n')):
                if index:paragraph._p.append(OxmlElement('a:br'))
                if part:add_run({**spec,'text':part})
            continue
        if spec.get('status')!='native_math' or not spec.get('mathMl'):raise ValueError('unsupported inline math')
        from lxml import etree as rich_ET
        alt=rich_ET.Element('{'+RICH_MC+'}AlternateContent',nsmap={'mc':RICH_MC,'a14':'http://schemas.microsoft.com/office/drawing/2010/main'})
        choice=rich_ET.SubElement(alt,'{'+RICH_MC+'}Choice',Requires='a14')
        holder=rich_ET.SubElement(choice,'{http://schemas.microsoft.com/office/drawing/2010/main}m')
        para=OxmlElement('m:oMathPara');para.append(office_math(spec['mathMl'],float(spec.get('fontSizePt',size))));holder.append(para)
        if color is not None:
            for rpr in holder.findall('.//'+qn('a:rPr')):
                fill=OxmlElement('a:solidFill');rgb=OxmlElement('a:srgbClr');rgb.set('val',str(color).replace('#',''));fill.append(rgb);rpr.append(fill)
        fallback=rich_ET.SubElement(alt,'{'+RICH_MC+'}Fallback')
        paragraph._p.append(alt)
        for segment in spec.get('fallbackRuns',[]):add_run({**segment,'fontSizePt':spec.get('fontSizePt',size),'bold':bool(segment.get('bold') or spec.get('bold',bold))},fallback)
    return True
`;

/** Math renderers scale equations to their frame. Use the built-up expression's
 * aspect ratio instead of stretching a short formula across the body width. */
/** Unicode Mathematical Alphanumeric letters, including the Letterlike holes
 * (ℱ, ℝ, ℭ ...), so a non-Office renderer still distinguishes 𝓕 from F. */
const LETTERLIKE={script:{B:'ℬ',E:'ℰ',F:'ℱ',H:'ℋ',I:'ℐ',L:'ℒ',M:'ℳ',R:'ℛ',e:'ℯ',g:'ℊ',o:'ℴ'},
  'double-struck':{C:'ℂ',H:'ℍ',N:'ℕ',P:'ℙ',Q:'ℚ',R:'ℝ',Z:'ℤ'},fraktur:{C:'ℭ',H:'ℌ',I:'ℑ',R:'ℜ',Z:'ℨ'}};
const ALPHANUMERIC={script:[0x1D49C,0x1D4B6],'bold-script':[0x1D4D0,0x1D4EA],'double-struck':[0x1D538,0x1D552,0x1D7D8],fraktur:[0x1D504,0x1D51E],'bold-fraktur':[0x1D56C,0x1D586]};
export function mathVariantText(value,variant){
  const table=ALPHANUMERIC[variant];if(!table)return value;
  return [...String(value)].map(c=>{
    const holes=LETTERLIKE[variant.replace(/^bold-/u,'')]||{};
    if(!variant.startsWith('bold-')&&holes[c])return holes[c];
    if(/[A-Z]/u.test(c))return String.fromCodePoint(table[0]+c.charCodeAt(0)-65);
    if(/[a-z]/u.test(c))return String.fromCodePoint(table[1]+c.charCodeAt(0)-97);
    if(/[0-9]/u.test(c)&&table[2])return String.fromCodePoint(table[2]+c.charCodeAt(0)-48);
    return c;
  }).join('');
}
/** Equivalent editable fallback for inline math in non-Office renderers.
 * Office retains the entire OMML Choice; scripts are actual run baselines at
 * the base size: DrawingML renderers shrink baseline-shifted runs themselves
 * (LibreOffice applies 58%), so pre-scaling made indices unreadably small. */
export function mathFallbackRuns(xml) {
  const root={name:'math',children:[]},stack=[root];
  const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/giu,v=>{
    const names={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
    return names[v]??String.fromCodePoint(v.startsWith('&#x')?parseInt(v.slice(3,-1),16):parseInt(v.slice(2,-1),10));
  });
  for(const token of String(xml||'').match(/<[^>]+>|[^<]+/gu)||[]){
    if(token.startsWith('</')){if(stack.length>1)stack.pop();}
    else if(token.startsWith('<')){const name=token.match(/^<([\w:-]+)/u)?.[1];if(!name)continue;
      const node={name:name.split(':').at(-1),variant:token.match(/\smathvariant="([^"]+)"/u)?.[1],lineThickness:token.match(/\slinethickness="([^"]+)"/u)?.[1],children:[]};stack.at(-1).children.push(node);if(!token.endsWith('/>'))stack.push(node);}
    else stack.at(-1).children.push({text:decode(token)});
  }
  const text=(value,baseline=0,style={})=>[{text:value,baseline,scale:1,...style}];
  const walk=(node,base=0)=>{
    // A script without its argument ("x_") has no child to draw.
    if(!node)return [];
    if(node.text!==undefined)return text(node.text,base);
    if(node.name==='mi'||node.name==='mn'){
      const value=node.children.map(child=>child.text??'').join(''),variant=node.variant||'';
      const italic=node.name==='mi'&&(variant?/italic/u.test(variant):[...value].length===1&&/[A-Za-z\u0370-\u03ff]/u.test(value));
      const bold=/bold/u.test(variant);
      return text(mathVariantText(value,variant),base,{...(italic?{italic:true}:{}),...(bold?{bold:true}:{})});
    }
    if(/^annotation/u.test(node.name))return [];
    const c=node.children;
    if(['msub','msup','msubsup','munder','mover','munderover'].includes(node.name)){
      const low=['msub','msubsup','munder','munderover'].includes(node.name);
      // Drop KaTeX's invisible function application (U+2061) between script
      // arguments; otherwise x_{\min}^{2} would lose its superscript.
      const c=node.children.filter(child=>!(child.name==='mo'&&child.children.map(t=>t.text??'').join('').trim()==='\u2061'));
      return [...walk(c[0],base),...walk(c[1],low?-25000:30000),...(c[2]?walk(c[2],30000):[])];
    }
    // A zero-thickness fraction is a binomial whose parentheses are its own
    // mo siblings: "(N choose k)", not "((N choose k))" (live mlq-r37 p31).
    if(node.name==='mfrac'&&/^0(?:px|pt|em)?$/u.test(node.lineThickness||''))return [...walk(c[0],base),...text(' choose ',base),...walk(c[1],base)];
    if(node.name==='mfrac')return [...text('(',base),...walk(c[0],base),...text(')/(',base),...walk(c[1],base),...text(')',base)];
    if(node.name==='msqrt'||node.name==='mroot')return [...(node.name==='mroot'?walk(c[1],30000):[]),...text('√(',base),
      ...(node.name==='mroot'?walk(c[0],base):c.flatMap(n=>walk(n,base))),...text(')',base)];
    if(node.name==='mtable')return [...text('[',base),...c.flatMap((row,i)=>[...(i?text('; ',base):[]),...walk(row,base)]),...text(']',base)];
    if(node.name==='mtr')return c.flatMap((cell,i)=>[...(i?text(', ',base):[]),...walk(cell,base)]);
    return c.flatMap(n=>walk(n,base));
  };
  return walk(root).filter(run=>run.text);
}
export function equationDimensions(content,fontSizePt) {
  const root={name:'math',children:[]},stack=[root];
  for(const token of String(content.mathMl||'').match(/<[^>]+>|[^<]+/gu)||[]) {
    if(token.startsWith('</')){if(stack.length>1)stack.pop();}
    else if(token.startsWith('<')){
      const name=token.match(/^<([\w:-]+)/u)?.[1];if(!name)continue;
      const node={name:name.split(':').at(-1),children:[],width:Number(token.match(/\bwidth="([\d.]+)em"/u)?.[1]||0),separator:/\bseparator="true"/u.test(token)};stack.at(-1).children.push(node);
      if(!token.endsWith('/>'))stack.push(node);
    }else stack.at(-1).children.push({text:token});
  }
  const measure=node=>{
    if(node.text!==undefined)return {w:[...node.text].reduce((n,c)=>n+(/[il.,:;'|]/u.test(c)?.3:/[MW∑∏]/u.test(c)?.9:/\s/u.test(c)?.25:/\p{Script=Han}/u.test(c)?1:.56),0),h:1};
    if(/^annotation/u.test(node.name))return {w:0,h:0};
    // \quad and \qquad are 1em and 2em; renderers put space around relations
    // and binary operators and after a separator (3143 g2s page 9: frames sized
    // without them clipped "(forget gate 遗忘门)" and "h_T^{(i)} = RNN").
    if(node.name==='mspace')return {w:node.width,h:0};
    if(node.name==='mo'){const op=node.children.map(child=>child.text||'').join('').trim();const base=measure({name:'mrow',children:node.children});
     return {w:base.w+(node.separator||/^[,;]$/u.test(op)?.17:/^[=<>≤≥≈≠→←↔⇒⟹∈∉⊂⊆∼≡]$/u.test(op)?.56:/^[+\-−×·⊙⊗∘±∓∪∩]$/u.test(op)?.44:0),h:base.h};}
    const c=node.children.map(measure),sum=c.reduce((n,v)=>n+v.w,0),high=Math.max(1,...c.map(v=>v.h));
    if(node.name==='mfrac')return {w:Math.max(...c.map(v=>v.w),0)+.45,h:c.reduce((n,v)=>n+v.h*.85,0)+.5};
    if(['msub','msup','msubsup'].includes(node.name))return {w:(c[0]?.w||0)+Math.max(...c.slice(1).map(v=>v.w*.65),0),h:high+.45};
    if(['mover','munder','munderover'].includes(node.name))return {w:Math.max(...c.map(v=>v.w),0),h:high+.5};
    if(['msqrt','mroot'].includes(node.name))return {w:sum+.7,h:high+.25};
    if(node.name==='mtable')return {w:Math.max(...c.map(v=>v.w),0),h:c.reduce((n,v)=>n+v.h,0)+Math.max(0,c.length-1)*.35};
    if(node.name==='mtr')return {w:sum+Math.max(0,c.length-1)*1.4,h:high};
    return {w:sum,h:high};
  };
  // A 5% margin covers renderer differences (the editor preview and Office).
  const m=measure(root);return {widthPt:Math.max(fontSizePt,(m.w+.25)*fontSizePt*1.05),heightPt:Math.max(fontSizePt*1.3,m.h*fontSizePt)};
}
