/** Geometry checks shared by automatic source layout and visible QA. */
export function layoutBalance(boxes, canvas) {
  if (!boxes.length || !canvas?.width || !canvas?.height) return null;
  const left = Math.min(...boxes.map(box => box.x)), right = Math.max(...boxes.map(box => box.x + box.width));
  const top = Math.min(...boxes.map(box => box.y)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: Math.abs((left + right) / 2 - canvas.x - canvas.width / 2) / canvas.width,
    y: Math.abs((top + bottom) / 2 - canvas.y - canvas.height / 2) / canvas.height,
    horizontalWhitespaceDifference: Math.abs(left - canvas.x - (canvas.x + canvas.width - right)) / canvas.width,
    verticalWhitespaceDifference: Math.abs(top - canvas.y - (canvas.y + canvas.height - bottom)) / canvas.height };
}

export function inspectLayoutBalance(project) {
  return (project.deck?.slides || []).flatMap((slide, index) => {
    if (!index || !slide.sourceArtifactFit?.canvas) return [];
    const nodes = (slide.nodes || []).filter(node => !node.hidden && (node.sourceArtifact || node.semanticRole === 'source-explanation'));
    if (!nodes.length || nodes.length > 3 || nodes.some(node => node.userGeometry) || nodes.filter(node => ['table','image','chart'].includes(node.type)).length !== 1 || nodes.some(node => !node.geometry)) return [];
    const balance = layoutBalance(nodes.map(node => node.geometry), slide.sourceArtifactFit.canvas);
    return balance && (balance.x > .1 || balance.y > .1 || balance.horizontalWhitespaceDifference > .35 || balance.verticalWhitespaceDifference > .35)
      ? [{ code:'layout_unbalanced', severity:'warning', repairable:true, slideId:slide.id, balance,
        message:'Source components leave uneven space; center the group in the content region without changing text size.' }] : [];
  });
}
