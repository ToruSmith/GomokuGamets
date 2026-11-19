# 第三方授權

本專案的程式碼未採用開源授權，著作權由作者保留。網站本身沒有打包任何第三方程式碼；
以下是執行時從外部載入的資源，它們各自適用原授權。

## 執行時載入

- **Firebase JavaScript SDK** 13.2.0（`firebase-app`、`firebase-auth`、`firebase-database`）：Apache-2.0。
  只在進入線上對戰時從 `www.gstatic.com` 載入，版本在 `src/online/firebase-backend.ts` 的 `SDK`。
- **LXGW WenKai TC**（霞鶩文楷 TC）：SIL Open Font License 1.1，經 Google Fonts 載入。
- **Noto Sans TC**：SIL Open Font License 1.1，經 Google Fonts 載入。

字型授權全文見 <https://openfontlicense.org>。

## 開發工具

`esbuild`、`typescript`、`tsx`、`prettier`、`playwright`、`sharp` 只用在建置與測試，不會隨網站發佈。
棋盤、棋子、圖示都是程式產生的 SVG 與 PNG，沒有使用外部圖片。新增或升級依賴時要同步更新這份清單。
