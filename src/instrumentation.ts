/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize runtime log capture for the Doctor export feature.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initRuntimeLog } = await import('@/lib/runtime-log');
    initRuntimeLog();

    // Start the task scheduler so persisted tasks resume on cold boot
    // (previously only started as a side effect of /api/chat)
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();

    // Mirror ~/.agents/skills/ → ~/.claude/skills/ so the bundled Claude Code
    // binary can load skills the `skills` CLI installed into the agent-neutral
    // location. Runs once at boot, before any chat session, so pre-existing
    // orphans are visible to the agent from the first message. See
    // src/lib/skill-reconcile.ts.
    try {
      const { reconcileAgentsSkillsToClaudeSkills } = await import('@/lib/skill-reconcile');
      reconcileAgentsSkillsToClaudeSkills();
    } catch (err) {
      console.warn('[instrumentation] skill reconcile failed:', err instanceof Error ? err.message : err);
    }
  }
}
