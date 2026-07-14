# ねこキャッチャー

クレーンゲームで捕まえた猫が、あなたのお部屋（マイルーム）で暮らす3Dブラウザゲームです。
Vue.js 3 + Three.js + 依存パッケージゼロのNode.jsサーバで構築しています。

## 構成

- `public/lp.html` — ランディングページ（トップページ）
- `public/game.html` — クレーンゲーム本体
- `public/room.html` — マイルーム（捕まえた猫と暮らす部屋）
- `public/js/game-engine.js` — クレーンゲームの3Dエンジン（Three.js）
- `public/js/room-engine.js` — マイルームの3Dエンジン（Three.js）
- `public/js/cat-shared.js` — 猫モデルの共通ビルダー
- `server.js` — 静的配信 + APIサーバ（ユーザー・獲得猫・家具などをJSONファイルに永続化）

## 起動方法

```bash
npm start
```

または

```bash
node server.js
```

起動後、`http://localhost:3000/` にアクセスするとLPが表示されます。LP内のリンクからゲーム（`game.html`）・マイルーム（`room.html`）に遷移できます。同じLAN内であれば `http://<PCのIP>:3000/` でスマホからもアクセスできます。

## データ

ユーザーデータ（コイン・獲得猫・家具など）は `data/db.json` に保存されます（Git管理外）。
