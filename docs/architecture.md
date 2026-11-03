# 架構說明

寫給之後要維護這個專案的人（包含未來的你）。

## 依賴方向

```
ui/  ──▶  state/  ──▶  core/
              │          ▲
              ├──▶ ai/ ──┤
              └──▶ online/
```

- `core/` 是純邏輯，不碰 DOM、網路或儲存。規則有疑問就看這裡。
- `ai/` 只依賴 `core/`，同時跑在 Worker 和測試裡。
- `online/session.ts` 只認得 `RoomBackend` 介面，不知道 Firebase 的存在。
- `state/` 把上面三者組成「一盤棋」（`Match`）。
- `ui/` 只跟 `Match` 互動，不直接操作棋局內容。

這個方向是刻意的：`tests/` 可以不開瀏覽器就驗證規則、AI 與線上流程。

## 一盤棋就是一串棋步

`Game` 的狀態完全由 `moves` 決定。悔棋、復盤、棋譜連結、斷線重連都是重演同一串棋步，
所以不會有「畫面和資料不同步」這類問題。

## 線上對戰

資料模型在 `online/types.ts`。設計重點：

- **棋步只能附加**：`moves` 加上 `n` 一起用多路徑更新寫入，不會漏手。
- **勝負不存資料庫**：雙方都從棋步重演出結果，沒有欄位可以偽造勝利。
- **不合法的資料判負**：規則擋不到的情況（例如只加手數不落子）由 `replayRoom` 判該方輸。
- **再戰開新房**：舊房間寫入 `next`，雙方跟過去並交換黑白，舊資料不必清空重用。

規則寫在 `database.rules.json`。`tests/helpers/rules-db.ts` 會真的載入這個檔案，
讓 `tests/online.test.ts` 的每次寫入都經過規則求值。它模擬的是規則語意，不是 Firebase
官方引擎，所以大改規則後仍請到 Firebase Console 的 Rules Playground 確認。

## 響應式 UI

沒有使用框架。`state/signal.ts` 提供 signal 與 effect，`ui/dom.ts` 的 `h()` 建立 DOM：
屬性或子節點傳函式就會自動更新。

```ts
h('p', { class: () => (active.value ? 'on' : '') }, () => count.value);
```

棋盤例外：`ui/board.ts` 是一個 class，直接收 `BoardModel` 後做差異更新，
這樣新棋子才有落下動畫，也不用每一手重建整個 SVG。

## AI

`ai/engine.ts` 開頭的註解說明了做法。調整棋力時：

- 難度參數在 `ai/levels.ts`。
- 評估權重是 `WINDOW_VALUE` 與 `MOVE_GAIN`。改完後請用自我對弈確認，直覺常常是錯的。
- `npm test` 會驗證基本戰術，以及三種規則下自我對弈全程合法。

## 常見的修改

**新增語言**：在 `src/i18n/` 複製 `en.ts`，然後加進 `i18n/index.ts` 的 `LOCALES` 和
`DICTIONARIES`。少翻任何一個 key，TypeScript 都會報錯。

**新增棋盤材質**：在 `state/settings.ts` 的 `BOARD_SKINS` 加名稱，在 `main.css` 加一組
`--board-*`，再補上翻譯 `settings.skin.<名稱>`。

**新增殘局題**：執行 `node --import tsx scripts/generate-puzzles.ts > src/core/puzzle-data.ts`。
`tests/puzzles.test.ts` 會驗證每題都有解，而且沒有更短的解。

**換 Firebase 專案**：修改 `online/firebase-config.ts` 和 `.firebaserc`。

**升級 Firebase SDK**：修改 `online/firebase-backend.ts` 的 `SDK` 版本號。
