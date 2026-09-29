/**
 * 连胜系统 / AI 难度切换 / solo 升级建议 / head2head API 回归
 *
 * 覆盖：
 * 1. pvp 两连胜 → streak 跨局累计（换边后仍累计）+ 系统消息
 * 2. AI 胜利打断真人连胜 → streak 清空
 * 3. solo 房内 room:difficulty 切换（即时生效 + 系统消息 + 非法难度忽略）
 * 4. solo 连胜 2 局触发 AI 升级建议（需真实胜局，用内置大师引擎打 easy AI）
 * 5. head2head API 按 pid 查询交手记录
 *
 * 运行：bun tests/streak-difficulty-check.mjs
 */
import { io } from 'socket.io-client'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let failed = 0
const ok = (cond, label) => {
  if (cond) {
    passed++
    console.log('  ✓', label)
  } else {
    failed++
    console.log('  ✗', label)
  }
}

// ---------------- socket 准备 ----------------
const A = io('http://127.0.0.1:3003', { transports: ['websocket'] })
const B = io('http://127.0.0.1:3003', { transports: ['websocket'] })
await new Promise((r) => A.on('connect', r))
await new Promise((r) => B.on('connect', r))
const pidA = 'streakChk-' + Date.now()
const pidB = 'streakChkB-' + Date.now()
let lastA = null
let lastB = null
A.on('room:state', (s) => { lastA = s })
B.on('room:state', (s) => { lastB = s })

async function waitPred(fn, label, timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = fn()
    if (v) return v
    await sleep(120)
  }
  throw new Error('timeout: ' + label)
}
const idx = (r, c) => r * 15 + c
const turnPid = (st) => (st.turn === 1 ? st.black?.playerId : st.white?.playerId)
const myTurn = (st, pid) => st?.status === 'playing' && turnPid(st) === pid

// ---------------- 1. pvp 两连胜 ----------------
console.log('\n[1] pvp 两连胜：跨局累计 + 系统消息')
const { code } = await new Promise((res) => A.emit('room:create', { playerId: pidA, name: '连胜侠', mode: 'pvp' }, res))
await new Promise((res) => B.emit('room:join', { code, playerId: pidB, name: '陪练B' }, res))
await waitPred(() => lastA?.status === 'playing', 'game1')

const scatter = [[1, 1], [1, 5], [5, 1], [6, 6], [12, 2], [2, 12], [10, 10], [3, 8], [8, 3], [11, 7]]
let bStep = 0
async function runPvp(row, cols) {
  let mi = 0
  for (let step = 0; step < 40; step++) {
    const st = await waitPred(() => (lastA?.status === 'playing' ? lastA : null), 'playing').catch(() => null)
    if (!st) return
    const cur = turnPid(st)
    if (cur === pidA) {
      if (mi >= cols.length) return
      A.emit('game:move', { index: idx(row, cols[mi]) })
      mi++
      if (mi === cols.length) return
    } else if (cur === pidB) {
      const [rr, cc] = scatter[bStep % scatter.length]
      bStep++
      if (lastB.board[idx(rr, cc)] === 0) B.emit('game:move', { index: idx(rr, cc) })
      else B.emit('game:move', { index: idx(0, bStep % 15) })
    }
    await sleep(150)
  }
}

await runPvp(7, [3, 4, 5, 6, 7])
const s1 = await waitPred(() => (lastA?.status === 'ended' ? lastA : null), 'g1 end')
ok(s1.streak?.playerId === pidA && s1.streak.count === 1, '第 1 局胜 → streak=1')
ok(!s1.chat.some((c) => /已连胜 1 局/.test(c.text)), '1 连胜不广播（≥2 才提示，符合设计）')

A.emit('game:rematch')
await sleep(250)
B.emit('game:rematch')
await waitPred(() => lastA?.status === 'playing' && lastA.round === 2, 'game2')
await runPvp(9, [4, 5, 6, 7, 8])
const s2 = await waitPred(() => (lastA?.status === 'ended' && lastA.round === 2) ? lastA : null, 'g2 end')
ok(s2.streak?.playerId === pidA && s2.streak.count === 2, '换边后再胜 → streak=2（跨局跨颜色累计）')
ok(s2.chat.some((c) => /🔥 连胜侠 已连胜 2 局/.test(c.text)), '连胜 2 局系统消息')

