'use strict';
/* game-engine.js ― クレーンゲーム本体（Three.js）。
   UI(ヘッダー/フッター)はVue側。HOOKS経由で状態を通知する。 */
function createGameEngine(HOOKS){
HOOKS = HOOKS || {};

window.name = 'nekoGame';   // マイルームからの「ゲームへ戻る」再ターゲット用
/* ============================================================
   ねこキャッチャー 3D  ―  自由に歩き回る猫を狙うクレーンゲーム
   ============================================================ */

// ---------- 基本セットアップ ----------
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16242e);
scene.fog = new THREE.Fog(0x16242e, 26, 46);

const camera = new THREE.PerspectiveCamera(48, innerWidth/innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
function sizeRenderer(){
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

// カメラは簡易オービット（ドラッグ）
let camTheta = 0, camPhi = 0.42, camDist = 15.5;
function updateCamera(){
  const cy = 2.6;
  camera.position.set(
    Math.sin(camTheta)*Math.cos(camPhi)*camDist,
    cy + Math.sin(camPhi)*camDist,
    Math.cos(camTheta)*Math.cos(camPhi)*camDist
  );
  camera.lookAt(0, 2.4, 0);
}
updateCamera();

let dragging=false, px=0, py=0, pinchD=0;
const ZOOM_MIN=7, ZOOM_MAX=28;
function onDown(x,y,target){ if(target.closest('header')||target.closest('footer')||target.closest('button'))return; dragging=true;px=x;py=y; }
function onMove(x,y){ if(!dragging)return;
  camTheta -= (x-px)*0.005;                                    // 水平は全周自由（真横・背面もOK）
  camPhi = Math.min(1.45, Math.max(-0.12, camPhi + (y-py)*0.004));  // 床面レベルの真正面〜ほぼ真上まで
  px=x;py=y; updateCamera(); }
addEventListener('mousedown', e=>onDown(e.clientX,e.clientY,e.target));
addEventListener('mousemove', e=>onMove(e.clientX,e.clientY));
addEventListener('mouseup', ()=>dragging=false);

// PC：マウスホイールでズーム
addEventListener('wheel', e=>{
  if(e.target.closest('header')||e.target.closest('footer')||e.target.closest('button')) return;
  camDist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camDist + e.deltaY*0.012));
  updateCamera();
  e.preventDefault();
}, {passive:false});

// スマホ：1本指ドラッグで回転、2本指ピンチでズーム
addEventListener('touchstart', e=>{
  if(e.touches.length===2){
    dragging=false;
    pinchD = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                        e.touches[0].clientY-e.touches[1].clientY);
  }else{
    const t=e.touches[0]; onDown(t.clientX,t.clientY,e.target);
  }
},{passive:true});
addEventListener('touchmove', e=>{
  if(e.touches.length===2 && pinchD>0){
    const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                         e.touches[0].clientY-e.touches[1].clientY);
    camDist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camDist * pinchD/d));  // 指を広げる=寄る
    pinchD = d;
    updateCamera();
    if(e.cancelable) e.preventDefault();   // ブラウザのページズームを抑止
  }else{
    const t=e.touches[0]; onMove(t.clientX,t.clientY);
  }
},{passive:false});
addEventListener('touchend', e=>{
  if(e.touches.length<2) pinchD=0;
  if(e.touches.length===0) dragging=false;
});

