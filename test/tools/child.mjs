//子行程工具: 以明確cwd與env啟動node子行程(腳本預設為childWCanvas.mjs), 預設預載fetch守門(fetchBlock.mjs, 對外fetch一律拋錯並記錄),
//以事件同步而非等待時間: ready(輸出READY行)、go(寫入一行使子行程開始)、release(關閉stdin使持有中之子行程結束)、done(結束後之{ code, result, out })
import path from 'path'
import { spawn } from 'child_process'
import { pathToFileURL, fileURLToPath } from 'url'


let fdTools = path.dirname(fileURLToPath(import.meta.url))
let fpChildDefault = path.join(fdTools, 'childWCanvas.mjs')


/**
 * @param {Object} cfg 傳給子行程之設定(JSON, 經環境變數CHILD_CFG)
 * @param {Object} [opt={}]
 * @param {String} [opt.script] 子行程腳本, 預設childWCanvas.mjs
 * @param {String} [opt.cwd] 工作目錄
 * @param {Object} [opt.env] 額外環境變數(值為undefined者自繼承環境移除)
 * @param {Boolean} [opt.block=true] 是否預載fetch守門
 * @param {Number} [opt.timeoutMs=170000] 逾時即終止
 * @returns {Object} { cp, ready(輸出READY行), held(輸出HOLD行: 已完成並持有載入之canvas), go, release, done }
 */
function spawnChild(cfg, opt = {}) {
    let { script = fpChildDefault, cwd = process.cwd(), env = {}, block = true, timeoutMs = 170000 } = opt
    let imports = block ? ['--import', pathToFileURL(path.join(fdTools, 'fetchBlock.mjs')).href] : []
    let envAll = { ...process.env, ...env, CHILD_CFG: JSON.stringify(cfg) }
    for (let k of Object.keys(env)) {
        if (env[k] === undefined) {
            delete envAll[k]
        }
    }
    let cp = spawn(process.execPath, [...imports, script], { cwd, env: envAll, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let resolveReady = null
    let ready = new Promise((resolve) => {
        resolveReady = resolve
    })
    let resolveHeld = null
    let held = new Promise((resolve) => {
        resolveHeld = resolve
    })
    let onData = (d) => {
        out += d
        if (/^READY\r?$/m.test(out)) {
            resolveReady(true)
        }
        if (/^HOLD\r?$/m.test(out)) {
            resolveHeld(true)
        }
    }
    cp.stdout.on('data', onData)
    cp.stderr.on('data', (d) => {
        out += d
    })
    cp.stdin.on('error', () => {}) //子行程已結束時寫入/關閉不拋錯
    let timedOut = false
    let timer = setTimeout(() => {
        timedOut = true
        cp.kill()
    }, timeoutMs)
    let done = new Promise((resolve) => {
        cp.on('close', (code) => {
            clearTimeout(timer)
            resolveReady(false)
            resolveHeld(false)
            let line = out.split('\n').reverse().find((l) => l.startsWith('RESULT '))
            let result = null
            if (line) {
                try {
                    result = JSON.parse(line.slice(7))
                }
                catch (err) {} // eslint-disable-line no-empty
            }
            resolve({ code, timedOut, result, out })
        })
    })
    return {
        cp,
        ready,
        held,
        go: () => {
            cp.stdin.write('go\n')
        },
        release: () => {
            cp.stdin.end()
        },
        done,
    }
}


export default spawnChild
