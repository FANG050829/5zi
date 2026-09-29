// ---------------------------------------------------------------------------
// 联机五子棋 — 对战引擎（权威逻辑，纯状态机，可序列化）
// 自 mini-services/gomoku-server/index.ts 移植：去除 socket.io / 定时器，
// 改为「请求驱动 + 惰性 tick」的无状态调用模型，适配 Serverless（Netlify）部署。
// 存储与 AI 调度由 ./store.ts 与 ./runtime.ts 编排。
// ---------------------------------------------------------------------------

import type { AiModelConfig } from '@/lib/gomoku/ai-config'

export const SIZE = 15
export const CELLS = SIZE * SIZE
export const MOVE_SECONDS = 60 // 每步限时
export const RECONNECT_SECONDS = 60 // 掉线判负等待
export const WAITING_KICK_SECONDS = 30 // 等待状态下掉线者保留座位时长
export const ROOM_TTL_MS = 10 * 60 * 1000 // 空房间回收
export const MAX_ROOMS = 500
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const HINTS_PER_GAME = 3 // 每局每方提示次数
export const REACTION_WHITELIST = ['👏', '😂', '🤔', '😱', '😅', '🔥', '👍', '😮'] // 表情弹幕白名单
export const REACTION_COOLDOWN_MS = 700 // 发送最小间隔
/** 轮询模式下判定「在线」的心跳窗口（客户端 1.3s 一跳，留足抖动余量） */
export const SEEN_FRESH_MS = 8000

export type Color = 1 | 2 // 1 黑 2 白
export type Status = 'waiting' | 'playing' | 'ended'
export type Difficulty = 'easy' | 'normal' | 'hard'
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '入门', normal: '进阶', hard: '大师' }

export interface Seat {
  playerId: string
  name: string
  connected: boolean
  disconnectedAt: number | null
  isAI?: boolean
  /** 最后一次心跳（状态轮询/操作）时间，驱动掉线判定 */
  lastSeen: number
}

export interface ChatMsg {
  id: string
  from: string
  color: number // 1 黑 2 白 0 系统/观战
  text: string
  ts: number
}

export type HintKind = 'win' | 'block' | 'best'
export interface HintInfo {
  index: number
  kind: HintKind
  color: Color
}

export interface ReactionRecord {
  emoji: string
  from: string
  color: number
  ts: number
}

export interface Room {
  code: string
  mode: 'pvp' | 'solo' // solo: 人机对战（AI 占白座）
  difficulty: Difficulty // solo 模式 AI 难度
  seats: { black: Seat | null; white: Seat | null }
  spectators: Record<string, { playerId: string; name: string }>
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
  streakSuggested?: boolean // solo 难度升级建议已提示（每次成功升级后重置）
  streak: { playerId: string; count: number } | null // 房间内真人连胜（跨局累计）
  createdAt: number
  emptyAt: number | null
  /** solo + 自定义 AI 时的模型配置（含密钥，绝不进 publicState） */
  aiConfig: AiModelConfig | null
  /** 最近表情弹幕（供轮询客户端差量取用） */
  recentReactions: ReactionRecord[]
  /** 每 pid 上次发弹幕时间（服务端限频） */
  reactAt: Record<string, number>
  /** 终局已上报战绩（避免重复入库） */
  reported?: boolean
}

export const AI_PLAYER_ID = 'ai-yixin'
export const AI_NAME = '弈心·AI'
export const CUSTOM_AI_PLAYER_ID = 'ai-llm'

export function makeAISeat(name: string = AI_NAME): Seat {
  return { playerId: AI_PLAYER_ID, name, connected: true, disconnectedAt: null, isAI: true, lastSeen: 0 }
}

// ---------------------------------------------------------------------------

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const genCode = (has: (code: string) => boolean): string => {
  let code = ''
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
  } while (has(code))
  return code
}

export const cleanName = (raw: unknown): string => {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 12)
  return s || '棋客'
}

export const sysMsg = (text: string): ChatMsg => ({ id: uid(), from: '', color: 0, text, ts: Date.now() })

export const idxRC = (i: number) => ({ r: Math.floor(i / SIZE), c: i % SIZE })