// ---------- ライティング ----------
scene.add(new THREE.AmbientLight(0xfff2e0, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(7, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left=-9; sun.shadow.camera.right=9;
sun.shadow.camera.top=9; sun.shadow.camera.bottom=-9;
sun.shadow.bias = -0.0004;        // 浅い角度で出る縞状のシャドウアクネを防止
sun.shadow.normalBias = 0.02;
scene.add(sun);
const inner = new THREE.PointLight(0xffd9a0, 0.7, 20);
inner.position.set(0, 6, 0);
scene.add(inner);

// ---------- 筐体の寸法 ----------
const FIELD = {minX:-5, maxX:5, minZ:-4, maxZ:4};          // プレイフィールド（床上面 y=0）
const WALL_H = 7;
const RAIL_Y = 6.1;                                          // クレーンレール高さ
const CHUTE  = {minX:2.5, maxX:4.6, minZ:1.7, maxZ:3.8};    // 景品落とし口（手前右）
const CLAW_HOME = {x:(CHUTE.minX+CHUTE.maxX)/2, z:(CHUTE.minZ+CHUTE.maxZ)/2};
const CLAW_TOP = 5.1, CLAW_BOTTOM = 1.38;   // 指先(約1.33)が床すれすれになる高さ

// ---------- 筐体を組み立てる ----------
const machine = new THREE.Group();
scene.add(machine);

const matCab   = new THREE.MeshStandardMaterial({color:0xe3556f, roughness:.5, metalness:.15});
const matCabD  = new THREE.MeshStandardMaterial({color:0xc23a55, roughness:.55});
const matFloor = new THREE.MeshStandardMaterial({color:0x3ea55c, roughness:.95});   // 緑の単色床
const matFrame = new THREE.MeshStandardMaterial({color:0xfff3d6, roughness:.35, metalness:.4});
const matGlass = new THREE.MeshPhysicalMaterial({color:0xbfe8ff, transparent:true, opacity:.13,
                  roughness:.05, metalness:0, side:THREE.DoubleSide, depthWrite:false});

// 台座
const base = new THREE.Mesh(new THREE.BoxGeometry(11.4, 2.6, 9.4), matCab);
// 上面(y=0)が床パネル上面と同一平面でZファイティング（縞模様）を起こすため、
// 0.15下げて床の厚みの中に沈める（露出する縁は床の側面が覆う）
base.position.y = -1.45; base.castShadow = base.receiveShadow = true;
machine.add(base);
const skirt = new THREE.Mesh(new THREE.BoxGeometry(11.8, .5, 9.8), matCabD);
skirt.position.y = -2.5; machine.add(skirt);

// 床（落とし口の穴を4枚のパネルで囲って作る）
function floorPanel(x1,x2,z1,z2){
  const w=x2-x1, d=z2-z1;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,.3,d), matFloor);
  m.position.set((x1+x2)/2, -.15, (z1+z2)/2);
  m.receiveShadow = true; machine.add(m);
}
floorPanel(FIELD.minX, FIELD.maxX, FIELD.minZ, CHUTE.minZ);   // 奥側全面
floorPanel(FIELD.minX, CHUTE.minX, CHUTE.minZ, FIELD.maxZ);   // 手前左
floorPanel(CHUTE.maxX, FIELD.maxX, CHUTE.minZ, FIELD.maxZ);   // 手前右端
floorPanel(CHUTE.minX, CHUTE.maxX, CHUTE.maxZ, FIELD.maxZ);   // 穴の手前

// 落とし口：シャフトと黄黒の縁取り
const shaftMat = new THREE.MeshStandardMaterial({color:0x241a18, roughness:1});
const shaft = new THREE.Mesh(new THREE.BoxGeometry(CHUTE.maxX-CHUTE.minX, 3, CHUTE.maxZ-CHUTE.minZ), shaftMat);
shaft.position.set(CLAW_HOME.x, -1.5, CLAW_HOME.z);
machine.add(shaft);
// 景品取り出し口：台座前面の穴と、外に滑り出た猫が並ぶトレイ
const exitHole = new THREE.Mesh(new THREE.BoxGeometry(1.7,1.4,.1), shaftMat);
exitHole.position.set((2.5+4.6)/2, -1.8, 4.72);
machine.add(exitHole);
const tray = new THREE.Mesh(new THREE.BoxGeometry(6.2,.3,3.4), matCabD);
tray.position.set(2.9,-2.05,6.35); tray.receiveShadow = true; machine.add(tray);
const trayLip = new THREE.Mesh(new THREE.BoxGeometry(6.2,.4,.18), matCab);
trayLip.position.set(2.9,-1.95,7.95); machine.add(trayLip);

const rimMat = new THREE.MeshStandardMaterial({color:0xffc94d, roughness:.4, emissive:0x553a00});
function rim(w,d,x,z){ const r=new THREE.Mesh(new THREE.BoxGeometry(w,.12,d),rimMat);
  r.position.set(x,.07,z); machine.add(r); }
rim(CHUTE.maxX-CHUTE.minX+.3,.15, CLAW_HOME.x, CHUTE.minZ-.07);
rim(CHUTE.maxX-CHUTE.minX+.3,.15, CLAW_HOME.x, CHUTE.maxZ+.07);
rim(.15, CHUTE.maxZ-CHUTE.minZ+.3, CHUTE.minX-.07, CLAW_HOME.z);
rim(.15, CHUTE.maxZ-CHUTE.minZ+.3, CHUTE.maxX+.07, CLAW_HOME.z);

// 柱・天板・ガラス
for(const [sx,sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
  const p = new THREE.Mesh(new THREE.BoxGeometry(.35, WALL_H, .35), matFrame);
  p.position.set(sx*(FIELD.maxX+.35), WALL_H/2, sz*(FIELD.maxZ+.35));
  p.castShadow = false;   // 支柱の影は床に落とさない
  machine.add(p);
}
const roof = new THREE.Mesh(new THREE.BoxGeometry(11.4, .55, 9.4), matCab);
roof.position.y = WALL_H+.27; roof.castShadow = false; machine.add(roof);   // 天板の影は落とさない
const marquee = new THREE.Mesh(new THREE.BoxGeometry(11.4, 1.1, 1.2), matCabD);
marquee.position.set(0, WALL_H+1.05, FIELD.maxZ-0.1); machine.add(marquee);

function glass(w,h,x,z,ry){
  const g = new THREE.Mesh(new THREE.PlaneGeometry(w,h), matGlass);
  g.position.set(x, h/2, z); g.rotation.y = ry; machine.add(g);
}
glass(10, WALL_H, 0, FIELD.maxZ+.35, 0);
glass(10, WALL_H, 0, FIELD.minZ-.35, Math.PI);
glass(8,  WALL_H, FIELD.minX-.35, 0,  Math.PI/2);
glass(8,  WALL_H, FIELD.maxX+.35, 0, -Math.PI/2);

// ---------- クレーン（ガントリー + 3本爪） ----------
const crane = new THREE.Group(); scene.add(crane);
const matSteel = new THREE.MeshStandardMaterial({color:0xd8dde2, roughness:.35, metalness:.7});
const matClaw  = new THREE.MeshStandardMaterial({color:0xff5f7e, roughness:.3, metalness:.55});

// 左右の固定レール（z方向）
for(const sx of [-1,1]){
  const r = new THREE.Mesh(new THREE.BoxGeometry(.28,.28, FIELD.maxZ*2+1), matSteel);
  r.position.set(sx*(FIELD.maxX-.1), RAIL_Y+.35, 0); crane.add(r);
}
// 可動ビーム（x方向・zに移動）
const beam = new THREE.Mesh(new THREE.BoxGeometry(FIELD.maxX*2+.6,.26,.4), matSteel);
beam.castShadow = true; crane.add(beam);
// トロリー
const trolley = new THREE.Mesh(new THREE.BoxGeometry(.9,.5,.75), matClaw);
trolley.castShadow = true; crane.add(trolley);
// ケーブル
const cableGeo = new THREE.CylinderGeometry(.035,.035,1,8);
cableGeo.translate(0,-.5,0);
const cable = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({color:0x333}));
crane.add(cable);

// 爪本体
const claw = new THREE.Group(); scene.add(claw);
const hub = new THREE.Mesh(new THREE.CylinderGeometry(.3,.38,.34,20), matClaw);
hub.castShadow = true; claw.add(hub);
const dome = new THREE.Mesh(new THREE.SphereGeometry(.3,16,12,0,Math.PI*2,0,Math.PI/2), matClaw);
dome.position.y=.17; claw.add(dome);

const arms = [];
for(let i=0;i<3;i++){
  const pivot = new THREE.Group();
  pivot.rotation.y = i*Math.PI*2/3;
  pivot.position.y = -.1;
  const hinge = new THREE.Group();
  hinge.position.x = .3;
  // 上腕
  const upGeo = new THREE.BoxGeometry(.09,.85,.16);
  upGeo.translate(0,-.42,0);
  const upSeg = new THREE.Mesh(upGeo, matSteel); upSeg.castShadow=true;
  hinge.add(upSeg);
  // 先端の鉤
  const tipGeo = new THREE.BoxGeometry(.09,.5,.14);
  tipGeo.translate(0,-.25,0);
  const tip = new THREE.Mesh(tipGeo, matSteel);
  tip.position.y = -.85; tip.rotation.z = -.85; tip.castShadow=true;   // 鉤は中心側へカール
  hinge.add(tip);
  pivot.add(hinge);
  claw.add(pivot);
  arms.push(hinge);
}
const OPEN_ANGLE = 0.85, CLOSED_ANGLE = 0.18;   // 正の角度で外側へ開く
// 指（アーム）は1本ずつ独立した角度を持ち、猫に触れたところで止まる
const armAngles  = [OPEN_ANGLE, OPEN_ANGLE, OPEN_ANGLE];
const armStopped = [false, false, false];   // 接触 or 全閉で固定されたか
function applyClawPose(){ arms.forEach((a,k)=>a.rotation.z = armAngles[k]); }
function driveArms(target, rate, dt){
  for(let k=0;k<3;k++) armAngles[k] += (target-armAngles[k])*Math.min(1, rate*dt);
}
applyClawPose();

// 指の形状サンプル点（hingeローカル座標）：上腕中央→関節→鉤中央→鉤先端
const ARM_SAMPLES = [
  new THREE.Vector3(0, -.45, 0),
  new THREE.Vector3(0, -.85, 0),
  new THREE.Vector3(-.1877, -1.0150, 0),   // (0,-.85)+Rz(-.85)·(0,-.25)
  new THREE.Vector3(-.3755, -1.1800, 0),   // (0,-.85)+Rz(-.85)·(0,-.50)
];
const _tmpV = new THREE.Vector3();

// 点が猫の近似形状（体=楕円体、頭=球）の内側か
function pointInsideCat(px, py, pz, cat, pad=.025){
  const u = cat.userData, sc = u.scale, gs = u.gripShape;
  const fx = Math.cos(cat.rotation.y), fz = -Math.sin(cat.rotation.y);
  const bx = cat.position.x, by = cat.position.y + gs.bodyY*sc, bz = cat.position.z;
  const rh = gs.bodyRh*sc + pad, rv = gs.bodyRv*sc + pad;
  const dx=(px-bx)/rh, dy=(py-by)/rv, dz=(pz-bz)/rh;               // 体の楕円体
  if(dx*dx + dy*dy + dz*dz < 1) return true;
  const hx = bx + fx*gs.headX*sc, hy = cat.position.y + gs.headY*sc, hz = bz + fz*gs.headX*sc;
  const rHead = gs.headR*sc + pad;                                  // 頭の球
  const ex=px-hx, ey=py-hy, ez=pz-hz;
  return ex*ex + ey*ey + ez*ez < rHead*rHead;
}

// 指を angle まで曲げたとき猫に食い込むか
function armIntersectsCat(hinge, angle, cat){
  const prev = hinge.rotation.z;
  hinge.rotation.z = angle;
  claw.updateMatrixWorld(true);
  let hit = false;
  for(const sp of ARM_SAMPLES){
    const p = hinge.localToWorld(_tmpV.copy(sp));
    if(pointInsideCat(p.x, p.y, p.z, cat)){ hit = true; break; }
  }
  hinge.rotation.z = prev;
  return hit;
}

// クレーン全体（ハブ底＋現在角度の全指）が高さ y で猫に触れるか（降下時チェック用）
function clawTouchesCat(y, cat){
  const s = craneState;
  claw.position.set(s.x, y, s.z);
  if(pointInsideCat(s.x, y-.28, s.z, cat)) return true;            // ハブ底
  for(let k=0;k<3;k++)
    if(armIntersectsCat(arms[k], armAngles[k], cat)) return true;  // 全開の指
  return false;
}
function nearestFreeCat(x, z){
  let best=null, bd=1e9;
  for(const c of cats){
    if(!['idle','walk','loaf'].includes(c.userData.state)) continue;
    const d = Math.hypot(c.position.x-x, c.position.z-z);
    if(d<bd){ bd=d; best=c; }
  }
  return best;
}

// クレーン論理位置
const craneState = {
  x: CLAW_HOME.x, z: CLAW_HOME.z, y: CLAW_TOP,
  phase: 'IDLE',       // IDLE / DESCEND / GRAB / ASCEND / MOVE / RELEASE / RESET
  timer: 0,
  heldCat: null, grip: 0,
  targetCat: null, heldOffY: -.62,
};
function syncCraneMeshes(){
  beam.position.set(0, RAIL_Y, craneState.z);
  trolley.position.set(craneState.x, RAIL_Y-.05, craneState.z);
  const len = (RAIL_Y-.3) - (craneState.y+.28);
  cable.position.set(craneState.x, RAIL_Y-.3, craneState.z);
  cable.scale.y = Math.max(.05, len);
  claw.position.set(craneState.x, craneState.y, craneState.z);
}
syncCraneMeshes();

// ---------- 猫の定義とパラメトリックビルダー ----------
// 「3Dねこメーカー」(cat_model_maker.html) と共通のフォーマット 'neko-crane-cat'。
// デフォルトは cat_white.png から実測サンプリングした子猫。
const cats = [];


const catDefs = [...BASE_DEFS];   // 読み込んだ猫はここに加わり、Bキーの再生成にも登場する


function makeCat(def, sizeJitter){
  const m = buildCatModel(def);
  const g = m.group;
  const scale = (def.props.scale || 1) * sizeJitter;
  g.scale.setScalar(scale);
  g.userData = {
    legs:m.legs, head:m.head, tailRoot:m.tailRoot, tailSegs:m.tailSegs,
    eyes:m.eyes, tongue:m.tongue, eyeScale:(def.props.eyeSize||1), lickT:-1,
    state:'idle', timer: Math.random()*2,
    target: new THREE.Vector3(),
    dir: Math.random()*Math.PI*2,
    speed: .9 + Math.random()*.6,
    phase: Math.random()*10,
    vy: 0, scale,
    // 干渉チェック用の近似形状（体=楕円体・頭=球、ローカル単位）
    gripShape: (()=>{ const lift = .42*((def.props.legLen||1)-1);
      return { bodyY:.46+lift, bodyRh:.62*(def.props.bodyLen||1), bodyRv:.46,
               headX:.66*(def.props.bodyLen||1), headY:.95+lift,
               headR:.42*(def.props.headSize||1) }; })(),
    loaf: 0,                                   // 香箱座りポーズのブレンド係数 0=立ち 1=寝そべり
    loafDrop: Math.max(.04, .05 + .42*((def.props.legLen||1)-1) + .06),  // 寝そべり時に体を下げる量
    name: def.name || 'ねこ',
    points: Number.isFinite(+def.points) ? +def.points : 10,
    def,                                   // マイルーム転送用に定義を保持
  };
  if(def.rainbow){
    g.userData.rainbowMeshes = applyRainbowStripes(g, scale);   // 7色縞々（共通実装）
  }
  return g;
}

function randomFloorSpot(){
  for(let i=0;i<40;i++){
    const x = FIELD.minX+.9 + Math.random()*(FIELD.maxX-FIELD.minX-1.8);
    const z = FIELD.minZ+.9 + Math.random()*(FIELD.maxZ-FIELD.minZ-1.8);
    if(!(x>CHUTE.minX-.8 && x<CHUTE.maxX+.8 && z>CHUTE.minZ-.8 && z<CHUTE.maxZ+.8))
      return new THREE.Vector3(x,0,z);
  }
  return new THREE.Vector3(0,0,-2);
}

function spawnCat(forceDef){
  const def = forceDef || catDefs[Math.floor(Math.random()*catDefs.length)];
  const c = makeCat(def, .85 + Math.random()*.3);   // サイズだけ個体差
  // 既存の猫と重ならない場所を探す
  let p = randomFloorSpot();
  for(let i=0;i<30;i++){
    const ok = cats.every(o =>
      Math.hypot(o.position.x-p.x, o.position.z-p.z) > catRadius(o)+catRadius(c)+.2);
    if(ok) break;
    p = randomFloorSpot();
  }
  c.position.copy(p);
  c.rotation.y = Math.random()*Math.PI*2;
  scene.add(c); cats.push(c);
  return c;
}
// ---------- ステージ制スポーン ----------
// ステージ1は白ねこ1匹のみ、ステージ2以降は「2匹ずつ」のペースを維持したまま
// BASE_DEFS(5色)を順送りに使って延々と繰り返す。
// 例: S1=[白] S2=[茶,黒] S3=[ピンク,レインボー] S4=[白,茶] S5=[黒,ピンク] ...
let gameStage = 1, stageCaught = 0, stageTotal = 1, stageCursor = 0;
function stageCatCount(n){ return n===1 ? 1 : 2; }
function stageDefs(n){
  const count = stageCatCount(n);
  const defs = [];
  for(let i=0;i<count;i++) defs.push(BASE_DEFS[stageCursor++ % BASE_DEFS.length]);
  return defs;
}
function spawnStage(n){
  // 前ステージの残り（演出中の猫など）を掃除してから、新ステージの猫を並べる
  for(let i=cats.length-1;i>=0;i--){
    const st = cats[i].userData.state;
    if(['idle','walk','loaf'].includes(st)){
      scene.remove(cats[i]);
      cats[i].traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); });
      cats.splice(i,1);
    }
  }
  stageTotal = stageCatCount(n);
  stageCaught = 0;
  for(const d of stageDefs(n)) spawnCat(d);
}
spawnStage(gameStage);

