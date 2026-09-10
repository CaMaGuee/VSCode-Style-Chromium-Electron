/**
 * @file terminal-controller.js
 * @description node-pty를 이용해 실제 운영체제 셸(PowerShell / Bash / Zsh)을 생성하고,
 * xterm.js와의 양방향 IPC 통신 및 터미널 리사이즈를 관리하는 모듈.
 */

const os = require('os');
const pty = require('node-pty');

class TerminalController {
  constructor(getShellWebContents) {
    this.getShellWebContents = getShellWebContents;
    this.ptyProcess = null;
    this.isSpawned = false;
    this.spawnShell();
  }

  spawnShell() {
    const shell = process.platform === 'win32'
      ? 'powershell.exe'
      : (process.env.SHELL || '/bin/bash');

    const cwd = os.homedir();

    try {
      this.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd,
        env: process.env
      });

      this.isSpawned = true;

      // PTY 출력 -> Shell Renderer로 전송
      this.ptyProcess.onData((data) => {
        const shellWc = this.getShellWebContents();
        if (shellWc && !shellWc.isDestroyed()) {
          shellWc.send('terminal:data', data);
        }
      });

      this.ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`[TerminalController] PTY 프로세스 종료됨 (exitCode: ${exitCode}, signal: ${signal})`);
        this.isSpawned = false;
        const shellWc = this.getShellWebContents();
        if (shellWc && !shellWc.isDestroyed()) {
          shellWc.send('terminal:exit', { exitCode, signal });
        }
      });

    } catch (err) {
      console.error('[TerminalController] PTY 생성 실패:', err);
      this.isSpawned = false;
      // 앱 전체 크래시를 방지하기 위해 터미널 에러 메시지만 전송
      setTimeout(() => {
        const shellWc = this.getShellWebContents();
        if (shellWc && !shellWc.isDestroyed()) {
          shellWc.send('terminal:data', `\r\n[오류] 터미널(node-pty)을 시작할 수 없습니다: ${err.message}\r\n`);
        }
      }, 1000);
    }
  }

  /**
   * Shell Renderer에서 입력받은 데이터를 PTY에 쓰기
   * @param {string} data 
   */
  write(data) {
    if (this.isSpawned && this.ptyProcess) {
      try {
        this.ptyProcess.write(data);
      } catch (err) {
        console.error('[TerminalController] PTY 쓰기 오류:', err);
      }
    }
  }

  /**
   * 터미널 크기 조절
   * @param {number} cols 
   * @param {number} rows 
   */
  resize(cols, rows) {
    if (this.isSpawned && this.ptyProcess && cols > 0 && rows > 0) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (err) {
        console.error('[TerminalController] PTY 리사이즈 오류:', err);
      }
    }
  }

  /**
   * 앱 종료 시 PTY 프로세스 정리
   */
  destroy() {
    if (this.isSpawned && this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch (err) {
        console.error('[TerminalController] PTY 종료 오류:', err);
      }
      this.isSpawned = false;
    }
  }
}

module.exports = TerminalController;
