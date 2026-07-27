/**
 * /settings 兼容层共用的常量。
 *
 * 设置已从整页改成全局弹窗(见 components/settings/SettingsDialog.tsx),但代码库里
 * 还散落着十几处 `router.push('/settings#cli')` / `<Link href="/settings#providers">`
 * / 错误提示里生成的 markdown 链接。与其逐一改写(还会漏掉运行时拼出来的),不如让
 * /settings 路由退化成一层薄壳:进来就打开弹窗,并把地址栏换回用户原本待着的页面。
 *
 * 「原本待着的页面」由 AppShell 持续写进 sessionStorage —— 兼容层是另一个路由的
 * 组件,拿不到上一次的 pathname,只能靠这个共享的键传递。
 */
export const LAST_NON_SETTINGS_PATH_KEY = "codepilot:last-non-settings-path";

/** 没有记录时的落点(应用主界面)。 */
export const SETTINGS_FALLBACK_PATH = "/chat";

export function readLastNonSettingsPath(): string {
  if (typeof window === "undefined") return SETTINGS_FALLBACK_PATH;
  try {
    const saved = sessionStorage.getItem(LAST_NON_SETTINGS_PATH_KEY);
    // 只接受站内绝对路径,避免被塞进外部地址后 replace 到站外
    if (saved && saved.startsWith("/") && !saved.startsWith("//")) return saved;
  } catch {
    // sessionStorage 不可用(隐私模式等)—— 回落默认路径
  }
  return SETTINGS_FALLBACK_PATH;
}
