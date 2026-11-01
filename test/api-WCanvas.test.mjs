import fs from 'fs'
import path from 'path'
import assert from 'assert'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { makeFakePkg } from './tools/fakePkg.mjs'
import spawnChild from './tools/child.mjs'
import { decodePng, countDark, pixelAt } from './tools/png.mjs'
import placeBins from '../src/placeBins.mjs'


//真實之官方預建檔(node-canvas v3.2.3 napi-v7 win32-x64, 45檔)與真實之canvas JS: 以子行程呼叫WCanvas(Windows下載入之DLL會被鎖, 故載入canvas者皆在子行程)
//首案(②)連網自GitHub取得官方資產(15MB, 約數秒), 其快取(<W_BIN_CACHE>/w-canvas/<組識別>/, 結構同鏡像)為其後各案之鏡像來源, 其餘案不連外網(子行程預載fetch守門)
//假套件根(test/_tmp/api-WCanvas/<案名>-<序>/)內含本套件src/之副本與node_modules/canvas之副本(不含build/), 不動本套件自身之node_modules/canvas
describe(`WCanvas (real prebuilt files)`, function() {
    this.timeout(180000)

    let onWin = process.platform === 'win32'
    let fdt = path.resolve('./test/_tmp/api-WCanvas')
    let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
    let archive = manifest.bundles[0].archives[0]
    let members = archive.extract.files
    let names = members.map((v) => path.posix.basename(v.path)).sort()
    let sha256Of = (b) => crypto.createHash('sha256').update(b).digest('hex')
    let bundleId = sha256Of(Buffer.from([...members].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((m) => `${m.sha256}  ${m.path}\n`).join('')))
    let seedRoot = path.join(fdt, 'seed') //W_BIN_CACHE=seedRoot時, 快取為<seedRoot>/w-canvas/<組識別>/(同鏡像結構)
    let seedGroup = path.join(seedRoot, 'w-canvas', bundleId)
    let seq = 0
    let children = []

    //newPkg, 建假套件根(真清單、真canvas JS、無build/)
    let newPkg = (tag) => {
        seq++
        return makeFakePkg(path.join(fdt, `${tag}-${seq}`), { canvas: 'real' })
    }

    //newDir
    let newDir = (tag) => {
        seq++
        let fd = path.join(fdt, `${tag}-${seq}`)
        fs.mkdirSync(fd, { recursive: true })
        return fd
    }

    //spawn, 以環境變數W_BIN_CACHE、W_BIN_MIRROR、W_BIN_OFFLINE(值省略者自繼承環境移除, 不受本機環境影響)啟動子行程
    let spawn = (pkg, o = {}) => {
        let { cache, mirror, offline = false, block = true, cwd = pkg.fdPkg, cfg = {}, log = null } = o
        let env = { W_BIN_CACHE: cache, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: offline ? '1' : undefined, FETCH_BLOCK_LOG: log || undefined }
        let c = spawnChild({ mod: pkg.fpMod, ...cfg }, { cwd, env, block })
        children.push(c)
        return c
    }
    let run = async(pkg, o = {}) => {
        let r = await spawn(pkg, o).done
        assert.strict.equal(r.timedOut, false, r.out.slice(-800))
        assert.strict.notStrictEqual(r.result, null, r.out.slice(-800))
        return r
    }

    let typesOf = (r) => r.result.events.map((e) => e.type)
    let eventOf = (r, type) => r.result.events.find((e) => e.type === type)
    let placedOf = (r) => {
        let e = eventOf(r, 'canvas-placed')
        return { total: e.total, copied: e.copied, skipped: e.skipped, exists: e.exists }
    }

    let hashOf = (fp) => sha256Of(fs.readFileSync(fp))

    //ensureSeed, 備妥seedRoot(官方預建檔之快取, 其結構即鏡像結構): 首案(②)成功即已備妥, 單獨以--grep執行其他案時於此連網預取一次(WCanvas.ensureBins, 不放置到canvas)
    let seedPromise = null
    let ensureSeed = () => {
        if (seedPromise === null) {
            seedPromise = (async() => {
                if (fs.existsSync(seedGroup)) {
                    return
                }
                let r = await run(newPkg('seed'), { cache: seedRoot, block: false, cfg: { call: 'ensureBins' } })
                assert.strict.equal(r.result.ok, true, r.out.slice(-1500))
            })()
        }
        return seedPromise
    }

    //checkFolder, 資料夾內恰為清單之45檔且各檔sha256與大小相符(無暫存檔、無多餘檔); relBase為清單路徑相對之資料夾
    let checkFolder = (fdBase, title) => {
        assert.strict.deepStrictEqual(fs.readdirSync(path.join(fdBase, 'build', 'Release')).sort(), names, title)
        for (let m of members) {
            let fp = path.join(fdBase, ...m.path.split('/'))
            assert.strict.equal(fs.statSync(fp).size, m.size, `${title}: ${m.path}`)
            assert.strict.equal(hashOf(fp), m.sha256, `${title}: ${m.path}`)
        }
    }

    //checkPng, 輸出為可解碼之非空PNG: 尺寸240x80, 藍色矩形之中心為#1976d2, 矩形為3600像素, 中文區與英文區皆有深色像素
    let checkPng = (r, title) => {
        assert.strict.deepStrictEqual(r.result.exports, { createCanvas: 'function', loadImage: 'function', registerFont: 'function' }, title)
        assert.strict.deepStrictEqual(r.result.img, { width: 240, height: 80 }, title) //canvas自身之loadImage可讀回
        let buf = Buffer.from(r.result.png, 'base64')
        assert.strict.equal(buf.length > 1000, true, title)
        let img = decodePng(buf)
        assert.strict.deepStrictEqual([img.width, img.height], [240, 80], title)
        assert.strict.deepStrictEqual(pixelAt(img, 40, 40), [25, 118, 210, 255], title)
        assert.strict.equal(countDark(img, 250, 10, 10, 70, 70), 3600, title)
        assert.strict.equal(countDark(img, 128, 80, 20, 134, 60) > 100, true, `${title}: CJK text`)
        assert.strict.equal(countDark(img, 128, 140, 20, 240, 60) > 150, true, `${title}: latin text`)
        return img
    }

    before(function() {
        if (!onWin) {
            this.skip()
        }
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
    })

    afterEach(function() {
        for (let c of children) {
            try {
                c.cp.kill()
            }
            catch (err) {} // eslint-disable-line no-empty
        }
        children.length = 0
    })

    after(async function() {
        for (let c of children) {
            try {
                c.cp.kill()
            }
            catch (err) {} // eslint-disable-line no-empty
        }
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {} // eslint-disable-line no-empty
    })

    //②: 連網。清單說明: 首次調用下載官方資產並逐檔校驗、複製到canvas套件、載入、畫矩形與中英文字輸出PNG
    it(`should download the official asset on the first call, verify each file, place the 45 files into canvas build/Release, and draw a rectangle and Chinese and English text into a decodable PNG`, async function() {
        let pkg = newPkg('first')
        let log = path.join(fdt, 'first-fetch.log')
        let r = await run(pkg, { cache: seedRoot, block: false, log })
        assert.strict.equal(r.result.ok, true, r.out.slice(-1500))
        let ts = typesOf(r)
        assert.strict.equal(ts.includes('download') && ts.includes('downloaded') && ts.includes('extract') && ts.includes('publish') && ts.includes('ready'), true, ts.join())
        assert.strict.equal(eventOf(r, 'cache').hit, false)
        assert.strict.equal(eventOf(r, 'download').file, 'canvas-v3.2.3-napi-v7-win32-x64.tar.gz')
        assert.strict.equal(eventOf(r, 'downloaded').ok, true)
        assert.strict.equal(eventOf(r, 'publish').result, 'placed')
        assert.strict.deepStrictEqual(placedOf(r), { total: 45, copied: 45, skipped: 0, exists: 0 })

        //快取(整組45檔)與canvas套件之build/Release皆逐檔相符
        checkFolder(seedGroup, 'cache')
        checkFolder(pkg.fdCanvas, 'build/Release')
        assert.strict.equal(fs.existsSync(path.join(pkg.fdCanvas, 'build', 'binding.sln')), false) //建置中繼檔不放置
        checkPng(r, 'first')
        seedPromise = Promise.resolve() //其快取即為其後各案之鏡像來源
    })

    //③: 第二次呼叫自快取取得, 不再下載(事件斷言); 放置全略過; 輸出與首次相同
    it(`should take the second call from the cache without downloading, skip all 45 files, and render the same picture`, async function() {
        await ensureSeed()
        let pkg = newPkg('second')
        let r1 = await run(pkg, { cache: seedRoot, mirror: '', offline: false })
        assert.strict.equal(r1.result.ok, true, r1.out.slice(-1500))
        let log = path.join(fdt, 'second-fetch.log')
        let r2 = await run(pkg, { cache: seedRoot, mirror: '', offline: false, log })
        assert.strict.equal(r2.result.ok, true, r2.out.slice(-1500))
        let ts = typesOf(r2)
        assert.strict.equal(ts.some((v) => ['download', 'downloaded', 'extract', 'publish'].includes(v)), false, ts.join())
        assert.strict.equal(eventOf(r2, 'cache').hit, true)
        assert.strict.deepStrictEqual(placedOf(r1), { total: 45, copied: 45, skipped: 0, exists: 0 }) //首個行程之快取已備(②), 此為新套件根, 故放置45檔而未下載
        assert.strict.equal(typesOf(r1).includes('download'), false)
        assert.strict.deepStrictEqual(placedOf(r2), { total: 45, copied: 0, skipped: 45, exists: 0 })
        assert.strict.equal(fs.existsSync(log), false) //未發出任何網路請求(守門記錄為空)
        let a = checkPng(r1, 'r1')
        let b = checkPng(r2, 'r2')
        assert.strict.equal(Buffer.compare(a.data, b.data), 0) //同機同字型之輸出為決定性
    })

    //④-a: 離線且快取為空、無鏡像: E_OFFLINE_MISSING, 列出缺之組, 不連網、不放置
    it(`should reject E_OFFLINE_MISSING when offline with an empty cache and no mirror, without network nor placement`, async function() {
        let pkg = newPkg('offlineMissing')
        let cache = newDir('emptyCache')
        let log = path.join(fdt, 'offline-fetch.log')
        let r = await run(pkg, { cache, mirror: '', offline: true, log })
        assert.strict.equal(r.result.ok, false)
        assert.strict.equal(r.result.code, 'E_OFFLINE_MISSING', r.result.message)
        assert.strict.equal(r.result.missing[0].name, 'canvas')
        assert.strict.equal(r.result.message.includes(path.join(cache, 'w-canvas', bundleId)), true, r.result.message) //應放之快取路徑
        assert.strict.equal(r.result.message.includes('canvas.node') && r.result.message.includes(members[0].sha256), true, r.result.message) //缺之檔名與sha256
        assert.strict.equal(fs.existsSync(log), false)
        assert.strict.equal(fs.existsSync(path.join(pkg.fdCanvas, 'build')), false)
    })

    //④-b: 以預取之快取為鏡像(W_BIN_MIRROR)離線取得: 不下載、快取補齊、放置並載入
    it(`should work offline from the prefetched cache used as the mirror (W_BIN_MIRROR), without downloading`, async function() {
        await ensureSeed()
        let pkg = newPkg('offlineMirror')
        let cache = newDir('cacheFromMirror')
        let log = path.join(fdt, 'mirror-fetch.log')
        let r = await run(pkg, { cache, mirror: seedRoot, offline: true, log })
        assert.strict.equal(r.result.ok, true, r.out.slice(-1500))
        let ts = typesOf(r)
        assert.strict.equal(ts.includes('download') || ts.includes('extract'), false, ts.join())
        assert.strict.equal(ts.includes('mirror') && ts.includes('publish'), true, ts.join())
        assert.strict.equal(fs.existsSync(log), false)
        checkFolder(path.join(cache, 'w-canvas', bundleId), 'cache from mirror')
        checkFolder(pkg.fdCanvas, 'build/Release')
        checkPng(r, 'mirror')
    })

    //④-c: 鏡像之檔被竄改: 拒用(清單校驗), 離線時E_OFFLINE_MISSING, 不放置
    it(`should refuse a mirror whose file was tampered with, even offline`, async function() {
        await ensureSeed()
        let pkg = newPkg('mirrorTamper')
        let cache = newDir('cacheMT')
        let mirror = newDir('mirrorMT')
        fs.cpSync(seedRoot, mirror, { recursive: true })
        let fp = path.join(mirror, 'w-canvas', bundleId, 'build', 'Release', 'libglib-2.0-0.dll')
        let b = fs.readFileSync(fp)
        b[1000] = b[1000] ^ 0xff
        fs.writeFileSync(fp, b)
        let r = await run(pkg, { cache, mirror, offline: true })
        assert.strict.equal(r.result.ok, false)
        assert.strict.equal(r.result.code, 'E_OFFLINE_MISSING', r.result.message)
        assert.strict.equal(fs.existsSync(path.join(pkg.fdCanvas, 'build')), false)
        assert.strict.equal(fs.existsSync(path.join(cache, 'w-canvas', bundleId)), false) //不留不符之檔
    })

    //⑤: 兩個行程(另加一個)同時首次呼叫: 皆成功, 無半檔; 重複數輪(每輪全新之快取與canvas資料夾)
    it(`should succeed in every process when several processes call it for the first time at the same time, never reading a partial file`, async function() {
        await ensureSeed()
        for (let round = 1; round <= 3; round++) {
            let pkg = newPkg(`race${round}`)
            let cache = newDir(`cacheRace${round}`)
            let cs = [0, 1, 2].map(() => spawn(pkg, { cache, mirror: seedRoot, offline: true, cfg: { waitGo: true } }))
            for (let c of cs) {
                assert.strict.equal(await c.ready, true)
            }
            for (let c of cs) {
                c.go() //事件閘門: 全數就緒後同時放行
            }
            let rs = await Promise.all(cs.map((c) => c.done))
            let pids = new Set()
            for (let r of rs) {
                assert.strict.equal(r.timedOut, false)
                assert.strict.equal(r.code, 0, r.out.slice(-800))
                assert.strict.equal(r.result.ok, true, `round ${round}: ${r.out.slice(-1500)}`)
                let p = placedOf(r)
                assert.strict.equal(p.total, 45)
                assert.strict.equal(p.copied + p.skipped + p.exists, 45)
                checkPng(r, `race ${round}`)
                pids.add(r.result.pid)
            }
            assert.strict.equal(pids.size, 3) //確為不同行程
            //每檔至少由一個行程放置
            assert.strict.equal(rs.reduce((a, r) => a + placedOf(r).copied + placedOf(r).exists, 0) >= 45, true)
            checkFolder(pkg.fdCanvas, `race ${round} build/Release`)
            checkFolder(path.join(cache, 'w-canvas', bundleId), `race ${round} cache`)
            assert.strict.deepStrictEqual(fs.readdirSync(path.join(cache, 'w-canvas')), [bundleId]) //無遺留之暫存夾
        }
    })

    //⑥: 竄改快取中任一檔(dll、canvas.node、刪除、截斷)後再呼叫: 偵測並自鏡像重取整組, 快取還原
    it(`should detect a tampered, truncated or deleted file in the cache and fetch the whole bundle again`, async function() {
        await ensureSeed()
        let cache = newDir('cacheTamper')
        fs.cpSync(path.join(seedRoot, 'w-canvas'), path.join(cache, 'w-canvas'), { recursive: true })
        let group = path.join(cache, 'w-canvas', bundleId)
        let cases = [
            ['flip a byte of a dll', 'libcairo-2.dll', (fp) => {
                let b = fs.readFileSync(fp)
                b[5000] = b[5000] ^ 0xff
                fs.writeFileSync(fp, b)
            }],
            ['truncate canvas.node', 'canvas.node', (fp) => fs.truncateSync(fp, 100)],
            ['delete a dll', 'libpango-1.0-0.dll', (fp) => fs.rmSync(fp)],
        ]
        for (let [title, name, mutate] of cases) {
            mutate(path.join(group, 'build', 'Release', name))
            let pkg = newPkg('cacheTamperRun')
            let r = await run(pkg, { cache, mirror: seedRoot, offline: true })
            assert.strict.equal(r.result.ok, true, `${title}: ${r.out.slice(-1500)}`)
            assert.strict.equal(eventOf(r, 'cache').hit, false, title)
            assert.strict.equal(eventOf(r, 'publish').result, 'replaced', title)
            assert.strict.equal(typesOf(r).includes('download'), false, title)
            checkFolder(group, `${title}: cache`)
            checkFolder(pkg.fdCanvas, `${title}: build/Release`)
            checkPng(r, title)
        }
    })

    //⑦: build/Release之檔被竄改或缺漏: 再呼叫時只補正有問題之檔
    it(`should repair only the tampered or missing files of build/Release on the next call`, async function() {
        await ensureSeed()
        let pkg = newPkg('repair')
        let cache = newDir('cacheRepair')
        let r1 = await run(pkg, { cache, mirror: seedRoot, offline: true })
        assert.strict.equal(r1.result.ok, true, r1.out.slice(-1500))
        let fd = path.join(pkg.fdCanvas, 'build', 'Release')
        let b = fs.readFileSync(path.join(fd, 'libfreetype-6.dll'))
        b[3000] = b[3000] ^ 0xff
        fs.writeFileSync(path.join(fd, 'libfreetype-6.dll'), b) //同大小竄改
        fs.rmSync(path.join(fd, 'libwebp-7.dll')) //缺漏
        fs.truncateSync(path.join(fd, 'canvas.node'), 0) //截斷
        let r2 = await run(pkg, { cache, mirror: seedRoot, offline: true })
        assert.strict.equal(r2.result.ok, true, r2.out.slice(-1500))
        let places = r2.result.events.filter((e) => e.type === 'canvas-place')
        assert.strict.deepStrictEqual(places.filter((e) => e.result === 'copy').map((e) => path.posix.basename(e.path)).sort(), ['canvas.node', 'libfreetype-6.dll', 'libwebp-7.dll'])
        assert.strict.equal(places.filter((e) => e.result === 'skip').length, 42)
        checkFolder(pkg.fdCanvas, 'repaired')
        checkPng(r2, 'repaired')
    })

    //被其他行程載入而無法覆蓋(Windows之DLL鎖, 如換版時舊版canvas.node仍在執行): E_BIN_LOCKED, 目標不被改; 該行程結束後可覆蓋
    it(`should reject E_BIN_LOCKED while another process has loaded the file, leaving it intact, and replace it once that process ends`, async function() {
        await ensureSeed()
        let pkg = newPkg('lock')
        let cache = newDir('cacheLock')
        let holder = spawn(pkg, { cache, mirror: seedRoot, offline: true, cfg: { hold: true } })
        assert.strict.equal(await holder.held, true) //已載入canvas.node與其dll並持有
        let fpNode = path.join(pkg.fdCanvas, 'build', 'Release', 'canvas.node')
        assert.strict.equal(hashOf(fpNode), members.find((v) => v.path.endsWith('canvas.node')).sha256)

        //「新版」之canvas.node(內容不同): 以其為期望值呼叫放置步驟
        let fpNew = path.join(newDir('newNode'), 'canvas.node')
        let bytesNew = Buffer.from('new-version-of-canvas.node')
        fs.writeFileSync(fpNew, bytesNew)
        let group = path.join(seedGroup)
        let files = members.map((m) => {
            if (m.path.endsWith('canvas.node')) {
                return { path: m.path, sha256: sha256Of(bytesNew), size: bytesNew.length, from: fpNew }
            }
            return { path: m.path, sha256: m.sha256, size: m.size, from: path.join(group, ...m.path.split('/')) }
        })
        let err = null
        try {
            await placeBins(files, pkg.fdCanvas, { attempts: 2, delayMs: 1 })
        }
        catch (e) {
            err = e
        }
        assert.strict.equal(err && err.code, 'E_BIN_LOCKED', err && err.message)
        assert.strict.equal(err.target, fpNode)
        assert.strict.equal(err.message.includes(fpNode) && /Stop every process/.test(err.message), true, err.message)
        assert.strict.equal(hashOf(fpNode), members.find((v) => v.path.endsWith('canvas.node')).sha256) //目標未被改
        assert.strict.equal(fs.readdirSync(path.dirname(fpNode)).some((n) => n.endsWith('.tmp')), false)

        //持有者結束後即可覆蓋
        holder.release()
        let rh = await holder.done
        assert.strict.equal(rh.code, 0, rh.out.slice(-800))
        assert.strict.equal(rh.result.ok, true)
        let r = await placeBins(files, pkg.fdCanvas, { attempts: 2, delayMs: 1 })
        assert.strict.deepStrictEqual(r, { total: 45, copied: 1, skipped: 44, exists: 0 })
        assert.strict.equal(fs.readFileSync(fpNode, 'utf8'), 'new-version-of-canvas.node')
    })

    //部署前預取(O4): WCanvas.ensureBins把官方預建檔取至W_BIN_CACHE之資料夾(不放置到canvas), 該資料夾即可作為離線鏡像
    it(`should prefetch with WCanvas.ensureBins into W_BIN_CACHE without touching canvas, and the folder works as the offline mirror`, async function() {
        await ensureSeed()
        let pkgPre = newPkg('prefetch')
        let cachePre = newDir('cachePrefetch')
        let r = await run(pkgPre, { cache: cachePre, mirror: seedRoot, offline: true, cfg: { call: 'ensureBins' } })
        assert.strict.equal(r.result.ok, true, r.out.slice(-1500))
        assert.strict.equal(r.result.bins.canvas, path.join(cachePre, 'w-canvas', bundleId))
        assert.strict.deepStrictEqual([...r.result.bins.files].sort(), members.map((v) => v.path).sort())
        assert.strict.equal(fs.existsSync(path.join(pkgPre.fdCanvas, 'build')), false) //只取至快取, 不放置
        checkFolder(r.result.bins.canvas, 'prefetched')

        //以預取之資料夾為鏡像, 全離線: 新套件根取得、放置並載入
        let pkg = newPkg('prefetchUse')
        let log = path.join(fdt, 'prefetch-fetch.log')
        let r2 = await run(pkg, { cache: newDir('cachePrefetchUse'), mirror: cachePre, offline: true, log })
        assert.strict.equal(r2.result.ok, true, r2.out.slice(-1500))
        assert.strict.equal(fs.existsSync(log), false)
        checkPng(r2, 'prefetch mirror')
    })

    //UMD建置(dist/w-canvas.umd.js, package.json之main)配真實canvas: require載入後取得、放置、載入並出圖(自本套件src建出至測試暫存夾, 不改寫repo之dist/)
    it(`should work from the UMD build (dist/w-canvas.umd.js) with the real canvas: require, place, load and draw`, async function() {
        await ensureSeed()
        let fdBuild = newDir('umdBuild')
        fs.mkdirSync(path.join(fdBuild, 'toolg'), { recursive: true })
        fs.cpSync(path.resolve('src'), path.join(fdBuild, 'src'), { recursive: true })
        fs.copyFileSync(path.resolve('toolg/gDistRollup.mjs'), path.join(fdBuild, 'toolg', 'gDistRollup.mjs'))
        fs.copyFileSync(path.resolve('package.json'), path.join(fdBuild, 'package.json'))
        let b = spawnSync(process.execPath, ['toolg/gDistRollup.mjs'], { cwd: fdBuild, encoding: 'utf8', timeout: 300000, windowsHide: true })
        assert.strict.equal(b.status, 0, `${b.stdout}${b.stderr}`.slice(-800))
        let pkg = newPkg('umd')
        fs.mkdirSync(path.join(pkg.fdPkg, 'dist'), { recursive: true })
        let fpDist = path.join(pkg.fdPkg, 'dist', 'w-canvas.umd.js')
        fs.copyFileSync(path.join(fdBuild, 'dist', 'w-canvas.umd.js'), fpDist)
        fs.rmSync(path.join(pkg.fdPkg, 'src'), { recursive: true, force: true }) //裝在專案內者只有dist
        let r = await run(pkg, { cache: newDir('cacheUmd'), mirror: seedRoot, offline: true, cfg: { mod: fpDist, cjs: true } })
        assert.strict.equal(r.result.ok, true, r.out.slice(-1500))
        assert.strict.deepStrictEqual(placedOf(r), { total: 45, copied: 45, skipped: 0, exists: 0 })
        checkFolder(pkg.fdCanvas, 'umd build/Release')
        checkPng(r, 'umd')
    })

    //預設快取位置: 套件根之bin-cache/(與當前工作路徑無關), 不寫入工作目錄
    it(`should keep the default cache under the package root whatever the working directory, and not write into it`, async function() {
        await ensureSeed()
        let pkg = newPkg('defaultCache')
        let cwd = newDir('cwdOther')
        let r = await run(pkg, { cwd, cache: undefined, mirror: seedRoot, offline: true })
        assert.strict.equal(r.result.ok, true, r.out.slice(-1500))
        assert.strict.equal(r.result.cwd, cwd)
        checkFolder(path.join(pkg.fdPkg, 'bin-cache', bundleId), 'default cache')
        assert.strict.deepStrictEqual(fs.readdirSync(cwd), [])
    })

})
