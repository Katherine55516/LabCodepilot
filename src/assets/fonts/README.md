# Bundled application UI fonts

Geist, Geist Mono and JetBrains Mono are loaded with `next/font/local` so the desktop UI and local PPT test endpoint do not require Google Fonts during startup or build. Font family variables stay unchanged. These are application UI fonts; native PowerPoint template fonts remain independently imported and verified.

`manifest.json` records exact official source commits, bytes and SHA256. The corresponding SIL Open Font Licenses are preserved in this directory. Source repositories:

- https://github.com/vercel/geist-font
- https://github.com/JetBrains/JetBrainsMono
