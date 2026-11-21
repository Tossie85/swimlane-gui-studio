/**
 * make-webview.mjs が作った media/ を検める。
 *
 * ビルドが「通った」だけでは、中身が拡張として成立しているとは限らない。
 * Webview が白画面のまま出る壊れ方（プレースホルダが残っている、Host が入っていない）を
 * 公開前に捕まえるための確認。CI から呼ぶ。
 *
 * 実行: node build/check-build.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const html = await readFile(resolve(root, 'media/index.html'), 'utf8');
const lib = await readFile(resolve(root, 'media/swimlane.js'), 'utf8');
const vendor = await readFile(resolve(root, 'vendor/swimlane.js'), 'utf8');

/* 入手方法の案内に書いてある CDN の版は、同梱しているエンジンの VERSION と同じでなければ
   ならない。ここを誰も見ていなかったので、エンジンを 1.4.0 にしても案内が @1.3.0 のまま
   残っていた（2026-11-21）。版はここで突き合わせる。 */
const engineVersion = (vendor.match(/VERSION: *'([^']+)'/) || [])[1];
const guided = [...html.matchAll(/swimlane-diagram@([\d.]+)/g)].map((m) => m[1]);
const guidedList = [...new Set(guided)];

const checks = [
  ['swimlane.js の読み込みがプレースホルダになっている', html.includes('src="__SWIMLANE_URI__"')],
  ['CSP が入っている', html.includes('Content-Security-Policy')],
  ['nonce が付いている', html.includes('nonce="__NONCE__"')],
  ['VS Code 版の Host が入っている', html.includes('acquireVsCodeApi')],
  ['保存の委譲が入っている', html.includes("Host.saveFile")],
  ['テーマ上書きが入っている', html.includes('--vscode-editor-background')],
  ['サイト用メニューが残っていない', !html.includes('tools-nav.js')],
  ['サイトの相対パスが残っていない', !html.includes('"../assets/swimlane.js"')],
  ['エンジンが vendor と同じ', lib === vendor],
  ['エンジンが空でない', lib.length > 50000],
  [`案内の CDN の版が同梱しているエンジンと同じ（エンジン ${engineVersion || '不明'} / 案内 ${guidedList.join(', ') || 'なし'}）`,
    !!engineVersion && guidedList.length === 1 && guidedList[0] === engineVersion],
];

let ng = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  OK  ' : '  NG  ') + name);
  if (!ok) ng++;
}
if (ng) {
  console.error(`\n${ng} 件が期待どおりではありません。media/ を作り直すか、原本 tools/swimlane-gui-studio.html を直してください。`);
  process.exit(1);
}
console.log(`\n${checks.length} 件すべて期待どおりです。`);
