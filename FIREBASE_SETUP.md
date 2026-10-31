# 開啟線上功能（Firebase 設定）

線上對戰與線上排行榜使用 Firebase 的免費方案（Spark），不需要信用卡。整個設定大約 5–10 分鐘。

## 1. 建立專案

1. 打開 <https://console.firebase.google.com/>，用 Google 帳號登入。
2. 按「新增專案」，名稱隨意（例如 `turbo-overdose`），Google Analytics 可以關掉，建立。

## 2. 開啟匿名登入

1. 左側選單「建構」→「Authentication」→「開始使用」。
2. 「登入方式」分頁 → 選「匿名」→ 啟用 → 儲存。

玩家不用註冊，遊戲會自動用匿名身分連線。

## 3. 建立 Firestore（排行榜）

1. 「建構」→「Firestore Database」→「建立資料庫」。
2. 位置選離你近的（例如 `asia-east1` 台灣）。
3. 選「以正式版模式啟動」。
4. 建好後到「規則」分頁，把本專案的 [`firestore.rules`](firestore.rules) 內容整個貼上 → 發布。

## 4. 建立 Realtime Database（多人連線）

1. 「建構」→「Realtime Database」→「建立資料庫」。
2. 位置選 `asia-southeast1`（新加坡）或離你近的。
3. 選「以鎖定模式啟動」。
4. 建好後到「規則」分頁，把本專案的 [`database.rules.json`](database.rules.json) 內容整個貼上 → 發布。

## 5. 取得網頁設定

1. 左上角齒輪 →「專案設定」→「一般」分頁，往下到「你的應用程式」。
2. 按 `</>`（網頁）圖示，應用程式暱稱隨意，**不用**勾選 Firebase Hosting，註冊。
3. 畫面會出現一段 `const firebaseConfig = { ... }`，把大括號那段複製起來。

## 6. 授權網域

「Authentication」→「設定」→「授權網域」→ 新增 `hankyleisplay.github.io`（`localhost` 預設已經有）。

## 7. 填入設定

把第 5 步複製的內容貼給 Claude，或自己改 [`firebase-config.js`](firebase-config.js)：

```js
export const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "....firebaseapp.com",
  databaseURL: "https://....firebasedatabase.app",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

注意要有 `databaseURL`（第 4 步建立 Realtime Database 之後，設定裡才會出現）。

這組設定本來就會公開在網頁原始碼裡，這是 Firebase 的正常用法；資料的安全靠第 3、4 步的規則把關（只能改自己的成績與自己的車輛位置）。

## 本機測試（不需要 Firebase）

網址後面加上 `?localnet`（例如 <http://localhost:8765/?localnet>），會改用本機測試後端：同一台電腦開兩個分頁就能互相建立 / 加入房間、測試排行榜。
