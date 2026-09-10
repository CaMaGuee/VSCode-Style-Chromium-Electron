/**
 * @file layout-controller.js
 * @description Electron BaseWindow 생성, Shell UI WebContentsView와 중앙 Chromium WebContentsView의
 * 배치(Bounds 계산) 및 창 크기 변경/저장을 관리하는 모듈.
 */

const { BaseWindow, WebContentsView } = require('electron');
const path = require('path');
const LAYOUT_CONSTANTS = require('./layout-constants');

class LayoutController {
  constructor(storageController, browserController) {
    this.storage = storageController;
    this.browserController = browserController;

    const winState = this.storage.getWindowState();

    // BaseWindow 생성 (최소 크기 1200x720)
    this.window = new BaseWindow({
      width: winState.width,
      height: winState.height,
      minWidth: LAYOUT_CONSTANTS.MIN_WINDOW_WIDTH,
      minHeight: LAYOUT_CONSTANTS.MIN_WINDOW_HEIGHT,
      title: 'Chromium Workbench'
    });

    // Shell UI용 WebContentsView 생성 (preload.js 연결)
    this.shellView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });

    // 창에 뷰 부착 (ShellView를 먼저 추가하고, 중앙 BrowserView를 그 위에 배치)
    this.window.contentView.addChildView(this.shellView);
    this.window.contentView.addChildView(this.browserController.getView());

    // 초기 레이아웃 동기 즉시 적용
    this.updateLayout();

    // Shell UI HTML 로드
    this.shellView.webContents.loadFile(path.join(__dirname, '../renderer/index.html'));

    // 창 크기 변경 이벤트 처리
    const handleResize = () => {
      this.updateLayout();
      this.saveCurrentWindowState();
    };

    this.window.on('resize', handleResize);
    this.window.on('maximize', handleResize);
    this.window.on('unmaximize', handleResize);

    this.window.on('close', () => {
      this.saveCurrentWindowState();
    });

    // 창 로드 완료 후 정확한 계산을 위해 틱 지연 후 한 번 더 보정
    setTimeout(() => {
      this.updateLayout();
    }, 100);
  }

  /**
   * 창 크기에 맞춰 ShellView와 중앙 BrowserView의 bounds를 계산하고 재배치합니다.
   * WebContentsView bounds는 content area 기준이므로 getContentBounds()를 사용합니다.
   * 레이아웃 규격:
   * - 상단 네비게이션: 52px
   * - 좌측 패널: 240px
   * - 우측 패널: 320px
   * - 하단 터미널: 250px
   */
  updateLayout() {
    if (!this.window || this.window.isDestroyed()) return;

    const contentBounds = this.window.getContentBounds();

    // 1. Shell UI WebContentsView는 content area 전체 크기를 차지
    this.shellView.setBounds({
      x: 0,
      y: 0,
      width: contentBounds.width,
      height: contentBounds.height
    });

    // 2. 중앙 Chromium WebContentsView 좌표 및 크기 계산 (단일 Source of Truth)
    const centerX = LAYOUT_CONSTANTS.LEFT_PANEL_WIDTH;
    const centerY = LAYOUT_CONSTANTS.TOP_BAR_HEIGHT;

    const centerWidth = Math.max(
      LAYOUT_CONSTANTS.MIN_BROWSER_WIDTH,
      contentBounds.width - LAYOUT_CONSTANTS.LEFT_PANEL_WIDTH - LAYOUT_CONSTANTS.RIGHT_PANEL_WIDTH
    );

    const centerHeight = Math.max(
      LAYOUT_CONSTANTS.MIN_BROWSER_HEIGHT,
      contentBounds.height - LAYOUT_CONSTANTS.TOP_BAR_HEIGHT - LAYOUT_CONSTANTS.TERMINAL_HEIGHT
    );

    this.browserController.getView().setBounds({
      x: centerX,
      y: centerY,
      width: centerWidth,
      height: centerHeight
    });
  }

  saveCurrentWindowState() {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getContentBounds();
    const currentBrowserState = this.browserController.getBrowserState();

    this.storage.saveWindowState({
      width: bounds.width,
      height: bounds.height,
      lastUrl: currentBrowserState.url || 'https://example.com'
    });
  }

  getWindow() {
    return this.window;
  }

  getShellWebContents() {
    if (this.shellView && !this.shellView.webContents.isDestroyed()) {
      return this.shellView.webContents;
    }
    return null;
  }
}

module.exports = LayoutController;

