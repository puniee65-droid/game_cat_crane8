'use strict';
/* ============================================================
   lib/api-core.js ― ねこキャッチャー APIハンドラ（Node/Workers共通）

   server.js（ローカルNode開発サーバ）と functions/api/[[path]].js
   （Cloudflare Pages Functions）の両方から読み込まれる。
   fs/http/os など特定ランタイムのAPIには一切依存しない
   （Store インターフェイスの実装だけがランタイムごとに異なる：
    Node = JsonFileStore、Workers = KVStore）。
   ============================================================ */

// ---------------- 日本時間(JST, UTC+9)への変換 ----------------
function toJstString(epochMs){
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).format(new Date(epochMs)).replace(',', '') + ' JST';
}

// Web Crypto（Node20+ / Workers 双方でグローバルに存在）でランダムIDを生成。
// node:crypto に依存すると Workers 側で nodejs_compat が必要になるため避ける。
function randomHex(byteLen){
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// 家具の価格（コイン）。将来の課金導入時もここが唯一の価格表になる。
const FURNITURE_PRICES = { tower:5, cushion:3, sofa:5, house:5 };
// 猫の色名 → 動画フォルダ名（マイルームで猫をクリックした時の動画に使用）
const CAT_VIDEO_FOLDERS = {
  '白ねこ': 'cat_white',
  '茶色ねこ': 'cat_chairo',
  '黒ねこ': 'cat_kijitora',
  'ピンクねこ': 'cat_pink',
  'レインボーねこ': 'cat_rainbow',
};
// public/assets/{action,feeding}/配下の動画ファイル一覧。
// Cloudflare Workers環境はファイルシステムを持たずディレクトリ一覧を取得できないため、
// ここに静的に持つ（新しい動画を追加した場合はここにも追記が必要）。
const CAT_VIDEO_FILES = {
  action: {
    cat_chairo: [
      'ComfyUI_1_20260131_101742.mp4', 'ComfyUI_2_20260131_102553.mp4',
      'ComfyUI_3_20260131_103507.mp4', 'ComfyUI_4_20260131_104349.mp4',
      'ComfyUI_5_20260131_105219.mp4',
    ],
    cat_kijitora: [
      'ComfyUI_1_20260131_090908.mp4', 'ComfyUI_2_20260131_091839.mp4',
      'ComfyUI_3_20260131_092810.mp4', 'ComfyUI_4_20260131_093739.mp4',
      'ComfyUI_5_20260131_094710.mp4',
    ],
    cat_pink: [
      'ComfyUI_1_20260131_072234.mp4', 'ComfyUI_2_20260131_073155.mp4',
      'ComfyUI_3_20260131_074113.mp4', 'ComfyUI_4_20260131_075038.mp4',
      'ComfyUI_5_20260131_080006.mp4',
    ],
    cat_rainbow: [
      'ComfyUI_1_20260131_081317.mp4', 'ComfyUI_2_20260131_082246.mp4',
      'ComfyUI_3_20260131_083216.mp4', 'ComfyUI_4_20260131_084147.mp4',
      'ComfyUI_5_20260131_085117.mp4',
    ],
    cat_white: [
      '仰向けになりちょっと目を閉じ、起き上がる.mp4',
      '口を大きく開けて両足バタバタ.mp4',
      '前に乗り出し怒る.mp4',
      '伏せの姿勢になりちょっと目を閉じて起き上がる.mp4',
      '伏せの姿勢になりちょっと目を閉じる.mp4',
      '伏せの姿勢になり目を閉じる.mp4',
      '目を閉じて少し口を開ける.mp4',
      '目を閉じて大きく口をあける.mp4',
    ],
  },
  feeding: {
    cat_chairo: ['output1.mp4', 'output2.mp4'],
    cat_kijitora: ['output1.mp4', 'output2.mp4'],
    cat_pink: ['output1.mp4'],
    cat_rainbow: ['output1.mp4', 'output2.mp4'],
    cat_white: ['output1.mp4', 'output2.mp4'],
  },
};
const FOOD_PRICE = 1;             // 魚フレーク1個の価格（コイン）
const POINTS_PER_COIN = 10;       // 特点→コイン変換レート

function newUser(userId){
  const createdAt = Date.now();
  return {
    userId,
    createdAt, createdAtJst: toJstString(createdAt),
    coins: 5,
    points: 0,                 // 特点（クライアントがPATCHで同期）
    score: 0,                  // ゲット匹数
    food: 0,                   // エサ（魚フレーク）の所持数
    roomName: null,            // マイルームの名前（初回入室時にユーザーが設定）
    cats: [],                  // 獲得猫 [{id, def, caughtAt, nickname}]
    catCounts: {},             // 種類別の獲得数 {"白ねこ":2, ...}
    furniture: { tower:false, sofa:false, cushion:false, house:false },
    sessions: [],              // [{id, startedAt, endedAt}]
  };
}

// ---------------- APIハンドラ（Node/Workers共通の純関数風） ----------------
// admin: 管理画面(admin.html)からの利用状況閲覧に使う認証情報。
//   adminToken   … サーバ側に設定された正しいトークン（未設定なら常に拒否＝フェイルクローズ）
//   requestToken … リクエストの X-Admin-Token ヘッダーの値
async function handleApi(method, pathname, body, store, admin={}){
  const seg = pathname.split('/').filter(Boolean);   // ['api', ...]

  // GET /api/admin/users … 全ユーザーの利用状況一覧（admin.html用。要トークン認証）
  if(method === 'GET' && pathname === '/api/admin/users'){
    if(!admin.adminToken || admin.requestToken !== admin.adminToken)
      return { status:401, data:{error:'unauthorized'} };
    const users = await store.listUsers();
    return { status:200, data:{ users } };
  }

  // POST /api/user … ユーザー確保（無ければ作成）
  if(method === 'POST' && pathname === '/api/user'){
    let userId = body && body.userId;
    let user = userId ? await store.getUser(userId) : null;
    if(!user){
      userId = 'u_' + randomHex(6);
      user = await store.putUser(newUser(userId));
    }
    return { status:200, data:{ userId, user } };
  }

  // GET /api/user/:id
  if(method === 'GET' && seg[1] === 'user' && seg[2]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    return { status:200, data:{ user } };
  }

  // PATCH /api/user/:id … コイン・特点・ゲット数・部屋の名前の同期
  if(method === 'PATCH' && seg[1] === 'user' && seg[2]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    for(const k of ['coins','points','score'])
      if(typeof body[k] === 'number') user[k] = body[k];
    if(typeof body.roomName === 'string')
      user.roomName = body.roomName.trim().slice(0,20) || null;
    await store.putUser(user);
    return { status:200, data:{ ok:true, roomName:user.roomName } };
  }

  // POST /api/session/start … プレイ開始時刻を記録
  if(method === 'POST' && pathname === '/api/session/start'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const startedAt = Date.now();
    const session = { id:'s_'+randomHex(5),
                      startedAt, startedAtJst: toJstString(startedAt),
                      endedAt: null, endedAtJst: null };
    user.sessions.push(session);
    await store.putUser(user);
    return { status:200, data:{ sessionId: session.id } };
  }

  // POST /api/session/end … プレイ終了時刻を記録（sendBeacon対応）
  if(method === 'POST' && pathname === '/api/session/end'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const s = user.sessions.find(s=>s.id === body.sessionId);
    if(s){ s.endedAt = Date.now(); s.endedAtJst = toJstString(s.endedAt); }
    await store.putUser(user);
    return { status:200, data:{ ok:true } };
  }

  // POST /api/catch … 獲得猫の記録（idで冪等）
  if(method === 'POST' && pathname === '/api/catch'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const entry = body.entry;
    if(!entry || !entry.id || !entry.def)
      return { status:400, data:{error:'bad entry'} };
    if(!user.cats.some(c=>c.id === entry.id)){
      const caughtAt = entry.caughtAt || Date.now();
      user.cats.push({ id:entry.id, def:entry.def,
                       caughtAt, caughtAtJst: toJstString(caughtAt) });
      const name = entry.def.name || 'ねこ';
      user.catCounts[name] = (user.catCounts[name] || 0) + 1;
      await store.putUser(user);
    }
    return { status:200, data:{ ok:true, total:user.cats.length } };
  }

  // GET /api/cats/:userId … 獲得猫一覧（マイルームの復元・ポーリング用）
  if(method === 'GET' && seg[1] === 'cats' && seg[2]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    return { status:200, data:{ cats:user.cats } };
  }

  // PATCH /api/cats/:userId/:catId … 猫に名前をつける
  if(method === 'PATCH' && seg[1] === 'cats' && seg[2] && seg[3]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    const cat = user.cats.find(c => c.id === seg[3]);
    if(!cat) return { status:404, data:{error:'cat not found'} };
    const nickname = typeof body.name === 'string' ? body.name.trim().slice(0,10) : '';
    cat.nickname = nickname;
    await store.putUser(user);
    return { status:200, data:{ ok:true, nickname:cat.nickname } };
  }

  // DELETE /api/cats/:userId … 部屋リセット（獲得履歴のクリア）
  if(method === 'DELETE' && seg[1] === 'cats' && seg[2]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    user.cats = [];
    user.catCounts = {};
    await store.putUser(user);
    return { status:200, data:{ ok:true } };
  }

  // POST /api/furniture … 家具を購入（価格はサーバ側のFURNITURE_PRICESが正）
  if(method === 'POST' && pathname === '/api/furniture'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const item = body.item;
    if(!(item in user.furniture))
      return { status:400, data:{error:'unknown item'} };
    if(user.furniture[item])
      return { status:400, data:{error:'already owned'} };
    const price = FURNITURE_PRICES[item];
    if(user.coins < price)
      return { status:400, data:{error:'insufficient coins', price} };
    user.coins -= price;
    user.furniture[item] = true;
    await store.putUser(user);
    return { status:200, data:{ ok:true, coins:user.coins, furniture:user.furniture } };
  }

  // DELETE /api/furniture/:userId … 家具リセット（コインは返却されない）
  if(method === 'DELETE' && seg[1] === 'furniture' && seg[2]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    for(const k of Object.keys(user.furniture)) user.furniture[k] = false;
    await store.putUser(user);
    return { status:200, data:{ ok:true, furniture:user.furniture } };
  }

  // POST /api/coins/buy … コイン購入（将来の決済連携までの仮実装：常に+5）
  if(method === 'POST' && pathname === '/api/coins/buy'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    // TODO(決済): 実際の課金導入時はここで決済確認後にcoinsを加算する
    user.coins += 5;
    await store.putUser(user);
    return { status:200, data:{ ok:true, coins:user.coins } };
  }

  // POST /api/food/buy … エサ(魚フレーク)購入。1個1コイン
  if(method === 'POST' && pathname === '/api/food/buy'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const qty = Number.isFinite(+body.qty) && +body.qty>0 ? Math.floor(+body.qty) : 1;
    const cost = qty * FOOD_PRICE;
    if(user.coins < cost)
      return { status:400, data:{error:'insufficient coins', cost} };
    user.coins -= cost;
    user.food += qty;
    await store.putUser(user);
    return { status:200, data:{ ok:true, coins:user.coins, food:user.food } };
  }

  // POST /api/food/use … 猫にエサをあげる（所持エサを1消費）
  if(method === 'POST' && pathname === '/api/food/use'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    if(user.food <= 0) return { status:400, data:{error:'no food'} };
    user.food -= 1;
    await store.putUser(user);
    return { status:200, data:{ ok:true, food:user.food } };
  }

  // GET /api/cat-videos/:kind/:name … 猫の色ごとの動画ファイル一覧
  // kind: 'action'（クリック時のポップアップ動画）| 'feeding'（エサをやる時の動画）
  if(method === 'GET' && seg[1] === 'cat-videos' && seg[2] && seg[3]){
    const kind = seg[2];
    const name = decodeURIComponent(seg[3]);
    const folder = CAT_VIDEO_FOLDERS[name];
    if(!folder || (kind !== 'action' && kind !== 'feeding'))
      return { status:404, data:{error:'unknown cat or kind'} };
    const files = (CAT_VIDEO_FILES[kind] && CAT_VIDEO_FILES[kind][folder]) || [];
    const urls = files.map(f => `assets/${kind}/${folder}/${encodeURIComponent(f)}`);
    return { status:200, data:{ urls } };
  }

  // POST /api/points/convert … 特点をコインに変換（10点→1コイン、端数は特点として残る）
  if(method === 'POST' && pathname === '/api/points/convert'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const gained = Math.floor(user.points / POINTS_PER_COIN);
    if(gained <= 0) return { status:400, data:{error:'not enough points', need:POINTS_PER_COIN} };
    user.points -= gained * POINTS_PER_COIN;
    user.coins += gained;
    await store.putUser(user);
    return { status:200, data:{ ok:true, coins:user.coins, points:user.points, gained } };
  }

  return { status:404, data:{error:'not found'} };
}

module.exports = { handleApi, newUser, toJstString, FURNITURE_PRICES, CAT_VIDEO_FOLDERS, CAT_VIDEO_FILES };
