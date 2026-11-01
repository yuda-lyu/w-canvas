import fs from 'fs'
import path from 'path'


let fdRepo = path.resolve('.')


//stubIndex, 假canvas套件之index.js: 同真canvas, 載入時即讀build/Release/canvas.node(缺檔即拋錯), 並列出同夾之dll, 不載入原生模組; 環境變數W_CANVAS_STUB_FAIL為1時載入即拋錯(模擬放置後載入失敗)
let stubIndex = `'use strict'
if (process.env.W_CANVAS_STUB_FAIL === '1') {
    throw new Error('stub load failure')
}
const fs = require('fs')
const path = require('path')
const fd = path.join(__dirname, 'build', 'Release')
const node = fs.readFileSync(path.join(fd, 'canvas.node'))
const dlls = fs.readdirSync(fd).filter((n) => n.endsWith('.dll')).sort()
module.exports = {
    createCanvas: () => ({}),
    loadImage: () => ({}),
    registerFont: () => {},
    stub: true,
    nodeLength: node.length,
    dlls,
}
`


/**
 * 建立假套件根(內含本套件src/之副本, 使其以假套件根為套件根), 與其node_modules/canvas
 * @param {String} fdPkg 假套件根(建立於測試暫存夾內)
 * @param {Object} opt
 * @param {Object} opt.manifest 清單物件(寫為bin/manifest.json), 未給時複製本套件之bin/manifest.json
 * @param {String} [opt.canvas='stub'] 'stub'(假canvas, 不載入原生模組)、'real'(複製本套件node_modules/canvas之JS, 不含build/)、'none'(不建node_modules/canvas)
 * @param {String} [opt.stubVersion='3.2.3'] 假canvas之版本
 * @returns {Object} { fdPkg, fpMod(src/WCanvas.mjs), fdCanvas(node_modules/canvas), fdRelease(build/Release) }
 */
function makeFakePkg(fdPkg, opt = {}) {
    let { manifest = null, canvas = 'stub', stubVersion = '3.2.3' } = opt
    fs.mkdirSync(path.join(fdPkg, 'src'), { recursive: true })
    fs.mkdirSync(path.join(fdPkg, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(fdPkg, 'package.json'), JSON.stringify({ name: 'w-canvas', version: '0.0.0' }))
    for (let fn of fs.readdirSync(path.join(fdRepo, 'src'))) {
        fs.copyFileSync(path.join(fdRepo, 'src', fn), path.join(fdPkg, 'src', fn))
    }
    if (manifest) {
        fs.writeFileSync(path.join(fdPkg, 'bin', 'manifest.json'), JSON.stringify(manifest, null, 2))
    }
    else {
        fs.copyFileSync(path.join(fdRepo, 'bin', 'manifest.json'), path.join(fdPkg, 'bin', 'manifest.json'))
    }
    let fdCanvas = path.join(fdPkg, 'node_modules', 'canvas')
    if (canvas === 'stub') {
        fs.mkdirSync(fdCanvas, { recursive: true })
        fs.writeFileSync(path.join(fdCanvas, 'package.json'), JSON.stringify({ name: 'canvas', version: stubVersion, main: 'index.js' }))
        fs.writeFileSync(path.join(fdCanvas, 'index.js'), stubIndex)
    }
    else if (canvas === 'real') {
        fs.cpSync(path.join(fdRepo, 'node_modules', 'canvas'), fdCanvas, {
            recursive: true,
            filter: (src) => path.basename(src) !== 'build', //不含build/(真canvas於無預建檔時即無build/)
        })
    }
    return {
        fdPkg,
        fpMod: path.join(fdPkg, 'src', 'WCanvas.mjs'),
        fdCanvas,
        fdRelease: path.join(fdCanvas, 'build', 'Release'),
    }
}


export { makeFakePkg }
