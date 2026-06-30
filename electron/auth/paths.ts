/**
 * Resolve the anlcode/ directory used by the managed-account login system.
 *
 * Same convention as src/lib/db.ts:
 *   dataDir = process.env.CLAUDE_GUI_DATA_DIR || os.homedir() + '/.codepilot'
 * Then anlcode lives under dataDir/anlcode/.
 *
 * Mirrored (deliberately, not shared) in src/lib/auth-shared/paths.ts so the
 * Next.js standalone server can read the same files without crossing the
 * electron/ <-> src/ boundary that the rest of the codebase respects.
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
  imageConfig: 'image_config.json',
} as const;

export function anlcodePath(file: keyof typeof ANLCODE_FILES): string {
  return path.join(getAnlcodeDir(), ANLCODE_FILES[file]);
}