// ---------- 猫同士の重なり防止（体＋頭の2円で分離） ----------
// 頭は中心から前方(+x)に突き出しているので、中心1円だけだと
// 正面から近づいた2匹の頭がすり抜ける。体と頭の2つの円で判定する。
function catCircles(cat){
  const s = cat.userData.scale;
  const fx = Math.cos(cat.rotation.y), fz = -Math.sin(cat.rotation.y); // 前方向
  return [
    { // 体（中心やや後ろ寄り）
      x: cat.position.x - fx*.1*s,
      z: cat.position.z - fz*.1*s,
      r: .58*s },
    { // 頭（前方に突き出し・頬とヒゲの余白込み）
      x: cat.position.x + fx*.72*s,
      z: cat.position.z + fz*.72*s,
      r: .48*s },
  ];
}
function isOnFloor(cat){
  const st = cat.userData.state;
  return st==='idle' || st==='walk' || st==='loaf';
}
function separateCats(){
  for(let i=0;i<cats.length;i++){
    const a = cats[i];
    if(!isOnFloor(a)) continue;
    for(let j=i+1;j<cats.length;j++){
      const b = cats[j];
      if(!isOnFloor(b)) continue;
      // 2円×2円の全ペアで最も深いめり込みを探す
      const ca = catCircles(a), cb = catCircles(b);
      let deepest = 0, nx = 0, nz = 0;
      for(const p of ca) for(const q of cb){
        const dx = q.x - p.x, dz = q.z - p.z;
        const d = Math.hypot(dx,dz);
        const pen = p.r + q.r - d;
        if(pen > deepest && d > 1e-6){
          deepest = pen; nx = dx/d; nz = dz/d;
        }
      }
      if(deepest <= 0) continue;
      // めり込んだ分を半分ずつ押し戻す（ルート位置を移動）
      const push = deepest/2;
      a.position.x -= nx*push; a.position.z -= nz*push;
      b.position.x += nx*push; b.position.z += nz*push;
      // 押し合ったら少し嫌がって別の場所へ
      if(a.userData.state==='walk' && Math.random()<.03) a.userData.target.copy(randomFloorSpot());
      if(b.userData.state==='walk' && Math.random()<.03) b.userData.target.copy(randomFloorSpot());
      keepInBounds(a); keepInBounds(b);
    }
  }
}
// スポーン間隔などに使う最大到達半径（頭の先端まで）
function catRadius(cat){ return 1.2 * cat.userData.scale; }
function keepInBounds(cat){
  cat.position.x = Math.max(FIELD.minX+.6, Math.min(FIELD.maxX-.6, cat.position.x));
  cat.position.z = Math.max(FIELD.minZ+.6, Math.min(FIELD.maxZ-.6, cat.position.z));
  if(cat.position.x>CHUTE.minX-.6 && cat.position.x<CHUTE.maxX+.6 &&
     cat.position.z>CHUTE.minZ-.6 && cat.position.z<CHUTE.maxZ+.6){
    const away = new THREE.Vector3(cat.position.x-CLAW_HOME.x, 0, cat.position.z-CLAW_HOME.z);
    if(away.lengthSq()===0) away.set(-1,0,-1);
    away.normalize();
    cat.position.addScaledVector(away, .12);
  }
}

