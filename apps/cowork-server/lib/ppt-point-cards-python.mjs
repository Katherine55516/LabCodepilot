/** One native card/connector implementation for rebuilt and preserved PPTX. */
export const POINT_CARDS_SCRIPT = String.raw`
def render_point_cards(slide, element_id, items, point_layout, x, y, w, h, size, color, accent, body_font, paragraph_style, resolve_color, source_name=''):
    from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
    before={shape.shape_id for shape in slide.shapes}
    point_size = float(point_layout.get('fontSizePt') or size)
    # An uploaded template's dark panel (Fable M1): every card is filled with it
    # and its text, headings included, takes the panel's light colour.
    panel_text = point_layout.get('panelText')
    if panel_text: color = resolve_color(panel_text, color)
    line_height = float(point_layout.get('lineHeight') or 1.18)
    for number, item in enumerate(items):
        if number >= len(point_layout['boxes']): break
        bounds = point_layout['boxes'][number]
        px = x + int(w * bounds['x']); py = y + int(h * bounds['y'])
        pw = int(w * bounds['w']); ph = int(h * bounds['h'])
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, px, py, pw, ph)
        card.name=(source_name+'|' if source_name else '')+'AIMate instance:'+str(element_id)+':'+str(number)
        # No inherited theme effects or centered paragraph defaults:
        # the same top alignment and fixed radius as the React/SVG cards.
        theme_style=card._element.find(qn('p:style'))
        if theme_style is not None: card._element.remove(theme_style)
        card._element.spPr.append(OxmlElement('a:effectLst'))
        card.adjustments[0]=min(.5,Pt(4.5)/max(1,min(pw,ph)))
        card.fill.background(); card.line.color.rgb = color
        card.line.width=Pt(.75)
        rgb_node=card._element.spPr.find(qn('a:ln')).find(qn('a:solidFill')).find(qn('a:srgbClr'))
        alpha=OxmlElement('a:alpha');alpha.set('val','20000');rgb_node.append(alpha)
        # Native diagram variants share the card geometry: tinted bands
        # for architecture layers, tinted cards for grids/KPI tiles.
        variant=point_layout.get('variant') or ''
        diagram_accent=resolve_color(point_layout.get('accent'),RGBColor(*accent))
        if variant in ('layer-stack','card-grid','kpi'):
            card.fill.solid(); card.fill.fore_color.rgb=diagram_accent
            tint=(16000+min(number,6)*5000) if variant=='layer-stack' else 9000
            fill_rgb=card._element.spPr.find(qn('a:solidFill')).find(qn('a:srgbClr'))
            fill_alpha=OxmlElement('a:alpha');fill_alpha.set('val',str(tint));fill_rgb.append(fill_alpha)
            card.line.color.rgb=diagram_accent
            # The template's own card panel fill, when it has one (Fable plan T13).
        # A solid panel replaces the tint, its transparency included: assigning
        # the colour keeps the srgbClr element and its a:alpha, so a dark panel
        # stayed at 9% (Mood-Board score tiles read light on light).
        if point_layout.get('panelFill') and (panel_text or variant in ('card-grid','kpi')):
            panel=resolve_color(point_layout.get('panelFill'),diagram_accent);card.fill.solid();card.fill.fore_color.rgb=panel;card.line.color.rgb=panel
            for clr in card._element.spPr.find(qn('a:solidFill')).iter(qn('a:srgbClr')):
                for alpha in list(clr.findall(qn('a:alpha'))): clr.remove(alpha)
        frame = card.text_frame; frame.clear(); frame.word_wrap = True
        frame.auto_size=MSO_AUTO_SIZE.NONE;frame.vertical_anchor=MSO_ANCHOR.TOP
        frame.margin_left = Pt(7.92); frame.margin_right = Pt(7.92)
        frame.margin_top = Pt(5.04); frame.margin_bottom = Pt(2.88)
        # A marker before the heading (Fable M2): a circle in the card's left
        # margin; the text starts beside it, as measured.
        markers=point_layout.get('markers') or []
        marker=str(markers[number]) if number<len(markers) else ''
        if marker:
            marker_emu=int(float(point_layout.get('markerInches') or .34)*914400);frame.margin_left=Pt(7.92)+marker_emu
            size_m=int(.26*914400);circle=slide.shapes.add_shape(MSO_SHAPE.OVAL,px+int(Pt(7.92)),py+int(Pt(5.04)),size_m,size_m)
            circle.name='AIMate decor:marker:'+str(element_id)+':'+str(number)
            style_m=circle._element.find(qn('p:style'))
            if style_m is not None: circle._element.remove(style_m)
            on_dark=bool(panel_text);fill_m=color if on_dark else resolve_color(point_layout.get('markerFill') or point_layout.get('accent'),RGBColor(*accent));ink_m=resolve_color(point_layout.get('panelFill'),RGBColor(0,0,0)) if on_dark else resolve_color(point_layout.get('markerText'),RGBColor(255,255,255))
            circle.fill.solid();circle.fill.fore_color.rgb=fill_m;circle.line.fill.background()
            mark=circle.text_frame;mark.margin_left=mark.margin_right=mark.margin_top=mark.margin_bottom=0;mark.word_wrap=False;mark.vertical_anchor=MSO_ANCHOR.MIDDLE
            mark.paragraphs[0].alignment=PP_ALIGN.CENTER;run=mark.paragraphs[0].add_run();run.text=marker;run.font.size=Pt(min(11,point_size*.7) if len(marker)<2 else min(9,point_size*.55));run.font.bold=True;run.font.color.rgb=ink_m
        raw = str(item.get('text') or '')
        parts = raw.split('\n', 1)
        structured = bool(item.get('heading') or item.get('body'))
        heading = str(item.get('heading') or '') if structured else (parts[0] if len(parts) > 1 else '')
        body = str(item.get('body') or '') if structured else (parts[1] if len(parts) > 1 else raw)
        if heading and point_layout.get('inlineHeading'):
            # Layer bands: bold layer name inline before its first line.
            body_lines = str(body).split('\n')
            first = frame.paragraphs[0]; first.line_spacing = line_height; first.space_after = Pt(0)
            lead = first.add_run(); lead.text = heading + '\u3000'
            rest = first.add_run(); rest.text = body_lines[0]
            paragraph_style(first, point_size, color)
            # cjk_font splits runs by script; re-bold every run of the
            # layer name and its separator (the first len(lead) chars).
            remaining = len(heading) + 1
            for run in first.runs:
                if remaining <= 0: break
                run.font.bold = True; remaining -= len(run.text)
            for line in body_lines[1:]:
                extra = frame.add_paragraph(); extra.text = line; extra.line_spacing = line_height; extra.space_after = Pt(0); paragraph_style(extra, point_size, color)
            for paragraph in frame.paragraphs: paragraph.alignment=PP_ALIGN.LEFT;paragraph.space_before=Pt(0);paragraph._p.get_or_add_pPr().set('hangingPunct','0')
            continue
        if heading:
            heading_para = frame.paragraphs[0]; heading_para.text = heading
            heading_para.space_after = Pt(3); heading_para.line_spacing = line_height
            heading_size = float(point_layout.get('headingFontSizePt') or point_size)
            heading_color = diagram_accent if variant in ('card-grid','kpi') and not panel_text else color
            if item.get('headingRich'):write_rich_text(heading_para,item['headingRich'],heading_size,str(heading_color),body_font,True)
            else:paragraph_style(heading_para, heading_size, heading_color, True, 'body')
            if not body:
                heading_para.alignment=PP_ALIGN.LEFT;heading_para.space_before=Pt(0)
                heading_para._p.get_or_add_pPr().set('hangingPunct','0')
                continue
            body_para = frame.add_paragraph()
        else: body_para = frame.paragraphs[0]
        for paragraph in frame.paragraphs: paragraph.alignment=PP_ALIGN.LEFT;paragraph.space_before=Pt(0)
        body_para.text = body; body_para.line_spacing = line_height
        body_para.space_after = Pt(0)
        for paragraph in frame.paragraphs:paragraph._p.get_or_add_pPr().set('hangingPunct','0')
        if item.get('bodyRich'):write_rich_text(body_para,item['bodyRich'],point_size,str(color),body_font)
        else:paragraph_style(body_para, point_size, color)
    # Flow connectors between consecutive cards (decor: not a content
    # instance, so export verification keeps counting the cards only).
    boxes=point_layout['boxes']
    for link_index,link in enumerate(point_layout.get('connectors') or []):
        a=boxes[link['from']] if link.get('from') is not None and link['from']<len(boxes) else None
        b=boxes[link['to']] if link.get('to') is not None and link['to']<len(boxes) else None
        if not a or not b: continue
        ax,ay,aw,ah=x+int(w*a['x']),y+int(h*a['y']),int(w*a['w']),int(h*a['h'])
        bx,by,bw,bh=x+int(w*b['x']),y+int(h*b['y']),int(w*b['w']),int(h*b['h'])
        if abs(ay-by)<Pt(2) and bx>ax: x1,y1,x2,y2=ax+aw,ay+ah//2,bx,by+bh//2
        else: x1,y1,x2,y2=ax+aw//2,ay+ah,bx+bw//2,by
        route=link.get('points') or [{'x':(x1-x)/w,'y':(y1-y)/h},{'x':(x2-x)/w,'y':(y2-y)/h}]
        segments=[(p,q) for p,q in zip(route,route[1:]) if p!=q]
        for segment_index,(p,q) in enumerate(segments):
            line=slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,x+int(w*p['x']),y+int(h*p['y']),x+int(w*q['x']),y+int(h*q['y']))
            line.name='AIMate decor:flow:'+str(element_id)+':'+str(link.get('sourceEdgeId') or 'order_'+str(link_index))+':'+str(segment_index)
            line.line.color.rgb=resolve_color(point_layout.get('accent'),RGBColor(*accent)); line.line.width=Pt(1.25)
            if segment_index==len(segments)-1:
                tail=OxmlElement('a:tailEnd'); tail.set('type','triangle'); line.line._get_or_add_ln().append(tail)
    # A rail beside stacked steps (Fable M2): one line through a dot at each
    # card's middle, in the accent (decor, like the connectors).
    rail=point_layout.get('rail')
    if rail and boxes:
        rail_x=x+int(w*float(rail.get('x') or 0)); rail_color=resolve_color(point_layout.get('accent'),RGBColor(*accent))
        mids=[y+int(h*(b['y']+b['h']/2)) for b in boxes]; dot=Pt(9)
        if len(mids)>1:
            line=slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,rail_x,mids[0],rail_x,mids[-1])
            line.name='AIMate decor:rail:'+str(element_id); line.line.color.rgb=rail_color; line.line.width=Pt(1.5)
        for k,mid in enumerate(mids):
            mark=slide.shapes.add_shape(MSO_SHAPE.OVAL,rail_x-dot//2,mid-dot//2,dot,dot)
            mark.name='AIMate decor:rail-dot:'+str(element_id)+':'+str(k)
            style=mark._element.find(qn('p:style'))
            if style is not None: mark._element.remove(style)
            mark.fill.solid(); mark.fill.fore_color.rgb=rail_color; mark.line.color.rgb=rail_color

    return [int(shape.shape_id) for shape in slide.shapes if shape.shape_id not in before]
`;
