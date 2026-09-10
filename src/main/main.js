/**
 * @file main.js
 * @description Electron Main Process 진입점. 앱 생명주기 관리 및 보안 검증된 IPC 핸들러 등록.
 */

const { app, ipcMain, session } = require('electron');
const StorageController = require('./storage-controller');
const ThemeController = require('./theme-controller');
const BrowserController = require('./browser-controller');
const TerminalController = require('./terminal-controller');
const LayoutController = require('./layout-controller');
const securityPolicy = require('./security-policy');

let storageController = null;
let themeController = null;
let browserController = null;
let terminalController = null;
let layoutController = null;

app.whenReady().then(() => {
  // 다운로드 정책 설정: 중앙 브라우저에서 발생하는 다운로드 기본 차단
  session.defaultSession.on('will-download', (event, item, webContents) => {
    if (browserController && webContents.id === browserController.getView().webContents.id) {
      event.preventDefault();
      const filename = item.getFilename();
      console.warn(`[SecurityPolicy] 중앙 브라우저 다운로드 차단됨: ${filename}`);
      const shellWc = layoutController ? layoutController.getShellWebContents() : null;
      if (shellWc && !shellWc.isDestroyed()) {
        shellWc.send('status:changed', `다운로드 차단됨: ${filename} (MVP 보안 정책)`);
      }
    }
  });


  securityPolicy.registerPermissionPolicy(session.defaultSession);

  storageController = new StorageController();

  browserController = new BrowserController(
    () => layoutController ? layoutController.getShellWebContents() : null,
    (statusMsg) => {
      const shellWc = layoutController ? layoutController.getShellWebContents() : null;
      if (shellWc && !shellWc.isDestroyed()) shellWc.send('status:changed', statusMsg);
    }
  );

  layoutController = new LayoutController(storageController, browserController);

  themeController = new ThemeController(
    storageController,
    () => layoutController ? layoutController.getShellWebContents() : null
  );

  terminalController = new TerminalController(
    () => layoutController ? layoutController.getShellWebContents() : null
  );

  // Diagnostic shortcut to open Shell UI DevTools (dev mode only)
  if (!app.isPackaged) {
    const { globalShortcut } = require('electron');
    const shortcut = process.platform === 'darwin'
      ? 'Command+Option+Shift+I'
      : 'Ctrl+Alt+Shift+I';
    const ret = globalShortcut.register(shortcut, () => {
      try {
        const shellWc = layoutController ? layoutController.getShellWebContents() : null;
        if (shellWc && !shellWc.isDestroyed()) {
          shellWc.openDevTools({ mode: 'detach' });
        }
      } catch (e) {
        console.error('[Diagnostic] Shortcut error:', e);
      }
    });
    if (!ret) {
      console.error(`[Diagnostic] Failed to register shortcut ${shortcut}`);
    }
    app.on('will-quit', () => {
      globalShortcut.unregister(shortcut);
    });
  }

  const winState = storageController.getWindowState();
  const settings = storageController.getSettings();
  const initialUrl = winState.lastUrl || settings.startUrl || 'https://example.com';
  browserController.navigate(initialUrl);

  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  if (terminalController) terminalController.destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (terminalController) terminalController.destroy();
});

function registerIpcHandlers() {
  const getShellWc = () => layoutController ? layoutController.getShellWebContents() : null;
  const withSecurityCheck = (handler) => async (event, ...args) => {
    if (!securityPolicy.validateIpcSender(event, getShellWc())) {
      throw new Error('Unauthorized IPC sender');
    }
    return await handler(event, ...args);
  };

  ipcMain.handle('browser:navigate', withSecurityCheck(async (_, url) => {
    if (typeof url !== 'string') throw new Error('Invalid URL');
    browserController.navigate(url);
  }));

  ipcMain.handle('browser:go-back', withSecurityCheck(async () => browserController.goBack()));
  ipcMain.handle('browser:go-forward', withSecurityCheck(async () => browserController.goForward()));
  ipcMain.handle('browser:reload', withSecurityCheck(async () => browserController.reload()));
  ipcMain.handle('browser:open-dev-tools', withSecurityCheck(async () => browserController.openDevTools()));
  ipcMain.handle('browser:get-state', withSecurityCheck(async () => browserController.getBrowserState()));

  ipcMain.handle('bookmark:get-all', withSecurityCheck(async () => storageController.getBookmarks()));
  ipcMain.handle('bookmark:add-current', withSecurityCheck(async () => {
    const state = browserController.getBrowserState();
    const url = state.url;
    if (!securityPolicy.isAllowedNavigationUrl(url)) throw new Error('유효하지 않은 URL');
    const title = state.title || url;
    const bookmarks = storageController.getBookmarks();
    if (bookmarks.some(b => b.url === url)) return { success: false, message: '이미 존재하는 북마크' };
    const newBookmark = {
      id: 'bm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      title: title.trim(),
      url: url.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    bookmarks.push(newBookmark);
    storageController.saveBookmarks(bookmarks);
    return { success: true, bookmark: newBookmark };
  }));

  ipcMain.handle('bookmark:delete', withSecurityCheck(async (_, id) => {
    if (typeof id !== 'string') throw new Error('Invalid ID');
    let bookmarks = storageController.getBookmarks();
    bookmarks = bookmarks.filter(b => b.id !== id);
    storageController.saveBookmarks(bookmarks);
    return { success: true };
  }));

  ipcMain.handle('memo:get', withSecurityCheck(async (_, url) => {
    if (typeof url !== 'string') throw new Error('Invalid URL');
    return storageController.getMemo(url);
  }));

  ipcMain.handle('memo:save', withSecurityCheck(async (_, { url, content }) => {
    if (typeof url !== 'string' || typeof content !== 'string') throw new Error('Invalid params');
    storageController.saveMemo(url, content);
    return { success: true };
  }));

  ipcMain.handle('memo:delete', withSecurityCheck(async (_, url) => {
    if (typeof url !== 'string') throw new Error('Invalid URL');
    storageController.deleteMemo(url);
    return { success: true };
  }));

  ipcMain.handle('theme:get-state', withSecurityCheck(async () => themeController.getThemeState()));
  ipcMain.handle('theme:set-mode', withSecurityCheck(async (_, mode) => {
    if (!['system', 'dark', 'light'].includes(mode)) throw new Error('Invalid theme mode');
    return themeController.setThemeMode(mode);
  }));

  ipcMain.handle('terminal:input', withSecurityCheck(async (_, data) => {
    if (typeof data === 'string' && data.length <= 5000 && terminalController) {
      terminalController.write(data);
    }
  }));

  ipcMain.handle('terminal:resize', withSecurityCheck(async (_, { cols, rows }) => {
    if (typeof cols === 'number' && typeof rows === 'number' && terminalController) {
      terminalController.resize(cols, rows);
    }
  }));
}
