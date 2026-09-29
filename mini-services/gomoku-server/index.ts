import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

// ---------------------------------------------------------------------------
// 极简联机五子棋 — 对战服务（权威逻辑）
// ---------------------------------------------------------------------------

const PORT = 3003
const SIZE = 15
const CELLS = SIZE * SIZE
const MOVE_SECONDS = 60 // 每步限时
const RECONNECT_SECONDS = 60 // 掉线判负等待
const WAITING_KICK_SECONDS = 30 // 等待状态下掉线者保留座位时长
const ROOM_TTL_MS = 10 * 60 * 1000 // 空房间回收
const MAX_ROOMS = 500
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const HINTS_PER_GAME = 3 // 每局每方提示次数
const REACTION_WHITELIST = ['👏', '😂', '🤔', '😱', '😅', '🔥', '👍', '😮'] // 表情弹幕白名单
const REACTION_COOLDOWN_MS = 700 // 每连接发送最小间隔

type Color = 1 | 2 // 1 黑 2 白
type Status = 'waiting' | 'playing' | 'ended'
type Difficulty = 'easy' | 'normal' | 'hard'
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '入门', normal: '进阶', hard: '大师' }

interface Seat {
  playerId: string
  name: string
  socketId: string | null
  connected: boolean
  disconnectedAt: number | null
  isAI?: boolean
}

interface ChatMsg {
  id: string
  from: string
  color: number // 1 黑 2 白 0 系统/观战
  text: string
  ts: number
}

type HintKind = 'win' | 'block' | 'best'
interface HintInfo {
  index: number
  kind: HintKind
  color: Color
}

interface Room {
  code: string
  mode: 'pvp' | 'solo' // solo: 人机对战（AI 占白座）
  difficulty: Difficulty // solo 模式 AI 难度
  seats: { black: Seat | null; white: Seat | null }
  spectators: Map<string, { playerId: string; name: string }>
  board: number[]
  moves: { index: number; color: Color }[]
  turn: Color
  status: Status
  winner: number | null // 1/2 胜，0 和棋
  winLine: number[] | null
  endReason: '' | 'five' | 'timeout' | 'resign' | 'disconnect' | 'draw'
  lastMove: number | null
  scores: Record<string, number> // playerId -> 本房间胜场
  chat: ChatMsg[]
  rematch: { black: boolean; white: boolean }
  undoReq: Color | null
  hintsLeft: { black: number; white: number } // 本局剩余提示次数
  hint: HintInfo | null // 当前提示（落子后清除）
  hintAssisted: boolean[] // 与 moves 平行：该手是否借助提示落子（悔棋返还用）
  evals: number[] // 局势评估历史：evals[i] = 第 i 手后黑方胜率(0-1)，evals[0]=0.5 开局
  deadline: number | null // 当前手限时
  disconnDeadline: number | null
  startedAt: number | null
  round: number // 第几局（重开递增）
  aiKey?: string // AI 落子排程去重
  streakSuggested?: boolean // solo 难度升级建议已提示（每次成功升级后重置）
  streak: { playerId: string; count: number } | null // 房间内真人连胜（跨局累计）
  createdAt: number
  emptyAt: number | null
}

const rooms = new Map<string, Room>()

const AI_PLAYER_ID = 'ai-yixin'
const AI_NAME = '弈心·AI'

function makeAISeat(): Seat {
  return { playerId: AI_PLAYER_ID, name: AI_NAME, socketId: null, connected: true, disconnectedAt: null, isAI: true }
}

// ---------------------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

const genCode = (): string => {
  let code = ''
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
  } while (rooms.has(code))
  return code
}

const cleanName = (raw: unknown): string => {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12)
  return s || '棋客'
}

const sysMsg = (text: string): ChatMsg => ({ id: uid(), from: '', color: 0, text, ts: Date.now() })

const idxRC = (i: number) => ({ r: Math.floor(i / SIZE), c: i % SIZE })