/** 从 (r,c) 出发找连成 >=5 的同色线，返回这些格子的下标 */
export function findWinLine(board: number[], index: number, color: Color): number[] | null {
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

export function createRoom(mode: 'pvp' | 'solo', difficulty: Difficulty = 'normal', aiConfig: AiModelConfig | null = null): Room {
  const aiName = aiConfig?.name ?? AI_NAME
  const room: Room = {
    code: '',
    mode,
    difficulty,
    seats: { black: null, white: null },
    spectators: {},
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
          ? `AI 陪练房间已创建，${aiName}（${DIFFICULTY_LABEL[difficulty]}）已就座`
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
    aiConfig,
    recentReactions: [],
    reactAt: {},
  }
  return room
}

export function publicState(room: Room) {
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
    spectatorCount: Object.keys(room.spectators).length,
    difficulty: room.mode === 'solo' ? room.difficulty : null,
    aiName: room.mode === 'solo' ? room.seats.white?.name ?? room.seats.black?.name ?? null : null,
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
    recentReactions: room.recentReactions.slice(-12),
  }
}

export function pushChat(room: Room, msg: ChatMsg) {
  room.chat.push(msg)
  if (room.chat.length > 120) room.chat = room.chat.slice(-60)
}

/** 开局 / 重置（swap=true 时交换黑白座） */
export function resetGame(room: Room, swap: boolean) {
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
  room.reported = false
  if (room.seats.black && room.seats.white) {
    room.status = 'playing'
    room.startedAt = Date.now()
    room.round += 1
    room.deadline = Date.now() + MOVE_SECONDS * 1000
    pushChat(room, sysMsg('新一局开始，黑先行'))
    if (room.seats.black?.isAI || room.seats.white?.isAI)
      pushChat(room, sysMsg(`${aiSeatName(room)}（${DIFFICULTY_LABEL[room.difficulty]}）：请多指教，放马过来～`))
  } else {
    room.status = 'waiting'
    room.deadline = null
    room.startedAt = null
  }
}

function aiSeatName(room: Room): string {
  const seat = room.seats.black?.isAI ? room.seats.black : room.seats.white?.isAI ? room.seats.white : null
  return seat?.name ?? AI_NAME
}

export function endGame(room: Room, winner: number, reason: Room['endReason'], winLine: number[] | null = null) {
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
}

/** 房间内真人连胜跟踪（和棋不动；AI 胜利会打断真人连胜） */
function updateStreak(room: Room, winner: number) {
  if (winner !== 1 && winner !== 2) return
  const seat = winner === 1 ? room.seats.black : room.seats.white
  if (!seat || seat.isAI) {
    if (room.streak && (winner === 1 ? room.seats.black?.isAI : room.seats.white?.isAI)) {
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
      pushChat(room, sysMsg(`${aiSeatName(room)}：${hit.text}`))
    }
  }
}

// ---------------------------------------------------------------------------

export function takeSeat(room: Room, seatKey: 'black' | 'white', playerId: string, name: string, now = Date.now()) {
  room.seats[seatKey] = { playerId, name, connected: true, disconnectedAt: null, lastSeen: now }
}

export function maybeStart(room: Room) {
  if (room.status === 'waiting' && room.seats.black && room.seats.white) {
    room.status = 'playing'
    room.startedAt = Date.now()
    room.round += 1
    room.turn = 1
    room.deadline = Date.now() + MOVE_SECONDS * 1000
    pushChat(room, sysMsg('对局开始，黑先行'))
    if (room.seats.black?.isAI || room.seats.white?.isAI)
      pushChat(room, sysMsg(`${aiSeatName(room)}（${DIFFICULTY_LABEL[room.difficulty]}）：请多指教，放马过来～`))
  }
}

