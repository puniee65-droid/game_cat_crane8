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
const os = require('node:os');
const { handleApi, newUser } = require('./lib/api-core.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

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

module.exports = { handleApi, JsonFileStore, newUser };
