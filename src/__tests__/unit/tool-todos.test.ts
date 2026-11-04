/**
 * Tests for toolTodos / activeTodoForm — the TodoWrite checklist extraction.
 * Pure (no React/DOM) so they run under `tsx --test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toolTodos, activeTodoForm } from '../../lib/tool-todos';

describe('toolTodos', () => {
  it('extracts todos with content / activeForm / status', () => {
    const todos = toolTodos('TodoWrite', { todos: [
      { content: 'A', activeForm: 'doing A', status: 'completed' },
      { content: 'B', activeForm: 'doing B', status: 'in_progress' },
      { content: 'C', activeForm: 'doing C', status: 'pending' },
    ] });
    assert.ok(todos);
    assert.equal(todos!.length, 3);
    assert.equal(todos![1].content, 'B');
    assert.equal(todos![1].status, 'in_progress');
  });

  it('returns null for non-TodoWrite tools', () => {
    assert.equal(toolTodos('Bash', { command: 'ls' }), null);
  });

  it('returns null when todos is missing / not an array / input not object', () => {
    assert.equal(toolTodos('TodoWrite', {}), null);
    assert.equal(toolTodos('TodoWrite', { todos: 'x' }), null);
    assert.equal(toolTodos('TodoWrite', null), null);
  });

  it('defaults unknown / missing status to pending', () => {
    const todos = toolTodos('TodoWrite', { todos: [{ content: 'X', status: 'weird' }, { content: 'Y' }] });
    assert.equal(todos![0].status, 'pending');
    assert.equal(todos![1].status, 'pending');
  });
});

describe('activeTodoForm', () => {
  it('returns the in_progress item activeForm', () => {
    assert.equal(activeTodoForm([
      { content: 'A', activeForm: 'doing A', status: 'completed' },
      { content: 'B', activeForm: 'doing B', status: 'in_progress' },
      { content: 'C', activeForm: 'doing C', status: 'pending' },
    ]), 'doing B');
  });

  it('falls back to the last completed activeForm when none in_progress', () => {
    assert.equal(activeTodoForm([
      { content: 'A', activeForm: 'doing A', status: 'completed' },
      { content: 'B', activeForm: 'doing B', status: 'completed' },
    ]), 'doing B');
  });

  it('falls back to the first item when all pending', () => {
    assert.equal(activeTodoForm([
      { content: 'A', activeForm: 'doing A', status: 'pending' },
    ]), 'doing A');
  });
});
