/**
 * tools/swimlane-gui-studio.html から、VS Code の Webview 用HTMLを生成する。
 *
 * SGS 本体には手を入れず、ここでの差し替えは次の4つだけに留めている。
 *   1. インライン <script> / <style> と swimlane.js の読み込みに nonce を付ける（CSP対応）
 *   2. <script src> を Webview のURIプレースホルダへ差し替え、tools-nav.js を外す
 *   3. 「ライブラリをダウンロード」リンク（<a download>）を Web版への外部リンクに置換
 *   4. 末尾に VS Code 版の Host（保存/読み込み）を足して上書きする
 *
 * 差し替え対象が1つでも見つからなければ、生成せずに異常終了する。
 * SGS 側の改修でパターンが外れたことに気づかないまま、壊れた拡張を配るのを防ぐため。
 *
 * 実行: node build/make-webview.mjs（npm run build）
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const SRC_HTML = resolve(repoRoot, 'tools/swimlane-gui-studio.html');
const SRC_LIB = resolve(repoRoot, 'vendor/swimlane.js');
const OUT_DIR = resolve(here, '..', 'media');

/** 期待した差し替えが起きたかを必ず確かめる。0件でも複数件でも異常として止める。 */
function replaceExactlyOnce(text, find, replaceWith, what) {
  const parts = text.split(find);
  if (parts.length !== 2) {
    throw new Error(
      `[make-webview] ${what} の差し替えに失敗しました（一致 ${parts.length - 1} 件、期待 1 件）。\n` +
      `  探した文字列: ${JSON.stringify(String(find).slice(0, 90))}\n` +
      `  SGS 側の改修でこの箇所が変わった可能性があります。DEVELOPMENT.md の「SGSとの同期方法」を確認してください。`
    );
  }
  return parts.join(replaceWith);
}

function replaceAllOrFail(text, find, replaceWith, what, expected) {
  const hits = text.split(find).length - 1;
  if (hits !== expected) {
    throw new Error(
      `[make-webview] ${what} の件数が変わりました（${hits} 件、期待 ${expected} 件）。\n` +
      `  SGS 側で <script> / <style> が増減した可能性があります。このスクリプトの期待値を更新してください。`
    );
  }
  return text.split(find).join(replaceWith);
}

/* SGS の配色トークンを VS Code のテーマ変数へ差し替える。
   VS Code は Webview に --vscode-* を自動で流し込むので、これを敷くだけで
   ライト / ダーク / ハイコントラストのどのテーマにも馴染む。
   アクセント（シアン・アンバー）はツールの識別色なので固定のまま残す。
   図そのもの（swimlane.js が描くSVG）は常に明るい前提の配色なので、
   プレビューの地（--surface-canvas）と図に載る文字は VS Code テーマに追従させない。 */
