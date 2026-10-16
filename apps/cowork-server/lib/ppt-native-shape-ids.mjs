export const PPTX_IR_VERSION='pptx-ir-8';
/** Normalize only ambiguous drawing identities in a working presentation.
 * Original package bytes stay immutable. References to a duplicated identity
 * cannot be guessed, so such templates require an explicit source repair. */
export const NATIVE_SHAPE_IDS_SCRIPT=String.raw`
def normalize_native_shape_ids(prs):
    from pptx.oxml.ns import qn
    from collections import Counter
    changes=[]
    for slide_index,slide in enumerate(prs.slides):
        props=list(slide._element.iter(qn('p:cNvPr')))
        values=[int(prop.get('id')) for prop in props]
        if any(value<0 or value>4294967295 for value in values):raise ValueError('native_shape_id_invalid')
        duplicates={value for value,count in Counter(values).items() if count>1}
        if not duplicates:continue
        references=[]
        for element in slide._element.iter():
            if element.tag in (qn('a:stCxn'),qn('a:endCxn')):references.append(element.get('id'))
            references.extend(value for key,value in element.attrib.items() if key.split('}')[-1]=='spid')
        if any(str(value) in references for value in duplicates):
            raise ValueError('native_shape_id_ambiguous_reference: duplicate shape IDs are referenced by animation/connectors; repair the source template before reuse')
        used=set(values);seen=set();next_id=max(used)+1
        for position,prop in enumerate(props):
            old=int(prop.get('id'))
            if old not in seen:seen.add(old);continue
            while next_id in used:next_id+=1
            if next_id>4294967295:raise ValueError('native_shape_id_capacity')
            prop.set('id',str(next_id));used.add(next_id)
            changes.append({'slideIndex':slide_index,'position':position,'oldId':old,'newId':next_id,'name':prop.get('name','')});next_id+=1
    return {'version':1,'changes':changes}
`;