// ---------- 猫のAI・アニメーション ----------
function catThink(cat, dt){
  const u = cat.userData;
  // デバッグ停止中：床にいる猫（idle/walk/loaf）だけ完全静止させる。
  // held（掴まれ中）はクレーンが動かし、falling/won は落下・演出を続行してゲームを止めない
  if(catsFrozen && (u.state==='idle' || u.state==='walk' || u.state==='loaf')) return;
  u.phase += dt * (u.state==='walk' ? u.speed*7 : 2);

  if(u.rainbowMeshes) tickRainbowStripes(u.rainbowMeshes);

  // しっぽは常にゆらゆら（寝そべり中はゆっくり）
  const sway = Math.sin(u.phase*.9)*.28*(1-.6*u.loaf);
  u.tailRoot.rotation.y = sway;
  u.tailSegs.forEach((s,i)=>{ s.rotation.y = Math.sin(u.phase*.9 - i*.7)*.3*(1-.6*u.loaf); });

  // --- 香箱座りポーズのブレンド（全状態共通で適用） ---
  // 脚を体の中にしまい、体を床まで下げ、頭を少し下げて呼吸で上下する
  const loafTarget = (u.state==='loaf') ? 1 : 0;
  u.loaf += (loafTarget - u.loaf) * Math.min(1, dt*3.5);
  if(u.loaf > .003){
    for(const l of u.legs) l.scale.y = 1 - .82*u.loaf;      // 脚を収納
    u.tailRoot.rotation.z = .85 - .55*u.loaf;               // しっぽを体に沿わせる
    u.head.rotation.z = -.2*u.loaf;                          // 頭を少し下げる
    for(const ey of u.eyes) ey.scale.y = u.eyeScale * (1 - .94*u.loaf);  // 目を閉じる
    cat.scale.y = u.scale * (1 + .03*u.loaf*Math.sin(u.phase*.7));  // 呼吸
    if(u.state==='loaf' || u.state==='idle' || u.state==='walk')
      cat.position.y = -u.loafDrop * u.scale * u.loaf;       // 体を床へ
  }else if(u.legs[0].scale.y !== 1){
    for(const l of u.legs) l.scale.y = 1;                    // 完全に立ち姿勢へ復帰
    u.tailRoot.rotation.z = .85;
    u.head.rotation.z = 0;
    for(const ey of u.eyes) ey.scale.y = u.eyeScale;         // 目を開ける
    cat.scale.y = u.scale;
  }

  // --- 舌なめずり：立ち止まり/寝そべり中に時々、舌を出して口の周りを舐める ---
  if(u.lickT >= 0){
    if(u.state!=='idle' && u.state!=='loaf'){
      u.lickT = -1; u.tongue.visible = false;               // 掴まれたら中断
    }else{
      u.lickT += dt;
      const dur = 1.15;
      if(u.lickT >= dur){
        u.lickT = -1; u.tongue.visible = false;
      }else{
        u.tongue.visible = true;
        const env = Math.sin(Math.PI * u.lickT/dur);        // 出し入れのエンベロープ
        u.tongue.scale.set(1.1*env+.001, .55*env+.001, .9*env+.001);
        u.tongue.position.set(.40,
          -.18 + .025*Math.sin(u.lickT*9),                  // 上下に舐め上げ
          .05*Math.sin(u.lickT*15));                        // 左右に往復
      }
    }
  }else if((u.state==='idle' || u.state==='loaf') && Math.random() < dt*.12){
    u.lickT = 0;                                             // 平均8秒に1回くらい開始
  }

  // --- 取り出し口から滑り出る（ゲット後の退場演出） ---
  if(u.state==='exit'){
    const target = u.exitPath[u.exitIdx];
    const to = new THREE.Vector3().subVectors(target, cat.position);
    const d = to.length(), step = 3.4*dt;
    if(d <= step){
      cat.position.copy(target);
      if(++u.exitIdx >= u.exitPath.length){
        u.state = 'won';                                     // トレイでおすわり（正面向き）
        cat.rotation.y = -Math.PI/2 + (Math.random()-.5)*.5;
      }
    }else{
      cat.position.addScaledVector(to.normalize(), step);
      cat.rotation.y = Math.atan2(to.x, to.z) - Math.PI/2;   // 進行方向を向く
    }
    return;
  }

  if(u.state==='won'){
    // テラス（トレイ）で1秒待機してからマイルームへトランスポーテーション
    u.wonT = (u.wonT||0) + dt;
    if(u.wonT >= 1){ u.state='teleport'; u.tpT = 0; }
    return;
  }
  if(u.state==='teleport'){
    u.tpT += dt;
    const k = Math.min(1, u.tpT/.6);
    cat.rotation.y += dt*10;                       // くるくる回りながら
    cat.scale.setScalar(Math.max(.001, u.scale*(1-k)));  // 縮んで消える
    cat.position.y += dt*1.5;
    if(k >= 1){
      sendToRoom(cat);
      u.state = 'gone';                            // メインループで回収される
      showMsg(`🌀 ${u.name}をマイルームへ転送！`, '#9fd7ff');
      switchToRoom();                              // マイルームへ自動切り替え
    }
    return;
  }
  if(u.state==='held') return;

  if(u.state==='falling'){
    u.vy -= 22*dt;
    cat.position.y += u.vy*dt;
    cat.rotation.z = Math.sin(u.phase*2)*.15;
    const inChute = cat.position.x>CHUTE.minX && cat.position.x<CHUTE.maxX &&
                    cat.position.z>CHUTE.minZ && cat.position.z<CHUTE.maxZ;
    if(inChute){
      if(cat.position.y < -2.4) winCat(cat);
    }else if(cat.position.y <= 0){
      cat.position.y = 0; cat.rotation.z = 0;
      u.vy = 0; u.state = 'idle'; u.timer = .6 + Math.random();
      showMsg('にげられた…', '#9fd7ff');
      meow(.6);
    }
    return;
  }

  if(u.state==='loaf'){
    // 寝そべり中：まどろみながら周りをうっすら見る。動かないので絶好の狙い目
    u.head.rotation.y = Math.sin(u.phase*.3)*.15;
    u.timer -= dt;
    if(u.timer<=0){ u.state='idle'; u.timer = .7; }   // まず立ち上がってから次の行動へ
    return;
  }

  if(u.state==='idle'){
    // 立ち止まって耳と頭を動かす
    u.head.rotation.y = Math.sin(u.phase*.5)*.35;
    u.legs.forEach(l=>l.rotation.z *= .85);
    u.timer -= dt;
    if(u.timer<=0){
      if(Math.random() < .35){
        // ときどき香箱座りでひとやすみ
        u.state='loaf';
        u.timer = 3 + Math.random()*3.5;
      }else{
        u.state='walk';
        u.target.copy(randomFloorSpot());
      }
    }
    return;
  }

  // walk：目標へ向かって歩く
  const to = new THREE.Vector3().subVectors(u.target, cat.position); to.y=0;
  const dist = to.length();
  if(dist < .25){
    u.state='idle'; u.timer = 1 + Math.random()*2.5;
    return;
  }
  const desired = Math.atan2(to.x, to.z) - Math.PI/2;   // 猫はローカル+xが前
  let dr = desired - cat.rotation.y;
  while(dr> Math.PI) dr-=Math.PI*2;
  while(dr<-Math.PI) dr+=Math.PI*2;
  cat.rotation.y += dr * Math.min(1, dt*4);
  const step = u.speed * dt;
  cat.position.x += Math.cos(cat.rotation.y)*step;
  cat.position.z -= Math.sin(cat.rotation.y)*step;

  // 落とし口と壁から押し返す
  cat.position.x = Math.max(FIELD.minX+.6, Math.min(FIELD.maxX-.6, cat.position.x));
  cat.position.z = Math.max(FIELD.minZ+.6, Math.min(FIELD.maxZ-.6, cat.position.z));
  if(cat.position.x>CHUTE.minX-.6 && cat.position.x<CHUTE.maxX+.6 &&
     cat.position.z>CHUTE.minZ-.6 && cat.position.z<CHUTE.maxZ+.6){
    const cx = CLAW_HOME.x, cz = CLAW_HOME.z;
    const away = new THREE.Vector3(cat.position.x-cx, 0, cat.position.z-cz).normalize();
    cat.position.addScaledVector(away, dt*2.2);
    u.target.copy(randomFloorSpot());
  }

  // 歩行アニメ：脚を胴体の長軸（前後）方向に交互スイング＋上下バウンド
  // 脚シリンダーは-y方向に伸びているので、ローカルz軸回転で前後（+x=進行方向）に振れる
  const a = Math.sin(u.phase)*.55;
  u.legs[0].rotation.z =  a; u.legs[3].rotation.z =  a;
  u.legs[1].rotation.z = -a; u.legs[2].rotation.z = -a;
  cat.position.y = Math.abs(Math.sin(u.phase))*.035;
  u.head.rotation.y *= .9;
}

