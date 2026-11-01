# w-canvas
A package for node-canvas (the official `canvas` package) that gets its native files on first use.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-canvas.svg?style=flat)](https://npmjs.org/package/w-canvas) 
[![license](https://img.shields.io/npm/l/w-canvas.svg?style=flat)](https://npmjs.org/package/w-canvas) 
[![npm download](https://img.shields.io/npm/dt/w-canvas.svg)](https://npmjs.org/package/w-canvas) 
[![npm download](https://img.shields.io/npm/dm/w-canvas.svg)](https://npmjs.org/package/w-canvas) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-canvas.svg)](https://www.jsdelivr.com/package/npm/w-canvas)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-canvas/global.html).

## Core
> `w-canvas` runs in `Windows x64` (win32-x64) in this version.

> npm 12 does not run the install script of `canvas` (`prebuild-install`) by default, so after `npm i canvas` the file `build/Release/canvas.node` is missing and `require('canvas')` fails. `npm i w-canvas` therefore shows a warning that the install script of `canvas` is blocked: this is expected and harmless, `w-canvas` does not need that script. On first use `w-canvas` downloads the official prebuilt files of node-canvas from GitHub, verifies them against `bin/manifest.json` (SHA-256 and size of every file), puts them into the `build/Release` folder of the `canvas` package, and then loads `canvas`; see [External files](#外部執行檔).

> The prebuilt files must be of the same version as the JavaScript of `canvas`, so `w-canvas` pins `canvas` to the exact version `3.2.3`. The official `canvas` package is used as it is (not modified, not copied).

## Installation

### Using npm(ES6 module):
```alias
npm i w-canvas
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-canvas/blob/master/g.mjs)]
```alias
import fs from 'fs'
import WCanvas from 'w-canvas/src/WCanvas.mjs'

async function test() {

    //WCanvas, 首次調用時下載並校驗官方預建檔，複製到canvas套件後載入，回傳canvas之匯出
    let { createCanvas, loadImage, registerFont } = await WCanvas() // eslint-disable-line no-unused-vars

    //畫一個藍色矩形與中英文字
    let canvas = createCanvas(240, 80)
    let ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 240, 80)
    ctx.fillStyle = '#1976d2'
    ctx.fillRect(10, 10, 60, 60)
    ctx.fillStyle = '#000'
    ctx.font = '24px sans-serif'
    ctx.fillText('測試 canvas', 80, 48)

    //輸出PNG
    let buf = canvas.toBuffer('image/png')
    fs.writeFileSync('./test-canvas.png', buf)
    console.log('size', buf.length > 0)
    // size true

    //loadImage
    let img = await loadImage(buf)
    console.log('wh', img.width, img.height)
    // wh 240 80

    fs.unlinkSync('./test-canvas.png')
}
test()
    .catch((err) => {
        console.log('catch', err)
    })
```

`WCanvas()` returns the exports of `canvas` as they are, so replace `import { createCanvas, loadImage } from 'canvas'` by `let { createCanvas, loadImage } = await WCanvas()` (top-level `await` is available in `.mjs`). It can be called many times: later calls take the files from the cache and skip the files already in place.

## 外部執行檔

本套件執行時需要下列官方預建檔(node-canvas 之 `canvas.node` 與其相依之 44 個 dll,共 45 個檔,皆為執行所需;不含建置中繼檔),不含於 npm 包:

| 檔案組 | 用途 | 來源 |
|---|---|---|
| canvas(`canvas.node` 與 44 個 dll) | node-canvas 之原生核心(Cairo、Pango、librsvg 等) | `https://github.com/Automattic/node-canvas/releases/download/v3.2.3/canvas-v3.2.3-napi-v7-win32-x64.tar.gz`(官方版本標籤之資產,15,235,616 位元組) |

- 為何要下載:npm 12 預設不執行 `canvas` 之安裝腳本(`prebuild-install -r napi || node-gyp rebuild`),`npm i` 時會警告被擋下(預期如此,與本套件無關,不必也不應為此設定 `allowScripts`),`build/Release/canvas.node` 因而不存在。本套件改在首次使用時依 `bin/manifest.json`(釘選版本標籤網址,逐檔記有 SHA-256 與大小)取得官方預建檔並校驗,安裝時不下載。npm 11 以前之安裝仍會執行 `canvas` 自己之安裝腳本,其所得 `build/Release` 內之檔與清單相符者略過、不符者(如自行編譯所得)會被官方預建檔取代。
- 首次呼叫 `WCanvas()`(或預先呼叫 `WCanvas.ensureBins()`)時:下載官方預建檔(約 15 MB)→ 解出 45 個檔並逐檔以 SHA-256 與大小校驗 → 整組存於快取 `<套件根>/bin-cache/<組識別>/build/Release/`;`WCanvas()` 再把這 45 個檔複製到 `canvas` 套件(以 `require.resolve('canvas/package.json')` 所在)之 `build/Release`:已存在且雜湊相符者略過,否則先寫入同資料夾之暫存檔、驗證後再更名覆蓋(不會讀到半檔,多個行程同時首次呼叫皆可成功),最後載入 `canvas`。之後自快取取得(亦校驗),`build/Release` 內之檔被竄改或缺漏時下次呼叫即補正。
- 環境變數:
  - `W_BIN_CACHE=<資料夾>`:快取改放 `<資料夾>/w-canvas/`(套件所在之 `node_modules` 唯讀時使用,多套件可共用同一資料夾)。注意複製目標 `canvas` 套件之 `build/Release` 仍須可寫(首次呼叫時);唯讀部署請於建置映像時先呼叫一次。
  - `W_BIN_MIRROR=<資料夾或 http(s) 網址>`:內網鏡像,先找鏡像再連 GitHub;結構為 `<鏡像>/w-canvas/<組識別>/build/Release/<檔>`(或壓縮檔 `<鏡像>/w-canvas/<sha256>/canvas-v3.2.3-napi-v7-win32-x64.tar.gz`)。鏡像之檔同樣以清單校驗,不符即不用。
  - `W_BIN_OFFLINE=1`:不連網,只用快取與鏡像;缺檔時錯誤(`E_OFFLINE_MISSING`)會列出缺哪些檔、sha256、大小與應放之完整路徑。
- 離線部署:
  1. 在可連網之電腦設 `W_BIN_CACHE=<空資料夾>`,呼叫 `WCanvas.ensureBins()` 一次(只取至快取,不放置;亦不檢查作業系統)。
  2. 把該資料夾整個帶到內網電腦,設 `W_BIN_MIRROR=<該資料夾>`(全離線時另設 `W_BIN_OFFLINE=1`)。
- 支援平台:本版只支援 `win32-x64`。其他平台若 `canvas` 自身之 `build/Release/canvas.node` 已存在(例如自行編譯),`WCanvas()` 直接載入它(不下載、不放置);否則 reject `E_PLATFORM`。
- 版本綁定:預建檔須與 `canvas` 之 JavaScript 同版,本套件之 `dependencies` 釘選 `canvas` 之確切版本(目前 `3.2.3`),升版時 `canvas`、`bin/manifest.json` 一起改。已安裝之 `canvas` 版本與清單不同(例如專案以 `overrides` 強制其他版本)時 reject `E_VERSION`。
- Windows 換版注意:`canvas.node` 與其 dll 被行程載入後無法覆蓋。本套件換版(清單內容不同)後,須先結束所有已載入舊版 `canvas` 之行程(node 服務、pm2、排程等)再呼叫,否則 reject `E_BIN_LOCKED`,訊息寫明被占用之檔與處置;已載入之行程不受影響。
- 錯誤皆為帶 `code` 之 Error:`E_PLATFORM`、`E_CANVAS_MISSING`(找不到 `canvas` 套件)、`E_VERSION`、`E_BIN_LOCKED`、`E_COPY`(無法寫入 `canvas` 套件資料夾)、`E_CANVAS_LOAD`(放置後載入 `canvas` 失敗),以及取得預建檔時之 `E_OFFLINE_MISSING`、`E_HASH_MISMATCH`、`E_SIZE_MISMATCH`、`E_EXTRACT`、`E_MANIFEST`、`E_ARG`、`E_NETWORK`、`E_HTTP`、`E_TIMEOUT` 等。
- 其他選項(皆為 `WCanvas(opt)`):`cacheDir`、`mirror`、`offline`、`fetch`、`onProgress`、`onTrace`、`maxAttempts`、`retryDelayMs`、`stallMs`、`totalMs`(轉給 wsemi 之 `fsEnsureBins`),`debug`、`funLog`(非預期之 `opt` 值改用預設,`debug: true` 時警告),詳見 [docs](https://yuda-lyu.github.io/w-canvas/global.html)。
