// Windows 打包的 no-op 签名钩子(electron-builder.yml win.sign 指向此文件)。
// CI 无签名证书,electron-builder 默认仍会对产物内每个 exe 逐个调 signtool,
// 且签名与 extraResources 大树复制并发执行,Windows runner 上实测反复
// EBUSY copyfile 竞态。空实现移除全部 signtool 活动;rcedit 注入图标/版本
// 信息的环节不经过本钩子,不受影响。
module.exports = async function noopSign() { /* 故意不签名 */ };
