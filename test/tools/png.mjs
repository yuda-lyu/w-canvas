//PNG 解碼(8-bit, color type 2/6, 非交錯), 供出圖測試以語意斷言(尺寸、非空白像素、區域內容)驗證輸出可解碼, 不逐位元比對
import zlib from 'zlib'


function paeth(a, b, c) {
    let p = a + b - c
    let pa = Math.abs(p - a)
    let pb = Math.abs(p - b)
    let pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) {
        return a
    }
    if (pb <= pc) {
        return b
    }
    return c
}


//decodePng, 回傳{ width, height, data(RGBA) }, 簽章不符或CRC外之結構錯誤即拋錯
export function decodePng(buf) {
    if (typeof buf === 'string') {
        buf = Buffer.from(buf, 'base64')
    }
    if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('not png')
    }
    let pos = 8
    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = 0
    let interlace = 0
    let idats = []
    let hasEnd = false
    while (pos < buf.length) {
        let len = buf.readUInt32BE(pos)
        let type = buf.subarray(pos + 4, pos + 8).toString('ascii')
        let data = buf.subarray(pos + 8, pos + 8 + len)
        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            bitDepth = data[8]
            colorType = data[9]
            interlace = data[12]
        }
        else if (type === 'IDAT') {
            idats.push(data)
        }
        else if (type === 'IEND') {
            hasEnd = true
            break
        }
        pos += 12 + len
    }
    if (!hasEnd) {
        throw new Error('png has no IEND')
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`unsupported png bitDepth[${bitDepth}] colorType[${colorType}] interlace[${interlace}]`)
    }
    let bpp = colorType === 6 ? 4 : 3
    let raw = zlib.inflateSync(Buffer.concat(idats))
    let stride = width * bpp
    let out = Buffer.alloc(width * height * 4)
    let prev = Buffer.alloc(stride)
    let cur = Buffer.alloc(stride)
    let p = 0
    for (let y = 0; y < height; y++) {
        let ft = raw[p++]
        raw.copy(cur, 0, p, p + stride)
        p += stride
        for (let x = 0; x < stride; x++) {
            let a = x >= bpp ? cur[x - bpp] : 0
            let b = prev[x]
            let c = x >= bpp ? prev[x - bpp] : 0
            let v = cur[x]
            if (ft === 1) {
                v = (v + a) & 255
            }
            else if (ft === 2) {
                v = (v + b) & 255
            }
            else if (ft === 3) {
                v = (v + ((a + b) >> 1)) & 255
            }
            else if (ft === 4) {
                v = (v + paeth(a, b, c)) & 255
            }
            cur[x] = v
        }
        for (let x = 0; x < width; x++) {
            let o = (y * width + x) * 4
            out[o] = cur[x * bpp]
            out[o + 1] = cur[x * bpp + 1]
            out[o + 2] = cur[x * bpp + 2]
            out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255
        }
        let t = prev
        prev = cur
        cur = t
    }
    return { width, height, data: out }
}


//pixelAt, 回傳[r, g, b, a]
export function pixelAt(img, x, y) {
    let o = (y * img.width + x) * 4
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]
}


//countDark, 指定矩形區域內任一通道<thr之像素數(預設整張圖)
export function countDark(img, thr = 128, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height) {
    let n = 0
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            let o = (y * img.width + x) * 4
            if (img.data[o] < thr && img.data[o + 1] < thr && img.data[o + 2] < thr) {
                n++
            }
        }
    }
    return n
}
