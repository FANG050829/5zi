// 回归：表情弹幕（白名单/限频/署名）+ 在线人数推送 + pvp 好友加入自动开局
// 用法: bun tests/reaction-presence-check.mjs
import { io } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
let pass = 0
let fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ` (${extra})` : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let onlineSeen = 0
let reactions = [] // { side: 'A' | 'B', emoji, from, color }

const a = io(URL, { transports: ['websocket'] })
let b = null

const finish = () => {
  console.log(`\n结果: ${pass} passed, ${fail} failed`)
  try { a.disconnect() } catch {}
  try { b?.disconnect() } catch {}
  process.exit(fail === 0 ? 0 : 1)
}

a.on('connect', async () => {
  console.log('connected (A)')

  // 1) 在线人数推送
  a.on('lobby:presence', (d) => {
    if (typeof d?.online === 'number') onlineSeen = d.online
  })
  await sleep(400)
  ok(onlineSeen >= 1, 'presence 推送在线人数', `online=${onlineSeen}`)

  // 2) A 创建 pvp 房间
  let code = ''
  a.emit('room:create', { playerId: 'ra-' + Date.now(), name: '弹幕黑' }, (res) => {
    code = res?.code ?? ''
    console.log('room created:', code)
  })
  await sleep(500)
  ok(!!code, 'pvp 房间创建')

  // 监听 reaction（A 侧）
  a.on('game:reaction', (r) => reactions.push({ side: 'A', ...r }))

  // 3) B 加入 → 自动开局
  b = io(URL, { transports: ['websocket'] })
  b.on('game:reaction', (r) => reactions.push({ side: 'B', ...r }))
  let started = false
  b.on('room:state', (s) => {
    if (s.status === 'playing') started = true
  })
  b.on('connect', () => {
    b.emit('room:join', { code, playerId: 'rb-' + Date.now(), name: '弹幕白' }, (res) => {
      console.log('B join:', JSON.stringify(res))
    })
  })
  await sleep(1200)
  ok(started, '好友加入自动开局')

  // 4) A 发合法表情 → 双方收到
  reactions = []
  a.emit('game:react', { emoji: '🔥' })
  await sleep(500)
  ok(reactions.length === 2, '双方均收到表情弹幕', `count=${reactions.length}`)
  ok(reactions.every((r) => r.emoji === '🔥'), '表情内容一致')
  ok(reactions.every((r) => r.from === '弹幕黑'), '署名为发送者昵称', `from=${reactions[0]?.from}`)
  ok(reactions.every((r) => r.color === 1), '颜色为黑方 1', `color=${reactions[0]?.color}`)

  // 5) 非白名单表情被拒
  reactions = []
  a.emit('game:react', { emoji: '💣' })
  await sleep(500)
  ok(reactions.length === 0, '非白名单表情被拒绝', `count=${reactions.length}`)

  // 6) 限频：连续发送只生效一次
  a.emit('game:react', { emoji: '👏' })
  a.emit('game:react', { emoji: '😂' })
  await sleep(600)
  ok(reactions.length === 2, '限频生效（第二个被忽略）', `count=${reactions.length}`)

  // 7) B（白方）发送表情署名正确
  reactions = []
  b.emit('game:react', { emoji: '😱' })
  await sleep(500)
  ok(reactions.length === 2 && reactions[0].from === '弹幕白' && reactions[0].color === 2, '白方发送署名/颜色正确', `from=${reactions[0]?.from} color=${reactions[0]?.color}`)

  // 8) B 断线后在线人数减少
  const before = onlineSeen
  b.disconnect()
  b = null
  await sleep(800)
  ok(onlineSeen < before, '断线后在线人数减少', `before=${before} after=${onlineSeen}`)

  finish()
})

setTimeout(() => {
  console.log('GLOBAL TIMEOUT')
  finish()
}, 20000)
