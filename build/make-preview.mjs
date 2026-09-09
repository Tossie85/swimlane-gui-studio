/**
 * 検証用。media/index.html を extension.js と同じ手順で解決し、
 * acquireVsCodeApi だけスタブして、VS Code なしでブラウザから開けるコピーを作る。
 *
 * 生成先の tools/_webview_preview/ は動作確認のための一時物で、リポジトリには含めない。
 * 実行: node vscode-extensions/swimlane/build/make-preview.mjs
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const SRC = resolve(here, '..', 'media', 'index.html');
const SRC_LIB = resolve(here, '..', 'media', 'swimlane.js');
const OUT_DIR = resolve(repoRoot, 'tools', '_webview_preview');

const NONCE = 'testnonce';
const LIB_URL = './swimlane.js';

const STUB = `<script nonce="${NONCE}">
window.acquireVsCodeApi = function(){
  window.__posted = [];
  return { postMessage(m){ window.__posted.push(m); } };
};
</script>
`;

const html = (await readFile(SRC, 'utf8'))
  .split('__NONCE__').join(NONCE)
  .split('__CSP_SOURCE__').join('*')
  .split('__SWIMLANE_URI__').join(LIB_URL)
  .replace('</head>', STUB + '</head>');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(resolve(OUT_DIR, 'index.html'), html, 'utf8');
await copyFile(SRC_LIB, resolve(OUT_DIR, 'swimlane.js'));
console.log('[make-preview] 生成しました: ' + resolve(OUT_DIR, 'index.html'));