// ---------- 効果音（WebAudio・軽量） ----------
let audioCtx = null;
function beep(freq, dur, type='square', vol=.12){
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    gn.gain.setValueAtTime(vol, audioCtx.currentTime);
    gn.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime+dur);
    o.connect(gn); gn.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime+dur);
  }catch(e){}
}
function meow(pitch=1){ beep(620*pitch,.12,'sawtooth',.08); setTimeout(()=>beep(480*pitch,.16,'sawtooth',.07),100); }
function fanfare(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,.18,'triangle',.14), i*130)); }

// ---------- UI ----------
let coins = (HOOKS.initial && HOOKS.initial.coins != null) ? HOOKS.initial.coins : 5;
let score = (HOOKS.initial && HOOKS.initial.score) || 0;
let points = (HOOKS.initial && HOOKS.initial.points) || 0;
function showMsg(text, color='#ffc94d', dur=1700){
  if(HOOKS.showMsg) HOOKS.showMsg(text, color, dur);
}
function refreshHUD(){
  if(HOOKS.onHud) HOOKS.onHud({
    coins, score, points, stage: gameStage,
    canDrop: craneState.phase==='IDLE' && coins>0,
  });
}
refreshHUD();

document.getElementById('coinBtn').addEventListener('click', ()=>{
  coins++; beep(880,.08,'square',.1); beep(1320,.1,'square',.08);
  showMsg('コイン投入！'); refreshHUD();
});

