# 狀態

本檔記 w-canvas 各功能之**現況**(做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證之版本);只記現況、不寫過程(過程見 `sgud/exp/experience.md`).

本檔 2026-11-01 新建.

## 取得並載入 node-canvas `WCanvas`

- 現況: 已實作(僅 win32-x64;package.json version 1.0.0 之工作樹,未發布、未提交):`src/WCanvas.mjs`(預設匯出 `WCanvas(opt)`,掛 `WCanvas.ensureBins`)、`src/ensureBins.mjs`(轉呼叫 wsemi 1.9.38 `fsEnsureBins`,tgz 檔案組)、`src/placeBins.mjs`(把 45 檔放進 canvas 套件之 `build/Release`)、`bin/manifest.json`(官方預建檔 `canvas-v3.2.3-napi-v7-win32-x64.tar.gz`,45 成員)、`toolg/genBinManifest.mjs`(產生清單並以 GitHub release API digest 核對)、`toolg/gDistRollup.mjs`(UMD;標準寫法 `'./src'`、`'./dist'` 相對 cwd,依 dspec〈自有套件之發布與建置腳本〉,2026-11-02 起)、`g.mjs`(範例)、README.
- 規則: `sgud/rule/rulebook.md` R-BIN-EXE-01、R-CANVAS-PLACE-01、R-CANVAS-API-01、R-CANVAS-VER-01.
- 測試: `test/unit-binManifest.test.mjs`(清單、套件設定、README、忽略規則、`npm pack --dry-run`、src 無自寫下載)、`test/unit-WCanvas.test.mjs`(假組與假 canvas:opt K3、平台分支、放置與修補、版本、離線、鏡像壓縮檔、`placeBins` 各錯誤)、`test/unit-dist.test.mjs`(以副本並指定 cwd 執行 `toolg/gDistRollup.mjs`,驗建出之 dist:產物存在、匯出、external 之 `require`/`define`/全域三分支,與裝在專案內之使用)、`test/api-WCanvas.test.mjs`(真實官方資產,連網一次:首次下載、第二次快取、離線與鏡像、鏡像竄改、3 行程同時首次 ×3 輪、快取竄改、build/Release 竄改、真實 E_BIN_LOCKED、預取、UMD 配真 canvas、預設快取位置).指令 `npm test`(56 案,mocha --parallel).
- 驗證: 2026-11-01 全套連跑 4 次皆綠(55、55、55、56 案〔末次含 UMD 配真 canvas 案〕,各約 30 秒);變異 22 項皆被殺(M22 為單組清單下之等價變異,預期存活);細節見主控任務 20261031175415 `agent-out/wcanvas-修正報告.md`.未經第三方外審(本輪未列外審).
- 建置驗證(2026-11-02): 於套件根依 `script.txt` 實跑 `cleanFolder` → jsdoc → `gDistRollup`,`dist/w-canvas.umd.js`(94301 位元組)與 `.map`(114886 位元組)之 sha256 與改前逐位元組相同,匯出 `ensureBins`,外部 `require` 為 8 個 Node 內建模組;`docs/` 重產,僅頁尾產生時間不同.`unit-binManifest` 之 npm 包內容案已依 dspec〈自有套件之npm發布範圍〉原則 4 改為要求 `sgud/` 隨包發布(與工作樹 `.npmignore` 不列 `sgud` 一致),規則帳本 R-BIN-EXE-01 第 2 點同步.
- npm 包檢查(2026-11-02,pk-canvas 修正輪): `unit-binManifest` 之 npm 包內容案依 dspec〈自有套件之npm發布範圍〉原則 2〈套件測試之 npm 包檢查〉①②改正——大小上限由整包 tarball(1085739 位元組,含 `docs/` 而超過 1MB,原斷言紅)改為只計 `src/`、`dist/`、`bin/`(6 檔 244103 位元組、最大 114904;總和 < 1MB、單檔 ≤ 500KB),不得入包增列 `.env`,並斷言 `sgud/`、`test/tools/` 之 git 版控檔逐一隨包;`.npmignore` 改為首段逐行抄錄 `.gitignore`、其後只加註「第 1 條」之 `/bin/*`、`!/bin/manifest.json`(打包清單與改前相同,73 檔).規則帳本 R-BIN-EXE-01 第 2、2a 點.全套 56 案綠.
- 待辦: 主控刪除建議檔 `建議新增w-canvas.md`、首次提交與發布(`dist/` 與 `docs/` 由 `script.txt` 流程產製,工作樹無);下游使用端(5 處)、使用端(1 處)改為 `await WCanvas()`.
- 已知缺口: 見規則帳本各條〈已知限制〉(只有 win32-x64;換版時舊 canvas.node 被載入則 `E_BIN_LOCKED`;行程被殺可遺留 `*.tmp`).
