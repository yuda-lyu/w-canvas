# 回饋

本檔記錄任務中發現之他套件、全域技能、全域設定之調整建議(只是紀錄與提案,實際修改走全域設定 §5.2、§13,不在本套件自行改).一條一列:日期、類別、對象、內容、依據.

| 日期 | 類別 | 對象 | 內容 | 依據 |
| --- | --- | --- | --- | --- |
| 2026-11-18 | 自有套件 | w-canvas(本套件,待另案) | 本輪只改了因 wsemi 1.9.64 之 `E_OFFLINE_MISSING` 訊息不帶值而紅之測試;本套件自組之錯誤訊息仍帶路徑、sha256、版本值(`src/placeBins.mjs` 之 `E_HASH_MISMATCH`、`E_BIN_LOCKED`、`E_COPY`,`src/WCanvas.mjs` 之 `E_VERSION`、`E_CANVAS_LOAD`、`E_PLATFORM`),依〈輸入參數之檢測機制〉V20 應改為只含名稱與處置、值放結構欄位(`file`、`target`、`cause` 等已有);因其測試現為綠且斷言訊息含路徑(`test/unit-WCanvas.test.mjs` 之 E_BIN_LOCKED、E_VERSION、E_CANVAS_LOAD 案,`test/api-WCanvas.test.mjs` 之 E_BIN_LOCKED 案),屬行為變更,未於本輪改,待主控另案排程 | `src/placeBins.mjs:113,128,130`;`src/WCanvas.mjs:149,248,260`;上列測試之 `err.message.includes(` 斷言 |
