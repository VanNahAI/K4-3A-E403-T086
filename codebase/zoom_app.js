/**
 * Native Zoom Apps bootstrap.
 *
 * The host is routed to the compact CP3 lecturer companion at
 * /zoom-app/lecturer. Native Zoom chat messages still arrive server-side
 * through the signed Zoom webhook; this file authenticates the Host and binds
 * the companion to the current Zoom meeting.
 */
(function () {
  const ZOOM_APP_CAPABILITIES = [
    'getRunningContext',
    'getUserContext',
    'getMeetingContext',
    'getAppContext'
  ];

  function showRuntimeStatus(message, isError = false) {
    const container = document.getElementById('zoom-app-runtime');
    const text = document.getElementById('zoom-app-runtime-text');
    if (!container || !text) return;

    container.classList.remove('hidden');
    container.classList.toggle('error', isError);
    text.textContent = message;
  }

  function isZoomClientRequest() {
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname.startsWith('/zoom-app/')) {
      return window.location.pathname === '/zoom-app/lecturer';
    }
    return /ZoomApps/i.test(navigator.userAgent) ||
      params.get('zoom_app') === '1' ||
      params.has('runningContext') ||
      window.location.pathname === '/zoom-app/lecturer';
  }

  async function ensureLecturerSession(meeting) {
    const headers = window.curatorAuth?.getLecturerHeaders(false) || {};
    if (!headers.Authorization) {
      throw new Error('Thiếu mã truy cập giảng viên để mở phiên lọc câu hỏi.');
    }

    // Keep the webhook filter tied to the real meeting currently hosting the
    // Zoom App instead of a meeting ID left over from a previous demo.
    if (meeting?.meetingID) {
      const configResponse = await fetch('/api/config-zoom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          meetingId: meeting.meetingID,
          topic: meeting.meetingTopic || undefined
        })
      });
      if (!configResponse.ok) {
        const configError = await configResponse.json().catch(() => ({}));
        throw new Error(configError.message || 'Không thể đồng bộ Meeting ID với webhook.');
      }
    }

    const current = await fetch('/api/session/state').then(response => response.json());
    if (current.isOpen) return current;

    const response = await fetch('/api/session/start', {
      method: 'POST',
      headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Không thể mở phiên lọc câu hỏi.');
    }
    return payload.session;
  }

  async function establishZoomLecturerSession() {
    const appContext = await window.zoomSdk.getAppContext();
    const response = await fetch('/api/zoom/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: appContext.context })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token) {
      throw new Error(payload.message || 'Không xác thực được Host từ Zoom.');
    }
    window.curatorAuth?.saveLecturerToken(payload.token);
    window.dispatchEvent(new CustomEvent('curator:zoom-auth-ready'));
  }

  async function initializeZoomApp() {
    if (!isZoomClientRequest()) return;

    document.body.classList.add('zoom-app-context');
    showRuntimeStatus('Đang kết nối với Zoom Meeting…');

    if (!window.zoomSdk) {
      showRuntimeStatus('Không tải được Zoom Apps SDK.', true);
      throw new Error('Không tải được Zoom Apps SDK.');
    }

    try {
      const config = await window.zoomSdk.config({
        version: '0.16',
        popoutSize: { width: 480, height: 720 },
        capabilities: ZOOM_APP_CAPABILITIES
      });

      const runningContext = config.runningContext ||
        (await window.zoomSdk.getRunningContext()).runningContext;

      if (runningContext !== 'inMeeting') {
        throw new Error('Hãy vào một Zoom Meeting rồi mở lại Curator AI.');
      }

      const user = await window.zoomSdk.getUserContext();
      const role = String(user.role || '').toLowerCase();
      const isLecturer = role === 'host' || role === 'cohost';

      if (!isLecturer) {
        throw new Error('Tài khoản này không phải Host/Co-host của Meeting.');
      }

      await establishZoomLecturerSession();
      const meeting = await window.zoomSdk.getMeetingContext().catch(() => ({}));
      await ensureLecturerSession(meeting);

      if (typeof window.goToScreen === 'function') {
        window.goToScreen(1);
      }

      const topic = meeting.meetingTopic ? ` · ${meeting.meetingTopic}` : '';
      showRuntimeStatus(`Đang chạy trong Zoom · ${user.screenName || 'Giảng viên'}${topic}`);
      return {
        screenName: String(user.screenName || '').trim() || 'Giảng viên Zoom',
        role,
        meetingID: meeting.meetingID || null,
        meetingTopic: meeting.meetingTopic || ''
      };
    } catch (error) {
      console.error('Zoom Apps initialization failed:', error);
      showRuntimeStatus(error.message || 'Không thể kết nối Zoom Apps SDK.', true);
      throw error;
    }
  }

  if (isZoomClientRequest()) {
    window.curatorZoomLecturerReady = new Promise((resolve, reject) => {
      const start = () => initializeZoomApp().then(resolve, reject);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    });
  } else {
    window.curatorZoomLecturerReady = Promise.resolve(null);
  }
})();
