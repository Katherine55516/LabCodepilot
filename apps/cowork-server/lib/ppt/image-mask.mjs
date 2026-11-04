/** Translate supported DrawingML image geometry into inert coordinates.
 * Never insert imported XML into HTML/SVG. Unsupported geometry is explicit. */
export function imageMask(xml) {
  if (!xml) return {status:'none'};
  const source=String(xml);
  if(source.length>100000 || /<!|<script|href\s*=/iu.test(source))return {status:'unsupported',reason:'unsafe_geometry'};
  const preset=source.match(/<(?:\w+:)?prstGeom\b[^>]*\bprst="([A-Za-z]+)"/u)?.[1];
  if(preset==='rect')return {status:'supported',kind:'rect'};
  if(preset==='ellipse')return {status:'supported',kind:'ellipse',css:'ellipse(50% 50% at 50% 50%)'};
  if(preset)return {status:'unsupported',reason:`preset:${preset}`};
  const paths=[...source.matchAll(/<(?:\w+:)?path\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?path>/gu)];
  if(paths.length!==1)return {status:'unsupported',reason:'multiple_or_missing_paths'};
  const [,,body]=paths[0],attrs=paths[0][1];
  const w=Number(attrs.match(/\bw="([\d.]+)"/u)?.[1]),h=Number(attrs.match(/\bh="([\d.]+)"/u)?.[1]);
  const tags=[...body.matchAll(/<\/?(?:\w+:)?([A-Za-z]+)\b/gu)].map(m=>m[1]);
  if(!(w>0&&h>0)||tags.some(t=>!['moveTo','lnTo','pt','close'].includes(t))||!/<(?:\w+:)?close\b/u.test(body))return {status:'unsupported',reason:'non_polygon_geometry'};
  const points=[...body.matchAll(/<(?:\w+:)?pt\b[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"/gu)].map(m=>[Number(m[1])/w,Number(m[2])/h]);
  if(points.length!==tags.filter(t=>t==='pt').length||points.length<3||points.length>1000||points.some(p=>p.some(n=>!Number.isFinite(n)||Math.abs(n)>10)))return {status:'unsupported',reason:'invalid_polygon_coordinates'};
  const percent=n=>Math.round(n*1e8)/1e6;
  return {status:'supported',kind:'polygon',points,css:`polygon(${points.map(([x,y])=>`${percent(x)}% ${percent(y)}%`).join(',')})`};
}
