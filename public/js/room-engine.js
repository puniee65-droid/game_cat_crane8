'use strict';
/* room-engine.js ― マイルーム本体（Three.js）。
   ハンバーガーメニュー等のUIはVue側。HOOKS経由で状態を通知する。 */
function createRoomEngine(HOOKS){
HOOKS = HOOKS || {};

// ---------- 診断：エラーを画面に表示（真っ黒の原因特定用） ----------
function fatal(msg){
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:999;'+
    'background:#b3261e;color:#fff;padding:12px 16px;border-radius:10px;'+
    'font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-all;'+
    'font-family:monospace';
  d.textContent = '⚠ エラー: ' + msg;
  document.body.appendChild(d);
}
window.addEventListener('error', e=>{
  fatal((e.message||'不明なエラー') + '\n  場所: ' +
        ((e.filename||'').split('/').pop()||'?') + ' 行' + (e.lineno||'?'));
});
window.addEventListener('unhandledrejection', e=>fatal('Promise: '+String(e.reason)));
if(typeof THREE === 'undefined'){
  fatal('Three.js を読み込めませんでした。ネットワーク接続、または広告ブロッカー等による ' +
        'cdnjs.cloudflare.com のブロックを確認してください。');
}
/* ============================================================
   ねこマイルーム ― クレーンゲームで獲得した猫が暮らす部屋
   受信: サーバAPI(/api/cats/:userId)が唯一の情報源。postMessageの
        'neko-transfer' はゲームから今この瞬間に転送された1匹を
        即時反映するショートカットに過ぎない（履歴の復元には使わない）。
   猫の行動: 転送出現 → 窓の外を見る → 奥の壁を背に着席（窓に近い順）
   ============================================================ */

// ---------- 基本セットアップ ----------
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaee0f2);          // 窓の外の空
scene.fog = new THREE.Fog(0xaee0f2, 30, 60);

const camera = new THREE.PerspectiveCamera(48, innerWidth/innerHeight, .1, 120);
let renderer;
try{
  renderer = new THREE.WebGLRenderer({antialias:true});
}catch(err){
  fatal('WebGLを初期化できませんでした。\n' +
        'Chromeの 設定 → システム → 「グラフィック アクセラレーションが使用可能な場合は使用する」' +
        'を有効にして再起動するか、アドレスバーに chrome://gpu と入力してWebGLの状態を確認してください。\n' +
        '詳細: ' + err.message);
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
function sizeRenderer(){
  const w = stage.clientWidth, h = stage.clientHeight;   // 額縁の内側サイズ
  renderer.setSize(w, h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
sizeRenderer();

let camTheta = -.5, camPhi = .4, camDist = 14;   // 窓(右壁)が初期視点の右側に見える向き
function updateCamera(){
  const cy = 2.2;
  camera.position.set(
    Math.sin(camTheta)*Math.cos(camPhi)*camDist,
    cy + Math.sin(camPhi)*camDist,
    Math.cos(camTheta)*Math.cos(camPhi)*camDist);
  camera.lookAt(0, 1.8, 0);
}
updateCamera();

let dragging=false, px=0, py=0, pinchD=0;
const ZOOM_MIN=6, ZOOM_MAX=26;
// クリック/タップ判定用：開始位置からの移動量が小さい場合のみ「クリック」として扱う
// （視点回転のドラッグ操作と区別するため）
let downX=0, downY=0, downT=0, moved=false;
function onDown(x,y,t){
  if(t.closest('#controls')||t.closest('#hud'))return;
  dragging=true; px=x;py=y;
  downX=x; downY=y; downT=performance.now(); moved=false;
}
function onMove(x,y){ if(!dragging)return;
  if(Math.hypot(x-downX,y-downY) > 6) moved=true;   // 6px以上動いたらドラッグ扱い
  camTheta -= (x-px)*.005;
  camPhi = Math.min(1.45, Math.max(-.05, camPhi+(y-py)*.004));
  px=x;py=y; updateCamera(); }
function onUp(x,y,t){
  if(dragging && !moved && performance.now()-downT < 500) handlePick(x,y,t);
  dragging=false;
}
addEventListener('mousedown', e=>onDown(e.clientX,e.clientY,e.target));
addEventListener('mousemove', e=>onMove(e.clientX,e.clientY));
addEventListener('mouseup', e=>onUp(e.clientX,e.clientY,e.target));
addEventListener('wheel', e=>{
  if(e.target.closest('#controls')||e.target.closest('#hud'))return;
  camDist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camDist+e.deltaY*.012));
  updateCamera(); e.preventDefault();
},{passive:false});
addEventListener('touchstart', e=>{
  if(e.touches.length===2){ dragging=false;
    pinchD=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
  }else{ const t=e.touches[0]; onDown(t.clientX,t.clientY,e.target); }
},{passive:true});
addEventListener('touchmove', e=>{
  if(e.touches.length===2 && pinchD>0){
    const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    camDist=Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camDist*pinchD/d));
    pinchD=d; updateCamera();
    if(e.cancelable) e.preventDefault();
  }else{ const t=e.touches[0]; onMove(t.clientX,t.clientY); }
},{passive:false});
addEventListener('touchend', e=>{
  if(e.touches.length<2)pinchD=0;
  if(e.touches.length===0){
    const t=e.changedTouches[0];
    if(t) onUp(t.clientX,t.clientY,e.target); else dragging=false;
  }
});
addEventListener('resize', sizeRenderer);

