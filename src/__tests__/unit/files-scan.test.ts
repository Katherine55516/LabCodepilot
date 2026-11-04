/**
 * Unit tests for the file-tree hidden-directory whitelist (scanDirectory).
 *
 * Verifies that ALLOWED_HIDDEN_DIRS surfaces `.claude` / `.git` / `.planning`
 * in the file tree (like a normal dir, recursing into them) while other
 * dot-directories stay hidden — the B-019-adjacent ".claude not visible" fix.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

import { scanDirectory } from '../../lib/files';
import type { FileTreeNode } from '../../types';

let root = '';

function names(nodes: FileTreeNode[]): string[] {
  return nodes.map((n) => n.name);
}

describe('scanDirectory — hidden-directory visibility', () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetree-scan-'));
    // Allowed-hidden dirs (should appear + recurse)
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}');
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
    // Ordinary content (should appear)
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), '');
    fs.writeFileSync(path.join(root, 'README.md'), '# hi');
    // Other dot-dir (should stay hidden)
    fs.mkdirSync(path.join(root, '.secret'));
    fs.writeFileSync(path.join(root, '.secret', 'x'), '');
  });

  after(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('surfaces .claude as a directory and recurses into it', async () => {
    const tree = await scanDirectory(root, 3);
    const claude = tree.find((n) => n.name === '.claude');
    assert.ok(claude, '.claude should be visible in the file tree');
    assert.equal(claude.type, 'directory');
    assert.ok(
      (claude.children ?? []).some((c) => c.name === 'settings.json'),
      '.claude should recurse to show its contents',
    );
  });

  it('still surfaces .git (unchanged behavior)', async () => {
    const tree = await scanDirectory(root, 3);
    assert.ok(names(tree).includes('.git'), '.git should remain visible');
  });

  it('keeps other dot-directories hidden', async () => {
    const tree = await scanDirectory(root, 3);
    assert.ok(!names(tree).includes('.secret'), '.secret must stay hidden');
  });

  it('shows ordinary files and directories', async () => {
    const tree = await scanDirectory(root, 3);
    const names_ = names(tree);
    assert.ok(names_.includes('src'));
    assert.ok(names_.includes('README.md'));
  });
});
