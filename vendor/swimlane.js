/*!
 * swimlane.js — スイムレーン図 レンダリングライブラリ
 * https://tossie85.site/tools/swimlane-gui-studio.html （GUIで組み立てるビルダーツール本体）
 *
 * .swim 記法のテキストからスイムレーン図（業務フロー図）のSVGを生成する。
 * このファイル自体はレンダラーのみで、GUIビルダーは含まない。
 * 外部依存なし。ブラウザ・Node.js のどちらからも読み込める。
 *
 * 使い方:
 *   <script src="swimlane.js"></script>
 *   <div id="diagram"></div>
 *   <script>
 *     Swimlane.renderTo('#diagram', `swimlane
 *     title "受注フロー"
 *     direction LR
 *
 *     lane sales "営業部"
 *     node n1 "申込を受ける" lane=sales shape=start
 *     node n2 "内容を確認"   lane=sales
 *
 *     n1 -> n2 "確認依頼"
 * `);
 *   </script>
 *
 * API:
 *   Swimlane.render(code)      -> { ok, svg, width, height, errors, state }
 *   Swimlane.renderTo(el, code) -> render() と同じ戻り値。elに直接SVGを描画する
 *   Swimlane.parse(code)        -> { state, errors }        .swim → 状態オブジェクト
 *   Swimlane.generate(state)    -> string                    状態オブジェクト → .swim
 *
 * ライセンス: このサイト内での利用と同条件（自由に組み込み・改変可）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Swimlane = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function emptyState(){
  return {
    title: '',
    direction: 'TB',
    lanes: [],       // { id, label, color }
    phases: [],      // { id, label }
    nodes: [],       // { id, label, laneId, phaseId, shape, color }
    links: [],       // { from, to, label, style }
  };
}
const SHAPES = [
  { v:'process',  label:'処理（四角）' },
  { v:'start',    label:'開始（角丸）' },
  { v:'end',      label:'終了（角丸）' },
  { v:'decision', label:'判断（ひし形）' },
  { v:'io',       label:'入出力（平行四辺形）' },
  { v:'startdot', label:'開始点（●）' },
  { v:'enddot',   label:'終了点（◉）' },
];
/* 開始/終了の「●」。状態遷移図の [*] にあたるもので、他の図形より小さく描く */
const DOT_SHAPES = ['startdot','enddot'];
const DOT_SIZE = 26;
/* ●と接続先ノードの間隔。矢印の棒（矢じり約7px＋軸）がはっきり見える長さにする。 */
const DOT_GAP = 20;
const DOT_SLOT = DOT_SIZE + DOT_GAP;
const isDot = (shape)=> DOT_SHAPES.includes(shape);
const LINK_STYLES = [
  { v:'solid',  label:'実線' },
  { v:'dashed', label:'破線' },
];
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function quote(s){
  return '"' + String(s == null ? '' : s).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
}
/* 接続ラベルのおおよその表示幅（px）。ラベル背景の白丸角パネルの実際の幅と合わせて使う。
   全角文字は半角の約2倍として概算する（等幅ではないので目安値）。 */
function labelPixelWidth(label){
  return [...String(label || '')].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? 6 : 11), 0) + 10;
}
/* 見出し（レーン名・フェーズ名）のおおよその表示幅（px）。
   太字なので、全角はフォントサイズとほぼ同じ幅、半角はその約6割として概算する。 */
function headerTextWidth(label, fontSize){
  const f = fontSize || 12.5;
  return [...String(label || '')].reduce((n, ch)=> n + (/[\x00-\xff]/.test(ch) ? f * 0.58 : f), 0);
}
/* 幅が決まっている見出し（左の列）で使える行数。帯が厚いほど多く折り返せる。
   行数を固定にすると、長い名前が「…」で削られて読めなくなるため帯の厚みから決める。 */
