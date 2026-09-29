import { io } from 'socket.io-client'

const DIFF = process.argv[2] || 'hard'
const socket = io('http://127.0.0.1:3003', { transports: ['websocket'] })

socket.on('connect', () => {
  socket.emit('room:create', { playerId: 't-' + Date.now(), name: '测试者', mode: 'solo', difficulty: DIFF }, (res) => {
    console.log(`[${DIFF}] create:`, JSON.stringify(res))
  })
})

socket.on('room:state', (s) => {
  console.log(`[${DIFF}] moves=${s.moveCount} turn=${s.turn} status=${s.status} last=${s.lastMove}`)
  if (s.status === 'playing' && s.turn === 1) {
    // 轮到黑（人）：找第一个空点落子
    const idx = s.board.findIndex((v) => v === 0)
    socket.emit('game:move', { index: idx })
  }
  if (s.moveCount >= 6) {
    console.log(`[${DIFF}] AI OK, final moves=${s.moveCount}`)
    socket.disconnect()
    process.exit(0)
  }
})

setTimeout(() => {
  console.log(`[${DIFF}] TIMEOUT`)
  process.exit(1)
}, 12000)
