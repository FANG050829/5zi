/**
 * 引擎对局量化基准

// 固定随机种子（可复现 bench；引擎内 Math.random 均由此驱动）
let __seed = 20260909
Math.random = () => {
  __seed = (__seed * 1664525 + 1013904223) % 4294967296
  return __seed / 4294967296
}：内置引擎（与 mini-services/gomoku-server/index.ts 同源复制，r11 VCT-3 版）
 * 跑法：bun tests/engine-bench.mjs
 * 输出：各难度配对的胜率 + 大师平均每手耗时，并断言难度梯度成立
 */
const SIZE = 15
const CELLS = SIZE * SIZE
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

// ---------- 引擎（与 gomoku-server 同源） ----------
function findWinLine(board, index, color) {
  const r = Math.floor(index / SIZE)
  const c = index % SIZE
  for (const [dr, dc] of DIRS) {
    const line = [index]
    for (const sign of [1, -1]) {
      let rr = r + dr * sign
      let cc = c + dc * sign
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) {
        line.push(rr * SIZE + cc)
        rr += dr * sign
        cc += dc * sign
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a - b)
  }
  return null
}

function wouldWin(board, idx, color) {
  board[idx] = color
  const win = findWinLine(board, idx, color)
  board[idx] = 0
  return win !== null
}

function lineScore(count, open) {
  if (count >= 5) return 1_000_000
  if (count === 4) return open === 2 ? 100_000 : open === 1 ? 12_000 : 0
  if (count === 3) return open === 2 ? 6_000 : open === 1 ? 600 : 0
  if (count === 2) return open === 2 ? 250 : open === 1 ? 60 : 0
  return open === 2 ? 20 : open === 1 ? 5 : 0
}

function evalPoint(board, idx, color) {
  const r0 = Math.floor(idx / SIZE)
  const c0 = idx % SIZE
  let total = 0
  for (const [dr, dc] of DIRS) {
    let count = 1
    let open = 0
    for (const sign of [1, -1]) {
      let rr = r0 + dr * sign
      let cc = c0 + dc * sign
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) {
        count++
        rr += dr * sign
        cc += dc * sign
      }
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) open++
    }
    total += lineScore(count, open)
  }
  return total
}

function threatProfile(board, idx, color) {
  const r0 = Math.floor(idx / SIZE)
  const c0 = idx % SIZE
  let four = 0
  let openThree = 0
  for (const [dr, dc] of DIRS) {
    let count = 1
    let open = 0
    for (const sign of [1, -1]) {
      let rr = r0 + dr * sign
      let cc = c0 + dc * sign
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) {
        count++
        rr += dr * sign
        cc += dc * sign
      }
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) open++
    }
    if (count >= 4) four++
    else if (count === 3 && open === 2) openThree++
  }
  return { four, openThree }
}

function isDoubleThreat(p) {
  return p.four >= 2 || (p.four >= 1 && p.openThree >= 1) || p.openThree >= 2
}

// ================= 大师真搜索（alpha-beta + 全盘棋型评估） =================

const SEARCH_WIN = 9_000_000
const SEARCH_BRANCH = 10

function runScore(count, open) {
  if (count >= 5) return 10_000_000
  if (count === 4) return open === 2 ? 1_000_000 : open === 1 ? 120_000 : 0
  if (count === 3) return open === 2 ? 50_000 : open === 1 ? 5_000 : 0
  if (count === 2) return open === 2 ? 2_000 : open === 1 ? 400 : 0
  return open === 2 ? 20 : open === 1 ? 5 : 0
}

function boardEval(board, side) {
  const opp = side === 1 ? 2 : 1
  let mine = 0
  let theirs = 0
  for (const [dr, dc] of DIRS) {
    for (let r0 = 0; r0 < SIZE; r0++) {
      for (let c0 = 0; c0 < SIZE; c0++) {
        const color = board[r0 * SIZE + c0]
        if (!color) continue
        const pr = r0 - dr
        const pc = c0 - dc
        const prevColor = pr >= 0 && pr < SIZE && pc >= 0 && pc < SIZE ? board[pr * SIZE + pc] : 0
        if (prevColor === color) continue
        let count = 0
        let rr = r0
        let cc = c0
        while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === color) {
          count++
          rr += dr
          cc += dc
        }
        const openBefore = prevColor === 0 ? 1 : 0
        const openAfter = rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0 ? 1 : 0
        const s = runScore(count, openBefore + openAfter)
        if (color === side) mine += s
        else theirs += s
      }
    }
  }
  return mine - theirs * 0.95
}

function topMoves(board, me, k) {
  const opp = me === 1 ? 2 : 1
  const scored = nearCandidates(board).map((i) => ({
    idx: i,
    s: evalPoint(board, i, me) + evalPoint(board, i, opp) * 0.9,
  }))
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, k).map((x) => x.idx)
}