function headerLines(size){
  return Math.max(2, Math.floor((size - 8) / 15));
}
function generateCode(state){
  const lines = ['swimlane'];
  if(state.title) lines.push('title ' + quote(state.title));
  lines.push('direction ' + state.direction);
  if(state.lanes.length){
    lines.push('');
    state.lanes.forEach(l=> lines.push(`lane ${l.id} ${quote(l.label)}${l.color ? ' ' + l.color : ''}`));
  }
  if(state.phases.length){
    lines.push('');
    state.phases.forEach(p=> lines.push(`phase ${p.id} ${quote(p.label)}`));
  }
  if(state.nodes.length){
    lines.push('');
    state.nodes.forEach(n=>{
      const attrs = [];
      if(n.laneId)  attrs.push('lane=' + n.laneId);
      if(n.phaseId) attrs.push('phase=' + n.phaseId);
      if(n.shape && n.shape !== 'process') attrs.push('shape=' + n.shape);
      if(n.color) attrs.push('color=' + n.color);
      lines.push(`node ${n.id} ${quote(n.label)}${attrs.length ? ' ' + attrs.join(' ') : ''}`);
    });
  }
  if(state.links.length){
    lines.push('');
    state.links.forEach(e=>{
      const arrow = e.style === 'dashed' ? '-->' : '->';
      lines.push(`${e.from} ${arrow} ${e.to}${e.label ? ' ' + quote(e.label) : ''}`);
    });
  }
  if(!state.lanes.length && !state.nodes.length){
    lines.push('');
    lines.push('# 左のフォームからレーンと図形を追加してください');
  }
  // 1行目 (swimlane) はキーワードなのでそのまま。Mermaid の記法に合わせて2行目以降を
  // インデントする（空行はそのまま）。見た目だけの調整で、parseCode は各行を trim して
  // 読むため、字下げの有無は解析結果に影響しない。
  return lines
    .map((ln, i) => (i === 0 || ln === '') ? ln : '    ' + ln)
    .join('\n');
}
function parseCode(text){
  const next = emptyState();
  const errors = [];
  const lines = String(text || '').split('\n');

  // "..." で囲まれたラベルを取り出しつつ、残りをトークンに分ける
  const takeLabel = (rest) => {
    const m = rest.match(/"((?:[^"\\]|\\.)*)"/);
    if(!m) return { label:'', rest };
    const label = m[1].replace(/\\(["\\])/g, '$1');
    return { label, rest: rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length) };
  };

  lines.forEach((raw, i)=>{
    const line = raw.trim();
    if(!line || line.startsWith('#') || line === 'swimlane') return;
    const lineNo = i + 1;

    if(/^title\b/.test(line)){ next.title = takeLabel(line).label; return; }
    if(/^direction\b/.test(line)){
      // フローチャートに合わせた表記。TD は TB の別名として受け付ける
      const d = (line.split(/\s+/)[1] || '').toUpperCase();
      next.direction = (d === 'TB' || d === 'TD') ? 'TB' : 'LR';
      return;
    }
    if(/^lane\b/.test(line)){
      const { label, rest } = takeLabel(line);
      const tok = rest.split(/\s+/).filter(Boolean);
      const id = tok[1];
      if(!id){ errors.push(`${lineNo}行目: lane のIDがありません`); return; }
      const color = (rest.match(/#[0-9A-Fa-f]{3,8}/) || [])[0] || '';
      next.lanes.push({ id, label: label || id, color });
      return;
    }
    if(/^phase\b/.test(line)){
      const { label, rest } = takeLabel(line);
      const id = rest.split(/\s+/).filter(Boolean)[1];
      if(!id){ errors.push(`${lineNo}行目: phase のIDがありません`); return; }
      next.phases.push({ id, label: label || id });
      return;
    }
    if(/^node\b/.test(line)){
      const { label, rest } = takeLabel(line);
      const tok = rest.split(/\s+/).filter(Boolean);
      const id = tok[1];
      if(!id){ errors.push(`${lineNo}行目: node のIDがありません`); return; }
      const attr = {};
      tok.slice(2).forEach(t=>{
        const eq = t.indexOf('=');
        if(eq > 0) attr[t.slice(0, eq)] = t.slice(eq + 1);
      });
      const shape = attr.shape || 'process';
      next.nodes.push({
        id, label: isDot(shape) ? label : (label || id),
        laneId: attr.lane || '', phaseId: attr.phase || '',
        shape, color: attr.color || '',
      });
      return;
    }
    // 接続: A -> B "ラベル" / A --> B
    const link = line.match(/^(\S+)\s*(-->|->)\s*(\S+)(.*)$/);
    if(link){
      next.links.push({
        from: link[1], to: link[3],
        label: takeLabel(link[4] || '').label,
        style: link[2] === '-->' ? 'dashed' : 'solid',
      });
      return;
    }
    errors.push(`${lineNo}行目: 解釈できない行です → ${line}`);
  });

  // 参照の整合性チェック
  const laneIds = next.lanes.map(l=>l.id);
  const phaseIds = next.phases.map(p=>p.id);
  const nodeIds = next.nodes.map(n=>n.id);
  next.nodes.forEach(n=>{
    if(n.laneId && !laneIds.includes(n.laneId)) errors.push(`node ${n.id}: レーン ${n.laneId} が見つかりません`);
    if(n.phaseId && !phaseIds.includes(n.phaseId)) errors.push(`node ${n.id}: フェーズ ${n.phaseId} が見つかりません`);
  });
  next.links.forEach(e=>{
    if(!nodeIds.includes(e.from)) errors.push(`接続 ${e.from} → ${e.to}: ${e.from} が見つかりません`);
    if(!nodeIds.includes(e.to)) errors.push(`接続 ${e.from} → ${e.to}: ${e.to} が見つかりません`);
  });
  return { state: next, errors };
}
const LAYOUT = {
  laneHeaderW: 132,   // レーン名の帯（LR時は左、TB時は上）
  phaseHeaderH: 38,   // フェーズ名の帯
  nodeW: 168, nodeH: 58,
  gapMain: 34,        // フェーズとフェーズの間隔
  gapInner: 22,       // 同じフェーズ内で流れ方向に並べるときの間隔
  gapCross: 18,       // レーンを横切る向き（分岐で枝を並べたとき）の間隔
};
/* 循環している経路の中から「戻りの1本」（DFSの後退辺）だけを見つける。
   循環に関わるリンクを全部よけてしまうと前後関係の手がかりまで消えてしまい、
   入口のノードが出口のノードより後ろに並ぶ（例: n18→n19→n20→n18 で n20 が先頭に来る）。
   戻りの1本だけを外せば、残りのリンクで 入口→…→出口 の順番が正しく決まる。 */
function findBackEdges(ids, links, orderOf, hasOuterPred){
  const idSet = ids instanceof Set ? ids : new Set(ids);
  const list = [...idSet];
  const out = new Map(list.map(id=> [id, []]));
  const indeg = new Map(list.map(id=> [id, 0]));
  const back = new Set();
  links.forEach(e=>{
    if(!idSet.has(e.from) || !idSet.has(e.to)) return;
    if(e.from === e.to){ back.add(e.from + '' + e.to); return; }   // 自分自身への線は常に戻り
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  });
  // DFSの起点は「入口らしい順」に選ぶ。
  //   1. 入ってくる線が無いノード（明らかな起点）
  //   2. 外（別セル/別レーン/●）から入ってくるノード（循環の入口）
  //   3. それ以外は元の並び順
  const rootRank = (id)=> indeg.get(id) === 0 ? 0 : (hasOuterPred(id) ? 1 : 2);
  const roots = list.slice().sort((a, b)=> (rootRank(a) - rootRank(b)) || (orderOf(a) - orderOf(b)));
  const mark = new Map();   // 1=探索中 2=探索済み
  const visit = (u)=>{
    mark.set(u, 1);
    out.get(u).forEach(v=>{
      const m = mark.get(v) || 0;
      if(m === 1) back.add(u + '' + v);   // 探索中のノードへ戻る＝循環の戻り
      else if(m === 0) visit(v);
    });
    mark.set(u, 2);
  };
  roots.forEach(id=>{ if(!mark.get(id)) visit(id); });
  return back;
}

function computeLayout(state){
  const L = LAYOUT;
  const dir = state.direction;
  const lanes = state.lanes;
  // フェーズ未定義でもノードだけで描けるよう、暗黙の1フェーズを用意する
  const phases = state.phases.length ? state.phases : [{ id:'__all', label:'' }];
  const hasPhaseHeader = state.phases.length > 0;

  // 開始/終了の●は、接続先ノードの隣（開始=左/上、終了=右/下）へ後から揃えて置く。
  // グリッドの列には入れないので、●のせいで列がずれて矢印が遠回りするのを防げる。
  const anchorNodeOf = (dot)=>{
    const linkId = dot.shape === 'startdot'
      ? (state.links.find(e=>e.from === dot.id) || {}).to
      : (state.links.find(e=>e.to === dot.id) || {}).from;
    if(!linkId) return null;
    const a = state.nodes.find(n=>n.id === linkId);
    return (a && !isDot(a.shape)) ? a : null;   // 相手も●なら揃えようがないのでグリッドに残す
  };
  const nodeOrder = new Map(state.nodes.map((n, i)=> [n.id, i]));   // 元の記述順（順番の手がかり）
  const dotPlace = new Map();   // dotNode -> anchorNode（隣に揃えて置く●）
  if(lanes.length){
    state.nodes.forEach(n=>{ if(isDot(n.shape)){ const a = anchorNodeOf(n); if(a) dotPlace.set(n, a); } });
  }
  // Keep the order of start-dot targets. Their first process nodes share one
  // flow slot so that the dots and their targets form aligned parallel starts.
  const startAnchorOrder = new Map();
  dotPlace.forEach((anchor, dot)=>{
    if(dot.shape !== 'startdot' || startAnchorOrder.has(anchor.id)) return;
    startAnchorOrder.set(anchor.id, state.nodes.indexOf(dot));
  });

  let hasLead = false, hasTrail = false;   // 先頭の開始● / 末尾の終了● のための余白が要るか
  dotPlace.forEach((a, d)=>{ if(d.shape === 'startdot') hasLead = true; else hasTrail = true; });
  const leadPad  = hasLead  ? DOT_SLOT : 0;
  const trailPad = hasTrail ? DOT_SLOT : 0;

  // セル(レーン×フェーズ)ごとにノードを詰める
  const cell = new Map();
  const key = (l,p)=> l + '\u001f' + p;
  const orphans = [];
  state.nodes.forEach(n=>{
    if(dotPlace.has(n)) return;   // 隣に揃えて置く●はグリッドから除外する
    const laneId = n.laneId || (lanes[0] && lanes[0].id);
    const phaseId = state.phases.length ? n.phaseId || phases[0].id : '__all';
    if(!laneId){ orphans.push(n); return; }
    const k = key(laneId, phaseId);
    if(!cell.has(k)) cell.set(k, []);
    cell.get(k).push(n);
  });

  // 図形1つ分の大きさ。流れ方向(main)とレーンを横切る方向(cross)で読み替える
  const nodeMain  = dir === 'LR' ? L.nodeW : L.nodeH;
  const nodeCross = dir === 'LR' ? L.nodeH : L.nodeW;

  // 各ノードから前向きに終了●へ到達できるか（開始→終了の本線を主列に置くのに使う。要求1）
  const reachesEnd = new Map();
  {
    const fwd = new Map();
    state.nodes.forEach(n=> fwd.set(n.id, []));
    state.links.forEach(e=>{ if(fwd.has(e.from)) fwd.get(e.from).push(e.to); });
    const endIds = new Set(state.nodes.filter(n=> n.shape === 'enddot').map(n=> n.id));
    const canReach = (id, seen)=>{
      if(reachesEnd.has(id)) return reachesEnd.get(id);
      if(seen.has(id)) return false;
      seen.add(id);
      let r = endIds.has(id);
      if(!r){ for(const v of (fwd.get(id) || [])){ if(canReach(v, seen)){ r = true; break; } } }
      seen.delete(id);
      if(!seen.size) reachesEnd.set(id, r);   // 確定値のみ記録（再帰途中の暫定値は残さない）
      return r;
    };
    state.nodes.forEach(n=> canReach(n.id, new Set()));
  }

  // セル内のノードを「フロー深さ(rank)」で並べる。
  //   ・rank = そのセル内で前につながる距離の最大（前がなければ0）
  //   ・独立したノード（同じセル内でつながっていない）は流れ方向に積む
  //     （＝レーンに足したノードは上下(TB)/左右(LR)にマージンを空けて並ぶ。要求3）
  //   ・同じ親を持つ枝だけ交差方向に横並び（LRは縦・TBは横。分岐が線を跨がない。仕様5/ルール3）
  //   ・つながっている場合は必ず TO が FROM より後ろ(下/右)の流れ位置になる（要求2）
  function computeCellLayout(list){
    const ids = new Set(list.map(n=>n.id));
    // 循環（例: n18→n19→n20→n18）は戻りの1本だけを無視する。全部無視すると
    // 順番の手がかりが消えて、入口(n18)が出口(n20)より後ろに並んでしまう。
    const back = findBackEdges(
      ids, state.links,
      (id)=> nodeOrder.has(id) ? nodeOrder.get(id) : 0,
      (id)=> state.links.some(e=> e.to === id && e.from !== id && !ids.has(e.from)),
    );
    const predOf = (id)=> state.links
      .filter(e=>e.to === id && ids.has(e.from) && e.from !== id && !back.has(e.from + '' + id))
      .map(e=>e.from);
    const rank = new Map();
    const rankOf = (id, seen)=>{
      if(rank.has(id)) return rank.get(id);
      if(seen.has(id)) return 0;      // 循環しても止まるように
      seen.add(id);
      let r = 0;
      predOf(id).forEach(p=>{ r = Math.max(r, rankOf(p, seen) + 1); });
      seen.delete(id);
      rank.set(id, r);
      return r;
    };
    list.forEach(n=> rankOf(n.id, new Set()));
    // rank ごとにまとめ、元の並び順を保つ
    const byRank = new Map();
    list.forEach(n=>{ const r = rank.get(n.id); if(!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(n); });
    const ranks = [...byRank.keys()].sort((a,b)=>a-b);
    // 各 rank を「流れスロット」に割り振る。
    //   ・親を持たない（独立/起点）ノードはそれぞれ単独スロット＝流れ方向に積む
    //   ・同じ親集合の枝はひとつのスロットにまとめ、交差方向に横並びにする
    const pos = new Map();
    let flow = 0, crossCount = 0;
    ranks.forEach(r=>{
      const slots = [];              // 各要素が1つの流れスロット（中身は交差方向に並ぶ）
      const byParent = new Map();    // 親集合キー -> 交差方向に並べる枝
      byRank.get(r).forEach(n=>{
        const ps = predOf(n.id);
        if(startAnchorOrder.has(n.id)){
          const pk = '__start_anchors__';
          if(!byParent.has(pk)){ const arr = []; byParent.set(pk, arr); slots.push(arr); }
          byParent.get(pk).push(n);
        }else if(ps.length === 0){
          slots.push([n]);           // independent roots use separate flow slots
        }else{
          const pk = ps.slice().sort().join(',');
          if(!byParent.has(pk)){ const arr = []; byParent.set(pk, arr); slots.push(arr); }
          byParent.get(pk).push(n);
        }

      });
      slots.forEach(sg=>{
        // 分岐の枝は、終了●へ到達できる本線を cross0 に置く。
        // こうすると開始の真下(TB)/右(LR)に終了が並ぶ（要求1）。到達可否が同じなら元の順を保つ。
        if(sg.some(n=> startAnchorOrder.has(n.id))){
          sg.sort((p, q)=> (startAnchorOrder.get(p.id) ?? Infinity) - (startAnchorOrder.get(q.id) ?? Infinity));
        }else if(sg.length > 1){
          sg.sort((p, q)=> (reachesEnd.get(q.id) ? 1 : 0) - (reachesEnd.get(p.id) ? 1 : 0));
        }
        sg.forEach((n, cross)=> pos.set(n.id, { flow, cross }));
        crossCount = Math.max(crossCount, sg.length);
        flow++;
      });
    });
    return { pos, flowCount: flow, crossCount };
  }

  // --- 連結成分（フロー）を求める。開始●〜終了◉ の一続きを1グループとして扱う ---
  const compId = new Map();
  {
    const adj = new Map();
    state.nodes.forEach(n=> adj.set(n.id, []));
    state.links.forEach(e=>{ if(adj.has(e.from) && adj.has(e.to)){ adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); } });
    let c = 0;
    state.nodes.forEach(n=>{
      if(compId.has(n.id)) return;
      const st = [n.id]; compId.set(n.id, c);
      while(st.length){ const u = st.pop(); adj.get(u).forEach(v=>{ if(!compId.has(v)){ compId.set(v, c); st.push(v); } }); }
      c++;
    });
  }
  const compSize = new Map();
  state.nodes.forEach(n=>{ const c = compId.get(n.id); compSize.set(c, (compSize.get(c) || 0) + 1); });
  // 2ノード以上つながっていれば「フロー」。単独ノードは 'misc' に集めて流れ方向に積む（要求3）
  const MISC = 'misc';
  const bucketKeyOf = (n)=> (compSize.get(compId.get(n.id)) >= 2) ? ('g' + compId.get(n.id)) : MISC;

  // レーンごとに、フロー(連結成分)を交差方向へ並列に割り当てる（開始〜終了を1グループに）。
  //   ・各フロー=1トラック。レーン内の全フェーズで同じ交差位置を使うので、TBは横並び・LRは縦並びになる。
  //   ・トラックの中はこれまで通り rank(流れ) と 枝(交差) で並べる。
  const nodePos = new Map();          // node.id -> { flow, cross }
  const cellFlowCount = new Map();    // key(l,p) -> そのセルの流れ方向スロット数
  const laneCross = new Map();        // laneId -> 交差方向の列数
  lanes.forEach(l=>{
    // このレーンに現れるバケツ（フロー/misc）を初出順に並べる
    const order = []; const seen = new Set();
    phases.forEach(p=> (cell.get(key(l.id, p.id)) || []).forEach(n=>{
      const bk = bucketKeyOf(n);
      if(!seen.has(bk)){ seen.add(bk); order.push(bk); }
    }));
    // 各バケツのセルごとの局所レイアウトと、レーン内での交差幅・占有フェーズを求める
    const local = new Map();    // bk -> Map(phaseId -> cl)
    const widthOf = new Map();  // bk -> 交差列数（レーン内最大）
    const phasesOf = new Map(); // bk -> このバケツがノードを持つフェーズid配列
    order.forEach(bk=>{
      const byPhase = new Map(); let w = 1; const ph = [];
      phases.forEach(p=>{
        const sub = (cell.get(key(l.id, p.id)) || []).filter(n=> bucketKeyOf(n) === bk);
        const cl = computeCellLayout(sub);
        byPhase.set(p.id, cl);
        if(sub.length) ph.push(p.id);
        w = Math.max(w, cl.crossCount);
      });
      local.set(bk, byPhase); widthOf.set(bk, w); phasesOf.set(bk, ph);
    });
    // 交差列の割り当て。フェーズが重ならないバケツ同士は同じ列を共有してよい（要求: 別フェーズなら同位置OK）。
    // フェーズ占有が重なるバケツだけ別の列に置く（区間ごとの詰め込み＝first-fit）。
    const occ = new Map();   // phaseId -> Set(占有中の列index)
    phases.forEach(p=> occ.set(p.id, new Set()));
    const baseOf = new Map();
    let laneCols = 0;
    order.forEach(bk=>{
      const w = widthOf.get(bk), ph = phasesOf.get(bk);
      let base = 0;
      for(;;){
        let ok = true;
        for(const pid of ph){ const s = occ.get(pid);
          for(let c = base; c < base + w; c++){ if(s.has(c)){ ok = false; break; } }
          if(!ok) break;
        }
        if(ok) break;
        base++;
      }
      ph.forEach(pid=>{ const s = occ.get(pid); for(let c = base; c < base + w; c++) s.add(c); });
      baseOf.set(bk, base);
      laneCols = Math.max(laneCols, base + w);
    });
    laneCross.set(l.id, Math.max(1, laneCols));
    // 各ノードの最終 (flow, cross) と、セルの流れ方向スロット数を確定
    phases.forEach(p=>{
      let flowMax = 0;
      order.forEach(bk=>{
        const cl = local.get(bk).get(p.id);
        flowMax = Math.max(flowMax, cl.flowCount);
        cl.pos.forEach((pc, id)=> nodePos.set(id, { flow: pc.flow, cross: baseOf.get(bk) + pc.cross }));
      });
      cellFlowCount.set(key(l.id, p.id), flowMax);
    });
  });

  // 同一フェーズで別のレーンへ渡るエッジは、左右どちら向きでも TO を FROM の1つ後ろの
  // 流れ位置へ下げる。こうすると FROM の下(TB)/右(LR)から出て TO の上(TB)/左(LR)へ入る、
  // 自然な下向き（右向き）フローに揃い、横や上に戻る線を避けられる。
  // 下げたノードに続く同じセル内の後続も一緒に下げる。そうしないと
  // 「下げたノード」だけが後ろへ動いて、後続が前に取り残され、並び順が逆転してしまう。
  {
    const phaseOf = (n)=> state.phases.length ? (n.phaseId || phases[0].id) : '__all';
    const laneOf  = (n)=> n.laneId || (lanes[0] && lanes[0].id);
    const nodeById = new Map(state.nodes.map(n=> [n.id, n]));
    const isPlain = (n)=> !!n && !isDot(n.shape);
    // 循環している経路は「戻りの1本」だけ押し下げの対象外にする。
    // 循環に関わる線を全部よけると順序が決まらず、入口のノード(n18)が
    // 出口のノード(n20)より後ろに置かれたままになる。戻りの1本だけ外せば
    // 残りは前→後ろに押し下げられ、押し合って下がり続けることもない。
    const plainIds = new Set(state.nodes.filter(isPlain).map(n=> n.id));
    const samePhaseLinks = state.links.filter(e=>{
      const A = nodeById.get(e.from), B = nodeById.get(e.to);
      return isPlain(A) && isPlain(B) && phaseOf(A) === phaseOf(B);
    });
    const backLinks = findBackEdges(
      plainIds, samePhaseLinks,
      (id)=> nodeOrder.has(id) ? nodeOrder.get(id) : 0,
      // 別フェーズや●から入ってくるノードは、そのかたまりの入口とみなす
      (id)=> state.links.some(e=>{
        const A = nodeById.get(e.from);
        return e.to === id && e.from !== id && (!isPlain(A) || phaseOf(A) !== phaseOf(nodeById.get(id)));
      }),
    );
    // 同一フェーズのリンクだけをたどれる隣接表。後続ノードの判定に使う。
    // 戻りの1本は入れない。入れるとループの先（例: n2→n3→n4→n2 の n3）が
    // 「n2の後続」と見なされず、n2が n3 を飛び越えた位置まで押し下げられて、
    // 間に何も無い空きスロットができてしまう。
    const fwd = new Map();
    state.nodes.forEach(n=> fwd.set(n.id, []));
    state.links.forEach(e=>{
      const A = nodeById.get(e.from), B = nodeById.get(e.to);
      if(!isPlain(A) || !isPlain(B) || phaseOf(A) !== phaseOf(B)) return;
      if(backLinks.has(e.from + '' + e.to)) return;
      fwd.get(e.from).push(e.to);
    });
    const reachMemo = new Map();
    const reaches = (from, target)=>{
      const mk = from + '' + target;
      if(reachMemo.has(mk)) return reachMemo.get(mk);
      const seen = new Set(); const st = (fwd.get(from) || []).slice();
      let found = false;
      while(st.length){
        const u = st.pop();
        if(u === target){ found = true; break; }
        if(seen.has(u)) continue;
        seen.add(u);
        (fwd.get(u) || []).forEach(v=> st.push(v));
      }
      reachMemo.set(mk, found);
      return found;
    };
    // 動かすノードの後続（あとで一緒に押し下げられる）は、空きを探すときの障害物として数えない。
    // 数えてしまうと自分の後続を飛び越えた位置まで下がってしまい、
    // 間に何も無いのに大きな空白ができる。
    const isDescendant = (movedId, otherId)=> reaches(movedId, otherId) && !reaches(otherId, movedId);
    const occupied = (ck, flow, cross, movedId)=>
      (cell.get(ck) || []).some(n=>{
        if(n.id === movedId || isDescendant(movedId, n.id)) return false;
        const p = nodePos.get(n.id);
        return p && p.flow === flow && p.cross === cross;
      });
    const cyclic = new Set();
    state.links.forEach((e, li)=>{
      if(backLinks.has(e.from + '' + e.to)) cyclic.add(li);
    });
    // 追従させる後続を決めるための元の並び順。
    // 同じセル内は「もともと後ろにいた後続」だけを追従対象にする。
    const origFlow = new Map();
    state.nodes.forEach(n=>{ const p = nodePos.get(n.id); if(p) origFlow.set(n.id, p.flow); });
    let changed = true, guard = 0;
    while(changed && guard++ < 30){
      changed = false;
      state.links.forEach((e, li)=>{
        const A = nodeById.get(e.from), B = nodeById.get(e.to);
        if(!isPlain(A) || !isPlain(B)) return;
        if(phaseOf(A) !== phaseOf(B)) return;                              // 同一フェーズのみ
        if(cyclic.has(li)) return;                                         // 循環しているエッジは動かさない
        // 同じセル内の後続: もともと後ろにいたものだけ、前に来ないよう追従させる
        if(laneOf(A) === laneOf(B) && !(origFlow.get(B.id) > origFlow.get(A.id))) return;
        const pa = nodePos.get(A.id), pb = nodePos.get(B.id);
        if(!pa || !pb || pb.flow > pa.flow) return;
        let f = pa.flow + 1;
        while(occupied(key(laneOf(B), phaseOf(B)), f, pb.cross, B.id)) f++;
        nodePos.set(B.id, { flow: f, cross: pb.cross });
        changed = true;
      });
    }
    // 念のための後始末: 同じセルで同じ位置に居残ったものがあれば、順番を保ったまま後ろへずらす。
    // 押し下げが繰り返し上限で打ち切られても、ノードどうしが重ならないようにする。
    lanes.forEach(l=> phases.forEach(p=>{
      const ck = key(l.id, p.id);
      const list = (cell.get(ck) || []).slice().sort((x, y)=>{
        const px = nodePos.get(x.id), py = nodePos.get(y.id);
        return ((px && px.flow) || 0) - ((py && py.flow) || 0);
      });
      const used = new Set();
      list.forEach(n=>{
        const pos = nodePos.get(n.id);
        if(!pos) return;
        let f = pos.flow;
        while(used.has(f + '' + pos.cross)) f++;
        used.add(f + '' + pos.cross);
        if(f !== pos.flow) nodePos.set(n.id, { flow: f, cross: pos.cross });
      });
    }));
    // 下げた分、各セルの流れ数を数え直す
    lanes.forEach(l=> phases.forEach(p=>{
      let mx = 0;
      (cell.get(key(l.id, p.id)) || []).forEach(n=>{ const pp = nodePos.get(n.id); if(pp) mx = Math.max(mx, pp.flow + 1); });
      cellFlowCount.set(key(l.id, p.id), mx);
    }));
  }

  // フェーズの幅 = そのフェーズでいちばん多く流れ方向に並ぶ数（レーンをまたいで揃える）
  const phaseRuns = phases.map(p=>{
    let max = 1;
    lanes.forEach(l=> max = Math.max(max, cellFlowCount.get(key(l.id, p.id)) || 0));
    return max;
  });
  // レーンの厚み = そのレーンの交差方向の列数（並列フローの分だけ広がる）
  const laneRuns = lanes.map(l=> Math.max(1, laneCross.get(l.id) || 0));

  const headerMain = dir === 'LR' ? L.laneHeaderW : L.phaseHeaderH;
  const mainStart = headerMain + leadPad;   // 先頭に開始●があれば、その分だけ流れ方向にずらす
  const crossStart = dir === 'LR'
    ? (hasPhaseHeader ? L.phaseHeaderH : 0)
    : (hasPhaseHeader ? L.laneHeaderW : 0);

  // 上フェーズの終了●と下フェーズの開始●が同じ列に来る境界は、●2つが縦に並ぶ隙間を空ける。
  // （同じ列を共有したまま、横へずらさず上下に離して衝突を避ける）
  const gapAfter = phases.map(()=> L.gapMain);
  {
    const recOf = (dot)=>{
      const anchor = dotPlace.get(dot);
      const pos = anchor && nodePos.get(anchor.id);
      if(!pos) return null;
      const laneId = anchor.laneId || (lanes[0] && lanes[0].id);
      const phaseId = state.phases.length ? (anchor.phaseId || phases[0].id) : '__all';
      return { pj: phases.findIndex(p=> p.id === phaseId), laneId, cross: pos.cross };
    };
    const ends = [], starts = [];
    dotPlace.forEach((anchor, dot)=>{
      const r = recOf(dot); if(!r) return;
      (dot.shape === 'enddot' ? ends : starts).push(r);
    });
    const need = DOT_SLOT * 2 + 14;   // ●2つ分＋間の隙間
    for(let j = 0; j < phases.length - 1; j++){
      const collide = ends.some(e=> e.pj === j &&
        starts.some(s=> s.pj === j + 1 && s.laneId === e.laneId && s.cross === e.cross));
      if(collide) gapAfter[j] = Math.max(L.gapMain, need);
    }
  }
  // 隣接フェーズをまたぐラベル付き接続にも、ラベルの前後に矢印の棒が出るよう間隔を広げる（要求1.2）。
  // 必要な間隔はラベルの実際の表示幅から求める。固定値だと長いラベルで背景パネルが線を覆い隠してしまう。
  for(let j = 0; j < phases.length - 1; j++){
    let need = 0;
    state.links.forEach(e=>{
      if(!e.label) return;
      const A = state.nodes.find(n=> n.id === e.from), B = state.nodes.find(n=> n.id === e.to);
      if(!A || !B) return;
      const ap = state.phases.length ? (A.phaseId || phases[0].id) : '__all';
      const bp = state.phases.length ? (B.phaseId || phases[0].id) : '__all';
      const aj = phases.findIndex(p=> p.id === ap), bj = phases.findIndex(p=> p.id === bp);
      if((aj === j && bj === j + 1) || (aj === j + 1 && bj === j)) need = Math.max(need, labelPixelWidth(e.label) + 16);
    });
    if(need) gapAfter[j] = Math.max(gapAfter[j], need);
  }

  // フェーズ内にラベル付きの接続があると、流れ方向の間隔を広げてラベルの前後に棒を出す（要求1.2）。
  // こちらも同様に、ラベルの実際の表示幅から必要な間隔を求める（要求1.2）。
  const phaseGap = phases.map(p=>{
    let need = L.gapInner;
    state.links.forEach(e=>{
      if(!e.label) return;
      const A = state.nodes.find(n=> n.id === e.from), B = state.nodes.find(n=> n.id === e.to);
      if(!A || !B) return;
      const ap = state.phases.length ? (A.phaseId || phases[0].id) : '__all';
      const bp = state.phases.length ? (B.phaseId || phases[0].id) : '__all';
      if(ap === p.id && bp === p.id) need = Math.max(need, labelPixelWidth(e.label) + 16);
    });
    return need;
  });

  const phaseBands = [];
  let main = mainStart;
  phases.forEach((p, j)=>{
    let size = phaseRuns[j] * nodeMain + (phaseRuns[j] - 1) * phaseGap[j];
    // LRではフェーズ名が上の細い帯（高さ38px固定）に横書きで入る。縦には広げられないので、
    // 名前が帯より長いときは帯の長さ（流れ方向）を広げる。広げないとはみ出して切れる。
    if(hasPhaseHeader && dir === 'LR') size = Math.max(size, headerTextWidth(p.label, 12) + 16);
    phaseBands.push({ phase:p, index:j, start:main, size });
    main += size + gapAfter[j];
  });
  let mainTotal = main - L.gapMain + L.gapMain / 2 + trailPad;   // 末尾の終了●の分も確保（最終境界は既定gap）

  const laneBands = [];
  let cross = crossStart;
  lanes.forEach((l, i)=>{
    let size = laneRuns[i] * nodeCross + (laneRuns[i] + 1) * L.gapCross;
    // TBではレーン名が上の細い帯（高さ38px固定）に横書きで入る。フェーズ名と同じ理由で、
    // 名前が帯より長いときはレーンの厚みを広げる。
    if(dir === 'TB') size = Math.max(size, headerTextWidth(l.label, 12.5) + 16);
    laneBands.push({ lane:l, index:i, start:cross, size });
    cross += size;
  });
  const crossTotal = cross;

  // 図形の矩形を決める
  const boxes = [];
  lanes.forEach((l, i)=>{
    const band = laneBands[i];
    phases.forEach((p, j)=>{
      const list = cell.get(key(l.id, p.id)) || [];
      list.forEach((n)=>{
        const { flow: col, cross: row } = nodePos.get(n.id);
        const mainPos  = phaseBands[j].start + col * (nodeMain + phaseGap[j]);
        const crossPos = band.start + L.gapCross + row * (nodeCross + L.gapCross);
        const slot = dir === 'LR'
          ? { x: mainPos, y: crossPos, w: L.nodeW, h: L.nodeH }
          : { x: crossPos, y: mainPos, w: L.nodeW, h: L.nodeH };
        // ●は枠を小さくする。矢印は矩形の縁から引くので、ここを縮めないと線が離れて見える
        const box = isDot(n.shape)
          ? { x: slot.x + (slot.w - DOT_SIZE)/2, y: slot.y + (slot.h - DOT_SIZE)/2, w: DOT_SIZE, h: DOT_SIZE }
          : slot;
        boxes.push({ node:n, index: state.nodes.indexOf(n), ...box });
      });
    });
  });

  // 開始/終了の●を、接続先ノードの手前(左/上)・先(右/下)へ、交差軸を揃えて置く。
  // ・開始●は接続先の左(LR)/上(TB)、終了●は右(LR)/下(TB)  … 仕様1・2
  // ・交差軸(LRならy、TBならx)を接続先に合わせるので、矢印はまっすぐ引ける … 仕様3
  const gridBoxes = boxes.slice();   // ●を足す前の図形だけ（重なり判定に使う）
  const boxByNode = new Map(boxes.map(b=>[b.node, b]));
  const dotBoxes = [];

  // Place multiple start dots from one lane/phase as a single row (TB) or column (LR).
  const startGroups = new Map();
  dotPlace.forEach((anchor, dot)=>{
    if(dot.shape !== 'startdot') return;
    const laneId = anchor.laneId || (lanes[0] && lanes[0].id);
    const phaseId = state.phases.length ? (anchor.phaseId || phases[0].id) : '__all';
    const groupKey = laneId + '\u001f' + phaseId;
    if(!startGroups.has(groupKey)) startGroups.set(groupKey, []);
    startGroups.get(groupKey).push({ anchor, dot, laneId });
  });
  const startSlot = new Map();
  startGroups.forEach(group=>{
    if(group.length < 2) return;
    group.sort((p, q)=> state.nodes.indexOf(p.dot) - state.nodes.indexOf(q.dot));
    const anchorBoxes = group.map(g=>boxByNode.get(g.anchor)).filter(Boolean);
    if(!anchorBoxes.length) return;
    if(dir === 'TB'){
      const y = Math.max(headerMain, Math.min(...anchorBoxes.map(ab=>ab.y - DOT_SLOT)));
      group.forEach(g=>{
        const ab = boxByNode.get(g.anchor);
        startSlot.set(g.dot, { x:ab.x + (ab.w - DOT_SIZE)/2, y });
      });
    }else{
      const x = Math.max(headerMain, Math.min(...anchorBoxes.map(ab=>ab.x - DOT_SLOT)));
      group.forEach(g=>{
        const ab = boxByNode.get(g.anchor);
        startSlot.set(g.dot, { x, y:ab.y + (ab.h - DOT_SIZE)/2 });
      });
    }
  });
  dotPlace.forEach((a, d)=>{
    const ab = boxByNode.get(a);
    if(!ab) return;   // 接続先がグリッドに無い（通常は起きない）
    let x, y;
    const grouped = startSlot.get(d);
    if(grouped){
      ({ x, y } = grouped);
    }else if(dir === 'LR'){
      y = ab.y + (ab.h - DOT_SIZE)/2;
      x = d.shape === 'startdot'
        ? Math.max(headerMain, ab.x - DOT_SLOT)   // ヘッダーの帯には食い込ませない
        : ab.x + ab.w + DOT_GAP;
    }else{
      x = ab.x + (ab.w - DOT_SIZE)/2;
      y = d.shape === 'startdot'
        ? Math.max(headerMain, ab.y - DOT_SLOT)
        : ab.y + ab.h + DOT_GAP;
    }
    const db = { node:d, index: state.nodes.indexOf(d), x, y, w:DOT_SIZE, h:DOT_SIZE };
    boxes.push(db); dotBoxes.push(db);
  });

  // ●が図形や他の●と重なるケース（別フェーズのフローが同じ列を共有する等）は、
  // 交差軸方向へずらして重なりを消す。図形はグリッドで重ならないので、動かすのは●だけ。
  // （要求: ノードは重ねない／別フェーズの開始・終了●が重ならないようにする）
  const overlap = (a,b)=> Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x) > 0
                        && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y) > 0;
  for(let pass = 0; pass < 6; pass++){
    let moved = false;
    dotBoxes.forEach(db=>{
      const others = gridBoxes.concat(dotBoxes.filter(o=> o !== db));
      for(let guard = 0; guard < 8; guard++){
        const hit = others.find(o=> overlap(db, o));
        if(!hit) break;
        if(dir === 'LR'){   // 交差軸=y。●の中心が相手中心より上なら上へ、そうでなければ下へ逃がす
          const up = (db.y + db.h/2) <= (hit.y + hit.h/2);
          db.y = up ? hit.y - db.h - 4 : hit.y + hit.h + 4;
        }else{              // 交差軸=x
          const left = (db.x + db.w/2) <= (hit.x + hit.w/2);
          db.x = left ? hit.x - db.w - 4 : hit.x + hit.w + 4;
        }
        moved = true;
      }
    });
    if(!moved) break;
  }

  // フェーズ帯を、そのフェーズのノード＋●を含む範囲まで広げる（要求2）。
  // ●は接続先(anchor)のフェーズに属するとみなし、流れ方向(TBは縦・LRは横)の範囲を測る。
  if(phases.length){
    const phaseIdOf = (n)=> state.phases.length ? (n.phaseId || phases[0].id) : '__all';
    const dotPhase = new Map();
    dotPlace.forEach((anchor, d)=> dotPhase.set(d, phaseIdOf(anchor)));
    const lo = phases.map(()=> Infinity), hi = phases.map(()=> -Infinity);
    boxes.forEach(b=>{
      const pid = isDot(b.node.shape) ? dotPhase.get(b.node) : phaseIdOf(b.node);
      const j = phases.findIndex(p=> p.id === pid);
      if(j < 0) return;
      const s = dir === 'LR' ? b.x : b.y, e = dir === 'LR' ? b.x + b.w : b.y + b.h;
      lo[j] = Math.min(lo[j], s); hi[j] = Math.max(hi[j], e);
    });
    // 前の帯の終端を覚えておき、重ならないように順に確定する。
    // ノードが無いフェーズは既定の幅（phaseRuns基準のサイズ）を保ったまま、位置だけ前の帯に合わせる。
    let prevEnd = null;
    phases.forEach((p, j)=>{
      if(lo[j] === Infinity){
        const s = prevEnd != null ? prevEnd + L.gapMain / 2 : phaseBands[j].start;
        phaseBands[j].start = s;                    // size は既定値のまま変更しない
        prevEnd = s + phaseBands[j].size;
        return;
      }
      let s = lo[j] - 6, e = hi[j] + 6;
      if(prevEnd != null) s = Math.max(s, (prevEnd + lo[j]) / 2);  // 直前とは中間で分ける
      if(j === 0) s = Math.max(headerMain, s);
      // LRではフェーズ名が上の細い帯（高さ38px固定）に横書きで入る。ノードの位置ぴったりに
      // 詰めると名前がはみ出して切れるので、名前に要る長さは残す。
      // 帯どうしの間隔は上で名前のぶんを見込んで取ってあるので、ここで広げても隣とぶつからない。
      if(hasPhaseHeader && dir === 'LR') e = Math.max(e, s + headerTextWidth(p.label, 12) + 16);
      phaseBands[j].start = s;
      phaseBands[j].size = Math.max(0, e - s);
      prevEnd = e;
    });
    // 帯の拡張で末尾が伸びていれば、全体サイズもそれに合わせる（描画が切れないように）
    const lastBand = phaseBands[phases.length - 1];
    mainTotal = Math.max(mainTotal, lastBand.start + lastBand.size + trailPad + L.gapMain / 2);
  }

  const width  = dir === 'LR' ? mainTotal : crossTotal;
  const height = dir === 'LR' ? crossTotal : mainTotal;

  return {
    dir, lanes, phases, hasPhaseHeader,
    laneBands, phaseBands, boxes, orphans,
    dotAnchor: dotPlace,   // ●(dotNode) -> 接続先ノード。描画時に●の実際のレーンを判定するのに使う
    width: Math.max(width, 320),
    height: Math.max(height, 160),
    boxById: new Map(boxes.map(b=>[b.node.id, b])),
  };
}
function shapeElement(b, shape, fill){
  const { x, y, w, h } = b;
  const st = ` fill="${esc(fill)}" stroke="#42506B" stroke-width="1.6"`;
  if(shape === 'startdot' || shape === 'enddot'){
    const cx = x + w/2, cy = y + h/2;
    const outer = `<circle class="sl-shape" cx="${cx}" cy="${cy}" r="${w/2}" fill="#42506B" stroke="#42506B" stroke-width="1.6"></circle>`;
    // 終了は状態遷移図と同じく二重丸で表す
    return shape === 'enddot'
      ? outer + `<circle cx="${cx}" cy="${cy}" r="${w/2 - 4}" fill="#FFFFFF"></circle><circle cx="${cx}" cy="${cy}" r="${w/2 - 7}" fill="#42506B"></circle>`
      : outer;
  }
  if(shape === 'decision'){
    return `<polygon class="sl-shape" points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}"${st}></polygon>`;
  }
  if(shape === 'io'){
    const s = 16;
    return `<polygon class="sl-shape" points="${x+s},${y} ${x+w},${y} ${x+w-s},${y+h} ${x},${y+h}"${st}></polygon>`;
  }
  const r = (shape === 'start' || shape === 'end') ? h/2 : 7;
  return `<rect class="sl-shape" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"${st}></rect>`;
}