// ---------- 猫クリック判定（クリック＝インタラクション。動画ポップアップを開く） ----------
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
function handlePick(x,y,target){
  if(target.closest('#controls')||target.closest('#hud'))return;
  const rect = stage.getBoundingClientRect();
  pointerNdc.x = ((x-rect.left)/rect.width)*2-1;
  pointerNdc.y = -((y-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(cats, true);
  if(hits.length===0) return;
  // ヒットしたメッシュから、猫グループ(userData.name等を持つ)まで親を辿る
  let obj = hits[0].object;
  while(obj && !obj.userData?.name) obj = obj.parent;
  if(!obj) return;
  const u = obj.userData;
  u.lastInteractionAt = Date.now();          // クリック＝インタラクションなので寝ている猫はここで起きる
  if(u.state === 'sleeping'){
    u.state = 'rest'; u.restMode = 'stand'; u.t = 0;
  }
  if(HOOKS.onCatClick){
    HOOKS.onCatClick(obj, u.name);
  }
}
// 隠しキー「C」：全員を強制的に寝かせる（デバッグ。1時間待たずに睡眠演出を確認できる）
addEventListener('keydown', e=>{
  if(e.repeat || (e.key!=='c' && e.key!=='C')) return;
  for(const cat of cats){
    const u = cat.userData;
    u.jump = null;
    u.state = 'sleeping'; u.loafGoal = 1; u.t = 0;
  }
  if(HOOKS.showMsg) HOOKS.showMsg('💤 全員おやすみ（デバッグ）');
});

// ---------- ライティング ----------
scene.add(new THREE.AmbientLight(0xfff4e4,.6));
const sun = new THREE.DirectionalLight(0xfff2d8,.9);
sun.position.set(3, 9, -8);                            // 窓の外から差し込む
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-14; sun.shadow.camera.right=14;
sun.shadow.camera.top=14; sun.shadow.camera.bottom=-14;
sun.shadow.bias=-.0004; sun.shadow.normalBias=.02;
scene.add(sun);
const lamp = new THREE.PointLight(0xffe0b8,.5,18);
lamp.position.set(2,3.6,2); scene.add(lamp);

// ---------- 部屋（クレーンゲームとほぼ同サイズ：内寸 10×8）----------
const ROOM = {minX:-5, maxX:5, minZ:-5, maxZ:5, wallH:4.6};   // 家具配置のため奥行きを拡張(10×10)
const room = new THREE.Group(); scene.add(room);
const matWall = new THREE.MeshStandardMaterial({color:0xf4f1ea, roughness:.95});

// 薄茶色のフローリング（Canvasで板目テクスチャを生成）
const fCan = document.createElement('canvas'); fCan.width=fCan.height=256;
{
  const c = fCan.getContext('2d');
  c.fillStyle='#c9a06a'; c.fillRect(0,0,256,256);
  for(let y=0;y<256;y+=32){                            // 板の継ぎ目
    c.fillStyle='rgba(90,60,30,.35)'; c.fillRect(0,y,256,2);
    const off=(y/32)%2?128:0;                          // 継ぎ目の互い違い
    c.fillRect(off,y,2,32);
    for(let i=0;i<26;i++){                             // 木目
      c.strokeStyle=`rgba(140,95,50,${.06+Math.random()*.10})`;
      c.beginPath();
      const gy=y+3+Math.random()*27;
      c.moveTo(0,gy); c.bezierCurveTo(80,gy+3,170,gy-3,256,gy+2); c.stroke();
    }
  }
}
const floorTex = new THREE.CanvasTexture(fCan);
floorTex.wrapS=floorTex.wrapT=THREE.RepeatWrapping; floorTex.repeat.set(3,2.4);
const floor = new THREE.Mesh(new THREE.BoxGeometry(10.6,.3,10.6),
  new THREE.MeshStandardMaterial({color:0xffffff, roughness:.85, map:floorTex}));
floor.position.y=-.15; floor.receiveShadow=true; room.add(floor);

// 外の地面と木（窓から見える景色）
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60,40),
  new THREE.MeshStandardMaterial({color:0x7fb069, roughness:1}));
ground.rotation.x=-Math.PI/2; ground.position.y=-.32; ground.receiveShadow=true; scene.add(ground);
function tree(x,z,s){
  const t=new THREE.Group();
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.18*s,.24*s,1.6*s,8),
    new THREE.MeshStandardMaterial({color:0x8a6a48, roughness:.9}));
  trunk.position.y=.8*s; t.add(trunk);
  for(const [dx,dy,dz,r] of [[0,2.0,0,1.0],[.6,1.6,.2,.7],[-.55,1.7,-.2,.75]]){
    const f=new THREE.Mesh(new THREE.SphereGeometry(r*s,12,10),
      new THREE.MeshStandardMaterial({color:0x5a9e52, roughness:.95}));
    f.position.set(dx*s,dy*s,dz*s); f.castShadow=true; t.add(f);
  }
  t.position.set(x,-.3,z); scene.add(t);
}
tree(10,-2.5,1.2); tree(12,4.5,1.6); tree(13,-6.5,1.4);

// 庭の小道：中心線に沿ってリボン状メッシュを生成
function buildPathMesh(points, width){
  const pos=[], idx=[];
  for(let i=0;i<points.length;i++){
    const p=points[i];
    const q=points[Math.min(points.length-1,i+1)];
    const r=points[Math.max(0,i-1)];
    let tx=q.x-r.x, tz=q.z-r.z;
    const l=Math.hypot(tx,tz)||1; tx/=l; tz/=l;
    const nx=-tz, nz=tx;                                 // 進行方向の法線
    pos.push(p.x+nx*width/2, 0, p.z+nz*width/2);
    pos.push(p.x-nx*width/2, 0, p.z-nz*width/2);
  }
  for(let i=0;i<points.length-1;i++){
    const a=i*2;
    idx.push(a,a+1,a+2, a+1,a+3,a+2);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m=new THREE.Mesh(geo,
    new THREE.MeshStandardMaterial({color:0xd9c49a, roughness:1}));
  m.position.y=-.30;                                     // 芝(-.32)よりわずかに上
  m.receiveShadow=true;
  scene.add(m);
  return m;
}
{
  // 横断路：うねりながら庭の奥端(-30)から手前端(+30)まで（窓(+x)に正対する向き）
  const main=[];
  for(let z=-30;z<=30;z+=1.2)
    main.push({x:8.2 + Math.sin(z*.33)*.9 + Math.sin(z*.11)*.5, z});
  buildPathMesh(main, 1.5);
  // 窓から横断路へ合流する取り付け路
  const conn=[];
  for(let x=5.3;x<=8.2;x+=.35)
    conn.push({x, z:Math.sin((x-5.3)*1.1)*.35});
  buildPathMesh(conn, 1.1);
}

// --- 壁（カメラ側は自動で非表示にするため、面ごとにグループ管理） ---
const walls = [];   // {group, normal}
function addWall(group, nx, nz){ room.add(group); walls.push({group, normal:new THREE.Vector3(nx,0,nz)}); }

// 前面(+z)・左(-x)・右(+x)：一枚壁
function plainWall(w, x, z, ry, nx, nz){
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,ROOM.wallH,.22), matWall);
  m.position.set(0,ROOM.wallH/2,0); g.add(m);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(w,.22,.26),
    new THREE.MeshStandardMaterial({color:0xd8cfc0, roughness:.9}));
  skirt.position.set(0,.11,.02); g.add(skirt);
  g.position.set(x,0,z); g.rotation.y=ry;
  addWall(g,nx,nz);
}
plainWall(10.6,  0, ROOM.maxZ+.11, 0,        0, 1);   // 前
plainWall(10.6, ROOM.minX-.11, 0, Math.PI/2, -1, 0);  // 左
plainWall(10.6,  0, ROOM.minZ-.11, 0,        0,-1);   // 背面（無地）