const THEME_CSS = `
<style nonce="__NONCE__">
  :root{
    /* 面 → VS Code のテーマ面 */
    --ink-900: var(--vscode-editor-background);
    --ink-800: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --ink-700: var(--vscode-input-background, var(--vscode-editor-background));
    --ink-line: var(--vscode-panel-border, var(--vscode-contrastBorder, transparent));
    --paper: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --surface-card: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --surface-input: var(--vscode-input-background, var(--vscode-editor-background));
    --surface-subtle: var(--vscode-list-hoverBackground, var(--vscode-editor-background));
    --surface-note: var(--vscode-textBlockQuote-background, var(--vscode-editorWidget-background));
    --surface-overlay: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --overlay-veil: rgba(0,0,0,0.55);
    --shadow-soft: var(--vscode-widget-shadow, rgba(0,0,0,0.2));
    --shadow-strong: var(--vscode-widget-shadow, rgba(0,0,0,0.4));
    --shadow-drop: var(--vscode-widget-shadow, rgba(0,0,0,0.35));
    /* プレビューの地。--surface-canvas は直接触らず、「キャンバス＝自動」のときだけ
       参照される --surface-canvas-auto を差し替える（利用者が明るい/暗い/任意色を
       選んでいるときはその選択を尊重する）。
       swimlane.js が描くSVGは自前で白の背景を敷くので、地を暗くしても図は読める。 */
    --surface-canvas-auto: var(--vscode-editor-background, #FBFCFE);

    /* 文字（面トークンを流用しない） */
    --text-ink: var(--vscode-foreground);
    --text-strong: var(--vscode-foreground);
    --text-soft: var(--vscode-descriptionForeground, var(--vscode-foreground));
    --text-faint: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
    --text-on-dark: var(--vscode-foreground);
    --text-on-dark-dim: var(--vscode-descriptionForeground, var(--vscode-foreground));
    --text-on-dark-strong: var(--vscode-foreground);
    /* 淡い面の上のアクセント文字（カード見出し・▾ など）。
       本体の濃いシアンのままだと暗いテーマの面で読めなくなる */
    --accent-ink: var(--vscode-textLink-foreground, var(--vscode-foreground));
    /* 本文中のリンク。既定の青のままだと暗いテーマで読めない（実測1.63） */
    --link: var(--vscode-textLink-foreground, var(--vscode-foreground));
    /* 濃い面に載る危険色。ヘッダーの「クリア」に使う */
    --danger-on-dark: var(--vscode-errorForeground, #F2A0B0);

    /* 線 */
    --border-strong: var(--vscode-input-border, var(--vscode-panel-border, transparent));
    --border-soft: var(--vscode-panel-border, transparent);
    --border-dashed: var(--vscode-panel-border, transparent);
    --border-note: var(--vscode-panel-border, transparent);
    --border-swatch: var(--vscode-panel-border, var(--vscode-descriptionForeground));
    --scrollbar-thumb: var(--vscode-scrollbarSlider-background, var(--vscode-panel-border));

    /* アクセントの淡い面（既定の薄いシアンのまま残すと暗いテーマで文字が読めない） */
    --accent-tint: var(--vscode-list-hoverBackground, var(--vscode-editor-background));
    --accent-tint-soft: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --accent-tint-strong: var(--vscode-list-hoverBackground, var(--vscode-editor-background));
    --accent-border: var(--vscode-panel-border, transparent);

    /* 注意・危険の淡い面 */
    --warn-tint: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
    --danger-tint: var(--vscode-inputValidation-errorBackground, var(--vscode-list-hoverBackground));
    --danger-text: var(--vscode-errorForeground, #9B2C43);
    --danger: var(--vscode-errorForeground, #E8637A);

    /* キー割り当てバッジ */
    --badge-bg: var(--vscode-badge-background);
    --badge-text: var(--vscode-badge-foreground);

    /* コード欄 */
    --code-text: var(--vscode-editor-foreground);
    --code-text-dim: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
    --code-selection: var(--vscode-editor-selectionBackground);
    --grip-dark: var(--vscode-panel-border, var(--vscode-descriptionForeground));

    /* アクセント（識別色）と --text-on-* は固定のまま。
       アンバー面に載る文字（--text-on-warn）も濃いまま。 */
  }
  /* 既定のシアンは明るい面では薄すぎるので、明るいテーマだけ濃い色へ。
     --text-on-dark* はここで固定しない（明るいテーマではヘッダーも明るい面になるため、
     --vscode-foreground＝濃い文字のままにする）。 */
  body.vscode-light, body.vscode-high-contrast-light{
    --cyan:#0F6070;
    --cyan-dim:#136B7A;
  }
  /* 一覧の行は入力欄ではないので、地は入力欄の面ではなくウィジェットの面に置く。
     入力欄の面(--vscode-input-background)のままだと、上に載る削除の × に使う
     errorForeground が 4.49 で基準に届かなかった（この面なら 6.4）。 */
  .item-row{ background: var(--vscode-editorWidget-background, var(--vscode-input-background)); }
  /* ✎ ⠿ × はいずれも「エラー文言」ではなく操作アイコン。errorForeground は
     エディタの地に載る前提の色で、一段明るい行の上では基準に届かない
     （× は明るいテーマで 4.27 / 入力欄の面で 4.49）。VS Code 自身の一覧と同じく
     アイコン色で置き、消す操作であることはホバーの地（--danger-tint）で示す。 */
  .item-row button, .item-row .drag-handle{ color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
  /* 入力欄はテーマの文字色を使う（既定の濃紺前提の色が残らないように） */
  .field input, .field select, #codeArea{ color: var(--vscode-input-foreground, var(--vscode-foreground)); }
  select{ background: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-foreground)); }
  /* 「＋ 追加」系ボタンはエディタのボタン色に */
  .add-row-btn{ background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .add-row-btn:hover{ background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  /* 「編集をキャンセル」は副ボタン扱い。追加ボタンと区別しつつ配色ペアを崩さない */
  .add-row-btn.is-cancel{
    background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .add-row-btn.is-cancel:hover{ background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-input-background))); }
  /* ヘッダーのボタン（.btn）はセカンダリボタン色に寄せる */
  .btn{ background: var(--vscode-button-secondaryBackground, var(--vscode-input-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); }
  .btn:hover{ color: var(--cyan); border-color: var(--cyan); }
  /* モバイルのツールバー開閉ボタン。既定はシアン地＋淡色文字で暗いテーマだと読めない（実測1.74）ので
     VS Code のボタン色ペアにする */
  .header-toggle-bar{
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
  }
  /* エラー表示は自前の淡い地を持つので、その上の文字は明るい前提のまま固定する。
     プレースホルダは地の明暗に合わせて本体が --text-on-canvas を入れ替えるので触らない。 */
  .preview-error{ background:#FFF1F3; border-color:#E8637A; color:#9B2C43; }
</style>
`;

