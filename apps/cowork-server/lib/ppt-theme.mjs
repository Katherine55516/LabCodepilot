/** Resolve effective OOXML paint before inferring a palette from artwork. */
export const THEME_SCRIPT=String.raw`
import xml.etree.ElementTree as theme_ET
THEME_NS={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def theme_context(slide):
    master=slide.slide_layout.slide_master
    rel=next((r for r in master.part.rels.values() if r.reltype.endswith('/theme')),None)
    theme=theme_ET.fromstring(rel.target_part.blob) if rel else None
    colors={}
    if theme is not None:
        scheme=theme.find('.//a:clrScheme',THEME_NS)
        if scheme is not None:
            for item in scheme:
                if len(item):colors[item.tag.rsplit('}',1)[-1]]=item[0].get('val') if item[0].tag.endswith('}srgbClr') else item[0].get('lastClr')
    mapping=master._element.find('p:clrMap',THEME_NS)
    color_map=dict(mapping.attrib) if mapping is not None else {'bg1':'lt1','tx1':'dk1','bg2':'lt2','tx2':'dk2'}
    for part in (slide.slide_layout,slide):
        override=part._element.find('p:clrMapOvr/a:overrideClrMapping',THEME_NS)
        if override is not None:color_map.update(override.attrib)
    return theme,colors,color_map
def effective_color(element,slide,placeholder=None):
    if element is None:return None
    _,colors,mapping=theme_context(slide)
    color=next((el for el in element.iter() if el.tag.rsplit('}',1)[-1] in ('srgbClr','schemeClr','sysClr')),None)
    if color is None:return None
    kind=color.tag.rsplit('}',1)[-1];value=color.get('val')
    if kind=='schemeClr':value=placeholder if value=='phClr' else colors.get(mapping.get(value,value))
    elif kind=='sysClr':value=color.get('lastClr')
    if not value or len(value)!=6:return None
    try:rgb=[int(value[n:n+2],16)/255 for n in (0,2,4)]
    except ValueError:return None
    for modifier in color:
        name=modifier.tag.rsplit('}',1)[-1];fraction=int(modifier.get('val','100000'))/100000
        if name in ('lumMod','shade'):rgb=[v*fraction for v in rgb]
        elif name=='lumOff':rgb=[v+fraction for v in rgb]
        elif name=='tint':rgb=[v+(1-v)*fraction for v in rgb]
    return ''.join('%02X'%round(min(1,max(0,v))*255) for v in rgb)
def effective_background(slide,width,height):
    color=None;basis='default_white'
    for part in (slide.slide_layout.slide_master,slide.slide_layout,slide):
        bg=part._element.find('p:cSld/p:bg',THEME_NS)
        if bg is not None:
            candidate=effective_color(bg,slide)
            ref=bg.find('p:bgRef',THEME_NS)
            if ref is not None:
                theme,_,_=theme_context(slide)
                fills=theme.find('.//a:fmtScheme/a:bgFillStyleLst',THEME_NS) if theme is not None else None
                index=int(ref.get('idx','1001'))-1001
                if fills is not None and 0<=index<len(fills):candidate=effective_color(fills[index],slide,candidate)
            if candidate:color=candidate;basis='inherited_background'
        # Authoring tools often paint an opaque full-canvas shape over p:bg.
        # Read visible stacking order; do not use a small photo's dominant hue.
        for shape in part.shapes:
            if shape.left>width*.03 or shape.top>height*.03 or shape.width<width*.94 or shape.height<height*.94:continue
            fill=shape._element.find('.//a:solidFill',THEME_NS)
            if fill is not None:
                alpha=fill.find('.//a:alpha',THEME_NS)
                if alpha is not None and int(alpha.get('val','100000'))<95000:continue
                candidate=effective_color(fill,slide)
                if candidate:color=candidate;basis='full_canvas_paint'
    return color or 'FFFFFF',basis
`;