// 右(+x)：掃き出し窓つき（開口 z:-2〜2, y:0〜3.4）。
// plainWallと同じ変換(位置・ry=Math.PI/2)を使うことで、右壁として正しい向きになる。
{
  const g = new THREE.Group();
  const seg = (w,h,x,y)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.22), matWall);
    m.position.set(x,y,0); g.add(m);
  };
  seg(3.3, ROOM.wallH, -3.65, ROOM.wallH/2);                 // 左パネル
  seg(3.3, ROOM.wallH,  3.65, ROOM.wallH/2);                 // 右パネル
  seg(4.0, ROOM.wallH-3.4, 0, 3.4+(ROOM.wallH-3.4)/2);       // 窓上
  // サッシ枠と中央の召し合わせ
  const matSash = new THREE.MeshStandardMaterial({color:0x9aa3a8, roughness:.4, metalness:.5});
  const frame = (w,h,x,y)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.14), matSash);
    m.position.set(x,y,0); g.add(m);
  };
  frame(4.2,.12, 0, 3.42); frame(4.2,.1, 0, .06);
  frame(.12,3.4, -2.02, 1.7); frame(.12,3.4, 2.02, 1.7); frame(.1,3.4, 0, 1.7);
  // ガラス2枚
  const matGlass = new THREE.MeshPhysicalMaterial({color:0xcfeaff, transparent:true, opacity:.14,
    roughness:.05, side:THREE.DoubleSide, depthWrite:false});
  for(const gx of [-1,1]){
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.9,3.25), matGlass);
    gl.position.set(gx, 1.68, 0); g.add(gl);
  }
  g.position.set(ROOM.maxX+.11, 0, 0); g.rotation.y = Math.PI/2;
  addWall(g, 1, 0);
}

// カメラ側の壁を非表示にする
function updateWallVisibility(){
  const dir = camera.position.clone(); dir.y=0; dir.normalize();
  for(const w of walls) w.group.visible = w.normal.dot(dir) < .35;
}

// ---------- 家具（初期状態では未設置。☰メニューの「お買い物」で購入・設置） ----------
const matCarpet = new THREE.MeshStandardMaterial({color:0xb98d5f, roughness:.98});
const matPole   = new THREE.MeshStandardMaterial({color:0xe0cba6, roughness:.95});
const matSofa   = new THREE.MeshStandardMaterial({color:0x4e8098, roughness:.9});
const matSofaD  = new THREE.MeshStandardMaterial({color:0x3d6a80, roughness:.9});

// 猫タワー（左奥）
function buildCatTower(){
  const t = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7,.12,1.7), matCarpet);
  base.position.y=.06; base.castShadow=base.receiveShadow=true; t.add(base);
  const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,2.75,10), matPole);
  pole1.position.set(-.3,1.42,.2); pole1.castShadow=true; t.add(pole1);
  const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,1.95,10), matPole);
  pole2.position.set(.4,1.0,-.25); pole2.castShadow=true; t.add(pole2);
  const plat = (x,y,z,r)=>{
    const p=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.1,18), matCarpet);
    p.position.set(x,y,z); p.castShadow=p.receiveShadow=true; t.add(p);
  };
  plat(-.3,1.05,.3,.58); plat(.4,1.95,-.2,.52); plat(-.1,2.75,.1,.55);
  t.position.set(-3.5,0,-3.75); room.add(t);   // ソファーとの隙間を確保するため奥へ寄せる
  return t;
}
// タワーは現在オブジェとしてのみ存在（猫のAIは登らない。将来また使うかもしれないので
// buildCatTower自体は残す）。

// ソファー（猫タワーと猫小屋の間・左壁沿い・部屋の中央を向く）
function buildSofa(){
  const s = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5,.66,3.3), matSofa);
  seat.position.set(0,.33,0); seat.castShadow=seat.receiveShadow=true; s.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(.35,1.6,3.3), matSofaD);
  back.position.set(-.72,.8,0); back.castShadow=true; s.add(back);
  for(const dz of [-1,1]){
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.05,.3), matSofaD);
    arm.position.set(0,.52,dz*1.8); arm.castShadow=true; s.add(arm);
  }
  for(let i=0;i<3;i++){                                 // 背クッション
    const c = new THREE.Mesh(new THREE.BoxGeometry(.3,.8,.95), matSofa);
    c.position.set(-.5,.95,-1.05+i*1.05); s.add(c);
  }
  s.position.set(-3.75,0,.2); room.add(s);
  return s;
}

// クッション（中央手前）
function buildCushion(){
  const g = new THREE.Group();
  const cu = new THREE.Mesh(new THREE.CylinderGeometry(.8,.9,.22,20),
    new THREE.MeshStandardMaterial({color:0xd96a6a, roughness:.95}));
  cu.position.y=.11; cu.castShadow=cu.receiveShadow=true; g.add(cu);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.05,10),
    new THREE.MeshStandardMaterial({color:0xb84f4f, roughness:.9}));
  btn.position.y=.23; g.add(btn);
  g.position.set(-.6,0,3.0); room.add(g);   // 猫小屋の角と頭がぶつからないよう右へ離す
  return g;
}

// 猫小屋（左手前）
function buildCatHouse(){
  const h = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.25,1.5),
    new THREE.MeshStandardMaterial({color:0xefe3cd, roughness:.95}));
  body.position.y=.62; body.castShadow=body.receiveShadow=true; h.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25,.8,4),
    new THREE.MeshStandardMaterial({color:0xc95f5f, roughness:.9}));
  roof.position.y=1.65; roof.rotation.y=Math.PI/4; roof.castShadow=true; h.add(roof);
  const door = new THREE.Mesh(new THREE.CircleGeometry(.36,20),
    new THREE.MeshStandardMaterial({color:0x33241d, roughness:1}));
  door.position.set(.76,.55,0); door.rotation.y=Math.PI/2; h.add(door);
  h.position.set(-3.9,0,3.6); room.add(h);
  return h;
}

// 所持家具（購入すると設置済みグループが入る）
const furniture = { tower:null, sofa:null, cushion:null, house:null };

