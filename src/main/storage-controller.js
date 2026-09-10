/**
 * @file storage-controller.js
 * @description Electron userData 디렉터리에 설정, 북마크, 메모, 창 상태 등의 로컬 JSON 파일을
 * 안전하게 읽고 쓰는 저장소 제어 모듈. 원자적 쓰기(Atomic write)와 손상 파일 백업 기능을 제공합니다.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const LAYOUT_CONSTANTS = require('./layout-constants');

class StorageController {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true });
    }
  }

  /**
  * JSON 파일을 안전하게 읽고, 손상된 경우 백업 후 기본값으로 복구합니다.
  * @param {string} fileName
  * @param {object|array} defaultValue
  * @returns {object|array}
  */
  readJson(fileName, defaultValue) {
    const filePath = path.join(this.userDataPath, fileName);
    if (!fs.existsSync(filePath)) {
      this.writeJson(fileName, defaultValue);
      return defaultValue;
    }

    try {
      const rawData = fs.readFileSync(filePath, 'utf-8');
      if (!rawData.trim()) {
        return defaultValue;
      }
      return JSON.parse(rawData);
    } catch (err) {
      console.error(`[StorageController] 파일 파싱 오류 (${fileName}):`, err);
      // 손상된 파일 백업
      try {
        const corruptPath = `${filePath}.corrupt-${Date.now()}`;
        fs.renameSync(filePath, corruptPath);
        console.warn(`[StorageController] 손상된 파일을 백업함: ${corruptPath}`);
      } catch (backupErr) {
        console.error(`[StorageController] 백업 실패:`, backupErr);
      }
      // 기본값 복구 작성
      this.writeJson(fileName, defaultValue);
      return defaultValue;
    }
  }

  /**
  * 임시 파일에 먼저 쓴 뒤 rename하는 원자적 쓰기(Atomic write)를 수행합니다.
  * @param {string} fileName
  * @param {object|array} data
  */
  writeJson(fileName, data) {
    const filePath = path.join(this.userDataPath, fileName);
    const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.error(`[StorageController] 파일 저장 오류 (${fileName}):`, err);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      throw err;
    }
  }

  // 설정 관리
  getSettings() {
    const defaults = {
      startUrl: 'https://example.com',
      themeMode: 'system',
      openDevToolsMode: 'detach'
    };
    const settings = this.readJson('settings.json', defaults);

    // themeMode 검증 및 보정 (system | dark | light 만 허용)
    if (!['system', 'dark', 'light'].includes(settings.themeMode)) {
      settings.themeMode = 'system';
      this.saveSettings(settings);
    }
    return settings;
  }

  saveSettings(newSettings) {
    const current = this.getSettings();
    const updated = { ...current, ...newSettings };
    if (!['system', 'dark', 'light'].includes(updated.themeMode)) {
      updated.themeMode = 'system';
    }
    this.writeJson('settings.json', updated);
  }

  // 창 상태 관리
  getWindowState() {
    const defaults = {
      width: 1600,
      height: 1000,
      leftPanelWidth: LAYOUT_CONSTANTS.LEFT_PANEL_WIDTH,
      rightPanelWidth: LAYOUT_CONSTANTS.RIGHT_PANEL_WIDTH,
      terminalHeight: LAYOUT_CONSTANTS.TERMINAL_HEIGHT,
      lastUrl: 'https://example.com'
    };
    const state = this.readJson('window-state.json', defaults);
    // 최소 창 크기 보정
    if (state.width < LAYOUT_CONSTANTS.MIN_WINDOW_WIDTH) state.width = LAYOUT_CONSTANTS.MIN_WINDOW_WIDTH;
    if (state.height < LAYOUT_CONSTANTS.MIN_WINDOW_HEIGHT) state.height = LAYOUT_CONSTANTS.MIN_WINDOW_HEIGHT;
    return state;
  }

  saveWindowState(newState) {
    const current = this.getWindowState();
    const updated = { ...current, ...newState };
    this.writeJson('window-state.json', updated);
  }

  // 북마크 관리
  getBookmarks() {
    return this.readJson('bookmarks.json', []);
  }

  saveBookmarks(bookmarks) {
    this.writeJson('bookmarks.json', bookmarks);
  }

  // 메모 관리 (URL별 객체 맵)
  getMemos() {
    return this.readJson('memos.json', {});
  }

  getMemo(url) {
    const memos = this.getMemos();
    return memos[url] || { url, content: '', updatedAt: new Date().toISOString() };
  }

  saveMemo(url, content) {
    const memos = this.getMemos();
    memos[url] = {
      url,
      content,
      updatedAt: new Date().toISOString()
    };
    this.writeJson('memos.json', memos);
  }

  deleteMemo(url) {
    const memos = this.getMemos();
    if (memos[url]) {
      delete memos[url];
      this.writeJson('memos.json', memos);
    }
  }
}

module.exports = StorageController;
