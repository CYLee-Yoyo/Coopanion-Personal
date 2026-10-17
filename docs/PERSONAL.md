# app/chatgpt-auth.cjs、app/personal-data.cjs、core/upstream-watch.ts、core/personal-upstream.ts、core/upstream-strings.ts、console/features/updates/、console/features/pet/、scripts/check-personal-push.mjs 與 packages/cortico-provider-coo/src/chatgpt/：專屬版

Coopanion Personal 使用獨立的安裝識別 `local.coopanion.personal`。Windows 安裝位置為 `%LOCALAPPDATA%\Programs\CoopanionPersonal`，資料位置為 `%LOCALAPPDATA%\CoopanionPersonal`，控制台使用本機連接埠 17888。原版 Coopanion 的資料不會被匯入。

目前以原版 v0.1.27 為基礎，專屬版版本為 `0.1.27-personal.1`，Cortico 為 v0.1.16。包含提示詞編輯器的復原／重做與分段預覽、系統代理、語音輸入保護及空白對話列修正。設定介面位於 `/coopanion/`，在獨立的 Electron session 中執行。升級沿用原有的專屬資料目錄與加密登入檔案，不需要重新匯入原版資料。

Core 支援系統代理與 PAC，手動設定的代理環境變數優先。啟動紀錄僅顯示代理來源、協定及固定錯誤分類，不記錄代理帳密、位址或 PAC 錯誤原文。HTTPS 驗證與訂閱請求拒絕重新導向的規則保持生效。

開發倉庫、已安裝程式與個人資料分開保存。GitHub fork 僅備份經審核的原始碼。

Windows 安裝目錄的 `personal-data-location.json` 保存實體資料目錄的絕對路徑，避免不同啟動來源讀取到不同的 AppData 副本。首次啟動會記錄實際路徑；指定的目錄不存在時停止啟動，避免建立另一份空白設定。搬移資料時應先結束程式，複製完整資料並核對內容，再修改此本機檔案。`CORTICO_COMPANION_DATA` 優先於此記錄，供隔離開發使用。路徑記錄與資料目錄均不納入 Git。

開始頁、使用導覽及進階模式的 ChatGPT 登入都共用 Electron 主程式的登入服務，端點識別保留為 `chatgpt-plan`。導覽沿用已儲存且仍可用的模型。帳號憑證不會寫入端點 `.env`，設定頁不接收授權 URL 或 token。

首次啟動會開啟開始頁。按 **Continue with ChatGPT**，在系統瀏覽器登入並授權使用訂閱額度。回到開始頁，選擇帳號可用的模型，再按 **測試連線並開始**。只有收到完整的 `response.completed` 才會顯示連線成功並開始運作。

選擇模型後立即儲存，離開頁面不會取消已提交的儲存。開始頁讀取此訂閱連線保存的模型，並同步其他視窗的修改。展開的模型清單由應用程式繪製，跟隨控制台配色；支援方向鍵、Home、End、Enter 與 Escape。主要按鈕使用配色指定的文字顏色，淺色背景上的文字會使用深色。

每次登入等待十五分鐘。若授權頁跳回時顯示本機連線被拒絕，請回到開始頁重新按 **Continue with ChatGPT**，使用新開啟的授權頁完成登入。

訂閱串流的 `response.metadata` 傳輸資訊不加入輸出或紀錄，也不視為完成回覆。最終摘要若省略已串流的輸出，連線層保留已驗證並完整結束的項目。未收到 `response.completed`、項目未完成或內容驗證失敗，都不會當作成功回覆或執行工具。

本版只使用經授權的 ChatGPT 訂閱憑證，不讀取 `OPENAI_API_KEY` 作為備援。訂閱限制會停止新的請求。確認額度恢復後，手動按測試連線重新開始。

額外 credits 由 ChatGPT 帳號設定控制。若只使用訂閱內含額度，請按管理用量，並在 ChatGPT 設定中關閉本應用程式的額外 credits 權限。本版不會自動開啟該權限。

登入憑證由 Electron 主程式以 Windows DPAPI 加密保存於資料目錄的 `chatgpt\session.enc`。不要將資料目錄加入版本控制、分享或搬到其他 Windows 帳號。程式不將登入憑證提供給設定頁、對話紀錄、作者的統計服務或 GitHub。

憑證與訂閱請求拒絕 HTTP 重新導向；解析失敗只提供固定錯誤訊息，不保存回應原文。取消登入不會提交尚未完成的憑證保存；登出會等待進行中的 refresh rotation，再撤銷最新的 refresh token。Core 在登出或授權停止時取消訂閱請求。若 Windows 加密不可用或 TLS 驗證被停用，登入會停止，不改存明文。

安全測試使用假的測試憑證、簽章 JWT 與本機 HTTP 伺服器，不使用真實帳號的 token。Windows DPAPI 的防護範圍不包含已取得同一 Windows 使用者權限的惡意程式。

習慣頁的電腦操作設定儲存後，會同步目前對話的工具清單與操作說明，並保留對話紀錄。離開頁面不會取消已提交的設定與同步。操作前詢問與同意有效期仍由電腦操作設定控制。

