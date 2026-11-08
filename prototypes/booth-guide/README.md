# 攤位導引圖原型

本機製卡頁，使用目前 staged 的活動資料與既有 `AccessibleEventMapRenderer`。這個入口不在正式 Pages build 的輸入中，也未接入社團工作區。

```powershell
npm ci
# 新 checkout 先準備測試資料；已有 staged 資料時略過。
npm run data:stage -- --fixture
npm run dev:booth-guide
```

開啟 http://127.0.0.1:4182/prototypes/booth-guide/ 。驗看已 pin 的活動，可先依本機開發 runbook 執行該活動的 `data:fetch` 與 `data:stage`，再啟動伺服器。

選日期、場地及攤位，加入本機 JPG／PNG／WebP，選入口並沿走道點選轉彎點。可拖曳轉彎點、退一步、清除；手動畫的路線只用於這張卡。切換日期、場地或攤位會開始一張新卡。沒有自動尋路、公尺換算或草稿保存。

預設為 4:5（1080 × 1350）直式，另支援橫式、正方形、文字、配色、圖片完整顯示／裁切、路線範圍放大，以及圓點／箭頭動畫。放大時保留路線周邊的攤位排號，入口名稱與目的攤位另外加大標示。QR Code 放在地圖區角落，避開路線、攤位、入口與標籤；四角都擁擠時，在地圖卡內讓出空間。PNG 使用卡片原始尺寸；GIF 最長邊 900 px、每秒約 12 格、3／4／6 秒循環，最後五分之一停在終點。QR Code 連到正式站對應日期／場地／攤位；測試 fixture 沒有正式站頁面。

預覽和兩種匯出共用 `drawCard`。PNG／GIF 在瀏覽器產生，不上傳選取圖片、不呼叫分享 API，不改官方地圖或個人行程。GIF 編碼器 `gifenc` 僅供這個原型入口動態載入。

```powershell
npm run build:booth-guide
npx tsc --noEmit --incremental false
npx eslint prototypes/booth-guide
node --test prototypes/booth-guide/card.test.mjs
```

獨立建置結果放在忽略版控的 `.tmp/booth-guide-dist`。正式接入前仍需補上既有入口、三語文案及對應 CI；本頁供確認功能與操作方式。
