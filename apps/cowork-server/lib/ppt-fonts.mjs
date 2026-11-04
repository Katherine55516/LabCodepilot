/** Embedded fonts in a template package (Fable 2026-10-26). A font compressed
 * with MicroType Express (EOT flag 0x4; every font of a Google Slides export,
 * live GPH-GU2353) is the template author's asset: it stays in the exported
 * .pptx untouched and is never decoded here. Preview, PDF and measurement use
 * the installed family, else the closest installed substitute no more than
 * 2.5% narrower in regular and bold (advance widths measured against the real
 * fonts on an English sample, 2026-10-26; a narrower face would under-measure
 * wrapping): Montserrat -> Verdana (+3.4% / +9.0%), Roboto -> Arial (+0.6% /
 * +5.4%), Open Sans -> Avenir Next (-2.1% / -1.9%), Lato -> Trebuchet MS
 * (+1.9% / +5.9%), Inter -> Verdana (+7.8% / +15.6%), Nunito -> Trebuchet MS
 * (-0.3% / +1.1%). Other families take fontconfig's default. */
export const EMBEDDED_FONT_SCRIPT=String.raw`
# Families the package carries compressed: the deck keeps their name (below).
EMBEDDED_FAMILIES=set()
FONT_SUBSTITUTES=[('Montserrat',['Verdana','DejaVu Sans','Arial']),('Roboto',['Arial','Helvetica','Liberation Sans']),('Open Sans',['Avenir Next','Helvetica Neue','Arial']),('Lato',['Trebuchet MS','Arial','Liberation Sans']),('Inter',['Verdana','DejaVu Sans','Arial']),('Nunito',['Trebuchet MS','Helvetica Neue','Arial'])]
def eot_family(eot):
    import struct
    try:
        size=struct.unpack_from('<H',eot,82)[0]
        return eot[84:84+size].decode('utf-16-le').strip('\x00').strip() if 0<size<=256 else ''
    except Exception:return ''
def font_substitutes(family):
    folded=''.join(c for c in family.casefold() if c.isalnum())
    for name,chain in FONT_SUBSTITUTES:
        if folded.startswith(''.join(c for c in name.casefold() if c.isalnum())):return chain
    return []
def font_installed(family):
    import subprocess
    try:return bool(subprocess.run(['fc-list',family,'family'],capture_output=True,text=True,timeout=10).stdout.strip())
    except Exception:return False
def declared_typefaces(archive):
    # The typeface each embedded font part is declared for in presentation.xml
    # ("Montserrat ExtraBold"), the name runs use; the EOT's own family name
    # can differ ("Montserrat").
    import re, posixpath
    try:
        xml=archive.read('ppt/presentation.xml').decode('utf-8','replace');rels=archive.read('ppt/_rels/presentation.xml.rels').decode('utf-8','replace')
    except KeyError:return {}
    targets={}
    for rel in re.findall(r'<Relationship\b[^>]*>',rels):
        rid=re.search(r'\bId="([^"]+)"',rel);target=re.search(r'\bTarget="([^"]+)"',rel)
        if rid and target:targets[rid.group(1)]=posixpath.normpath(posixpath.join('ppt',target.group(1)))
    found={}
    for block in re.findall(r'<p:embeddedFont>.*?</p:embeddedFont>',xml,flags=re.S):
        face=re.search(r'typeface="([^"]+)"',block)
        if face:
            for rid in re.findall(r'r:id="([^"]+)"',block):
                if rid in targets:found[targets[rid]]=face.group(1)
    return found
def compressed_embedded_fonts(package):
    import zipfile, io, struct
    archive=zipfile.ZipFile(io.BytesIO(package) if isinstance(package,bytes) else package)
    found={}
    try:
        declared=declared_typefaces(archive)
        for entry in archive.infolist():
            if not entry.filename.startswith('ppt/fonts/') or not entry.filename.endswith(('.fntdata','.fnt')) or entry.file_size>20*1024*1024:continue
            eot=archive.read(entry)
            if len(eot)<84 or not struct.unpack_from('<I',eot,12)[0]&4:continue
            family=declared.get(entry.filename) or eot_family(eot) or entry.filename.rsplit('/',1)[-1].split('-')[0]
            if family in found:continue
            used=family if font_installed(family) else next((name for name in font_substitutes(family) if font_installed(name)),'default')
            found[family]={'family':family,'usedFamily':used}
    finally:archive.close()
    return list(found.values())
`;
/** The Office runtime ships fontconfig. Check real glyph coverage, not names. */
export const OFFICE_FONT_ENV_SCRIPT=EMBEDDED_FONT_SCRIPT+String.raw`
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
        total=0;count=0;compressed=set();declared=declared_typefaces(archive)
        for entry in archive.infolist():
            if not entry.filename.startswith('ppt/fonts/') or not entry.filename.endswith(('.fntdata','.fnt')):continue
            total+=entry.file_size;count+=1
            if count>32 or total>64*1024*1024 or entry.file_size>20*1024*1024 or entry.flag_bits&1:raise ValueError('native_font_package_limit')
            eot=archive.read(entry)
            # A compressed font stays in the package; it is listed, never decoded.
            if len(eot)>=16 and struct.unpack_from('<I',eot,12)[0]&4:
                compressed.add(declared.get(entry.filename) or eot_family(eot));continue
            if len(eot)<82 or struct.unpack_from('<I',eot)[0]!=len(eot):raise ValueError('native_font_unsupported_eot')
            length=struct.unpack_from('<I',eot,4)[0]
            if length<12 or length>len(eot)-82:raise ValueError('native_font_invalid_size')
            raw=eot[-length:]
            if raw[:4] not in (b'\x00\x01\x00\x00',b'OTTO',b'true'):raise ValueError('native_font_invalid_sfnt')
            target=os.path.join(font_dir,hashlib.sha256(raw).hexdigest()+'.ttf')
            if not os.path.exists(target):
                with open(target,'wb') as font_file:font_file.write(raw)
        archive.close()
        font_ET.SubElement(config,'dir').text=font_dir
    # A missing family falls to its measured substitute, not to the default.
    if package:EMBEDDED_FAMILIES.update(family for family in compressed if family)
    # Each compressed family by its own name ("Montserrat Medium", "Roboto Thin").
    families=[(name,chain) for name,chain in FONT_SUBSTITUTES]+[(family,font_substitutes(family)) for family in sorted(compressed if package else []) if family and font_substitutes(family)]
    for name,chain in families:
        alias=font_ET.SubElement(config,'alias',{'binding':'same'});font_ET.SubElement(alias,'family').text=name
        accept=font_ET.SubElement(alias,'accept')
        for fallback in chain:font_ET.SubElement(accept,'family').text=fallback
    font_ET.SubElement(config,'cachedir').text=os.path.join(profile,'font-cache')
    target=os.path.join(profile,'fonts.conf');font_ET.ElementTree(config).write(target,encoding='utf-8',xml_declaration=True)
    return {**os.environ,'FONTCONFIG_FILE':target,'FONTCONFIG_PATH':profile}
`;
/** LibreOffice (soffice) for every PPTX/PDF conversion and the export check:
 * Docker images put it on PATH, a macOS runtime may have it only inside the
 * app bundle. A missing binary is an environment gap and says so (3143,
 * 367a72d8: the export check ran bare 'soffice' and a raw traceback reached
 * the user). */
export const OFFICE_BINARY_SCRIPT=String.raw`
class RuntimeDependencyMissing(ValueError):pass

def office_binary(missing='office_unavailable: LibreOffice (soffice) is not installed in this runtime'):
    import os, shutil
    # An explicit PPT_SOFFICE is the only engine considered (a host can name, or
    # rule out, its engine); otherwise PATH, then the macOS app bundle.
    explicit=os.environ.get('PPT_SOFFICE','')
    for candidate in ((explicit,) if explicit else (shutil.which('soffice') or '',shutil.which('libreoffice') or '','/Applications/LibreOffice.app/Contents/MacOS/soffice')):
        if candidate and os.path.isfile(candidate) and os.access(candidate,os.X_OK):return candidate
    raise RuntimeDependencyMissing(missing)
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
    # A family the deck embeds (compressed, so not installed here) keeps its
    # name for Latin text: PowerPoint shows the embedded font, and our preview
    # measures its substitute through the fontconfig alias (Fable 2026-10-26;
    # live alpha-gph3 wrote "Arial Unicode MS" into Montserrat titles).
    if requested in EMBEDDED_FAMILIES and all(point<=0x24f or 0x2000<=point<=0x206f or 0x20a0<=point<=0x20cf for point in needed):return requested
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