/** 从 (r,c) 出发找连成 >=5 的同色线，返回这些格子的下标 */
function findWinLine(board: number[], index: number, color: Color): number[] | null {
  const { r, c } = idxRC(index)
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]
  for (const [dr, dc] of dirs) {
    const line: number[] = [index]
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

function createRoom(mode: 'pvp' | 'solo', difficulty: Difficulty = 'normal'): Room {
  const room: Room = {
    code: genCode(),
    mode,
    difficulty,
    seats: { black: null, white: null },
    spectators: new Map(),
    board: new Array(CELLS).fill(0),
    moves: [],
    turn: 1,
    status: 'waiting',
    winner: null,
    winLine: null,
    endReason: '',
    lastMove: null,
    scores: {},
    chat: [
      sysMsg(
        mode === 'solo'
          ? `AI 陪练房间已创建，${AI_NAME}（${DIFFICULTY_LABEL[difficulty]}）已就座`
          : '房间已创建，把邀请发给好友即可开局'
      ),
    ],
    rematch: { black: false, white: false },
    undoReq: null,
    hintsLeft: { black: HINTS_PER_GAME, white: HINTS_PER_GAME },
    hint: null,
    hintAssisted: [],
    evals: [0.5],
    deadline: null,
    disconnDeadline: null,
    startedAt: null,
    round: 0,
    streak: null,
    createdAt: Date.now(),
    emptyAt: null,
  }
  rooms.set(room.code, room)
  return room
}

/** 广播房间全量状态 */
function broadcast(room: Room) {
  const payload = publicState(room)
  io.to(room.code).emit('room:state', payload)
}

function publicState(room: Room) {
  const { black, white } = room.seats
  return {
    code: room.code,
    status: room.status,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    winLine: room.winLine,
    endReason: room.endReason,
    lastMove: room.lastMove,
    moveCount: room.moves.length,
    black: black && { playerId: black.playerId, name: black.name, connected: black.connected, isAI: !!black.isAI },
    white: white && { playerId: white.playerId, name: white.name, connected: white.connected, isAI: !!white.isAI },
    spectatorCount: room.spectators.size,
    difficulty: room.mode === 'solo' ? room.difficulty : null,
    scores: {
      black: black ? room.scores[black.playerId] ?? 0 : 0,
      white: white ? room.scores[white.playerId] ?? 0 : 0,
    },
    chat: room.chat.slice(-60),
    rematch: room.rematch,
    undoReq: room.undoReq,
    hints: room.hintsLeft,
    hint: room.hint,
    winRate: Math.round((room.evals[room.evals.length - 1] ?? 0.5) * 100), // 黑方估算胜率 0-100
    evals: room.evals.map((v) => Math.round(v * 100)), // 评估曲线（整数百分比，供复盘）
    deadline: room.deadline,
    disconnDeadline: room.disconnDeadline,
    round: room.round,
    streak: room.streak,
    moves: room.moves, // 供房内复盘
    serverTime: Date.now(),
  }
}

function pushChat(room: Room, msg: ChatMsg) {
  room.chat.push(msg)
  if (room.chat.length > 120) room.chat = room.chat.slice(-60)
}

/** 开局 / 重置（swap=true 时交换黑白座） */
function resetGame(room: Room, swap: boolean) {
  if (swap && room.seats.black && room.seats.white) {
    const b = room.seats.black
    room.seats.black = room.seats.white
    room.seats.white = b
  }
  room.board = new Array(CELLS).fill(0)
  room.moves = []
  room.turn = 1
  room.winner = null
  room.winLine = null
  room.endReason = ''
  room.lastMove = null
  room.rematch = { black: false, white: false }
  room.undoReq = null
  room.hintsLeft = { black: HINTS_PER_GAME, white: HINTS_PER_GAME }
  room.hint = null
  room.hintAssisted = []
  room.evals = [0.5]
  room.disconnDeadline = null
  if (room.seats.black && room.seats.white) {
    room.status = 'playing'
    room.startedAt = Date.now()
    room.round += 1
    room.deadline = Date.now() + MOVE_SECONDS * 1000
    pushChat(room, sysMsg('新一局开始，黑先行'))
    if (room.seats.black?.isAI || room.seats.white?.isAI)
      pushChat(room, sysMsg(`${AI_NAME}（${DIFFICULTY_LABEL[room.difficulty]}）：请多指教，放马过来～`))
    scheduleAI(room)
  } else {
    room.status = 'waiting'
    room.deadline = null
    room.startedAt = null
  }
}

function endGame(room: Room, winner: number, reason: Room['endReason'], winLine: number[] | null = null) {
  room.status = 'ended'
  room.winner = winner
  room.endReason = reason
  room.winLine = winLine
  room.deadline = null
  room.disconnDeadline = null
  room.undoReq = null
  room.hint = null // 终局清除未使用的提示（横幅与棋盘标记随广播消失）
  room.rematch = { black: false, white: false }

  if (winner === 1 || winner === 2) {
    const seat = winner === 1 ? room.seats.black : room.seats.white
    if (seat) room.scores[seat.playerId] = (room.scores[seat.playerId] ?? 0) + 1
  }
  const reasonText: Record<string, string> = {
    five: '五连取胜',
    timeout: '超时判负',
    resign: '认输',
    disconnect: '对方离开',
    draw: '和棋',
  }
  pushChat(room, sysMsg(winner === 0 ? '棋盘已满，和棋' : `${reasonText[reason] ?? ''}，${winner === 1 ? '黑方' : '白方'}胜`))
  updateStreak(room, winner)
  reportMatch(room)
  broadcast(room)
}

/** 房间内真人连胜跟踪（和棋不动；AI 胜利会打断真人连胜） */
function updateStreak(room: Room, winner: number) {
  if (winner !== 1 && winner !== 2) return
  const seat = winner === 1 ? room.seats.black : room.seats.white
  if (!seat || seat.isAI) {
    if (winner !== 0 && room.streak && (winner === 1 ? room.seats.black?.isAI : room.seats.white?.isAI)) {
      // AI 获胜：真人连胜被终结，清空
      room.streak = null
    }
    return
  }
  if (room.streak && room.streak.playerId === seat.playerId) {
    room.streak.count += 1
  } else {
    room.streak = { playerId: seat.playerId, count: 1 }
  }
  const s = room.streak.count
  const label = `${seat.name} 已连胜 ${s} 局`
  if (s >= 2 && s < 5) pushChat(room, sysMsg(`🔥 ${label}，状态火热！`))
  if (s >= 5) pushChat(room, sysMsg(`🔥🔥 ${label}，势不可挡！`))
  // solo 模式：连胜达阈值时 AI 主动建议升级难度（仅提示一次）
  if (room.mode === 'solo' && !room.streakSuggested) {
    const cur = room.difficulty
    const suggest: { at: number; to: Difficulty; text: string }[] =
      cur === 'easy'
        ? [{ at: 2, to: 'normal', text: '连胜 2 局！要不要试试「进阶」难度？点我的难度徽章即可切换' }]
        : cur === 'normal'
          ? [{ at: 3, to: 'hard', text: '连胜 3 局！进阶难度已拦不住你，敢挑战「大师」吗？点我的难度徽章切换' }]
          : [{ at: 5, to: 'hard', text: '大师难度连胜 5 局？！你已经出师了，去邀请好友一较高下吧 ♟' }]
    const hit = suggest.find((x) => s >= x.at)
    if (hit) {
      room.streakSuggested = true
      pushChat(room, sysMsg(`${AI_NAME}：${hit.text}`))
    }
  }
}

/** 对局结束上报到 Next API 持久化 */
function reportMatch(room: Room) {
  const { black, white } = room.seats
  if (!black || !white) return
  const body = {
    roomCode: room.code,
    blackName: black.name,
    whiteName: white.name,
    blackPid: black.playerId,
    whitePid: white.playerId,
    winnerColor: room.winner ?? 0,
    endReason: room.endReason || 'five',
    moveCount: room.moves.length,
    durationMs: room.startedAt ? Date.now() - room.startedAt : 0,
    mode: room.mode,
    difficulty: room.mode === 'solo' ? room.difficulty : '',
    moves: room.moves.map((m) => `${m.index},${m.color}`).join(';'),
    evals: room.evals.map((v) => Math.round(v * 100)).join(','),
  }
  fetch('http://127.0.0.1:3000/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}

// ---------------------------------------------------------------------------

function takeSeat(room: Room, seatKey: 'black' | 'white', playerId: string, name: string, socket: Socket) {
  room.seats[seatKey] = { playerId, name, socketId: socket.id, connected: true, disconnectedAt: null }
  socket.join(room.code)
  maybeStart(room)
}

function maybeStart(room: Room) {
  if (room.status === 'waiting' && room.seats.black && room.seats.white) {
    room.status = 'playing'
    room.startedAt = Date.now()
    room.round += 1
    room.turn = 1
    room.deadline = Date.now() + MOVE_SECONDS * 1000
    pushChat(room, sysMsg('对局开始，黑先行'))
    if (room.seats.black?.isAI || room.seats.white?.isAI)
      pushChat(room, sysMsg(`${AI_NAME}（${DIFFICULTY_LABEL[room.difficulty]}）：请多指教，放马过来～`))
    scheduleAI(room)
  }
}

/** 加入房间：老玩家回归 / 空位入座 / 观战 */
function joinRoom(socket: Socket, rawCode: string, playerId: string, name: string): { ok: boolean; message?: string } {
  const code = String(rawCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
  const room = rooms.get(code)
  if (!room) return { ok: false, message: '房间不存在或已解散，请检查房号' }

  socket.join(room.code)
  room.emptyAt = null

  // 老玩家重连回归
  for (const key of ['black', 'white'] as const) {
    const seat = room.seats[key]
    if (seat && seat.playerId === playerId) {
      const wasOffline = !seat.connected
      seat.socketId = socket.id
      seat.connected = true
      seat.name = name
      seat.disconnectedAt = null
      room.disconnDeadline = null
      if (wasOffline) pushChat(room, sysMsg(`${name} 回到了对局`))
      scheduleAI(room)
      broadcast(room)
      return { ok: true }
    }
  }
  if (room.spectators.has(socket.id)) {
    broadcast(room)
    return { ok: true }
  }

  // 空位入座
  if (!room.seats.black) {
    takeSeat(room, 'black', playerId, name, socket)
    pushChat(room, sysMsg(`${name} 加入房间（执黑）`))
    broadcast(room)
    return { ok: true }
  }
  if (!room.seats.white) {
    takeSeat(room, 'white', playerId, name, socket)
    pushChat(room, sysMsg(`${name} 加入房间（执白）`))
    broadcast(room)
    return { ok: true }
  }

  // 人机房间：满员但其中有 AI 座 → 好友接管（随时变真人对战）
  if (room.mode === 'solo') {
    for (const key of ['black', 'white'] as const) {
      const seat = room.seats[key]
      if (seat?.isAI) {
        const colorWord = key === 'black' ? '黑' : '白'
        room.seats[key] = { playerId, name, socketId: socket.id, connected: true, disconnectedAt: null }
        room.mode = 'pvp'
        pushChat(room, sysMsg(`${name} 接管了 AI 座位（执${colorWord}），变真人对战！`))
        broadcast(room)
        return { ok: true }
      }
    }
  }

  // 满员 → 观战
  room.spectators.set(socket.id, { playerId, name })
  pushChat(room, sysMsg(`${name} 进入观战`))
  broadcast(room)
  return { ok: true }
}

function leaveRoom(socket: Socket, explicit: boolean) {
  for (const room of rooms.values()) {
    let touched = false
    for (const key of ['black', 'white'] as const) {
      const seat = room.seats[key]
      if (!seat || seat.socketId !== socket.id) continue
      touched = true
      seat.connected = false
      seat.socketId = null
      seat.disconnectedAt = Date.now()
      if (explicit) {
        // 主动离开：对局中视为认输，等待中直接让位
        if (room.status === 'playing') {
          pushChat(room, sysMsg(`${seat.name} 离开了对局`))
          endGame(room, key === 'black' ? 2 : 1, 'resign')
        } else {
          pushChat(room, sysMsg(`${seat.name} 离开了房间`))
        }
        if (room.status !== 'playing') {
          room.seats[key] = null
          if (room.status === 'ended') room.rematch = { black: false, white: false }
        }
      } else if (room.status === 'playing') {
        room.disconnDeadline = Date.now() + RECONNECT_SECONDS * 1000
        pushChat(room, sysMsg(`${seat.name} 连接断开，${RECONNECT_SECONDS} 秒内未回归将判负`))
      } else {
        pushChat(room, sysMsg(`${seat.name} 连接断开`))
      }
    }
    if (room.spectators.has(socket.id)) {
      const sp = room.spectators.get(socket.id)!
      room.spectators.delete(socket.id)
      pushChat(room, sysMsg(`${sp.name} 离开观战`))
      touched = true
    }
    if (touched) {
      if (explicit) socket.leave(room.code) // 退出后不再接收该房间广播
      broadcast(room)
    }
  }
}

// ---------------------------------------------------------------------------
// AI 棋手「弈心」：胜负预判 + 棋型评分启发式
// ---------------------------------------------------------------------------

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

/** AI 难度配置：防守权重 / 随机扰动 / 漏堵概率 / 前瞻候选数 / 应答延迟 */
interface AIProfile {
  atkW: number // 我方棋型攻击权重（>1 时主动制造威胁而非纯镜像防守）
  defW: number
  noise: number
  blockMiss: number
  lookahead: number // 净收益前瞻候选数（轻量启发式）
  search: number // alpha-beta 搜索深度（3 = 我-敌-我 三层真搜索，仅大师）
  combo: boolean // 双威胁识别（冲四活三/双活三/双四）
  vct: boolean // 连续威胁算杀（冲四强制手搜索）
  vctDepth: number // VCT 算杀深度（我方剩余手数，0=关闭；3 = 四→挡→四→挡→五 连续杀）
  delay: [number, number]
}
const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: { atkW: 1.0, defW: 0.5, noise: 340, blockMiss: 0.28, lookahead: 0, search: 0, combo: false, vct: false, vctDepth: 0, delay: [360, 780] },
  normal: { atkW: 1.05, defW: 0.85, noise: 6, blockMiss: 0, lookahead: 0, search: 3, combo: true, vct: false, vctDepth: 0, delay: [480, 960] },
  hard: { atkW: 1.05, defW: 1.0, noise: 0, blockMiss: 0, lookahead: 0, search: 5, combo: true, vct: true, vctDepth: 3, delay: [650, 1300] },
}

function wouldWin(board: number[], idx: number, color: Color): boolean {
  board[idx] = color
  const win = findWinLine(board, idx, color)
  board[idx] = 0
  return win !== null
}

function lineScore(count: number, open: number): number {
  if (count >= 5) return 1_000_000
  if (count === 4) return open === 2 ? 100_000 : open === 1 ? 12_000 : 0
  if (count === 3) return open === 2 ? 6_000 : open === 1 ? 600 : 0
  if (count === 2) return open === 2 ? 250 : open === 1 ? 60 : 0
  return open === 2 ? 20 : open === 1 ? 5 : 0
}

/** 假设在 idx 落 color 后，四个方向的棋型总分 */
function evalPoint(board: number[], idx: number, color: Color): number {
  const r0 = Math.floor(idx / SIZE)
  const c0 = idx % SIZE
  let total = 0
  for (const [dr, dc] of DIRS) {
    let count = 1
    let open = 0
    for (const sign of [1, -1] as const) {
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

/** 候选点棋型画像：四冲数 / 活三数（用于双威胁组合识别） */
function threatProfile(board: number[], idx: number, color: Color): { four: number; openThree: number } {
  const r0 = Math.floor(idx / SIZE)
  const c0 = idx % SIZE
  let four = 0
  let openThree = 0
  for (const [dr, dc] of DIRS) {
    let count = 1
    let open = 0
    for (const sign of [1, -1] as const) {
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

/** 组合威胁：双四 / 冲四活三 / 双活三 → 下一手几乎必胜 */
function isDoubleThreat(p: { four: number; openThree: number }): boolean {
  return p.four >= 2 || (p.four >= 1 && p.openThree >= 1) || p.openThree >= 2
}

// ================= 大师真搜索（alpha-beta + 全盘棋型评估） =================

const SEARCH_WIN = 9_000_000
const SEARCH_BRANCH = 10 // 每层候选裁剪数

/** 单条同色棋段的棋型分（count 连子数 / open 端点空位数） */
function runScore(count: number, open: number): number {
  if (count >= 5) return 10_000_000
  if (count === 4) return open === 2 ? 1_000_000 : open === 1 ? 120_000 : 0
  if (count === 3) return open === 2 ? 50_000 : open === 1 ? 5_000 : 0
  if (count === 2) return open === 2 ? 2_000 : open === 1 ? 400 : 0
  return open === 2 ? 20 : open === 1 ? 5 : 0
}

/** 全盘评估（side 视角）：四方向扫描所有极大同色段累计棋型分 */
function boardEval(board: number[], side: Color): number {
  const opp: Color = side === 1 ? 2 : 1
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
        if (prevColor === color) continue // 非段首
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
  return mine - theirs * 0.95 // 轻微攻击偏好：己方棋型略贵于对方
}

/** 搜索内候选：攻防综合分前 K（裁剪分支） */
function topMoves(board: number[], me: Color, k: number): number[] {
  const opp: Color = me === 1 ? 2 : 1
  const scored = nearCandidates(board).map((i) => ({
    idx: i,
    s: evalPoint(board, i, me) + evalPoint(board, i, opp) * 0.9,
  }))
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, k).map((x) => x.idx)
}

/** negamax alpha-beta：返回 me（行棋方）视角评估值；优先检测一步成五（快胜偏好）；budget 防病态展开 */
function searchBest(board: number[], me: Color, depth: number, alpha: number, beta: number, budget: { n: number }): number {
  if (budget.n <= 0) return boardEval(board, me)
  budget.n--
  const opp: Color = me === 1 ? 2 : 1
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

/** 候选点生成：距任一已落棋子切比雪夫距离 ≤ 2 的空位（VCT 搜索空间裁剪） */
function nearCandidates(board: number[]): number[] {
  const out: number[] = []
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

/**
 * 大师 VCT（Victory by Continuous Threats）算杀：
 * 仅搜索强制手（我方冲四/活四），对手分支坍缩至成五挡点（防病态展开）。
 * movesLeft 为我方剩余手数：2 = 冲四→（挡）→成五；3 = 冲四→（挡）→冲四→（挡）→成五 等连续杀。
 * budget 为节点预算（防偶发局面组合爆炸），返回制胜首手，无杀返回 null。
 */
function vctWin(board: number[], me: Color, movesLeft: number, budget: { n: number }): number | null {
  const opp: Color = me === 1 ? 2 : 1
  const cands = nearCandidates(board)
  // 1) 直接成五
  for (const i of cands) if (wouldWin(board, i, me)) return i
  if (movesLeft <= 1) return null

  // 2) 收集强制手：能形成四（对手唯一挡点）的点
  const forcing: number[] = []
  for (const i of cands) {
    if (threatProfile(board, i, me).four >= 1) forcing.push(i)
  }

  for (const i of forcing) {
    if (budget.n <= 0) return null
    budget.n--
    board[i] = me
    // 对手若能立即反成五，此强制手失效（除非 i 本身就是那一点，但那属于上方直接成五分支）
    let oppFive: number | null = null
    for (const j of cands) {
      if (j === i) continue
      if (wouldWin(board, j, opp)) {
        oppFive = j
        break
      }
    }
    let win = false
    if (oppFive === null) {
      // 我方成五点集合；有四在身时对手别无选择，必须挡在其中一个成五点上（分支极窄）
      const myWinPoints = cands.filter((k) => k !== i && wouldWin(board, k, me))
      if (myWinPoints.length === 0) {
        board[i] = 0
        continue // 该手不构成后续威胁，非强制杀
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

function aiChooseMove(room: Room): number {
  const profile = AI_PROFILES[room.difficulty] ?? AI_PROFILES.normal
  const board = room.board
  const me: Color = room.turn
  const opp: Color = me === 1 ? 2 : 1
  const empties: number[] = []
  for (let i = 0; i < CELLS; i++) if (!board[i]) empties.push(i)
  if (empties.length === 0) return -1

  // 开局天元，第二手贴身防守
  if (room.moves.length === 0) return 112
  if (room.moves.length === 1) {
    const last = room.moves[0].index
    const lr = Math.floor(last / SIZE)
    const lc = last % SIZE
    const adj: number[] = []
    for (const [dr, dc] of DIRS)
      for (const sign of [1, -1] as const) {
        const rr = lr + dr * sign
        const cc = lc + dc * sign
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === 0) adj.push(rr * SIZE + cc)
      }
    if (adj.length) return adj[Math.floor(Math.random() * adj.length)]
  }

  // 1) 能立即赢就赢  2) 对方将赢必堵（入门有概率漏堵：跳过抢占检查且本回合对威胁降敏，形成真实失误）
  for (const i of empties) if (wouldWin(board, i, me)) return i
  const missedBlock = Math.random() < profile.blockMiss
  if (!missedBlock) {
    for (const i of empties) if (wouldWin(board, i, opp)) return i
  }
  const defScale = missedBlock ? 0.3 : 1

  // 1.5) 大师 VCT：连续威胁强制杀（冲四→挡→冲四→挡→成五 深度连续杀）
  if (profile.vct && profile.vctDepth > 0) {
    const kill = vctWin(board, me, profile.vctDepth, { n: 24000 })
    if (kill !== null && kill >= 0) return kill
    // 对手若有连续杀点，进入防守反杀：不盲抢杀点，而是在对方强制手集合里
    // 选「封堵同时自身攻击价值最高」的一点（挡一手还带一手威胁）
    // 对手有连续杀点 → 直接抢占（深度搜索会综合评估该点的攻防价值）
    const oppKill = vctWin(board, opp, profile.vctDepth, { n: 24000 })
    if (oppKill !== null && oppKill >= 0) return oppKill
  }

  // 3) 攻防加权评分（大师额外识别双威胁组合点）
  const scored = empties.map((i) => {
    const r = Math.floor(i / SIZE)
    const c = i % SIZE
    const center = 6 - Math.max(Math.abs(r - 7), Math.abs(c - 7))
    let comboMe = 0
    let comboOpp = 0
    if (profile.combo) {
      // 我方落此形成双威胁 → 近似必胜；对方落此形成双威胁 → 必须抢先封堵
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

  // 4) 大师：3 层真搜索（我-敌-我）——考虑对手最佳回应与我方后续手段，天然兼顾「防守反杀」
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

  // 4b) 进阶：轻量净收益前瞻 —— 模拟落子后对手的最佳回应，选「我方收益 − 对方回应威胁」最大者
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

/** 统一落子入口（真人/AI 共用）：返回是否成功，胜利/和棋时已内部收尾 */
function applyMove(room: Room, index: number): boolean {
  if (room.status !== 'playing') return false
  const indexNum = Number(index)
  if (!Number.isInteger(indexNum) || indexNum < 0 || indexNum >= CELLS) return false
  if (room.board[indexNum] !== 0) return false
  const color: Color = room.turn
  const usedHint = !!room.hint && room.hint.color === color // 该手是否借助提示（悔棋返还）
  room.board[indexNum] = color
  room.moves.push({ index: indexNum, color })
  room.hintAssisted.push(usedHint)
  room.lastMove = indexNum
  room.hint = null // 新手落地后旧提示作废
  if (room.undoReq === color) room.undoReq = null
  const winLine = findWinLine(room.board, indexNum, color)
  if (winLine) {
    room.evals.push(color === 1 ? 1 : 0)
    endGame(room, color, 'five', winLine)
    return true
  }
  if (room.moves.length >= CELLS) {
    room.evals.push(0.5)
    endGame(room, 0, 'draw')
    return true
  }
  room.turn = color === 1 ? 2 : 1
  room.evals.push(estimateWinRate(room.board, room.turn === 1))
  room.deadline = Date.now() + MOVE_SECONDS * 1000
  scheduleAI(room)
  return true
}

/** 同意悔棋（真人对手或 AI 自动同意共用） */
function performUndoAccept(room: Room) {
  if (room.status !== 'playing' || !room.undoReq) return
  const color = room.undoReq
  const seat = color === 1 ? room.seats.black : room.seats.white
  if (!seat) return
  // 移除该方最后一颗子
  let removedIdx = -1
  for (let i = room.moves.length - 1; i >= 0; i--) {
    if (room.moves[i].color === color) {
      room.board[room.moves[i].index] = 0
      room.moves.splice(i, 1)
      removedIdx = i
      break
    }
  }
  // 评估曲线回退一手；被撤销的手若借助过提示则返还 1 次
  room.evals = room.evals.slice(0, room.moves.length + 1)
  room.evals[room.moves.length] = room.moves.length === 0 ? 0.5 : estimateWinRate(room.board, room.turn === 1)
  const wasAssisted = removedIdx >= 0 ? room.hintAssisted[removedIdx] === true : false
  if (removedIdx >= 0) room.hintAssisted.splice(removedIdx, 1)
  if (wasAssisted) {
    if (color === 1) room.hintsLeft.black = Math.min(HINTS_PER_GAME, room.hintsLeft.black + 1)
    else room.hintsLeft.white = Math.min(HINTS_PER_GAME, room.hintsLeft.white + 1)
  }
  room.lastMove = room.moves.length ? room.moves[room.moves.length - 1].index : null
  room.undoReq = null
  room.deadline = Date.now() + MOVE_SECONDS * 1000
  pushChat(room, sysMsg(`对方同意悔棋，${seat.name} 请重新落子${wasAssisted ? '（已返还 1 次提示）' : ''}`))
  scheduleAI(room)
  broadcast(room)
}

function scheduleAI(room: Room) {
  if (room.status !== 'playing') return
  const seat = room.turn === 1 ? room.seats.black : room.seats.white
  if (!seat?.isAI) return
  const key = `${room.round}:${room.moves.length}`
  if (room.aiKey === key) return
  room.aiKey = key
  const [dMin, dMax] = (AI_PROFILES[room.difficulty] ?? AI_PROFILES.normal).delay
  const delay = dMin + Math.floor(Math.random() * (dMax - dMin))
  setTimeout(() => {
    try {
      if (room.status !== 'playing') return
      const cur = room.turn === 1 ? room.seats.black : room.seats.white
      if (!cur?.isAI) return
      if (`${room.round}:${room.moves.length}` !== key) return
      const idx = aiChooseMove(room)
      if (idx >= 0 && applyMove(room, idx)) broadcast(room)
      else console.error(`[ai] applyMove failed room=${room.code} idx=${idx} moves=${room.moves.length}`)
    } catch (e) {
      console.error(`[ai] chooseMove error room=${room.code}:`, e)
    }
  }, delay)
}

// ---------------------------------------------------------------------------
// 局势评估：观战胜率 / 复盘曲线（5 连窗口打分 + elo 式映射）
// ---------------------------------------------------------------------------

/** 预计算全盘所有五连窗口 */
const WINDOWS: number[][] = (() => {
  const ws: number[][] = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 4 < SIZE) ws.push([0, 1, 2, 3, 4].map((k) => r * SIZE + c + k))
      if (r + 4 < SIZE) ws.push([0, 1, 2, 3, 4].map((k) => (r + k) * SIZE + c))
      if (r + 4 < SIZE && c + 4 < SIZE) ws.push([0, 1, 2, 3, 4].map((k) => (r + k) * SIZE + c + k))
      if (r + 4 < SIZE && c - 4 >= 0) ws.push([0, 1, 2, 3, 4].map((k) => (r + k) * SIZE + c - k))
    }
  }
  return ws
})()
const WIN_SEQ = [0, 2, 12, 90, 720, 100000] // 窗口内 k 枚同子的分值

/** 某色全盘窗口得分 */
function boardScore(board: number[], color: Color): number {
  let s = 0
  for (const w of WINDOWS) {
    let mine = 0
    let blocked = false
    for (const i of w) {
      const v = board[i]
      if (v === color) mine++
      else if (v !== 0) {
        blocked = true
        break
      }
    }
    if (!blocked && mine) s += WIN_SEQ[mine]
  }
  return s
}

/** 黑方胜率估算(0-1)：窗口分差 elo 映射 + 先行小幅加成，限制在 3%-97% */
function estimateWinRate(board: number[], blackToMove: boolean): number {
  const b = boardScore(board, 1)
  const w = boardScore(board, 2)
  const adv = (b - w * 1.06) / 800 + (blackToMove ? 0.12 : -0.12)
  const p = 1 / (1 + Math.pow(10, -adv))
  return Math.min(0.97, Math.max(0.03, p))
}

/**
 * 计算落子提示（供 room.turn 一方使用）：
 * 1) 我方成五点 → win  2) 对方成五点 → block  3) 攻防均衡评分最高点 → best
 */
function computeHint(room: Room, color: Color): HintInfo | null {
  if (room.status !== 'playing' || room.turn !== color) return null
  const board = room.board
  const opp: Color = color === 1 ? 2 : 1
  const empties: number[] = []
  for (let i = 0; i < CELLS; i++) if (!board[i]) empties.push(i)
  if (!empties.length) return null
  for (const i of empties) if (wouldWin(board, i, color)) return { index: i, kind: 'win', color }
  for (const i of empties) if (wouldWin(board, i, opp)) return { index: i, kind: 'block', color }
  let bestIdx = empties[0]
  let bestScore = -Infinity
  for (const i of empties) {
    const r = Math.floor(i / SIZE)
    const c = i % SIZE
    const center = 6 - Math.max(Math.abs(r - 7), Math.abs(c - 7))
    const s = evalPoint(board, i, color) + evalPoint(board, i, opp) + center * 3
    if (s > bestScore) {
      bestScore = s
      bestIdx = i
    }
  }
  return { index: bestIdx, kind: 'best', color }
}

/** AI 对局收尾动作：悔棋同意 / 再战同意（若对方座是 AI） */
function aiAutoRespond(room: Room, kind: 'undo' | 'rematch') {
  setTimeout(() => {
    if (kind === 'undo') {
      if (room.status === 'playing' && room.undoReq) performUndoAccept(room)
    } else {
      if (room.status !== 'ended') return
      const aiKey = room.seats.black?.isAI ? 'black' : room.seats.white?.isAI ? 'white' : null
      if (!aiKey) return
      const humanKey = aiKey === 'black' ? 'white' : 'black'
      if (!room.rematch[humanKey]) return
      if (!room.rematch[aiKey]) {
        room.rematch[aiKey] = true
        resetGame(room, true)
        broadcast(room)
      }
    }
  }, kind === 'undo' ? 750 : 650)
}

// ---------------------------------------------------------------------------

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

type Ack = (res?: { ok: boolean; code?: string; message?: string }) => void

/** 加入新房间前退出旧房间：一个 socket 同时只属于一个游戏房间，避免多房间状态广播竞争 */
function leaveAllRooms(socket: Socket) {
  for (const r of socket.rooms) {
    if (r !== socket.id) void socket.leave(r)
  }
}

io.on('connection', (socket) => {
  socket.on('room:create', (data: { playerId?: string; name?: string; mode?: string; difficulty?: string }, cb?: Ack) => {
    leaveAllRooms(socket)
    const playerId = String(data?.playerId ?? '').slice(0, 64) || uid()
    const name = cleanName(data?.name)
    if (rooms.size >= MAX_ROOMS) {
      // 回收最早创建的房间
      const oldest = [...rooms.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
      if (oldest) rooms.delete(oldest.code)
    }
    const mode = data?.mode === 'solo' ? 'solo' : 'pvp'
    const difficulty: Difficulty =
      data?.difficulty === 'easy' || data?.difficulty === 'hard' ? (data.difficulty as Difficulty) : 'normal'
    const room = createRoom(mode, difficulty)
    takeSeat(room, 'black', playerId, name, socket)
    if (mode === 'solo') {
      room.seats.white = makeAISeat()
      maybeStart(room)
      scheduleAI(room)
    }
    cb?.({ ok: true, code: room.code })
    broadcast(room)
  })

  socket.on('room:join', (data: { code?: string; playerId?: string; name?: string }, cb?: Ack) => {
    leaveAllRooms(socket)
    const playerId = String(data?.playerId ?? '').slice(0, 64) || uid()
    const name = cleanName(data?.name)
    const res = joinRoom(socket, data?.code ?? '', playerId, name)
    cb?.(res)
    if (!res.ok) socket.emit('room:error', { message: res.message })
  })

  socket.on('room:rejoin', (data: { code?: string; playerId?: string; name?: string }) => {
    leaveAllRooms(socket)
    const playerId = String(data?.playerId ?? '')
    const name = cleanName(data?.name)
    if (!playerId) return
    const res = joinRoom(socket, data?.code ?? '', playerId, name)
    if (res.ok) socket.emit('room:rejoined', { ok: true, code: String(data?.code ?? '').toUpperCase() })
    else socket.emit('room:expired', { code: String(data?.code ?? '') })
  })

  socket.on('room:leave', () => leaveRoom(socket, true))

  // 房间预览：不加入房间，仅读取公共信息（大厅输房号/邀请链接进入时显示房主资料卡）
  socket.on('room:peek', (data: { code?: string }, cb?: Ack) => {
    const code = String(data?.code ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return cb?.({ ok: false })
    const human = (seat: Seat | null) => (seat && !seat.isAI ? seat : null)
    const blackHuman = human(room.seats.black)
    const whiteHuman = human(room.seats.white)
    // 房主 = 黑座（创建者固定坐黑，solo 亦为真人）；黑座空则视为白座
    const host = blackHuman ?? whiteHuman
    cb?.({
      ok: true,
      code: room.code,
      mode: room.mode,
      status: room.status,
      difficulty: room.mode === 'solo' ? room.difficulty : null,
      round: room.round,
      hostName: host?.name ?? null,
      hostPid: host?.playerId ?? null,
      hostColor: room.seats.black ? 1 : 2,
      blackName: room.seats.black?.name ?? null,
      whiteName: room.seats.white?.name ?? null,
      seatFree: !room.seats.black || !room.seats.white,
      spectators: room.spectators.size,
    })
  })

  // solo 房内切换 AI 难度（仅真人座位可操作，对局中也可即时生效）
  socket.on('room:difficulty', (data: { difficulty?: string }) => {
    if (data?.difficulty !== 'easy' && data?.difficulty !== 'normal' && data?.difficulty !== 'hard') return
    const d: Difficulty = data.difficulty
    for (const room of rooms.values()) {
      if (room.mode !== 'solo' || room.difficulty === d) continue
      const isSeatedHuman =
        (room.seats.black?.socketId === socket.id && !room.seats.black?.isAI) ||
        (room.seats.white?.socketId === socket.id && !room.seats.white?.isAI)
      if (!isSeatedHuman) continue
      const from = DIFFICULTY_LABEL[room.difficulty]
      room.difficulty = d
      room.streakSuggested = false // 升级后重新开启建议窗口
      room.aiKey = undefined // 允许 AI 立即以新参数重新排程
      pushChat(room, sysMsg(`弈心·AI 难度已切换：${from} → ${DIFFICULTY_LABEL[d]}`))
      pushChat(room, sysMsg(`${AI_NAME}（${DIFFICULTY_LABEL[d]}）：${d === 'hard' ? '认真起来了，接招！' : d === 'normal' ? '好的，我们继续切磋～' : '轻松下，你随意～'}`))
      scheduleAI(room)
      broadcast(room)
    }
  })

  socket.on('game:move', (data: { index?: number }) => {
    const index = Number(data?.index)
    if (!Number.isInteger(index) || index < 0 || index >= CELLS) return
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue
      const myColor: Color | null =
        room.seats.black?.socketId === socket.id ? 1 : room.seats.white?.socketId === socket.id ? 2 : null
      if (!myColor || myColor !== room.turn) continue
      if (applyMove(room, index)) broadcast(room)
      return
    }
  })

  socket.on('game:resign', () => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue
      if (room.seats.black?.socketId === socket.id) endGame(room, 2, 'resign')
      else if (room.seats.white?.socketId === socket.id) endGame(room, 1, 'resign')
    }
  })

  socket.on('game:undo-request', () => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing' || room.undoReq) continue
      const seat = room.seats.black?.socketId === socket.id ? room.seats.black : room.seats.white?.socketId === socket.id ? room.seats.white : null
      if (!seat) continue
      const myColor: Color = room.seats.black === seat ? 1 : 2
      if (room.turn !== myColor) continue
      if (!room.moves.some((m) => m.color === myColor)) continue
      const opp = myColor === 1 ? room.seats.white : room.seats.black
      if (!opp?.connected) continue
      room.undoReq = myColor
      pushChat(room, sysMsg(`${seat.name} 请求悔棋`))
      const oppSeat = myColor === 1 ? room.seats.white : room.seats.black
      if (oppSeat?.isAI) aiAutoRespond(room, 'undo') // AI 友好同意
      broadcast(room)
    }
  })

  socket.on('game:undo-accept', () => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing' || !room.undoReq) continue
      const color = room.undoReq
      const isOpponent = (color === 1 && room.seats.white?.socketId === socket.id) || (color === 2 && room.seats.black?.socketId === socket.id)
      if (!isOpponent) continue
      performUndoAccept(room)
    }
  })

  socket.on('game:undo-reject', () => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing' || !room.undoReq) continue
      const color = room.undoReq
      const isOpponent = (color === 1 && room.seats.white?.socketId === socket.id) || (color === 2 && room.seats.black?.socketId === socket.id)
      if (!isOpponent) continue
      const seat = color === 1 ? room.seats.black : room.seats.white
      room.undoReq = null
      pushChat(room, sysMsg(`对方拒绝了悔棋请求`))
      broadcast(room)
    }
  })

  socket.on('game:rematch', () => {
    for (const room of rooms.values()) {
      if (room.status !== 'ended') continue
      if (room.seats.black?.socketId === socket.id) {
        if (!room.rematch.black) {
          room.rematch.black = true
          pushChat(room, sysMsg(`${room.seats.black.name} 想再来一局`))
        }
      } else if (room.seats.white?.socketId === socket.id) {
        if (!room.rematch.white) {
          room.rematch.white = true
          pushChat(room, sysMsg(`${room.seats.white.name} 想再来一局`))
        }
      } else continue
      if (room.rematch.black && room.rematch.white) {
        resetGame(room, true) // 换边再战
      } else if (room.mode === 'solo') {
        aiAutoRespond(room, 'rematch') // AI 稍后自动同意
      }
      broadcast(room)
    }
  })

  socket.on('game:hint', () => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue
      const myColor: Color | null =
        room.seats.black?.socketId === socket.id ? 1 : room.seats.white?.socketId === socket.id ? 2 : null
      if (!myColor || myColor !== room.turn) continue
      const left = myColor === 1 ? room.hintsLeft.black : room.hintsLeft.white
      if (left <= 0) continue
      const hint = computeHint(room, myColor)
      if (!hint) continue
      if (myColor === 1) room.hintsLeft.black -= 1
      else room.hintsLeft.white -= 1
      room.hint = hint
      const kindText = hint.kind === 'win' ? '必胜点' : hint.kind === 'block' ? '防守点' : '推荐点'
      const pos = `${'ABCDEFGHJKLMNOP'[hint.index % SIZE]}${SIZE - Math.floor(hint.index / SIZE)}`
      pushChat(room, sysMsg(`${(myColor === 1 ? room.seats.black?.name : room.seats.white?.name) ?? '玩家'} 使用了提示（${kindText} ${pos}）`))
      broadcast(room)
      return
    }
  })

  socket.on('chat:send', (data: { text?: string }) => {
    const text = String(data?.text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200)
    if (!text) return
    for (const room of rooms.values()) {
      if (!socket.rooms.has(room.code)) continue
      let from = '观战者'
      let color = 0
      if (room.seats.black?.socketId === socket.id) {
        from = room.seats.black.name
        color = 1
      } else if (room.seats.white?.socketId === socket.id) {
        from = room.seats.white.name
        color = 2
      } else {
        const sp = room.spectators.get(socket.id)
        from = sp ? sp.name : '观战者'
      }
      pushChat(room, { id: uid(), from, color, text, ts: Date.now() })
      broadcast(room)
    }
  })

  // 表情弹幕：白名单校验 + 冷却限频，瞬时广播不入房间状态
  socket.on('game:react', (data: { emoji?: string }) => {
    const emoji = String(data?.emoji ?? '')
    if (!REACTION_WHITELIST.includes(emoji)) return
    const now = Date.now()
    const last = lastReactAt.get(socket.id) ?? 0
    if (now - last < REACTION_COOLDOWN_MS) return
    lastReactAt.set(socket.id, now)
    for (const room of rooms.values()) {
      if (!socket.rooms.has(room.code)) continue
      let from = '观战者'
      let color = 0
      if (room.seats.black?.socketId === socket.id) {
        from = room.seats.black.name
        color = 1
      } else if (room.seats.white?.socketId === socket.id) {
        from = room.seats.white.name
        color = 2
      } else {
        const sp = room.spectators.get(socket.id)
        from = sp ? sp.name : '观战者'
      }
      io.to(room.code).emit('game:reaction', { emoji, from, color, ts: now })
    }
  })

  socket.on('disconnect', () => {
    leaveRoom(socket, false)
    lastReactAt.delete(socket.id)
    emitPresence()
  })

  socket.on('error', (err) => console.error(`socket error ${socket.id}:`, err))

  // 新连接上线后广播最新在线人数（大厅展示）
  emitPresence()
})

// ---------------------------------------------------------------------------

/** 表情弹幕冷却表（socketId -> 上次发送时间） */
const lastReactAt = new Map<string, number>()

/** 全服在线人数广播（大厅展示）；延迟一拍等 engine 扣减完断开连接，避免竞态 */
function emitPresence() {
  setTimeout(() => io.emit('lobby:presence', { online: io.engine.clientsCount }), 80)
}

/** 周期检查：超时判负 / 掉线判负 / 空位清理 / 房间回收 */
setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.status === 'playing') {
      if (room.deadline && now >= room.deadline) {
        endGame(room, room.turn === 1 ? 2 : 1, 'timeout')
        continue
      }
      if (room.disconnDeadline && now >= room.disconnDeadline) {
        const offKey = (['black', 'white'] as const).find((k) => room.seats[k] && !room.seats[k]!.connected)
        if (offKey) {
          endGame(room, offKey === 'black' ? 2 : 1, 'disconnect')
          continue
        }
        room.disconnDeadline = null
      }
    }
    // 仅在等待状态下回收掉线者的座位（已结束的对局保留名单便于复盘/再战）
    if (room.status === 'waiting') {
      for (const key of ['black', 'white'] as const) {
        const seat = room.seats[key]
        if (seat && !seat.connected && seat.disconnectedAt && now - seat.disconnectedAt > WAITING_KICK_SECONDS * 1000) {
          pushChat(room, sysMsg(`${seat.name} 已离开，座位释放`))
          room.seats[key] = null
          room.rematch = { black: false, white: false }
          broadcast(room)
        }
      }
    }
    // 空房间回收
    const hasConnected = (!!room.seats.black?.connected || !!room.seats.white?.connected || room.spectators.size > 0)
    if (!hasConnected) {
      if (!room.emptyAt) room.emptyAt = now
      else if (now - room.emptyAt > ROOM_TTL_MS) rooms.delete(code)
    } else {
      room.emptyAt = null
    }
  }
}, 1000)

httpServer.listen(PORT, () => {
  console.log(`♠ gomoku-server (socket.io) listening on :${PORT}`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
process.on('SIGINT', () => httpServer.close(() => process.exit(0)))
