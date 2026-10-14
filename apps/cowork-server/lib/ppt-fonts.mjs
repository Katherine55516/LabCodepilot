/** The Office runtime ships fontconfig. Check real glyph coverage, not names. */
export const OFFICE_FONT_ENV_SCRIPT=String.raw`
def office_font_environment(profile, package=None):
    import os, xml.etree.ElementTree as font_ET
    os.makedirs(profile,exist_ok=True)
    config=font_ET.Element('fontconfig')
    original=os.environ.get('FONTCONFIG_FILE') or '/etc/fonts/fonts.conf'
    if os.path.isfile(original):font_ET.SubElement(config,'include',{'ignore_missing':'yes'}).text=original
    for folder in ['/usr/share/fonts','/usr/local/share/fonts','/Library/Fonts','/System/Library/Fonts/Supplemental',os.path.expanduser('~/Library/Fonts'),os.path.expanduser('~/.local/share/fonts'),os.path.expanduser('~/.fonts')]:
        if os.path.isdir(folder):font_ET.SubElement(config,'dir').text=folder
    if package:
        import zipfile, io, struct, hashlib
        font_dir=os.path.join(profile,'embedded-fonts');os.makedirs(font_dir,exist_ok=True)
        archive=zipfile.ZipFile(io.BytesIO(package) if isinstance(package,bytes) else package)
        total=0;count=0
        for entry in archive.infolist():
            if not entry.filename.startswith('ppt/fonts/') or not entry.filename.endswith(('.fntdata','.fnt')):continue
            total+=entry.file_size;count+=1
            if count>32 or total>64*1024*1024 or entry.file_size>20*1024*1024 or entry.flag_bits&1:raise ValueError('native_font_package_limit')
            eot=archive.read(entry)
            if len(eot)<82 or struct.unpack_from('<I',eot)[0]!=len(eot) or struct.unpack_from('<I',eot,12)[0]&4:raise ValueError('native_font_unsupported_eot')
            length=struct.unpack_from('<I',eot,4)[0]
            if length<12 or length>len(eot)-82:raise ValueError('native_font_invalid_size')
            raw=eot[-length:]
            if raw[:4] not in (b'\x00\x01\x00\x00',b'OTTO',b'true'):raise ValueError('native_font_invalid_sfnt')
            target=os.path.join(font_dir,hashlib.sha256(raw).hexdigest()+'.ttf')
            if not os.path.exists(target):
                with open(target,'wb') as font_file:font_file.write(raw)
        archive.close()
        font_ET.SubElement(config,'dir').text=font_dir
    font_ET.SubElement(config,'cachedir').text=os.path.join(profile,'font-cache')
    target=os.path.join(profile,'fonts.conf');font_ET.ElementTree(config).write(target,encoding='utf-8',xml_declaration=True)
    return {**os.environ,'FONTCONFIG_FILE':target,'FONTCONFIG_PATH':profile}
`;
export const FONT_SCRIPT=OFFICE_FONT_ENV_SCRIPT+String.raw`
import subprocess as font_subprocess, functools as font_functools, unicodedata as font_unicode
FONT_RESOLUTIONS={}
FONT_ALIASES={}
@font_functools.lru_cache(maxsize=256)
def installed_font(requested):
    import re as font_re
    named_style=font_re.match(r'^(.*) (Bold|Italic|Regular|Light|SemiBold|Medium)$',requested,flags=font_re.I)
    query=(named_style.group(1)+':style='+named_style.group(2)) if named_style else requested
    result=font_subprocess.run(['fc-match','-f','%{family}|%{style}|%{fullname}|%{file}|%{charset}',query],capture_output=True,text=True,timeout=10,check=True)
    family,style,fullname,path,charset=result.stdout.split('|',4)
    FONT_ALIASES[requested]=[fullname,family.split(',')[0].strip()+' '+style.split(',')[0].strip()]
    ranges=[]
    for entry in charset.split():
        pair=entry.split('-');ranges.append((int(pair[0],16),int(pair[-1],16)))
    return family.split(',')[0].strip(),path,ranges
def resolve_font(requested,text):
    needed={ord(c) for c in str(text) if not c.isspace() and font_unicode.category(c) not in ('Cf','Cc')}
    if not needed:return requested
    math_fonts=['STIX Two Math','STIXGeneral','Latin Modern Math','Cambria Math']
    mono_fonts=['Noto Sans Mono CJK SC','Noto Sans Mono CJK TC','DejaVu Sans Mono','Liberation Mono','Courier New','Menlo'] if requested in ('Consolas','Menlo','monospace') else []
    candidates=(math_fonts+[requested] if requested=='Cambria Math' else [requested])+mono_fonts+['Noto Sans CJK SC','Noto Sans CJK TC','Arial Unicode MS','PingFang SC','Hiragino Sans','DejaVu Sans','DejaVu Serif','Noto Sans Symbols2','Apple Symbols','Symbola','FreeSerif']+math_fonts
    for candidate in dict.fromkeys(candidates):
        family,path,ranges=installed_font(candidate)
        # fc-match returns an unrelated default when the requested family is
        # absent. Its CoreText alias can have glyphs yet render blank in LO.
        normalize=lambda value:''.join(c for c in value.casefold() if c.isalnum())
        if not normalize(family).startswith(normalize(candidate)) and normalize(candidate) not in [normalize(alias) for alias in FONT_ALIASES.get(candidate,[])]:continue
        if normalize(family) not in ('lastresort','adobeblank') and all(any(lo<=point<=hi for lo,hi in ranges) for point in needed):
            FONT_RESOLUTIONS[(requested,family)]={'requested':requested,'resolved':family,'file':path,'glyphCoverage':'verified'}
            # Preserve the Office typeface (including a named Bold/SemiBold
            # face) when it is installed. Resolving its base family silently
            # changes the template's weight and saved font declaration.
            return requested if candidate == requested else family
    # Query installed families by the actual charset after named candidates.
    # Generic fc-match aliases never count as coverage without verifying every glyph.
    family,path,ranges=installed_font(':charset='+' '.join('%x'%point for point in sorted(needed)))
    family,path,ranges=installed_font(family)
    if ''.join(c for c in family.casefold() if c.isalnum()) not in ('lastresort','adobeblank') and all(any(lo<=point<=hi for lo,hi in ranges) for point in needed):
        FONT_RESOLUTIONS[(requested,family)]={'requested':requested,'resolved':family,'file':path,'glyphCoverage':'verified'}
        return family
    raise ValueError('font_glyph_coverage: no installed font covers '+','.join('U+%04X'%p for p in sorted(needed))+' for '+requested)
def font_runs(run,requested,east_asia=None):
    # Resolve grapheme clusters before considering a whole-run fallback. A Han
    # character must never replace a supported template Latin font for the
    # entire bilingual paragraph. Combining marks/ZWJ stay with their base.
    import copy
    from pptx.text.text import _Run
    clusters=[]
    for char in run.text:
        if clusters and (font_unicode.category(char) in ('Mn','Me','Cf') or clusters[-1].endswith('\u200d')):clusters[-1]+=char
        else:clusters.append(char)
    pieces=[]
    for cluster in clusters:
        family=resolve_font(east_asia if east_asia and any('\u2e80'<=c<='\u9fff' or '\uf900'<=c<='\ufaff' for c in cluster) else requested,cluster)
        if pieces and pieces[-1][1]==family:pieces[-1]=(pieces[-1][0]+cluster,family)
        else:pieces.append((cluster,family))
    original=copy.deepcopy(run._r);previous=run._r;out=[]
    for index,(text,family) in enumerate(pieces):
        if index==0:part=run
        else:
            element=copy.deepcopy(original);previous.addnext(element);previous=element;part=_Run(element,run._parent)
        part.text=text;out.append((part,family))
    return out
`;