/** 加入房间：老玩家回归 / 空位入座 / AI 座接管 / 观战 */
export function joinRoomState(room: Room, playerId: string, name: string, now = Date.now()): { ok: boolean; message?: string } {
  room.emptyAt = null

  // 老玩家重连回归（touchSeat 心跳亦会覆盖此路径）
  for (const key of ['black', 'white'] as const) {
    const seat = room.seats[key]
    if (seat && seat.playerId === playerId) {
      const wasOffline = !seat.connected
      seat.connected = true
      seat.name = name
      seat.disconnectedAt = null
      seat.lastSeen = now
      room.disconnDeadline = null
      if (wasOffline) pushChat(room, sysMsg(`${name} 回到了对局`))
      return { ok: true }
    }
  }
  const specKey = playerId
  if (room.spectators[specKey]) {
    room.spectators[specKey].name = name
    return { ok: true }
  }

  // 空位入座
  if (!room.seats.black) {
    takeSeat(room, 'black', playerId, name, now)
    pushChat(room, sysMsg(`${name} 加入房间（执黑）`))
    return { ok: true }
  }
  if (!room.seats.white) {
    takeSeat(room, 'white', playerId, name, now)
    pushChat(room, sysMsg(`${name} 加入房间（执白）`))
    return { ok: true }
  }

  // 人机房间：满员但其中有 AI 座 → 好友接管（随时变真人对战）
  if (room.mode === 'solo') {
    for (const key of ['black', 'white'] as const) {
      const seat = room.seats[key]
      if (seat?.isAI) {
        const colorWord = key === 'black' ? '黑' : '白'
        room.seats[key] = { playerId, name, connected: true, disconnectedAt: null, lastSeen: now }
        room.mode = 'pvp'
        pushChat(room, sysMsg(`${name} 接管了 AI 座位（执${colorWord}），变真人对战！`))
        return { ok: true }
      }
    }
  }

  // 满员 → 观战
  room.spectators[specKey] = { playerId, name }
  pushChat(room, sysMsg(`${name} 进入观战`))
  return { ok: true }
}

/** 主动离开：对局中视为认输，等待中直接让位 */
export function leaveRoomExplicit(room: Room, playerId: string): boolean {
  let touched = false
  for (const key of ['black', 'white'] as const) {
    const seat = room.seats[key]
    if (!seat || seat.playerId !== playerId || seat.isAI) continue
    touched = true
    seat.connected = false
    seat.disconnectedAt = Date.now()
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
  }
  if (room.spectators[playerId]) {
    const sp = room.spectators[playerId]
    delete room.spectators[playerId]
    pushChat(room, sysMsg(`${sp.name} 离开观战`))
    touched = true
  }
  return touched
}

/** 心跳：pid 命中座位则刷新在线状态（掉线玩家回归时播报） */
export function touchSeat(room: Room, playerId: string, now = Date.now()): boolean {
  let changed = false
  for (const key of ['black', 'white'] as const) {
    const seat = room.seats[key]
    if (!seat || seat.isAI || seat.playerId !== playerId) continue
    seat.lastSeen = now
    if (!seat.connected) {
      seat.connected = true
      seat.disconnectedAt = null
      room.disconnDeadline = null
      pushChat(room, sysMsg(`${seat.name} 回到了对局`))
      changed = true
    }
  }
  if (room.spectators[playerId]) {
    room.spectators[playerId].playerId = playerId // noop 占位，观战者无状态
    changed = true
  }
  return changed
}

/** 座位是否心跳新鲜（在线） */
const seatFresh = (seat: Seat | null, now: number): boolean => !!seat && !seat.isAI && now - seat.lastSeen < SEEN_FRESH_MS

