import { NextResponse } from "next/server";
import { invalidateSkillCache } from "@/lib/skill-discovery";
import { invalidateSkillReconcileCache } from "@/lib/skill-reconcile";

/**
 * 技能发现缓存失效 — 供主进程侧的技能安装流程（技能市场·内部）安装/卸载后
 * 由 renderer 调用。skill-discovery 的扫描缓存无 TTL,只有本 Next 进程内的
 * 变更路由会失效它;主进程直接写 ~/.claude/skills/ 时 Next 无从感知,不打
 * 这一枪的话原生 Skill 工具与斜杠列表会拿到陈旧集合。
 * 幂等、无副作用之外的状态,失败无害(下次自然重扫)。
 */
export async function POST() {
  invalidateSkillCache();
  invalidateSkillReconcileCache();
  return NextResponse.json({ ok: true });
}