Windows 的「習慣 → 顯示 → 視窗互動 → 站在視窗頂端」預設開啟，跳上、躍下與攀爬共用此開關。可將內建桌寵拖到有足夠空間的一般視窗頂端放下；走動開啟時也會自行跳上，或走到可伸手觸及、未被遮住的側邊爬上。大肥魚交替伸手、抬腳，再翻上頂端，各配色共用動作。對話、語音聆聽、暫時安靜或關閉走動時不會開始攀爬，已開始的攀爬也會中止；途中可手動抓起。視窗移動時跟隨，縮小、關閉、遮住攀爬路線或移到其他螢幕時落回下方可支撐的邊緣。最大化與全螢幕視窗不當作落點。此功能只讀取視窗幾何與顯示狀態，不讀取標題或畫面、不移動其他視窗、不切換焦點，也不呼叫模型或要求開啟電腦操作。關閉設定後回到桌面底部的行為；重啟不保存視窗識別。

桌寵也會依走動設定先靠近視窗邊緣、蹲低，再向外躍下，落在路徑中第一個可支撐的較低視窗或桌面。側邊到螢幕邊界之間需要留有躍出空間。對話、聆聽、暫時安靜或關閉走動會取消起跳前的準備；已在空中則完成落地。視窗移動時跟隨，大小改變時重新靠近邊緣。

「原版更新」在應用程式開啟時每六小時檢查 GitHub 公開正式版。啟動時補做已到期的檢查；關閉程式期間不執行。手動檢查不會重新分析已有報告的版本。登入失效、額度不足或執行暫停時不會改用 API；新版本尚未開始分析時會等待可用的訂閱連線。已開始而失敗或中斷的分析不會自動重試，可在頁面手動重試並再次使用訂閱額度。若本機狀態損壞，版本追蹤先停用，避免遺失去重紀錄後自動重新分析。

分析使用 `chatgpt-plan` 已保存的模型，與目前對話所選端點分開。只傳送官方公開版本說明、基準 commit 到新版 tag 所解析 commit 的公開差異，以及程式內宣告的功能保留清單；不讀取私有原始碼、Git 憑證、個人資料或對話。公開 JSON 回應上限為 2 MB，模型輸入上限為 72,000 字元。GitHub 檔案上限、缺少 patch、輸入截斷、歷史分歧或無法取得 Cortico 子模組差異時，報告標示範圍限制。分析沒有執行工具，相容性仍需人工整合與執行測試驗證。用量紀錄以 `upstream-review` 分類，保存嘗試與計量資訊，不保存憑證或分析輸入。

桌寵連線且顯示於桌面、導覽未執行且未暫停時，提供「查看差異」、「想更新」、「暫不更新」。每版提醒一次，關閉後仍可在頁面查看；略過的版本不再提醒。想更新只保存本機需求，所有專屬功能預設保留；頁面可修改保留清單與本機備註，按「保存更新需求」後複製給 Codex。後續分析的「桌面互動與操作授權」包含視窗頂端跳上跳下、躍下前靠近邊緣與起跳重新驗證、側邊攀爬、大肥魚姿勢及中止條件，既有報告維持有效，不因此重新消耗訂閱額度。整合需求要求完成測試及憑證、私人資訊審核後，僅備份到自己的 fork，禁止向上游推送或提出 PR。本功能不安裝、合併或發佈更新。備註不傳給 GitHub 或分析模型。

報告、去重紀錄與整合需求保存在部署目錄 `home/companion/upstream/`：`state.json`、`reports/` 與 `requests/`。新的上游基準須由人工整合時一併修改 `core/personal-upstream.ts`，不能直接把專屬版版本號當作已整合基準。

統計回傳、自動下載與安裝更新皆停用。原專案與 Cortico 子模組的 push URL 維持停用。只允許將經審核的提交推送到自己的 fork，不向原專案提出 PR，不發佈套件、安裝包或診斷資料。沿用原專案的授權、作者標示、第三方聲明、測試與開發規範；CLA 依原專案 CONTRIBUTING.md 在未來提交 PR 時處理。

每次修改完成並通過必要檢查後，先審核待上傳的完整歷史、檔案與提交中繼資料中的登入憑證、API Key、Cookie、密文檔案、私人聯絡資料、本機使用者路徑、對話、截圖、紀錄及診斷資料，再備份到自己的 fork。此流程已有持續授權，不需逐次確認。發現疑慮先在本機修正並重新審核；無法排除時保留本機修改、暫停該次備份並回報原因。禁止向原專案推送或提出 PR。

主倉庫使用 `scripts/hooks/pre-push`：以 `git config core.hooksPath scripts/hooks` 安裝。每次推送前審核完整的待上傳歷史、檔案與提交中繼資料，確認未包含真實憑證、個人資料、建置產物、診斷或本機審核報告，並使用 GitHub noreply 信箱。審核後，將目的 URL、完整分支 ref 與 commit 分別保存在本機 Git 配置 `personal.backupUrl`、`personal.backupRef`、`personal.reviewedCommit`。Hook 僅接受名為 `backup` 的遠端及完全相符的目的地、分支與提交；新提交必須重新審核。Git 配置與舊的私人歷史不會隨公開分支上傳。

開發驗證使用 `CORTICO_COMPANION_DATA` 指向新的空資料目錄，再執行 `pnpm run dev`。不要使用原版已安裝的資料測試。完整檢查為 `pnpm run build:cortico`、`pnpm run typecheck`、`pnpm run typecheck:web`、`pnpm run typecheck:worlds`、`pnpm run test`、`pnpm run test:worlds`。Windows 安裝包使用 `pnpm run build:installer` 產生，打包命令固定使用 `--publish never`。

OpenAI 官方契約：

- [登入與授權](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [模型與訂閱請求](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [目前支援限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [用量與憑證管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
