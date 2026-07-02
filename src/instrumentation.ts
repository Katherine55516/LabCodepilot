/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize runtime log capture for the Doctor export feature.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 全局崩溃捕获(尽早挂,先于下面的 scheduler/reconcile)——把崩溃栈写进 stderr→main.log,
    // 用于定位「内嵌 server ready 后约 12s 异常退出(code -36616)、之前无栈可查」的根因。
    process.on('uncaughtException', (err: unknown) => {
      console.error('[server:uncaughtException]', err instanceof Error ? (err.stack || err.message) : String(err));
      // 保持「未捕获异常 = 致命」语义:记录后退出,由 electron 侧自动重启(重启后状态干净)。
      process.exit(1);
    });
    process.on('unhandledRejection', (reason: unknown) => {
      // 只记录、不退出:① 拿到栈用于定位;② 顺带挡掉 Node 默认对未处理 rejection 的 crash——
      // 若 server 崩溃源恰是某个 fire-and-forget 的 rejection,这能直接缓解。
      console.error('[server:unhandledRejection]', reason instanceof Error ? (reason.stack || reason.message) : String(reason));
    });

    // [排障·临时] native 崩溃取证:上面两个 handler 只能捕 JS 层异常,而 Windows 打包版
    // 「点报告 tab → 服务 native 崩溃(死前 crashpad not connected、exit -36616/-36861 族、
    // 无任何 JS 栈)」发生在 native 层。开启 Node 诊断报告:V8/OOM 级致命错误时写出含
    // 原生调用栈/已加载模块列表的 report.*.json 到数据目录(~/.codepilot,恒可写),
    // 直接指认崩溃所在的 native 模块。定位后移除。
    try {
      if (process.report) {
        process.report.reportOnFatalError = true;
        if (process.env.CLAUDE_GUI_DATA_DIR) process.report.directory = process.env.CLAUDE_GUI_DATA_DIR;
      }
    } catch { /* process.report 不可用则跳过 */ }

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