// ---------------- 2. AI 胜利打断连胜（第三局让 B 赢） ----------------
console.log('\n[2] 真人连胜被对方真人终结')
A.emit('game:rematch')
await sleep(250)
B.emit('game:rematch')
await waitPred(() => lastA?.status === 'playing' && lastA.round === 3, 'game3')
// B 执黑或白不确定，B 连五
async function runPvpB(row, cols) {
  let mi = 0
  for (let step = 0; step < 40; step++) {
    const st = await waitPred(() => (lastB?.status === 'playing' ? lastB : null), 'playingB').catch(() => null)
    if (!st) return
    const cur = turnPid(st)
    if (cur === pidB) {
      if (mi >= cols.length) return
      B.emit('game:move', { index: idx(row, cols[mi]) })
      mi++
      if (mi === cols.length) return
    } else if (cur === pidA) {
      const [rr, cc] = scatter[(bStep + 5) % scatter.length]
      bStep++
      if (lastA.board[idx(rr, cc)] === 0) A.emit('game:move', { index: idx(rr, cc) })
      else A.emit('game:move', { index: idx(14, bStep % 15) })
    }
    await sleep(150)
  }
}
await runPvpB(11, [2, 3, 4, 5, 6])
const s3 = await waitPred(() => (lastA?.status === 'ended' && lastA.round === 3) ? lastA : null, 'g3 end')
ok(s3.streak?.playerId === pidB && s3.streak.count === 1, 'B 胜 → A 连胜清零，B 新 streak=1')

A.disconnect()
B.disconnect()

// ---------------- 3. solo 房内难度切换 ----------------
console.log('\n[3] solo 房内难度切换')
const C = io('http://127.0.0.1:3003', { transports: ['websocket'] })
await new Promise((r) => C.on('connect', r))
let lastC = null
C.on('room:state', (s) => { lastC = s })
const pidC = 'diffChk-' + Date.now()
const r1 = await new Promise((res) => C.emit('room:create', { playerId: pidC, name: '难度侠', mode: 'solo', difficulty: 'easy' }, res))
ok(!!r1?.code, 'solo easy 房创建')
await new Promise((r) => C.once('room:state', r))
ok(lastC.difficulty === 'easy', '初始难度 easy')

C.emit('room:difficulty', { difficulty: 'hard' })
await waitPred(() => lastC?.difficulty === 'hard', 'switch hard')
ok(lastC.difficulty === 'hard', '房内切换 → hard 即时生效')
ok(lastC.chat.some((c) => /难度已切换：入门 → 大师/.test(c.text)), '切换系统消息')

const chatLenBefore = lastC.chat.length
C.emit('room:difficulty', { difficulty: 'ultra' })
await sleep(600)
ok(lastC.difficulty === 'hard' && lastC.chat.length === chatLenBefore, '非法难度被忽略')

// ---------------- 4. solo 连胜 2 局触发 AI 升级建议 ----------------

