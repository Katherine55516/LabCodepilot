/* global window, document */
// 获取登录态工具条控制器 —— 通过 window.electronAPI.testAuthCapture 与主进程通信。
// 无打包依赖，纯 <script src> 即可（与 login.js 一致）。

(function () {
  'use strict';

  var finishBtn = document.getElementById('finish-btn');
  var cancelBtn = document.getElementById('cancel-btn');
  var targetEl = document.getElementById('target');
  var errorEl = document.getElementById('error');

  function api() {
    return window.electronAPI && window.electronAPI.testAuthCapture;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    targetEl.classList.add('dim');
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
    targetEl.classList.remove('dim');
  }

  // 主进程下发抓取目标（系统 · 环境 · 账号），渲染到标题右侧。
  var a = api();
  if (a && typeof a.onToolbarInit === 'function') {
    a.onToolbarInit(function (info) {
      var parts = [];
      if (info && info.systemLabel) parts.push(info.systemLabel);
      if (info && info.env) parts.push(info.env);
      if (info && info.accountKey) parts.push(info.accountKey);
      targetEl.textContent = parts.join(' · ');
    });
  }

  async function doFinish() {
    var fns = api();
    if (!fns || typeof fns.toolbarFinish !== 'function') {
      showError('抓取入口未注入，请重启应用后再试');
      return;
    }
    clearError();
    finishBtn.disabled = true;
    cancelBtn.disabled = true;
    finishBtn.textContent = '正在抓取…';
    try {
      var res = await fns.toolbarFinish();
      if (res && res.ok) {
        // 主进程已写盘并即将关窗，无需额外处理。
        finishBtn.textContent = '已完成';
        return;
      }
      // 抓到空（或无会话）—— 不关窗，提示用户先登录。
      showError('还没检测到登录态，请先在下方完成登录，再点「登录完成」');
    } catch (e) {
      showError('抓取失败：' + (e && e.message ? e.message : String(e)));
    }
    finishBtn.disabled = false;
    cancelBtn.disabled = false;
    finishBtn.textContent = '登录完成';
  }

  function doCancel() {
    var fns = api();
    finishBtn.disabled = true;
    cancelBtn.disabled = true;
    if (fns && typeof fns.toolbarCancel === 'function') {
      fns.toolbarCancel().catch(function () { /* 窗口即将关闭，忽略 */ });
    }
  }

  finishBtn.addEventListener('click', doFinish);
  cancelBtn.addEventListener('click', doCancel);
})();