/* 折れ線で結ぶ。前後関係（流れ方向）に応じて経路を変える。
   jogIdx: 他の線と重なったときに少しずつ経路をずらすための試行回数（0始まり）。
   ctx.allowCrossIn: 横の出力辺（TB=右 / LR=下）から入ってよいか
     （要求5の例外。TO側に出力が1本も無いときだけ true）。 */
function linkPath(a, b, dir, jogIdx, ctx){
  const ac = { x:a.x + a.w/2, y:a.y + a.h/2 };
  const bc = { x:b.x + b.w/2, y:b.y + b.h/2 };
  const jog = (jogIdx || 0) * 8;
  const allowCrossIn = !!(ctx && ctx.allowCrossIn);
  // 線はどれも辺の中央から出す。同じ点から2本出てしまった場合だけ、
  // 描画側（spreadRoot）が根元を辺に沿ってずらす。
  if(dir === 'LR'){
    // 別レーンをまたぐ接続（前進・後退どちらも）は、レーンとレーンの間の隙間
    // （ノードが絶対に無い帯）を通って短く行き来する。同じ列（同フェーズ）はこの後で個別に扱う。
    if(ctx && ctx.gapCross != null && Math.abs(a.x - b.x) >= 1){
      // 同じ隙間を通る他の辺と重ならないよう、隙間内での通り道も少しずつずらす。
      const gyJog = jogIdx ? Math.ceil(jogIdx / 2) * 4 * (jogIdx % 2 ? 1 : -1) : 0;
      const gy = ctx.gapCross + gyJog;
      const clearX = b.x - 18 - jog;
      if(b.x > a.x + a.w - 1){
        // 前進: FROMの右辺（最優先）から出て、隙間を経由してTOの左辺へ入れる
        const sx = a.x + a.w, nearX = sx + 14 + jog;
        const d = `M ${sx} ${ac.y} H ${nearX} V ${gy} H ${clearX} V ${bc.y} H ${b.x}`;
        return { d, tip:{ x:b.x, y:bc.y, dirn:'right' }, mid:{ x:clearX, y:(gy + bc.y)/2 } };
      }
      // 後退・横移動: TOの横の出力辺(下)を出力が使っていなければ、外側(下)を回ってそこへ入れる。
      // レーンの隙間を通すと、同じ所から出る前進の線と根元が重なりやすいため（要求5の例外）。
      if(allowCrossIn){
        const back = Math.max(a.y + a.h, b.y + b.h) + 22 + jog;
        // ラベルは長い横棒の真ん中ではなくFROMのすぐ下に置く。真ん中だと、
        // 同じあたりを通る別の線のラベルと見分けがつかなくなるため。
        return { d:`M ${ac.x} ${a.y + a.h} V ${back} H ${bc.x} V ${b.y + b.h}`,
                 tip:{ x:bc.x, y:b.y + b.h, dirn:'up' },
                 mid:{ x:ac.x, y:Math.min(a.y + a.h + 26, back) } };
      }
      // そうでなければ出力は右/下だけから出す（要求5）。TOのレーンが下なら下辺、上なら右辺から出て、
      // TOへは常に左辺から入る（要求2に整合）。
      if(gy > ac.y){
        const sy = a.y + a.h;
        const d = `M ${ac.x} ${sy} V ${gy} H ${clearX} V ${bc.y} H ${b.x}`;
        return { d, tip:{ x:b.x, y:bc.y, dirn:'right' }, mid:{ x:clearX, y:(gy + bc.y)/2 } };
      }
      const sideX = a.x + a.w + 14 + jog;
      const d = `M ${a.x + a.w} ${ac.y} H ${sideX} V ${gy} H ${clearX} V ${bc.y} H ${b.x}`;
      return { d, tip:{ x:b.x, y:bc.y, dirn:'right' }, mid:{ x:clearX, y:(gy + bc.y)/2 } };
    }
    if(b.x > a.x + a.w - 1){                    // 前進（同じレーン）
      const sx = a.x + a.w, ex = b.x;
      const span = ex - sx;
      const mx = span > 24 ? Math.min(Math.max((sx + ex) / 2 + jog, sx + 6), ex - 6) : (sx + ex) / 2;
      return { d:`M ${sx} ${ac.y} H ${mx} V ${bc.y} H ${ex}`, tip:{ x:ex, y:bc.y, dirn:'right' },
               mid:{ x:mx, y:(ac.y + bc.y)/2 } };
    }
    if(Math.abs(a.x - b.x) < 1){                // 同じフェーズ（レーン間）
      if(bc.y > ac.y){                          // 下のレーンへ: TOの上辺へ入る（要求2）
        const sy = a.y + a.h, ey = b.y;
        return { d:`M ${ac.x} ${sy} V ${ey}`, tip:{ x:ac.x, y:ey, dirn:'down' }, mid:{ x:ac.x, y:(sy + ey)/2 } };
      }
      // 上のレーンへ戻る: 出口は右辺（前進の出力辺）。列の右の余白を上がり、TOの上辺へ入れる（要求5）
      const escX = a.x + a.w + 18 + jog;
      const topY = b.y - 22 - jog;
      return { d:`M ${a.x + a.w} ${ac.y} H ${escX} V ${topY} H ${bc.x} V ${b.y}`, tip:{ x:bc.x, y:b.y, dirn:'down' },
               mid:{ x:(escX + bc.x)/2, y:topY } };
    }
    // 後退（差戻しなど、同じレーン）
    if(allowCrossIn){                           // TOの下辺が空いていれば: 下側を回り込みそこへ入れる（要求5の例外）
      const back = Math.max(a.y + a.h, b.y + b.h) + 22 + jog;
      // ラベルはFROMのすぐ下に置く（長い横棒の真ん中だと、どの線のラベルか分からなくなる）
      return { d:`M ${ac.x} ${a.y + a.h} V ${back} H ${bc.x} V ${b.y + b.h}`,
               tip:{ x:bc.x, y:b.y + b.h, dirn:'up' },
               mid:{ x:ac.x, y:Math.min(a.y + a.h + 26, back) } };
    }
    // それ以外: TOの下は使わず、上へ回り込んでTOの上辺へ入れる
    // nearY/topY も少しずつずらせるようにし、同じ相手へ戻る複数の線が完全に重ならないようにする
    const nearY = a.y + a.h + 14 + jog;
    const leftX = Math.min(a.x, b.x) - 22 - jog;
    const topY = Math.min(a.y, b.y) - 18 - jog;
    return { d:`M ${ac.x} ${a.y + a.h} V ${nearY} H ${leftX} V ${topY} H ${bc.x} V ${b.y}`,
             tip:{ x:bc.x, y:b.y, dirn:'down' }, mid:{ x:leftX, y:(nearY + topY)/2 } };
  }
  // TB: 流れは上→下、レーンは左右
  // 別レーンをまたぐ接続（前進・後退どちらも）は、レーンとレーンの間の隙間
  // （ノードが絶対に無い帯）を通って短く行き来する。同じ行（同フェーズ）はこの後で個別に扱う。
  if(ctx && ctx.gapCross != null && Math.abs(a.y - b.y) >= 1){
    // 同じ隙間を通る他の辺と重ならないよう、隙間内での通り道も少しずつずらす。
    const gxJog = jogIdx ? Math.ceil(jogIdx / 2) * 4 * (jogIdx % 2 ? 1 : -1) : 0;
    const gx = ctx.gapCross + gxJog;
    const clearY = b.y - 18 - jog;
    if(b.y > a.y + a.h - 1){
      // 前進: FROMの下辺（最優先）から出て、隙間を経由してTOの上辺へ入れる
      const sy = a.y + a.h, nearY = sy + 14 + jog;
      const d = `M ${ac.x} ${sy} V ${nearY} H ${gx} V ${clearY} H ${bc.x} V ${b.y}`;
      return { d, tip:{ x:bc.x, y:b.y, dirn:'down' }, mid:{ x:gx, y:(clearY + b.y)/2 } };
    }
    // 後退・横移動: TOの横の出力辺(右)を出力が使っていなければ、外側(右)を回ってそこへ入れる。
    // レーンの隙間を通すと、同じ所から出る前進の線と根元が重なりやすいため（要求5の例外）。
    if(allowCrossIn){
      const back = Math.max(a.x + a.w, b.x + b.w) + 22 + jog;
      // ラベルは長い縦棒の真ん中ではなくFROMのすぐ右に置く。真ん中だと、
      // 同じあたりを通る別の線のラベルと見分けがつかなくなるため。
      return { d:`M ${a.x + a.w} ${ac.y} H ${back} V ${bc.y} H ${b.x + b.w}`,
               tip:{ x:b.x + b.w, y:bc.y, dirn:'left' },
               mid:{ x:Math.min(a.x + a.w + 26, back), y:ac.y } };
    }
    // そうでなければ出力は右/下だけから出す（要求5）。TOのレーンが右なら右辺、左なら下辺から出て、
    // TOへは常に上辺から入る（要求2に整合）。
    if(gx > ac.x){
      const d = `M ${a.x + a.w} ${ac.y} H ${gx} V ${clearY} H ${bc.x} V ${b.y}`;
      return { d, tip:{ x:bc.x, y:b.y, dirn:'down' }, mid:{ x:gx, y:(ac.y + clearY)/2 } };
    }
    const sideY = a.y + a.h + 14 + jog;
    const d = `M ${ac.x} ${a.y + a.h} V ${sideY} H ${gx} V ${clearY} H ${bc.x} V ${b.y}`;
    return { d, tip:{ x:bc.x, y:b.y, dirn:'down' }, mid:{ x:gx, y:(sideY + clearY)/2 } };
  }
  if(b.y > a.y + a.h - 1){                      // 前進（同じレーン）
    const sy = a.y + a.h, ey = b.y;
    const span = ey - sy;
    const my = span > 24 ? Math.min(Math.max((sy + ey) / 2 + jog, sy + 6), ey - 6) : (sy + ey) / 2;
    return { d:`M ${ac.x} ${sy} V ${my} H ${bc.x} V ${ey}`, tip:{ x:bc.x, y:ey, dirn:'down' },
             mid:{ x:(ac.x + bc.x)/2, y:my } };
  }
  if(Math.abs(a.y - b.y) < 1){
    if(bc.x > ac.x){                            // 右のレーンへ: TOの左辺へ入る（要求2）
      const sx = a.x + a.w, ex = b.x;
      return { d:`M ${sx} ${ac.y} H ${ex}`, tip:{ x:ex, y:ac.y, dirn:'right' }, mid:{ x:(sx + ex)/2, y:ac.y } };
    }
    // 左のレーンへ戻る: 出口は下辺（前進の出力辺）。行の下の余白を左へ回り、TOの左辺へ入れる（要求5）
    const escY = a.y + a.h + 18 + jog;
    const leftX = b.x - 22 - jog;
    return { d:`M ${ac.x} ${a.y + a.h} V ${escY} H ${leftX} V ${bc.y} H ${b.x}`, tip:{ x:b.x, y:bc.y, dirn:'right' },
             mid:{ x:leftX, y:(escY + bc.y)/2 } };
  }
  // 後退（差戻しなど、同じレーン）
  if(allowCrossIn){                             // TOの右辺が空いていれば: 右側を回り込みそこへ入れる（要求5の例外）
    const back = Math.max(a.x + a.w, b.x + b.w) + 22 + jog;
    // ラベルはFROMのすぐ右に置く（長い縦棒の真ん中だと、どの線のラベルか分からなくなる）
    return { d:`M ${a.x + a.w} ${ac.y} H ${back} V ${bc.y} H ${b.x + b.w}`,
             tip:{ x:b.x + b.w, y:bc.y, dirn:'left' },
             mid:{ x:Math.min(a.x + a.w + 26, back), y:ac.y } };
  }
  // それ以外: TOの右は使わず、左へ回り込んでTOの左辺へ入れる
  // nearX/topY も少しずつずらせるようにし、同じ相手へ戻る複数の線が完全に重ならないようにする
  const nearX = a.x + a.w + 14 + jog;
  const leftX = Math.min(a.x, b.x) - 22 - jog;
  const topY = Math.min(a.y, b.y) - 18 - jog;
  return { d:`M ${a.x + a.w} ${ac.y} H ${nearX} V ${topY} H ${leftX} V ${bc.y} H ${b.x}`,
           tip:{ x:b.x, y:bc.y, dirn:'right' }, mid:{ x:leftX, y:(topY + bc.y)/2 } };
}

