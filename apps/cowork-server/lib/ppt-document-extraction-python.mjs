/** Geometry and provenance helpers used by the production source decoder.
 * OCR supplements image-only pages; it never replaces native text. */
import {PDF_LAYOUT_RECOVERY_SCRIPT} from './ppt-pdf-layout-recovery.mjs';
export const DOCUMENT_EXTRACTION_SCRIPT=PDF_LAYOUT_RECOVERY_SCRIPT+String.raw`
def pdf_sequence_diagram(page):
    # Lifelines and alt frames are not table cells. Require independent text
    # and geometry evidence, so an ordinary API reference table stays a table.
    import re
    text=page.extract_text() or ''
    protocols=set(re.findall(r'\b(?:tools/(?:list|call)|resources/(?:list|read)|prompts/(?:list|get)|initializeResult)\b',text))
    vertical=[line for line in page.lines if abs(line['x1']-line['x0'])<1 and abs(line['bottom']-line['top'])>page.height*.35]
    branches=len(re.findall(r'(?:\balt\b|\[\s*\d+[A-Z]?\))',text))
    return len(protocols)>=4 and len(vertical)>=3 and branches>=2

# Word gaps are measured against the font size: justified LaTeX columns set
# words closer than pdfplumber's default 3 pt (Fable 2026-10-26, world_models.pdf:
# "compressedspatialandtemporalrepresentation").
PDF_WORDS={'x_tolerance_ratio':.15}
PDF_LIGATURES={'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'}
PDF_SPACING_ACCENTS={'¨':'̈','´':'́','ˆ':'̂','˜':'̃','ˇ':'̌','˚':'̊'}
def pdf_clean_text(value):
    # Ligatures are letters; a spacing accent set apart from its letter (LaTeX
    # "Ju¨rgen") joins it; no space is ever put between two Han glyphs; NFC.
    import re,unicodedata
    value=''.join(PDF_LIGATURES.get(ch,ch) for ch in str(value))
    accents='['+''.join(PDF_SPACING_ACCENTS)+']'
    value=re.sub(r'([^\W\d_])('+accents+')',lambda m:m.group(1)+PDF_SPACING_ACCENTS[m.group(2)],value)
    value=re.sub('('+accents+r')([^\W\d_])',lambda m:m.group(2)+PDF_SPACING_ACCENTS[m.group(1)],value)
    value=re.sub(r'(?<=[㐀-鿿豈-﫿]) +(?=[㐀-鿿豈-﫿])','',value)
    return unicodedata.normalize('NFC',value)
def pdf_text_lines(area,order):
    lines=[]
    for line in area.extract_text_lines(return_chars=True,**PDF_WORDS):
        sizes=[float(c.get('size') or 0) for c in line.get('chars',[]) if str(c.get('text','')).strip()]
        lines.append({'text':pdf_clean_text(line.get('text','')),'size':round(sum(sizes)/len(sizes)*2)/2 if sizes else 0,
            'top':line['top'],'bottom':line['bottom'],'x0':line['x0'],'x1':line['x1'],'readingBand':order,'chars':line.get('chars',[])})
    recovered=pdf_script_lines(area,lines)
    return [{k:v for k,v in line.items() if k!='chars'} for line in recovered]
def pdf_char_key(c):return (str(c.get('text','')),round(float(c['x0']),2),round(float(c['top']),2))
def pdf_reading_lines(page):
    from collections import Counter
    chars=[c for c in page.chars if str(c.get('text','')).strip()]
    if not chars:return [],None
    # Rotated text outside the page's body text block (an arXiv stamp in the
    # margin) is not body text; rotated labels inside the block are (Fable 2026-10-26).
    upright=[c for c in chars if c.get('upright',True)] or chars
    left=min(float(c['x0']) for c in upright);right=max(float(c['x1']) for c in upright)
    margin=[c for c in chars if not c.get('upright',True) and (float(c['x1'])<=left+1 or float(c['x0'])>=right-1)]
    margin_keys={pdf_char_key(c) for c in margin}
    if margin:
        page=page.filter(lambda obj:obj.get('object_type')!='char' or pdf_char_key(obj) not in margin_keys)
        chars=[c for c in chars if pdf_char_key(c) not in margin_keys]
    # Rotated glyphs advance along y: a gap wider than a fifth of the size is a space.
    def rotated_text(glyphs):
        out=[]
        for prev,c in zip([None]+glyphs[:-1],glyphs):
            if prev is not None:
                gap=max(float(c['top'])-float(prev['bottom']),float(prev['top'])-float(c['bottom']))
                if gap>float(c.get('size') or 10)*.2:out.append(' ')
            out.append(str(c['text']))
        return ''.join(out)
    margin_text=pdf_clean_text(rotated_text(margin)).strip()
    # A persistent empty vertical strip near the middle (the gutter), with
    # enough text on BOTH sides, is evidence for columns; the cut is the strip's
    # centre. Scanned point by point: a fixed set of cuts missed narrow LaTeX
    # gutters (world_models.pdf p2 interleaved). Full-width rows stay outside.
    rows={}
    for c in chars:rows.setdefault(round(c['top']/6)*6,[]).append(c)
    width=int(page.width)+1;lo=int(page.width*.35);hi=int(page.width*.65);half=2
    scores=[0]*width;band_rows={}
    for top,row in rows.items():
        covered=[False]*width;centres=sorted((float(c['x0'])+float(c['x1']))/2 for c in row)
        for c in row:
            for x in range(max(0,int(float(c['x0']))),min(width,int(float(c['x1']))+1)):covered[x]=True
        import bisect
        for x in range(lo,hi+1):
            if any(covered[max(0,x-half):x+half+1]):continue
            left_count=bisect.bisect_left(centres,x);right_count=len(centres)-left_count
            if left_count>=8 and right_count>=8:scores[x]+=1;band_rows.setdefault(x,[]).append(top)
    best=max(scores[lo:hi+1]) if hi>=lo else 0
    candidates=[]
    if best>=3:
        xs=[x for x in range(lo,hi+1) if scores[x]==best];run=[xs[0]]
        for x in xs[1:]:
            if x==run[-1]+1:run.append(x)
            else:break
        cut=(run[0]+run[-1])/2;band=band_rows[run[len(run)//2]]
        span=max(band)-min(band)
        crossing=sum(any(not (c['x1']<cut-half or c['x0']>cut+half) for c in row) for row in rows.values())
        # Alternating large pictures can leave just three simultaneous text
        # baselines. Accept that weaker evidence only for a broad, persistent
        # gutter with almost no crossing prose, never an ordinary single column.
        sparse=best==3 and len(run)>=8 and span>=144 and crossing<=max(1,len(rows)*.1)
        if span>=72 and (best>=4 or sparse):candidates.append((best,cut,min(band)-3,max(band)+18))
    column=max(candidates) if candidates and not pdf_sequence_diagram(page) else None
    if not column:
        return pdf_reading_lines_single(page),({'status':'margin_only','marginText':margin_text} if margin_text else None)
    # Rows that cross the gutter (a title, a full-width caption or equation)
    # are full-width bands; the rows between them are read left column, then
    # right. Each glyph belongs to exactly one area, by its centre; a glyph within
    # 1 pt of the cut goes with the neighbour on its own baseline (Fable 2026-10-26:
    # overlapping crops counted edge glyphs twice and dropped two-column pages to
    # line-by-line interleaving).
    cut=column[1];gap=half
    kinds=[]
    for top in sorted(rows):
        row=rows[top];crossing=[c for c in row if not (c['x1']<cut-gap or c['x0']>cut+gap)]
        kinds.append((top,'span' if crossing else 'split'))
    segments=[]
    for top,kind in kinds:
        if segments and segments[-1][0]==kind:segments[-1][2]=top
        else:segments.append([kind,top,top])
    bounds=[]
    for index,(kind,first,last) in enumerate(segments):
        start=0 if index==0 else (segments[index-1][2]+first)/2
        stop=page.height if index==len(segments)-1 else (last+segments[index+1][1])/2
        bounds.append((kind,start,stop))
    areas=[]
    for kind,start,stop in bounds:
        if kind=='split':areas.extend([('L',start,stop),('R',start,stop)])
        else:areas.append(('F',start,stop))
    def side(c):
        centre=(float(c['x0'])+float(c['x1']))/2
        if abs(centre-cut)>1:return 'L' if centre<cut else 'R'
        line=[o for o in chars if o is not c and abs(float(o['bottom'])-float(c['bottom']))<1 and abs((float(o['x0'])+float(o['x1']))/2-cut)>1]
        if not line:return 'L' if centre<cut else 'R'
        nearest=min(line,key=lambda o:abs((float(o['x0'])+float(o['x1']))/2-centre))
        return 'L' if (float(nearest['x0'])+float(nearest['x1']))/2<cut else 'R'
    owner={}
    for c in chars:
        middle=(float(c['top'])+float(c['bottom']))/2
        for index,(kind,start,stop) in enumerate(areas):
            if start<=middle<stop and (kind=='F' or kind==side(c)):owner[pdf_char_key(c)]=index;break
        else:owner[pdf_char_key(c)]=len(areas)-1
    def area_of(obj):
        if obj.get('object_type')=='char':return owner.get(pdf_char_key(obj),-1)
        return -1
    lines=[];after=Counter()
    for order in range(len(areas)):
        area=page.filter(lambda obj,order=order:obj.get('object_type')!='char' or area_of(obj)==order)
        for c in area.chars:
            if str(c.get('text','')).strip():after[pdf_char_key(c)]+=1
        lines.extend(pdf_text_lines(area,order))
    # Every native non-space glyph is read exactly once.
    if Counter(pdf_char_key(c) for c in chars)!=after:
        return pdf_reading_lines_single(page),{'status':'ambiguous','reason':'column split changes native glyph coverage','marginText':margin_text}
    return lines,{'status':'columns','columns':2,'cut':cut,'bbox':[0,column[2],page.width,column[3]],'marginText':margin_text}
def pdf_reading_lines_single(page):
    return pdf_text_lines(page,0)

# Figures (Fable 2026-10-27, world_models.pdf): drawing objects and raster
# images cluster into regions (a 12 pt gap starts a new one), each region takes
# the nearest "Figure N." line within 40 pt below, else above; one figure per
# caption line (side-by-side parts under one line are one figure; stacked
# regions competing for a line: the nearest wins). A captioned figure is
# required; an uncaptioned drawing that passes the size rules is an optional
# diagram titled by its own heading; smaller rules and boxes are decoration.
PDF_FIGURE_CAPTION=r'^\s*(?:Figure|Fig\.)\s*\d+|^\s*[图圖]\s*\d+'
def pdf_figures(page,curves,shapes,lines,number):
    import re
    page_area=float(page.width)*float(page.height)
    box=lambda o:(float(o['x0']),float(o['top']),float(o['x1']),float(o['bottom']))
    items=[{'kind':'vector','curve':True,'box':box(o)} for o in curves]+[{'kind':'vector','curve':False,'box':box(o)} for o in shapes]
    # SketchRNN's Figure 7 consists of thousands of short line strokes, not
    # curves/images. Coalesce strokes into spatial cells before clustering;
    # line-only regions require a real figure caption and enough strokes.
    cells={}
    for line in page.lines:
        x0,y0,x1,y1=box(line)
        if x1-x0>=float(page.width)*.6 or y1-y0>=float(page.height)*.6:continue
        key=(int((x0+x1)/24),int((y0+y1)/24))
        if key not in cells:cells[key]={'kind':'vector','curve':False,'lineOnly':True,'lineCount':0,'box':[x0,y0,x1,y1]}
        cell=cells[key];a,b,c,d=cell['box'];cell['box']=[min(a,x0),min(b,y0),max(c,x1),max(d,y1)];cell['lineCount']+=1
    items+=list(cells.values())
    items+=[{'kind':'raster','index':i,'box':box(o)} for i,o in enumerate(page.images)]
    if not items:return []
    parent=list(range(len(items)))
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    order=sorted(range(len(items)),key=lambda i:items[i]['box'][0])
    for a_pos,a in enumerate(order):
        ax0,ay0,ax1,ay1=items[a]['box']
        for b in order[a_pos+1:]:
            bx0,by0,bx1,by1=items[b]['box']
            if bx0-ax1>12:break
            if max(0,by0-ay1,ay0-by1)<=12:parent[find(a)]=find(b)
    groups={}
    for i in range(len(items)):groups.setdefault(find(i),[]).append(items[i])
    regions=[]
    for members in groups.values():
        vector=[m for m in members if m['kind']=='vector'];raster=[m for m in members if m['kind']=='raster']
        x0=min(m['box'][0] for m in members);y0=min(m['box'][1] for m in members);x1=max(m['box'][2] for m in members);y1=max(m['box'][3] for m in members)
        share=(x1-x0)*(y1-y0)/page_area
        if vector and not raster and not (any(m['curve'] for m in vector) or len(vector)>=3):continue
        if vector and (share<.01 or share>.6):continue
        regions.append({'box':[x0,y0,x1,y1],'vector':bool(vector),'raster':sorted(m['index'] for m in raster),'lineOnly':bool(vector) and not raster and all(m.get('lineOnly') for m in vector),'lineCount':sum(m.get('lineCount',0) for m in vector)})
    # Thin rules touching a drawing (its axes, a frame) extend it; they never
    # make a figure on their own, and a page-wide rule is layout.
    thin=[box(o) for o in page.lines+page.rects if min(float(o['x1'])-float(o['x0']),float(o['bottom'])-float(o['top']))<=1.5 and float(o['x1'])-float(o['x0'])<float(page.width)*.6]
    for region in regions:
        if not region['vector']:continue
        x0,y0,x1,y1=region['box']
        for bx0,by0,bx1,by1 in thin:
            if bx0<=x1+12 and bx1>=x0-12 and by0<=y1+12 and by1>=y0-12:x0,y0,x1,y1=min(x0,bx0),min(y0,by0),max(x1,bx1),max(y1,by1)
        region['box']=[x0,y0,x1,y1]
    # Drawings that now share axes or a frame are one figure (two lines of one chart).
    joined=True
    while joined:
        joined=False
        for a in range(len(regions)):
            for b in range(a+1,len(regions)):
                A,B=regions[a],regions[b]
                if not(A['vector'] and B['vector']):continue
                if B['box'][0]<=A['box'][2]+1 and B['box'][2]>=A['box'][0]-1 and B['box'][1]<=A['box'][3]+1 and B['box'][3]>=A['box'][1]-1:
                    A['box']=[min(A['box'][0],B['box'][0]),min(A['box'][1],B['box'][1]),max(A['box'][2],B['box'][2]),max(A['box'][3],B['box'][3])]
                    A['raster']=sorted(A['raster']+B['raster']);A['lineOnly']=A['lineOnly'] and B['lineOnly'];A['lineCount']+=B['lineCount'];regions.pop(b);joined=True;break
            if joined:break
    # Labels around a drawing (axis ticks, legends) belong to it; a caption
    # line close under it does not (world_models.pdf Figure 24).
    caption_rows=[]
    for w in page.extract_words(**PDF_WORDS):
        if re.match(r'^(?:Figure|Fig\.?|[\u56fe\u5716])$',w['text'],re.I) or re.match(PDF_FIGURE_CAPTION,w['text'],re.I):caption_rows.append((float(w['top']),float(w['bottom'])))
    # A caption row's glyphs are never a figure's labels.
    in_caption=lambda cx,cy:any(top-1<=cy<=bottom+1 for top,bottom in caption_rows)
    for region in regions:
        if not region['vector']:continue
        x0,y0,x1,y1=region['box']
        for c in page.chars:
            cx=(float(c['x0'])+float(c['x1']))/2;cy=(float(c['top'])+float(c['bottom']))/2
            if in_caption(cx,cy):continue
            if x0-6<=cx<=x1+6 and y0-6<=cy<=y1+6:x0=min(x0,float(c['x0']));y0=min(y0,float(c['top']));x1=max(x1,float(c['x1']));y1=max(y1,float(c['bottom']))
        region['box']=[x0,y0,x1,y1]
    rows={}
    for w in page.extract_words(**PDF_WORDS,extra_attrs=['size']):rows.setdefault(round(float(w['top'])/2),[]).append(w)
    lines=[]
    for key in sorted(rows):
        current=[]
        for w in sorted(rows[key],key=lambda w:float(w['x0'])):
            if current and float(w['x0'])-float(current[-1]['x1'])>15:lines.append(current);current=[]
            current.append(w)
        if current:lines.append(current)
    lines=[{'text':pdf_clean_text(' '.join(w['text'] for w in ws)),'size':sorted(float(w['size']) for w in ws)[len(ws)//2],'x0':min(float(w['x0']) for w in ws),'x1':max(float(w['x1']) for w in ws),'top':min(float(w['top']) for w in ws),'bottom':max(float(w['bottom']) for w in ws)} for ws in lines]
    lines.sort(key=lambda l:(l['top'],l['x0']))
    captions=[(i,l) for i,l in enumerate(lines) if re.match(PDF_FIGURE_CAPTION,l['text'],re.I)]
    pairs=[]
    for r,region in enumerate(regions):
        x0,y0,x1,y1=region['box']
        for i,l in captions:
            if min(x1,l['x1'])-max(x0,l['x0'])<=0:continue
            below=l['top']-y1;above=y0-l['bottom']
            if -2<=below<=40:pairs.append((below,r,i))
            elif -2<=above<=40:pairs.append((100+above,r,i))
    owner={};taken={};merged=set()
    for score,r,i in sorted(pairs):
        if r in owner or r in merged:continue
        if i in taken:
            a=taken[i];ay0,ay1=regions[a]['box'][1],regions[a]['box'][3];by0,by1=regions[r]['box'][1],regions[r]['box'][3]
            overlap=min(ay1,by1)-max(ay0,by0)
            # Side by side under one caption line: parts of one figure.
            if overlap>.5*min(ay1-ay0,by1-by0):
                A,B=regions[a],regions[r]
                A['box']=[min(A['box'][0],B['box'][0]),min(A['box'][1],B['box'][1]),max(A['box'][2],B['box'][2]),max(A['box'][3],B['box'][3])]
                A['vector']=A['vector'] or B['vector'];A['raster']=sorted(A['raster']+B['raster']);A['lineOnly']=A['lineOnly'] and B['lineOnly'];A['lineCount']+=B['lineCount'];merged.add(r)
            continue
        owner[r]=i;taken[i]=r
    # Parts beside a captioned figure, above the same caption line, join it
    # (sub-figures "(a)" "(b)" under one "Figure N" line).
    for r,region in enumerate(regions):
        if r in owner or r in merged or not region['vector']:continue
        for a,i in list(owner.items()):
            A=regions[a];overlap=min(A['box'][3],region['box'][3])-max(A['box'][1],region['box'][1])
            if a in merged or overlap<=.5*min(A['box'][3]-A['box'][1],region['box'][3]-region['box'][1]) or not -2<=lines[i]['top']-region['box'][3]<=40:continue
            A['box']=[min(A['box'][0],region['box'][0]),min(A['box'][1],region['box'][1]),max(A['box'][2],region['box'][2]),max(A['box'][3],region['box'][3])]
            A['raster']=sorted(A['raster']+region['raster']);A['lineOnly']=A['lineOnly'] and region['lineOnly'];A['lineCount']+=region['lineCount'];merged.add(r);break
    def caption_text(i):
        out=[lines[i]]
        for l in lines[i+1:]:
            # Parallel-column rows do not end or join this caption. A caption
            # has no four-line limit: retain its complete typographic paragraph.
            if abs(l['x0']-out[0]['x0'])>15 or l['top']<out[-1]['bottom']-1:continue
            if l['top']-out[-1]['bottom']>6 or re.match(PDF_FIGURE_CAPTION,l['text'],re.I):break
            if abs(l['size']-out[0]['size'])>max(.3,out[0]['size']*.05):break
            out.append(l)
        return ' '.join(l['text'].strip() for l in out).strip()
    def own_title(region):
        x0,y0,x1,y1=region['box']
        near=[l for l in lines if min(x1,l['x1'])-max(x0,l['x0'])>0 and (y0-1<=l['top']<=y0+24 or 0<=y0-l['bottom']<=30) and 0<len(l['text'].strip())<=80 and not l['text'].strip().endswith('.')]
        return min(near,key=lambda l:abs(l['top']-y0))['text'].strip() if near else ''
    figures=[]
    for r,region in enumerate(regions):
        if r in merged:continue
        x0,y0,x1,y1=region['box']
        if region['vector']:x0,y0,x1,y1=max(0,x0-6),max(0,y0-6),min(float(page.width),x1+6),min(float(page.height),y1+6)
        caption=caption_text(owner[r]) if r in owner else ''
        if region['lineOnly'] and (not caption or region['lineCount']<24):continue
        figures.append({'page':number,'box':[x0,y0,x1,y1],'vector':region['vector'],'raster':region['raster'],'required':bool(caption),
            'caption':caption or (own_title(region) if region['vector'] else ''),'captionLine':lines[owner[r]]['text'].strip() if r in owner else '',
            'role':'diagram' if region['vector'] else 'source_content'})
    return figures

def scanned_page_ocr(raw,page_index,location):
    import shutil,subprocess,tempfile
    from collections import defaultdict
    if not shutil.which('tesseract'):
        media_warnings.append({'code':'source_ocr_unavailable','required':True,'location':location,'message':'Image-only PDF requires Tesseract OCR runtime; native text is never substituted.'});return
    import pypdfium2 as pdfium
    document=pdfium.PdfDocument(raw);image=document[page_index].render(scale=3).to_pil()
    with tempfile.TemporaryDirectory() as directory:
        path=os.path.join(directory,'page.png');image.save(path)
        installed=subprocess.run(['tesseract','--list-langs'],capture_output=True,text=True,timeout=10).stdout.splitlines()
        language='+'.join(l for l in ('eng','chi_sim','chi_tra') if l in installed) or 'eng'
        result=subprocess.run(['tesseract',path,'stdout','-l',language,'--psm','3','tsv'],capture_output=True,text=True,timeout=90)
        if result.returncode:raise ValueError('OCR failed: '+result.stderr[-500:])
        groups=defaultdict(list);words=[]
        for row in csv.DictReader(io.StringIO(result.stdout),delimiter='\t'):
            if not row.get('text','').strip() or row.get('level')!='5':continue
            word={'text':row['text'],'confidence':float(row['conf']),'bbox':[int(row[k]) for k in ('left','top','width','height')]};words.append(word)
            groups[(row['block_num'],row['par_num'],row['line_num'])].append(word)
        content='\n'.join(' '.join(w['text'] for w in group) for group in groups.values())
        if content:add(location+' / OCR',content,ocr={'engine':'tesseract','language':language,'imageSize':list(image.size),'words':words,'sourcePage':page_index+1})
        low=[w for w in words if w['confidence']<80]
        media_warnings.append({'code':'source_ocr_requires_confirmation','required':True,'location':location,
            'message':'OCR-derived text requires source confirmation before publication (%s/%s words below confidence 80).'% (len(low),len(words))})

def xlsx_chart_source(chart,sheet,formula_sheet,location):
    from openpyxl.utils.cell import range_boundaries
    def values(reference):
        if not reference or '!' not in reference:raise ValueError('Chart has no authoritative cell range')
        title,coordinates=reference.rsplit('!',1);title=title.strip("'").replace("''", "'")
        if title!=sheet.title:raise ValueError('Cross-sheet chart range needs an explicit source mapping')
        x0,y0,x1,y1=range_boundaries(coordinates.replace('$',''))
        if (x1-x0+1)*(y1-y0+1)>10000:raise ValueError('Chart range budget exceeded')
        result=[]
        for y in range(y0,y1+1):
            for x in range(x0,x1+1):
                cell=sheet.cell(y,x);formula=formula_sheet.cell(y,x)
                if cell.value is None and isinstance(formula.value,str) and formula.value.startswith('='):raise ValueError('Chart formula lacks a saved numeric result: '+cell.coordinate)
                result.append({'coordinate':cell.coordinate,'value':cell.value,'display':xlsx_text(cell,formula)})
        return result
    series=[];categories=None
    for index,ser in enumerate(chart.ser):
        val=getattr(ser,'val',None) or getattr(ser,'yVal',None);ref=getattr(getattr(val,'numRef',None),'f',None);points=values(ref)
        cat=getattr(ser,'cat',None) or getattr(ser,'xVal',None)
        catref=getattr(getattr(cat,'strRef',None),'f',None) or getattr(getattr(cat,'numRef',None),'f',None)
        labels=values(catref) if catref else [{'coordinate':None,'value':i+1,'display':str(i+1)} for i in range(len(points))]
        if len(labels)!=len(points) or any(not isinstance(p['value'],(int,float)) for p in points):raise ValueError('Chart categories and numeric values cannot be reconstructed exactly')
        if categories is not None and labels!=categories:raise ValueError('Series have different category ranges')
        tx=getattr(ser,'tx',None);title_ref=getattr(getattr(tx,'strRef',None),'f',None)
        title_values=values(title_ref) if title_ref else []
        series_name=str(title_values[0]['value']) if title_values else str(getattr(tx,'v',None) or 'Series '+str(index+1))
        categories=labels;series.append({'name':series_name,'range':ref,'points':points,'titleRange':title_ref})
    if not series:raise ValueError('Chart has no supported series')
    rows=[['Category']+[s['name'] for s in series]]+[[c['display']]+[s['points'][i]['display'] for s in series] for i,c in enumerate(categories)]
    add_table(location+' / data',rows)
    chart_type=type(chart).__name__
    if chart_type not in ('BarChart','LineChart','PieChart'):raise ValueError('Unsupported chart type '+chart_type+'; exact data retained, supply a native chart export')
    def title_text(title):
        if title is None:return ''
        xml=title.to_tree()
        if any(e.tag.endswith('}strRef') for e in xml.iter()):raise ValueError('Referenced chart title needs an explicit cell mapping; exact table retained')
        return ''.join(e.text or '' for e in xml.iter() if e.tag.endswith('}t'))
    axes=[getattr(chart,name,None) for name in ('x_axis','y_axis')]
    for axis in axes:
        scaling=getattr(axis,'scaling',None)
        if scaling and any(getattr(scaling,k,None) is not None for k in ('logBase','min','max')):raise ValueError('Explicit/logarithmic axis scale needs native scale preservation; exact table retained')
        if scaling and getattr(scaling,'orientation','minMax')!='minMax':raise ValueError('Reversed axis needs native scale preservation; exact table retained')
    if getattr(chart,'grouping','standard') in ('stacked','percentStacked') or getattr(chart,'type','col')=='bar':raise ValueError('Stacked or horizontal chart semantics need explicit native export; exact table retained')
    chart_title=title_text(getattr(chart,'title',None));axis_titles=[title_text(getattr(axis,'title',None)) for axis in axes]
    axis_format=getattr(getattr(axes[1],'numFmt',None),'formatCode',None)
    content={'chartType':{'BarChart':'bar','LineChart':'line','PieChart':'pie'}[chart_type],
        'labels':[c['display'] for c in categories],'values':[p['value'] for p in series[0]['points']],
        'series':[{'name':s['name'],'values':[p['value'] for p in s['points']]} for s in series],'unit':'','chartTitle':chart_title,'axisTitles':axis_titles,'numberFormat':axis_format or '0.##',
        'chartSource':{'type':chart_type,'series':series,'categories':categories,'normalization':'editable native category chart with exact saved cell values'}}
    segments.append({'id':str(len(segments)+1),'location':location,'kind':'chart','chart':content,
        'text':chart_type+' '+json.dumps({'labels':content['labels'],'series':content['series']},ensure_ascii=False)})
`;
