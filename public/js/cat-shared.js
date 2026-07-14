'use strict';
/* ============================================================
   cat-shared.js ― 猫モデルの共通実装
   ゲーム(game-engine.js)・マイルーム(room-engine.js)・
   3Dねこメーカー が同じ定義とビルダーを共有する。
   ============================================================ */

const DEFAULT_DEF = {
  format:'neko-crane-cat', version:1, name:'子ねこ',
  colors:{ fur:'#f3f1ea', patch:'#b59c82', stripe:'#8a715c',
           earIn:'#c9a290', iris:'#6d5c3c', nose:'#b97f84' },
  props:{ headSize:1, legLen:1, earSize:1, eyeSize:1,
          fluff:1, patchAmount:1, bodyLen:1, scale:1 },
};

// レインボー縞の7色（赤→紫）
const RAINBOW = ['#ff4b4b','#ff9a3c','#ffe14d','#58d868','#4db8ff','#5a6cff','#b05cff']
  .map(c => new THREE.Color(c));

// デフォルトの5色：白5点・茶10点・黒20点・ピンク40点・水色80点
function colorDef(name, points, fur, patch, stripe, earIn){
  return { ...DEFAULT_DEF, name, points,
    colors:{ ...DEFAULT_DEF.colors, fur, patch, stripe, earIn },
    props:{ ...DEFAULT_DEF.props } };
}
const BASE_DEFS = [
  colorDef('白ねこ',     5, '#f5f2ea', '#e3dccd', '#cfc6b2', '#dcb9ad'),
  colorDef('茶色ねこ',  10, '#a9714b', '#7d4e30', '#5c3820', '#c08a72'),
  colorDef('黒ねこ',    20, '#33302e', '#211f1d', '#161413', '#6b544c'),
  colorDef('ピンクねこ',40, '#f5b6c6', '#e08aa4', '#c76a8b', '#f0cdd6'),
  { ...colorDef('レインボーねこ', 80, '#ff5f5f', '#ffb14d', '#ffd94d', '#ffc0cb'),
    rainbow:true },   // 毛色はレインボー処理で上書きされる
];

