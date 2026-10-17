# app/chatgpt-auth.cjs、app/core-env.cjs 與 ChatGPTClient：登入憑證檢查

2026-10-13 檢查與補強了以下路徑。測試只使用假憑證，未使用真實帳號 token。

| 路徑 | 修正與驗證 |
| --- | --- |
| OAuth、模型及推論請求 | 固定使用官方端點，拒絕 HTTP 重新導向；以本機 307 伺服器驗證授權碼與 PKCE verifier 不會被轉送 |
| 憑證保存 | 使用 Electron safeStorage 的非同步加密，不允許明文備援；保存工作序列化，只有完整密文才原子替換 |
| 錯誤訊息 | 不回傳 token 回應原文、JSON 解析片段或任意底層錯誤；以含假憑證的錯誤回應驗證 |
| 串流完成 | 最終摘要省略輸出時，只補回已通過驗證的 `output_item.done`；事件順序、已完成項目的內容與未完成工具仍會檢查，錯誤僅提供固定分類 |
| 登入回呼 | 驗證回環 Host、單次 state、PKCE，以及 JWT 的簽章、issuer、audience、期限與 nonce |
| 取消登入 | 加密期間取消不會保存憑證；收到但未提交的 grant 嘗試撤銷 |
| refresh rotation 與登出 | 同一 session 的 refresh 序列化；登出等待 rotation，再撤銷最新憑證 |
| IPC 與設定頁 | token 只經父子行程 IPC 傳給 Core；HTTP 設定面板不提供 token 方法，公開狀態僅使用隨機帳號識別 |
| 請求停止 | 登出與失去授權時取消 Core 內進行中的訂閱請求，不切換 API Key |
| 系統代理紀錄 | 不保存代理端點、帳密或 PAC 例外原文；啟動紀錄只保留來源、協定及固定錯誤分類，以假帳密驗證 |
| Git、紀錄與更新 | 真實憑證置於 repository 外的獨立資料目錄；憑證與密文檔案另列入 gitignore；僅允許經審核的原始碼推送到自己的 fork，統計回傳與自動更新停用 |

`tests/chatgpt-auth.test.ts` 的 16 項測試與 `packages/cortico-provider-coo/tests/chatgpt.test.ts` 的 15 項測試通過。登入等待十五分鐘，並測試延遲授權與逾時清除。另以 Electron 在這台 Windows 使用非同步 safeStorage 加密假的 canary 字串，確認加密可用、解密結果一致、密文不含原文。

使用者完成官方授權後，已以 `gpt-6.1-sol` 取得完整的訂閱模型回覆，HTTP 200，約 2.8 秒。登入憑證保存在 repository 外的密文檔案，重啟後仍可使用。額外 credits 權限由 ChatGPT 帳號設定管理。

這是針對本次新增路徑的檢查與測試，不是整個 Electron、Windows 或所有第三方相依套件的零漏洞保證。DPAPI 無法阻擋已取得同一 Windows 帳號權限的惡意程式。

訂閱推論每次只送出一次，HTTP 401 不會自動更新後重送；到期憑證仍可在請求前更新。錯誤會暫停並中止 Core 目前輪次，阻止同一批內的自動重送。`tests/chatgpt-no-retry.test.js` 使用真實 Core 與假的訂閱回應驗證 401、429、503、網路與串流錯誤，以及手動恢復。
