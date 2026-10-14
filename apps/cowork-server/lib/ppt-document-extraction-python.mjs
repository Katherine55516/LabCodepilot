/** Geometry and provenance helpers used by the production source decoder.
 * OCR supplements image-only pages; it never replaces native text. */
export const DOCUMENT_EXTRACTION_SCRIPT=String.raw`
def pdf_reading_lines(page):
    from collections import Counter
    chars=[c for c in page.chars if str(c.get('text','')).strip()]
    if not chars:return [],None
    # A persistent empty central strip, with enough text on BOTH sides, is
    # evidence for columns. Full-width headings remain outside the split band.
    candidates=[]
    for fraction in (.38,.42,.46,.5,.54,.58,.62):
        cut=page.width*fraction;gap=page.width*.018
        rows={}
        for c in chars:rows.setdefault(round(c['top']/6)*6,[]).append(c)
        band=[]
        for top,row in rows.items():
            left=[c for c in row if c['x1']<cut-gap];right=[c for c in row if c['x0']>cut+gap]
            middle=[c for c in row if c not in left and c not in right]
            if len(left)>=8 and len(right)>=8 and not middle:band.append(top)
        if len(band)>=4 and max(band)-min(band)>=72:candidates.append((len(band),cut,min(band)-3,max(band)+18))
    column=max(candidates) if candidates else None
    areas=[page]
    if column:
        _,cut,top,bottom=column;top=max(0,top);bottom=min(page.height,bottom)
        areas=[]
        if top>0:areas.append(page.crop((0,0,page.width,top)))
        areas.extend([page.crop((0,top,cut,bottom)),page.crop((cut,top,page.width,bottom))])
        if bottom<page.height:areas.append(page.crop((0,bottom,page.width,page.height)))
    lines=[]
    for order,area in enumerate(areas):
        for line in area.extract_text_lines(return_chars=True):
            sizes=[float(c.get('size') or 0) for c in line.get('chars',[]) if str(c.get('text','')).strip()]
            lines.append({'text':line.get('text',''),'size':round(sum(sizes)/len(sizes)*2)/2 if sizes else 0,
                'top':line['top'],'bottom':line['bottom'],'x0':line['x0'],'x1':line['x1'],'readingBand':order})
    # Cropping is permitted only if every native non-space glyph survives once.
    before=Counter(str(c['text']) for c in chars)
    after=Counter()
    for area in areas:
        for c in area.chars:
            if str(c.get('text','')).strip():after[str(c['text'])]+=1
    if before!=after:
        return pdf_reading_lines_single(page),{'status':'ambiguous','reason':'column split changes native glyph coverage'}
    return lines,({'status':'columns','columns':2,'cut':column[1],'bbox':[0,column[2],page.width,column[3]]} if column else None)
def pdf_reading_lines_single(page):
    lines=[]
    for line in page.extract_text_lines(return_chars=True):
        sizes=[float(c.get('size') or 0) for c in line.get('chars',[]) if str(c.get('text','')).strip()]
        lines.append({'text':line.get('text',''),'size':round(sum(sizes)/len(sizes)*2)/2 if sizes else 0,'top':line['top'],'bottom':line['bottom'],'x0':line['x0'],'x1':line['x1'],'readingBand':0})
    return lines

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
