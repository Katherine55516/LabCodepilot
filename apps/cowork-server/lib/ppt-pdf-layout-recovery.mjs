/** Source geometry, not model guesses, recovers narrow scientific tables and
 * simple scripts. Complex typeset math still requires the existing PDF warning. */
export const PDF_LAYOUT_RECOVERY_SCRIPT=String.raw`
def pdf_rule_table_candidates(page):
    import statistics
    rules=[r for r in page.lines if abs(r['top']-r['bottom'])<=1.5 and r['x1']-r['x0']>=page.width*.22]
    groups={}
    for r in rules:groups.setdefault((round(r['x0']/3),round(r['x1']/3)),[]).append(r)
    class RuledTable:
        def __init__(self,bbox,rows):self.bbox=bbox;self.rows=rows
        def extract(self):return self.rows
    found=[]
    for group in groups.values():
        if len(group)<3:continue
        x0=min(r['x0'] for r in group);x1=max(r['x1'] for r in group)
        edges=sorted(set(round(r['top'],1) for r in group))
        bands=[r for r in page.rects if abs(r['x0']-x0)<=3 and abs(r['x1']-x1)<=3 and 8<r['bottom']-r['top']<50 and abs(r['bottom']-edges[0])<=2]
        top=min([edges[0]]+[r['top'] for r in bands]);bottom=edges[-1]
        area=page.crop((x0,top,x1,bottom));lines=area.extract_text_lines(return_chars=True,**PDF_WORDS)
        if len(lines)<3:continue
        words=area.extract_words(**PDF_WORDS)
        # Persistent whitespace, including between a long method name and its
        # right-aligned score, separates columns. Whitespace inside a column
        # is crossed by another row and cannot create a column.
        intervals=sorted((w['x0'],w['x1']) for w in words);merged=[]
        for a,b in intervals:
            if merged and a<=merged[-1][1]+.5:merged[-1][1]=max(merged[-1][1],b)
            else:merged.append([a,b])
        cuts=[(a[1]+b[0])/2 for a,b in zip(merged,merged[1:]) if b[0]-a[1]>=4]
        if not 1<=len(cuts)<=7:continue
        bounds=[x0]+cuts+[x1];rows=[]
        for line in lines:
            cells=[]
            for left,right in zip(bounds,bounds[1:]):
                chars=[c for c in line['chars'] if left<=(c['x0']+c['x1'])/2<right]
                cells.append(pdf_clean_text(pdfplumber.utils.extract_text(chars,**PDF_WORDS)).strip() if chars else '')
            rows.append(cells)
        # Require every column in most rows. Page rules around a paragraph or
        # a sparse diagram are not evidence of a table.
        if sum(all(cell for cell in row) for row in rows)<len(rows)*.7:continue
        found.append(RuledTable((x0,top,x1,bottom),rows))
    return found

PDF_SUPERSCRIPT=str.maketrans('0123456789-−','⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁻')
def pdf_prose_exponents(line,size,baseline):
    # Raised small digits after a digit, letter or ")" in prose are an
    # exponent: "10⁷", never "107" (Fable, 2026-11-01, B4; world_models.pdf
    # "in the order of 10^7 parameters", JEPA "10^-3").
    import statistics
    chars=sorted([c for c in line.get('chars',[]) if str(c.get('text','')).strip()],key=lambda c:c['x0'])
    bases=[c for c in chars if float(c.get('size') or 0)>=size*.9]
    if not bases:return line
    base=statistics.median(baseline(c) for c in bases)
    small=lambda c:0<float(c.get('size') or 0)<=size*.75 and baseline(c)-base>size*.1 and re.fullmatch(r'[0-9\-−]',str(c['text']))
    runs=[];k=0
    while k<len(chars):
        if not small(chars[k]):k+=1;continue
        j=k
        while j+1<len(chars) and small(chars[j+1]) and chars[j+1]['x0']-chars[j]['x1']<size*.3:j+=1
        run=chars[k:j+1];text=''.join(str(c['text']) for c in run)
        before=chars[k-1] if k else None;after=chars[j+1] if j+1<len(chars) else None
        # Set tight against its base, and not running into a word ("ImageNet-1K" in a chart label).
        tight=before is not None and run[0]['x0']-before['x1']<size*.15
        joined=after is not None and after['x0']-run[-1]['x1']<size*.15 and re.fullmatch(r'[0-9A-Za-z]',str(after['text']))
        if re.fullmatch(r'[-−]?[0-9]{1,3}',text) and tight and not joined and re.fullmatch(r'[0-9A-Za-z)]',str(before['text'])):runs.append((run,before))
        k=j+1
    if not runs:return line
    raised={pdf_char_key(c):before for run,before in runs for c in run}
    moved=[{**c,'text':str(c['text']).translate(PDF_SUPERSCRIPT),'top':raised[pdf_char_key(c)]['top'],'bottom':raised[pdf_char_key(c)]['bottom'],'size':raised[pdf_char_key(c)]['size']} if pdf_char_key(c) in raised else c for c in line.get('chars',[])]
    return {**line,'text':pdf_clean_text(pdfplumber.utils.extract_text(moved,**PDF_WORDS)),'chars':moved}
def pdf_script_lines(area,lines):
    import statistics
    if not lines:return lines
    chars=[c for c in area.chars if str(c.get('text','')).strip() and c.get('upright',True)]
    # The actual text matrix baseline distinguishes scripts from font-specific
    # bounding-box metrics (math italic and text fonts have different boxes).
    baseline=lambda c:float(c.get('matrix',[0,0,0,0,0,area.height-float(c['bottom'])])[5])
    mathfont=lambda c:bool(re.search(r'(?:CMMI|CMSY|CMEX|MSBM|Math|Symbol)',str(c.get('fontname','')),re.I))
    consumed=set();out=[]
    for line in lines:
        own=[c for c in chars if line['x0']-.5<=c['x0']<=line['x1']+.5 and line['top']-.5<=c['top']<=line['bottom']+.5]
        if not own:out.append(line);continue
        size=max(float(c.get('size') or 0) for c in own)
        bases=[c for c in own if float(c.get('size') or 0)>=size*.9]
        if not bases or not any(mathfont(c) for c in bases):out.append(pdf_prose_exponents(line,size,baseline));continue
        base=statistics.median(baseline(c) for c in bases)
        script=[]
        for c in chars:
            cs=float(c.get('size') or 0);delta=baseline(c)-base
            if not (0<cs<=size*.82 and size*.1<abs(delta)<size*.85):continue
            if not(line['x0']-size<=c['x0']<=line['x1']+size):continue
            # A script must touch a math glyph, another script or its decimal
            # digits; a citation/footnote after ordinary prose stays untouched.
            # A script set flush against its base ends a float apart from it
            # (world_models.pdf: a_t, b_c were left as "t c t t c").
            preceding=[b for b in bases if -size*.1<=c['x0']-b['x1']<=size*1.8 and mathfont(b)]
            if preceding:script.append(c)
        if not script:out.append(line);continue
        selected=[c for c in own if float(c.get('size') or 0)>size*.82]+script
        groups=[]
        for c in sorted({pdf_char_key(c):c for c in selected}.values(),key=lambda c:c['x0']):
            kind=('sup' if baseline(c)>base else 'sub') if c in script else 'base'
            if groups and kind==groups[-1][0] and c['x0']-groups[-1][1][-1]['x1']<size*.45:groups[-1][1].append(c)
            else:groups.append([kind,[c]])
        value='';previous=None
        for kind,group in groups:
            text=''.join(str(c['text']) for c in group)
            if kind=='base':
                normalized=[{**c,'text':'ℝ' if c['text']=='R' and 'MSBM' in str(c.get('fontname','')) else c['text']} for c in group]
                text=pdfplumber.utils.extract_text(normalized,**PDF_WORDS)
                if previous is not None and group[0]['x0']-previous['x1']>size*.15:value+=' '
                value+=text
            else:
                value+=('^{' if kind=='sup' else '_{')+text+'}'
                consumed.update(pdf_char_key(c) for c in group)
            previous=group[-1]
        out.append({**line,'text':pdf_clean_text(value),'scriptRecovery':'glyph-baseline'})
    # pdfplumber sometimes emits the lower baseline as a separate line. Its
    # glyphs were attached above; leaving it would duplicate/misorder scripts.
    return [line for line in out if line.get('scriptRecovery') or not line.get('chars') or any(pdf_char_key(c) not in consumed for c in line['chars'] if str(c.get('text','')).strip())]
`;