// === 内置大师引擎（与 mini-services/gomoku-server 同源） ===
const SIZE = 15
const CELLS = 225
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]
function findWinLine(board, index, color) {
  const r0 = Math.floor(index / SIZE), c0 = index % SIZE
  for (const [dr, dc] of DIRS) {
    const line = [index]
    for (const sign of [1, -1]) {
      let rr = r0 + dr * sign, cc = c0 + dc * sign
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) { line.push(rr * SIZE + cc); rr += dr * sign; cc += dc * sign }
    }
    if (line.length >= 5) return line
  }
  return null
}
function wouldWin(board, i, color) { board[i] = color; const w = findWinLine(board, i, color); board[i] = 0; return w !== null }
function lineScore(count, open) {
  if (count >= 5) return 1_000_000
  if (count === 4) return open === 2 ? 100_000 : open === 1 ? 12_000 : 0
  if (count === 3) return open === 2 ? 6_000 : open === 1 ? 600 : 0
  if (count === 2) return open === 2 ? 250 : open === 1 ? 60 : 0
  return open === 2 ? 20 : open === 1 ? 5 : 0
}
function evalPoint(board, idx, color) {
  const r0 = Math.floor(idx / SIZE), c0 = idx % SIZE
  let total = 0
  for (const [dr, dc] of DIRS) {
    let count = 1, open = 0
    for (const sign of [1, -1]) {
      let rr = r0 + dr * sign, cc = c0 + dc * sign
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) { count++; rr += dr * sign; cc += dc * sign }
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) open++
    }
    total += lineScore(count, open)
  }
  return total
}
function threatProfile(board, idx, color) {
  const r0 = Math.floor(idx / SIZE), c0 = idx % SIZE
  let four = 0, openThree = 0
  for (const [dr, dc] of DIRS) {
    let count = 1, open = 0
    for (const sign of [1, -1]) {
      let rr = r0 + dr * sign, cc = c0 + dc * sign
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) { count++; rr += dr * sign; cc += dc * sign }
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) open++
    }
    if (count >= 4) four++
    else if (count === 3 && open === 2) openThree++
  }
  return { four, openThree }
}
const isDoubleThreat = (p) => p.four >= 2 || (p.four >= 1 && p.openThree >= 1) || p.openThree >= 2
function nearCandidates(board) {
  const out = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const i = r * SIZE + c
    if (board[i]) continue
    let near = false
    for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc]) { near = true; break }
    }
    if (near) out.push(i)
  }
  return out
}
function vctWin(board, me, movesLeft) {
  const opp = me === 1 ? 2 : 1
  const cands = nearCandidates(board)
  for (const i of cands) if (wouldWin(board, i, me)) return i
  if (movesLeft <= 1) return null
  const forcing = []
  for (const i of cands) { const tp = threatProfile(board, i, me); if (tp.four >= 1 || isDoubleThreat(tp)) forcing.push(i) }
  for (const i of forcing) {
    board[i] = me
    let oppFive = null
    for (const j of cands) { if (j === i) continue; if (wouldWin(board, j, opp)) { oppFive = j; break } }
    let win = false
    if (oppFive === null) {
      const myWinPoints = cands.filter((k) => k !== i && wouldWin(board, k, me))
      const defenses = new Set(myWinPoints)
      for (const w of myWinPoints) {
        const wr = Math.floor(w / SIZE), wc = w % SIZE
        for (const [dr, dc] of DIRS) for (const sign of [1, -1]) {
          const rr = wr + dr * sign, cc = wc + dc * sign
          if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !board[rr * SIZE + cc]) defenses.add(rr * SIZE + cc)
        }
      }
      if (myWinPoints.length === 0) { board[i] = 0; continue }
      win = true
      for (const b of defenses) {
        board[b] = opp
        const cont = vctWin(board, me, movesLeft - 1)
        board[b] = 0
        if (cont === null) { win = false; break }
      }
    }
    board[i] = 0
    if (win) return i
  }
  return null
}
function engineMove(board, moveCount, me, moves) {
  const opp = me === 1 ? 2 : 1
  const empties = []
  for (let i = 0; i < CELLS; i++) if (!board[i]) empties.push(i)
  if (!empties.length) return -1
  if (moveCount === 0) return 112
  if (moveCount === 1) {
    const l = moves[0].index
    const lr = Math.floor(l / SIZE), lc = l % SIZE
    const adj = []
    for (const [dr, dc] of DIRS) for (const sign of [1, -1]) {
      const rr = lr + dr * sign, cc = lc + dc * sign
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) adj.push(rr * SIZE + cc)
    }
    if (adj.length) return adj[0]
  }
  for (const i of empties) if (wouldWin(board, i, me)) return i
  for (const i of empties) if (wouldWin(board, i, opp)) return i
  const kill = vctWin(board, me, 2)
  if (kill !== null && kill >= 0) return kill
  const oppKill = vctWin(board, opp, 2)
  if (oppKill !== null && oppKill >= 0) return oppKill
  const scored = empties.map((i) => {
    const r = Math.floor(i / SIZE), c = i % SIZE
    const center = 6 - Math.max(Math.abs(r - 7), Math.abs(c - 7))
    const comboMe = isDoubleThreat(threatProfile(board, i, me)) ? 1 : 0
    const comboOpp = isDoubleThreat(threatProfile(board, i, opp)) ? 1 : 0
    return { idx: i, s: evalPoint(board, i, me) + evalPoint(board, i, opp) + center * 3 + comboMe * 500_000 + comboOpp * 420_000 }
  })
  scored.sort((a, b) => b.s - a.s)
  return scored[0].idx
}

