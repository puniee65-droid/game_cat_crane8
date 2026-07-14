'use strict';
/* ============================================================
   server.js ― ねこキャッチャー APIサーバ（Node.js / 依存パッケージなし）

   起動:  node server.js      →  http://localhost:3000/  (LPが表示される。ゲームはlp.html内のリンクから)

   将来の Cloudflare Pages/Workers 移行を意識した構成:
   - APIハンドラ handleApi() は「(method, path, body, store) → {status, data}」の
     純関数風。Node固有のreq/resに依存しないため、Workersの fetch ハンドラから
     そのまま呼び出せる（module.exports で公開済み）。
   - ストレージは Store インターフェイス（getUser / putUser / …）。
     現在は JSONファイル実装(JsonFileStore)。Workers移行時は KV / D1 を使う
     実装に差し替えるだけでハンドラは無変更。
   - 静的配信(public/)は Node 専用部。Pages 移行時は Pages が担うので不要になる。
   ============================================================ */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

// ---------------- 日本時間(JST, UTC+9)への変換 ----------------
// エポックms(epochMs)は既存のソートや計算にそのまま使えるよう保持しつつ、
// db.json を人間が読んでも分かるよう "YYYY-MM-DD HH:mm:ss" のJST文字列も併記する。
// Workers環境でも Intl.DateTimeFormat は使えるため、この関数はそのまま流用できる。
function toJstString(epochMs){
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).format(new Date(epochMs)).replace(',', '') + ' JST';
}

// ---------------- ストレージ層（Workersでは KV/D1 実装に差し替え） ----------------
class JsonFileStore {
  constructor(file){
    this.file = file;
    try{ this.db = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch(e){ this.db = { users: {} }; }
  }
  _save(){
    fs.mkdirSync(path.dirname(this.file), {recursive:true});
    fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2));
  }
  async getUser(id){ return this.db.users[id] || null; }
  async putUser(user){ this.db.users[user.userId] = user; this._save(); return user; }
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
    cats: [],                  // 獲得猫 [{id, def, caughtAt}]
    catCounts: {},             // 種類別の獲得数 {"白ねこ":2, ...}
    furniture: { tower:false, sofa:false, cushion:false, house:false },
    sessions: [],              // [{id, startedAt, endedAt}]
  };
}

// ---------------- APIハンドラ（Node/Workers共通の純関数風） ----------------
async function handleApi(method, pathname, body, store){
  const seg = pathname.split('/').filter(Boolean);   // ['api', ...]

  // POST /api/user … ユーザー確保（無ければ作成）
  if(method === 'POST' && pathname === '/api/user'){
    let userId = body && body.userId;
    let user = userId ? await store.getUser(userId) : null;
    if(!user){
      userId = 'u_' + crypto.randomBytes(6).toString('hex');
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

  // PATCH /api/user/:id … コイン・特点・ゲット数の同期
  if(method === 'PATCH' && seg[1] === 'user' && seg[2]){
    const user = await store.getUser(seg[2]);
    if(!user) return { status:404, data:{error:'user not found'} };
    for(const k of ['coins','points','score'])
      if(typeof body[k] === 'number') user[k] = body[k];
    await store.putUser(user);
    return { status:200, data:{ ok:true } };
  }

  // POST /api/session/start … プレイ開始時刻を記録
  if(method === 'POST' && pathname === '/api/session/start'){
    const user = await store.getUser(body.userId);
    if(!user) return { status:404, data:{error:'user not found'} };
    const startedAt = Date.now();
    const session = { id:'s_'+crypto.randomBytes(5).toString('hex'),
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
    const dir = path.join(PUBLIC_DIR, 'assets', kind, folder);
    let files = [];
    try{ files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp4')); }
    catch(e){ /* フォルダ未作成なら空一覧を返す */ }
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

// ---------------- Nodeアダプタ（静的配信 + API） ----------------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css', '.json':'application/json', '.png':'image/png',
               '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon',
               '.mp4':'video/mp4' };

const store = new JsonFileStore(DATA_FILE);

const server = http.createServer(async (req, res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- API ---
  if(pathname.startsWith('/api/')){
    let body = null;
    if(req.method !== 'GET'){
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      try{ body = text ? JSON.parse(text) : {}; }   // sendBeacon(text/plain)も同様に処理
      catch(e){ body = {}; }
    }
    try{
      const { status, data } = await handleApi(req.method, pathname, body, store);
      res.writeHead(status, {'Content-Type':'application/json'});
      res.end(JSON.stringify(data));
    }catch(err){
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:String(err.message||err)}));
    }
    return;
  }

  // --- 静的配信（Pages移行後は不要になる部分） ---
  let filePath = pathname === '/' ? '/lp.html' : pathname;
  filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(filePath)));
  if(!filePath.startsWith(PUBLIC_DIR)){            // パストラバーサル防止
    res.writeHead(403); res.end('forbidden'); return;
  }
  const mime = MIME[path.extname(filePath)] || 'application/octet-stream';

  // 動画はRangeリクエストに対応する（iOS Safari等は範囲取得が前提のため必須）
  if(mime.startsWith('video/')){
    fs.stat(filePath, (err, stat)=>{
      if(err){ res.writeHead(404); res.end('not found'); return; }
      const range = req.headers.range;
      if(!range){
        res.writeHead(200, {'Content-Type':mime, 'Content-Length':stat.size, 'Accept-Ranges':'bytes'});
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      const start = m[1] ? parseInt(m[1],10) : 0;
      const end   = m[2] ? parseInt(m[2],10) : stat.size-1;
      res.writeHead(206, {
        'Content-Range':`bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':'bytes', 'Content-Length': end-start+1, 'Content-Type':mime,
      });
      fs.createReadStream(filePath, {start,end}).pipe(res);
    });
    return;
  }

  fs.readFile(filePath, (err, data)=>{
    if(err){ res.writeHead(404); res.end('not found'); return; }
    // HTML/JSはCache-Controlが無いとブラウザに古い版が残り続け、
    // サーバ側だけ更新しても反映されない不具合の原因になるため常に再検証させる。
    res.writeHead(200, {'Content-Type': mime, 'Cache-Control':'no-cache'});
    res.end(data);
  });
});

// LAN上のIPv4アドレスを列挙（スマホ実機からのアクセス案内用）
function getLanAddresses(){
  const addrs = [];
  for(const ifaces of Object.values(os.networkInterfaces())){
    for(const it of ifaces || []){
      if(it.family === 'IPv4' && !it.internal) addrs.push(it.address);
    }
  }
  return addrs;
}

if(require.main === module){
  const HOST = process.env.HOST || '0.0.0.0';   // 0.0.0.0 = 同一LAN内の他端末からもアクセス可能
  server.listen(PORT, HOST, ()=>{
    console.log(`ねこキャッチャー サーバ起動:`);
    console.log(`  PC:     http://localhost:${PORT}/`);
    for(const ip of getLanAddresses())
      console.log(`  スマホ: http://${ip}:${PORT}/   (同じWi-Fi内から)`);
    if(getLanAddresses().length === 0)
      console.log('  ⚠ LAN用IPv4アドレスが見つかりませんでした（Wi-Fi/LAN接続を確認してください）');
  });
}

// Workers移行時: export default { fetch } から handleApi を呼び出す想定
module.exports = { handleApi, JsonFileStore, newUser };
