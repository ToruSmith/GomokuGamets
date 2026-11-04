# CLAUDE.md

給在這個儲存庫工作的 Claude（與人類維護者）的規則。設計細節見 `docs/architecture.md`，功能與部署見 `README.md`。

## 專案

五子棋 PWA：對電腦、雙人同機、線上對戰、殘局、復盤與賽後分析。

- **獨立專案**：不與其他棋類專案共用程式碼、Firebase 專案或部署設定。
- 預設語言是繁體中文，介面文字一律走 `src/i18n/`，`zh-TW.ts` 與 `en.ts` 都要加。

## 技術

TypeScript（strict）、沒有前端框架（`state/signal.ts` + `ui/dom.ts`）、esbuild（`scripts/build.mjs`）。
執行期沒有 npm 相依；Firebase SDK 只在進入線上對戰時從 CDN 載入（版本在 `online/firebase-backend.ts` 的 `SDK`）。Node 22（`.nvmrc`）。

## 指令

- `npm run dev`：開發伺服器（<http://localhost:5173>）
- `npm run check`：typecheck + format:check + test + build
- `npm test`：單元測試（node:test + tsx）
- `npm run test:e2e`：Playwright 端對端測試（第一次要 `npx playwright install chromium`）
- `npm run format`：Prettier 排版，不手動調整

改完程式後 `npm run check` 與 `npm run test:e2e` 都要通過。

## 分層

```
ui/  ──▶  state/  ──▶  core/
              │          ▲
              ├──▶ ai/ ──┤
              └──▶ online/
```

- `core/` 是純邏輯，不碰 DOM、網路或儲存。規則有疑問就看 `core/rules.ts`。
- `ai/` 只依賴 `core/`，同時跑在 Worker 和測試裡。
- `online/session.ts` 只認得 `RoomBackend` 介面；Firebase 只在 `online/firebase-backend.ts`。
- `ui/` 只跟 `Match` 互動，不直接操作棋局。
- 相對 import 一律寫副檔名（`./game.ts`）。

## 不變式

- 一盤棋完全由 `moves` 決定；悔棋、復盤、棋譜連結、斷線重連都是重演同一串棋步。
- 線上：勝負不寫入資料庫，雙方從棋步重演；棋步只能附加，`moves/<i>` 與 `n` 同一次寫入；不合法的資料判該方負。
- 改 `database.rules.json` 時，同時在 `tests/online.test.ts` 加上正反兩面的測試，並提醒維護者執行 `firebase deploy --only database`。
  `tests/helpers/rules-db.ts` 只檢查寫入規則，模擬的是語意而非官方引擎，大改後要到 Rules Playground 確認。
- 殘局題由 `scripts/generate-puzzles.ts` 產生，不要手動編輯 `core/puzzle-data.ts`。

## 規則

- 自由（五連以上都算）、標準（剛好五連）、連珠（黑棋雙三、雙四、長連禁手，成五優先於禁手；白棋長連算勝）。
- 線上棋鐘：`config/clockMs` 開啟，黑棋第一手不計時，之後由 `moves/<i>/t` 的伺服器時間戳重演，超時的棋步不算。
- 已知缺口：沒有連珠開局規則與 Swap／Swap2。

## 部署

推送到 `main` 由 Cloudflare Pages 建置（`npm run build`，輸出 `dist`），其他分支產生預覽網址。
所有資源都用相對路徑，部署在子路徑或自訂網域都能運作。Service Worker 的快取名稱以 `gomoku-` 開頭，清快取時只能動自己的前綴。

## 密鑰

`online/firebase-config.ts` 是網頁設定，本來就會出現在瀏覽器裡，資料安全靠 `database.rules.json`。除此之外不提交任何密鑰。
