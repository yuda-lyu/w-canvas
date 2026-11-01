import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'


//測試用: 小型假檔案組canvas(與bin/manifest.json之組canvas同形: 廠商版本標籤網址之tar.gz, extract.type為tgz, 組內路徑為build/Release/<檔>),
//以驗證放置、校驗、離線、竄改等邏輯而不必每案處理36MB之真組; canvas.node與dll之內容非原生模組(只供位元組比對, 不可載入)
//壓縮檔另含不列入清單之build/binding.sln(同真檔含建置中繼檔)
let tag = 'v3.2.3'
let nameAsset = `canvas-${tag}-napi-v7-win32-x64.tar.gz`
let urlAsset = `https://github.com/Automattic/node-canvas/releases/download/${tag}/${nameAsset}`


let sha256Of = (b) => {
    return crypto.createHash('sha256').update(b).digest('hex')
}


//fill, 決定性之內容(前綴＋重複位元組)
let fill = (prefix, n) => {
    let b = Buffer.alloc(n)
    for (let i = 0; i < n; i++) {
        b[i] = (i * 31 + prefix.length) % 251
    }
    Buffer.from(prefix).copy(b)
    return b
}


/**
 * 建立假檔案組
 * @param {String} fd 工作資料夾(建立於其下之tgz/)
 * @param {Object} [opt={}]
 * @param {String} [opt.version='3.2.3'] 清單之version
 * @returns {Object} { manifest(清單物件), tgz(壓縮檔位元組), nameAsset, urlAsset, members: [{ path, sha256, size, bytes }], bundleId }
 */
function makeFakeBundle(fd, opt = {}) {
    let { version = '3.2.3' } = opt
    let members = [
        { path: 'build/Release/canvas.node', bytes: fill('MZ-node', 3000) },
        { path: 'build/Release/liba-1.dll', bytes: fill('MZ-a', 2000) },
        { path: 'build/Release/libb-2.dll', bytes: fill('MZ-b', 1500) },
    ]
    let unlisted = [
        { path: 'build/binding.sln', bytes: Buffer.from('Microsoft Visual Studio Solution File\r\n') },
    ]

    //tgz, 以System32之tar.exe(bsdtar)建立, 參數皆為工作資料夾內之相對路徑
    let fdTgz = path.join(fd, 'tgz')
    fs.rmSync(fdTgz, { recursive: true, force: true })
    for (let m of [...members, ...unlisted]) {
        let fp = path.join(fdTgz, 'src', ...m.path.split('/'))
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, m.bytes)
    }
    let tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    execFileSync(tarExe, ['-c', '-z', '-f', '../fake.tgz', 'build'], { cwd: path.join(fdTgz, 'src'), windowsHide: true })
    let tgz = fs.readFileSync(path.join(fdTgz, 'fake.tgz'))
    fs.rmSync(fdTgz, { recursive: true, force: true })

    let ms = members.map((m) => ({ path: m.path, sha256: sha256Of(m.bytes), size: m.bytes.length, bytes: m.bytes }))
    let manifest = {
        schema: 1,
        pkg: 'w-canvas',
        mode: 'pinned',
        repo: 'yuda-lyu/w-canvas',
        version,
        bundles: [{
            name: 'canvas',
            archives: [{
                url: urlAsset,
                sha256: sha256Of(tgz),
                size: tgz.length,
                extract: { type: 'tgz', files: ms.map((m) => ({ path: m.path, sha256: m.sha256, size: m.size })) },
            }],
        }],
    }

    //bundleId, 組識別: 組內各檔依path排序後逐行'<sha256>  <path>\n'之SHA-256(規格M6)
    let lines = [...ms].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((m) => `${m.sha256}  ${m.path}\n`).join('')
    let bundleId = sha256Of(Buffer.from(lines))

    return { manifest, tgz, nameAsset, urlAsset, members: ms, bundleId }
}


export { makeFakeBundle, sha256Of }
