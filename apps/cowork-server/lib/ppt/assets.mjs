import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectDataDir } from './repository.mjs';
import { validateImageDataUrl } from './command-schema.mjs';

const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

export function storeDataUrl(uid, projectId, dataUrl) {
  validateImageDataUrl(dataUrl);
  const match = typeof dataUrl === 'string' && dataUrl.match(DATA_URL);
  if (!match) throw new Error('invalid image data URL');
  const bytes = Buffer.from(match[2], 'base64');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const extension = match[1] === 'png' ? 'png' : 'jpg';
  const target = path.join(projectDataDir(uid, projectId), 'assets', `${hash}.${extension}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { mode: 0o600 });
  return { assetId: `asset_${hash.slice(0, 24)}`, hash, extension, bytes: bytes.length, path: target };
}

export function enrichAssetRefs(project, { strict = false,slideIds } = {}) {
  if (!project?.deck) return project;
  for (const slide of project.deck.slides || []) {
    if(slideIds&&!slideIds.includes(slide.id))continue;
    for (const node of slide.nodes || []) {
      if (node.type !== 'image' || !node.content?.dataUrl || node.content.assetId) continue;
      try {
        const asset = storeDataUrl(project.uid, project.id, node.content.dataUrl);
        node.content.assetId = asset.assetId;
        node.content.assetHash = asset.hash;
      } catch (error) {
        if (strict) throw error;
      }
    }
    for (const block of slide.blocks || []) {
      if (block.type !== 'image' || !block.dataUrl || block.assetId) continue;
      try {
        const asset = storeDataUrl(project.uid, project.id, block.dataUrl);
        block.assetId = asset.assetId;
        block.assetHash = asset.hash;
      } catch (error) {
        if (strict) throw error;
      }
    }
  }
  return project;
}
