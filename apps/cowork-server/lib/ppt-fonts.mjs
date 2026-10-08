/** The Office runtime ships fontconfig. Check real glyph coverage, not names. */
export const OFFICE_FONT_ENV_SCRIPT=String.raw`
def office_font_environment(profile):
    import os, xml.etree.ElementTree as font_ET
    os.makedirs(profile,exist_ok=True)
    config=font_ET.Element('fontconfig')
    original=os.environ.get('FONTCONFIG_FILE') or '/etc/fonts/fonts.conf'
    if os.path.isfile(original):font_ET.SubElement(config,'include',{'ignore_missing':'yes'}).text=original
    for folder in ['/usr/share/fonts','/usr/local/share/fonts','/Library/Fonts','/System/Library/Fonts/Supplemental',os.path.expanduser('~/Library/Fonts'),os.path.expanduser('~/.local/share/fonts'),os.path.expanduser('~/.fonts')]:
        if os.path.isdir(folder):font_ET.SubElement(config,'dir').text=folder
    font_ET.SubElement(config,'cachedir').text=os.path.join(profile,'font-cache')
    target=os.path.join(profile,'fonts.conf');font_ET.ElementTree(config).write(target,encoding='utf-8',xml_declaration=True)
    return {**os.environ,'FONTCONFIG_FILE':target,'FONTCONFIG_PATH':profile}
`;
export const FONT_SCRIPT=String.raw`
import subprocess as font_subprocess, functools as font_functools, unicodedata as font_unicode
FONT_RESOLUTIONS={}
@font_functools.lru_cache(maxsize=256)
def installed_font(requested):
    result=font_subprocess.run(['fc-match','-f','%{family}|%{file}|%{charset}',requested],capture_output=True,text=True,timeout=10,check=True)
    family,path,charset=result.stdout.split('|',2)
    ranges=[]
    for entry in charset.split():
        pair=entry.split('-');ranges.append((int(pair[0],16),int(pair[-1],16)))
    return family.split(',')[0].strip(),path,ranges
def resolve_font(requested,text):
    needed={ord(c) for c in str(text) if not c.isspace() and font_unicode.category(c) not in ('Cf','Cc')}
    if not needed:return requested
    math_fonts=['STIX Two Math','STIXGeneral','Latin Modern Math','Cambria Math']
    candidates=(math_fonts+[requested] if requested=='Cambria Math' else [requested])+['Noto Sans CJK SC','Noto Sans CJK TC','Arial Unicode MS','PingFang SC','Hiragino Sans','DejaVu Sans','DejaVu Serif','Noto Sans Symbols2','Apple Symbols','Symbola','FreeSerif']+math_fonts
    for candidate in dict.fromkeys(candidates):
        family,path,ranges=installed_font(candidate)
        # fc-match returns an unrelated default when the requested family is
        # absent. Its CoreText alias can have glyphs yet render blank in LO.
        normalize=lambda value:''.join(c for c in value.casefold() if c.isalnum())
        if not normalize(family).startswith(normalize(candidate)):continue
        if all(any(lo<=point<=hi for lo,hi in ranges) for point in needed):
            FONT_RESOLUTIONS[(requested,family)]={'requested':requested,'resolved':family,'file':path,'glyphCoverage':'verified'}
            return family
    raise ValueError('font_glyph_coverage: no installed font covers '+','.join('U+%04X'%p for p in sorted(needed))+' for '+requested)
`;
