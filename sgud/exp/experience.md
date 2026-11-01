# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 2026-11-01 建立本套件(w-canvas 1.0.0)時之經驗

- **官方預建檔之取得**: GitHub release API(`GET /repos/Automattic/node-canvas/releases/tags/v<版>`)之 `assets[].digest`(`sha256:<64>`)與 `size` 可核對官方資產,`toolg/genBinManifest.mjs` 即用它(規格 M3);官方 `win32-x64` 資產內 49 項,執行所需為 `build/Release/canvas.node` 與 44 個 dll 共 45 項,另 4 個建置中繼檔(`binding.sln`、`canvas.vcxproj`、`.filters`、`config.gypi`)不列入.prebuild-install 預設檔名含 `unknown`(`…-win32-unknown-x64`)者 404,實際資產名為 `…-win32-x64.tar.gz`.
- **wsemi `fsEnsureBins` 對檔案組之回傳**(1.9.38): 結果 `{ canvas: <組資料夾> }`,不可列舉屬性 `bundles.canvas.files[組內路徑]` 為各檔絕對路徑、`entries.canvas.archives[].extract.files[]` 為各檔 `{ path, sha256, size }`(本次採用之清單項,放置步驟即以它為雜湊來源)、`manifest.version` 為清單頂層 version;事件 `publish` 之 result 為 `placed`/`replaced`/`exists`.快取位置: 選項 `cacheDir=X` → `X/<組識別>/…`;環境變數 `W_BIN_CACHE=X` → `X/<套件名>/<組識別>/…`(此即鏡像結構,故 `W_BIN_CACHE` 之資料夾可直接作 `W_BIN_MIRROR`).手備鏡像放壓縮檔: `<鏡像>/<套件名>/<壓縮檔 sha256>/<檔名>`(有測試).
- **Windows 之 DLL 鎖(實測)**: 已被行程載入之 `canvas.node` 以 `rename` 覆蓋回報 `EPERM`(真實案:`api-WCanvas` 之 E_BIN_LOCKED 案,持有者結束後即可覆蓋);唯讀屬性之檔 `rename` 覆蓋亦回報 `EPERM`,單元測試以此模擬(`fs.chmodSync(fp, 0o444)`).Windows 下載入過 canvas 之行程不結束,`test/_tmp` 內該假套件根就刪不掉,故真實載入者一律在子行程,持有者以 `release()` 關 stdin 結束.
- **ESM 載入 CommonJS 失敗不重試(實測 Node 24)**: `import(fileUrl)` 載入執行時拋錯之 CJS 檔,修正(補上缺檔)後再 `import()` 同一網址仍得同一個失敗;`require` 則失敗時自模組快取移除、可重試.故 `WCanvas` 以 `createRequire` 載入 canvas(使用者原案寫 `import('canvas')`,此為有意偏離,見規則帳本 R-CANVAS-API-01 第 3 點).
- **子行程與 stdin**: 父行程以管線開著 stdin、子行程只 `process.stdin.pause()` 並不會使其結束(3 行程同時首次呼叫案曾逾時 170 秒);收到放行訊號後須 `process.stdin.destroy()`.以 READY/HOLD 輸出行與 `go()`/`release()` 做事件閘門,不以等待毫秒同步(`test/tools/child.mjs`).
- **測試夾具**: 假套件根(複製 `src/`、清單、`node_modules/canvas`)建在 `test/_tmp/<案名>-<序>/`,位於 repo 之下,裸引入(wsemi、canvas)沿用 repo 之 `node_modules`,不需連接點;真 canvas 之 JS 僅約 500 KB(不含 `build/`)可複製.「canvas 找不到」無法在 repo 之下造出(上層 `node_modules` 會找到),以暫時攔截 `Module._resolveFilename` 模擬(呼叫之同步段即解析,隨即還原).單獨以 `--grep` 跑依賴官方資產快取之 api 案時,由 `ensureSeed()` 連網預取一次.本機環境變數 `W_BIN_*` 可能影響結果,測試一律明給 `cacheDir`/`mirror`/`offline` 或於子行程明設(`undefined` 為自繼承環境移除).
- **變異證明之作法**: 於 `tmp/wcanvas/mut/<編號>/` 複製 `src/test/bin/toolg` 並套用單一字串替換,以 mocha 跑指定測試檔(副本在 repo 之下,裸引入沿用 repo 之 `node_modules`),不改 repo 之 src;設定類(`.npmignore`、`gDistRollup.mjs`、清單雜湊)以暫時編輯 + 還原後比對 sha256.單組清單下 `names: 'canvas'` 為等價變異(存活),日後清單多組時才有作用.
