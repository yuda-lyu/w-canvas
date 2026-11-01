//fetch守門(以 --import 預載): 只允許連本機127.0.0.1/localhost, 其餘一律拋錯並記錄(環境變數FETCH_BLOCK_LOG), 確保子行程於「不得連網」之案例中永不自外部下載
import fs from 'fs'


let fetchOrig = globalThis.fetch
let fpLog = process.env.FETCH_BLOCK_LOG || ''


globalThis.fetch = async (input, init) => {
    let url = typeof input === 'string' ? input : String((input && input.url) || input)
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
        return fetchOrig(input, init)
    }
    if (fpLog) {
        try {
            fs.appendFileSync(fpLog, `${process.pid} ${url}\n`)
        }
        catch (err) {} // eslint-disable-line no-empty
    }
    throw new Error(`fetch blocked in test: ${url}`)
}
