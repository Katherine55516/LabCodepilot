/**
 * sessionStorage key used to hand a one-shot prefill text to the new-chat
 * composer across an SPA navigation. The producer (e.g. the CLI Tools
 * "添加工具" button) writes the text under this key right before
 * router.push('/chat'); the /chat page reads it once on mount and removes it.
 *
 * Why sessionStorage instead of the `?prefill=` query string: App Router's
 * client navigation updates window.location a tick after the new page mounts,
 * so a mount-time read of the query string can miss it. sessionStorage is set
 * synchronously before navigation and is reliably available on mount —
 * including inside the packaged Electron window, where a full-page
 * `window.location.href` navigation silently fails.
 */
export const NEW_CHAT_PREFILL_KEY = 'codepilot:new-chat-prefill';
