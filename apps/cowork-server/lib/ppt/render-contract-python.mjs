/** Shared by generic and native added/changed frames. Does not reconstruct
 * untouched native pictures, masks, theme relationships or paragraph runs. */
export const RENDER_CONTRACT_SCRIPT = String.raw`
def apply_text_contract(frame, contract):
    frame.vertical_anchor=MSO_ANCHOR.TOP
    frame.word_wrap=bool(contract.get('wrap',True))
    frame.auto_size=MSO_AUTO_SIZE.NONE
    margins=contract.get('margins',[3.6,3.6,3.6,3.6])
    frame.margin_left,frame.margin_top,frame.margin_right,frame.margin_bottom=[Pt(float(v)) for v in margins]
    for index,paragraph in enumerate(frame.paragraphs):
        specs=contract.get('paragraphs') or []
        spec=specs[min(index,len(specs)-1)] if specs else {}
        paragraph.space_before=Pt(0)
        paragraph.line_spacing=float(spec.get('lineHeight',1.18))
        paragraph.space_after=Pt(float(spec.get('spaceAfterPt',0)))

def contract_picture(slide, blob, x, y, w, h, contract):
    crop=contract.get('crop',[0,0,0,0]);fit=contract.get('fit','contain')
    if not contract.get('valid',True):raise ValueError('invalid image crop contract')
    from PIL import Image as ContractImage
    image=ContractImage.open(io.BytesIO(blob));image.load();iw,ih=image.size
    if fit=='contain':
        ratio=min(w/iw,h/ih);dw,dh=int(iw*ratio),int(ih*ratio)
        return slide.shapes.add_picture(io.BytesIO(blob),int(x+(w-dw)/2),int(y+(h-dh)/2),dw,dh)
    picture=slide.shapes.add_picture(io.BytesIO(blob),int(x),int(y),int(w),int(h))
    if fit=='cover':
        if iw/ih>w/h:
            amount=(1-(w/h)/(iw/ih))/2;crop=[amount,0,amount,0]
        else:
            amount=(1-(iw/ih)/(w/h))/2;crop=[0,amount,0,amount]
    picture.crop_left,picture.crop_top,picture.crop_right,picture.crop_bottom=map(float,crop)
    return picture
`;

/** Hash every native chart property except the axes explicitly normalized by
 * our rendering contract. Series, styles, workbook links remain source-owned. */
export const NATIVE_CHART_CONTRACT_SCRIPT=String.raw`
def native_chart_structure_hash(chart):
    import copy,hashlib
    from lxml import etree
    root=copy.deepcopy(chart._chartSpace)
    ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
    paths=['.//c:ser/c:invertIfNegative','.//c:valAx/c:scaling/c:min','.//c:valAx/c:scaling/c:max','.//c:valAx/c:crosses','.//c:valAx/c:crossesAt','.//c:catAx/c:crosses','.//c:catAx/c:crossesAt']
    for path in paths:
        for element in root.findall(path,ns):element.getparent().remove(element)
    return hashlib.sha256(etree.tostring(root,method='c14n')).hexdigest()
`;
