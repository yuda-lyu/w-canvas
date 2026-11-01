import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import { execSync, execFileSync } from 'child_process'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'
import ensureBinsOwn from '../src/ensureBins.mjs'
import * as nsMain from '../src/WCanvas.mjs'


//規格: 外部執行檔之存放下載校驗與離線(制式規格) S1、S3、S5、M1、M2、M3、M6、D1、D5、E2、O5、§8 T1; 清單為官方預建檔(廠商檔, 釘選版本標籤)之檔案組canvas
describe(`bin/manifest.json`, function() {
    this.timeout(180000)

    let fdt = './test/_tmp/binManifest'
    let fdDecoy = './bin-cache/__decoy__'
    let fpDecoyBin = './bin/__decoy__.dll'

    //manifestOf, 清單在it內讀(缺清單時單案失敗而非整檔載入失敗)
    let manifestOf = () => {
        return JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
    }
    let pkgOf = () => {
        return JSON.parse(fs.readFileSync('package.json', 'utf8'))
    }

    after(function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.rmSync(fdDecoy, { recursive: true, force: true })
        fs.rmSync(fpDecoyBin, { force: true })

        //誘餌檔可能使bin-cache/被建立: 空夾才移除(開發機已有快取時不動)
        try {
            fs.rmdirSync('./bin-cache')
        }
        catch (err) {} // eslint-disable-line no-empty
        try {
            fs.rmdirSync('./test/_tmp')
        }
        catch (err) {} // eslint-disable-line no-empty
    })

    //M1、M2、M6、S3
    it(`should declare the pinned manifest of this package with one bundle of the official asset, tagged with the version of canvas (M1, M2, M6, S3)`, function() {
        let manifest = manifestOf()
        let version = pkgOf().dependencies.canvas
        assert.strict.equal(manifest.schema, 1)
        assert.strict.equal(manifest.pkg, 'w-canvas')
        assert.strict.equal(manifest.mode, 'pinned')
        assert.strict.equal(manifest.repo, 'yuda-lyu/w-canvas')
        assert.strict.equal(manifest.commit, undefined) //只有廠商檔, 無repo內之檔, 不需釘選提交
        assert.strict.equal(manifest.files, undefined)

        //清單頂層version為內附預建檔之版本, 須同package.json釘選之canvas版本(預建檔須與canvas之JS同版)
        assert.strict.equal(/^\d+\.\d+\.\d+$/.test(version), true, `canvas must be pinned to an exact version: ${version}`)
        assert.strict.equal(manifest.version, version)

        assert.strict.equal(manifest.bundles.length, 1)
        let b = manifest.bundles[0]
        assert.strict.equal(b.name, 'canvas')
        assert.strict.equal(b.archives.length, 1)
        let a = b.archives[0]

        //S3: 廠商檔不鏡像, 網址為版本標籤之資產網址(非releases/latest)
        assert.strict.equal(a.url, `https://github.com/Automattic/node-canvas/releases/download/v${version}/canvas-v${version}-napi-v7-win32-x64.tar.gz`)
        assert.strict.equal(/^[0-9a-f]{64}$/.test(a.sha256), true)
        assert.strict.equal(Number.isInteger(a.size) && a.size > 0, true)
        assert.strict.equal(a.extract.type, 'tgz')
        assert.strict.equal(typeof a.note, 'string') //M3: 雜湊來源之說明
    })

    //①: 45個成員(canvas.node與44個dll)皆在build/Release、各附sha256與大小; 建置中繼檔不列
    it(`should list exactly the 45 runtime files of build/Release (canvas.node and 44 dll), each with sha256 and size, and none of the build files`, function() {
        let files = manifestOf().bundles[0].archives[0].extract.files
        assert.strict.equal(files.length, 45)
        let paths = files.map((v) => v.path)
        assert.strict.equal(new Set(paths.map((v) => v.toLowerCase())).size, 45) //不分大小寫不重複
        for (let f of files) {
            assert.strict.equal(/^build\/Release\/[A-Za-z0-9._+-]+$/.test(f.path), true, f.path)
            assert.strict.equal(/^[0-9a-f]{64}$/.test(f.sha256), true, f.path)
            assert.strict.equal(Number.isInteger(f.size) && f.size > 0, true, f.path)
            assert.strict.equal(/\.(sln|vcxproj|filters|gypi)$/i.test(f.path), false, f.path) //建置中繼檔與執行無關
        }
        assert.strict.deepStrictEqual(paths.filter((v) => v.endsWith('.node')), ['build/Release/canvas.node'])
        assert.strict.equal(paths.filter((v) => v.endsWith('.dll')).length, 44)
        assert.strict.equal(paths.filter((v) => !v.endsWith('.node') && !v.endsWith('.dll')).length, 0)
        assert.strict.equal(files.find((v) => v.path.endsWith('canvas.node')).size > 100000, true)

        //組內之檔須能組成同一組(canvas.node與其dll相鄰, 規格M6): 同一資料夾
        assert.strict.equal(new Set(paths.map((v) => path.posix.dirname(v))).size, 1)
    })

    //M1、M2: 清單通過wsemi之fsEnsureBins之schema檢查; 離線且快取為空時為E_OFFLINE_MISSING(缺檔, 列全組45檔), 不連網
    it(`should pass the schema check of fsEnsureBins (M1, M2), asking for the bundle canvas as a whole`, async function() {
        let err = null
        try {
            await fsEnsureBins('bin/manifest.json', { pkgRoot: '.', cacheDir: `${fdt}/cache`, mirror: '', offline: true, names: 'canvas' })
        }
        catch (e) {
            err = e
        }
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.equal(err.missing.length, 1)
        assert.strict.equal(err.missing[0].name, 'canvas')
        assert.strict.equal(err.missing[0].bundle.files.length, 45)
        assert.strict.equal(fs.existsSync(`${fdt}/cache`), false) //離線缺檔不留空夾
    })

    //預建檔須與canvas之JS同版: package.json釘選確切版本(非範圍), 已安裝者亦同版
    it(`should pin canvas to the exact version of the prebuilt files, and the installed canvas has that version`, function() {
        let pkg = pkgOf()
        assert.strict.equal(/^\d+\.\d+\.\d+$/.test(pkg.dependencies.canvas), true, pkg.dependencies.canvas)
        let installed = JSON.parse(fs.readFileSync('node_modules/canvas/package.json', 'utf8')).version
        assert.strict.equal(installed, pkg.dependencies.canvas)
        assert.strict.equal(installed, manifestOf().version)
    })

    //E4/D5: tgz自wsemi 1.9.38起支援
    it(`should depend on wsemi 1.9.38 or later, the first version whose fsEnsureBins accepts tgz archives (D5)`, function() {
        let pkg = pkgOf()
        let ver = (s) => String(s).replace(/^[^0-9]*/, '').split('.').map((v) => parseInt(v, 10))
        let atLeast = (a, b) => {
            for (let i = 0; i < 3; i++) {
                if (a[i] !== b[i]) {
                    return a[i] > b[i]
                }
            }
            return true
        }
        assert.strict.equal(atLeast(ver(pkg.dependencies.wsemi), [1, 9, 38]), true, pkg.dependencies.wsemi)
        let fpEnsure = fileURLToPath(import.meta.resolve('wsemi/src/fsEnsureBins.mjs'))
        let installed = JSON.parse(fs.readFileSync(path.join(path.dirname(fpEnsure), '..', 'package.json'), 'utf8')).version
        assert.strict.equal(atLeast(ver(installed), [1, 9, 38]), true, installed)
    })

    //D1: 不得於安裝時下載(npm 12擋下安裝腳本亦不影響本套件)
    it(`should have no install scripts and only the test and deploy scripts (D1)`, function() {
        let pkg = pkgOf()
        for (let k of ['postinstall', 'install', 'preinstall', 'prepare']) {
            assert.strict.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, k), false, k)
        }
        assert.strict.deepStrictEqual(Object.keys(pkg.scripts).sort(), ['deploy', 'test'])
        assert.strict.equal(pkg.scripts.test, 'mocha --parallel "test/*.test.mjs" --timeout 180000')
        assert.strict.equal(pkg.main, 'dist/w-canvas.umd.js')
        assert.strict.equal(pkg.name, 'w-canvas')
        assert.strict.equal(pkg.license, 'MIT')
    })

    //O5
    it(`should document the external files, the npm 12 behaviour, the offline use and the limits in the README (O5)`, function() {
        let c = fs.readFileSync('README.md', 'utf8')
        assert.strict.equal(c.includes('## 外部執行檔'), true)
        let sec = c.slice(c.indexOf('## 外部執行檔'))
        for (let k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE', 'canvas.node', 'ensureBins', 'bin/manifest.json', 'E_OFFLINE_MISSING', 'E_BIN_LOCKED', 'E_VERSION', 'E_PLATFORM', 'win32-x64', 'build/Release']) {
            assert.strict.equal(sec.includes(k), true, `README section lacks ${k}`)
        }
        assert.strict.equal(/npm 12/.test(c) && /allowScripts|安裝腳本/.test(c), true, 'README must explain that npm 12 blocks the install script of canvas')
        assert.strict.equal(c.includes(pkgOf().dependencies.canvas), true, 'README must name the pinned canvas version')
    })

    //S5、M1補充F12、指引文件規則: 快取與測試暫存不入版控, CLAUDE*.md不入版控, sgud/入版控, bin/視為二進位
    it(`should keep the cache, the test temp and CLAUDE*.md out of git, keep sgud/ in git, and treat bin/ as binary (S5, M1 F12)`, function() {
        let ignored = (p) => {
            try {
                execFileSync('git', ['check-ignore', '-q', '--', p], { windowsHide: true })
                return true
            }
            catch (err) {
                return false
            }
        }
        assert.strict.equal(ignored('bin-cache/x/canvas.node'), true)
        assert.strict.equal(ignored('test/_tmp/x/canvas.node'), true)
        assert.strict.equal(ignored('CLAUDE.md'), true)
        assert.strict.equal(ignored('sgud/state/state.md'), false)
        assert.strict.equal(ignored('sgud/rule/rulebook.md'), false)
        assert.strict.equal(ignored('bin/manifest.json'), false)
        let attr = execFileSync('git', ['check-attr', 'binary', '--', 'bin/manifest.json'], { encoding: 'utf8', windowsHide: true })
        assert.strict.equal(attr.trim().endsWith('binary: set'), true, attr)
    })

    //S1、S5、T1: npm包不含外部執行檔, bin/只有清單; 先放誘餌檔(缺忽略規則時確定性變紅)
    it(`should not pack external executables into the npm package, only bin/manifest.json (S1, S5, T1)`, function() {
        fs.mkdirSync(fdt, { recursive: true })
        fs.writeFileSync(`${fdt}/probe.dll`, 'x')
        fs.mkdirSync(fdDecoy, { recursive: true })
        fs.writeFileSync(`${fdDecoy}/probe.dll`, 'x')
        fs.writeFileSync(fpDecoyBin, 'x')
        let r = null
        try {
            r = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
        }
        finally {
            fs.rmSync(fpDecoyBin, { force: true })
        }
        let info = Array.isArray(r) ? r[0] : Object.values(r)[0] //npm 11以前為陣列, npm 12起為以套件名為鍵之物件
        let fps = info.files.map((v) => v.path)
        assert.strict.deepStrictEqual(fps.filter((v) => /\.(exe|dll|node|msi|zip|7z|gz|tgz)$/i.test(v)), [])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('bin/') || v.startsWith('bin-cache/')), ['bin/manifest.json'])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('test/_tmp/') || v.startsWith('sgud/') || v.startsWith('tmp/') || /^CLAUDE/.test(v)), [])
        for (let k of ['package.json', 'README.md', 'LICENSE', 'src/WCanvas.mjs', 'src/ensureBins.mjs', 'src/placeBins.mjs', 'bin/manifest.json']) {
            assert.strict.equal(fps.includes(k), true, `the package must include ${k}`)
        }
        assert.strict.equal(info.size < 1024 * 1024, true, `the package must stay small: ${info.size}`) //無大檔入包(預建檔另行下載)
    })

})