// 「奥の壁」に背を向けて並んで座る席。窓に近い側（world +x寄り）から順に割り当て、
// 猫タワーの設置場所は避ける。間隔は猫一匹分（CAT_GAP）。
const BACK_WALL_Z = ROOM.minZ + .55;     // 壁ぎわ（背中が触れる程度の距離）
const SEAT_RY = -Math.PI/2;              // 壁を背にして部屋の内側(+z)を向く（Three.jsで実測検証済み）
const CAT_GAP = 1.05;                    // 猫一匹分の間隔
const TOWER_CENTER = {x:-3.5, z:-3.75}, TOWER_AVOID_R = 1.3;
function buildSeatRow(rowIndex){
  const z = BACK_WALL_Z + rowIndex*CAT_GAP;   // 満席なら壁からもう一列奥へ
  const xs = [];
  for(let x=ROOM.maxX-.7; x>ROOM.minX+.5; x-=CAT_GAP){
    if(Math.hypot(x-TOWER_CENTER.x, z-TOWER_CENTER.z) < TOWER_AVOID_R) continue;  // タワーを避ける
    xs.push(x);
  }
  return xs;
}
const seatRows = [buildSeatRow(0)];
let seatCounter = 0;
function nextWallSeat(){
  let idx = seatCounter++, rowIndex = 0;
  while(idx >= seatRows[rowIndex].length){
    idx -= seatRows[rowIndex].length;
    rowIndex++;
    if(!seatRows[rowIndex]) seatRows[rowIndex] = buildSeatRow(rowIndex);
  }
  const x = seatRows[rowIndex][idx], z = BACK_WALL_Z + rowIndex*CAT_GAP;
  return { pos: new THREE.Vector3(x,0,z), ry: SEAT_RY };
}

// 窓辺スポット
function windowSpot(){ return new THREE.Vector3(4.3, 0, -.8+Math.random()*1.6); }   // 右壁の窓辺

// ---------- 「部屋で遊ぶ」機能用：家具のワールド座標とジャンプ移動 ----------
// buildXxx()が置く各家具のローカル座標＋家具グループのpositionから算出した、
// 「遊ぶ」演出で使うワールド座標の代表点。
const PLAY_SPOTS = {
  tower: {
    approach: new THREE.Vector3(-3.3, 0, -2.55),
    up: [ new THREE.Vector3(-3.8,1.10,-3.45), new THREE.Vector3(-3.1,2.00,-3.95), new THREE.Vector3(-3.6,2.80,-3.65) ],
  },
  sofa:    { approach: new THREE.Vector3(-2.45,0,.2), top: new THREE.Vector3(-3.55,.7,.2) },
  cushion: { approach: new THREE.Vector3(-.6,0,2.0), top: new THREE.Vector3(-.6,.28,3.0) },
  house:   { approach: new THREE.Vector3(-3.14,0,3.6), inside: new THREE.Vector3(-3.9,.15,3.6) },
};
function startJump(u, from, to){
  const d = from.distanceTo(to);
  u.jump = {from:from.clone(), to:to.clone(), t:0, dur:.32+d*.1, arc:.3+d*.15};
}
function updateJump(cat, dt){                            // true=着地
  const u = cat.userData, j = u.jump;
  j.t += dt;
  const k = Math.min(1, j.t/j.dur);
  cat.position.lerpVectors(j.from, j.to, k);
  cat.position.y += Math.sin(k*Math.PI)*j.arc;
  const dx=j.to.x-j.from.x, dz=j.to.z-j.from.z;
  if(dx*dx+dz*dz>1e-4) cat.rotation.y = Math.atan2(dx,dz)-Math.PI/2;
  u.legs.forEach((l,i)=>l.rotation.z = (i<2?-.7:.6)*Math.sin(k*Math.PI));  // 跳躍ポーズ
  if(k>=1){ u.jump=null; u.legs.forEach(l=>l.rotation.z=0); return true; }
  return false;
}




// ---------- 部屋の猫 ----------
const cats = [];
function makeRoomCat(def){
  const m = buildCatModel(def);
  const g = m.group;
  const scale = (def.props.scale || 1) * .95;
  g.scale.setScalar(scale);
  g.userData = {
    legs:m.legs, head:m.head, tailRoot:m.tailRoot, tailSegs:m.tailSegs,
    eyes:m.eyes, tongue:m.tongue, eyeScale:(def.props.eyeSize||1),
    scale, phase:Math.random()*10, lickT:-1,
    loaf:0, loafGoal:0,
    loafDrop: Math.max(.04, .05 + .42*((def.props.legLen||1)-1) + .06),
    baseY:0, state:'spawnFx', t:0,
    speed:1.05+Math.random()*.4,
    slot: null,                       // 着席スポットは窓を見終えた時点で割り当てる
    homeSeat: null,                   // 定位置（着席後に一度だけ記録し、遊ぶ/冒険の帰り先にする）
    lastInteractionAt: Date.now(),    // 最後にクリック等で構ってもらった時刻（睡眠判定に使用）
    playKind: null, playPhase: 0, adventureTarget: null, eatT: -1,
    name: def.name || 'ねこ',
    points: Number.isFinite(+def.points) ? +def.points : 10,
  };
  if(def.rainbow){
    g.userData.rainbowMeshes = applyRainbowStripes(g, scale);   // 7色縞々（共通実装）
  }
  return g;
}

function spawnRoomCat(def){
  const c = makeRoomCat(def);
  c.position.set(1.6+(Math.random()-.5), 0, .4+(Math.random()-.5));   // 転送着地点
  c.rotation.y = Math.random()*Math.PI*2;
  c.scale.setScalar(.001);                                             // 出現演出用に極小から
  scene.add(c); cats.push(c);
  chime();
  showMsg(`✨ ${c.userData.name}がやってきた！`);
  refreshHUD();
  return c;
}

