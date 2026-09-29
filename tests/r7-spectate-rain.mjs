// r7 E2E：观战者看「胜利表情雨」+ 双方/观战弹幕胶囊
// 用法: node r7-spectate-rain.mjs <roomCode 由脚本自建>
import { io } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
const mk = () => io(URL, { transports: ['websocket'] })

const black = mk()
const white = mk()
const spect = mk()

const code = process.argv[2]
let blackName = '雨黑'
let whiteName = '雨白'

// 棋谱：黑棋第 7 行连五（idx 105..109），白棋顶排陪跑（idx 0..4）
const plan = [
  [black, 105], [white, 0], [black, 106], [white, 1], [black, 107],
  [white, 2], [black, 108], [white, 3], [black, 109],
]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 健壮等待连接（已连/未连/报错均覆盖） */
const untilConnected = (sock, tag) =>
  new Promise((res, rej) => {
    if (sock.connected) return res()
    const t = setTimeout(() => rej(new Error(tag + ' connect timeout')), 8000)
    sock.once('connect', () => {
      clearTimeout(t)
      console.log(tag, 'connected')
      res()
    })
    sock.once('connect_error', (e) => {
      clearTimeout(t)
      rej(new Error(tag + ' connect_error: ' + e.message))
    })
  })

async function main() {
  await untilConnected(black, 'black')
  await untilConnected(white, 'white')
  await untilConnected(spect, 'spect')

  // 1. 建房或入座（传入 code 时三个 socket 依次入座/观战）
  let roomCode = code || null
  if (!roomCode) {
    const created = await new Promise((res) => {
      black.emit('room:create', { playerId: 'rain-b-' + Date.now(), name: blackName, mode: 'pvp' }, res)
    })
    if (!created.ok) throw new Error('create failed: ' + JSON.stringify(created))
    roomCode = created.code
  } else {
    await new Promise((res) => {
      black.emit('room:join', { code: roomCode, playerId: 'rain-b-' + Date.now(), name: blackName }, res)
    })
  }
  console.log('room:', roomCode)

  // 2. 白方加入（自动开局）
  await new Promise((res) => {
    white.emit('room:join', { code: roomCode, playerId: 'rain-w-' + Date.now(), name: whiteName }, res)
  })
  await wait(300)

  // 落子前留窗口让浏览器以观战身份进入
  console.log('browser window: 5s to open /?room=' + roomCode)
  await wait(5000)

  // 3. 观战者加入并发弹幕（观战胶囊）
  await new Promise((res) => {
    spect.emit('room:join', { code: roomCode, playerId: 'rain-s-' + Date.now(), name: '云观众' }, res)
  })
  await wait(200)
  spect.emit('game:react', { emoji: '👀' })
  await wait(300)
  // 玩家弹幕（白色胶囊）
  white.emit('game:react', { emoji: '🔥' })
  await wait(600)
  console.log('reactions sent (spectator 👀 + player 🔥)')

  // 4. 按计划落子（黑方第 5 手直接五连）
  const step = Number(process.env.RAIN_DELAY ?? 420)
  for (let i = 0; i < plan.length; i++) {
    const [sock, idx] = plan[i]
    sock.emit('game:move', { index: idx })
    await wait(step)
  }
  await wait(800)

  // 5. 验证终局
  const finalSt = await new Promise((res) => {
    spect.once('room:state', res)
    setTimeout(() => res(null), 3000)
  })
  if (finalSt) {
    console.log(`final: status=${finalSt.status} winner=${finalSt.winner} winLine=${JSON.stringify(finalSt.winLine)}`)
    if (finalSt.status === 'ended' && finalSt.winner === 1) {
      console.log('RAIN SCENARIO READY (black five, ended)')
    } else {
      console.log('UNEXPECTED FINAL STATE')
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('E2E error:', e.message)
  process.exit(1)
})
