/**
 * BACKEND_BASE resolution for the managed-account login system.
 *
 * Priority:
 *   1. process.env.BACKEND_BASE (any non-empty value wins)
 *   2. app.isPackaged → production URL
 *   3. dev URL
 *
 * Trailing slashes are stripped so callers can append paths with leading `/`.
 */

import { app } from 'electron';

const PROD_BACKEND = 'https://code-agent.ai-native-lab.com';
const DEV_BACKEND = 'http://localhost:8080';

export function getBackendBase(): string {
  const envOverride = process.env.BACKEND_BASE;
  if (envOverride && envOverride.trim()) {
    return envOverride.trim().replace(/\/+$/, '');
  }
  const base = app.isPackaged ? PROD_BACKEND : DEV_BACKEND;
  return base.replace(/\/+$/, '');
}