// ---------- 行動制御 ----------
const WALK_MARGIN = .5;   // 部屋境界クランプの余白（壁に体がめり込まない程度の厚み）
function walkToward(cat, target, dt, bounded=true){
  const u = cat.userData;
  const to = new THREE.Vector3().subVectors(target, cat.position); to.y=0;
  const dist = to.length();
  if(dist < .18) return true;
  const desired = Math.atan2(to.x, to.z) - Math.PI/2;
  let dr = desired - cat.rotation.y;
  while(dr> Math.PI) dr-=Math.PI*2;
  while(dr<-Math.PI) dr+=Math.PI*2;
  cat.rotation.y += dr*Math.min(1, dt*4);
  const step = u.speed*dt;
  cat.position.x += Math.cos(cat.rotation.y)*step;
  cat.position.z -= Math.sin(cat.rotation.y)*step;
  if(bounded){   // 冒険で庭に出る間はfalseにして部屋の境界クランプを外す
    cat.position.x = Math.max(ROOM.minX+WALK_MARGIN, Math.min(ROOM.maxX-WALK_MARGIN, cat.position.x));
    cat.position.z = Math.max(ROOM.minZ+WALK_MARGIN, Math.min(ROOM.maxZ-WALK_MARGIN, cat.position.z));
  }
  const a = Math.sin(u.phase)*.55;                       // 歩行アニメ（胴体長軸方向）
  u.legs[0].rotation.z= a; u.legs[3].rotation.z= a;
  u.legs[1].rotation.z=-a; u.legs[2].rotation.z=-a;
  cat.position.y = u.baseY + Math.abs(Math.sin(u.phase))*.035;
  return false;
}
function think(cat, dt){
  const u = cat.userData;
  u.phase += dt*((u.state.startsWith('to')||u.state==='playing'||u.state==='adventure') ? u.speed*7 : 2);

  if(u.rainbowMeshes) tickRainbowStripes(u.rainbowMeshes);

  // しっぽ
  u.tailRoot.rotation.y = Math.sin(u.phase*.9)*.28*(1-.6*u.loaf);
  u.tailSegs.forEach((s,i)=>s.rotation.y = Math.sin(u.phase*.9-i*.7)*.3*(1-.6*u.loaf));

  // 香箱ポーズのブレンド（restで使用）
  u.loaf += (u.loafGoal-u.loaf)*Math.min(1, dt*3);
  if(u.loaf>.003){
    for(const l of u.legs) l.scale.y = 1-.82*u.loaf;
    u.tailRoot.rotation.z = .85-.55*u.loaf;
    u.head.rotation.z = -.2*u.loaf;
    for(const ey of u.eyes) ey.scale.y = u.eyeScale*(1-.94*u.loaf);   // 目を閉じる
    cat.scale.y = u.scale*(1+.03*u.loaf*Math.sin(u.phase*.7));
    if(u.state==='rest') cat.position.y = u.baseY - u.loafDrop*u.scale*u.loaf;
  }else if(u.legs[0].scale.y!==1 && !u.jump){
    for(const l of u.legs) l.scale.y=1;
    u.tailRoot.rotation.z=.85; u.head.rotation.z=0;
    for(const ey of u.eyes) ey.scale.y=u.eyeScale;
    cat.scale.y=u.scale;
  }

  // 舌なめずり（静止状態のみ）
  const stationary = ['window','rest'].includes(u.state);
  if(u.lickT>=0){
    if(!stationary){ u.lickT=-1; u.tongue.visible=false; }
    else{
      u.lickT+=dt;
      const dur=1.15;
      if(u.lickT>=dur){ u.lickT=-1; u.tongue.visible=false; }
      else{
        u.tongue.visible=true;
        const env=Math.sin(Math.PI*u.lickT/dur);
        u.tongue.scale.set(1.1*env+.001,.55*env+.001,.9*env+.001);
        u.tongue.position.set(.40,-.18+.025*Math.sin(u.lickT*9),.05*Math.sin(u.lickT*15));
      }
    }
  }else if(stationary && Math.random()<dt*.1){ u.lickT=0; }

  // --- 状態遷移 ---
  switch(u.state){
    case 'spawnFx':{                                   // トランスポーテーション出現
      u.t+=dt;
      const k=Math.min(1,u.t/.7);
      cat.scale.setScalar(Math.max(.001,u.scale*k));
      cat.scale.y=Math.max(.001,u.scale*k);
      cat.rotation.y+=dt*9*(1-k);
      if(k>=1){ u.target=windowSpot(); u.state='toWindow'; }   // 出現後はまず窓の外を見に行く
      break;
    }
    case 'toWindow':
      if(walkToward(cat, u.target, dt)){
        u.state='window'; u.t=0;
      }
      break;
    case 'window':{                                    // 窓の外を眺める
      // 窓（+x、右壁）の方を向く
      let dr = 0 - cat.rotation.y;
      while(dr>Math.PI)dr-=Math.PI*2; while(dr<-Math.PI)dr+=Math.PI*2;
      cat.rotation.y += dr*Math.min(1,dt*3);
      u.head.rotation.z += (.18-u.head.rotation.z)*Math.min(1,dt*3);   // 顔を上げる
      u.head.rotation.y = Math.sin(u.phase*.35)*.3;                    // 外をきょろきょろ
      u.t+=dt;
      if(u.t > 4.5+Math.random()*2){
        u.slot = nextWallSeat();      // 窓に近い側から順に、奥の壁の席を割り当てる
        u.state='toSeat';
      }
      break;
    }
    case 'toSeat':                                      // 奥の壁へ、背を向けて着席
      if(walkToward(cat, u.slot.pos, dt)){
        cat.position.copy(u.slot.pos);
        cat.rotation.y = u.slot.ry;
        u.baseY=0; u.state='rest'; u.t=0; u.restMode='stand';
        if(!u.homeSeat) u.homeSeat = {pos:cat.position.clone(), ry:cat.rotation.y};  // 定位置を記録
      }
      break;
    case 'toHome':                                      // 遊び／冒険から定位置へ帰る
      if(walkToward(cat, u.homeSeat.pos, dt, false)){
        cat.position.copy(u.homeSeat.pos);
        cat.rotation.y = u.homeSeat.ry;
        u.baseY=0; u.state='rest'; u.t=0; u.restMode='stand';
      }
      break;
    case 'rest':                                       // 定位置で待機（立ち⇔香箱）
      // 1時間クリック等のインタラクションが無ければ眠る
      if(Date.now() - u.lastInteractionAt > 3600000){
        u.state='sleeping'; u.loafGoal=1; u.t=0;
        break;
      }
      u.t+=dt;
      if(u.restMode==='stand'){
        u.head.rotation.y = Math.sin(u.phase*.5)*.35;
        u.loafGoal=0;
        if(u.t > 4+Math.random()*3){ u.restMode='loaf'; u.t=0; }
      }else{
        u.loafGoal=1;
        if(u.t > 6+Math.random()*5){ u.restMode='stand'; u.t=0; }
      }
      break;
    case 'sleeping':                                    // ぐっすり（クリックされるまで継続）
      u.loafGoal=1;
      break;
    case 'eating': updateEating(cat, dt); break;
    case 'playing': updatePlaying(cat, dt); break;
    case 'adventure': updateAdventure(cat, dt); break;
  }

  // --- 最終安全策：ジャンプ中でも香箱中でも「意図的に高い場所にいる」のでもなければ、
  //     経路によらず必ず地面基準のバウンド(0〜.035)に強制し、足が浮く/めり込むのを防ぐ ---
  if(!u.jump && u.state!=='rest' && u.state!=='eating' && u.state!=='sleeping'){
    const elevated = (u.state==='playing') &&
      ((u.playKind==='tower' && u.playStep==='top') ||
       ((u.playKind==='sofa'||u.playKind==='cushion') && u.playStep==='wait'));
    if(!elevated)
      cat.position.y = groundLevelAt(cat.position.x) + Math.abs(Math.sin(u.phase))*.035;
  }
}

