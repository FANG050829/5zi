import { io } from 'socket.io-client'
const code = process.argv[2]
const s2 = io('http://127.0.0.1:3003', { transports: ['websocket'] })
s2.on('connect', () => {
  s2.emit('room:join', { code, playerId: 'friend-' + Date.now(), name: '阿白·好友' }, (res) => {
    console.log('friend join:', JSON.stringify(res))
  })
})
s2.on('room:state', (st) => {
  console.log(`state: status=${st.status} black=${st.black?.name} white=${st.white?.name} diff=${st.difficulty}`)
  if (st.status === 'playing') {
    console.log('PVP GAME STARTED OK')
    s2.disconnect()
    process.exit(0)
  }
})
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 6000)
