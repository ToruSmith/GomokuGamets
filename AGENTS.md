# AGENTS.md

給在這個儲存庫工作的 AI 工程師（Claude、Codex、Cursor、Gemini 等）與人類維護者的規則。
`CLAUDE.md` 只是引用這個檔案，規則以這裡為準。

## 先讀什麼

1. 這個檔案：規則、不變式、不能做的事。
2. [`docs/architecture.md`](docs/architecture.md)：設計理由與「常見的修改」。
3. 要動到的那一層的程式；每個檔案開頭的註解說明了它負責什麼。

文件分工：`README.md` 給開發者與部署者，`docs/player-guide.md` 給玩家，`SECURITY.md` 是安全設計與回報方式，
`CHANGELOG.md` 記錄每個版本的變更。改了玩家看得到的行為，要同步更新玩家指南。

## 專案

五子棋 PWA：對電腦、雙人同機、線上對戰、殘局、復盤與賽後分析。正式網址 <https://gomokugamets.pages.dev/>。

- **獨立專案**：不與其他棋類專案共用程式碼、Firebase 專案或部署設定。手談棋館（QiguanGamets）只放連結。
- 預設語言是繁體中文，介面文字一律走 `src/i18n/`，`zh-TW.ts` 與 `en.ts` 都要加（少一個 key 會型別錯誤）。
- 程式碼沒有採用開源授權，著作權由作者保留。不要加入授權不明的素材或程式碼。

## 技術

TypeScript（strict）、沒有前端框架（`state/signal.ts` + `ui/dom.ts`）、esbuild（`scripts/build.mjs`）。
執行期沒有 npm 相依；Firebase SDK 只在進入線上對戰時從 CDN 載入（版本在 `online/firebase-backend.ts` 的 `SDK`）。Node 22（`.nvmrc`）。

## 指令

| 指令                                 | 用途                                                                |
| ------------------------------------ | ------------------------------------------------------------------- |
| `npm run dev`                        | 開發伺服器（<http://localhost:5173>）                               |
| `npm run check`                      | typecheck + format:check + test + build                             |
| `npm test`                           | 單元測試（node:test + tsx）                                         |
| `npm run test:e2e`                   | Playwright 端對端測試（第一次要 `npx playwright install chromium`） |
| `npm run smoke -- <網址> [--online]` | 部署後驗收；`--online` 會真的匿名登入並開一間房再刪掉               |
| `npm run format`                     | Prettier 排版，不手動調整                                           |

改完程式後 `npm run check` 與 `npm run test:e2e` 都要通過。CI（`.github/workflows/ci.yml`）在每次推送都會跑；
`health.yml` 每週檢查正式網站、線上開房與安全公告。

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
- 儲存只經過 `platform/storage.ts`（私密模式下 localStorage 會丟例外）。
- 相對 import 一律寫副檔名（`./game.ts`）。
- 不使用 `innerHTML` 這類會解析 HTML 的寫法；暱稱等資料來自資料庫，一律當文字插入。

## 不變式

- 一盤棋完全由 `moves` 決定；悔棋、復盤、棋譜連結、斷線重連都是重演同一串棋步。
- 線上：勝負不寫入資料庫，雙方從棋步重演；棋步只能附加，`moves/<i>` 與 `n` 同一次寫入；不合法的資料判該方負。
- 線上的時間一律用伺服器時間：開房的 `createdAt` 與限時對局每手的 `t` 都寫 `SERVER_TIME`，規則要求等於 `now`。
- 改 `database.rules.json` 時，同時在 `tests/online.test.ts` 加上正反兩面的測試。規則要由維護者到 Firebase Console
  手動發布（步驟見 `README.md`「發布資料庫規則」），PR 說明裡要寫清楚「需要發布規則」以及先後順序。
  `tests/helpers/rules-db.ts` 只檢查寫入規則，模擬的是語意而非官方引擎，大改後要到 Rules Playground 確認。
- 殘局題由 `scripts/generate-puzzles.ts` 產生，不要手動編輯 `core/puzzle-data.ts`。
- Service Worker 的快取名稱以 `gomoku-` 開頭，清快取時只能動自己的前綴。

## 規則

- 自由（五連以上都算）、標準（剛好五連）、連珠（黑棋雙三、雙四、長連禁手，成五優先於禁手；白棋長連算勝）。
- 線上棋鐘：`config/clockMs` 開啟，黑棋第一手不計時，之後由 `moves/<i>/t` 的伺服器時間戳重演，超時的棋步不算。
- 已知缺口：沒有連珠開局規則與 Swap／Swap2。

## 部署

推送到 `main` 由 Cloudflare Pages 建置（`npm run build`，輸出 `dist`），其他分支產生預覽網址
（`https://<分支名稱>.gomokugamets.pages.dev/`，斜線換成 `-`）。回應標頭在 `public/_headers`。
所有資源都用相對路徑，部署在子路徑或自訂網域都能運作。

## 升級相依套件

- npm 套件只有開發工具。升級後跑 `npm run check` 與 `npm run test:e2e`。
- Firebase SDK：改 `online/firebase-backend.ts` 的 `SDK` 版本號，推到分支後讓 `health.yml` 對預覽網址跑
  `smoke --online`（它會實際載入新版 SDK、匿名登入並開房）。

## 密鑰

`online/firebase-config.ts` 是網頁設定，本來就會出現在瀏覽器裡，資料安全靠 `database.rules.json`。除此之外不提交任何密鑰。

## 不做的事

註冊登入、跨遊戲戰績、自由輸入的聊天、廣告與追蹤程式。
