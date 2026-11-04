/** Render a completed PPT project's shared Render Tree to inspectable PNGs.
 * This is a local artifact companion for viewers that misrender native PPTX media.
 * Usage: node scripts/ppt-render-companion-previews.mjs PROJECT.json OUTPUT_DIR
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { buildRenderTree } from '../apps/cowork-server/lib/ppt/render-tree.mjs';
import { slideSvg } from '../apps/cowork-server/lib/ppt/exporters/preview.mjs';

const [projectPath, outputDir] = process.argv.slice(2);
if (!projectPath || !outputDir) {
  console.error('Usage: node scripts/ppt-render-companion-previews.mjs PROJECT.json OUTPUT_DIR');
  process.exit(2);
}

const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
const tree = buildRenderTree(project);
if (!tree.slides.length) throw new Error('project has no slides');
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const files = [];
  for (const [index, slide] of tree.slides.entries()) {
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#fff}svg{display:block;width:100%;height:100%}</style>${slideSvg(slide)}`, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll('svg image')].map(element => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve; image.onerror = () => reject(new Error('preview media failed to load'));
        image.src = element.getAttribute('href') || '';
      })));
    });
    const filename = `slide-${String(index + 1).padStart(2, '0')}.png`;
    await page.locator('svg').screenshot({ path: path.join(outputDir, filename) });
    files.push(filename);
  }
  await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify({ projectId: project.id, revision: project.revision,
    renderTreeHash: tree.hash, files }, null, 2));
  console.log(`${files.length} companion previews: ${outputDir}`);
} finally {
  await browser.close();
}
