/**
 * 回归用例库 · 纯常量(客户端安全,无 fs/path 依赖)。
 *
 * library.ts(服务端,含 fs 读写)从这里再导出这些常量;客户端组件(InlineTestingPanel)
 * 直接从本文件引入,避免把 Node-only 的 library.ts 拖进浏览器 bundle,也避免两端字面量漂移。
 */

/** 回归集标签值(cases.json `tags` 含它即回归集;与 prompts/reduce/recommend 口径一致)。 */
export const REGRESSION_TAG = '回归测试';

/** 跨任务重跑使用的保留任务名(聚合库写入 `<name>.cases.json`,复用执行+报告机器)。 */
export const REGRESSION_LIBRARY_TASK = '回归用例库';

/**
 * 内置「全量」套件名(v2)。不落盘、不可编辑/删除,语义 = 库内全部用例(隔离除外),
 * 等价 v1 一键重跑的圈选范围,保证向后兼容。用户自建套件禁止占用此名。
 */
export const REGRESSION_FULL_SUITE = '全量';
