import fs from 'fs'
import WCanvas from './src/WCanvas.mjs'


async function test() {

    //WCanvas, 首次調用時下載並校驗官方預建檔，複製到canvas套件後載入，回傳canvas之匯出
    let { createCanvas, loadImage, registerFont } = await WCanvas() // eslint-disable-line no-unused-vars

    //畫一個藍色矩形與中英文字
    let canvas = createCanvas(240, 80)
    let ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 240, 80)
    ctx.fillStyle = '#1976d2'
    ctx.fillRect(10, 10, 60, 60)
    ctx.fillStyle = '#000'
    ctx.font = '24px sans-serif'
    ctx.fillText('測試 canvas', 80, 48)

    //輸出PNG
    let buf = canvas.toBuffer('image/png')
    fs.writeFileSync('./test-canvas.png', buf)
    console.log('size', buf.length > 0)
    // size true

    //loadImage
    let img = await loadImage(buf)
    console.log('wh', img.width, img.height)
    // wh 240 80

    fs.unlinkSync('./test-canvas.png')
}
test()
    .catch((err) => {
        console.log('catch', err)
    })


//node g.mjs
