//子行程: 載入指定之WCanvas模組(CHILD_CFG.mod, 絕對路徑; cjs為true時以require載入UMD), 以CHILD_CFG.opt呼叫(另掛onTrace收集事件),
//成功時以回傳之canvas畫矩形與文字輸出PNG, 以一行 RESULT { ok, events, ... } 回報
//CHILD_CFG: { mod, cjs, opt, call('ensureBins'時改呼叫WCanvas.ensureBins), waitGo(先輸出READY並等父行程寫入一行再開始), hold(完成後輸出HOLD並持有已載入之canvas, 等stdin關閉才結束), text, draw }
import { pathToFileURL } from 'url'
import { createRequire } from 'module'


let cfg = JSON.parse(process.env.CHILD_CFG || '{}')


let readLine = () => {
    return new Promise((resolve) => {
        process.stdin.once('data', () => {
            process.stdin.destroy() //已收到放行訊號, 關閉stdin, 不使行程因父行程尚未關閉其管線而無法結束
            resolve()
        })
    })
}


let mod = cfg.cjs ? createRequire(import.meta.url)(cfg.mod) : (await import(pathToFileURL(cfg.mod).href)).default

if (cfg.waitGo) {
    console.log('READY')
    await readLine()
}

let events = []
let opt = { ...(cfg.opt || {}), onTrace: (e) => events.push(e) }
let r = await (cfg.call === 'ensureBins' ? mod.ensureBins(opt) : mod(opt))
    .then((C) => ({ ok: true, C }), (err) => ({ ok: false, err }))

let res = { ok: r.ok, pid: process.pid, cwd: process.cwd(), events }
if (r.ok && cfg.call === 'ensureBins') {
    res.bins = { canvas: r.C.canvas, files: Object.keys(r.C.bundles.canvas.files) }
}
else if (r.ok) {
    let C = r.C
    res.exports = { createCanvas: typeof C.createCanvas, loadImage: typeof C.loadImage, registerFont: typeof C.registerFont }
    if (cfg.draw !== false) {
        let text = typeof cfg.text === 'string' ? cfg.text : '測試 canvas'
        let canvas = C.createCanvas(240, 80)
        let ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 240, 80)
        ctx.fillStyle = '#1976d2'
        ctx.fillRect(10, 10, 60, 60)
        ctx.fillStyle = '#000000'
        ctx.font = '24px sans-serif'
        ctx.fillText(text, 80, 48)
        let buf = canvas.toBuffer('image/png')
        res.png = buf.toString('base64')
        let img = await C.loadImage(buf)
        res.img = { width: img.width, height: img.height }
    }
}
else {
    let err = r.err
    res.code = err && err.code
    res.message = String((err && err.message) || err)
    res.missing = err && err.missing ? err.missing.map((m) => ({ name: m.name, sha256: m.sha256, size: m.size, cachePath: m.cachePath, mirrorPath: m.mirrorPath })) : null
}
console.log('RESULT ' + JSON.stringify(res))

if (cfg.hold && r.ok) {
    console.log('HOLD')
    await new Promise((resolve) => {
        process.stdin.on('end', resolve)
        process.stdin.resume()
    })
}
