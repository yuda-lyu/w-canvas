import fs from 'fs'
import path from 'path'
import http from 'http'
import assert from 'assert'
import Module from 'module'
import { pathToFileURL } from 'url'
import { makeFakeBundle, sha256Of } from './tools/fakeBundle.mjs'
import { makeFakePkg } from './tools/fakePkg.mjs'
import placeBins from '../src/placeBins.mjs'


//以假檔案組(3檔, tar.gz經System32之tar.exe建立, 本機HTTP伺服器扮GitHub版本標籤之資產網址)與假canvas(不載入原生模組)驗證WCanvas之流程、放置與錯誤碼, 不連外網, 全在行程內
//真實預建檔(45檔)與真實載入canvas見api-WCanvas.test.mjs
describe(`WCanvas (fake bundle)`, function() {
    this.timeout(180000)

    let port = 8981
    let fdt = path.resolve('./test/_tmp/unit-WCanvas')
    let fb = null
    let server = null
    let hits = []
    let fetched = []
    let fetchOrig = globalThis.fetch
    let seq = 0
    let urlPath = null

    //onWin, 本套件之預建檔只有win32-x64, 夾具以System32之tar.exe建立
    let onWin = process.platform === 'win32'

    //fetch守門: 只放行GitHub版本標籤資產網址(改指本機伺服器)與本機網址, 其餘(外網)一律拋錯; 記錄被請求之網址
    let fetchGate = (input, init) => {
        let u = String((input && input.url) || input)
        fetched.push(u)
        if (u.startsWith('https://github.com/')) {
            return fetchOrig(u.replace('https://github.com', `http://127.0.0.1:${port}`), init)
        }
        if (u.startsWith(`http://127.0.0.1:${port}/`)) {
            return fetchOrig(u, init)
        }
        throw new Error(`unexpected network access in test: ${u}`)
    }

    before(async function() {
        if (!onWin) {
            this.skip()
        }
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
        fb = makeFakeBundle(path.join(fdt, 'bundle'))
        urlPath = `/Automattic/node-canvas/releases/download/v3.2.3/${fb.nameAsset}`
        server = http.createServer((req, res) => {
            hits.push(req.url)
            if (req.url !== urlPath) {
                res.writeHead(404)
                res.end()
                return
            }
            res.writeHead(200, { 'content-length': String(fb.tgz.length) })
            res.end(fb.tgz)
        })
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(port, '127.0.0.1', resolve)
        })
        globalThis.fetch = fetchGate
    })

    after(async function() {
        globalThis.fetch = fetchOrig
        if (server) {
            await new Promise((resolve) => {
                server.close(resolve)
            })
        }
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {} // eslint-disable-line no-empty
    })

    beforeEach(function() {
        hits.length = 0
        fetched.length = 0
    })

    //setup, 建假套件根並匯入其src/WCanvas.mjs(各假套件根之模組實例互相獨立); 回傳{ pkg, W, base, call }
    //base為每次呼叫之基本選項: 明指win32-x64(不隨本機)、快取在假套件根內、不用環境變數之鏡像與離線
    let setup = async(tag, opt = {}) => {
        seq++
        let fdPkg = path.join(fdt, `${tag}-${seq}`)
        let pkg = makeFakePkg(fdPkg, { manifest: fb.manifest, ...opt })
        let W = (await import(pathToFileURL(pkg.fpMod).href)).default
        let base = { platform: 'win32', arch: 'x64', cacheDir: path.join(fdPkg, 'cache'), mirror: '', offline: false }
        let evs = []
        let call = (o = {}) => {
            return W({ ...base, onTrace: (e) => evs.push(e), ...o })
        }
        return { pkg, W, base, call, evs }
    }

    let catchErr = async(fun) => {
        try {
            await fun()
        }
        catch (err) {
            return err
        }
        return null
    }

    let typesOf = (evs) => evs.map((e) => e.type)
    let countOf = (evs, type) => evs.filter((e) => e.type === type).length

    //hashesOf, 資料夾內各一般檔之sha256
    let hashesOf = (fd) => {
        let r = {}
        for (let n of fs.readdirSync(fd).sort()) {
            r[n] = sha256Of(fs.readFileSync(path.join(fd, n)))
        }
        return r
    }
    let want = () => {
        let r = {}
        for (let m of fb.members) {
            r[path.posix.basename(m.path)] = m.sha256
        }
        return r
    }

    //withEnv, 暫時設定環境變數(值為undefined代表刪除), 結束後還原
    let withEnv = async(vars, fun) => {
        let old = {}
        for (let k of Object.keys(vars)) {
            old[k] = process.env[k]
            if (vars[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = vars[k]
            }
        }
        try {
            return await fun()
        }
        finally {
            for (let k of Object.keys(vars)) {
                if (old[k] === undefined) {
                    delete process.env[k]
                }
                else {
                    process.env[k] = old[k]
                }
            }
        }
    }

    describe(`opt checks (input-check spec K3, V4, V5, V7)`, function() {

        //K3、V4: opt本身非一般物件視為{}, 取預設; 預設之快取在假套件根(不隨環境變數), 以環境變數指向假套件根內之快取並移除鏡像與離線
        it(`should treat an opt that is not a plain object as {} (undefined, null, number, string, array, boolean) and not warn`, async function() {
            let t = await setup('optSelf')
            let warns = []
            let warnOrig = console.warn
            console.warn = (m) => {
                warns.push(m)
            }
            try {
                await withEnv({ W_BIN_CACHE: path.join(t.pkg.fdPkg, 'envcache'), W_BIN_MIRROR: undefined, W_BIN_OFFLINE: undefined }, async() => {
                    for (let v of [undefined, null, 5, 'abc', [], true]) {
                        let C = await t.W(v)
                        assert.strict.equal(C.stub, true, String(v))
                    }
                })
            }
            finally {
                console.warn = warnOrig
            }
            assert.strict.deepStrictEqual(warns, [])
            assert.strict.equal(hits.length, 1) //首次下載一次, 之後自快取(W_BIN_CACHE之<套件>/<組識別>/)
            assert.strict.equal(fs.existsSync(path.join(t.pkg.fdPkg, 'envcache', 'w-canvas', fb.bundleId, 'build', 'Release', 'canvas.node')), true)
        })

        //K3、V5: 本函數自用之鍵(debug、funLog、platform、arch)給了而非預期者視為未給, 取預設; 只在debug為true時警告, 警告不含傳入之值, 同一原因每個行程只警告一次
        it(`should use the defaults for unexpected values of platform, arch, debug and funLog, and warn only when debug is true, without the given values, once per reason`, async function() {
            let t = await setup('optKeys')
            let logs = []
            let funLog = (m) => {
                logs.push(m)
            }
            let C = await t.call({ debug: true, funLog, platform: 123456, arch: '', cacheDir: t.base.cacheDir })
            assert.strict.equal(C.stub, true) //platform與arch取預設(本機為win32-x64)
            assert.strict.deepStrictEqual(logs.map((m) => /opt\.(\w+)/.exec(m)[1]).sort(), ['arch', 'platform'])
            assert.strict.equal(logs.every((m) => m.startsWith('[w-canvas WCanvas]')), true)
            assert.strict.equal(logs.some((m) => m.includes('123456')), false) //警告不含傳入之值

            //同一原因不重複警告
            await t.call({ debug: true, funLog, platform: 123456, arch: '' })
            assert.strict.equal(logs.length, 2)

            //debug非布林視為false: 不警告; funLog非函數視為未給: 改用console.warn
            await t.call({ debug: 'yes', funLog, platform: 654321 })
            assert.strict.equal(logs.length, 2)
            let warns = []
            let warnOrig = console.warn
            console.warn = (m) => {
                warns.push(m)
            }
            try {
                await t.call({ debug: true, funLog: 'x' })
            }
            finally {
                console.warn = warnOrig
            }
            assert.strict.deepStrictEqual(warns.length, 1) //funLog非函數視為未給, 警告改由console.warn輸出
            assert.strict.equal(warns[0].includes('opt.funLog'), true)
        })

        //V7: 未宣告之鍵忽略; 轉傳之回呼型(fetch、onProgress、onTrace)給了而非函數視為未給(K3), 函數則轉傳
        it(`should ignore undeclared keys, ignore non-function callbacks and forward the function callbacks to fsEnsureBins`, async function() {
            let t = await setup('optFwd')
            let prog = []
            let fet = []
            let C = await t.W({
                ...t.base,
                foo: 1,
                names: 'not-a-bundle', //不轉傳: 本函數固定只取組canvas
                pkgRoot: path.join(fdt, 'elsewhere'), //不轉傳: 套件根固定為本套件根
                floatingManifestUrl: 'https://raw.githubusercontent.com/x/y/master/bin/manifest.json',
                onTrace: 'x',
                fetch: (u, init) => {
                    fet.push(String(u))
                    return globalThis.fetch(u, init)
                },
                onProgress: (e) => {
                    prog.push(e.step)
                },
            })
            assert.strict.equal(C.stub, true)
            assert.strict.deepStrictEqual(fet, [fb.urlAsset])
            assert.strict.equal(prog.includes('download') && prog.includes('ready'), true, prog.join())
            let C2 = await t.W({ ...t.base, onProgress: 5, fetch: 'x' }) //非函數之回呼視為未給, 且快取已有, 不連網
            assert.strict.equal(C2.stub, true)
        })

        //轉傳之非回呼鍵由wsemi之fsEnsureBins檢測: 型別不符為E_ARG(不靜默改用預設: offline給了字串而被忽略會使離線部署誤連網)
        it(`should leave the checks of the forwarded non-callback keys to fsEnsureBins (E_ARG), never silently going online`, async function() {
            let t = await setup('optArg')
            let err = await catchErr(() => t.call({ offline: 'yes' }))
            assert.strict.equal(err && err.code, 'E_ARG', err && err.message)
            assert.strict.deepStrictEqual(hits, [])
            assert.strict.equal(fs.existsSync(t.pkg.fdRelease), false)
        })

    })

    describe(`platform branches`, function() {

        //平台檢查: 只支援win32-x64; 其他平台無自行編譯之canvas.node時reject E_PLATFORM, 不下載、不放置
        it(`should reject E_PLATFORM on every platform other than win32-x64 without downloading nor placing, naming the supported platform`, async function() {
            let cases = [['linux', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'arm64'], ['win32', 'ia32'], ['linux', 'arm64']]
            for (let [platform, arch] of cases) {
                let t = await setup('plat')
                let err = await catchErr(() => t.call({ platform, arch }))
                assert.strict.equal(err && err.code, 'E_PLATFORM', `${platform}-${arch}: ${err && err.message}`)
                assert.strict.equal(err.message.includes('win32-x64') && err.message.includes(`${platform}-${arch}`), true, err.message)
                assert.strict.equal(err.platform, platform)
                assert.strict.equal(err.arch, arch)
                assert.strict.deepStrictEqual(fetched, [], `${platform}-${arch}`)
                assert.strict.equal(fs.existsSync(t.pkg.fdRelease), false)
                assert.strict.equal(fs.existsSync(path.join(t.pkg.fdPkg, 'cache')), false)
                assert.strict.deepStrictEqual(typesOf(t.evs), ['canvas-platform'])
                assert.strict.deepStrictEqual({ ...t.evs[0] }, { type: 'canvas-platform', platform, arch, supported: false })
            }
        })

        //本機自行編譯之canvas.node已存在: 其他平台直接載入, 不下載、不放置、不改動該檔
        it(`should load canvas directly on another platform when canvas has its own build/Release/canvas.node (self-built), without ensureBins nor changing the file`, async function() {
            let t = await setup('self')
            fs.mkdirSync(t.pkg.fdRelease, { recursive: true })
            let fpNode = path.join(t.pkg.fdRelease, 'canvas.node')
            fs.writeFileSync(fpNode, 'SELF-BUILT')
            let C = await t.call({ platform: 'linux', arch: 'x64' })
            assert.strict.equal(C.stub, true)
            assert.strict.equal(C.nodeLength, 10) //載入者即為使用端自行編譯之檔
            assert.strict.equal(fs.readFileSync(fpNode, 'utf8'), 'SELF-BUILT')
            assert.strict.deepStrictEqual(typesOf(t.evs), ['canvas-platform', 'canvas-load'])
            assert.strict.deepStrictEqual(fetched, [])
            assert.strict.equal(fs.existsSync(path.join(t.pkg.fdPkg, 'cache')), false)
            assert.strict.deepStrictEqual(fs.readdirSync(t.pkg.fdRelease), ['canvas.node']) //未放入dll
        })

        //win32-x64之檢查值: 平台與架構皆依字串全等; 取預設時為本機值
        it(`should report supported only for win32 with x64 in the canvas-platform event`, async function() {
            let t = await setup('supported')
            await t.call()
            let e = t.evs.find((v) => v.type === 'canvas-platform')
            assert.strict.deepStrictEqual({ ...e }, { type: 'canvas-platform', platform: 'win32', arch: 'x64', supported: true })
        })

        //canvas套件找不到: 於下載前即reject E_CANVAS_MISSING(不白下載15MB)
        it(`should reject E_CANVAS_MISSING before downloading when the canvas package cannot be resolved`, async function() {
            let t = await setup('missing', { canvas: 'none' })
            let orig = Module._resolveFilename
            Module._resolveFilename = function(request, ...rest) {
                if (request === 'canvas/package.json' || request === 'canvas') {
                    let e = new Error(`Cannot find module '${request}'`)
                    e.code = 'MODULE_NOT_FOUND'
                    throw e
                }
                return orig.call(this, request, ...rest)
            }
            let p = null
            try {
                p = t.call() //canvas之解析於呼叫之同步段完成, 其後即還原
            }
            finally {
                Module._resolveFilename = orig
            }
            let err = await catchErr(() => p)
            assert.strict.equal(err && err.code, 'E_CANVAS_MISSING', err && err.message)
            assert.strict.deepStrictEqual(fetched, [])
            assert.strict.deepStrictEqual(hits, [])
        })

    })

    describe(`placement into canvas build/Release`, function() {

        //首次: 取得假組(下載、解出、逐檔校驗), 先放置後才載入canvas(假canvas載入時即讀build/Release), 回傳canvas之匯出原樣
        it(`should download once, place every member into build/Release before loading canvas, and return the exports of canvas as they are`, async function() {
            let t = await setup('first')
            let C = await t.call()
            assert.strict.equal(C.stub, true)
            assert.strict.equal(C.nodeLength, 3000) //載入時canvas.node已在
            assert.strict.deepStrictEqual(C.dlls, ['liba-1.dll', 'libb-2.dll']) //載入時dll已在
            assert.strict.equal(typeof C.createCanvas, 'function')
            assert.strict.equal(typeof C.loadImage, 'function')
            assert.strict.equal(typeof C.registerFont, 'function')
            assert.strict.deepStrictEqual(hashesOf(t.pkg.fdRelease), want())
            assert.strict.equal(fs.existsSync(path.join(t.pkg.fdRelease, 'binding.sln')), false) //不列入清單之建置中繼檔不放置
            assert.strict.deepStrictEqual(hits, [urlPath])

            //事件: 下載、解出、發布於前, 其後才放置(canvas.node最後), 最後載入
            let ts = typesOf(t.evs)
            assert.strict.equal(ts.includes('download') && ts.includes('extract') && ts.includes('publish'), true, ts.join())
            let places = t.evs.filter((e) => e.type === 'canvas-place')
            assert.strict.deepStrictEqual(places.map((e) => [path.posix.basename(e.path), e.result]), [['liba-1.dll', 'copy'], ['libb-2.dll', 'copy'], ['canvas.node', 'copy']])
            assert.strict.equal(ts.indexOf('publish') < ts.indexOf('canvas-place'), true)
            assert.strict.deepStrictEqual({ ...t.evs.find((e) => e.type === 'canvas-placed') }, { type: 'canvas-placed', total: 3, copied: 3, skipped: 0, exists: 0 })
            assert.strict.deepStrictEqual({ ...t.evs[t.evs.length - 1] }, { type: 'canvas-load', ok: true, code: null })
        })

        //回傳canvas之module.exports本身(原樣, 非複本或命名空間)
        it(`should return the module.exports of canvas itself`, async function() {
            let t = await setup('identity')
            let C = await t.call()
            let C2 = (await import('module')).createRequire(import.meta.url)(path.join(t.pkg.fdCanvas, 'index.js'))
            assert.strict.equal(C, C2)
        })

        //放置後載入canvas失敗: E_CANVAS_LOAD(帶cause與canvas-load事件), 修正後同行程再呼叫可成功(不被快取之失敗所困)
        it(`should reject E_CANVAS_LOAD when canvas cannot be loaded after the placement, and succeed on a later call in the same process once it can`, async function() {
            let t = await setup('loadFail')
            let err = await withEnv({ W_CANVAS_STUB_FAIL: '1' }, async() => {
                return await catchErr(() => t.call())
            })
            assert.strict.equal(err && err.code, 'E_CANVAS_LOAD', err && err.message)
            assert.strict.equal(err.cause.message, 'stub load failure')
            assert.strict.equal(err.message.includes(t.pkg.fdCanvas) && err.message.includes('stub load failure'), true, err.message)
            assert.strict.deepStrictEqual({ ...t.evs[t.evs.length - 1] }, { type: 'canvas-load', ok: false, code: null })
            assert.strict.deepStrictEqual(hashesOf(t.pkg.fdRelease), want()) //放置已完成(載入失敗與放置無關)
            let C = await t.call()
            assert.strict.equal(C.stub, true)
        })

        //第二次: 快取命中(不下載、不解出)、放置全略過(各檔仍為同一檔案, 未被重寫)
        it(`should take the second call from the cache without downloading, and skip every file that already matches (not rewritten)`, async function() {
            let t = await setup('second')
            await t.call()
            let ino = {}
            for (let n of fs.readdirSync(t.pkg.fdRelease)) {
                ino[n] = fs.statSync(path.join(t.pkg.fdRelease, n), { bigint: true }).ino
            }
            t.evs.length = 0
            hits.length = 0
            let C = await t.call()
            assert.strict.equal(C.stub, true)
            assert.strict.deepStrictEqual(hits, [])
            let ts = typesOf(t.evs)
            assert.strict.equal(ts.includes('download') || ts.includes('extract') || ts.includes('publish'), false, ts.join())
            assert.strict.deepStrictEqual({ ...t.evs.find((e) => e.type === 'cache') }, { type: 'cache', name: 'canvas', hit: true })
            assert.strict.deepStrictEqual({ ...t.evs.find((e) => e.type === 'canvas-placed') }, { type: 'canvas-placed', total: 3, copied: 0, skipped: 3, exists: 0 })
            for (let n of Object.keys(ino)) {
                assert.strict.equal(fs.statSync(path.join(t.pkg.fdRelease, n), { bigint: true }).ino, ino[n], n)
            }
        })

        //build/Release之檔被竄改或缺漏(⑦): 只補正有問題之檔, 其餘不動, 同夾之他檔不動
        it(`should repair only the files of build/Release that were tampered with or are missing, and leave the others and unrelated files alone`, async function() {
            let cases = [
                ['flip a byte of a dll (same size)', 'liba-1.dll', (fp) => {
                    let b = fs.readFileSync(fp)
                    b[100] = b[100] ^ 0xff
                    fs.writeFileSync(fp, b)
                }],
                ['delete a dll', 'libb-2.dll', (fp) => fs.rmSync(fp)],
                ['truncate canvas.node to 0 bytes', 'canvas.node', (fp) => fs.writeFileSync(fp, '')],
                ['append a byte to a dll', 'liba-1.dll', (fp) => fs.appendFileSync(fp, 'x')],
                ['replace canvas.node by another file of the same size', 'canvas.node', (fp) => fs.writeFileSync(fp, Buffer.alloc(3000, 7))],
            ]
            for (let [title, name, mutate] of cases) {
                let t = await setup('repair')
                await t.call()
                let fpOther = path.join(t.pkg.fdRelease, 'other.txt')
                fs.writeFileSync(fpOther, 'keep')
                let ino = {}
                for (let n of fs.readdirSync(t.pkg.fdRelease)) {
                    ino[n] = fs.statSync(path.join(t.pkg.fdRelease, n), { bigint: true }).ino
                }
                mutate(path.join(t.pkg.fdRelease, name))
                t.evs.length = 0
                await t.call()
                let places = t.evs.filter((e) => e.type === 'canvas-place')
                assert.strict.deepStrictEqual(places.filter((e) => e.result === 'copy').map((e) => path.posix.basename(e.path)), [name], title)
                assert.strict.equal(places.filter((e) => e.result === 'skip').length, 2, title)
                let h = hashesOf(t.pkg.fdRelease)
                assert.strict.equal(h['other.txt'], sha256Of(Buffer.from('keep')), title)
                delete h['other.txt']
                assert.strict.deepStrictEqual(h, want(), title)
                for (let n of Object.keys(ino)) {
                    if (n !== name) {
                        assert.strict.equal(fs.statSync(path.join(t.pkg.fdRelease, n), { bigint: true }).ino, ino[n], `${title}: ${n} must not be rewritten`)
                    }
                }
                assert.strict.equal(fs.readdirSync(t.pkg.fdRelease).some((n) => n.endsWith('.tmp')), false, title)
            }
        })

        //快取中之檔被竄改(⑥): 偵測並自來源重取(整組), 不使用竄改之檔
        it(`should detect a tampered file in the cache and fetch the bundle again`, async function() {
            let t = await setup('cacheTamper')
            await t.call()
            let fpCache = path.join(t.base.cacheDir, fb.bundleId, 'build', 'Release', 'libb-2.dll')
            let b = fs.readFileSync(fpCache)
            b[10] = b[10] ^ 0xff
            fs.writeFileSync(fpCache, b)
            t.evs.length = 0
            hits.length = 0
            await t.call()
            assert.strict.deepStrictEqual({ ...t.evs.find((e) => e.type === 'cache') }, { type: 'cache', name: 'canvas', hit: false })
            assert.strict.deepStrictEqual(hits, [urlPath]) //重取
            assert.strict.equal(sha256Of(fs.readFileSync(fpCache)), fb.members.find((m) => m.path.endsWith('libb-2.dll')).sha256)
            assert.strict.equal(t.evs.find((e) => e.type === 'publish').result, 'replaced')
            assert.strict.deepStrictEqual(hashesOf(t.pkg.fdRelease), want())
        })

        //版本綁定: 預建檔須與canvas之JS同版, 不同版時於放置前reject E_VERSION, build/Release不被寫入
        it(`should reject E_VERSION when the installed canvas differs from the version of the manifest, before placing anything`, async function() {
            let t = await setup('version', { stubVersion: '3.1.0' })
            let err = await catchErr(() => t.call())
            assert.strict.equal(err && err.code, 'E_VERSION', err && err.message)
            assert.strict.equal(err.installed, '3.1.0')
            assert.strict.equal(err.expected, '3.2.3')
            assert.strict.equal(err.message.includes('3.1.0') && err.message.includes('3.2.3'), true, err.message)
            assert.strict.equal(fs.existsSync(t.pkg.fdRelease), false)
        })

        //同行程內同時多次呼叫: 共用同一次放置(每檔只放置一次), 皆成功並得同一匯出
        it(`should share one placement among simultaneous calls in the same process`, async function() {
            let t = await setup('inproc')
            let evs = [[], [], []]
            let rs = await Promise.all(evs.map((es) => t.call({ onTrace: (e) => es.push(e) })))
            assert.strict.equal(rs.every((C) => C === rs[0] && C.stub === true), true)
            assert.strict.equal(evs.reduce((a, es) => a + countOf(es, 'canvas-place'), 0), 3)
            for (let es of evs) {
                assert.strict.deepStrictEqual({ ...es.find((e) => e.type === 'canvas-placed') }, { type: 'canvas-placed', total: 3, copied: 3, skipped: 0, exists: 0 })
            }
            assert.strict.deepStrictEqual(hits, [urlPath])
            assert.strict.deepStrictEqual(hashesOf(t.pkg.fdRelease), want())
        })

        //離線(④): 無快取、無鏡像時E_OFFLINE_MISSING, 列出全組, 不連網、不放置; 環境變數W_BIN_OFFLINE與選項offline皆可
        it(`should reject E_OFFLINE_MISSING when offline with an empty cache and no mirror, listing the whole bundle, without network nor placement`, async function() {
            let t = await setup('offline')
            let err = await catchErr(() => t.call({ offline: true }))
            assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
            assert.strict.equal(err.missing[0].name, 'canvas')
            assert.strict.equal(err.missing[0].bundle.files.length, 3)
            assert.strict.equal(err.message.includes(path.join(t.base.cacheDir, fb.bundleId)), true, err.message)
            assert.strict.deepStrictEqual(fetched, [])
            assert.strict.equal(fs.existsSync(t.pkg.fdRelease), false)

            //環境變數
            let err2 = await withEnv({ W_BIN_OFFLINE: '1' }, async() => {
                return await catchErr(() => t.call({ offline: undefined }))
            })
            assert.strict.equal(err2 && err2.code, 'E_OFFLINE_MISSING', err2 && err2.message)
            assert.strict.deepStrictEqual(fetched, [])
        })

        //鏡像(O1)可放壓縮檔: <鏡像>/<套件>/<壓縮檔之sha256>/<壓縮檔名>(README之手備鏡像說明), 離線時自其解出並逐檔校驗
        it(`should take the official archive from a hand-made mirror (<mirror>/w-canvas/<sha256 of the archive>/<file name>) offline, as the README says`, async function() {
            let t = await setup('mirrorArchive')
            let mirror = path.join(t.pkg.fdPkg, 'mirror')
            let fd = path.join(mirror, 'w-canvas', fb.manifest.bundles[0].archives[0].sha256)
            fs.mkdirSync(fd, { recursive: true })
            fs.writeFileSync(path.join(fd, fb.nameAsset), fb.tgz)
            let C = await t.call({ mirror, offline: true })
            assert.strict.equal(C.stub, true)
            assert.strict.deepStrictEqual(fetched, [])
            assert.strict.deepStrictEqual(hits, [])
            let ts = typesOf(t.evs)
            assert.strict.equal(ts.includes('mirror') && ts.includes('extract') && !ts.includes('download'), true, ts.join())
            assert.strict.deepStrictEqual(hashesOf(t.pkg.fdRelease), want())

            //鏡像之壓縮檔被改: 拒用(整包以清單之雜湊校驗), 離線時E_OFFLINE_MISSING
            let t2 = await setup('mirrorArchiveBad')
            let mirror2 = path.join(t2.pkg.fdPkg, 'mirror')
            let fd2 = path.join(mirror2, 'w-canvas', fb.manifest.bundles[0].archives[0].sha256)
            fs.mkdirSync(fd2, { recursive: true })
            let bad = Buffer.from(fb.tgz)
            bad[bad.length - 20] = bad[bad.length - 20] ^ 0xff
            fs.writeFileSync(path.join(fd2, fb.nameAsset), bad)
            let err = await catchErr(() => t2.call({ mirror: mirror2, offline: true }))
            assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
            assert.strict.equal(fs.existsSync(t2.pkg.fdRelease), false)
        })

        //WCanvas.ensureBins(部署前預取): 只取得至快取並回傳組路徑, 不放置到canvas套件, 不檢查作業系統
        it(`should prefetch only into the cache with WCanvas.ensureBins, not placing into canvas, whatever the platform`, async function() {
            let t = await setup('prefetch')
            //floatingManifestUrl會改變清單之信任錨, 不轉傳: 傳無效值仍成功(若轉傳, 無效之網址會被fsEnsureBins拒收)
            let bins = await t.W.ensureBins({ cacheDir: t.base.cacheDir, mirror: '', offline: false, floatingManifestUrl: 'ftp://not-allowed.invalid/x' })
            assert.strict.equal(bins.canvas, path.join(t.base.cacheDir, fb.bundleId))
            assert.strict.deepStrictEqual(Object.keys(bins.bundles.canvas.files).sort(), fb.members.map((m) => m.path).sort())
            for (let m of fb.members) {
                assert.strict.equal(sha256Of(fs.readFileSync(bins.bundles.canvas.files[m.path])), m.sha256)
            }
            assert.strict.equal(fs.existsSync(t.pkg.fdRelease), false)
            assert.strict.deepStrictEqual(Object.keys({ ...(await import(pathToFileURL(t.pkg.fpMod).href)) }), ['default'])
        })

    })

    describe(`placeBins (the copy step)`, function() {

        let mk = (tag) => {
            seq++
            let fd = path.join(fdt, `${tag}-${seq}`)
            let fdSrc = path.join(fd, 'src')
            let fdTar = path.join(fd, 'canvas')
            fs.mkdirSync(fdSrc, { recursive: true })
            fs.mkdirSync(fdTar, { recursive: true })
            let files = fb.members.map((m) => {
                let from = path.join(fdSrc, path.posix.basename(m.path))
                fs.writeFileSync(from, m.bytes)
                return { path: m.path, sha256: m.sha256, size: m.size, from }
            })
            return { fd, fdTar, files, fdRelease: path.join(fdTar, 'build', 'Release') }
        }

        //寫入以暫存檔(同資料夾)＋更名, 不直接寫目標(防讀到半檔): 目標只出現在更名之目的, 暫存檔經驗證才更名
        it(`should write each file through a temp file in the same folder and rename it over the target, never writing the target directly`, async function() {
            let m = mk('viaTemp')
            let copies = []
            let renames = []
            let copyOrig = fs.promises.copyFile
            let renameOrig = fs.promises.rename
            fs.promises.copyFile = async(a, b, ...rest) => {
                copies.push([a, b])
                return copyOrig.call(fs.promises, a, b, ...rest)
            }
            fs.promises.rename = async(a, b) => {
                renames.push([a, b])
                return renameOrig.call(fs.promises, a, b)
            }
            try {
                await placeBins(m.files, m.fdTar)
            }
            finally {
                fs.promises.copyFile = copyOrig
                fs.promises.rename = renameOrig
            }
            let targets = m.files.map((f) => path.join(m.fdTar, ...f.path.split('/')))
            assert.strict.equal(copies.length, 3)
            assert.strict.equal(copies.every(([, dst]) => !targets.includes(dst) && dst.endsWith('.tmp') && path.dirname(dst) === m.fdRelease), true)
            assert.strict.deepStrictEqual(renames.map(([, b]) => b), [targets[1], targets[2], targets[0]]) //dll之後才canvas.node
            assert.strict.equal(renames.every(([a]) => a.endsWith('.tmp') && path.dirname(a) === m.fdRelease), true)
            assert.strict.deepStrictEqual(renames.map(([a]) => a), copies.map(([, b]) => b)) //更名者即寫入並驗證之暫存檔
        })

        //canvas.node最後放置: 中途失敗時不留下「有canvas.node而缺dll」之狀態
        it(`should place canvas.node last`, async function() {
            let m = mk('nodeLast')
            let order = []
            await placeBins(m.files, m.fdTar, { trace: (type, info) => order.push(path.posix.basename(info.path)) })
            assert.strict.deepStrictEqual(order, ['liba-1.dll', 'libb-2.dll', 'canvas.node'])
        })

        //複製後驗證暫存檔(即將發布者)之內容: 來源與清單不符(校驗後被改)時E_HASH_MISMATCH, 目標不被改、不留暫存檔
        it(`should reject E_HASH_MISMATCH when the source differs from the expected hash, leaving the target untouched and no temp file`, async function() {
            let m = mk('mismatch')
            await placeBins(m.files, m.fdTar)
            let fpDll = path.join(m.fdRelease, 'liba-1.dll')
            fs.writeFileSync(fpDll, 'old-content') //目標與清單不符, 需要重寫
            let bad = m.files.map((f) => ({ ...f }))
            fs.writeFileSync(bad[1].from, Buffer.alloc(bad[1].size, 9)) //來源被改(同大小)
            let err = await catchErr(() => placeBins(bad, m.fdTar))
            assert.strict.equal(err && err.code, 'E_HASH_MISMATCH', err && err.message)
            assert.strict.equal(fs.readFileSync(fpDll, 'utf8'), 'old-content')
            assert.strict.equal(fs.readdirSync(m.fdRelease).some((n) => n.endsWith('.tmp')), false)
        })

        //更名被拒(目標已被他程序載入, 或他程序剛放妥)時: 目標此時已是期望內容(多程序同時首次呼叫)視為成功, 不誤報E_BIN_LOCKED
        it(`should treat a refused rename as success when another process has just put the expected content`, async function() {
            let m = mk('exists')
            await placeBins(m.files, m.fdTar)
            let fpDll = path.join(m.fdRelease, 'libb-2.dll')
            fs.writeFileSync(fpDll, 'stale') //目標不符
            let renameOrig = fs.promises.rename
            fs.promises.rename = async(a, b) => {
                //他程序於此刻放妥期望內容並載入(更名因而被拒)
                fs.writeFileSync(b, fb.members.find((v) => v.path.endsWith('libb-2.dll')).bytes)
                let err = new Error('EPERM: operation not permitted, rename')
                err.code = 'EPERM'
                throw err
            }
            let r = null
            try {
                r = await placeBins(m.files, m.fdTar, { attempts: 2, delayMs: 1 })
            }
            finally {
                fs.promises.rename = renameOrig
            }
            assert.strict.deepStrictEqual(r, { total: 3, copied: 0, skipped: 2, exists: 1 })
            assert.strict.deepStrictEqual(hashesOf(m.fdRelease), want())
            assert.strict.equal(fs.readdirSync(m.fdRelease).some((n) => n.endsWith('.tmp')), false)
        })

        //目標與期望不符又無法覆蓋(Windows下被載入之DLL; 此以唯讀檔模擬同一錯誤碼)時E_BIN_LOCKED, 訊息寫明原因與處置, 目標不被改
        it(`should reject E_BIN_LOCKED naming the file, the reason and what to do when a differing target cannot be replaced`, async function() {
            let m = mk('locked')
            await placeBins(m.files, m.fdTar)
            let fpDll = path.join(m.fdRelease, 'liba-1.dll')
            fs.writeFileSync(fpDll, 'old-version')
            fs.chmodSync(fpDll, 0o444) //Windows之唯讀屬性: 更名覆蓋回報EPERM
            let err = null
            try {
                err = await catchErr(() => placeBins(m.files, m.fdTar, { attempts: 3, delayMs: 1 }))
            }
            finally {
                fs.chmodSync(fpDll, 0o666)
            }
            assert.strict.equal(err && err.code, 'E_BIN_LOCKED', err && err.message)
            assert.strict.equal(err.target, fpDll)
            assert.strict.equal(err.file, 'build/Release/liba-1.dll')
            assert.strict.equal(/EPERM|EACCES|EBUSY/.test(err.message), true, err.message)
            assert.strict.equal(err.message.includes(fpDll) && /in use/.test(err.message) && /Stop every process/.test(err.message), true, err.message)
            assert.strict.equal(fs.readFileSync(fpDll, 'utf8'), 'old-version')
            assert.strict.equal(fs.readdirSync(m.fdRelease).some((n) => n.endsWith('.tmp')), false)
        })

        //被占用類錯誤先重試: 暫時被占用(如防毒掃描新檔)後釋放者最終成功
        it(`should retry a busy rename and succeed once it is released`, async function() {
            let m = mk('retry')
            let n = 0
            let renameOrig = fs.promises.rename
            fs.promises.rename = async(a, b) => {
                n++
                if (n <= 2) {
                    let err = new Error('EBUSY: resource busy or locked, rename')
                    err.code = 'EBUSY'
                    throw err
                }
                return renameOrig.call(fs.promises, a, b)
            }
            let r = null
            try {
                r = await placeBins(m.files, m.fdTar, { attempts: 5, delayMs: 1 })
            }
            finally {
                fs.promises.rename = renameOrig
            }
            assert.strict.deepStrictEqual(r, { total: 3, copied: 3, skipped: 0, exists: 0 })
            assert.strict.equal(n, 5) //第一個檔2次被拒後成功(3次更名), 另兩檔各1次, 共5次
            assert.strict.deepStrictEqual(hashesOf(m.fdRelease), want())
        })

        //無法寫入canvas資料夾(如其位置被檔案占用或唯讀之部署)時E_COPY, 訊息提示須可寫
        it(`should reject E_COPY when the canvas folder cannot be written`, async function() {
            let m = mk('copyFail')
            let fpFile = path.join(m.fd, 'afile')
            fs.writeFileSync(fpFile, 'x')
            let err = await catchErr(() => placeBins(m.files, fpFile)) //目標根為一般檔: 無法於其下建資料夾
            assert.strict.equal(err && err.code, 'E_COPY', err && err.message)
            assert.strict.equal(/writable/.test(err.message), true, err.message)
            assert.strict.equal(err.file !== undefined && err.target !== undefined, true)
        })

    })

})
