import json,re,statistics,hashlib
from pathlib import Path
from pptx import Presentation
R=Path('/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para');O=R/'outputs/ppt-gamma-density-review-20261006'
FILES={'gamma':Path('/Users/dongli/Downloads/The-Factor-Zoo (1).pptx'),'aimate':R/'outputs/ppt-next-round/after/factor-zoo-original-template.pptx'}
def chars(x):return len(re.sub(r'\s+','',x))
def union_area(rects):
 xs=sorted(set(v for x,y,w,h in rects for v in [x,x+w]));a=0
 for l,r in zip(xs,xs[1:]):
  intervals=sorted((y,y+h) for x,y,w,h in rects if x<r and x+w>l);end=None;s=0
  for b,t in intervals:
   if end is None or b>end:s+=t-b;end=t
   elif t>end:s+=t-end;end=t
  a+=(r-l)*s
 return a
def inspect(file):
 p=Presentation(file);W,H=p.slide_width,p.slide_height;pages=[]
 for i,s in enumerate(p.slides):
  objects=[];texts=[];rects=[];fs=[];para_count=0;table_count=0
  def walk(shapes,transform=(1,1,0,0)):
   nonlocal para_count,table_count
   sx,sy,ox,oy=transform
   for sh in shapes:
    x=ox+sh.left*sx;y=oy+sh.top*sy;w=sh.width*sx;h=sh.height*sy
    if sh.shape_type==6:
     xfrm=sh._element.grpSpPr.xfrm
     if xfrm is not None and xfrm.chExt is not None:
      nsx=w/max(1,xfrm.chExt.cx);nsy=h/max(1,xfrm.chExt.cy)
      walk(sh.shapes,(nsx,nsy,x-xfrm.chOff.x*nsx,y-xfrm.chOff.y*nsy))
     else:walk(sh.shapes,transform)
     continue
    text='';rows=[];paras=[]
    if sh.has_table:
     table_count+=1;rows=[[c.text for c in row.cells] for row in sh.table.rows];text='\n'.join(' | '.join(row) for row in rows);paras=[q for row in sh.table.rows for cell in row.cells for q in cell.text_frame.paragraphs]
    elif sh.has_text_frame:text=sh.text;paras=list(sh.text_frame.paragraphs)
    if not text.strip():continue
    # Text frame allocation, not actual pixel ink. Clip off-slide rectangles.
    x1=max(0,x);y1=max(0,y);x2=min(W,x+w);y2=min(H,y+h)
    if x2>x1 and y2>y1 and not re.search('made with gamma',text,re.I):rects.append((x1,y1,x2-x1,y2-y1))
    sizes=[]
    for q in paras:
     if q.text.strip():para_count+=1
     for run in q.runs:
      f=run.font.size or q.font.size
      if f and run.text.strip():sizes.extend([round(f.pt,2)]*chars(run.text));fs.extend([round(f.pt,2)]*chars(run.text))
    objects.append({'name':sh.name,'text':text,'rows':rows,'chars':chars(text),'boundsFraction':[round(x/W,4),round(y/H,4),round(w/W,4),round(h/H,4)],'explicitFontMedian':statistics.median(sizes) if sizes else None})
    texts.append(text)
  walk(s.shapes)
  alltext='\n'.join(texts);title=next((v for v in texts if chars(v)>3 and not re.search('made with gamma',v,re.I)),f'page {i+1}')
  pages.append({'page':i+1,'titleGuess':title.split('\n')[0][:90],'visibleChars':chars(alltext),'textFrameUnionRatio':round(union_area(rects)/(W*H),4),'nonemptyParagraphs':para_count,'nativeTables':table_count,'textObjects':len(objects),'explicitFontCharWeightedMedian':statistics.median(fs) if fs else None,'explicitFontCountChars':len(fs),'objects':objects,'text':alltext})
 for q in pages:
  sep=sum(sum(max(0,len(row)-1) for row in obj['rows']) for obj in q['objects']);q['tableSerializationSeparators']=sep;q['actualTextChars']=q['visibleChars']-sep
 actual=[q['actualTextChars'] for q in pages];actualBody=actual[1:]
 values=[q['visibleChars'] for q in pages];body=values[1:]
 return {'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'pages':len(pages),'sizeInches':[round(W/914400,3),round(H/914400,3)],'all':{'totalChars':sum(values),'medianChars':statistics.median(values),'q1Chars':statistics.quantiles(values,n=4)[0],'q3Chars':statistics.quantiles(values,n=4)[2]},'excludingCover':{'totalChars':sum(body),'medianChars':statistics.median(body),'q1Chars':statistics.quantiles(body,n=4)[0],'q3Chars':statistics.quantiles(body,n=4)[2],'medianFrameUnion':statistics.median(q['textFrameUnionRatio'] for q in pages[1:])},'nativeTables':sum(q['nativeTables'] for q in pages),'actualText':{'totalChars':sum(actual),'medianAllPages':statistics.median(actual),'bodyTotalChars':sum(actualBody),'bodyMedianChars':statistics.median(actualBody),'bodyQ1Chars':statistics.quantiles(actualBody,n=4)[0],'bodyQ3Chars':statistics.quantiles(actualBody,n=4)[2],'bodyMinChars':min(actualBody),'bodyMaxChars':max(actualBody)},'slides':pages}
d={n:inspect(f) for n,f in FILES.items()};(O/'density-analysis.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
for n,x in d.items():
 print(n,x['pages'],x['sizeInches'],x['all'],x['excludingCover'],'tables',x['nativeTables'])
 for q in x['slides']:print(q['page'],q['titleGuess'],q['visibleChars'],q['textFrameUnionRatio'],q['explicitFontCharWeightedMedian'],q['nativeTables'])
