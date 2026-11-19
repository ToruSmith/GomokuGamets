# 安全政策

## 回報問題

發現安全問題（例如可以改別人的棋局、讀到不該讀的資料、讓網站執行外來的程式），
請用 GitHub 的 [Report a vulnerability](https://github.com/ToruSmith/GomokuGamets/security/advisories/new)
私下回報，不要開公開的 Issue。如果那個頁面打不開，請開一則 Issue，只寫「有安全問題想私下回報」，不要寫細節。
一般錯誤與建議請用 [Issues](https://github.com/ToruSmith/GomokuGamets/issues)。

## 安全設計摘要

這是純靜態網站，沒有自己的伺服器；線上對戰用 Firebase Realtime Database 與匿名登入，
所以設計時假設**用戶端不可信**，保護全部靠 `database.rules.json`：

| 威脅                       | 防護                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| 寫入「我贏了」             | 資料庫沒有勝負欄位，雙方都從棋步重演得出結果                                |
| 替對方下棋、改已下的棋步   | 規則檢查寫入者是不是該手的棋手；棋步只能附加，`moves/<i>` 與 `n` 同一次寫入 |
| 偽造時間、拖延對手的棋鐘   | 開房時間與每手時間戳都必須等於伺服器時間（`now`）                           |
| 搶座位、改房間設定         | 座位只能由本人寫入一次；設定建立後不能改，欄位與數值範圍都有白名單          |
| 刪掉進行中的對局           | 雙方都入座後，只有超過一天的房間才能被刪除                                  |
| 規則擋不到的不合法資料     | 重演時判該方負（例如只加手數不落子、下在禁手點）                            |
| 暱稱裡塞 HTML 或腳本       | 介面只把暱稱當文字插入，不解析 HTML；長度限制 1～16 字                      |
| 被其他網站嵌入（點擊劫持） | `public/_headers` 的 `frame-ancestors 'self'`                               |

`tests/online.test.ts` 用 `tests/helpers/rules-db.ts` 載入真的規則檔，每一次寫入都經過規則求值，
包含十多種作弊情境。每月的巡檢（`.github/workflows/health.yml`）會實際在正式網站開房，並檢查相依套件的安全公告。

## 已知限制

- 匿名登入不能防止有人大量建立房間。目前的用量遠低於 Firebase 免費額度；如果遇到濫用，
  可以在 Firebase 啟用 App Check。
- `src/online/firebase-config.ts` 的網頁設定（含 `apiKey`）本來就會出現在每個訪客的瀏覽器裡，不是密鑰。
