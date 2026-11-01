//產生bin/manifest.json(規格M1、M6: 依官方預建檔之實際內容計算sha256與大小, 不手寫)
//用法: node toolg/genBinManifest.mjs [--fp <本機已下載之官方預建檔>]
//      未給--fp時自url下載至./tmp/genBinManifest/(15MB), 下載後須符合GitHub release API公告之asset digest(規格M3), 取不到公告時於清單note載明「首次下載自算」
//流程(規格U3): 升canvas版本時, 同時改package.json之dependencies.canvas(確切版本)並重跑本工具 → 跑測試(含unit-binManifest) → 發布新版(預建檔須與canvas之JS同版)
//壓縮檔之成員以Windows內建tar.exe(System32, bsdtar)解至./tmp/genBinManifest/計算(Git Bash之tar為GNU tar, 不支援zip), 結束時刪除
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { execFileSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'


//---- 本套件之設定(只改這段) ----

//mode, 'pinned'(釘選模式: 廠商檔網址釘到版本標籤)
let mode = 'pinned'

//bundles, 檔案組(規格M6: canvas.node須與其dll相鄰, 皆置於canvas套件之build/Release), 鍵為組名(結果物件之鍵):
//  { url(版本標籤之資產網址), note, include(壓縮檔內之路徑是否列入) }
//  官方預建檔另含建置中繼檔(binding.sln、canvas.vcxproj、canvas.vcxproj.filters、config.gypi), 與執行無關, 不列入
let bundles = (version) => {
    let asset = `canvas-v${version}-napi-v7-win32-x64.tar.gz`
    return {
        'canvas': {
            asset,
            url: `https://github.com/Automattic/node-canvas/releases/download/v${version}/${asset}`,
            include: (rel) => {
                let m = /^build\/Release\/([^/]+)$/.exec(rel)
                return m !== null && (m[1] === 'canvas.node' || m[1].endsWith('.dll'))
            },
        },
    }
}

//---- 以下不需修改 ----

let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
let version = pkg.dependencies.canvas
if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.log(`package.json dependencies.canvas must be an exact version: ${version}`)
    process.exit(1)
}

let i = process.argv.indexOf('--fp')
let fpGiven = i >= 0 ? String(process.argv[i + 1] || '') : ''

let pick = (e) => {
    return { sha256: e.sha256, size: e.size }
}
//walk, 資料夾內全部一般檔之相對路徑(/分隔, 排序)
let walk = (fd) => {
    let r = []
    let f = (d, rel) => {
        for (let n of fs.readdirSync(d).sort()) {
            let p = path.join(d, n)
            let q = rel ? `${rel}/${n}` : n
            let st = fs.lstatSync(p)
            if (st.isDirectory()) {
                f(p, q)
            }
            else if (st.isFile()) {
                r.push(q)
            }
            else {
                throw new Error(`not a regular file: ${p}`)
            }
        }
    }
    f(fd, '')
    return r
}
//fdWork, 下載與解壓之暫存夾(cwd相對, 結束時刪除)
let fdWork = path.resolve('./tmp/genBinManifest')
//untar, 以System32之tar.exe把壓縮檔解至暫存夾, 回傳成員所在資料夾fdX; tar之參數一律為暫存夾內之相對路徑(工作目錄設為暫存夾)
let tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar'
let untar = (fpArchive) => {
    let fd = path.join(fdWork, 'x')
    fs.rmSync(fd, { recursive: true, force: true })
    fs.mkdirSync(fd, { recursive: true })
    let rel = path.join('..', path.basename(fpArchive))
    if (path.dirname(fpArchive) !== fdWork) {
        fs.copyFileSync(fpArchive, path.join(fdWork, path.basename(fpArchive)))
    }
    execFileSync(tarExe, ['-x', '-f', rel, '-C', '.'], { cwd: fd, windowsHide: true })
    return fd
}
//download, 自url下載至暫存夾(本工具之下載, 非執行期; 套件執行期之下載一律經wsemi之fsEnsureBins)
let download = async (url, fp) => {
    let res = await fetch(url)
    if (!res.ok) {
        throw new Error(`download failed: ${res.status} ${url}`)
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(fp))
}
//sha256Of
let sha256Of = async (fp) => {
    let h = crypto.createHash('sha256')
    let size = 0
    for await (let chunk of fs.createReadStream(fp)) {
        size += chunk.length
        h.update(chunk)
    }
    return { sha256: h.digest('hex'), size }
}
//digestOf, GitHub release API公告之asset digest(規格M3), 取不到回傳null
let digestOf = async (tag, asset) => {
    try {
        let res = await fetch(`https://api.github.com/repos/Automattic/node-canvas/releases/tags/${tag}`, { headers: { 'Accept': 'application/vnd.github+json' } })
        if (!res.ok) {
            return null
        }
        let j = await res.json()
        let a = (j.assets || []).find((v) => v.name === asset)
        let m = a && /^sha256:([0-9a-f]{64})$/.exec(String(a.digest || ''))
        return m ? { sha256: m[1], size: a.size } : null
    }
    catch (err) {
        return null
    }
}

let bundleList = []

try {
    fs.rmSync(fdWork, { recursive: true, force: true })
    fs.mkdirSync(fdWork, { recursive: true })

    for (let [name, b] of Object.entries(bundles(version))) {

        //壓縮檔(官方預建檔)
        let fp = fpGiven
        if (fp === '') {
            fp = path.join(fdWork, b.asset)
            await download(b.url, fp)
        }
        let src = await sha256Of(fp)

        //M3: 以廠商公告之digest核對, 取不到時於note載明
        let dg = await digestOf(`v${version}`, b.asset)
        let note = ''
        if (dg !== null) {
            if (dg.sha256 !== src.sha256 || dg.size !== src.size) {
                throw new Error(`the archive does not match the digest published by GitHub: ${src.sha256}(${src.size}) vs ${dg.sha256}(${dg.size})`)
            }
            note = '官方預建檔(Automattic/node-canvas), SHA-256與大小已以GitHub release API公告之asset digest核對; 只列執行需要之canvas.node與dll, 建置中繼檔(binding.sln等)不列入'
        }
        else {
            note = `官方預建檔(Automattic/node-canvas), SHA-256首次下載自算(${new Date().toISOString().slice(0, 10)}), GitHub未公告digest; 只列執行需要之canvas.node與dll, 建置中繼檔(binding.sln等)不列入`
        }

        //成員(include過濾)
        let fdX = untar(fp)
        let files = []
        for (let rel of walk(fdX)) {
            if (!b.include(rel)) {
                continue
            }
            let e = await fsGetBinManifestEntry(path.join(fdX, ...rel.split('/')), { name: null, path: rel })
            files.push({ path: e.path, ...pick(e) })
        }
        if (files.length === 0 || !files.some((v) => v.path === 'build/Release/canvas.node')) {
            throw new Error('canvas.node is not in the archive')
        }

        bundleList.push({
            name,
            archives: [{
                url: b.url,
                ...pick(src),
                extract: { type: 'tgz', files },
                note,
            }],
        })
    }
}
finally {
    fs.rmSync(fdWork, { recursive: true, force: true })
}

//version為內附預建檔之版本(canvas之版本), 執行期須與已安裝之canvas套件同版
let manifest = { schema: 1, pkg: pkg.name, mode, repo: `yuda-lyu/${pkg.name}`, version, bundles: bundleList }
fs.writeFileSync('bin/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`bin/manifest.json: ${bundleList.length} bundle(s), ${bundleList[0].archives[0].extract.files.length} file(s), canvas ${version}`)