// 移動入力（キー＋ボタン長押し）
const input = {up:false,down:false,left:false,right:false};
// 「A」は猫の動きを止める隠しデバッグキーのため、WASD移動は割り当てない（矢印キー＋ボタンで移動）
const keymap = {ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right'};
let catsFrozen = false;   // デバッグ：猫の時間停止フラグ
addEventListener('keydown', e=>{
  if(keymap[e.key]!==undefined){ input[keymap[e.key]]=true; e.preventDefault(); }
  if(e.key===' '){ tryDrop(); e.preventDefault(); }
  // 隠しキー「A」：猫の動きを一時停止/再開（クレーン操作とゲーム進行はそのまま）
  if(!e.repeat && (e.key==='a' || e.key==='A')){
    catsFrozen = !catsFrozen;
    showMsg(catsFrozen ? '⏸ 猫ストップ（デバッグ）' : '▶ 猫リスタート', '#9fd7ff');
    beep(catsFrozen ? 440 : 660, .1, 'square', .08);
  }
  // 隠しキー「B」：フィールドの猫の数を入力して作り直し
  if(!e.repeat && (e.key==='b' || e.key==='B')){
    const cur = cats.filter(c=>['idle','walk','loaf'].includes(c.userData.state)).length;
    const v = prompt('フィールドの猫の数を入力してください（1〜20）', cur || 5);
    if(v !== null){
      const n = parseInt(v, 10);
      if(Number.isFinite(n) && n>=1 && n<=20) resetCats(n);
      else showMsg('1〜20の数を入力してください', '#ff9f9f');
    }
  }
});
addEventListener('keyup', e=>{ if(keymap[e.key]!==undefined) input[keymap[e.key]]=false; });
for(const id of ['up','down','left','right']){
  const b = document.getElementById(id);
  const on = e=>{ e.preventDefault(); input[id]=true; b.classList.add('on'); };
  const off= e=>{ input[id]=false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('contextmenu', e=>e.preventDefault());
}
document.getElementById('drop').addEventListener('click', tryDrop);

function tryDrop(){
  if(craneState.phase!=='IDLE') return;
  if(coins<=0){ showMsg('コインがないよ！', '#ff9f9f'); beep(180,.25,'sawtooth',.1); return; }
  coins--;
  craneState.phase='DESCEND';
  beep(520,.1); refreshHUD();
}

// ---------- クレーンの状態遷移 ----------
function beginGrab(target){
  const s = craneState;
  s.phase = 'GRAB';
  s.timer = .9;
  armStopped.fill(false);
  s.targetCat = target;   // 干渉チェック・キャッチ判定の対象（nullなら空振り確定）
}
function updateCrane(dt){
  const s = craneState;
  const moveSpd = 3.4;

  if(s.phase==='IDLE'){
    if(input.left)  s.x -= moveSpd*dt;
    if(input.right) s.x += moveSpd*dt;
    if(input.up)    s.z -= moveSpd*dt;
    if(input.down)  s.z += moveSpd*dt;
    s.x = Math.max(FIELD.minX+.9, Math.min(FIELD.maxX-.9, s.x));
    s.z = Math.max(FIELD.minZ+.9, Math.min(FIELD.maxZ-.9, s.z));
    driveArms(OPEN_ANGLE, 6, dt);
  }
  else if(s.phase==='DESCEND'){
    driveArms(OPEN_ANGLE, 8, dt);
    const target = nearestFreeCat(s.x, s.z);
    const nextY = Math.max(CLAW_BOTTOM, s.y - 3.6*dt);
    if(target && clawTouchesCat(nextY, target)){
      // 猫に触れる直前の高さを二分探索して停止（指を上から突き刺さない）
      let safe = s.y, hitY = nextY;
      for(let i=0;i<8;i++){
        const m = (safe+hitY)/2;
        if(clawTouchesCat(m, target)) hitY = m; else safe = m;
      }
      s.y = safe;
      beginGrab(target);
    }else{
      s.y = nextY;
      if(s.y <= CLAW_BOTTOM + 1e-4) beginGrab(target);
    }
  }
  else if(s.phase==='GRAB'){
    s.timer -= dt;
    // 指を1本ずつ閉じる。猫に触れる指は表面で止め、届かない指は全閉まで曲がる
    const closeStep = 2.4*dt;                    // 閉じ角速度 [rad/s]
    let contacts = 0;
    for(let k=0;k<3;k++){
      if(armStopped[k]){
        if(s.targetCat && armIntersectsCat(arms[k], armAngles[k]-.02, s.targetCat)) contacts++;
        continue;
      }
      const cur = armAngles[k];
      let next = Math.max(CLOSED_ANGLE, cur - closeStep);   // 角度を減らして閉じる
      if(s.targetCat && armIntersectsCat(arms[k], next, s.targetCat)){
        // 二分探索で「触れる直前」の角度を求めて固定 → 表面をつかむ
        let safe = cur, hitA = next;
        for(let it=0; it<8; it++){
          const mid = (safe+hitA)/2;
          if(armIntersectsCat(arms[k], mid, s.targetCat)) hitA = mid; else safe = mid;
        }
        next = Math.max(CLOSED_ANGLE, safe - .05);   // 毛にわずかに沈めて密着させる
        armStopped[k] = true;
        contacts++;
      }else if(next <= CLOSED_ANGLE + 1e-4){
        armStopped[k] = true;                    // 空振り：全閉
      }
      armAngles[k] = next;
    }
    const allDone = armStopped.every(v=>v);
    if(s.timer<=0 || allDone){
      const best = s.targetCat;
      const bd = best ? Math.hypot(best.position.x-s.x, best.position.z-s.z) : 1e9;
      const loafing = best && best.userData.loaf > .5;      // 香箱座り中か
      const reach = loafing ? 1.4 : 1.15;                   // 寝そべりは体が低く安定して掴みやすい
      if(best && bd < reach){
        s.heldCat = best;
        best.userData.state='held';
        // 掴んだ瞬間の相対高さを保持（指が表面に触れた位置関係のまま持ち上げる）
        s.heldOffY = Math.max(-2.2, Math.min(-1.2, best.position.y - s.y));
        // 実際に触れている指の本数で握力を補正（3本ホールドが最強）
        const fingerBonus = .85 + .05*contacts;
        if(loafing){
          // 絶好のタイミング：ほぼ確実にホールドできる強い握り
          s.grip = Math.min(1, Math.max(.82, 1 - bd/reach) * (.92 + Math.random()*.08) * fingerBonus);
          showMsg('💤 おねむの子をキャッチ！');
        }else{
          // 中心からのズレと運で握力が決まる
          s.grip = Math.min(1, Math.max(.15, (1 - bd/reach)) * (.55 + Math.random()*.45) * fingerBonus);
          showMsg('キャッチ！');
        }
        meow(1.15);
      }else{
        showMsg('スカ…', '#bcd');
        beep(220,.2,'sawtooth',.08);
      }
      s.targetCat = null;
      s.phase='ASCEND';
    }
  }
  else if(s.phase==='ASCEND'){
    s.y += 2.6*dt;
    // 上昇しながら猫を握りの定位置（指が体を包む高さ）へ滑らかに収める
    if(s.heldCat) s.heldOffY += (-1.3 - s.heldOffY)*Math.min(1, dt*2.5);
    maybeSlip(dt);
    if(s.y >= CLAW_TOP){ s.y=CLAW_TOP; s.phase = s.heldCat?'MOVE':'RESET'; }
  }
  else if(s.phase==='MOVE'){
    const dx = CLAW_HOME.x - s.x, dz = CLAW_HOME.z - s.z;
    const d = Math.hypot(dx,dz);
    if(d < .08){ s.phase='RELEASE'; s.timer=.4; }
    else{
      const v = Math.min(2.8*dt, d);
      s.x += dx/d*v; s.z += dz/d*v;
      maybeSlip(dt);
    }
  }
  else if(s.phase==='RELEASE'){
    s.timer -= dt;
    driveArms(OPEN_ANGLE, 7, dt);
    if(s.timer<=0){ dropHeld(); s.phase='RESET'; }
  }
  else if(s.phase==='RESET'){
    driveArms(OPEN_ANGLE, 6, dt);
    const dx = CLAW_HOME.x - s.x, dz = CLAW_HOME.z - s.z;
    const d = Math.hypot(dx,dz);
    if(d>.05){ const v=Math.min(3*dt,d); s.x+=dx/d*v; s.z+=dz/d*v; }
    s.y += (CLAW_TOP - s.y)*dt*4;
    if(d<=.05 && Math.abs(s.y-CLAW_TOP)<.05){ s.phase='IDLE'; refreshHUD(); }
  }

  // 掴んでいる猫を爪に追従させる
  if(s.heldCat){
    const c = s.heldCat;
    c.position.set(s.x, s.y + s.heldOffY, s.z);
    c.rotation.z = Math.sin(performance.now()*.004)*.12;   // じたばた
    c.rotation.x = Math.sin(performance.now()*.006)*.08;
  }
  applyClawPose();
  syncCraneMeshes();
}

function maybeSlip(dt){
  const s = craneState;
  if(!s.heldCat) return;
  const slipChance = (1 - s.grip) * 0.34 * dt;
  if(Math.random() < slipChance) dropHeld(true);
}
function dropHeld(slipped=false){
  const s = craneState;
  if(!s.heldCat) return;
  const c = s.heldCat;
  c.userData.state='falling';
  c.userData.vy = 0;
  c.rotation.x = 0;
  s.heldCat = null;
  if(slipped) beep(300,.15,'sawtooth',.09);
}

// ---------- マイルームのウィンドウ管理と自動切り替え ----------
// 「🏠 マイルーム」ボタンからゲームが開いたウィンドウは focus() で
// 切り替えられる（無関係なタブへの自動フォーカスはブラウザが禁止している）。
const AUTO_SWITCH_TO_ROOM = true;   // 転送完了時にマイルームへ自動切り替え
let roomWin = null;
let roomHintShown = false;
function openRoom(){
  if(!roomWin || roomWin.closed){
    roomWin = window.open('room.html', 'nekoRoom');
  }
  if(roomWin){ try{ roomWin.focus(); }catch(e){} }
  return roomWin;
}
document.getElementById('roomBtn').addEventListener('click', openRoom);
function switchToRoom(){
  if(!AUTO_SWITCH_TO_ROOM) return;
  if(roomWin && !roomWin.closed){
    try{ roomWin.focus(); }catch(e){}
  }else{
    // まだ開かれていない：クリック起点ではないので window.open はポップアップ
    // ブロックされうる。一度だけ案内を出す。
    if(!roomHintShown){
      roomHintShown = true;
      setTimeout(()=>showMsg('🏠ボタンでマイルームを開くと自動切替できます', '#9fd7ff', 3000), 2300);
    }
  }
}

// マイルーム(room.html)への転送。
// 唯一の情報源はサーバAPI(userIdごとに分離されたdb.json)。
// postMessageは「今開いているルームへの即時反映」専用のショートカットで、
// 履歴の永続化・復元には一切関与しない（過去は localStorage['nekoRoomQueue']
// にブラウザ内の全獲得履歴を貯めてルーム起動時に丸ごと返す経路があったが、
// これは userId と無関係にブラウザ単位で蓄積されるため、userIdをリセットして
// テストしても古い獲得記録が新しいユーザーに紛れ込むバグの原因だった。撤去済み）。
function sendToRoom(cat){
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    def: cat.userData.def,
    caughtAt: Date.now(),
  };
  if(roomWin && !roomWin.closed){
    try{ roomWin.postMessage({type:'neko-transfer', entry}, '*'); }catch(e){}
  }
  if(HOOKS.onCatch) HOOKS.onCatch(entry);   // サーバへの永続化はページ側(onCatchフック)が担当
}

let wonCount = 0;   // トレイに並んだ猫の数（スロット割り当て用）
function winCat(cat){
  const u = cat.userData;
  u.state = 'exit'; u.vy = 0;
  cat.rotation.set(0, cat.rotation.y, 0);
  score++;
  points += u.points;
  stageCaught++;
  fanfare();
  showMsg(`🎉 ${u.name}ゲット！ +${u.points}点`, '#ffc94d', 2200);
  refreshHUD();
  // シャフト底 → 台座前面の穴 → トレイの定位置 へ滑り出る経路
  const slot = wonCount++;
  const sx = 5.4 - (slot%6)*.95;
  const sz = 5.3 + Math.floor(slot/6)*.8;
  u.exitPath = [
    new THREE.Vector3(CLAW_HOME.x, -2.3, CLAW_HOME.z),   // シャフト底
    new THREE.Vector3(CLAW_HOME.x, -2.25, 4.35),          // 前面へ（台座内部）
    new THREE.Vector3(CLAW_HOME.x, -2.02, 5.05),          // 穴から外へ
    new THREE.Vector3(sx, -1.9, sz),                      // トレイの自分の席へ
  ];
  u.exitIdx = 0;
  // このステージの必要数を捕まえ終えたら「ステージN完了」→ 次のステージへ
  if(stageCaught >= stageTotal){
    const cleared = gameStage;
    setTimeout(()=>{
      showMsg(`🎉 ステージ${cleared}完了！`, '#ffc94d', 2500);
      fanfare(); setTimeout(fanfare, 500);
      setTimeout(()=>{ gameStage++; spawnStage(gameStage); refreshHUD(); }, 2200);
    }, 1400);
  }
}

// ---------- デバッグ：猫の数を作り直す（Bキー） ----------
function resetCats(n){
  craneState.heldCat = null;
  craneState.targetCat = null;
  for(const c of cats){
    scene.remove(c);
    c.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
  }
  cats.length = 0;
  wonCount = 0;
  for(let i=0;i<n;i++) spawnCat(BASE_DEFS[i % BASE_DEFS.length]);
  stageTotal = n; stageCaught = 0;   // このデバッグ生成分をそのままステージ扱いにする
  showMsg(`🐱 猫を${n}匹に設定（デバッグ）`, '#9fd7ff');
}

// ---------- メインループ ----------
let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now-last)/1000); last = now;
  updateCrane(dt);
  for(const c of cats) catThink(c, dt);
  // テレポート完了した猫を回収
  for(let i=cats.length-1; i>=0; i--){
    if(cats[i].userData.state==='gone'){
      const c = cats[i];
      scene.remove(c);
      c.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
      cats.splice(i,1);
    }
  }
  for(let k=0;k<3;k++) separateCats();   // 反復して残留めり込みも同フレーム内で解消
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

sizeRenderer();
addEventListener('resize', sizeRenderer);

  // ---- 外部公開API ----
  return {
    get stats(){ return {coins, score, points}; },
    // マイルーム側でコイン/とくてんが増減した場合に、サーバの最新値をこちらへ反映する入口。
    // ここでの反映は表示合わせが目的で、onHud(=persistを伴う)は使わず
    // onExternalSync（persistしない専用フック）経由でページ側のhudだけ更新する。
    // これにより「読み込んだ値をそのまま送り返す」無駄なPATCHや、
    // 未反映のローカル値で上書きしてしまう競合を避ける。
    syncWallet(newCoins, newPoints){
      let changed = false;
      if(Number.isFinite(newCoins) && newCoins !== coins){ coins = newCoins; changed = true; }
      if(Number.isFinite(newPoints) && newPoints !== points){ points = newPoints; changed = true; }
      if(changed && HOOKS.onExternalSync){
        HOOKS.onExternalSync({
          coins, score, points, stage: gameStage,
          canDrop: craneState.phase==='IDLE' && coins>0,
        });
      }
    },
  };
}
