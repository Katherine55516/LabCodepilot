// Builds a model-call cassette for one recorded run of the lab service:
//   node scripts/ppt/build-cassette.mjs --live <PPT_IMPLEMENTATION_OUTPUT> --run <runId> [--out <dir>]
// The run must have been started by a project action the service snapshotted
// (request-snapshots/) and recorded with version-2 model-call records. The
// cassette goes under outputs/ppt-cassettes/ by default: it holds source text
// and model replies, so it never goes into git.
// Replay: node apps/cowork-server/selftest-ppt-cassette.mjs
import fs from 'node:fs';
import path from 'node:path';
import { buildCassette } from '../../apps/cowork-server/test/ppt-cassette.mjs';

const arg = name => { const at = process.argv.indexOf('--' + name); return at > 0 ? process.argv[at + 1] : undefined; };
const live = arg('live'), runId = arg('run');
if (!live || !/^run_[a-f0-9]{24}$/.test(runId || '')) throw Error('Usage: --live <dir> --run <runId> [--out <dir>]');
const snapshots = path.join(live, 'request-snapshots');
const requestDir = fs.readdirSync(snapshots).map(name => path.join(snapshots, name))
  .find(dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'request.json'), 'utf8')).runIdAfter === runId; } catch { return false; } });
if (!requestDir) throw Error(`No request snapshot started ${runId}`);
const request = JSON.parse(fs.readFileSync(path.join(requestDir, 'request.json'), 'utf8'));
const out = arg('out') || path.join(process.cwd(), 'outputs/ppt-cassettes', `${request.projectId.slice(0, 8)}-${runId}`);
fs.mkdirSync(out, { recursive: true });
const cassette = buildCassette({ live, requestDir, out });
const counts = cassette.calls.reduce((all, call) => ({ ...all, [call.outcome]: (all[call.outcome] || 0) + 1 }), {});
console.log(JSON.stringify({ out, projectId: cassette.projectId, runId, action: cassette.action, calls: cassette.calls.length, ...counts, commit: cassette.commit, outcome: cassette.outcome }));