//規格 D1、E2: 套件端不得自寫下載, 且不得於postinstall下載
describe(`no self-written download in src/ (D1, E2)`, function() {

    let fdSrc = './src'
    let fps = fs.readdirSync(fdSrc).filter((v) => v.endsWith('.mjs')).map((v) => path.join(fdSrc, v))

    it(`should not import fsDownloadFile, fsMergeFiles nor w-zip, and not fetch anything by itself`, function() {
        assert.strict.equal(fps.length >= 3, true)
        for (let fp of fps) {
            let c = fs.readFileSync(fp, 'utf8')
            assert.strict.equal(/fsDownloadFile(?!Verify)/.test(c), false, `${fp} imports fsDownloadFile`)
            assert.strict.equal(/fsMergeFiles|w-zip|mZip/.test(c), false, `${fp} assembles or extracts by itself`)
            assert.strict.equal(/raw\/refs\/heads|raw\.githubusercontent\.com|\bfetch\s*\(|https?:\/\/github\.com|child_process|tar\.exe/.test(c), false, `${fp} downloads or extracts by itself`)
        }
    })

    it(`should list the node modules needed by fsEnsureBins and createRequire as external and globals of the UMD build (rollup)`, function() {
        let c = fs.readFileSync('toolg/gDistRollup.mjs', 'utf8')
        let ext = c.slice(c.indexOf('external:'))
        let glb = c.slice(c.indexOf('globals = {'), c.indexOf('async function rp'))
        for (let m of ['url', 'crypto', 'stream', 'stream/promises', 'child_process', 'fs', 'path', 'module']) {
            assert.strict.equal(ext.includes('Object.keys(globals)') && glb.includes(`'${m}':`), true, `globals lacks ${m}`)
        }
    })

    it(`should export only the default from the main file and attach ensureBins as its static property (E2)`, function() {
        //具名匯出會使rollup UMD改輸出exports.default, 破壞require('w-canvas')之用法
        assert.strict.deepStrictEqual(Object.keys(nsMain), ['default'])
        assert.strict.equal(typeof nsMain.default, 'function')
        assert.strict.equal(nsMain.default.ensureBins, ensureBinsOwn)
    })

})
