/**
 * cowork-staging.ts — 办公(沙箱)会话的宿主暂存目录(E2,D2)。
 *
 * 办公会话不绑用户项目文件夹,但大量既有代码假设"每个会话都有有效的宿主
 * working_directory"(附件落 `<wd>/.codepilot-uploads/`、resolveWorkingDirectory
 * 兜底、resume 前置检查等)。与其逐点排雷空目录语义,不如给每个办公会话一个
 * 应用数据目录下的合成暂存目录:
 *
 *   ~/.codepilot/cowork/<sessionId>/
 *
 * - 附件沿现有链路落 `<staging>/.codepilot-uploads/`,消息气泡预览走
 *   /api/uploads(其白名单是路径子串匹配,任意前缀可服务,零改动)
 * - 属于应用数据面,在"真机零写入"验收口径的豁免范围内
 * - 会话删除时整目录级联清理;路径只从 sessionId 推导,**绝不**读会话记录里的
 *   working_directory —— 遗留 POC 沙箱会话绑的是真实项目目录,不能误删
 * - 与 POC 资产目录 ~/.codepilot/cowork-poc/ 相互独立
 *
 * 见 docs/exec-plans/active/cowork-office-mode.md(E2/D2)。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** 会话 id 形如 crypto.randomBytes(16).toString('hex')(32 hex);宽松到 8–64 位 hex。 */
const HEX_ID = /^[0-9a-f]{8,64}$/i;

function assertSessionId(sessionId: string): string {
  if (!HEX_ID.test(sessionId)) {
    throw new Error(`invalid cowork sessionId: ${sessionId}`);
  }
  return sessionId;
}

/** 暂存根目录(~/.codepilot/cowork)。 */
export function officeStagingRoot(): string {
  return path.join(os.homedir(), '.codepilot', 'cowork');
}

/** 某会话的暂存目录路径(纯计算,不创建)。非法 sessionId 抛错。 */
export function officeStagingDir(sessionId: string): string {
  return path.join(officeStagingRoot(), assertSessionId(sessionId));
}

/** 创建并返回会话暂存目录(幂等)。 */
export function ensureOfficeStagingDir(sessionId: string): string {
  const dir = officeStagingDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 删除会话暂存目录(幂等;目录不存在时 no-op)。 */
export function removeOfficeStagingDir(sessionId: string): void {
  const dir = officeStagingDir(sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
}
