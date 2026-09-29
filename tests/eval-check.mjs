// 回归：观战胜率评估 / 评估曲线 / 悔棋提示返还 / 大师 AI 双威胁不崩
// 用法: bun tests/eval-check.mjs
import { io } from 'socket.io-client'

const URL = 'http://127.0.0.1:3003'
let pass = 0
let fail = 0
const ok = (cond, name) => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const s = io(URL, { transports: ['websocket'] })
const pid = 'eval-' + Math.random().toString(36).slice(2, 8)

let state = null
s.on('room:state', (st) => {
  state = st
})

const waitState = async (pred, timeout = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (state && pred(state)) return state
    await sleep(120)
  }
  return null
}

const myTurn = (st) => st && st.status === 'playing' && st.turn === 1

s.on('connect', async () => {
  console.log('connected, creating solo room (hard)…')
  s.emit('room:create', { playerId: pid, name: '评估员', mode: 'solo', difficulty: 'hard' }, async (res) => {
    if (!res?.ok) {
      console.log('create failed', res)
      process.exit(1)
    }

    // 1) 开局即有评估：evals[0]=50，winRate 在 0-100
    let st = await waitState((x) => x.status === 'playing')
    ok(!!st, 'solo 房自动开局')
    ok(Array.isArray(st.evals) && st.evals[0] === 50, `评估曲线初始 [50] (got ${JSON.stringify(st.evals)})`)
    ok(typeof st.winRate === 'number' && st.winRate >= 0 && st.winRate <= 100, `winRate 合法 (got ${st.winRate})`)

    // 2) 落子一手，等 AI 回应 → evals 长度 = 手数 + 1
    await waitState(myTurn)
    s.emit('game:move', { index: 112 })
    st = await waitState((x) => x.moveCount >= 2 && myTurn(x)) // 我1手 + AI1手
    ok(st.moveCount === 2, `AI 应答后共 2 手 (got ${st?.moveCount})`)
    ok(st.evals.length === st.moveCount + 1, `evals 长度 = 手数+1 (${st.evals.length} vs ${st.moveCount + 1})`)
    ok(st.evals.every((v) => v >= 0 && v <= 100), 'evals 全部在 0-100')

    // 3) 使用提示 → 落子 → 悔棋 → AI 自动同意 → 提示返还 3
    await sleep(300)
    s.emit('game:hint')
    st = await waitState((x) => x.hint && x.hint.color === 1)
    ok(!!st?.hint, '提示已揭示')
    ok(st.hints.black === 2, `提示次数扣减 3→2 (got ${st.hints.black})`)
    const hintIdx = st.hint.index
    s.emit('game:move', { index: hintIdx })
    st = await waitState((x) => x.moveCount >= 4 && myTurn(x))
    ok(st.moveCount >= 4, '提示落子 + AI 应答完成')
    s.emit('game:undo-request')
    st = await waitState((x) => x.hints?.black === 3 && !x.undoReq, 8000) // AI 750ms 内同意并返还
    ok(!!st, '悔棋后提示返还 3→3')
    if (st) ok(st.chat.some((c) => c.text.includes('返还')), '聊天含「返还」系统消息')
    else {
      ok(false, '聊天含「返还」系统消息')
    }

    // 4) 再走两手验证大师 AI（含双威胁识别）不崩
    for (let k = 0; k < 2; k++) {
      const cur = await waitState(myTurn, 10000)
      if (!cur) break
      const empties = []
      for (let i = 0; i < 225; i++) if (!cur.board[i]) empties.push(i)
      const idx = empties[Math.floor(Math.random() * empties.length)]
      s.emit('game:move', { index: idx })
      await waitState((x) => x.moveCount > cur.moveCount, 10000)
      await waitState((x) => x.moveCount % 2 === 0, 10000) // 等 AI 回应
    }
    ok(state.moveCount >= 6, `大师 AI（双威胁识别）正常应答，当前 ${state.moveCount} 手`)
    ok(state.evals.length === state.moveCount + 1, '悔棋后 evals 仍与手数同步')

    // 5) 认输结束 → API 落库含 evals
    s.emit('game:resign')
    st = await waitState((x) => x.status === 'ended')
    ok(!!st, '认输终局')
    ok(st.evals.length === st.moveCount + 1, `终局 evals 同步 (${st.evals.length} = ${st.moveCount + 1})`)

    await sleep(800) // 等待 POST /api/matches
    const list = await fetch('http://127.0.0.1:3000/api/matches').then((r) => r.json())
    const mine = list.recent.find((m) => m.blackName === '评估员')
    ok(!!mine, '对局已落库')
    if (mine) {
      const detail = await fetch(`http://127.0.0.1:3000/api/matches/${mine.id}`).then((r) => r.json())
      ok(
        detail.ok && Array.isArray(detail.match.evals) && detail.match.evals.length === detail.match.moveCount + 1,
        `API 下发 evals（${detail.match?.evals?.length} = ${detail.match?.moveCount + 1}）`
      )
      ok(detail.match.moves.length === detail.match.moveCount, 'API moves 数量一致')
    }

    console.log(`\n${pass} passed, ${fail} failed`)
    s.disconnect()
    process.exit(fail ? 1 : 0)
  })
})

s.on('connect_error', (e) => {
  console.log('connect_error:', e.message)
  process.exit(1)
})
setTimeout(() => {
  console.log('TIMEOUT', pass, 'passed', fail, 'failed')
  process.exit(1)
}, 60000)