function arrowHead(tip){
  const s = 7;
  const { x, y, dirn } = tip;
  const pts = {
    right: `${x},${y} ${x-s},${y-s*0.62} ${x-s},${y+s*0.62}`,
    left:  `${x},${y} ${x+s},${y-s*0.62} ${x+s},${y+s*0.62}`,
    down:  `${x},${y} ${x-s*0.62},${y-s} ${x+s*0.62},${y-s}`,
    up:    `${x},${y} ${x-s*0.62},${y+s} ${x+s*0.62},${y+s}`,
  }[dirn];
  return `<polygon class="sl-arrow" points="${pts}" fill="#42506B"></polygon>`;
}

/* ---- エッジ経路の補助（分岐の角出し・ノード回避） ---- */
/* 直交線分(水平/垂直)が矩形を貫くか。端で触れる程度は許容し、明確に貫くものだけ true。 */
function segHitsBox(x1, y1, x2, y2, box){
  const m = 1, bx0 = box.x + m, bx1 = box.x + box.w - m, by0 = box.y + m, by1 = box.y + box.h - m;
  if(x1 === x2){
    if(x1 <= bx0 || x1 >= bx1) return false;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    return hi > by0 && lo < by1;
  }
  if(y1 === y2){
    if(y1 <= by0 || y1 >= by1) return false;
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    return hi > bx0 && lo < bx1;
  }
  return false;
}
/* "M x y (H x | V y)*" 形式の経路を線分に分け、いずれかのノードを貫くか調べる。 */
function pathHitsBoxes(d, boxes){
  const t = d.split(/\s+/);
  let x = 0, y = 0, px = 0, py = 0;
  for(let i = 0; i < t.length; i++){
    const c = t[i];
    if(c === 'M'){ x = +t[++i]; y = +t[++i]; px = x; py = y; }
    else if(c === 'H'){ px = x; x = +t[++i]; if(boxes.some(b=> segHitsBox(px, y, x, y, b))) return true; }
    else if(c === 'V'){ py = y; y = +t[++i]; if(boxes.some(b=> segHitsBox(x, py, x, y, b))) return true; }
  }
  return false;
}
/* 分岐(ひし形)の指定した出口ポートから線を出す経路（要求4/5）。
   port = { side, at }。side は TB なら 'bottom'|'right'|'left'、LR なら 'right'|'bottom'|'top'。
   at は流れ方向の出力辺（TB=下 / LR=右）に複数ポートを置くときの、辺上の座標。
   jogIdx で他の線との重なりを少しずらす。 */
