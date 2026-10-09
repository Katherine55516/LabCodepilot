import { obligationRegistry } from './lib/ppt-obligations.mjs';
import { visibleSlideText } from './lib/ppt-evidence.mjs';
import { nodeContentText, visibleNodes } from './lib/ppt-visible-content.mjs';
import { exportManifest } from './lib/ppt-export-integrity.mjs';
// Simulated critic protocol only. This helper does not verify semantic truth.
import { inputFramework } from './lib/ppt-input-scope.mjs';
export function scopeReview(project, findings = {}) {
  const registry=obligationRegistry(project),slide=project.deck.slides[0];
  const node=visibleNodes(slide).find(n=>nodeContentText(n)),excerpt=node?nodeContentText(node):visibleSlideText(slide);
  const obligationAudit={registryHash:registry.registryHash,status:'complete',checks:registry.entries.map(e=>({obligationId:e.id,status:'satisfied',evidence:[{slideId:slide.id,nodeId:node?.id||`slide:${slide.id}`,excerpt}]}))};
  return { obligationAudit, missing: [], repeated: [], conflicts: [], unsupported: [], ...findings,
    scopeAudit: { frameworkHash: inputFramework(project).frameworkHash,
      checkedSlideIds: project.deck.slides.map(slide => slide.id), status: 'complete' } };
}

// Explicit export protocol double; it never claims actual-file verification.
export function simulatedExport(project,bytes=123){const m=exportManifest(project);return {bytes,exportVerification:{status:'passed',basis:'test_double',version:m.version,manifestHash:m.manifestHash,renderHash:m.renderHash,revision:m.revision,sha256:'simulated-test-only'}};}
