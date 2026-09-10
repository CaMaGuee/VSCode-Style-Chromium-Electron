/**
 * @file theme-controller.js
 * @description Electron nativeTheme 및 settings.json을 기반으로 앱 테마 모드(system/dark/light)와
 * 실제 적용 테마(resolvedTheme: dark/light)를 관리하고 OS 테마 변경을 감지하여 Shell Renderer에 전달하는 모듈.
 */

const { nativeTheme } = require('electron');

class ThemeController {
  constructor(storageController, getShellWebContents) {
    this.storage = storageController;
    this.getShellWebContents = getShellWebContents;

    // 초기 설정 로드
    const settings = this.storage.getSettings();
    this.themeMode = settings.themeMode || 'system';
    
    // nativeTheme 설정 적용
    this.applyThemeSource();

    // OS 테마 변경 리스너 등록
    nativeTheme.on('updated', () => {
      this.handleNativeThemeUpdate();
    });
  }

  /**
   * Electron nativeTheme.themeSource 설정 반영
   */
  applyThemeSource() {
    if (['system', 'dark', 'light'].includes(this.themeMode)) {
      nativeTheme.themeSource = this.themeMode;
    } else {
      nativeTheme.themeSource = 'system';
      this.themeMode = 'system';
    }
  }

  /**
   * 현재 적용된 실제 테마(resolvedTheme) 계산
   * @returns {'dark'|'light'}
   */
  getResolvedTheme() {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  /**
   * 테마 상태 반환
   * @returns {object} { themeMode, resolvedTheme }
   */
  getThemeState() {
    return {
      themeMode: this.themeMode,
      resolvedTheme: this.getResolvedTheme()
    };
  }

  /**
   * 사용자가 테마 모드를 변경할 때 호출
   * @param {'system'|'dark'|'light'} mode 
   * @returns {object} updated theme state
   */
  setThemeMode(mode) {
    if (!['system', 'dark', 'light'].includes(mode)) {
      throw new Error(`[ThemeController] 유효하지 않은 테마 모드: ${mode}`);
    }

    this.themeMode = mode;
    this.applyThemeSource();

    // settings.json 즉시 저장
    this.storage.saveSettings({ themeMode: this.themeMode });

    const state = this.getThemeState();
    this.broadcastThemeChange(state);
    return state;
  }

  /**
   * OS nativeTheme 업데이트 시 호출 (시스템 모드일 때 실시간 반영)
   */
  handleNativeThemeUpdate() {
    // 시스템 모드이거나 nativeTheme이 변경된 경우 resolvedTheme를 재계산하여 전달
    const state = this.getThemeState();
    this.broadcastThemeChange(state);
  }

  /**
   * Shell Renderer로 테마 변경 이벤트 전송
   * @param {object} state 
   */
  broadcastThemeChange(state) {
    const webContents = this.getShellWebContents();
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('theme:changed', state);
    }
  }
}

module.exports = ThemeController;