/** 惰性 tick：超时判负 / 掉线判负 / 等待位回收 / 空房标记；返回是否产生状态变化 */
export function tickRoom(room: Room, now = Date.now()): boolean {
  let changed = false
  // 心跳窗口判定掉线（轮询模式替代 socket disconnect 事件）
  for (const key of ['black', 'white'] as const) {
    const seat = room.seats[key]
    if (!seat || seat.isAI) continue
    if (seat.connected && !seatFresh(seat, now)) {
      seat.connected = false
      seat.disconnectedAt = now
      changed = true
      if (room.status === 'playing') {
        room.disconnDeadline = now + RECONNECT_SECONDS * 1000
        pushChat(room, sysMsg(`${seat.name} 连接断开，${RECONNECT_SECONDS} 秒内未回归将判负`))
      } else {
        pushChat(room, sysMsg(`${seat.name} 连接断开`))
      }
    }
  }

  if (room.status === 'playing') {
    if (room.deadline && now >= room.deadline) {
      endGame(room, room.turn === 1 ? 2 : 1, 'timeout')
      changed = true
    } else if (room.disconnDeadline && now >= room.disconnDeadline) {
      const offKey = (['black', 'white'] as const).find((k) => room.seats[k] && !room.seats[k]!.connected)
      if (offKey) {
        endGame(room, offKey === 'black' ? 2 : 1, 'disconnect')
        changed = true
      } else {
        room.disconnDeadline = null
      }
    }
  }

  // 仅在等待状态下回收掉线者的座位（已结束的对局保留名单便于复盘/再战）
  if (room.status === 'waiting') {
    for (const key of ['black', 'white'] as const) {
      const seat = room.seats[key]
      if (
        seat &&
        !seat.isAI &&
        !seat.connected &&
        seat.disconnectedAt &&
        now - seat.disconnectedAt > WAITING_KICK_SECONDS * 1000
      ) {
        pushChat(room, sysMsg(`${seat.name} 已离开，座位释放`))
        room.seats[key] = null
        room.rematch = { black: false, white: false }
        changed = true
      }
    }
  }

  // 空房间回收标记（存储层据 emptyAt + TTL 物理删除）
  const hasConnected =
    !!room.seats.black?.connected || !!room.seats.white?.connected || Object.keys(room.spectators).length > 0
  if (!hasConnected) {
    if (!room.emptyAt) {
      room.emptyAt = now
      changed = true
    }
  } else if (room.emptyAt) {
    room.emptyAt = null
    changed = true
  }
  return changed
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

/** AI 难度配置：防守权重 / 随机扰动 / 漏堵概率 / 搜索深度 */
export interface AIProfile {
  atkW: number
  defW: number
  noise: number
  blockMiss: number
  lookahead: number
  search: number
  combo: boolean
  vct: boolean
  vctDepth: number
  delay: [number, number]
}
export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: { atkW: 1.0, defW: 0.5, noise: 340, blockMiss: 0.28, lookahead: 0, search: 0, combo: false, vct: false, vctDepth: 0, delay: [360, 780] },
  normal: { atkW: 1.05, defW: 0.85, noise: 6, blockMiss: 0, lookahead: 0, search: 3, combo: true, vct: false, vctDepth: 0, delay: [480, 960] },
  hard: { atkW: 1.05, defW: 1.0, noise: 0, blockMiss: 0, lookahead: 0, search: 5, combo: true, vct: true, vctDepth: 3, delay: [650, 1300] },
}

export function wouldWin(board: number[], idx: number, color: Color): boolean {
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
export function evalPoint(board: number[], idx: number, color: Color): number {
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

/** 候选点生成：距任一已落棋子切比雪夫距离 ≤ 2 的空位 */
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
 * movesLeft 为我方剩余手数，budget 为节点预算，返回制胜首手，无杀返回 null。
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

export function aiChooseMove(room: Room): number {
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

  // 4) 大师：3/5 层真搜索——考虑对手最佳回应与我方后续手段，天然兼顾「防守反杀」
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

  // 4b) 入门：随机扰动评分即可（lookahead 保留接口）
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
export function applyMove(room: Room, index: number): boolean {
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
  return true
}

/** 同意悔棋（真人对手或 AI 自动同意共用） */
export function performUndoAccept(room: Room) {
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
export function estimateWinRate(board: number[], blackToMove: boolean): number {
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
export function computeHint(room: Room, color: Color): HintInfo | null {
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

/** 记录表情弹幕（限频由调用方依据 room.reactAt 判定） */
export function pushReaction(room: Room, emoji: string, from: string, color: number, ts: number) {
  room.recentReactions.push({ emoji, from, color, ts })
  if (room.recentReactions.length > 12) room.recentReactions = room.recentReactions.slice(-12)
}

/** 房间预览：未入房只读公共信息（大厅输房号/邀请链接进入时展示房主资料卡） */
export function publicPeek(room: Room) {
  const human = (seat: Seat | null) => (seat && !seat.isAI ? seat : null)
  const blackHuman = human(room.seats.black)
  const whiteHuman = human(room.seats.white)
  // 房主 = 黑座（创建者固定坐黑，solo 亦为真人）；黑座空则视为白座
  const host = blackHuman ?? whiteHuman
  return {
    ok: true as const,
    code: room.code,
    mode: room.mode,
    status: room.status,
    difficulty: room.mode === 'solo' ? room.difficulty : null,
    round: room.round,
    hostName: host?.name ?? null,
    hostPid: host?.playerId ?? null,
    hostColor: (room.seats.black ? 1 : 2) as 1 | 2,
    blackName: room.seats.black?.name ?? null,
    whiteName: room.seats.white?.name ?? null,
    seatFree: !room.seats.black || !room.seats.white,
    spectators: Object.keys(room.spectators).length,
  }
}
