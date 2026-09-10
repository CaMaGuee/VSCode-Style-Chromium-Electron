/**
 * @file copy-xterm.js
 * @description node_modules에서 @xterm/xterm 및 @xterm/addon-fit 배포 파일과 CSS를 앱 내부 assets/vendor/xterm으로 복사하는 스크립트.
 */

const fs = require('fs');
const path = require('path');

const targetDirs = [
  path.join(__dirname, '../src/renderer/vendor/xterm'),
  path.join(__dirname, '../assets/vendor/xterm')
];

targetDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const filesToCopy = [
  { src: 'node_modules/@xterm/xterm/css/xterm.css', dest: 'xterm.css' },
  { src: 'node_modules/@xterm/xterm/lib/xterm.js', dest: 'xterm.js' },
  { src: 'node_modules/@xterm/addon-fit/lib/addon-fit.js', dest: 'xterm-addon-fit.js' }
];

targetDirs.forEach(targetDir => {
  filesToCopy.forEach(({ src, dest }) => {
    const srcPath = path.join(process.cwd(), src);
    const destPath = path.join(targetDir, dest);
    try {
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[CopyXterm] 복사 완료: ${src} -> ${destPath}`);
      } else {
        console.warn(`[CopyXterm] 경고: 소스 파일을 찾을 수 없습니다: ${srcPath}`);
      }
    } catch (err) {
      console.error(`[CopyXterm] 복사 오류 (${src}):`, err.message);
    }
  });
});
