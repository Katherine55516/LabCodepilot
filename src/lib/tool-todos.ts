/**
 * tool-todos.ts — extract the todo list from a TodoWrite tool call so the tool
 * row can render it as a checklist (and surface the in-progress step in the
 * collapsed header). Pure (no React/DOM), unit-testable.
 */

export interface TodoItem {
  /** Imperative description shown in the checklist row. */
  content: string;
  /** Present-continuous form shown in the collapsed header while in progress. */
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const TODO_TOOLS = new Set(['todowrite', 'todo_write']);

/**
 * Parse a TodoWrite call's input into TodoItem[], or null when the tool isn't a
 * TodoWrite / the payload has no todos array. Unknown statuses fall back to
 * 'pending'.
 */
export function toolTodos(name: string, input: unknown): TodoItem[] | null {
  if (!TODO_TOOLS.has(name.toLowerCase())) return null;
  if (!input || typeof input !== 'object') return null;
  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return null;
  const items: TodoItem[] = todos.map((t) => {
    const o = (t || {}) as Record<string, unknown>;
    const status = o.status === 'completed' || o.status === 'in_progress' ? o.status : 'pending';
    return {
      content: typeof o.content === 'string' ? o.content : '',
      activeForm: typeof o.activeForm === 'string' ? o.activeForm : '',
      status: status as TodoItem['status'],
    };
  });
  return items.length > 0 ? items : null;
}

/**
 * Collapsed-header text for a TodoWrite call: the activeForm of the in_progress
 * item (what's being worked on right now). Falls back to the last completed
 * item's activeForm (just-finished), then the first item.
 */
export function activeTodoForm(todos: TodoItem[]): string {
  const active = todos.find((t) => t.status === 'in_progress');
  if (active) return active.activeForm || active.content;
  const lastCompleted = [...todos].reverse().find((t) => t.status === 'completed');
  if (lastCompleted) return lastCompleted.activeForm || lastCompleted.content;
  return todos[0]?.activeForm || todos[0]?.content || 'todos';
}