function searchBest(board, me, depth, alpha, beta, budget) {
  if (budget.n <= 0) return boardEval(board, me)
  budget.n--
  const opp = me === 1 ? 2 : 1
  for (const i of nearCandidates(board)) {
    if (wouldWin(board, i, me)) return SEARCH_WIN - (3 - depth) * 1000
  }
  if (depth <= 0) return boardEval(board, me)
  let best = -Infinity
  for (const c of topMoves(board, me, SEARCH_BRANCH)) {
    board[c] = me
    const val = -searchBest(board, opp, depth - 1, -beta, -alpha, budget)
    board[c] = 0
    if (val > best) best = val
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

function nearCandidates(board) {
  const out = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const idx = r * SIZE + c
      if (board[idx]) continue
      let near = false
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc]) {
            near = true
            break
          }
        }
      }
      if (near) out.push(idx)
    }
  }
  return out
}

function vctWin(board, me, movesLeft, budget) {
  const opp = me === 1 ? 2 : 1
  const cands = nearCandidates(board)
  for (const i of cands) if (wouldWin(board, i, me)) return i
  if (movesLeft <= 1) return null

  const forcing = []
  for (const i of cands) {
    if (threatProfile(board, i, me).four >= 1) forcing.push(i)
  }

  for (const i of forcing) {
    if (budget.n <= 0) return null
    budget.n--
    board[i] = me
    let oppFive = null
    for (const j of cands) {
      if (j === i) continue
      if (wouldWin(board, j, opp)) {
        oppFive = j
        break
      }
    }
    let win = false
    if (oppFive === null) {
      const myWinPoints = cands.filter((k) => k !== i && wouldWin(board, k, me))
      if (myWinPoints.length === 0) {
        board[i] = 0
        continue
      }
      win = true
      for (const b of myWinPoints) {
        board[b] = opp
        const cont = vctWin(board, me, movesLeft - 1, budget)
        board[b] = 0
        if (cont === null) {
          win = false
          break
        }
      }
    }
    board[i] = 0
    if (win) return i
  }
  return null
}

const AI_PROFILES = {
  easy: { atkW: 1.0, defW: 0.5, noise: 340, blockMiss: 0.28, lookahead: 0, search: 0, combo: false, vct: false, vctDepth: 0, delay: [360, 780] },
  normal: { atkW: 1.05, defW: 0.85, noise: 6, blockMiss: 0, lookahead: 0, search: 3, combo: true, vct: false, vctDepth: 0, delay: [480, 960] },
  hard: { atkW: 1.05, defW: 1.0, noise: 0, blockMiss: 0, lookahead: 0, search: 5, combo: true, vct: true, vctDepth: 3, delay: [650, 1300] },
}

/** 引擎选点（去房间化的 aiChooseMove：开局天元/贴身防守权威逻辑保留） */
function chooseMove(difficulty, board, moveCount) {
  const profile = AI_PROFILES[difficulty]
  const me = moveCount % 2 === 0 ? 1 : 2
  const opp = me === 1 ? 2 : 1
  const empties = []
  for (let i = 0; i < CELLS; i++) if (!board[i]) empties.push(i)
  if (empties.length === 0) return -1
  if (moveCount === 0) return 112
  if (moveCount === 1) {
    const last = board.findIndex((v) => v !== 0)
    const lr = Math.floor(last / SIZE)
    const lc = last % SIZE
    const adj = []
    for (const [dr, dc] of DIRS)
      for (const sign of [1, -1]) {
        const rr = lr + dr * sign
        const cc = lc + dc * sign
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) adj.push(rr * SIZE + cc)
      }
    if (adj.length) return adj[Math.floor(Math.random() * adj.length)]
  }

  for (const i of empties) if (wouldWin(board, i, me)) return i
  const missedBlock = Math.random() < profile.blockMiss
  if (!missedBlock) {
    for (const i of empties) if (wouldWin(board, i, opp)) return i
  }
  const defScale = missedBlock ? 0.3 : 1


  if (profile.vct && profile.vctDepth > 0) {
    const kill = vctWin(board, me, profile.vctDepth, { n: 24000 })
    if (kill !== null && kill >= 0) return kill
    // 对手有连续杀点 → 直接抢占（深度搜索会综合评估该点的攻防价值）
    const oppKill = vctWin(board, opp, profile.vctDepth, { n: 24000 })
    if (oppKill !== null && oppKill >= 0) return oppKill
  }

  const scored = empties.map((i) => {
    const r = Math.floor(i / SIZE)
    const c = i % SIZE
    const center = 6 - Math.max(Math.abs(r - 7), Math.abs(c - 7))
    let comboMe = 0
    let comboOpp = 0
    if (profile.combo) {
      if (isDoubleThreat(threatProfile(board, i, me))) comboMe = 1
      if (isDoubleThreat(threatProfile(board, i, opp))) comboOpp = 1
    }
    const s =
      evalPoint(board, i, me) * profile.atkW +
      evalPoint(board, i, opp) * profile.defW * defScale +
      center * 3 +
      comboMe * 500_000 +
      comboOpp * 420_000 * profile.defW +
      Math.random() * profile.noise
    return { idx: i, s }
  })
  scored.sort((a, b) => b.s - a.s)

  // 4) 大师：3 层真搜索（我-敌-我）
  if (profile.search > 0 && scored.length > 0) {
    const cands = scored.slice(0, 14)
    let best = cands[0].idx
    let bestVal = -Infinity
    for (const cand of cands) {
      board[cand.idx] = me
      const val = -searchBest(board, opp, profile.search - 1, -Infinity, Infinity, { n: 220000 })
      board[cand.idx] = 0
      if (val > bestVal) {
        bestVal = val
        best = cand.idx
      }
    }
    return best
  }

  // 4b) 进阶：轻量净收益前瞻
  if (profile.lookahead > 0 && scored.length > 0) {
    const cands = scored.slice(0, profile.lookahead)
    let best = cands[0].idx
    let bestVal = -Infinity
    for (const cand of cands) {
      board[cand.idx] = me
      let oppBest = 0
      for (const j of empties) {
        if (j === cand.idx) continue
        const v = evalPoint(board, j, opp) + evalPoint(board, j, me) * profile.defW * 0.9
        if (v > oppBest) oppBest = v
      }
      board[cand.idx] = 0
      const val = cand.s - oppBest * 0.92
      if (val > bestVal) {
        bestVal = val
        best = cand.idx
      }
    }
    return best
  }

  return scored[0]?.idx ?? empties[0]
}