function cornerRoute(a, b, dir, port, jogIdx){
  const jog = (jogIdx || 0) * 6;
  const acx = a.x + a.w/2, acy = a.y + a.h/2, bcx = b.x + b.w/2, bcy = b.y + b.h/2;
  const side = port && port.side;
  if(dir === 'TB'){
    if(side === 'bottom'){
      const sx = port.at != null ? port.at : acx;
      const sy = a.y + a.h, ey = b.y;
      const span = ey - sy;
      const my = span > 24 ? Math.min(Math.max((sy + ey) / 2 + jog, sy + 6), ey - 6) : (sy + ey) / 2;
      return { d:`M ${sx} ${sy} V ${my} H ${bcx} V ${ey}`, tip:{ x:bcx, y:ey, dirn:'down' }, mid:{ x:(sx+bcx)/2, y:my } };
    }
    // 左右の辺: 横へ出てから相手の上辺へ入れる（TOは上から接続）。
    // 左辺は入力専用だが、戻りの入力が無い分岐に限り出力に使う（要求5の例外）。
    // 相手が明確に横にあれば まっすぐ横→下。真下寄りなら 横のチャネルを下ってから中心へ戻る。
    const right = side === 'right';
    const sx = right ? a.x + a.w : a.x;
    const offset = right ? (bcx - acx) : (acx - bcx);
    if(offset > a.w / 2){
      return { d:`M ${sx} ${acy} H ${bcx} V ${b.y}`, tip:{ x:bcx, y:b.y, dirn:'down' }, mid:{ x:(sx + bcx)/2, y:acy } };
    }
    const chx = right ? sx + 18 + jog : sx - 18 - jog;
    return { d:`M ${sx} ${acy} H ${chx} V ${b.y - 12} H ${bcx} V ${b.y}`, tip:{ x:bcx, y:b.y, dirn:'down' }, mid:{ x:chx, y:(acy + b.y)/2 } };
  }
  if(side === 'right'){            // LR の前進はまっすぐ右へ（TOの左辺へ入る）
    const sy = port.at != null ? port.at : acy;
    const sx = a.x + a.w, ex = b.x;
    const span = ex - sx;
    const mx = span > 24 ? Math.min(Math.max((sx + ex) / 2 + jog, sx + 6), ex - 6) : (sx + ex) / 2;
    return { d:`M ${sx} ${sy} H ${mx} V ${bcy} H ${ex}`, tip:{ x:ex, y:bcy, dirn:'right' }, mid:{ x:mx, y:(sy+bcy)/2 } };
  }
  // 上下の辺(LR): 縦へ出てから相手の左辺へ入れる（TOは左から接続）。
  // 上辺は入力専用だが、戻りの入力が無い分岐に限り出力に使う（要求5の例外）。
  const bottom = side === 'bottom';
  const sy = bottom ? a.y + a.h : a.y;
  const offset = bottom ? (bcy - acy) : (acy - bcy);
  if(offset > a.h / 2){
    return { d:`M ${acx} ${sy} V ${bcy} H ${b.x}`, tip:{ x:b.x, y:bcy, dirn:'right' }, mid:{ x:acx, y:(sy + bcy)/2 } };
  }
  const chy = bottom ? sy + 18 + jog : sy - 18 - jog;
  return { d:`M ${acx} ${sy} V ${chy} H ${b.x - 12} V ${bcy} H ${b.x}`, tip:{ x:b.x, y:bcy, dirn:'right' }, mid:{ x:(acx + b.x)/2, y:chy } };
}
/* ノードを貫く経路を、横のチャネルに逃がして迂回する（要求3）。避けられなければ null。
   ctx.allowCrossIn が偽なら、TOの右(TB)/下(LR)から入る経路は使わない（要求5）。 */
