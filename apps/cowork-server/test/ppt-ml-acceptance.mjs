/** Independent acceptance facts established from the original tutorial and
 * review, not reconstructed from the model double's returned blueprint. */
import assert from 'node:assert/strict';import{visibleNodes,nodeContentText}from'../lib/ppt-visible-content.mjs';
export function assertMlEditorial(project,total){
 assert.equal(project.inputUnderstanding.recommended,18);assert.equal(project.pages,total);assert.equal(project.outline.length,total);assert.equal(project.deck.slides.length,total);assert.equal(project.renderTree.slides.length,total);
 const nodes=project.deck.slides.flatMap(s=>visibleNodes(s)),text=s=>visibleNodes(s).map(nodeContentText).join('\n');
 const weights=project.deck.slides.find(s=>visibleNodes(s).some(n=>n.sourceArtifact?.sourceUnitId==='b_0172'));assert.ok(weights,'the independent weight corrections need their combined formula');
 for(const id of ['b_0162','b_0167','b_0170','b_0172'])assert.ok(visibleNodes(weights).some(n=>n.sourceArtifact?.sourceUnitId===id),'same-page weight/condition closure '+id);
 assert.match(text(weights),/classification/iu);assert.match(text(weights),/decay/iu);
 const graphRequirements=[['b_0021',3,0],['b_0070',4,3],['b_0178',3,2],['b_0213',3,2],['b_0219',4,4],['b_0243',7,0]];
 for(const [id,count,edges]of graphRequirements){const graph=nodes.find(n=>n.sourceArtifact?.sourceUnitId===id&&n.content?.diagram?.relational);assert.ok(graph,'the requested representation must actually be an editable relation component: '+id);assert.equal(graph.content.items.length,count);assert.equal(graph.content.diagram.relational.edges.length,edges);assert.equal(project.sourceGraphAudits[id].status,'accepted');}
 const pitSlide=project.deck.slides.find(s=>visibleNodes(s).some(n=>n.sourceArtifact?.sourceUnitId==='b_0260'));assert.doesNotMatch(pitSlide.section||'',/Summary/iu);assert.equal(pitSlide.sectionLabel.basis,'presentation-outline');
 const intervals=nodes.find(n=>n.sourceArtifact?.sourceUnitId==='b_0191'&&n.content.diagram);assert.equal(intervals.content.diagram.relational.endpointBindings.length,3);
 const rolling=nodes.find(n=>n.sourceArtifact?.sourceUnitId==='b_0219');assert.match(nodeContentText(rolling),/clock advances/iu);assert.match(nodeContentText(rolling),/out-of-sample/iu);
 const traps=nodes.filter(n=>n.sourceArtifact?.sourceUnitId==='b_0260');assert.equal(traps.length,1);assert.deepEqual(traps[0].content.rows.slice(1).map(r=>r[0]),['1','2','3','4','5']);assert.equal(traps[0].content.rows[0].length,4);
 assert.ok(!nodes.some(n=>/Diagram description:/u.test(nodeContentText(n))));
 assert.ok(!project.quality.deterministic.issues.some(i=>i.severity==='error'));
 assert.equal(project.quality.visualVerified,false,'model-only simulation cannot certify human visual review');
 return {total,combinedWeightCondition:true,sourceQuotedRelationComponents:6,completePitRows:5,sourceGraphAudits:6,simulation:true};
}
