# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## R-BIN-EXE-01 官方預建檔(檔案組 canvas)之存放、取得、校驗與離線一律依制式規格(廠商檔,釘選版本標籤)

- 依據: 制式規格 `C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`(以下「規格」,條號 S/M/D/O/E/T 為其條號);使用者 2026-11-01 定案新增本套件(Gitea #32,cgsmdb 提出):canvas 3.2.3 之安裝腳本被 npm 12 擋下,`build/Release/canvas.node` 不存在,比照 w-ffmpeg 等於執行階段經 wsemi `fsEnsureBins` 取得並校驗官方預建檔,**載入方式採方案①**(複製到 canvas 套件之 `build/Release` 再載入官方 npm 之 canvas).**規格為上游真理源,本條只記本套件須長成什麼樣**;與規格不一致時以規格為準並回報主控.
- 單一擁有者: 取得一律經 `src/ensureBins.mjs`(轉呼叫 wsemi `fsEnsureBins`,`pkgRoot` 固定為本套件根,不轉傳 `floatingManifestUrl`);下載、快取、鏡像、校驗、tgz 解出與離線全由 wsemi 負責(需 wsemi ≥ 1.9.38,tgz 自該版起).**套件端不得自寫下載、快取、鏡像、校驗、解壓**(E2).
- 規則:
  1. 清單 `bin/manifest.json`(`mode: "pinned"`、無 `commit`:只有廠商檔,無 repo 內之檔)一律由 `toolg/genBinManifest.mjs` 依官方預建檔之實際內容產生,不手寫 sha256(M1);頂層 `version` 為內附預建檔之版本(= canvas 版本);檔案組 `canvas`(M6)含 1 個壓縮檔(`url` 為官方版本標籤之資產網址,非 `releases/latest`,S3/M2;`extract.type` 為 `tgz`)與其 45 個成員(`build/Release/canvas.node` 與 44 個 dll,逐檔 sha256 與大小);**建置中繼檔**(`binding.sln`、`canvas.vcxproj`、`.filters`、`config.gypi`)與執行無關,不列入.壓縮檔之雜湊以 GitHub release API 公告之 asset digest 核對(M3,工具自動核對,取不到才於 note 載明「首次下載自算」).
  2. 預建檔不入 git、不入 npm 包(本套件 repo 不鏡像,S3);npm 包 `bin/` 下只有 `bin/manifest.json`(S1):`.npmignore` 為 `/bin/*`、`!/bin/manifest.json`、`/bin-cache/`、`/test/_tmp/`、`sgud`、`CLAUDE*.md`;`.gitignore` 含 `/bin-cache/`、`test/_tmp`、`CLAUDE*.md`(不得加 `!CLAUDE.md`,也不得排除 `sgud`);`.gitattributes` 為 `bin/** binary`.
  3. 首次使用時下載(D1);**不得**有 `postinstall`/`install`/`preinstall`/`prepare`.npm 12 擋下 canvas 之安裝腳本為預期,README 已說明,不要求使用端設 `allowScripts`.
  4. 離線與內網依規格 O1~O5:`W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE` 由 wsemi 統一讀取;README〈外部執行檔〉為對使用者之說明(O5).鏡像可放解出後之整組 `<鏡像>/w-canvas/<組識別>/build/Release/<檔>` 或壓縮檔 `<鏡像>/w-canvas/<壓縮檔 sha256>/canvas-v<版>-napi-v7-win32-x64.tar.gz`(兩種皆有測試).
  5. `ensureBins` 為 `src/ensureBins.mjs` 之預設匯出,並掛於 `WCanvas.ensureBins`(主檔 UMD 為 `module.exports = 函數`,不可改為具名匯出);`WCanvas.ensureBins` **只取至快取,不放置,也不檢查作業系統**(連網機器可為離線部署預備鏡像,規格 O4).
  6. UMD 建置(`toolg/gDistRollup.mjs`)須把 `url`、`crypto`、`stream`、`stream/promises`、`child_process`、`module`、`fs`、`path` 列為 external 與 globals;canvas 以絕對路徑動態載入,不經模組名稱,故不列入;套件根以 `import.meta.url` 推得,`dist/` 與 `src/` 皆須位於套件根之下一層.
- 盤點指令: Grep `src/` 搜 `fsDownloadFile|fsMergeFiles|w-zip|fetch\(|github\.com|child_process|tar\.exe`(應無命中,測試 `unit-binManifest` 內有同判準);`node C:/opensrcOper/tools/scan-bins.mjs --only w-canvas`(主控工具,應為 OK);`npm pack --dry-run`(`bin/` 下只見 `bin/manifest.json`).
- 站點全集與判準(2026-11-01): 取得入口只有 `src/ensureBins.mjs` 一處(`src/WCanvas.mjs` 經它).
- 已知限制: ①快取夾(預設 `<套件根>/bin-cache/<組識別>/`)須可寫(首次取得時),`node_modules` 唯讀之部署設 `W_BIN_CACHE`;但放置目標 canvas 套件之 `build/Release` 同樣須在首次呼叫時可寫(見 R-CANVAS-PLACE-01);②信任假設同規格 D6;③清單之 `extract.files` 只列 45 個執行檔,壓縮檔內之建置中繼檔不解出;④本版只有 win32-x64 一組,日後加他平台時於清單新增組(組名須含平台,`WCanvas` 依平台挑組)並調整 R-CANVAS-API-01.
- 測試: `test/unit-binManifest.test.mjs`(M1/M2/M3/M6、45 成員、fsEnsureBins schema、版本三處同步、D1/E2、README O5、S5、T1 先放誘餌檔)、`test/api-WCanvas.test.mjs`(真實官方資產:首次下載、第二次快取、離線與鏡像、竄改、預取)、`test/unit-WCanvas.test.mjs`(假組:鏡像壓縮檔).T8(主幹模式)不適用.

## R-CANVAS-PLACE-01 放置步驟:把檔案組複製到 canvas 套件之 build/Release(單一擁有者 `src/placeBins.mjs`)

- 依據: canvas 之 `lib/bindings.js` 寫死 `require('../build/Release/canvas.node')`,只從 canvas 套件目錄載入;Windows 下 Node 載入 `.node` 時同資料夾之 dll 可被找到.建議檔 `建議新增w-canvas.md` 之 2(b)①.
- 規則:
  1. 目標為 `<canvas 套件資料夾>/<清單路徑>`(`build/Release/<檔>`),canvas 套件資料夾為 `require.resolve('canvas/package.json')` 所在(以 `src/WCanvas.mjs` 為基準,與載入者同一資料夾:載入用 `require(該資料夾之 index.js 之絕對路徑)`,見 R-CANVAS-API-01 第 3 點).
  2. 每檔: 目標為一般檔案(非連結)且大小與 SHA-256 皆符合者略過(本行程內以檔案識別〔dev、ino、大小、mtime、ctime〕+ sha256 記憶,識別未變不重複雜湊);否則 `copyFile`(`COPYFILE_EXCL`)到同資料夾之 `<目標>.<pid>-<亂數>.tmp`,**驗證該暫存檔(即將發布者)之大小與 SHA-256**,再 `rename` 覆蓋(原子,不讀到半檔).失敗時刪除暫存檔.
  3. `rename` 回報 EPERM/EBUSY/EACCES 時重試(預設 5 次,間隔 100ms×次序;防毒掃描新檔之暫態);重試後仍被拒:若目標此時已相符(他程序剛放妥並載入)視為成功(`exists`);否則目標存在 → `E_BIN_LOCKED`(訊息寫明目標、錯誤碼、原因〔被其他程序載入之 DLL 鎖,或唯讀〕、處置〔結束載入 canvas 之行程〕);其餘 → `E_COPY`(訊息提示 canvas 套件資料夾須可寫).暫存檔驗證不符 → `E_HASH_MISMATCH`.
  4. 放置順序: dll 先、`.node` 最後(中途失敗不留下有 canvas.node 而缺 dll 之狀態).
  5. 同行程內同一 canvas 資料夾之併發呼叫共用同一次放置(`inflight`);跨行程靠暫存檔 + 原子更名 + 第 3 點之「已相符視為成功」.
  6. 不動 build/Release 內清單以外之檔.
- 已知限制: ①換版(清單內容不同)時,舊版 canvas.node 若仍被他行程載入則 `E_BIN_LOCKED`,須先結束之(README 已寫);②行程於複製中途被殺,同資料夾會遺留 `*.tmp`(不影響載入,下次呼叫不清理,可手動刪);③本套件不負責還原被覆蓋之自行編譯 canvas.node(win32-x64 下一律以官方預建檔為準).
- 盤點指令: Grep `src/` 搜 `writeFile|copyFile|rename` 確認只有 `placeBins.mjs` 寫入 canvas 資料夾.
- 測試: `test/unit-WCanvas.test.mjs`(放置、修補、暫存檔更名、E_HASH_MISMATCH、已相符視為成功、E_BIN_LOCKED〔唯讀檔模擬〕、重試、E_COPY、行程內共用),`test/api-WCanvas.test.mjs`(真實 45 檔:首次、第二次、build/Release 竄改修補、3 行程同時首次 ×3 輪、真實載入中 canvas.node 之 E_BIN_LOCKED 與結束後可覆蓋).

## R-CANVAS-API-01 入口 `WCanvas(opt)`:流程、回傳、錯誤碼與 opt 檢測

- 依據: 建議檔之 4;輸入參數之檢測機制(dspec,K3/V4/V5/V7/V8);全域 §5.2.
- 規則:
  1. 預設匯出 `WCanvas(opt = {})`(async),另掛 `WCanvas.ensureBins`;主檔不加具名匯出.
  2. 流程: `parseOpt` → 平台檢查(`canvas-platform` 事件)→ 解析 canvas 套件 → [不支援之平台:自行編譯之 `build/Release/canvas.node` 存在則直接載入,否則 `E_PLATFORM`,皆不下載] → [`E_CANVAS_MISSING`] → `ensureBins({...fwd, names:'canvas'})` → 版本核對(`E_VERSION`,清單頂層 `version` 對 canvas 套件 `package.json` 之 `version`)→ 放置 → 載入.
  3. 載入與回傳: 以 `createRequire(import.meta.url)` 取得之 `require(<canvas 套件之 index.js 絕對路徑>)` 載入(與放置檔案者為同一資料夾),回傳其 `module.exports` 本身(原樣,非複本或命名空間).**不用 `import()`**(使用者原案寫「動態 `import('canvas')`」,2026-11-01 實測 Node 24:CommonJS 檔經 `import()` 載入失敗後,修正再 `import()` 同一網址仍得同一個失敗〔ESM 快取失敗之模組記錄〕,`require` 則於失敗時自快取移除、可重試;載入失敗〔如缺 VC 執行階段〕之修正後須能在同行程重試).
  4. 支援平台: `process.platform === 'win32' && process.arch === 'x64'`(`opt.platform`/`opt.arch` 可注入,僅供測試).
  5. 錯誤碼: `E_PLATFORM`、`E_CANVAS_MISSING`、`E_VERSION`、`E_BIN_LOCKED`、`E_COPY`、`E_HASH_MISMATCH`(放置步驟)、`E_CANVAS_LOAD`(放置後載入失敗,含 `cause`);取得步驟之 code 原樣沿用 wsemi(`E_OFFLINE_MISSING`、`E_HASH_MISMATCH`、`E_SIZE_MISMATCH`、`E_EXTRACT`、`E_MANIFEST`、`E_ARG`、`E_NETWORK`、`E_HTTP`、`E_TIMEOUT`…).一律 reject 帶 `code` 之 Error.
  6. opt 檢測(K3/V7/V8): opt 非一般物件視為 `{}`;自用之鍵 `debug`(布林,非布林視為 false)、`funLog`(函數,否則 console.warn)、`platform`、`arch`(非空原始字串,否則取預設)給了而非預期者視為未給;`debug: true` 才警告,警告為固定詞彙、不含傳入之值,同一原因每個行程一次;未宣告之鍵忽略;轉傳之鍵為白名單(`cacheDir`、`mirror`、`offline`、`fetch`、`onProgress`、`onTrace`、`maxAttempts`、`retryDelayMs`、`stallMs`、`totalMs`),其中回呼型(`fetch`、`onProgress`、`onTrace`)給了而非函數視為未給,其餘由 wsemi 檢測(型別不符 `E_ARG`,**不靜默改用預設**:`offline` 給了字串而被忽略會使離線部署誤連網,2026-11-01 決定);`pkgRoot`、`floatingManifestUrl`、`names` 不轉傳.
  7. `onTrace`: 沿用 wsemi 之 `getTrace`;除 wsemi 之事件外另有 `canvas-platform`、`canvas-place`、`canvas-placed`、`canvas-load`(欄位見 JSDoc).
- 已知限制: ①`canvas` 套件之 `build/Release` 內若為使用者自行編譯之 canvas.node,win32-x64 下會被官方預建檔取代(或因被載入而 `E_BIN_LOCKED`);②本套件為 Node 專用(UMD 亦只 `require` Node 內建模組與以絕對路徑載入 canvas),不支援瀏覽器.
- 測試: `test/unit-WCanvas.test.mjs`(opt、平台分支、錯誤碼、E_CANVAS_LOAD 後同行程重試、回傳 module.exports 本身)、`test/api-WCanvas.test.mjs`(真實載入與出圖、UMD 配真實 canvas)、`test/unit-dist.test.mjs`(UMD 建置).

## R-CANVAS-VER-01 預建檔與 canvas 之 JS 同版(三處同步)

- 規則: `package.json` 之 `dependencies.canvas`(**確切版本**,非範圍)、`bin/manifest.json` 頂層 `version`、清單內壓縮檔網址之版本標籤 `v<版本>` 三者必須相同(`unit-binManifest` 比對);升 canvas 版本時:改 `package.json` → `node toolg/genBinManifest.mjs`(自動核對 GitHub digest,重算 45 成員)→ 看成員數是否仍為 45(不是則同步改測試與本帳本)→ `npm i` → 全套測試 → 發布;已安裝之 canvas 版本與清單不同時 `E_VERSION`.
- 測試: `test/unit-binManifest.test.mjs`(版本三處同步、已安裝版本)、`test/unit-WCanvas.test.mjs`(E_VERSION).

## 變更紀錄

- 2026-11-01 新建(w-canvas 1.0.0 工作樹,未發布):`bin/manifest.json`、`src/WCanvas.mjs`、`src/ensureBins.mjs`、`src/placeBins.mjs`、`toolg/`、測試 4 檔與 `test/tools/`、README 等.
