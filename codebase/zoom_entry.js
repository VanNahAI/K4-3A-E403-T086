(function () {
  const CAPABILITIES = ['getRunningContext', 'getUserContext'];

  function normalizeRole(role) {
    return String(role || '').toLowerCase().replace(/[\s_-]/g, '');
  }

  function destinationForRole(role) {
    const normalized = normalizeRole(role);
    return normalized === 'host' || normalized === 'cohost'
      ? '/zoom-app/lecturer?zoom_app=1'
      : '/zoom-app/student?zoom_app=1';
  }

  function showError(message) {
    const status = document.getElementById('zoom-entry-status');
    const spinner = document.getElementById('zoom-entry-spinner');
    if (status) {
      status.textContent = message;
      status.classList.add('error');
    }
    if (spinner) spinner.hidden = true;
  }

  async function routeZoomUser() {
    if (!window.zoomSdk) {
      showError('Không tải được Zoom Apps SDK. Hãy mở ứng dụng từ Zoom Workplace.');
      return;
    }

    try {
      const configured = await window.zoomSdk.config({
        version: '0.16',
        popoutSize: { width: 480, height: 720 },
        capabilities: CAPABILITIES
      });
      const runningContext = configured.runningContext ||
        (await window.zoomSdk.getRunningContext()).runningContext;
      if (runningContext !== 'inMeeting') {
        showError('Hãy tham gia một Zoom Meeting rồi mở lại Curator AI.');
        return;
      }

      const user = await window.zoomSdk.getUserContext();
      window.location.replace(destinationForRole(user.role));
    } catch (error) {
      console.error('Zoom role routing failed:', error);
      showError(error.message || 'Không xác định được vai trò trong Zoom Meeting.');
    }
  }

  window.curatorZoomRole = { normalizeRole, destinationForRole };
  document.addEventListener('DOMContentLoaded', routeZoomUser);
})();
