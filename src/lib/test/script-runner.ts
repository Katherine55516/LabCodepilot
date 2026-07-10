import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { atomicWriteText, sha256Hex } from './script-artifacts';
import { resolveBundledHeadlessShell, resolveSystemChrome } from './prompts';
import type { TraceRedaction } from './script-trace';
import { redactTraceText } from './script-trace';

export interface ScriptRunnerOptions {
  scriptFile: string;
  baseUrl?: string | null;
  storageStatePath?: string | null;
  username?: string | null;
  password?: string | null;
  headed?: boolean;
  collectOnly?: boolean;
  timeoutMs?: number;
  redactions?: TraceRedaction[];
}

export interface ScriptRunnerResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

interface RuntimeInfo {
  packageRoot: string;
  cli: string;
  version: string;
}

export function resolveScriptPlaywrightRuntime(): RuntimeInfo {
  const requireFromHere = createRequire(import.meta.url);
  // Next dev/build rewrites import.meta.url to a server chunk, so resolving from
  // this module can point at the chunk tree instead of the app's node_modules.
  // process.cwd() is the repo root in dev and Resources/standalone in packaged
  // Electron (main.ts starts server.js with cwd=standaloneDir).
  const candidates = [
    path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'node_modules', 'playwright'),
    ...(process.env.AILAB_RESOURCES_PATH
      ? [path.join(process.env.AILAB_RESOURCES_PATH, 'standalone', 'node_modules', '@playwright', 'mcp', 'node_modules', 'playwright')]
      : []),
  ];
  try {
    const mcpEntry = requireFromHere.resolve('@playwright/mcp');
    candidates.push(path.join(path.dirname(mcpEntry), 'node_modules', 'playwright'));
  } catch { /* explicit filesystem candidates still cover dev + packaged server */ }
  const nested = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'cli.js')));
  if (!nested) throw new Error('Playwright runtime bundled with @playwright/mcp was not found');
  let version = 'unknown';
  try { version = JSON.parse(fs.readFileSync(path.join(nested, 'package.json'), 'utf-8')).version || version; } catch { /* ignore */ }
  return { packageRoot: nested, cli: path.join(nested, 'cli.js'), version };
}

function runnerDir(scriptFile: string): string {
  return path.join(os.homedir(), '.codepilot', 'test-script-runs', sha256Hex(`${scriptFile}\0${Date.now()}`).slice(0, 20));
}

function symlinkRuntime(dir: string, runtime: RuntimeInfo): void {
  const nodeModules = path.join(dir, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  const link = path.join(nodeModules, 'playwright');
  try { fs.symlinkSync(runtime.packageRoot, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch {
    if (!fs.existsSync(link)) throw new Error('failed to expose bundled Playwright runtime');
  }
}

function findHeadlessShell(root: string): string | null {
  if (!root || !fs.existsSync(root)) return null;
  const executable = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name === executable) return full;
      if (entry.isDirectory() && current.depth < 4) queue.push({ dir: full, depth: current.depth + 1 });
    }
  }
  return null;
}

function matchingHeadlessShell(runtime: RuntimeInfo): string | null {
  const packaged = resolveBundledHeadlessShell();
  if (packaged) return packaged;

  // `bundle-chromium.mjs` keeps the exact MCP revision here before packaging.
  const devBundle = findHeadlessShell(path.join(process.cwd(), 'ms-playwright-bundle'));
  if (devBundle) return devBundle;

  // Developer machines may already have the matching revision in Playwright's
  // normal cache even when the release bundle has not been prepared yet.
  let revision = '';
  try {
    const browsers = JSON.parse(fs.readFileSync(
      path.join(path.dirname(runtime.packageRoot), 'playwright-core', 'browsers.json'),
      'utf-8',
    )) as { browsers?: Array<{ name?: string; revision?: string }> };
    revision = browsers.browsers?.find((item) => item.name === 'chromium-headless-shell')?.revision ?? '';
  } catch { /* no matching cache fallback */ }
  if (!revision) return null;
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright')
        : path.join(os.homedir(), '.cache', 'ms-playwright'));
  return findHeadlessShell(path.join(cacheRoot, `chromium_headless_shell-${revision}`));
}

function configContent(opts: ScriptRunnerOptions, runtime: RuntimeInfo): string {
  const bundled = matchingHeadlessShell(runtime);
  const headedBrowser = opts.headed ? resolveSystemChrome() : null;
  // Packaged builds always carry a headless shell, but a system Chrome is optional.
  // If a headed run was requested and no system browser exists, fall back to headless
  // instead of asking Playwright to locate a non-bundled full Chromium build.
  const runHeaded = Boolean(opts.headed && headedBrowser);
  const executablePath = runHeaded ? headedBrowser : bundled;
  const storage = opts.storageStatePath && fs.existsSync(opts.storageStatePath) ? opts.storageStatePath : undefined;
  return `const { defineConfig } = require('playwright/test');
module.exports = defineConfig({
  testDir: '.',
  timeout: ${Math.max(10_000, opts.timeoutMs ?? 120_000)},
  workers: 1,
  fullyParallel: false,
  reporter: [['line']],
  use: {
    baseURL: process.env.BASE_URL || undefined,
    storageState: ${storage ? JSON.stringify(storage) : 'undefined'},
    headless: ${runHeaded ? 'false' : 'true'},
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: ${executablePath ? JSON.stringify(executablePath) : 'undefined'} },
  },
});
`;
}

export async function runGeneratedScript(opts: ScriptRunnerOptions): Promise<ScriptRunnerResult> {
  const runtime = resolveScriptPlaywrightRuntime();
  const dir = runnerDir(opts.scriptFile);
  fs.mkdirSync(dir, { recursive: true });
  symlinkRuntime(dir, runtime);
  const scriptName = path.basename(opts.scriptFile);
  fs.copyFileSync(opts.scriptFile, path.join(dir, scriptName));
  const config = path.join(dir, 'playwright.config.cjs');
  atomicWriteText(config, configContent(opts, runtime));
  const args = [runtime.cli, 'test', '--config', config, scriptName, ...(opts.collectOnly ? ['--list'] : [])];
  const timeoutMs = opts.collectOnly ? Math.min(opts.timeoutMs ?? 30_000, 30_000) : (opts.timeoutMs ?? 120_000);
  const redactions: TraceRedaction[] = [
    ...(opts.redactions ?? []),
    { value: opts.username, replacement: '${TEST_USERNAME}' },
    { value: opts.password, replacement: '${TEST_PASSWORD}' },
    { value: opts.storageStatePath, replacement: '${STORAGE_STATE}' },
    { value: opts.baseUrl, replacement: '${BASE_URL}' },
  ];
  return await new Promise<ScriptRunnerResult>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: dir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        BASE_URL: opts.baseUrl || '',
        TEST_USERNAME: opts.username || '',
        TEST_PASSWORD: opts.password || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk: Buffer | string) => {
      output = (output + String(chunk)).slice(-20_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({ ok: false, exitCode: null, output: redactTraceText(`${output}\n${error.message}`, redactions), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const clean = redactTraceText(output, redactions);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({ ok: code === 0 && !timedOut, exitCode: code, output: clean, timedOut });
    });
  });
}
