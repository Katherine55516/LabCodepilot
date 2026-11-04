/** Bounded, code-owned slide visuals. The model never supplies geometry or data. */
const color = /^#[0-9a-f]{6}$/i;
const text = (value, max, field) => {
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${field} invalid`);
  return value.trim();
};
const image = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

function sourceImageSize(dataUrl) {
  const bytes=Buffer.from(dataUrl.split(',')[1],'base64');
  if(dataUrl.startsWith('data:image/png') && bytes.length>=24) return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  for(let offset=2;offset+8<bytes.length;){
    if(bytes[offset]!==0xff){offset++;continue;}
    const marker=bytes[offset+1];
    if(marker===0xd8||marker===0xd9){offset+=2;continue;}
    if(marker===0xda)break;
    const length=bytes.readUInt16BE(offset+2);
    if(length<2||offset+2+length>bytes.length)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:bytes.readUInt16BE(offset+5),width:bytes.readUInt16BE(offset+7)};
    offset+=2+length;
  }
  return {};
}

export function normalizeBlocks(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 2) throw new Error('at most two visual blocks per slide');
  const ids = new Set();
  return input.map((block, index) => {
    if (!block || typeof block !== 'object') throw new Error(`block ${index + 1} invalid`);
    const id = text(block.id, 40, 'block id');
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) throw new Error('block id invalid');
    if (ids.has(id)) throw new Error('duplicate block id');
    ids.add(id);
    if (block.type === 'image') {
      const match = typeof block.dataUrl === 'string' && block.dataUrl.match(image);
      if (!match || match[2].length > 700000) throw new Error('image must be PNG/JPEG under 512 KB');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 512 * 1024 || (match[1] === 'png' ? !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : !bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')))) throw new Error('image signature or size invalid');
      return { id, type: 'image', dataUrl: block.dataUrl, caption: text(block.caption || '', 100, 'caption') };
    }
    if (block.type === 'chart') {
      if (!['bar', 'pie'].includes(block.chartType) || !Array.isArray(block.labels) || !Array.isArray(block.values) || block.labels.length < 2 || block.labels.length > 6 || block.values.length !== block.labels.length) throw new Error('chart data invalid');
      const values = block.values.map(value => Number(value));
      if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1e9) || values.every(value => value === 0)) throw new Error('chart values invalid');
      return { id, type: 'chart', chartType: block.chartType, labels: block.labels.map(label => text(label, 32, 'chart label')), values, unit: text(block.unit || '', 16, 'chart unit') };
    }
    if (block.type === 'table') {
      if (!Array.isArray(block.rows) || block.rows.length < 2 || block.rows.length > 6 || !Array.isArray(block.rows[0]) || block.rows[0].length < 2 || block.rows[0].length > 4 || block.rows.some(row => !Array.isArray(row) || row.length !== block.rows[0].length)) throw new Error('table dimensions invalid');
      return { id, type: 'table', rows: block.rows.map(row => row.map(cell => text(cell, 70, 'table cell'))) };
    }
    if (block.type === 'shape') {
      if (!['rect', 'ellipse'].includes(block.shape) || typeof block.fill !== 'string' || !color.test(block.fill)) throw new Error('shape invalid');
      return { id, type: 'shape', shape: block.shape, fill: block.fill.toLowerCase(), text: text(block.text || '', 100, 'shape text') };
    }
    throw new Error('unsupported visual block');
  });
}

export function normalizeSourceImages(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 64) throw new Error('source allows at most 64 images');
  const ids = new Set();
  return input.map((item, index) => {
    const block = normalizeBlocks([{ ...item, type: 'image', id: item?.id || `source-image-${index + 1}` }])[0];
    if (ids.has(block.id)) throw new Error('duplicate source image id');
    ids.add(block.id);
    return { ...block, required:item.required!==false || Boolean(item.mustPreserve), role:item.role || 'source_content',
      ...sourceImageSize(block.dataUrl),
      ...(typeof item.fileName === 'string' ? {fileName:text(item.fileName,200,'image file name')} : {}),
      ...(item.sourceRef ? {sourceRef:String(item.sourceRef)} : {}),
      ...(Array.isArray(item.sourceRefs) ? {sourceRefs:item.sourceRefs.map(String)} : {}),
      ...(Number.isFinite(item.width) && Number.isFinite(item.height) ? {width:item.width,height:item.height} : {}) };
  });
}
