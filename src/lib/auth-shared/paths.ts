/**
 * Resolve the anlcode/ directory from the Next.js server side.
 *
 * Deliberately mirrors electron/auth/paths.ts (NOT shared) so the two worlds
 * stay decoupled. Same convention as src/lib/db.ts:
 *   dataDir = process.env.CLAUDE_GUI_DATA_DIR || os.homedir() + '/.codepilot'
 *
 * The main process injects CLAUDE_GUI_DATA_DIR when spawning the Next.js
 * standalone server, so this path is consistent across both processes.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function getDataDir(): string {
  return process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
}

export function getAnlcodeDir(): string {
  const dir = path.join(getDataDir(), 'anlcode');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export const ANLCODE_FILES = {
  sessionToken: 'session_token',
  deviceId: 'device_id',
  configs: 'configs.json',
  configsHash: 'configs.hash',
  selectedConfigId: 'selected_config_id',
} as const;

export function anlcodePath(file: keyof typeof ANLCODE_FILES): string {
  return path.join(getAnlcodeDir(), ANLCODE_FILES[file]);
}