// ---------- エサ・遊ぶ・冒険（クリックポップアップのボタンから呼ばれる） ----------
function updateEating(cat, dt){
  const u = cat.userData;
  u.eatT += dt;
  const dur = 1.6;
  const env = Math.abs(Math.sin(u.eatT*6));
  u.head.rotation.z = -.25*env;                  // 頭を上下に振って食べる仕草
  u.tongue.visible = true;
  u.tongue.scale.set(.9*env+.001,.5*env+.001,.8*env+.001);
  u.tongue.position.set(.40,-.16,0);
  if(u.eatT >= dur){
    u.tongue.visible=false; u.head.rotation.z=0;
    u.state = u.preEatState || 'rest';
    if(u.state==='rest'){ u.t=0; u.restMode='stand'; }
  }
}
function finishPlay(cat){
  const u = cat.userData;
  u.loafGoal = 0;      // 香箱姿勢のまま帰路を歩かないよう、脚をいったん伸ばす
  u.state = 'toHome';
}
function updatePlaying(cat, dt){
  const u = cat.userData, spot = PLAY_SPOTS[u.playKind];
  if(u.playKind==='tower'){
    if(u.playStep==='approach'){
      if(walkToward(cat, spot.approach, dt)){
        startJump(u, cat.position, spot.up[0]); u.playIdx=0; u.playStep='up';
      }
    }else if(u.playStep==='up'){
      if(updateJump(cat,dt)){
        if(++u.playIdx < spot.up.length) startJump(u, cat.position, spot.up[u.playIdx]);
        else{ u.playStep='top'; u.t=0; u.baseY=cat.position.y; }
      }
    }else if(u.playStep==='top'){
      u.head.rotation.y = Math.sin(u.phase*.4)*.5;
      u.t += dt;
      if(u.t > 2+Math.random()*1.5){
        // 台座(up[0])止まりだと、toHome移行時にタワーの干渉判定除外が外れて
        // すぐそばの当たり判定に強く押し出され、ソファーとの隙間で詰まってしまう。
        // 地上のapproach地点まで降りてから帰路につかせる。
        u.playDown = [spot.up[1], spot.up[0], spot.approach];
        startJump(u, cat.position, u.playDown[0]); u.playIdx=0; u.playStep='down'; u.baseY=0;
      }
    }else if(u.playStep==='down'){
      if(updateJump(cat,dt)){
        if(++u.playIdx < u.playDown.length) startJump(u, cat.position, u.playDown[u.playIdx]);
        else finishPlay(cat);
      }
    }
  }else if(u.playKind==='sofa' || u.playKind==='cushion'){
    if(u.playStep==='approach'){
      if(walkToward(cat, spot.approach, dt)){ startJump(u, cat.position, spot.top); u.playStep='jumpOn'; }
    }else if(u.playStep==='jumpOn'){
      if(updateJump(cat,dt)){ u.baseY=spot.top.y; u.playStep='wait'; u.t=0; u.loafGoal=1; }
    }else if(u.playStep==='wait'){
      u.t+=dt;
      if(u.t>2.5+Math.random()*1.5){
        u.loafGoal=0; u.baseY=0;
        startJump(u, cat.position, spot.approach); u.playStep='jumpOff';
      }
    }else if(u.playStep==='jumpOff'){
      if(updateJump(cat,dt)) finishPlay(cat);
    }
  }else if(u.playKind==='house'){
    if(u.playStep==='approach'){
      if(walkToward(cat, spot.approach, dt)){ u.playStep='enter'; u.t=0; }
    }else if(u.playStep==='enter'){
      u.t+=dt; const k=Math.min(1,u.t/.3);
      cat.scale.setScalar(u.scale*(1-k*.94));
      cat.position.lerpVectors(spot.approach, spot.inside, k);
      if(k>=1){ u.playStep='inside'; u.t=0; }
    }else if(u.playStep==='inside'){
      u.t+=dt;
      if(u.t>2+Math.random()*1.5){ u.playStep='exit'; u.t=0; }
    }else if(u.playStep==='exit'){
      u.t+=dt; const k=Math.min(1,u.t/.3);
      cat.scale.setScalar(u.scale*(.06+k*.94));
      cat.position.lerpVectors(spot.inside, spot.approach, k);
      if(k>=1){ cat.scale.setScalar(u.scale); finishPlay(cat); }
    }
  }
}
// 窓の中心（世界座標 x=ROOM.maxX+.11≒5.11, z=0）をくぐって庭へ出入りする経由点。
// 直接ランダムな庭の目的地へ直進すると、その方角によっては窓のない壁を
// 突き抜けて出てしまうため、必ずこの2点を通過させてから庭側へ進む。
const WINDOW_IN  = new THREE.Vector3(ROOM.maxX-.6, 0, 0);   // 部屋側、窓のすぐ手前
const WINDOW_OUT = new THREE.Vector3(ROOM.maxX+1.4, 0, 0);  // 庭側、窓を出てすぐ
// 室内の床の上面はy=0だが、庭の地面(ground)はy=-.32に敷いてあるため高さが違う。
// 窓の幅(WINDOW_IN〜WINDOW_OUT)の間でなだらかに下げ、庭に出ている間はその高さに合わせる。
const GARDEN_GROUND_Y = -.32;   // groundメッシュのy座標と一致させること
function groundLevelAt(x){
  const t = Math.max(0, Math.min(1,
    (x - WINDOW_IN.x) / (WINDOW_OUT.x - WINDOW_IN.x)));
  return GARDEN_GROUND_Y * t;
}
function updateAdventure(cat, dt){
  const u = cat.userData;
  switch(u.advStep){
    case 'toWindow':                                   // 部屋の中を窓際まで歩く（壁の範囲内）
      if(walkToward(cat, WINDOW_IN, dt, true)) u.advStep='exit';
      break;
    case 'exit':                                        // 窓を通り抜けて庭へ
      if(walkToward(cat, WINDOW_OUT, dt, false)) u.advStep='wander';
      break;
    case 'wander':                                      // 庭をランダムな方向・距離まで歩く
      if(walkToward(cat, u.adventureTarget, dt, false)) u.advStep='return';
      break;
    case 'return':                                      // 庭から窓の外側まで戻る
      if(walkToward(cat, WINDOW_OUT, dt, false)) u.advStep='enter';
      break;
    case 'enter':                                        // 窓をくぐって部屋の中へ
      if(walkToward(cat, WINDOW_IN, dt, false)){
        u.loafGoal = 0;                                  // 帰路も脚を伸ばした状態を維持
        u.state = 'toHome';                               // ここから先は定位置への帰還（既存ロジックを再利用）
      }
      break;
  }
}

