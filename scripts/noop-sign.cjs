// Windows 打包的 no-op 签名钩子(electron-builder.yml win.signtoolOptions.sign 指向此文件)。
// CI 无签名证书,electron-builder 默认仍会对产物内每个 exe 逐个调 signtool,
// 且签名与 extraResources 大树复制并发执行,Windows runner 上实测反复
// EBUSY copyfile 竞态。空实现移除全部 signtool 活动;rcedit 注入图标/版本
// 信息的环节不经过本钩子,不受影响。
// 同时挂 module.exports 与 .default:app-builder-lib 的 resolveFunction 在不同
// 版本分别取这两处,只挂一处可能被静默忽略(26.8.1 实测配置合法但 17 次 signtool
// 照跑)。钩子内打日志,CI 日志可直接实证钩子是否真被调用。
function noopSign(config) {
  const target = config && config.path;
  console.log(`[noop-sign] skip signing: ${target || '(unknown target)'}`);
  return Promise.resolve();
}
module.exports = noopSign;
module.exports.default = noopSign;
