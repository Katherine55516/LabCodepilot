import fs from 'fs';
import os from 'os';
import path from 'path';

export const runtime = 'nodejs';

/**
 * 测试工作台 · 数据持久化路由（projects + taskStates）。
 *
 * 原本测试项目与任务状态存在 renderer 的 localStorage 里，但打包版的端口会漂移
 * （origin 变化），localStorage 跟 origin 绑定 → 升级/重启后用户项目被清空。改为
 * 落到主进程数据目录的单个 JSON 文件，与 origin 无关，持久可靠。
 *
 * 数据目录与其它模块对齐：打包版 main.ts 注入 CLAUDE_GUI_DATA_DIR；dev 回退 homedir
 * 下的 ~/.codepilot（见 src/app/api/media/serve/route.ts 同款写法）。
 *  - GET：读 test-workbench.json 返回 { projects, taskStates }；文件不存在/解析失败
 *    一律返回空壳 { projects: [], taskStates: {} }（不抛 500，让前端走迁移/初始化）。
 *  - PUT：body { projects, taskStates } 原子写（先写 .tmp 再 rename，避免写一半损坏）。
 */

function dataFilePath(): string {
  const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
  return path.join(dataDir, 'test-workbench.json');
}

export async function GET(): Promise<Response> {
  try {
    const raw = await fs.promises.readFile(dataFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    const taskStates =
      parsed.taskStates && typeof parsed.taskStates === 'object' && !Array.isArray(parsed.taskStates)
        ? parsed.taskStates
        : {};
    return Response.json({ projects, taskStates });
  } catch {
    // 文件不存在 / JSON 损坏 → 返回空壳（不抛 500），前端据此做一次性迁移或初始化。
    return Response.json({ projects: [], taskStates: {} });
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const projects = Array.isArray(body.projects) ? body.projects : [];
    const taskStates =
      body.taskStates && typeof body.taskStates === 'object' && !Array.isArray(body.taskStates)
        ? body.taskStates
        : {};

    const file = dataFilePath();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    // 原子写：先写临时文件再 rename，rename 在同一目录内是原子操作，避免读到写一半的损坏 JSON。
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify({ projects, taskStates }), 'utf-8');
    await fs.promises.rename(tmp, file);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