// クリックポップアップから呼ばれる公開アクション
function feedCat(cat){
  if(!cat || !cat.userData) return;
  const u = cat.userData;
  u.lastInteractionAt = Date.now();
  if(['sleeping'].includes(u.state)){ u.state='rest'; u.restMode='stand'; u.t=0; }
  u.lickT = -1;                        // 通常の毛づくろいと衝突しないよう止める
  u.preEatState = (u.state==='eating') ? u.preEatState : u.state;
  u.eatT = 0; u.state = 'eating';
}
function playWithFurniture(cat){
  if(!cat || !cat.userData) return false;
  const u = cat.userData;
  const owned = Object.keys(furniture).filter(k=>furniture[k]);
  if(owned.length===0) return false;
  u.lastInteractionAt = Date.now();
  u.loafGoal = 0;                                // 香箱姿勢のままだと脚が潰れて歩けないため解除
  if(!u.homeSeat) u.homeSeat = {pos:cat.position.clone(), ry:cat.rotation.y};
  u.playKind = owned[Math.floor(Math.random()*owned.length)];
  u.playStep = 'approach'; u.playIdx = 0;
  u.state = 'playing'; u.t = 0;
  return true;
}
function startAdventure(cat){
  if(!cat || !cat.userData) return;
  const u = cat.userData;
  u.lastInteractionAt = Date.now();
  u.loafGoal = 0;                                // 香箱姿勢のままだと脚が潰れて歩けないため解除
  u.playKind = null;    // 前回遊んだ家具の除外判定が帰路(toHome)に誤って残らないようにする
  if(!u.homeSeat) u.homeSeat = {pos:cat.position.clone(), ry:cat.rotation.y};
  // 窓を出た先（x>=WINDOW_OUT.x）を中心に、ランダムな方向・距離を庭の目的地にする
  const angle = (Math.random()*2-1) * .9;       // 窓の正面方向を中心に±52°ほどの範囲
  const dist  = 10 + Math.random()*8;           // 窓を出てからの距離（＝庭の「端」）
  u.adventureTarget = new THREE.Vector3(
    (ROOM.maxX+1.4) + Math.cos(angle)*dist, 0, Math.sin(angle)*dist);
  u.state = 'adventure'; u.advStep = 'toWindow';
}

// 猫同士の物理的な重なり防止（体＋頭の2円で判定）。
// 頭は中心から前方に突き出したプロポーションなので、中心1円だけだと
// 正面から近づいた2匹の頭がすり抜ける（クレーンゲーム側と同じ手法）。
function catCircles(cat){
  const s = cat.userData.scale;
  const fx = Math.cos(cat.rotation.y), fz = -Math.sin(cat.rotation.y);
  return [
    { x: cat.position.x - fx*.1*s, z: cat.position.z - fz*.1*s, r: .58*s },   // 体
    { x: cat.position.x + fx*.72*s, z: cat.position.z + fz*.72*s, r: .48*s }, // 頭
  ];
}
function separate(){
  for(let i=0;i<cats.length;i++){
    const a = cats[i];
    for(let j=i+1;j<cats.length;j++){
      const b = cats[j];
      const ca = catCircles(a), cb = catCircles(b);
      let deepest=0, nx=0, nz=0;
      for(const p of ca) for(const q of cb){
        const dx=q.x-p.x, dz=q.z-p.z, d=Math.hypot(dx,dz);
        const pen = p.r+q.r-d;
        if(pen>deepest && d>1e-6){ deepest=pen; nx=dx/d; nz=dz/d; }
      }
      if(deepest<=0) continue;
      const push=deepest/2;
      a.position.x-=nx*push; a.position.z-=nz*push;
      b.position.x+=nx*push; b.position.z+=nz*push;
    }
  }
}

// ---------- 家具との物理的な干渉防止（猫がめり込まないよう位置を補正） ----------
// 壁は walkToward() 側で毎フレーム ROOM 境界にクランプ済みのためここでは扱わない
// （separate() 後にもう一度同じ境界でクランプすると、密集時に「壁際で膠着する」
//   デッドロックが起きることが確認できたため、壁の判定はここに重複させない）。
// 各家具は buildXxx() が実際に設置するワールド座標から算出した円/矩形で近似する。
// 「遊ぶ」演出中(playing)はその猫が対象の家具に乗る/入る必要があるため、その家具だけ判定から除外する。
// 遊び終えた直後(toHome)も、遊んでいた家具のすぐそばに立っていることが多く（例：タワーの
// 台座際）、そこで急に判定が復活すると強く押し出されて隣の家具との隙間にトラップされる
// ことがあるため、帰路につくまでは引き続き同じ家具だけ除外を続ける。
const FURNITURE_SHAPES = {
  tower:   { kind:'circle', cx:TOWER_CENTER.x, cz:TOWER_CENTER.z, r:TOWER_AVOID_R },
  sofa:    { kind:'box', minX:-4.65, maxX:-3.0,  minZ:-1.75, maxZ:2.15 },
  cushion: { kind:'circle', cx:-.6, cz:3.0, r:.95 },
  house:   { kind:'box', minX:-4.65, maxX:-3.15, minZ:2.85, maxZ:4.35 },
};
const CAT_AVOID_R = .55;   // 猫の胴体を近似する半径
function avoidFurniture(){
  for(const cat of cats){
    const u = cat.userData;
    if(u.jump) continue;                                     // ジャンプ演出中は座標を演出任せにする
    for(const key of Object.keys(FURNITURE_SHAPES)){
      if(!furniture[key]) continue;                          // 未購入の家具は無視
      if((u.state==='playing' || u.state==='toHome') && u.playKind===key) continue;  // 遊んでいた本猫はすり抜けOK
      const shp = FURNITURE_SHAPES[key];
      let dx, dz, minD;
      if(shp.kind==='circle'){
        dx = cat.position.x-shp.cx; dz = cat.position.z-shp.cz; minD = shp.r+CAT_AVOID_R;
      }else{
        const nx = Math.max(shp.minX, Math.min(shp.maxX, cat.position.x));
        const nz = Math.max(shp.minZ, Math.min(shp.maxZ, cat.position.z));
        dx = cat.position.x-nx; dz = cat.position.z-nz; minD = CAT_AVOID_R;
      }
      const d = Math.hypot(dx,dz);
      if(d >= minD) continue;
      if(d>1e-6){
        const push=minD-d;
        cat.position.x += dx/d*push; cat.position.z += dz/d*push;
      }else if(shp.kind==='box'){
        // 猫の中心が矩形の内部にある特殊ケース：最も近い辺の外へ押し出す
        const distL=cat.position.x-shp.minX, distR=shp.maxX-cat.position.x;
        const distB=cat.position.z-shp.minZ, distT=shp.maxZ-cat.position.z;
        const m=Math.min(distL,distR,distB,distT);
        if(m===distL) cat.position.x = shp.minX-minD;
        else if(m===distR) cat.position.x = shp.maxX+minD;
        else if(m===distB) cat.position.z = shp.minZ-minD;
        else cat.position.z = shp.maxZ+minD;
      }
    }
  }
}