// 在全新的 solo easy 房里用内置大师引擎打两局（干净开局，黑先必胜率高）
console.log('\n[4] solo 连胜 2 局 → AI 升级建议（fresh 房 + 内置大师引擎 vs easy AI）')
const D = io('http://127.0.0.1:3003', { transports: ['websocket'] })
await new Promise((r) => D.on('connect', r))
let lastD = null
D.on('room:state', (s) => { lastD = s })
const pidD = 'soloStreak-' + Date.now()
await new Promise((res) => D.emit('room:create', { playerId: pidD, name: '升级侠', mode: 'solo', difficulty: 'easy' }, res))
await new Promise((r) => D.once('room:state', r))

const myColorOf = (st, pid) => (st.black?.playerId === pid ? 1 : 2)
async function playOneD() {
  for (let step = 0; step < 130; step++) {
    for (let w = 0; w < 600; w++) {
      if (!lastD) { await sleep(80); continue }
      if (lastD.status !== 'playing') return
      if (lastD.turn === myColorOf(lastD, pidD)) break
      await sleep(80)
    }
    if (!lastD || lastD.status !== 'playing') return
    const mv = engineMove(lastD.board, lastD.moveCount, myColorOf(lastD, pidD), lastD.moves)
    if (mv >= 0) D.emit('game:move', { index: mv })
    await sleep(220)
  }
}
async function waitEndD(roundNo) {
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    if (lastD && lastD.status === 'ended' && lastD.round === roundNo) return lastD
    await sleep(120)
  }
  throw new Error('waitEnd r' + roundNo)
}

let triggered = null
const gameLog = []
for (let g = 1; g <= 12; g++) {
  if (g > 1) {
    D.emit('game:rematch')
    const t0 = Date.now()
    while (Date.now() - t0 < 20000 && !(lastD?.status === 'playing' && lastD.round === g)) await sleep(120)
    if (lastD?.status !== 'playing') break
  }
  await playOneD()
  const s = await waitEndD(g)
  const myWin = s.winner === myColorOf(s, pidD)
  gameLog.push(`r${g}:${myWin ? 'W' : s.winner === 0 ? 'D' : 'L'}(streak=${s.streak?.count ?? 0})`)
  if (s.streak?.playerId === pidD && s.streak.count >= 2) {
    const sug = s.chat.filter((c) => /试试|挑战|出师/.test(c.text) && c.color === 0).map((m) => m.text)
    triggered = sug[sug.length - 1] ?? null
    break
  }
}
console.log('  引擎战绩:', gameLog.join(' '))
ok(!!triggered && /弈心·AI/.test(triggered), '连胜 2 局触发 AI 升级建议：' + (triggered ?? '(未触发)'))

// ---------------- 5. head2head API ----------------
console.log('\n[5] head2head API')
const h2h = await fetch(`http://127.0.0.1:3000/api/matches/head2head?aPid=${encodeURIComponent(pidD)}&bPid=ai-yixin`)
  .then((r) => r.json())
  .catch(() => null)
ok(!!h2h?.ok, 'API 响应 ok')
ok(h2h?.total >= 1, `交手记录可查（total=${h2h?.total} aWins=${h2h?.aWins} bWins=${h2h?.bWins}）`)
ok(h2h?.aWins >= 1, '包含本脚本产生的胜局')
const bad = await fetch('http://127.0.0.1:3000/api/matches/head2head?aPid=x&bPid=x').then((r) => r.json()).catch(() => null)
ok(bad?.ok === false, '相同 pid 拒绝')

C.disconnect()
D.disconnect()

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
