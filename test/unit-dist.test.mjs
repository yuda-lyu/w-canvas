import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { builtinModules, createRequire } from 'module'
import { spawnSync } from 'child_process'
import { makeFakeBundle } from './tools/fakeBundle.mjs'
import { makeFakePkg } from './tools/fakePkg.mjs'
import spawnChild from './tools/child.mjs'


//由現行src建出dist至test/_tmp(不改寫repo之dist/): 離開碼0、無無法解析之引入; 語法錯以非0結束; 外部模組⊆Node內建∪dependencies;
//dist可載入, 且裝在專案內(套件根為其node_modules/w-canvas)自子資料夾之工作目錄調用時, 預建檔取至其套件根之bin-cache/並放置到canvas套件(假組與假canvas, 以本地鏡像離線供檔)
describe(`unit-dist`, function() {
    this.timeout(300000)

    let onWin = process.platform === 'win32'
    let fdTest = path.resolve('./test/_tmp/dist')
    let fdRepo = path.resolve('.')
    let fdOk = null
    let resOk = null

    let prep = (name, mutate = null) => {
        let fd = path.join(fdTest, name)
        fs.mkdirSync(path.join(fd, 'src'), { recursive: true })
        fs.mkdirSync(path.join(fd, 'toolg'), { recursive: true })
        for (let fn of fs.readdirSync(path.join(fdRepo, 'src'))) {
            fs.copyFileSync(path.join(fdRepo, 'src', fn), path.join(fd, 'src', fn))
        }
        fs.copyFileSync(path.join(fdRepo, 'toolg', 'gDistRollup.mjs'), path.join(fd, 'toolg', 'gDistRollup.mjs'))
        fs.copyFileSync(path.join(fdRepo, 'package.json'), path.join(fd, 'package.json'))
        if (mutate) {
            let fp = path.join(fd, 'src', 'WCanvas.mjs')
            fs.writeFileSync(fp, mutate(fs.readFileSync(fp, 'utf8')))
        }
        return fd
    }

    let build = (fd) => {
        let r = spawnSync(process.execPath, ['toolg/gDistRollup.mjs'], { cwd: fd, encoding: 'utf8', timeout: 300000, windowsHide: true })
        return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
    }

    before(function() {
        fs.rmSync(fdTest, { recursive: true, force: true })
        fdOk = prep('ok')
        resOk = build(fdOk)
    })

    after(function() {
        fs.rmSync(fdTest, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        try {
            fs.rmdirSync(path.resolve('./test/_tmp')) //尚有其他測試之暫存時非空, 略過
        }
        catch (err) {} // eslint-disable-line no-empty
    })

    it('build exits 0 without unresolved imports and writes dist/w-canvas.umd.js', function() {
        assert.strict.equal(resOk.code, 0, resOk.out.slice(-1000))
        assert.ok(!/could not be resolved/.test(resOk.out), resOk.out)
        assert.ok(!/invalid runin/.test(resOk.out), resOk.out)
        assert.ok(fs.existsSync(path.join(fdOk, 'dist', 'w-canvas.umd.js')))
    })

    it('build of a source with a syntax error exits non-zero', function() {
        let fd = prep('syntax', (c) => c.replace('let nameBundle = \'canvas\'', 'let nameBundle = = \'canvas\''))
        let r = build(fd)
        assert.strict.equal(r.code, 1, r.out.slice(-500))
    })

    it('external modules are node builtins or declared dependencies, and canvas is not required by name (it is loaded by the path it was placed into)', function() {
        let c = fs.readFileSync(path.join(fdOk, 'dist', 'w-canvas.umd.js'), 'utf8')
        let reqs = [...new Set([...c.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))]
        let deps = Object.keys(JSON.parse(fs.readFileSync(path.join(fdRepo, 'package.json'), 'utf8')).dependencies)
        let bad = reqs.filter((m) => !builtinModules.includes(m) && !deps.includes(m))
        assert.ok(reqs.length > 0)
        assert.strict.deepStrictEqual(bad, [])
        assert.strict.equal(reqs.includes('canvas'), false)
    })

    it('no top-level __filename/__dirname declarations and import.meta only uses url in src', function() {
        for (let fn of fs.readdirSync(path.join(fdRepo, 'src'))) {
            let c = fs.readFileSync(path.join(fdRepo, 'src', fn), 'utf8')
            assert.ok(!/^\s*(export\s+)?(let|const|var)\s+__(filename|dirname)\b/m.test(c), fn)
            assert.ok(!/import\.meta\.(dirname|filename|resolve)/.test(c), fn)
        }
    })

    it('dist loads (require) as a function with the static ensureBins', function() {
        let W = createRequire(import.meta.url)(path.join(fdOk, 'dist', 'w-canvas.umd.js'))
        assert.strict.equal(typeof W, 'function')
        assert.strict.equal(typeof W.ensureBins, 'function')
        assert.strict.deepStrictEqual(Object.keys(W), ['ensureBins'])
    })

    it('dist installed in a project takes the bundle by ensureBins into the cache under its package root from a subfolder cwd, places it into canvas and loads canvas', async function() {
        if (!onWin) {
            this.skip()
        }
        let fb = makeFakeBundle(path.join(fdTest, 'cons'))
        let fdPkg = path.join(fdTest, 'cons', 'proj', 'node_modules', 'w-canvas')
        let fdSub = path.join(fdTest, 'cons', 'proj', 'sub')
        let fdMirror = path.join(fdTest, 'cons', 'mirror')
        let pkg = makeFakePkg(fdPkg, { manifest: fb.manifest, canvas: 'stub' })
        fs.rmSync(path.join(fdPkg, 'src'), { recursive: true, force: true }) //裝在專案內者只有dist
        fs.mkdirSync(path.join(fdPkg, 'dist'), { recursive: true })
        fs.mkdirSync(fdSub, { recursive: true })
        let fpDist = path.join(fdPkg, 'dist', 'w-canvas.umd.js')
        fs.copyFileSync(path.join(fdOk, 'dist', 'w-canvas.umd.js'), fpDist)

        //鏡像: <鏡像>/w-canvas/<壓縮檔sha256>/<檔名>(壓縮檔)
        let fdA = path.join(fdMirror, 'w-canvas', fb.manifest.bundles[0].archives[0].sha256)
        fs.mkdirSync(fdA, { recursive: true })
        fs.writeFileSync(path.join(fdA, fb.nameAsset), fb.tgz)

        let c = spawnChild({ mod: fpDist, cjs: true, draw: false, opt: { platform: 'win32', arch: 'x64' } }, { cwd: fdSub, env: { W_BIN_MIRROR: fdMirror, W_BIN_OFFLINE: '1', W_BIN_CACHE: undefined } })
        let r = await c.done
        assert.ok(r.result, r.out.slice(-800))
        assert.strict.equal(r.result.ok, true, JSON.stringify(r.result).slice(0, 800))
        let placed = r.result.events.find((e) => e.type === 'canvas-placed')
        assert.strict.deepStrictEqual([placed.total, placed.copied], [3, 3])
        assert.strict.equal(r.result.events.some((e) => e.type === 'canvas-load' && e.ok === true), true)
        for (let m of fb.members) {
            let fpCache = path.join(fdPkg, 'bin-cache', fb.bundleId, ...m.path.split('/'))
            assert.strict.equal(Buffer.compare(fs.readFileSync(fpCache), m.bytes), 0, `cache ${m.path}`)
            let fpPlaced = path.join(pkg.fdCanvas, ...m.path.split('/'))
            assert.strict.equal(Buffer.compare(fs.readFileSync(fpPlaced), m.bytes), 0, `placed ${m.path}`)
        }
        assert.strict.deepStrictEqual(fs.readdirSync(fdSub), []) //不寫入工作目錄
    })

})
