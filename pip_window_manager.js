/**
 * Curator AI — shared Document Picture-in-Picture window manager.
 *
 * The regular companion window remains the owner of the always-on-top window.
 * A same-origin iframe runs the actual companion inside Document PiP so the
 * existing student/lecturer controllers can keep using their own `document`.
 */
(function initializePipWindowManager() {
  'use strict';

  const STATE_PREFIX = 'curator_pip_handoff_';
  const READY_TIMEOUT_MS = 8000;
  const params = new URLSearchParams(window.location.search);
  const isPinnedFrame = params.get('pinned') === '1';
  const handoffToken = params.get('handoff') || '';

  let pinnedWindow = null;
  let pinnedFrame = null;
  let readyTimer = null;
  let closeHandled = false;
  let originalWindowSize = null;

  function getAdapter() {
    return window.curatorCompanionAdapter || null;
  }

  function getStateKey(token) {
    return `${STATE_PREFIX}${token}`;
  }

  function showPipMessage(message) {
    if (typeof window.showNotificationToast === 'function') {
      window.showNotificationToast(message);
      return;
    }
    window.alert(message);
  }

  function isEmbeddedCompanion() {
    return window.top !== window;
  }

  function getPipOwnerWindow() {
    if (!isEmbeddedCompanion()) return window;
    try {
      // The /room iframe is same-origin. User activation from a click inside
      // the iframe also activates its ancestors, allowing the room itself to
      // own the Document PiP window without an intermediate popup.
      void window.top.document;
      return window.top;
    } catch (error) {
      console.warn('Could not access the top-level PiP owner:', error);
      return null;
    }
  }

  function describePipError(error, ownerWindow = window) {
    const errorName = error?.name || 'Error';

    if (!ownerWindow.isSecureContext) {
      return 'Không thể ghim vì trang chưa chạy trong ngữ cảnh an toàn. Hãy mở bằng http://localhost:3000 (không dùng địa chỉ IP LAN) hoặc HTTPS.';
    }
    if (errorName === 'NotAllowedError') {
      return 'Trình duyệt không cho phép ghim. Hãy đặt cửa sổ trợ lý lên trước rồi bấm “Ghim” trực tiếp; đồng thời kiểm tra Picture-in-Picture không bị tắt trong cài đặt trình duyệt.';
    }
    if (errorName === 'NotSupportedError') {
      return 'Document Picture-in-Picture đang bị tắt hoặc không được trình duyệt hỗ trợ. Hãy bật tính năng này hoặc dùng Chrome/Edge bản mới.';
    }
    return `Không thể ghim cửa sổ (${errorName}). Pop-up thường vẫn tiếp tục hoạt động.`;
  }

  function saveHandoffState(token) {
    const adapter = getAdapter();
    if (!adapter || !token) return false;

    try {
      localStorage.setItem(getStateKey(token), JSON.stringify({
        savedAt: Date.now(),
        state: adapter.exportState()
      }));
      return true;
    } catch (error) {
      console.warn('Could not save companion PiP state:', error);
      return false;
    }
  }

  function readHandoffState(token) {
    if (!token) return null;
    try {
      const raw = localStorage.getItem(getStateKey(token));
      if (!raw) return null;
      const payload = JSON.parse(raw);
      return payload && payload.state ? payload.state : null;
    } catch (error) {
      console.warn('Could not restore companion PiP state:', error);
      return null;
    }
  }

  function removeHandoffState(token) {
    if (!token) return;
    try {
      localStorage.removeItem(getStateKey(token));
    } catch (error) {
      console.warn('Could not clean companion PiP state:', error);
    }
  }

  function cleanupExpiredHandoffs() {
    const expiry = Date.now() - (24 * 60 * 60 * 1000);
    try {
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith(STATE_PREFIX)) return;
        try {
          const payload = JSON.parse(localStorage.getItem(key));
          if (!payload?.savedAt || payload.savedAt < expiry) localStorage.removeItem(key);
        } catch (error) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Could not clean expired companion PiP state:', error);
    }
  }

  function createControllerView() {
    if (document.getElementById('curator-pip-controller')) return;

    const style = document.createElement('style');
    style.id = 'curator-pip-controller-style';
    style.textContent = `
      body.curator-pip-controller-mode > :not(#curator-pip-controller):not(#curator-pip-controller-style) {
        display: none !important;
      }
      #curator-pip-controller {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 18px;
        box-sizing: border-box;
        background: radial-gradient(circle at top, #1e1b4b, #0b0f19 72%);
        color: #f8fafc;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        text-align: center;
      }
      #curator-pip-controller strong { font-size: 0.95rem; }
      #curator-pip-controller span { color: #94a3b8; font-size: 0.75rem; }
      .curator-pip-controller-actions { display: flex; gap: 8px; }
      .curator-pip-controller-actions button {
        min-height: 44px;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 8px 12px;
        background: #1e293b;
        color: #f8fafc;
        cursor: pointer;
        font-weight: 700;
      }
      .curator-pip-controller-actions button:last-child {
        background: #4f46e5;
        border-color: #6366f1;
      }
    `;
    document.head.appendChild(style);

    const controller = document.createElement('div');
    controller.id = 'curator-pip-controller';
    controller.innerHTML = `
      <div style="font-size: 1.5rem;">📌</div>
      <strong>Trợ lý đang được ghim</strong>
      <span>Cửa sổ này duy trì kết nối cho Picture-in-Picture.</span>
      <div class="curator-pip-controller-actions">
        <button type="button" id="btn-focus-pinned">Hiện PiP</button>
        <button type="button" id="btn-unpin-companion">Bỏ ghim</button>
      </div>
    `;
    document.body.appendChild(controller);
    document.body.classList.add('curator-pip-controller-mode');

    controller.querySelector('#btn-focus-pinned').addEventListener('click', () => {
      if (pinnedWindow && !pinnedWindow.closed) pinnedWindow.focus();
    });
    controller.querySelector('#btn-unpin-companion').addEventListener('click', () => {
      if (pinnedFrame && pinnedFrame.contentWindow) {
        pinnedFrame.contentWindow.postMessage({
          type: 'curator-pip-save-request',
          token: handoffToken || pinnedFrame.dataset.handoffToken
        }, window.location.origin);
      }
      setTimeout(() => {
        if (pinnedWindow && !pinnedWindow.closed) pinnedWindow.close();
      }, 100);
    });

    originalWindowSize = {
      width: window.outerWidth,
      height: window.outerHeight
    };
    try {
      window.resizeTo(360, 210);
    } catch (error) {
      console.debug('Browser did not allow resizing the controller window:', error);
    }
  }

  function restoreRegularWindow(token) {
    if (closeHandled) return;
    closeHandled = true;
    clearTimeout(readyTimer);

    setTimeout(() => {
      const adapter = getAdapter();
      const latestState = readHandoffState(token);
      if (adapter) {
        if (latestState) adapter.restoreState(latestState);
        adapter.resume();
      }

      document.body.classList.remove('curator-pip-controller-mode');
      document.getElementById('curator-pip-controller')?.remove();
      document.getElementById('curator-pip-controller-style')?.remove();

      if (originalWindowSize) {
        try {
          window.resizeTo(originalWindowSize.width, originalWindowSize.height);
        } catch (error) {
          console.debug('Browser did not allow restoring the companion size:', error);
        }
      }

      removeHandoffState(token);
      pinnedWindow = null;
      pinnedFrame = null;
    }, 150);
  }

  function initializePinnedFrame() {
    const pinButton = document.getElementById('btn-pin-companion');
    if (pinButton) pinButton.classList.add('hidden');

    const adapter = getAdapter();
    const restoredState = readHandoffState(handoffToken);
    if (adapter && restoredState) adapter.restoreState(restoredState);

    const notifyOwnerReady = () => {
      window.parent.postMessage({
        type: 'curator-pip-ready',
        token: handoffToken
      }, window.location.origin);
    };

    window.addEventListener('curator:connection-ready', notifyOwnerReady, { once: true });
    if (adapter && adapter.isConnected()) notifyOwnerReady();

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'curator-pip-save-request' || event.data.token !== handoffToken) return;
      saveHandoffState(handoffToken);
      window.parent.postMessage({
        type: 'curator-pip-state-saved',
        token: handoffToken
      }, window.location.origin);
    });

    window.addEventListener('pagehide', () => saveHandoffState(handoffToken));
  }

  async function pinCompanionWindow() {
    if (isPinnedFrame || pinnedWindow) return;

    const ownerWindow = getPipOwnerWindow();
    if (!ownerWindow) {
      showPipMessage('Không thể truy cập cửa sổ phòng họp để ghim trợ lý.');
      return;
    }

    if (!ownerWindow.isSecureContext) {
      showPipMessage('Không thể ghim vì trang chưa chạy trong ngữ cảnh an toàn. Hãy mở bằng http://localhost:3000 (không dùng địa chỉ IP LAN) hoặc HTTPS.');
      return;
    }

    if (!('documentPictureInPicture' in ownerWindow)) {
      showPipMessage('Trình duyệt chưa hỗ trợ ghim tự động. Vui lòng dùng Chrome hoặc Edge phiên bản mới.');
      return;
    }

    const adapter = getAdapter();
    if (!adapter) {
      showPipMessage('Trợ lý chưa sẵn sàng. Vui lòng thử lại sau vài giây.');
      return;
    }

    const token = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    if (!saveHandoffState(token)) {
      showPipMessage('Không thể lưu trạng thái trợ lý để ghim.');
      return;
    }

    const role = adapter.getRole();
    const width = role === 'student' ? 900 : 430;
    const height = 720;
    closeHandled = false;

    try {
      // Keep the first request maximally compatible. Unknown/experimental
      // option members have caused some Chromium builds and policies to reject
      // the whole request even though basic Document PiP is available.
      pinnedWindow = await ownerWindow.documentPictureInPicture.requestWindow({ width, height });

      const pipDocument = pinnedWindow.document;
      pipDocument.title = `Curator AI — ${role === 'student' ? 'Học viên' : 'Giảng viên'}`;
      pipDocument.documentElement.style.cssText = 'width:100%;height:100%;margin:0;background:#0b0f19;';
      pipDocument.body.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden;background:#0b0f19;';

      pinnedFrame = pipDocument.createElement('iframe');
      pinnedFrame.title = 'Curator AI pinned companion';
      pinnedFrame.dataset.handoffToken = token;
      pinnedFrame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#0b0f19;';

      const pinnedUrl = new URL(window.location.href);
      pinnedUrl.searchParams.set('pinned', '1');
      pinnedUrl.searchParams.set('handoff', token);
      pinnedFrame.src = pinnedUrl.toString();
      pipDocument.body.appendChild(pinnedFrame);

      const onPinnedMessage = (event) => {
        if (event.origin !== window.location.origin || event.source !== pinnedFrame.contentWindow) return;
        if (event.data?.token !== token) return;

        if (event.data.type === 'curator-pip-ready') {
          clearTimeout(readyTimer);
          adapter.suspend();
          createControllerView();
        } else if (event.data.type === 'curator-pip-state-saved') {
          if (pinnedWindow && !pinnedWindow.closed) pinnedWindow.close();
        }
      };
      pinnedWindow.addEventListener('message', onPinnedMessage);
      pinnedWindow.addEventListener('pagehide', () => restoreRegularWindow(token), { once: true });

      readyTimer = setTimeout(() => {
        if (pinnedWindow && !pinnedWindow.closed) pinnedWindow.close();
        removeHandoffState(token);
        pinnedWindow = null;
        pinnedFrame = null;
        showPipMessage('Không thể kết nối cửa sổ ghim. Pop-up thường vẫn được giữ nguyên.');
      }, READY_TIMEOUT_MS);
    } catch (error) {
      console.warn('Document Picture-in-Picture request failed:', error);
      removeHandoffState(token);
      pinnedWindow = null;
      pinnedFrame = null;
      showPipMessage(describePipError(error, ownerWindow));
    }
  }

  function closeCompanionWindow() {
    if (isPinnedFrame && window.parent !== window) {
      saveHandoffState(handoffToken);
      window.parent.close();
      return;
    }
    window.close();
  }

  window.pinCompanionWindow = pinCompanionWindow;
  window.closeCompanionWindow = closeCompanionWindow;

  cleanupExpiredHandoffs();
  window.addEventListener('DOMContentLoaded', () => {
    if (isPinnedFrame) initializePinnedFrame();
  });
})();