function detourRoute(a, b, dir, boxes, jogIdx, ctx){
  const idx = jogIdx || 0;
  const pad = 20 + idx * 8;
  const allowCrossIn = !!(ctx && ctx.allowCrossIn);
  if(dir === 'TB'){
    const acx = a.x + a.w/2, bcx = b.x + b.w/2, bcy = b.y + b.h/2;
    // band: 出口の高さ〜TOの高さの間（前進・後退どちらでも成り立つよう min/max で範囲を取る）
    const sy = a.y + a.h;
    const yLo = Math.min(sy, b.y), yHi = Math.max(sy, b.y);
    const band = boxes.filter(o=> o.y < yHi && o.y + o.h > yLo);
    const rx = Math.max(a.x + a.w, b.x + b.w, ...band.map(o=> o.x + o.w)) + pad;
    const lx = Math.min(a.x, b.x, ...band.map(o=> o.x)) - pad;
    const order = allowCrossIn ? [rx, lx] : [lx];
    // 同じ高さから出る他の辺と退避行が重なるのを避けるため、退避の高さも試行ごとにずらす。
    // ただし退避する行がノードの中へ入らないよう、手前のノードの上で止める。
    // ふちから数pxだけ内側を通ると、線がノードに重なって見えてしまうため。
    let escY = sy + 14 + idx * 10;
    {
      const blockers = boxes.filter(o=> o.y + o.h > sy && o.y < escY + 8);
      if(blockers.length){
        const top = Math.min(...blockers.map(o=> o.y));
        if(top - 8 > sy) escY = Math.min(escY, top - 8);
      }
    }
    for(const chx of order){
      const enterR = chx > bcx, ex = enterR ? b.x + b.w : b.x;
      const d = `M ${acx} ${sy} V ${escY} H ${chx} V ${bcy} H ${ex}`;
      if(!pathHitsBoxes(d, boxes)) return { d, tip:{ x:ex, y:bcy, dirn: enterR ? 'left' : 'right' }, mid:{ x:chx, y:(sy + bcy)/2 } };
    }
  }else{
    const acy = a.y + a.h/2, bcx = b.x + b.w/2, bcy = b.y + b.h/2;
    // band: 出口の位置〜TOの位置の間（前進・後退どちらでも成り立つよう min/max で範囲を取る）
    const sx = a.x + a.w;
    const xLo = Math.min(sx, b.x), xHi = Math.max(sx, b.x);
    const band = boxes.filter(o=> o.x < xHi && o.x + o.w > xLo);
    const by = Math.max(a.y + a.h, b.y + b.h, ...band.map(o=> o.y + o.h)) + pad;
    const ty = Math.min(a.y, b.y, ...band.map(o=> o.y)) - pad;
    const order = allowCrossIn ? [by, ty] : [ty];
    // 同じ位置から出る他の辺と退避列が重なるのを避けるため、退避の位置も試行ごとにずらす。
    // ただし退避する列がノードの中へ入らないよう、手前のノードの左で止める。
    // ふちから数pxだけ内側を通ると、線がノードに重なって見えてしまうため。
    let escX = sx + 14 + idx * 10;
    {
      const blockers = boxes.filter(o=> o.x + o.w > sx && o.x < escX + 8);
      if(blockers.length){
        const left = Math.min(...blockers.map(o=> o.x));
        if(left - 8 > sx) escX = Math.min(escX, left - 8);
      }
    }
    for(const chy of order){
      const enterB = chy > bcy, ey = enterB ? b.y + b.h : b.y;
      const d = `M ${sx} ${acy} H ${escX} V ${chy} H ${bcx} V ${ey}`;
      if(!pathHitsBoxes(d, boxes)) return { d, tip:{ x:bcx, y:ey, dirn: enterB ? 'up' : 'down' }, mid:{ x:(sx + bcx)/2, y:chy } };
    }
  }
  return null;
}
/* 同じノードの同じ辺から2本以上の線が出るとき、根元を辺に沿って等間隔に並べ直す（要求5）。
   経路の形は変えず、出発点とそれに続く1区間だけが動く。
   並べる順はその線が曲がっていく側の順なので、「右へ折れる線は右寄りから」出て、
   どの線がどこへ行くのか追いやすくなる。
   1本しか出ていない辺はそのまま。中央から出るべき線が偏らないよう、ここでは動かさない。 */
