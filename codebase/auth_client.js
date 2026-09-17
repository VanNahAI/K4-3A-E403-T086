/**
 * Client-side session helper for lecturer authentication.
 *
 * The actual secret is configured on the server through
 * LECTURER_ACCESS_TOKEN. It is kept only for the current browser session and
 * is never placed in the URL.
 */
(function () {
  const STORAGE_KEY = 'curator_lecturer_token';

  function readToken() {
    try {
      return String(sessionStorage.getItem(STORAGE_KEY) || '').trim();
    } catch (error) {
      return '';
    }
  }

  function saveToken(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return '';

    try {
      sessionStorage.setItem(STORAGE_KEY, normalized);
    } catch (error) {
      console.warn('Không thể lưu mã giảng viên cho phiên hiện tại.');
    }
    return normalized;
  }

  function getLecturerToken(promptIfMissing = false) {
    let token = readToken();
    if (!token && promptIfMissing) {
      token = saveToken(window.prompt('Nhập mã truy cập giảng viên:'));
    }
    return token;
  }

  function getLecturerHeaders(promptIfMissing = false) {
    const token = getLecturerToken(promptIfMissing);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function clearLecturerToken() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Ignore storage cleanup errors.
    }
  }

  window.curatorAuth = {
    getLecturerToken,
    getLecturerHeaders,
    saveLecturerToken: saveToken,
    clearLecturerToken
  };
})();
