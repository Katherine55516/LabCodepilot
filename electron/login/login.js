/* global window, document */
// Login window controller — talks to the main process via window.electronAPI.auth.
// Kept dependency-free so a plain <script src> tag works without any bundler.

(function () {
  'use strict';

  const loginBtn = document.getElementById('login-btn');
  const statusEl = document.getElementById('status');

  // Skip button removed — login is mandatory. The HTML element and the
  // companion CSS still exist; restore the block below (and uncomment
  // the <button id="skip-btn"> in index.html) to bring it back.
  // const skipBtn = document.getElementById('skip-btn');
  // if (window.location.hash === '#allow-skip') {
  //   skipBtn.hidden = false;
  // }

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = kind || '';
  }

  function setBusy(busy) {
    loginBtn.disabled = busy;
    // skipBtn.disabled = busy;  // Restore alongside the skipBtn block above.
  }

  async function doLogin() {
    setBusy(true);
    setStatus('正在打开系统浏览器…', 'info');

    try {
      const api = window.electronAPI && window.electronAPI.auth;
      if (!api || typeof api.runLoginFlow !== 'function') {
        setStatus('登录入口未注入，请重启应用后再试', 'error');
        setBusy(false);
        return;
      }
      const res = await api.runLoginFlow();
      if (res && res.ok) {
        setStatus('✓ 登录成功，正在打开应用…', 'info');
        // The main process will close this window once the post-login
        // sequence (fetchMe / registerDevice / getConfigs) finishes.
      } else {
        setStatus('登录失败：' + (res && res.error ? res.error : '未知错误'), 'error');
        setBusy(false);
      }
    } catch (err) {
      setStatus('登录失败：' + (err && err.message ? err.message : String(err)), 'error');
      setBusy(false);
    }
  }

  // Skip handler removed — see comment near the top of this IIFE.
  // function doSkip() {
  //   setBusy(true);
  //   setStatus('已跳过登录，进入手动配置流程…', 'info');
  //   const api = window.electronAPI && window.electronAPI.auth;
  //   if (api && typeof api.skipLogin === 'function') {
  //     api.skipLogin().catch(() => { /* swallow */ });
  //   }
  // }

  loginBtn.addEventListener('click', doLogin);
  // skipBtn.addEventListener('click', doSkip);  // Restore with skipBtn above.
})();
