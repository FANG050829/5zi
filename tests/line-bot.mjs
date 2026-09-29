// 临时直线机器人：加入指定房间，按固定横线落子（用于给浏览器 pid 造战绩）
import { io } from 'socket.io-client'

const code = process.argv[2]
const name = process.argv[3] ?? '直线机器人'
const CELLS = [49, 50, 51, 52, 53] // 第 3 行 D-H

const s = io('http://127.0.0.1:3003', { transports: ['websocket'] })
const untilConnected = new Promise((r) => (s.connected ? r() : s.once('connect', r)))
await untilConnected

let myColor = 0
let qi = 0

s.emit('room:join', { code, playerId: 'bot-' + Date.now(), name }, (res) => {
  console.log('bot join:', JSON.stringify(res))
})

s.on('room:state', (st) => {
  if (st.status !== 'playing') return
  // 首次确定颜色
  if (!myColor) {
    if (st.black?.name === name) myColor = 1
    else if (st.white?.name === name) myColor = 2
    else return
  }
  if (st.turn !== myColor) return
  const cell = CELLS[qi++]
  if (cell === undefined) return
  s.emit('game:move', { index: cell }, () => {})
})

s.on('room:state', (st) => {
  if (st.status === 'ended') {
    console.log('game ended: winner=' + st.winner + ' reason=' + st.endReason)
    setTimeout(() => process.exit(0), 300)
  }
})

setTimeout(() => process.exit(0), 90000)