// 可复现随机：每局独立播种（消除全局随机流耦合，局间独立样本）
function setSeed(seed) {
  let s = seed >>> 0 || 1
  Math.random = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

// ---------- 对局驱动 ----------
function playGame(blackDiff, whiteDiff, maxMoves = 120) {
  const board = new Array(CELLS).fill(0)
  let moves = 0
  let hardThinkMs = 0
  let hardMoves = 0
  while (moves < maxMoves) {
    const color = moves % 2 === 0 ? 1 : 2
    const diff = color === 1 ? blackDiff : whiteDiff
    const t0 = performance.now()
    const idx = chooseMove(diff, board, moves)
    const dt = performance.now() - t0
    if (diff === 'hard') {
      hardThinkMs += dt
      hardMoves++
    }
    if (idx < 0) return { winner: 0, moves, hardThinkMs, hardMoves }
    board[idx] = color
    moves++
    if (findWinLine(board, idx, color)) return { winner: color, moves, hardThinkMs, hardMoves }
  }
  return { winner: 0, moves, hardThinkMs, hardMoves }
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`)
    process.exitCode = 1
  } else {
    console.log(`  ✓ ${msg}`)
  }
}

function matchup(aDiff, bDiff, games, threshold, label) {
  let aWins = 0
  let draws = 0
  let thinkMs = 0
  let thinkMoves = 0
  for (let g = 0; g < games; g++) {
    // 偶数局 A 执黑，奇数局 A 执白（平衡先后手）；每局独立播种
    setSeed(0x5EED0000 ^ (aDiff.length << 24) ^ (bDiff.length << 20) ^ (games << 8) ^ g)
    const aBlack = g % 2 === 0
    const res = playGame(aBlack ? aDiff : bDiff, aBlack ? bDiff : aDiff)
    const aWon = res.winner !== 0 && ((res.winner === 1) === aBlack)
    if (res.winner === 0) draws++
    else if (aWon) aWins++
    thinkMs += res.hardThinkMs
    thinkMoves += res.hardMoves
  }
  const rate = aWins / games
  console.log(
    `  ${label}: ${aDiff} ${aWins}胜 / ${bDiff} ${games - aWins - draws}胜 / 和 ${draws}（${games} 局，胜率 ${(rate * 100).toFixed(0)}%）` +
      (thinkMoves ? ` · ${aDiff}均耗 ${Math.round(thinkMs / thinkMoves)}ms/手` : '')
  )
  assert(rate >= threshold, `${aDiff} 对 ${bDiff} 胜率 ${(rate * 100).toFixed(0)}% ≥ ${threshold * 100}%`)
}

console.log('== 引擎难度量化基准 ==')
// 核心梯度：大师 >> 进阶 > 入门
matchup('hard', 'normal', 20, 0.5, '梯度1')
matchup('hard', 'easy', 24, 0.5, '梯度2')
matchup('normal', 'easy', 20, 0.5, '梯度3')
console.log(process.exitCode ? '结果: FAILED' : '结果: ALL PASS')
