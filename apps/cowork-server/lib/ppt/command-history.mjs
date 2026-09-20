import { operationsFile, readJsonLines } from './repository.mjs';

export function operationHistory(uid, projectId) {
  return readJsonLines(operationsFile(uid, projectId)).filter(row => row.status === 'committed');
}

export function findOperation(uid, projectId, operationId) {
  return operationHistory(uid, projectId).find(operation => operation.id === operationId) || null;
}

export function latestUndoable(uid, projectId) {
  const rows = operationHistory(uid, projectId);
  const originals = new Map(rows.filter(row => row.kind === 'command').map(row => [row.id, row]));
  const stack = [];
  for (const row of rows) {
    if (row.kind === 'command') stack.push(row);
    if (row.kind === 'undo') {
      const index = stack.findIndex(item => item.id === row.targetOperationId);
      if (index >= 0) stack.splice(index, 1);
    }
    if (row.kind === 'redo') {
      const original = originals.get(row.targetOperationId);
      if (original) { const index = stack.findIndex(item => item.id === original.id); if (index >= 0) stack.splice(index, 1); stack.push(original); }
    }
  }
  return stack.at(-1) || null;
}

export function latestRedoable(uid, projectId) {
  const rows = operationHistory(uid, projectId);
  const stack = [];
  for (const row of rows) {
    if (row.kind === 'command') stack.length = 0;
    if (row.kind === 'undo') stack.push(row);
    if (row.kind === 'redo') {
      const index = stack.findIndex(item => item.targetOperationId === row.targetOperationId);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack.at(-1) || null;
}