/** Webview 用の Host 実装。保存と読み込みだけ拡張ホストへ委譲する。
    通知 / 確認（Host.alert / Host.confirm）はページ内モーダルのまま使う。 */
const VSCODE_HOST = `
<script nonce="__NONCE__">
/* VS Code 版の Host。SGS 本体の Host のうち保存/読み込みだけ差し替える。
   Webview では <a download> も file input も使えないため拡張ホストへ委譲する。 */
(function(){
  const vscode = acquireVsCodeApi();
  let seq = 0;
  const pending = new Map();

  window.addEventListener('message', ev=>{
    const msg = ev.data;
    if(!msg || msg.type !== 'reply') return;
    const resolve = pending.get(msg.id);
    if(resolve){ pending.delete(msg.id); resolve(msg.payload); }
  });

  function call(action, payload){
    return new Promise(resolve=>{
      const id = ++seq;
      pending.set(id, resolve);
      vscode.postMessage({ type:'request', id, action, payload });
    });
  }

  // PNG のようなバイナリは base64 の文字列で渡す（Webview からは文字列しか送れない）
  Host.saveFile = (filename, mime, content, opt)=>
    call('saveFile', { filename, content, encoding: (opt && opt.encoding) || 'utf8' });
  Host.openFile = ()=> call('openFile');
})();
</script>
`;

async function main() {
  // 元ファイルはWindows側で編集されるためCRLFになることがある。
  // 以降の一致判定を改行コードに左右されないよう、読み込み時にLFへ揃える
  let html = (await readFile(SRC_HTML, 'utf8')).replace(/\r\n/g, '\n');

  // 1. サイト用のツール切替メニューは拡張では不要
  html = replaceExactlyOnce(
    html, '<script src="../assets/tools-nav.js"></script>', '',
    'tools-nav.js の除去'
  );

  // 2. swimlane.js は Webview のURIから読む
  html = replaceExactlyOnce(
    html,
    '<script src="../assets/swimlane.js"></script>',
    '<script nonce="__NONCE__" src="__SWIMLANE_URI__"></script>',
    'swimlane.js の読み込み'
  );

  // 3. インライン <script>（1個）に nonce
  html = replaceAllOrFail(html, '<script>', '<script nonce="__NONCE__">', 'インライン script', 1);

  // 4. 本体の <style>（先頭の1個だけ）に nonce。
  //    「.html 保存」用テンプレートの <style> は素の light 配色のまま残す
  html = replaceExactlyOnce(
    html, '<style>\n  :root{', '<style nonce="__NONCE__">\n  :root{',
    '本体 style への nonce 付与'
  );

  // 5. CSP を head に差し込む。
  //    swimlane.js が生成するSVGに style 属性が載るため style は 'unsafe-inline' を許す。
  //    スクリプトは nonce で固定し、外部通信はすべて禁止する（connect-src は default-src 'none' のまま）。
  const csp =
    `<meta http-equiv="Content-Security-Policy" content="` +
    `default-src 'none'; ` +
    `img-src __CSP_SOURCE__ data:; ` +
    `style-src __CSP_SOURCE__ 'unsafe-inline'; ` +
    `script-src 'nonce-__NONCE__'; ` +
    `font-src __CSP_SOURCE__;">`;
  const headAnchor = '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html = replaceExactlyOnce(html, headAnchor, headAnchor + '\n' + csp, 'CSP の挿入');

  // 6. 配色トークンをVS Codeのテーマ変数へ差し替える。
  //    本体の <style> より後ろ、ページの </head> 直前に置いて :root の値を上書きする。
  //    </head>\n<body> はページ冒頭にしか無い（.html 保存テンプレは </head><body>）。
  html = replaceExactlyOnce(html, '</head>\n<body>', THEME_CSS + '</head>\n<body>', 'テーマ上書きの挿入');

  // 7. VS Code 版 Host を最後に足して上書き。
  //    </body>\n</html> はページ末尾にしか無い（.html 保存テンプレは </body></html>）。
  const tailAnchor = '</body>\n</html>';
  html = replaceExactlyOnce(html, tailAnchor, VSCODE_HOST + tailAnchor, 'Host 実装の追記');

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, 'index.html'), html, 'utf8');
  await copyFile(SRC_LIB, resolve(OUT_DIR, 'swimlane.js'));

  console.log('[make-webview] 生成しました:');
  console.log('  ' + resolve(OUT_DIR, 'index.html'));
  console.log('  ' + resolve(OUT_DIR, 'swimlane.js'));
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