// メーカー側と同一実装のビルダー
function buildCatModel(def){
  const C = def.colors, P = def.props;
  const std = (hex,rough=.95)=>new THREE.MeshStandardMaterial({color:new THREE.Color(hex), roughness:rough});
  const fur=std(C.fur), patchM=std(C.patch), stripeM=std(C.stripe), earInM=std(C.earIn,.9);
  const cream = std(C.fur); cream.color.multiplyScalar(.93);
  const irisM = std(C.iris,.35);
  const rimM  = std('#17100a',.5);
  const pupil = std('#050403',.25);
  const shine = new THREE.MeshBasicMaterial({color:0xffffff});
  const noseM = std(C.nose,.6);

  const lift = .42*(P.legLen-1);          // 脚が伸びた分だけ胴体を持ち上げる
  const bl = P.bodyLen;
  const showPatch = P.patchAmount > .05;
  const ps = Math.min(1.5, Math.max(.25, P.patchAmount));   // 模様の面積係数

  const g = new THREE.Group();

  // 胴体
  const body = new THREE.Mesh(new THREE.SphereGeometry(.5,20,16), fur);
  body.scale.set(1.3*bl,.82,.9); body.position.y=.46+lift; body.castShadow=true; g.add(body);
  const hip = new THREE.Mesh(new THREE.SphereGeometry(.22,10,8), cream);
  hip.scale.set(1.3,.5,1); hip.position.set(-.42*bl,.72+lift,.1); g.add(hip);
  const hip2 = new THREE.Mesh(new THREE.SphereGeometry(.15,10,8), patchM);
  hip2.scale.set(1.2*ps,.4,.9*ps); hip2.position.set(-.5*bl,.74+lift,-.14);
  hip2.visible = showPatch; g.add(hip2);
  // 胸のふわふわ
  const chest = new THREE.Mesh(new THREE.SphereGeometry(.32,14,12), fur);
  chest.scale.set(.9*P.fluff,1.05*P.fluff,P.fluff); chest.position.set(.48*bl,.4+lift,0);
  chest.castShadow=true; g.add(chest);
  const ruff = new THREE.Mesh(new THREE.SphereGeometry(.22,10,8), fur);
  ruff.scale.setScalar(P.fluff); ruff.position.set(.56*bl,.62+lift,0); g.add(ruff);

  // 頭
  const head = new THREE.Group();
  head.position.set(.66*bl,.95+lift,0); head.scale.setScalar(P.headSize); g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(.4,20,16), fur);
  skull.scale.set(.95,.9,1); skull.castShadow=true; head.add(skull);
  // 頭頂〜側頭部のパッチ
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(.3,12,10), patchM);
  capTop.scale.set(.95*ps,.6,1.15*ps); capTop.position.set(-.05,.24,0);
  capTop.visible = showPatch; head.add(capTop);
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.SphereGeometry(.24,12,10), patchM);
    side.scale.set(.9*ps,.85,.6*ps); side.position.set(.05,.1,s*.3);
    side.visible = showPatch; head.add(side);
    const cheekTan = new THREE.Mesh(new THREE.SphereGeometry(.14,10,8), patchM);
    cheekTan.scale.set(.7*ps,.9,.6*ps); cheekTan.position.set(.24,-.02,s*.3);
    cheekTan.visible = showPatch; head.add(cheekTan);
  }
  // 額のブレーズ
  const blaze = new THREE.Mesh(new THREE.SphereGeometry(.17,10,10), fur);
  blaze.scale.set(1.05,1.5,.55); blaze.position.set(.24,.18,0); head.add(blaze);
  // 額の縞
  for(let i=-1;i<=1;i++){
    const st = new THREE.Mesh(new THREE.BoxGeometry(.2,.16,.035), stripeM);
    st.position.set(.1,.34,i*.14);
    st.rotation.x = i*.35; st.rotation.z = -.5;
    st.visible = showPatch; head.add(st);
  }
  // 耳
  for(const s of [-1,1]){
    const ear = new THREE.Mesh(new THREE.ConeGeometry(.15,.3,4), patchM);
    ear.position.set(-.06,.38,s*.24); ear.rotation.set(s*.3,.45,-.1);
    ear.scale.setScalar(P.earSize); ear.castShadow=true; head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(.085,.2,4), earInM);
    inner.position.set(-.02,.37,s*.235); inner.rotation.set(s*.3,.45,-.1);
    inner.scale.setScalar(P.earSize); head.add(inner);
  }
  // 目（縁→虹彩→瞳孔→ハイライト）
  const eyes = [];
  for(const s of [-1,1]){
    const eye = new THREE.Group();
    eyes.push(eye);
    eye.position.set(.31,.05,s*.155); eye.rotation.y = -s*.32;
    eye.scale.setScalar(P.eyeSize); head.add(eye);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(.096,12,10), rimM);
    rim.scale.set(.5,1,1); eye.add(rim);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(.08,12,10), irisM);
    ir.scale.set(.5,1,1); ir.position.x=.018; eye.add(ir);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(.048,10,8), pupil);
    pu.scale.set(.5,1,1); pu.position.x=.042; eye.add(pu);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(.02,6,6), shine);
    hi.position.set(.075,.035,.02); eye.add(hi);
  }
  // マズル・鼻・口
  for(const s of [-1,1]){
    const mz = new THREE.Mesh(new THREE.SphereGeometry(.115,12,10), fur);
    mz.scale.set(.8,.75,1); mz.position.set(.33,-.13,s*.085); head.add(mz);
  }
  const chin = new THREE.Mesh(new THREE.SphereGeometry(.09,10,8), fur);
  chin.position.set(.32,-.22,0); head.add(chin);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.05,.06,3), noseM);
  nose.position.set(.41,-.06,0);
  nose.rotation.set(0,0,Math.PI); nose.rotation.y = Math.PI/2;
  head.add(nose);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(.012,.06,.012), rimM);
  lip.position.set(.42,-.13,0); head.add(lip);
  // 舌（普段は隠しておき、舐めるときだけ出す）
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),
    new THREE.MeshStandardMaterial({color:0xe58a92, roughness:.55}));
  tongue.scale.set(.001,.001,.001); tongue.visible = false;
  tongue.position.set(.40,-.18,0);
  head.add(tongue);
  // ヒゲ（付け根を口元に置き、根元から外向きに生やす）
  for(const s of [-1,1]) for(let i=0;i<3;i++){
    const wgGeo = new THREE.CylinderGeometry(.004,.004,.34,4);
    wgGeo.translate(0,.17,0);                          // 根元基準：+y方向にだけ伸びる
    const wg = new THREE.Mesh(wgGeo,
               new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.75}));
    wg.rotation.z = -Math.PI/2;                        // 軸を前方(+x)へ
    wg.rotation.y = -s*(.55+.12*i);                    // 前方から外側(s側)へ振り分け
    wg.rotation.x = s*(i-1)*.13;                       // 上・中・下の扇形
    wg.position.set(.33,-.09+(i-1)*.03, s*.11);        // 付け根はマズルの横
    head.add(wg);
  }
  // 脚
  const legLen = .42*P.legLen;
  const legGeo = new THREE.CylinderGeometry(.085,.075,legLen,10);
  legGeo.translate(0,-legLen/2,0);
  const legs = [];
  const legPos = [[.38*bl,legLen,.2],[.38*bl,legLen,-.2],[-.36*bl,legLen,.2],[-.36*bl,legLen,-.2]];
  for(const [x,y,z] of legPos){
    const leg = new THREE.Mesh(legGeo, fur);
    leg.position.set(x,y,z); leg.castShadow=true;
    g.add(leg); legs.push(leg);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(.095,8,6), fur);
    paw.scale.set(1.15,.8,1); paw.position.y = -legLen+.02; leg.add(paw);
  }
  // しっぽ（先端にパッチ色）
  const tailRoot = new THREE.Group();
  tailRoot.position.set(-.6*bl,.64+lift,0); g.add(tailRoot);
  const tailSegs = [];
  let parent = tailRoot;
  for(let i=0;i<4;i++){
    const seg = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(.09-.012*i,8,6),
                             (i>=2 && showPatch)?patchM:fur);
    s.position.x = -.13; seg.add(s);
    seg.position.x = i===0?0:-.16;
    parent.add(seg); parent = seg;
    tailSegs.push(seg);
  }
  tailRoot.rotation.z = .85;

  return {group:g, legs, head, tailRoot, tailSegs, eyes, tongue};
}

// レインボー猫：体の左右(z)方向の7色縞々を頂点カラーで付与
function applyRainbowStripes(g, scale){
  g.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const meshes = [];
  g.traverse(o=>{
    if(!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    if(o.material.roughness < .88) return;
    o.geometry = o.geometry.clone();
    const pos = o.geometry.attributes.position;
    const ts = new Float32Array(pos.count);
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
      ts[i] = Math.max(0, Math.min(.999, (v.z/scale + .6)/1.2));
    }
    const col = new THREE.Float32BufferAttribute(new Float32Array(pos.count*3), 3);
    o.geometry.setAttribute('color', col);
    const m = o.material.clone();
    m.vertexColors = true; m.color.set('#ffffff');
    o.material = m;
    meshes.push({col, ts});
  });
  return meshes;
}
function tickRainbowStripes(meshes){
  const shift = performance.now()*.0008;   // 縞が右→左へ流れる速度
  for(const e of meshes){
    const col=e.col, ts=e.ts;
    for(let i=0;i<ts.length;i++){
      const c = RAINBOW[(ts[i]*7 + shift)%7 | 0];
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
}
