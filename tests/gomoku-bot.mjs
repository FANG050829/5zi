// 五子棋测试机器人：模拟微信好友入房对弈
// 用法: bun tests/gomoku-bot.mjs <roomCode> [--dumb|--smart] [--chat] [--undo] [--rematch]
import { io } from 'socket.io-client'

const code = process.argv[2]
if (!code) {
  console.error('usage: bun tests/gomoku-bot.mjs <roomCode>')
  process.exit(1)
}
const opts = new Set(process.argv.slice(3))
const DUMB = opts.has('--dumb')
const SIZE = 15

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })
const pid = 'bot-' + Math.random().toString(36).slice(2, 8)
let myColor = null
let lastState = null
let moved = false

const rc2i = (r, c) => r * SIZE + c

function chooseMove(s) {
  const b = s.board
  if (DUMB) {
    for (let i = 0; i < b.length; i++) if (b[i] === 0) return i
    return -1
  }
  // smart: 赢/挡四、赢/挡三，否则贴着最后一手下
  const lines = []
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  const me = myColor, opp = myColor === 1 ? 2 : 1
  const countLine = (idx, color) => {
    const r = Math.floor(idx / SIZE), c = idx % SIZE
    for (const [dr, dc] of dirs) {
      let n = 1
      for (const sgn of [1, -1]) {
        let rr = r + dr*sgn, cc = c + dc*sgn
        while (rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && b[rr*SIZE+cc]===color) { n++; rr+=dr*sgn; cc+=dc*sgn }
      }
      lines.push(n)
    }
    return Math.max(...lines)
  }
  let best = -1, bestScore = -1
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0) continue
    const score = countLine(i, me) * 10 + countLine(i, opp)
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}

socket.on('connect', () => {
  socket.emit('room:join', { code, playerId: pid, name: '阿白·好友' }, (res) => {
    console.log('[bot] join', code, JSON.stringify(res))
    if (!res?.ok) process.exit(1)
    if (opts.has('--chat')) {
      setTimeout(() => socket.emit('chat:send', { text: '我来啦，请多指教！' }), 800)
    }
  })
})

socket.on('room:state', (s) => {
  lastState = s
  myColor = s.black?.playerId === pid ? 1 : s.white?.playerId === pid ? 2 : null
  if (myColor === null) { console.log('[bot] spectating'); return }
  if (s.status === 'playing' && s.turn === myColor && !moved) {
    moved = true
    setTimeout(() => {
      const idx = chooseMove(s)
      if (idx >= 0) { socket.emit('game:move', { index: idx }); console.log('[bot] move', idx, 'round', s.round) }
      moved = false
    }, 350)
  }
  if (s.status === 'ended' && s.round >= 1) {
    if (opts.has('--undo') && s.undoReq && s.undoReq !== myColor) {
      setTimeout(() => socket.emit('game:undo-accept'), 400)
    }
    if (opts.has('--rematch')) {
      setTimeout(() => { socket.emit('game:rematch'); console.log('[bot] rematch requested') }, 600)
    }
  }
  if (s.status === 'playing' && s.undoReq && s.undoReq !== myColor && opts.has('--undo')) {
    setTimeout(() => socket.emit('game:undo-accept'), 400)
  }
})

setTimeout(() => { console.log('[bot] timeout exit'); process.exit(0) }, 600000)
