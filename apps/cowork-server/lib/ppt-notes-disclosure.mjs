/** Speaker notes retain complete source text and the disposition ledger.
 * Round 7 A5 removes generated “details in notes” banners from the canvas,
 * including legacy banners, without removing any actual note or user content. */
export function bindNotesDisclosures(project) {
  project.notesDisclosureIssues=[];
  for(const slide of project.deck?.slides||[]){
    slide.nodes=(slide.nodes||[]).filter(node=>node.content?.derivedFrom!=='notes-disclosure');
    if(slide.nodeOrder){const ids=new Set(slide.nodes.map(node=>node.id));slide.nodeOrder=slide.nodeOrder.filter(id=>ids.has(id));}
  }
  return project;
}
