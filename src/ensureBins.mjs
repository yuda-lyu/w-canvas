import path from 'path'
import { fileURLToPath } from 'url'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'


//pkgRoot, 本套件根目錄(以本檔位置推得, 不依賴工作目錄; src/與dist/皆位於套件根之下一層)
let pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')


/**
 * 取得本套件之外部執行檔: 檔案組canvas(官方預建檔之canvas.node與其44個dll, 共45檔)
 *
 * 首次使用時下載(或自鏡像取得)官方預建檔(tar.gz)，解出後逐檔以bin/manifest.json之SHA-256與大小校驗，整組原子放入快取，之後自快取取得(亦校驗，一檔不符即整組重取)，安裝時不下載
 * 規格: 外部執行檔之存放下載校驗與離線(制式規格)§6、M6; 實作為wsemi之fsEnsureBins, 本套件不另寫下載、快取、鏡像、校驗與解壓
 * 快取預設於本套件根目錄之bin-cache/(與當前工作路徑無關), 環境變數: W_BIN_CACHE、W_BIN_MIRROR、W_BIN_OFFLINE, 見README〈外部執行檔〉
 *
 * 本函數只負責取得至快取，不把檔案複製到canvas套件之build/Release，也不檢查作業系統(連網機器可為離線部署預備鏡像)，載入canvas請用WCanvas
 *
 * @param {Object} [opt={}] 輸入設定物件, 交wsemi之fsEnsureBins(names、cacheDir、mirror、offline、onProgress等), pkgRoot固定為本套件根
 * @returns {Promise} 回傳Promise, resolve回傳{ canvas: 組資料夾之絕對路徑 }, 另有不可列舉之bundles.canvas.files[組內路徑]為各檔之絕對路徑, reject回傳帶code之Error(E_OFFLINE_MISSING、E_HASH_MISMATCH、E_EXTRACT等)
 * @example
 * import ensureBins from 'w-canvas/src/ensureBins.mjs' //或WCanvas.ensureBins
 *
 * async function test() {
 *
 *     //部署前預先取得(連網機器設W_BIN_CACHE=<資料夾>後執行, 該資料夾即可作為離線鏡像W_BIN_MIRROR)
 *     let bins = await ensureBins()
 *
 *     console.log('bins', bins)
 *     // bins { canvas: 'D:\\xxx\\node_modules\\w-canvas\\bin-cache\\<組識別>' }
 *     console.log(bins.bundles.canvas.files['build/Release/canvas.node'])
 *     // D:\xxx\node_modules\w-canvas\bin-cache\<組識別>\build\Release\canvas.node
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 *
 */
function ensureBins(opt = {}) {

    //floatingManifestUrl會改變清單之信任錨, 不轉傳使用者之值(釘選模式不使用)
    let { floatingManifestUrl, ...o } = opt || {} // eslint-disable-line no-unused-vars

    return fsEnsureBins('bin/manifest.json', { ...o, pkgRoot })
}


export default ensureBins
