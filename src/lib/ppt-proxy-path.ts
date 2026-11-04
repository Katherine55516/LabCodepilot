/** PPT service allowlist, shared by the proxy and route contract tests. */
export function isPptProxyPath(segments: string[]): boolean {
  const projectId = /^[a-f0-9]{32}$/i;
  const objectId = /^[a-zA-Z0-9_-]{1,80}$/;
  const legacyProject = segments[0] === 'projects' && segments.length <= 3 &&
    (segments.length === 1 || segments[1] === 'bulk' || projectId.test(segments[1])) &&
    (segments.length < 3 || (segments[1] !== 'bulk' && ['outline', 'generate', 'retry', 'export', 'pdf', 'source', 'duplicate', 'trash', 'restore', 'permanent', 'versions','execution','execution-policy','conversation','source-assets','component-copy','task-record','cover','discard', 'rewrite', 'blank','page-policy','media-exclusions','source-warnings','planning','requirements'].includes(segments[2])));
  const structuredProject = segments[0] === 'projects' && projectId.test(segments[1] || '') && (
    (segments.length === 3 && segments[2] === 'native-fonts') ||
    (segments.length === 4 && segments[2] === 'native-fonts' && /^[a-f0-9]{64}\.ttf$/.test(segments[3])) ||
    (segments.length === 3 && ['run', 'events', 'commands', 'undo', 'redo', 'publish', 'ai-check', 'revisions', 'ai-edit', 'table-representation'].includes(segments[2])) ||
    (segments.length === 4 && segments[2] === 'preview' && /^[a-zA-Z0-9_-]{1,80}\.svg$/.test(segments[3])) ||
    (segments.length === 4 && segments[2] === 'review-advisories' && /^adv_[a-f0-9]{20}$/.test(segments[3])) ||
    (segments.length === 5 && segments[2] === 'revisions' && /^\d+$/.test(segments[3]) && segments[4] === 'restore') ||
    (segments.length === 6 && segments[2] === 'slides' && objectId.test(segments[3]) && segments[4] === 'assets' && /^[a-zA-Z0-9_-]{1,100}$/.test(segments[5])) ||
    (segments.length === 5 && segments[2] === 'slides' && objectId.test(segments[3]) && segments[4] === 'preview') ||
    (segments.length === 7 && segments[2] === 'slides' && objectId.test(segments[3]) && segments[4] === 'repair-comparison' && projectId.test(segments[5]) && ['before','after'].includes(segments[6]))
  );
  const run = segments[0] === 'runs' && segments.length === 2 && /^run_[a-f0-9]{24}$/i.test(segments[1]);
  const editRoute = segments[0] === 'projects' && projectId.test(segments[1] || '') && (
    (segments.length === 3 && ['generation-edit-scopes', 'generation-edits', 'proposals', 'asset-tasks', 'runtime', 'pause', 'resume'].includes(segments[2])) ||
    (segments.length === 4 && ['generation-edits', 'proposals', 'asset-tasks'].includes(segments[2]) && objectId.test(segments[3])) ||
    (segments.length === 5 && ['generation-edits', 'proposals', 'asset-tasks'].includes(segments[2]) && objectId.test(segments[3]) && ['retry', 'apply', 'discard', 'complete'].includes(segments[4])) ||
    (segments.length === 5 && segments[2] === 'proposals' && objectId.test(segments[3]) && ['revise','version','restore'].includes(segments[4])) ||
    (segments.length === 5 && segments[2] === 'slides' && objectId.test(segments[3]) && ['accept', 'retry', 'regenerate'].includes(segments[4])) ||
    (segments.length === 4 && segments[2] === 'runtime' && ['pause', 'resume', 'cancel'].includes(segments[3]))
  );
  const order = segments.length === 2 && ['projects', 'folders'].includes(segments[0]) && segments[1] === 'order';
  const estimate = segments.length === 1 && segments[0] === 'page-estimate';
  const project = legacyProject || structuredProject || run || editRoute || order || estimate;
  const folder = segments[0] === 'folders' && segments.length <= 2 &&
    (segments.length === 1 || /^[a-f0-9]{32}$/i.test(segments[1]));
  const template = segments[0] === 'templates' && (segments.length === 1 ||
    /^(violet|blue|light|marketing|education|[a-f0-9]{32})$/i.test(segments[1] || '') &&
    (segments.length === 2 || segments.length === 3 && segments[2] === 'preview'));
  const update = segments[0] === 'updates' && segments.length === 1;
  const modelJobs = segments[0] === 'model-jobs' && (segments.length === 1 || segments.length === 3 && projectId.test(segments[1]) && ['claim', 'complete','progress'].includes(segments[2]));
  const capabilities = segments.length === 1 && ['capabilities', 'health'].includes(segments[0]);
  return project || folder || template || update || modelJobs || capabilities;
}
