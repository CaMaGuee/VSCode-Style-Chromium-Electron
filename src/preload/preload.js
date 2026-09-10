/**
 * @file preload.js
 * @description Context Bridge를 통해 Shell Renderer에 안전한 제한적 API만 노출하고,
 * ipcRenderer 객체 전체 노출을 방지하는 보안 프리로드 스크립트.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 이벤트 구독 헬퍼 함수: 구독 해제(unsubscribe) 함수를 반환합니다.
 * @param {string} channel 
 * @param {function} callback 
 * @returns {function} unsubscribe
 */
function createEventListener(channel, callback) {
  const subscription = (event, ...args) => callback(...args);
  ipcRenderer.on(channel, subscription);
  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
}

contextBridge.exposeInMainWorld('workbench', {
  // 브라우저 제어
  navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  goBack: () => ipcRenderer.invoke('browser:go-back'),
  goForward: () => ipcRenderer.invoke('browser:go-forward'),
  reload: () => ipcRenderer.invoke('browser:reload'),
  openDevTools: () => ipcRenderer.invoke('browser:open-dev-tools'),
  getBrowserState: () => ipcRenderer.invoke('browser:get-state'),

  // 북마크 제어
  getBookmarks: () => ipcRenderer.invoke('bookmark:get-all'),
  addCurrentBookmark: () => ipcRenderer.invoke('bookmark:add-current'),
  deleteBookmark: (id) => ipcRenderer.invoke('bookmark:delete', id),

  // 메모 제어
  getMemo: (url) => ipcRenderer.invoke('memo:get', url),
  saveMemo: (url, content) => ipcRenderer.invoke('memo:save', { url, content }),
  deleteMemo: (url) => ipcRenderer.invoke('memo:delete', url),

  // 테마 제어
  getThemeState: () => ipcRenderer.invoke('theme:get-state'),
  setThemeMode: (mode) => ipcRenderer.invoke('theme:set-mode', mode),

  // 터미널 제어
  terminalInput: (data) => ipcRenderer.invoke('terminal:input', data),
  terminalResize: (cols, rows) => ipcRenderer.invoke('terminal:resize', { cols, rows }),

  // 이벤트 리스너 (unsubscribe 반환)
  onBrowserStateChanged: (cb) => createEventListener('browser:state-changed', cb),
  onThemeChanged: (cb) => createEventListener('theme:changed', cb),
  onTerminalData: (cb) => createEventListener('terminal:data', cb),
  onTerminalExit: (cb) => createEventListener('terminal:exit', cb),
  onStatusChanged: (cb) => createEventListener('status:changed', cb)
});
