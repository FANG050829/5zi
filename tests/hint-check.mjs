// 提示功能回归：pvp 双端模拟 —— win/block 提示类型 + 次数扣减 + 落子清除
import { io } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
const L = (m) => console.log(m)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const idx = (col, row) => row * 15 + col
// 黑四连 H8 I8 J8 K8 = col7..10,row7；两头 G8=col6 / L8=col11

const RUN = Date.now().toString(36)
const pass = []
const check = (name, ok) => {
  pass.push(ok)
  L(`${ok ? '✓' : '✗'} ${name}`)
}

const black = io(URL, { transports: ['websocket'] })
let white = null
let stage = 0 // 0=布局 1=白要提示 2=白堵 3=黑要提示 4=黑终结
const NEUTRALS = [idx(2, 2), idx(3, 12), idx(12, 2)]
let neutralIdx = 0

black.on('connect', () => {
  black.emit('room:create', { playerId: `hb-${RUN}`, name: '黑方' }, (res) => {
    L(`room created: ${res.code}`)
    white = io(URL, { transports: ['websocket'] })
    white.on('connect', () => {
      white.emit('room:join', { code: res.code, playerId: `hw-${RUN}`, name: '白方' }, () => {})
    })
    white.on('room:state', (st) => onWhiteState(st))
  })
})

// 黑方驱动：moveCount 0/2/4/6 时走四连
black.on('room:state', (st) => {
  if (st.status !== 'playing' || st.turn !== 1) return
  const mainline = { 0: idx(7, 7), 2: idx(8, 7), 4: idx(9, 7) }
  if (st.moveCount in mainline && !st.hint) {
    black.emit('game:move', { index: mainline[st.moveCount] })
    return
  }
  if (st.moveCount === 6) {
    black.emit('game:move', { index: idx(10, 7) }) // K8 成四（随后白方进入提示流程）
    return
  }
  if (st.moveCount === 8 && stage === 2 && !st.hint) {
    stage = 3
    black.emit('game:hint') // 黑请求提示：被堵一头后另一头可成五 → win
    return
  }
  if (st.moveCount === 8 && stage === 3 && st.hint?.color === 1) {
    check(`黑方提示返回 (kind=${st.hint.kind})`, true)
    if (st.hint.kind === 'win') {
      check('黑方提示为必胜点（另一头成五）', true)
      stage = 4
      black.emit('game:move', { index: st.hint.index })
    } else {
      check(`预期必胜点，实际 ${st.hint.kind}`, false)
      stage = 4
      black.emit('game:resign')
    }
  }
})

// 白方驱动：neutral 应手 + 提示流程
async function onWhiteState(st) {
  if (st.status === 'ended' && stage === 4) {
    check(`黑方五连取胜 (winner=${st.winner} reason=${st.endReason})`, st.winner === 1 && st.endReason === 'five')
    check('hint 在落子后清除', st.hint === null)
    L(`\n结果: ${pass.filter(Boolean).length}/${pass.length} 通过`)
    black.disconnect()
    white.disconnect()
    process.exit(pass.every(Boolean) ? 0 : 1)
  }
  if (st.status !== 'playing' || st.turn !== 2) return

  if (st.moveCount === 7 && stage === 0) {
    stage = 1
    white.emit('game:hint') // 黑已四连，此处必为 block
    await sleep(400)
    return
  }
  if (st.moveCount === 7 && stage === 1 && st.hint?.color === 2) {
    check(`白方提示为防守点 (kind=${st.hint.kind} idx=${st.hint.index})`, st.hint.kind === 'block' && [idx(6, 7), idx(11, 7)].includes(st.hint.index))
    check(`黑方剩余提示=3 (got ${st.hints.black})`, st.hints.black === 3)
    check(`白方剩余提示=2 (got ${st.hints.white})`, st.hints.white === 2)
    stage = 2
    white.emit('game:move', { index: st.hint.index }) // 堵一头
    return
  }
  if (st.moveCount === 9 && stage === 4) {
    // 黑已赢，不该到这里
    return
  }
  if (stage >= 2 && st.moveCount >= 7) return // 之后的白手由黑方终结，不需要白再走
  if (st.moveCount % 2 === 1) {
    white.emit('game:move', { index: NEUTRALS[neutralIdx++ % NEUTRALS.length] })
  }
}

setTimeout(() => {
  L(`TIMEOUT — 阶段卡在 ${stage}`)
  L(`结果: ${pass.filter(Boolean).length}/${pass.length} 通过`)
  process.exit(1)
}, 15000)
