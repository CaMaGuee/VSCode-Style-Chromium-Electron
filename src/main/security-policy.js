/**
 * @file security-policy.js
 * @description 중앙 Chromium 브라우저 및 IPC 통신을 위한 엄격한 보안 정책 모듈.
 * 원격 콘텐츠로부터 로컬 시스템(파일 시스템, 터미널, 권한 등)을 보호하기 위한 경계를 정의합니다.
 */

const { URL } = require('url');

/**
 * 중앙 Chromium 브라우저에서 허용되는 네비게이션 URL인지 검증합니다.
 * 위험 scheme(file:, javascript:, data:, blob: 등)을 즉시 차단하고,
 * http:, https:, about:blank 만 허용합니다. (localhost 및 127.0.0.1의 http 접속 허용)
 * @param {string} urlString 
 * @returns {boolean}
 */
function isAllowedNavigationUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  
  const trimmed = urlString.trim().toLowerCase();

  // 위험 scheme 사전 즉시 차단
  if (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('ftp:') ||
    trimmed.startsWith('vbscript:')
  ) {
    return false;
  }

  // about:blank는 빈 페이지 허용
  if (trimmed === 'about:blank') return true;

  try {
    const parsed = new URL(urlString);
    const protocol = parsed.protocol;

    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 초기 앱 설정의 startUrl 검증
 * @param {string} urlString 
 * @returns {boolean}
 */
function isAllowedStartUrl(urlString) {
  return isAllowedNavigationUrl(urlString);
}

/**
 * 팝업(window.open) 요청 차단 정책
 * 중앙 웹페이지가 임의로 새 창이나 팝업을 띄우는 것을 원천 차단합니다.
 * @returns {object}
 */
function shouldAllowPopup() {
  return { action: 'deny' };
}

/**
 * 세션 권한 요청 정책 등록
 * 카메라, 마이크, 위치정보, 알림 등 민감한 권한 요청을 기본 거부합니다.
 * @param {import('electron').Session} session 
 */
function registerPermissionPolicy(session) {
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    // 모든 권한 요청 기본 거부
    callback(false);
  });

  session.setPermissionCheckHandler((webContents, permission) => {
    return false;
  });
}

/**
 * 중앙 WebContents의 window.open 핸들러 등록
 * @param {import('electron').WebContents} webContents 
 */
function registerWindowOpenHandler(webContents) {
  webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

/**
 * IPC 메시지 발신자 검증
 * 중앙 Chromium(원격 콘텐츠)이 Shell IPC 핸들러를 호출하는 것을 원천 차단합니다.
 * 오직 Shell UI의 WebContents(shellWebContents)에서 온 요청만 허용합니다.
 * @param {import('electron').IpcMainInvokeEvent} event 
 * @param {import('electron').WebContents} shellWebContents 
 * @returns {boolean}
 */
function validateIpcSender(event, shellWebContents) {
  if (!shellWebContents || !event.sender) {
    return false;
  }
  return event.sender.id === shellWebContents.id;
}

module.exports = {
  isAllowedNavigationUrl,
  isAllowedStartUrl,
  shouldAllowPopup,
  registerPermissionPolicy,
  registerWindowOpenHandler,
  validateIpcSender
};