function spreadRoots(items, boxById){
  const groups = new Map();   // "ノードid + 辺" -> その辺から出る線
  items.forEach(it=>{
    if(!it || !it.p) return;
    const box = boxById.get(it.e.from);
    if(!box) return;
    const t = it.p.d.split(/\s+/);
    if(t[0] !== 'M') return;
    const x = +t[1], y = +t[2];
    const vertical = t[3] === 'V';   // 最初の区間が縦＝上下の辺から出ている
    const edge = vertical
      ? (Math.abs(y - box.y) < 1.5 ? 'top' : 'bottom')
      : (Math.abs(x - box.x) < 1.5 ? 'left' : 'right');
    // 最初に曲がる先。これが「その線が向かう側」で、根元を並べる順になる
    let toward = null;
    for(let i = 3; i < t.length; i += 2){
      if(vertical && t[i] === 'H'){ toward = +t[i + 1]; break; }
      if(!vertical && t[i] === 'V'){ toward = +t[i + 1]; break; }
    }
    const k = it.e.from + '\u001f' + edge;
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ it, t, box, vertical, toward: toward == null ? (vertical ? x : y) : toward });
  });
  groups.forEach(list=>{
    if(list.length < 2) return;      // 1本だけの辺は中央のまま
    list.sort((p, q)=> p.toward - q.toward);
    const box = list[0].box, vertical = list[0].vertical;
    const span = vertical ? box.w : box.h;
    const step = Math.round(Math.min(24, Math.max(8, (span - 24) / list.length)) * 2) / 2;
    list.forEach((r, k)=>{
      const off = (k - (list.length - 1) / 2) * step;
      if(!off) return;
      const nt = r.t.slice();
      if(r.vertical) nt[1] = String(+nt[1] + off);
      else nt[2] = String(+nt[2] + off);
      r.it.p = { d: nt.join(' '), tip: r.it.p.tip, mid: r.it.p.mid };
    });
  });
}
/* 経路(d)を線分の配列に分解する。重なり検出に使う。 */
function pathSegmentsOf(d){
  const t = d.split(/\s+/);
  let x = 0, y = 0;
  const segs = [];
  for(let i = 0; i < t.length; i++){
    const c = t[i];
    if(c === 'M'){ x = +t[++i]; y = +t[++i]; }
    else if(c === 'H'){ const nx = +t[++i]; segs.push([x, y, nx, y]); x = nx; }
    else if(c === 'V'){ const ny = +t[++i]; segs.push([x, y, x, ny]); y = ny; }
  }
  return segs;
}
/* 2つの線分が同じ向きで、ほぼ同じ位置（tol以内）に並んでいる長さ。平行でなければ0。
   ぴったり重なっていなくても数pxしか離れていなければ1本に見えるので、少し幅を持たせて見る。 */
function collinearOverlapLen(s1, s2, tol){
  const t = tol || 0;
  const [a1,b1,a2,b2] = s1, [c1,d1,c2,d2] = s2;
  const v1 = a1 === a2, v2 = c1 === c2;
  if(v1 && v2 && Math.abs(a1 - c1) <= t){
    const lo = Math.max(Math.min(b1,b2), Math.min(d1,d2));
    const hi = Math.min(Math.max(b1,b2), Math.max(d1,d2));
    return Math.max(0, hi - lo);
  }
  if(!v1 && !v2 && Math.abs(b1 - d1) <= t){
    const lo = Math.max(Math.min(a1,a2), Math.min(c1,c2));
    const hi = Math.min(Math.max(a1,a2), Math.max(c1,c2));
    return Math.max(0, hi - lo);
  }
  return 0;
}

/* 図形内のラベルを折り返して <tspan> にする（SVGは自動折り返ししないため） */
function wrapLabel(text, maxChars, maxLines){
  const words = String(text || '').split(/(\s+)/).filter(w=>w.trim() !== '' || w === ' ');
  const lines = [];
  let cur = '';
  const push = ()=>{ if(cur){ lines.push(cur); cur = ''; } };
  const width = (s)=> [...s].reduce((n,ch)=> n + (/[\x00-\xff]/.test(ch) ? 1 : 2), 0);
  for(const w of words){
    if(width(cur + w) > maxChars && cur){ push(); }
    if(width(w) > maxChars){
      for(const ch of w){
        if(width(cur + ch) > maxChars){ push(); }
        cur += ch;
      }
    }else{
      cur += w;
    }
    if(lines.length >= maxLines) break;
  }
  push();
  if(lines.length > maxLines){
    lines.length = maxLines;
    lines[maxLines-1] = lines[maxLines-1].slice(0, Math.max(1, lines[maxLines-1].length - 1)) + '…';
  }
  return lines.length ? lines : [''];
}

