/**
 * @file browser-controller.js
 * @description 중앙 영역의 Chromium 브라우저(WebContentsView) 생명주기 및 네비게이션 제어 모듈.
 * 주소 정규화 및 위험 scheme 차단, 뒤로/앞으로/새로고침, DevTools, 브라우저 상태 이벤트 전송을 담당합니다.
 */

const { WebContentsView, session } = require('electron');
const securityPolicy = require('./security-policy');

class BrowserController {
  constructor(getShellWebContents, onStatusChanged) {
    this.getShellWebContents = getShellWebContents;
    this.onStatusChanged = onStatusChanged;

    // 중앙 브라우저용 WebContentsView 생성 (보안 격리 적용)
    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        // 중앙 외부 페이지에는 절대 preload를 제공하지 않음
      }
    });

    this.setupSecurityAndListeners();
  }

  setupSecurityAndListeners() {
    const wc = this.view.webContents;

    // 팝업 및 창 열기 차단
    securityPolicy.registerWindowOpenHandler(wc);

    // 네비게이션 정책 적용 (허용되지 않은 프로토콜 차단)
    wc.on('will-navigate', (event, navigationUrl) => {
      if (!securityPolicy.isAllowedNavigationUrl(navigationUrl)) {
        event.preventDefault();
        console.warn(`[BrowserController] 차단된 네비게이션 시도: ${navigationUrl}`);
        if (this.onStatusChanged) {
          this.onStatusChanged(`차단된 URL 이동 시도: ${navigationUrl}`);
        }
      }
    });

    // 페이지 제목 또는 URL 변경 시 Shell Renderer에 브라우저 상태 전송
    wc.on('did-navigate', (event, url) => {
      this.broadcastBrowserState();
    });

    wc.on('did-navigate-in-page', (event, url) => {
      this.broadcastBrowserState();
    });

    wc.on('page-title-updated', (event, title) => {
      this.broadcastBrowserState();
      if (this.onStatusChanged) {
        this.onStatusChanged(`페이지 로드됨: ${title}`);
      }
    });

    wc.on('did-start-loading', () => {
      this.broadcastBrowserState();
    });

    wc.on('did-stop-loading', () => {
      this.broadcastBrowserState();
    });
  }

  /**
   * URL 정규화 처리 및 위험 scheme 사전 차단
   * - file:, javascript:, data:, blob: 등 입력 시 즉시 차단 (빈 문자열 반환)
   * - http:, https:, about:blank 허용
   * - localhost, 127.0.0.1 및 IP 접속은 http:// 부여
   * - 일반 도메인은 https:// 부여
   * @param {string} input
   * @returns {string}
   */
  normalizeUrl(input) {
    if (!input || typeof input !== 'string') return '';
    let trimmed = input.trim();
    if (!trimmed) return '';

    const lower = trimmed.toLowerCase();

    // 위험 scheme 입력 시 즉시 거부
    if (
      lower.startsWith('file:') ||
      lower.startsWith('javascript:') ||
      lower.startsWith('data:') ||
      lower.startsWith('blob:') ||
      lower.startsWith('ftp:') ||
      lower.startsWith('vbscript:')
    ) {
      return '';
    }

    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('about:blank')) {
      return trimmed;
    }

    if (lower.startsWith('localhost') || lower.startsWith('127.0.0.1') || /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(lower)) {
      return `http://${trimmed}`;
    }

    return `https://${trimmed}`;
  }

  /**
   * 중앙 브라우저 URL 이동
   * @param {string} rawUrl
   */
  navigate(rawUrl) {
    const normalized = this.normalizeUrl(rawUrl);
    if (!normalized || !securityPolicy.isAllowedNavigationUrl(normalized)) {
      if (this.onStatusChanged) this.onStatusChanged(`차단되거나 유효하지 않은 URL입니다: ${rawUrl}`);
      return;
    }

    try {
      this.view.webContents.loadURL(normalized);
    } catch (err) {
      console.error('[BrowserController] 네비게이션 오류:', err);
      if (this.onStatusChanged) this.onStatusChanged(`URL 로드 실패: ${err.message}`);
    }
  }

  goBack() {
    const history = this.view.webContents.navigationHistory;
    if (history && history.canGoBack()) {
      history.goBack();
    }
  }

  goForward() {
    const history = this.view.webContents.navigationHistory;
    if (history && history.canGoForward()) {
      history.goForward();
    }
  }

  reload() {
    this.view.webContents.reload();
  }

  openDevTools() {
    this.view.webContents.openDevTools({ mode: 'detach' });
  }

  /**
   * 현재 브라우저 상태 객체 반환
   * @returns {object}
   */
  getBrowserState() {
    const wc = this.view.webContents;
    const history = wc.navigationHistory;
    return {
      url: wc.getURL() || '',
      title: wc.getTitle() || '',
      canGoBack: history ? history.canGoBack() : false,
      canGoForward: history ? history.canGoForward() : false,
      isLoading: wc.isLoading()
    };
  }

  /**
   * Shell Renderer로 브라우저 상태 브로드캐스트
   */
  broadcastBrowserState() {
    const shellWc = this.getShellWebContents();
    if (shellWc && !shellWc.isDestroyed()) {
      shellWc.send('browser:state-changed', this.getBrowserState());
    }
  }

  getView() {
    return this.view;
  }
}

module.exports = BrowserController;

