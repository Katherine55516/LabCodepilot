const color=value=>/^#[a-f0-9]{6}$/iu.test(String(value||''))?value:'none';
/** Same preset geometry for React and SVG. Original OOXML stays editable in
 * PPTX; an unsupported preset is explicit, never silently a rectangle. */
export function nativeShapeContract(element){
 const preset=element.content?.presetGeometry||({OVAL:'ellipse',SMILEY_FACE:'smileyFace',ROUNDED_RECTANGLE:'roundRect',RECTANGLE:'rect',DONUT:'donut',ISOSCELES_TRIANGLE:'triangle'}[String(element.nativeRef?.autoShapeType||'').split(' ')[0]])||element.content?.shape||'rect';
 const fill=color(element.style?.fill),stroke=color(element.style?.lineColor),edge=`fill="${fill}" stroke="${stroke}" stroke-width="1"`;
 let body;
 if(preset==='ellipse')body=`<ellipse cx="50" cy="50" rx="50" ry="50" ${edge}/>`;
 else if(preset==='rect'||preset==='roundRect'){
  // OOXML: the corner radius is adj/100000 of the shorter side (default 16667).
  // The viewBox is stretched to the shape, so the radius is given per axis
  // (3197 Mood t5: a fixed rx of 16 drew wide cards as arches).
  const w=Math.max(1,Number(element.geometry?.width)||1),h=Math.max(1,Number(element.geometry?.height)||1),adj=Math.min(50000,Math.max(0,Number(element.content?.presetAdjust??16667)));
  const r=preset==='roundRect'?adj/100000*Math.min(w,h):0,rx=r/w*100,ry=r/h*100;
  body=`<rect width="100" height="100" rx="${+rx.toFixed(3)}" ry="${+ry.toFixed(3)}" ${edge}/>`;
 }
 else if(preset==='smileyFace'){
  // DrawingML default preset (adj=4653): eye/mouth positions are part of
  // the native geometry, rather than a generic emoji drawn inside an oval.
  const dark=fill==='none'?'none':'#'+fill.slice(1).match(/../g).map(c=>Math.round(parseInt(c,16)*.8).toString(16).padStart(2,'0')).join('');
  body=`<ellipse cx="50" cy="50" rx="50" ry="50" ${edge}/><g fill="${dark}"><ellipse cx="28.7731" cy="35.0463" rx="5.2083" ry="5.2083"/><ellipse cx="60.8102" cy="35.0463" rx="5.2083" ry="5.2083"/></g><path d="M22.8997 71.8053 Q50 90.4173 77.037 71.8053" fill="none" stroke="${stroke}" stroke-width="1"/>`;
 }
 else if(preset==='donut')body=`<path d="M50 0 A50 50 0 1 1 49.99 0 Z M50 25 A25 25 0 1 0 50.01 25 Z" fill-rule="evenodd" ${edge}/>`;
 else if(preset==='triangle')body=`<path d="M50 0 L100 100 H0 Z" ${edge}/>`;
 return {preset,supported:Boolean(body),...(body?{svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${body}</svg>`}:{})};
}
