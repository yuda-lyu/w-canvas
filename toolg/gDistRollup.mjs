import { fileURLToPath } from 'url'
import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'


//fdSrc, fdTar, 以本腳本位置推導(rollupFiles會先清空fdTar, 不可隨cwd而清空他處之dist)
let fdSrc = fileURLToPath(new URL('../src', import.meta.url))
let fdTar = fileURLToPath(new URL('../dist', import.meta.url))


//globals, 外部模組: Node內建模組(本套件為Node專用, runin為nodejs); child_process為wsemi之fsEnsureBins解壓所用, module為createRequire(找canvas套件)所用
//canvas以絕對路徑動態載入(import(檔案網址)), 不經模組名稱, 故不列入
let globals = {
    'fs': 'fs',
    'path': 'path',
    'os': 'os',
    'url': 'url',
    'module': 'module',
    'crypto': 'crypto',
    'stream': 'stream',
    'stream/promises': 'stream/promises',
    'child_process': 'child_process',
    'events': 'events',
}


async function rp() {

    await rollupFiles({ //rollupFiles預設會clean folder
        fns: 'WCanvas.mjs',
        fdSrc,
        fdTar,
        hookNameDist: () => 'w-canvas',
        runin: 'nodejs',
        // nameDistType: 'kebabCase', //直接由hookNameDist給予
        // bNodePolyfill: true,
        // bMinify: false,
        globals,
        external: Object.keys(globals),
    })

}
rp()
    .catch((err) => {
        //建置失敗須以非0結束, 使發布流程得知
        console.log(err)
        process.exitCode = 1
    })
