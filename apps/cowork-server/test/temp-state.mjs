// Imported first by selftests that touch the PPT store: without COWORK_STATE_DIR
// the store defaults to the container path /data/cowork-state.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.COWORK_STATE_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-selftest-state-'));
