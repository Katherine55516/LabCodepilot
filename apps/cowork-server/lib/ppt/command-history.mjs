import { operationsFile, readJsonLines } from './repository.mjs';

export function operationHistory(uid, projectId) {
  return readJsonLines(operationsFile(uid, projectId), uid).filter(row => row.status === 'committed');
}

export function findOperation(uid, projectId, operationId) {
  return operationHistory(uid, projectId).find(operation => operation.id === operationId) || null;
}

export function latestUndoable(uid, projectId) {
  const rows = operationHistory(uid, projectId);
  const stack = [];
  for (const row of rows) {
    if (row.kind === 'command') stack.push(row);
    if (row.kind === 'undo') {
      const index = stack.findIndex(item => item.id === row.targetOperationId);
      if (index >= 0) stack.splice(index, 1);
    }
    if (row.kind === 'redo') {
      // Redo can allocate a new native clone ID. Its actual committed inverse
      // owns that new object; replaying the original inverse targets a dead ID.
      const index = stack.findIndex(item => item.id === row.targetOperationId);
      if (index >= 0) stack.splice(index, 1);
      stack.push(row);
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
