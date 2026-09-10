/**
 * @file renderer.js
 * @description Chromium Workbench Shell UI 렌더러 로직.
 * 브라우저 핵심 UI 이벤트 우선 바인딩, 독립적 비동기 초기화, xterm 터미널 및 node-pty IPC 연동.
 */

document.addEventListener('DOMContentLoaded', () => {
  const workbench = window.workbench;
  if (!workbench) {
    console.error('[Renderer] workbench API(preload)가 노출되지 않았습니다.');
    return;
  }

  // DOM 요소 참조
  const backBtn = document.getElementById('back-btn');
  const forwardBtn = document.getElementById('forward-btn');
  const reloadBtn = document.getElementById('reload-btn');
  const urlInput = document.getElementById('url-input');
  const addBookmarkBtn = document.getElementById('add-bookmark-btn');
  const devtoolsBtn = document.getElementById('devtools-btn');
  const statusMsgEl = document.getElementById('status-msg');
  const bookmarkListEl = document.getElementById('bookmark-list');
  const bookmarkEmptyEl = document.getElementById('bookmark-empty');
  const currentUrlDisplayEl = document.getElementById('current-url-display');
  const memoTextareaEl = document.getElementById('memo-textarea');
  const saveStatusEl = document.getElementById('save-status');
  const deleteMemoBtn = document.getElementById('delete-memo-btn');
  const saveMemoBtn = document.getElementById('save-memo-btn');
  const themeSelectEl = document.getElementById('theme-select');
  const terminalBodyEl = document.getElementById('terminal-body');

  let memoSaveTimeout = null;
  let currentMemoUrl = '';
  let terminal = null;
  let fitAddon = null;

  // ==========================================================================
  // 1. 상태 메시지 및 CSS 헬퍼
  // ==========================================================================
  function showStatus(message, type = 'normal') {
    if (!statusMsgEl) return;
    statusMsgEl.textContent = message;
    if (type === 'error') {
      statusMsgEl.style.color = 'var(--danger-color, #e06c75)';
    } else if (type === 'success') {
      statusMsgEl.style.color = 'var(--success-color, #98c379)';
    } else {
      statusMsgEl.style.color = 'var(--text-secondary, #5c6370)';
    }
  }

  function showTerminalError(message) {
    if (!terminalBodyEl) return;
    terminalBodyEl.innerHTML = `<div class="terminal-error">${escapeHtml(message)}</div>`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ==========================================================================
  // 2. 테마 관리 (Shell UI 내부 전용)
  // ==========================================================================
  function applyTheme(resolvedTheme) {
    const theme = (resolvedTheme === 'light') ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;

    // xterm 테마 동기화 (존재할 경우에만)
    if (terminal && terminal.options) {
      terminal.options.theme = theme === 'dark' ? {
        background: '#181a1f',
        foreground: '#abb2bf',
        cursor: '#528bff',
        selection: '#3e4451'
      } : {
        background: '#ffffff',
        foreground: '#212529',
        cursor: '#0d6efd',
        selection: '#adb5bd'
      };
    }
  }

  function handleThemeChange(themeState) {
    if (!themeState) return;
    applyTheme(themeState.resolvedTheme);
    if (themeSelectEl && themeState.themeMode) {
      themeSelectEl.value = themeState.themeMode;
    }
  }

  // ==========================================================================
  // 3. 브라우저 상태 관리
  // ==========================================================================
  function updateBrowserUI(state) {
    if (!state) return;

    if (urlInput && document.activeElement !== urlInput) {
      urlInput.value = state.url || '';
    }

    if (currentUrlDisplayEl) {
      currentUrlDisplayEl.textContent = state.url ? `URL: ${state.url}` : 'URL: -';
    }

    if (backBtn) backBtn.disabled = !state.canGoBack;
    if (forwardBtn) forwardBtn.disabled = !state.canGoForward;
    if (reloadBtn) reloadBtn.disabled = !!state.isLoading;

    if (state.title && state.title.trim()) {
      document.title = `${state.title} - Chromium Workbench`;
    } else {
      document.title = 'Chromium Workbench';
    }

    // 메모 UI 갱신
    if (memoTextareaEl) {
      const isValidUrl = state.url && state.url !== 'about:blank' && state.url.startsWith('http');
      memoTextareaEl.disabled = !isValidUrl;

      if (!isValidUrl) {
        memoTextareaEl.value = '';
        if (saveStatusEl) saveStatusEl.textContent = '';
        currentMemoUrl = '';
      } else if (state.url !== currentMemoUrl) {
        loadMemoForUrl(state.url);
      }
    }
  }

  // ==========================================================================
  // 4. 북마크 관리
  // ==========================================================================
  async function refreshBookmarks() {
    if (!bookmarkListEl) return;
    try {
      const bookmarks = await workbench.getBookmarks();
      bookmarkListEl.innerHTML = '';

      if (!bookmarks || bookmarks.length === 0) {
        if (bookmarkEmptyEl) bookmarkEmptyEl.style.display = 'block';
        return;
      }

      if (bookmarkEmptyEl) bookmarkEmptyEl.style.display = 'none';

      bookmarks.forEach(bookmark => {
        const li = document.createElement('li');
        li.className = 'bookmark-item';
        li.title = bookmark.url;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'bookmark-info';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'bookmark-title';
        titleSpan.textContent = bookmark.title || bookmark.url;
        infoDiv.appendChild(titleSpan);

        const urlSpan = document.createElement('span');
        urlSpan.className = 'bookmark-url';
        urlSpan.textContent = bookmark.url;
        infoDiv.appendChild(urlSpan);

        li.appendChild(infoDiv);

        const delBtn = document.createElement('button');
        delBtn.className = 'bookmark-del-btn';
        delBtn.title = '북마크 삭제';
        delBtn.innerHTML = '&times;';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const result = await workbench.deleteBookmark(bookmark.id);
            if (result && result.success) {
              await refreshBookmarks();
              showStatus(`북마크 삭제됨: ${bookmark.title || bookmark.url}`, 'success');
            } else {
              showStatus(`북마크 삭제 실패: ${result?.message || '알 수 없는 오류'}`, 'error');
            }
          } catch (err) {
            console.error('[Renderer] 북마크 삭제 오류:', err);
            showStatus('북마크 삭제 중 오류 발생', 'error');
          }
        });
        li.appendChild(delBtn);

        li.addEventListener('click', () => {
          if (urlInput) urlInput.value = bookmark.url;
          workbench.navigate(bookmark.url);
        });

        bookmarkListEl.appendChild(li);
      });
    } catch (err) {
      console.error('[Renderer] 북마크 조회 오류:', err);
      if (bookmarkEmptyEl) bookmarkEmptyEl.style.display = 'block';
    }
  }

  async function addCurrentBookmark() {
    try {
      const result = await workbench.addCurrentBookmark();
      if (result && result.success) {
        await refreshBookmarks();
        showStatus(`북마크 추가됨: ${result.bookmark.title}`, 'success');
      } else {
        showStatus(`북마크 추가 불가: ${result?.message || '실패'}`, 'error');
      }
    } catch (err) {
      console.error('[Renderer] 북마크 추가 오류:', err);
      showStatus(`북마크 추가 오류: ${err.message}`, 'error');
    }
  }

  // ==========================================================================
  // 5. 메모 관리
  // ==========================================================================
  async function loadMemoForUrl(url) {
    currentMemoUrl = url;
    try {
      const memo = await workbench.getMemo(url);
      if (memoTextareaEl && currentMemoUrl === url) {
        memoTextareaEl.value = (memo && memo.content) || '';
        if (saveStatusEl) saveStatusEl.textContent = '';
      }
    } catch (err) {
      console.error('[Renderer] 메모 불러오기 오류:', err);
    }
  }

  async function saveMemo() {
    if (!currentMemoUrl || !memoTextareaEl) return;
    const content = memoTextareaEl.value;

    if (saveStatusEl) {
      saveStatusEl.textContent = '저장 중...';
      saveStatusEl.style.color = 'var(--text-secondary, #5c6370)';
    }

    try {
      const result = await workbench.saveMemo(currentMemoUrl, content);
      if (result && result.success) {
        if (saveStatusEl) {
          saveStatusEl.textContent = '저장됨';
          saveStatusEl.style.color = 'var(--success-color, #98c379)';
        }
      } else {
        if (saveStatusEl) {
          saveStatusEl.textContent = `저장 실패: ${result?.message || ''}`;
          saveStatusEl.style.color = 'var(--danger-color, #e06c75)';
        }
      }
    } catch (err) {
      console.error('[Renderer] 메모 저장 오류:', err);
      if (saveStatusEl) {
        saveStatusEl.textContent = '저장 오류';
        saveStatusEl.style.color = 'var(--danger-color, #e06c75)';
      }
    }
  }

  async function deleteMemo() {
    if (!currentMemoUrl || !memoTextareaEl) return;
    if (!window.confirm('현재 URL의 메모를 삭제하시겠습니까?')) return;

    try {
      const result = await workbench.deleteMemo(currentMemoUrl);
      if (result && result.success) {
        memoTextareaEl.value = '';
        if (saveStatusEl) {
          saveStatusEl.textContent = '삭제됨';
          saveStatusEl.style.color = 'var(--success-color, #98c379)';
        }
      } else {
        if (saveStatusEl) {
          saveStatusEl.textContent = '삭제 실패';
          saveStatusEl.style.color = 'var(--danger-color, #e06c75)';
        }
      }
    } catch (err) {
      console.error('[Renderer] 메모 삭제 오류:', err);
    }
  }

  // ==========================================================================
  // 6. 브라우저 핵심 UI 이벤트 바인딩 (최우선 동기 실행)
  // ==========================================================================
  function bindCoreEvents() {
    // 1) 주소창 네비게이션 이벤트
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const targetUrl = urlInput.value.trim();
          if (targetUrl) {
            workbench.navigate(targetUrl);
          }
        }
        // Cmd+L 또는 Ctrl+L: 주소창 전체 선택
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
          e.preventDefault();
          urlInput.focus();
          urlInput.select();
        }
      });
    }

    // 전역 단축키: Cmd+L / Ctrl+L 주소창 포커스
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        if (urlInput && document.activeElement !== urlInput) {
          e.preventDefault();
          urlInput.focus();
          urlInput.select();
        }
      }
    });

    // 2) 브라우저 제어 버튼 이벤트
    if (backBtn) {
      backBtn.addEventListener('click', () => workbench.goBack());
    }
    if (forwardBtn) {
      forwardBtn.addEventListener('click', () => workbench.goForward());
    }
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => workbench.reload());
    }
    if (devtoolsBtn) {
      devtoolsBtn.addEventListener('click', () => workbench.openDevTools());
    }

    // 3) 북마크 이벤트
    if (addBookmarkBtn) {
      addBookmarkBtn.addEventListener('click', addCurrentBookmark);
    }

    // 4) 테마 선택 이벤트
    if (themeSelectEl) {
      themeSelectEl.addEventListener('change', (e) => {
        workbench.setThemeMode(e.target.value);
      });
    }

    // 5) 메모 이벤트
    if (memoTextareaEl) {
      memoTextareaEl.addEventListener('input', () => {
        clearTimeout(memoSaveTimeout);
        if (saveStatusEl) {
          saveStatusEl.textContent = '입력 중...';
          saveStatusEl.style.color = 'var(--text-secondary, #5c6370)';
        }
        memoSaveTimeout = setTimeout(saveMemo, 600);
      });
    }
    if (saveMemoBtn) {
      saveMemoBtn.addEventListener('click', () => {
        clearTimeout(memoSaveTimeout);
        saveMemo();
      });
    }
    if (deleteMemoBtn) {
      deleteMemoBtn.addEventListener('click', deleteMemo);
    }

    // 6) IPC 브로드캐스트 이벤트 리스너 등록
    if (typeof workbench.onStatusChanged === 'function') {
      workbench.onStatusChanged((msg) => {
        showStatus(msg);
      });
    }

    if (typeof workbench.onThemeChanged === 'function') {
      workbench.onThemeChanged(handleThemeChange);
    }

    if (typeof workbench.onBrowserStateChanged === 'function') {
      workbench.onBrowserStateChanged(updateBrowserUI);
    }
  }

  // ==========================================================================
  // 7. xterm 터미널 초기화 (독립 실행 및 결함 격리)
  // ==========================================================================
  function initializeTerminal() {
    if (!terminalBodyEl) {
      console.warn('[Renderer] terminal-body DOM 요소를 찾을 수 없습니다.');
      return;
    }

    // xterm 및 FitAddon 로드 여부 진단
    const hasTerminal = typeof window.Terminal !== 'undefined';
    const hasFitAddon = typeof window.FitAddon !== 'undefined';

    if (!hasTerminal) {
      const errText = '터미널 라이브러리(xterm.js)를 불러오지 못했습니다.';
      console.error(`[Renderer] ${errText} (typeof window.Terminal: ${typeof window.Terminal})`);
      showTerminalError(errText);
      return;
    }

    // UMD export 형태 안전 래핑
    const TerminalClass = (typeof window.Terminal === 'function')
      ? window.Terminal
      : (window.Terminal && window.Terminal.Terminal);

    if (typeof TerminalClass !== 'function') {
      const errText = 'Terminal 생성자를 식별할 수 없습니다.';
      console.error(`[Renderer] ${errText}`, window.Terminal);
      showTerminalError(errText);
      return;
    }

    const FitAddonClass = hasFitAddon
      ? ((window.FitAddon && typeof window.FitAddon.FitAddon === 'function')
          ? window.FitAddon.FitAddon
          : (typeof window.FitAddon === 'function' ? window.FitAddon : null))
      : null;

    if (!FitAddonClass) {
      console.warn('[Renderer] FitAddon을 찾을 수 없어 기본 크기로 초기화합니다.');
    }

    // 현재 테마 색상 결정
    const currentTheme = document.documentElement.dataset.theme || 'dark';
    const termTheme = currentTheme === 'dark' ? {
      background: '#181a1f',
      foreground: '#abb2bf',
      cursor: '#528bff',
      selection: '#3e4451'
    } : {
      background: '#ffffff',
      foreground: '#212529',
      cursor: '#0d6efd',
      selection: '#adb5bd'
    };

    // Terminal 인스턴스 생성
    terminal = new TerminalClass({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: termTheme,
      convertEol: true
    });

    // FitAddon 로드
    if (FitAddonClass) {
      fitAddon = new FitAddonClass();
      terminal.loadAddon(fitAddon);
    }

    // DOM에 오픈
    terminal.open(terminalBodyEl);

    if (fitAddon) {
      try {
        fitAddon.fit();
      } catch (fitErr) {
        console.warn('[Renderer] 초기 fitAddon.fit() 실패:', fitErr);
      }
    }

    // 터미널 크기 변경 감지 및 PTY 리사이즈
    const syncTerminalSize = () => {
      if (!terminal) return;
      if (fitAddon) {
        try {
          fitAddon.fit();
        } catch (e) {
          // ignore transient geometry errors
        }
      }
      if (typeof workbench.terminalResize === 'function') {
        workbench.terminalResize(terminal.cols, terminal.rows);
      }
    };

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        syncTerminalSize();
      });
      ro.observe(terminalBodyEl);
    }

    // xterm 내장 onResize 이벤트
    if (typeof terminal.onResize === 'function') {
      terminal.onResize(({ cols, rows }) => {
        if (typeof workbench.terminalResize === 'function') {
          workbench.terminalResize(cols, rows);
        }
      });
    }

    // 터미널 키 입력 -> node-pty IPC 전달
    terminal.onData((data) => {
      if (typeof workbench.terminalInput === 'function') {
        workbench.terminalInput(data);
      }
    });

    // PTY 출력 수신 -> 터미널에 쓰기
    if (typeof workbench.onTerminalData === 'function') {
      workbench.onTerminalData((data) => {
        if (terminal) {
          terminal.write(data);
        }
      });
    }

    // PTY 프로세스 종료 수신
    if (typeof workbench.onTerminalExit === 'function') {
      workbench.onTerminalExit(({ exitCode, signal }) => {
        if (terminal) {
          terminal.writeln(`\r\n\x1b[33m[터미널 프로세스 종료됨 (exitCode: ${exitCode}, signal: ${signal || 'none'})]\x1b[0m\r\n`);
        }
      });
    }

    // 초기 크기 동기화 1회 지연 호출
    setTimeout(syncTerminalSize, 100);
  }

  // ==========================================================================
  // 8. 초기화 파이프라인 (독립 try/catch 구조)
  // ==========================================================================
  async function initializeUI() {
    // 1단계: 브라우저 UI 이벤트 최우선 동기 바인딩 (절대 중단되지 않음)
    bindCoreEvents();

    // 2단계: 테마 초기 상태 로드
    try {
      const themeState = await workbench.getThemeState();
      applyTheme(themeState?.resolvedTheme);
      if (themeSelectEl && themeState?.themeMode) {
        themeSelectEl.value = themeState.themeMode;
      }
    } catch (err) {
      console.error('[Renderer] 테마 상태 초기화 실패:', err);
      applyTheme('dark');
    }

    // 3단계: 브라우저 상태 초기 로드
    try {
      const browserState = await workbench.getBrowserState();
      updateBrowserUI(browserState);
    } catch (err) {
      console.error('[Renderer] 브라우저 상태 초기화 실패:', err);
      showStatus('브라우저 상태를 불러오지 못했습니다.', 'error');
    }

    // 4단계: 북마크 초기 로드
    try {
      await refreshBookmarks();
    } catch (err) {
      console.error('[Renderer] 북마크 초기화 실패:', err);
      showStatus('북마크를 불러오지 못했습니다.', 'error');
    }

    // 5단계: 터미널 초기화 (오류 발생 시에도 상위 기능에 영향 없음)
    try {
      initializeTerminal();
    } catch (err) {
      console.error('[Renderer] 터미널 초기화 예외:', err);
      showTerminalError(`터미널 초기화 실패: ${err.message}`);
    }
  }

  // 실행
  initializeUI();
});
