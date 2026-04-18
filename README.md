# 五子棋 — 部署與設定指南

## 功能清單
- 👥 本地雙人對戰
- 🤖 AI 對戰（簡單 / 中等 / 困難）
- 🌐 線上即時對戰（Firebase）
- 🌙 深色模式
- 🔊 音效
- 📱 RWD 響應式設計

---

## 第一步：建立 Firebase 專案

### 1-1 建立專案
1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 點「新增專案」→ 輸入專案名稱（如 `gomoku-online`）
3. 停用 Google Analytics（可選）→ 建立專案

### 1-2 啟用 Realtime Database
1. 左側選單 → **建構** → **Realtime Database**
2. 點「建立資料庫」
3. 選擇區域：**asia-southeast1（新加坡）**（台灣玩家延遲最低）
4. 安全性規則選「**以測試模式啟動**」→ 建立完成

### 1-3 啟用匿名登入
1. 左側選單 → **建構** → **Authentication**
2. 點「開始使用」→ 選「**登入方式**」分頁
3. 點「**匿名**」→ 啟用 → 儲存

### 1-4 取得設定資料
1. 點左上角齒輪（專案設定）→「一般」分頁
2. 在「你的應用程式」區塊點「**新增應用程式**」→ 選 `</>`（網頁）
3. 輸入應用程式暱稱 → 點「繼續」
4. 複製 `firebaseConfig` 物件裡的所有內容

### 1-5 設定安全性規則
1. Realtime Database → **規則** 分頁
2. 貼上以下規則並發布：

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": "auth != null",
        ".write": "auth != null",
        "board": {
          "$row": {
            "$col": {
              ".write": "auth != null && !data.exists()"
            }
          }
        }
      }
    }
  }
}
```

---

## 第二步：填入設定

打開 `firebase-config.js`，將內容換成你的設定：

```javascript
export const firebaseConfig = {
    apiKey:            "AIzaSy...",
    authDomain:        "gomoku-online.firebaseapp.com",
    databaseURL:       "https://gomoku-online-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "gomoku-online",
    storageBucket:     "gomoku-online.appspot.com",
    messagingSenderId: "123456789",
    appId:             "1:123456789:web:abc123"
};
```

> ⚠️ **注意**：`databaseURL` 很重要，要包含完整網址（含 asia-southeast1）。

---

## 第三步：部署到 GitHub Pages

### 3-1 建立 GitHub 倉庫
1. 前往 [github.com](https://github.com) → 右上角「**+**」→「New repository」
2. 輸入倉庫名稱（如 `gomoku`）→ 設為 **Public** → Create

### 3-2 上傳檔案
在電腦終端機執行：

```bash
cd 你的五子棋資料夾
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/你的帳號/gomoku.git
git push -u origin main
```

### 3-3 開啟 GitHub Pages
1. 進入你的 GitHub 倉庫頁面
2. 點上方「**Settings**」→ 左側「**Pages**」
3. Source 選「**GitHub Actions**」→ 儲存

### 3-4 等待部署完成
- 回到倉庫主頁 → 點「**Actions**」分頁
- 看到綠色勾勾 ✅ 表示部署成功
- 你的遊戲網址：`https://你的帳號.github.io/gomoku/`

---

## 第四步：在 Firebase Console 設定 Authorized Domain

1. Firebase Console → **Authentication** → **Settings**（設定）分頁
2. 在「**已授權的網域**」加入：`你的帳號.github.io`
3. 點「新增網域」→ 儲存

---

## 線上對戰使用方法

1. 打開遊戲網址
2. 點右側「🌐 線上對戰」按鈕
3. **建立房間**：你執黑棋，點「建立新房間」取得 6 位代碼
4. 把代碼傳給朋友
5. 朋友打開相同網址 → 點「線上對戰」→ 輸入代碼 → 加入
6. 遊戲自動開始，輪到你時畫面會高亮提示

---

## 本地測試（開發用）

因為使用 ES Module，不能直接雙擊 `index.html`，需要本地伺服器：

```bash
# 方法一：Python（已安裝 Python 3）
python -m http.server 8080
# 打開 http://localhost:8080

# 方法二：Node.js（已安裝 Node）
npx serve .
# 打開顯示的網址

# 方法三：VS Code 安裝 Live Server 擴充套件
# 右鍵 index.html → Open with Live Server
```

---

## 檔案結構

```
gomoku/
├── index.html          # 主頁面
├── style.css           # 樣式
├── script.js           # 主程式（含線上模式）
├── worker.js           # AI Web Worker（不阻塞畫面）
├── firebase-config.js  # ⚠️ Firebase 設定（需填入）
├── database.rules.json # Firebase 安全性規則參考
├── .github/
│   └── workflows/
│       └── deploy.yml  # GitHub Actions 自動部署
└── README.md
```

---

## 常見問題

**Q: 線上對戰按鈕按下去沒反應？**
A: 請確認 `firebase-config.js` 已填入正確設定，且 Firebase 匿名登入已啟用。

**Q: 朋友無法加入房間？**
A: 確認 GitHub Pages 網域已加入 Firebase Authorized Domains。

**Q: 部署後更新遊戲？**
```bash
git add .
git commit -m "更新內容"
git push
```
GitHub Actions 會自動重新部署（約 1-2 分鐘）。

**Q: 如何清除過期的房間資料？**
A: Firebase Console → Realtime Database → 手動刪除 `rooms/` 節點，或在 Firebase Console 設定 TTL 規則。