function drawSvg(state){
  const lay = computeLayout(state);
  const pad = 14;
  const titleH = state.title ? 34 : 0;

  // 分岐(ひし形)の出力を別々のポートから出す（要求4/5）。前進する出力が2〜4本のときに割り当てる。
  // ポートは「行き先の交差方向の並び順」と同じ順に並べる。根元の順と行き先の順がねじれると、
  // 分岐を出てすぐの所で線どうしが無駄に交差するため。
  const portMap = new Map();   // link index -> { side, at }
  {
    const bySrc = new Map();
    state.links.forEach((e, i)=>{
      const a = lay.boxById.get(e.from), b = lay.boxById.get(e.to);
      if(!a || !b || a.node.shape !== 'decision') return;
      const fwd = lay.dir === 'TB' ? (b.y > a.y + a.h - 1) : (b.x > a.x + a.w - 1);
      if(!fwd) return;
      if(!bySrc.has(e.from)) bySrc.set(e.from, []);
      bySrc.get(e.from).push({ i, a, b });
    });
    // 戻り（前進でない入力）があるノードは、横の入力辺（TB=左 / LR=上）をその入力のために空けておく。
    const hasBackIn = (id)=> state.links.some(e=>{
      if(e.to !== id || e.from === id) return false;
      const a = lay.boxById.get(e.from), b = lay.boxById.get(id);
      if(!a || !b) return false;
      return lay.dir === 'TB' ? !(b.y > a.y + a.h - 1) : !(b.x > a.x + a.w - 1);
    });
    const FAR   = lay.dir === 'TB' ? 'left'   : 'top';     // 入力辺。例外的に出力へ回すことがある
    const FWD   = lay.dir === 'TB' ? 'bottom' : 'right';   // 流れ方向の出力辺（複数ポートを置ける）
    const CROSS = lay.dir === 'TB' ? 'right'  : 'bottom';  // 横の出力辺
    bySrc.forEach((list, srcId)=>{
      if(list.length < 2 || list.length > 4) return;   // 4本までポート割り当て（5本以上は既定のまま）
      list.sort((p, q)=>{
        const pc = lay.dir === 'TB' ? p.b.x : p.b.y, qc = lay.dir === 'TB' ? q.b.x : q.b.y;
        if(pc !== qc) return pc - qc;
        const pf = lay.dir === 'TB' ? p.b.y : p.b.x, qf = lay.dir === 'TB' ? q.b.y : q.b.x;
        return pf - qf;
      });
      const a = list[0].a;
      const ports = [];
      // 3本以上で、戻りの入力が無いときだけ入力辺も出口に使う（要求5の例外）
      if(list.length >= 3 && !hasBackIn(srcId)) ports.push({ side: FAR });
      const mid = list.length - ports.length - 1;
      for(let k = 0; k < mid; k++){
        const t = (k + 1) / (mid + 1);
        ports.push({ side: FWD, at: lay.dir === 'TB' ? a.x + a.w * t : a.y + a.h * t });
      }
      ports.push({ side: CROSS });
      list.forEach((it, k)=> portMap.set(it.i, ports[k]));
    });
  }

  // FROM/TOの辺ルール（要求5）判定用。辺の役割は向き(LR/TB)によらず固定する。
  // ・出力（線の棒側）は 右 / 下 からだけ出す
  // ・入力（矢印の先側）は 左 / 上 へだけ入れる
  // ・例外: TO側に出力が1本も無いときだけ、横の出力辺（TB=右 / LR=下）からの入力を許す
  //   （終了ノードなど。出力が無ければ、同じ点に線の棒と矢先が重なることはない）
  const laneIdxOf = new Map(lay.lanes.map((l, idx)=> [l.id, idx]));
  // ●(開始/終了)は接続先ノードの隣に実際には描かれるため、経路判定でも自身の宣言レーンではなく
  // 接続先(anchor)のレーンを使う。手書きの.swimや編集操作で●のlaneが接続先とズレていても、
  // 実際の見た目どおりの経路（同レーンならまっすぐ）で線を引けるようにする。
  const resolveLane = (n)=>{
    if(isDot(n.shape)){
      const anchor = lay.dotAnchor.get(n);
      if(anchor) return anchor.laneId || (lay.lanes[0] && lay.lanes[0].id);
    }
    return n.laneId || (lay.lanes[0] && lay.lanes[0].id);
  };
  // 接続の経路をすべて先に確定する（重なりを検出したら少しずつずらす。
  // 要求: 交差は許容するが線の完全な重なりは避ける）。キャンバスサイズを決める前に必要。
  const buildRoutes = (allowCrossInOf)=>{
  const placedSegs = [];
  return state.links.map((e, i)=>{
    const a = lay.boxById.get(e.from), b = lay.boxById.get(e.to);
    if(!a || !b) return null;
    const port = portMap.get(i);
    const laneA = laneIdxOf.get(resolveLane(a.node)), laneB = laneIdxOf.get(resolveLane(b.node));
    const allowCrossIn = allowCrossInOf(e.to);
    // 別レーンをまたぐ接続用: レーン境界のすぐ内側（ノード列と境界線の間の余白）のクロス軸座標。
    // レーン帯どうしは隙間なく隣接している（境界＝線そのもの）ため、境界線上を通ると
    // レーンの区切り線と重なって見える。境界からノード列側へ少し入った余白の中央を使う。
    let gapCross = null;
    if(laneA != null && laneB != null && laneA !== laneB){
      const bandA = lay.laneBands[laneA];
      if(laneB > laneA){
        gapCross = bandA.start + bandA.size - LAYOUT.gapCross / 2;
      }else{
        gapCross = bandA.start + LAYOUT.gapCross / 2;
      }
    }
    const ctx = { allowCrossIn, gapCross };
    const obst = lay.boxes.filter(x=> x.node.id !== e.from && x.node.id !== e.to);
    // 各試行を「貫通なし」を最優先、「線の重なりなし」を次点にスコアリングして最良のものを採用する。
    // 単に重なりが無いことだけを基準にすると、貫通しているのにたまたま他の線と重ならない
    // 経路を選んでしまうことがあるため（要求3が要求4より優先）。
    let best = null, bestScore = -1;
    for(let attempt = 0; attempt < 6 && bestScore < 3; attempt++){
      let p = port ? cornerRoute(a, b, lay.dir, port, attempt) : linkPath(a, b, lay.dir, attempt, ctx);
      // 要求3: ノードを貫くなら、チャネルへ逃がして迂回する
      if(pathHitsBoxes(p.d, obst)){
        const dp = detourRoute(a, b, lay.dir, obst, attempt, ctx);
        if(dp) p = dp;
      }
      const stillHits = pathHitsBoxes(p.d, obst);
      // 重なり判定からは前後1区間ずつ外す。
      // 最初の区間（根元）は、重なっていれば spreadRoot が後で辺に沿ってずらすので数えない。
      // ここで数えると、本当に離したい途中の区間を見つける前に点数が頭打ちになってしまう。
      // 最後の区間（TOへ入る直前）は、複数の矢印が同じ点に収束するのが普通なので数えない。
      const midSegs = pathSegmentsOf(p.d).slice(1, -1);
      const hasOverlap = midSegs.some(s1=> placedSegs.some(s2=> collinearOverlapLen(s1, s2, 10) > 8));
      const score = (stillHits ? 0 : 2) + (hasOverlap ? 0 : 1);
      if(score > bestScore){ bestScore = score; best = p; }
    }
    placedSegs.push(...pathSegmentsOf(best.d).slice(0, -1));
    return { e, i, p: best };
  });
  };
  // 経路は2回引く。1回目で「出力が実際にどの辺から出るか」を調べ、2回目で
  // 出力が1本も使っていない出力辺（TB=右 / LR=下）への入力を許す（要求5の例外）。
  const exitSideOf = (box, d)=>{
    const m = d.match(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if(!m || !box) return '';
    const x = +m[1], y = +m[2];
    if(Math.abs(y - (box.y + box.h)) <= 1.5) return 'bottom';
    if(Math.abs(y - box.y) <= 1.5) return 'top';
    if(Math.abs(x - (box.x + box.w)) <= 1.5) return 'right';
    if(Math.abs(x - box.x) <= 1.5) return 'left';
    return '';
  };
  const CROSS_OUT = lay.dir === 'TB' ? 'right' : 'bottom';
  const crossUsed = new Set();
  buildRoutes(()=> false).forEach(item=>{
    if(!item) return;
    if(exitSideOf(lay.boxById.get(item.e.from), item.p.d) === CROSS_OUT) crossUsed.add(item.e.from);
  });
  const linkRenders = buildRoutes((id)=> !crossUsed.has(id));
  // 同じノードの同じ辺から出る線の根元を、辺に沿って等間隔に並べ直す（要求5）
  spreadRoots(linkRenders, lay.boxById);

  // 経路がノードの並び（lay.width/height）よりはみ出すことがある（隙間を通る経路など）。
  // はみ出した分だけキャンバスを広げ、負の座標が出た場合は原点をずらして描画が切れないようにする。
  let minX = 0, minY = 0, maxX = lay.width, maxY = lay.height;
  linkRenders.forEach(item=>{
    if(!item) return;
    pathSegmentsOf(item.p.d).forEach(([x1, y1, x2, y2])=>{
      minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
      minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
    });
    // 接続のラベルも範囲に入れる。入れないとレーンの外に出たラベルが切れて見えなくなる。
    if(item.e.label){
      const tw = labelPixelWidth(item.e.label);
      minX = Math.min(minX, item.p.mid.x - tw/2 - 2); maxX = Math.max(maxX, item.p.mid.x + tw/2 + 2);
      minY = Math.min(minY, item.p.mid.y - 11);       maxY = Math.max(maxY, item.p.mid.y + 11);
    }
  });
  const shiftX = -Math.min(0, minX), shiftY = -Math.min(0, minY);
  const W = (maxX + shiftX) + pad * 2;
  const H = (maxY + shiftY) + pad * 2 + titleH;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Yu Gothic UI', 'Meiryo UI', sans-serif">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"></rect>`);
  if(state.title){
    out.push(`<text x="${W/2}" y="24" text-anchor="middle" font-size="16" font-weight="700" fill="#16233A">${esc(state.title)}</text>`);
  }
  out.push(`<g transform="translate(${pad + shiftX}, ${pad + titleH + shiftY})">`);

  // レーンの帯と見出し
  lay.laneBands.forEach(band=>{
    const l = band.lane;
    const fill = l.color || '#F7F9FB';
    if(lay.dir === 'LR'){
      out.push(`<g data-pick="lane" data-idx="${state.lanes.indexOf(l)}">`);
      out.push(`<rect class="sl-shape" x="0" y="${band.start}" width="${lay.width}" height="${band.size}" fill="${esc(fill)}" fill-opacity="0.55" stroke="#B9C7DA"></rect>`);
      out.push(`<rect x="0" y="${band.start}" width="${LAYOUT.laneHeaderW}" height="${band.size}" fill="${esc(fill)}" stroke="#B9C7DA"></rect>`);
      wrapLabel(l.label, 14, headerLines(band.size)).forEach((ln, i, all)=>{
        const y = band.start + band.size/2 + (i - (all.length-1)/2) * 15 + 5;
        out.push(`<text x="${LAYOUT.laneHeaderW/2}" y="${y}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#16233A">${esc(ln)}</text>`);
      });
      out.push(`</g>`);
    }else{
      out.push(`<g data-pick="lane" data-idx="${state.lanes.indexOf(l)}">`);
      out.push(`<rect class="sl-shape" x="${band.start}" y="0" width="${band.size}" height="${lay.height}" fill="${esc(fill)}" fill-opacity="0.55" stroke="#B9C7DA"></rect>`);
      out.push(`<rect x="${band.start}" y="0" width="${band.size}" height="${LAYOUT.phaseHeaderH}" fill="${esc(fill)}" stroke="#B9C7DA"></rect>`);
      out.push(`<text x="${band.start + band.size/2}" y="${LAYOUT.phaseHeaderH/2 + 5}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#16233A">${esc(l.label)}</text>`);
      out.push(`</g>`);
    }
  });

  // フェーズの見出し
  if(lay.hasPhaseHeader){
    lay.phaseBands.forEach(pb=>{
      const idx = state.phases.indexOf(pb.phase);
      if(lay.dir === 'LR'){
        out.push(`<g data-pick="phase" data-idx="${idx}">`);
        out.push(`<rect class="sl-shape" x="${pb.start}" y="0" width="${pb.size}" height="${LAYOUT.phaseHeaderH}" fill="#EEF4FB" stroke="#B9C7DA"></rect>`);
        out.push(`<text x="${pb.start + pb.size/2}" y="${LAYOUT.phaseHeaderH/2 + 5}" text-anchor="middle" font-size="12" font-weight="700" fill="#3C516C">${esc(pb.phase.label)}</text>`);
        out.push(`</g>`);
      }else{
        out.push(`<g data-pick="phase" data-idx="${idx}">`);
        out.push(`<rect class="sl-shape" x="0" y="${pb.start}" width="${LAYOUT.laneHeaderW}" height="${pb.size}" fill="#EEF4FB" stroke="#B9C7DA"></rect>`);
        // TBのフェーズ名は幅132pxの左の列に入る。横には広げられないので折り返す（レーン名と同じ扱い）
        wrapLabel(pb.phase.label, 14, headerLines(pb.size)).forEach((ln, i, all)=>{
          const y = pb.start + pb.size/2 + (i - (all.length-1)/2) * 15 + 5;
          out.push(`<text x="${LAYOUT.laneHeaderW/2}" y="${y}" text-anchor="middle" font-size="12" font-weight="700" fill="#3C516C">${esc(ln)}</text>`);
        });
        out.push(`</g>`);
      }
    });
  }

  linkRenders.forEach(item=>{
    if(!item) return;
    const { e, i, p } = item;
    const dash = e.style === 'dashed' ? ' stroke-dasharray="6 4"' : '';
    out.push(`<g>`);
    out.push(`<path class="sl-hit" d="${p.d}" fill="none" stroke="transparent" stroke-width="14" data-pick="link" data-idx="${i}"></path>`);
    out.push(`<path d="${p.d}" fill="none" stroke="#42506B" stroke-width="1.6"${dash} data-pick="link" data-idx="${i}"></path>`);
    out.push(arrowHead(p.tip));
    if(e.label){
      const tw = labelPixelWidth(e.label);
      out.push(`<rect x="${p.mid.x - tw/2}" y="${p.mid.y - 9}" width="${tw}" height="18" rx="4" fill="#FFFFFF" stroke="#D3E1EF" data-pick="link" data-idx="${i}"></rect>`);
      out.push(`<text x="${p.mid.x}" y="${p.mid.y + 4}" text-anchor="middle" font-size="11" fill="#3C516C" data-pick="link" data-idx="${i}">${esc(e.label)}</text>`);
    }
    out.push(`</g>`);
  });

  // 図形
  lay.boxes.forEach(b=>{
    const n = b.node;
    const fill = n.color || '#FFFFFF';
    out.push(`<g data-pick="node" data-idx="${b.index}">`);
    out.push(shapeElement(b, n.shape, fill));
    if(isDot(n.shape)){
      // ●の中には文字を入れず、ラベルがあるときだけ真下に添える
      if(n.label){
        out.push(`<text x="${b.x + b.w/2}" y="${b.y + b.h + 13}" text-anchor="middle" font-size="11" fill="#3C516C">${esc(n.label)}</text>`);
      }
    }else{
      const lines = wrapLabel(n.label, n.shape === 'decision' ? 12 : 16, 3);
      lines.forEach((ln, i)=>{
        const y = b.y + b.h/2 + (i - (lines.length-1)/2) * 15 + 5;
        out.push(`<text x="${b.x + b.w/2}" y="${y}" text-anchor="middle" font-size="12" fill="#16233A">${esc(ln)}</text>`);
      });
    }
    out.push(`</g>`);
  });

  out.push(`</g></svg>`);
  return out.join('');
}

/* ============ 公開API ============ */
function render(code){
  const parsed = parseCode(code);
  if(parsed.errors.length){
    return { ok:false, svg:'', width:0, height:0, errors:parsed.errors, state:parsed.state };
  }
  try{
    const svg = drawSvg(parsed.state);
    const m = svg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
    return {
      ok:true, svg,
      width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0,
      errors:[], state:parsed.state,
    };
  }catch(err){
    return { ok:false, svg:'', width:0, height:0, errors:[String(err && err.message ? err.message : err)], state:parsed.state };
  }
}
function renderTo(target, code){
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  const result = render(code);
  if(el) el.innerHTML = result.ok ? result.svg : '';
  return result;
}

return {
  VERSION: '1.0.0',
  SHAPES,
  LINK_STYLES,
  isDot,
  parse: parseCode,
  generate: generateCode,
  computeLayout,
  drawSvg,
  render,
  renderTo,
};

});