// ---------- 壁との物理的な干渉防止（猫同士の衝突の弾みで壁にめり込むのを防ぐ） ----------
// toWindow/toSeat/playing/adventureはwalkToward()が同じフレーム内で既に境界クランプ
// 済み（bounded=true、またはadventureは意図的に境界外＝庭にいる）。これらの状態でも
// ここで同じ余白(WALK_MARGIN)を使って重ねてクランプすると、窓際のような手狭な目的地に
// 複数匹が殺到した際、目的地への接近(separate()前提の動き)とクランプが競合し合い、
// 着席が進まなくなるデッドロックが起きることを実機テストで確認している。
// そのため、その場に留まる状態(rest/window/sleeping/eating/toHome等)の猫が
// separate()やavoidFurniture()の押し出しでROOM境界の外へ弾き出されるのだけを補正する。
const WALL_CLAMP_SKIP_STATES = new Set(['toWindow','toSeat','playing','adventure']);
function clampToWalls(){
  for(const cat of cats){
    const u = cat.userData;
    if(u.jump) continue;                            // ジャンプ演出中は演出任せにする
    if(WALL_CLAMP_SKIP_STATES.has(u.state)) continue;
    cat.position.x = Math.max(ROOM.minX+WALK_MARGIN, Math.min(ROOM.maxX-WALK_MARGIN, cat.position.x));
    cat.position.z = Math.max(ROOM.minZ+WALK_MARGIN, Math.min(ROOM.maxZ-WALK_MARGIN, cat.position.z));
  }
}

// ---------- UI ----------
function showMsg(t){ if(HOOKS.showMsg) HOOKS.showMsg(t); }
function refreshHUD(){
  if(HOOKS.onHud) HOOKS.onHud({count: cats.length});
}
function resetCatsOnly(){                   // 確認ダイアログはページ側の責務
  seenIds.clear();
  for(const c of cats){
    scene.remove(c);
    c.traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); });
  }
  cats.length=0; seatCounter=0;
  refreshHUD(); showMsg('ねこをリセットしました');
}
function resetFurnitureOnly(){              // 確認ダイアログはページ側の責務。コインは返却されない
  for(const key of Object.keys(furniture)){
    const g = furniture[key];
    if(!g) continue;
    room.remove(g);
    g.traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); });
    furniture[key] = null;
  }
  showMsg('家具をリセットしました');
}

let audioCtx=null;
function chime(){
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    [880,1175,1568].forEach((f,i)=>{
      const o=audioCtx.createOscillator(), gn=audioCtx.createGain();
      o.type='triangle'; o.frequency.value=f;
      gn.gain.setValueAtTime(.1,audioCtx.currentTime+i*.09);
      gn.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+i*.09+.25);
      o.connect(gn); gn.connect(audioCtx.destination);
      o.start(audioCtx.currentTime+i*.09); o.stop(audioCtx.currentTime+i*.09+.3);
    });
  }catch(e){}
}

// ---------- お買い物（家具ショップ） ----------
// 価格の確認・コインの減算はサーバ側(FURNITURE_PRICES)が正。
// この関数はページ側が /api/furniture の成功を確認した後に呼ぶ、見た目の設置専用。
const SHOP_ITEMS = {
  tower:  { label:'猫タワー',   build:buildCatTower },
  sofa:   { label:'ソファー',   build:buildSofa },
  cushion:{ label:'クッション', build:buildCushion },
  house:  { label:'猫小屋',     build:buildCatHouse },
};
const popIns = [];   // 設置時のぽよんアニメ用
function purchase(key, opts){
  const item = SHOP_ITEMS[key];
  if(!item || furniture[key]) return false;
  const g = item.build();
  furniture[key] = g;
  if(opts && opts.quiet){
    g.scale.setScalar(1);                    // サーバ復元時：演出なしで即設置
  }else{
    g.scale.setScalar(.01);
    popIns.push({g, t:0});
    chime();
    showMsg(`🛒 ${item.label}を設置しました！`);
  }
  return true;
}

// ---------- 転送の受信（UI・効果音の宣言より後に実行する必要がある） ----------
// 経路1: postMessage（ゲームの🏠ボタンから開かれた場合。file://でも確実）
// 経路2: localStorage ポーリング（同一オリジンで共有される環境用）
// 同じ猫が両経路から届いても id で重複排除する。
const seenIds = new Set();
function receiveEntry(e, focusSelf){
  if(!e || !e.id || seenIds.has(e.id)) return;
  seenIds.add(e.id);
  if(e.def && e.def.colors && e.def.props){
    spawnRoomCat(e.def);
    if(focusSelf){ try{ window.focus(); }catch(err){} }
  }
}
// ゲームから今この瞬間に転送されてきた1匹だけを受け取る（即時反映のショートカット）。
// 起動時の履歴復元・その後の新着確認は、ページ側がサーバAPI(/api/cats/:userId)から
// entry を取得して receiveEntry() に流し込む方式に一本化している（userIdで正しく
// 分離されるため、ブラウザ単位で貯まる旧localStorage経由の全履歴返却は行わない）。
addEventListener('message', ev=>{
  const d = ev.data;
  if(d && d.type==='neko-transfer') receiveEntry(d.entry, true);
});

// ---------- メインループ ----------
let last=performance.now();
(function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min(.05,(now-last)/1000); last=now;
  for(const c of cats) think(c,dt);
  for(let k=0;k<2;k++) separate();   // 反復して残留めり込みも同フレーム内で解消
  avoidFurniture();          // 家具にめり込んでいたら押し出す
  clampToWalls();            // 衝突の勢いで壁の外へ出ていたら押し戻す
  for(let i=popIns.length-1;i>=0;i--){        // 家具設置のぽよんアニメ
    const p = popIns[i]; p.t += dt;
    const k = Math.min(1, p.t/.45);
    p.g.scale.setScalar(Math.max(.01, k*(1+.15*Math.sin(k*Math.PI))));
    if(k>=1){ p.g.scale.setScalar(1); popIns.splice(i,1); }
  }
  updateWallVisibility();
  renderer.render(scene,camera);
})(last);

  // ---- 外部公開API ----
  return {
    receiveEntry, purchase,
    resetCats: resetCatsOnly, resetFurniture: resetFurnitureOnly,
    feedCat, playWithFurniture, startAdventure,
  };
}
