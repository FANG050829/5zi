// 五子棋共享类型（与 mini-services/gomoku-server/index.ts 保持一致）

export type Color = 1 | 2 // 1 黑 2 白
export type Difficulty = 'easy' | 'normal' | 'hard'

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '入门', normal: '进阶', hard: '大师' }

export interface SeatPub {
  playerId: string
  name: string
  connected: boolean
  isAI?: boolean
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
  color: number
}

export interface ReplayMove {
  index: number
  color: 1 | 2
}

/** 表情弹幕（瞬时事件，不进房间状态；dx 为漂浮横向抖动像素） */
export interface Reaction {
  id: string
  emoji: string
  from: string
  color: number // 1 黑 2 白 0 观战
  ts: number
  dx: number
}

export interface RoomState {
  code: string
  status: 'waiting' | 'playing' | 'ended'
  board: number[]
  turn: Color
  winner: number | null // 1/2 胜，0 和棋
  winLine: number[] | null
  endReason: '' | 'five' | 'timeout' | 'resign' | 'disconnect' | 'draw'
  lastMove: number | null
  moveCount: number
  black: SeatPub | null
  white: SeatPub | null
  spectatorCount: number
  /** solo 模式 AI 难度（pvp 为 null） */
  difficulty?: Difficulty | null
  /** solo 模式 AI 座位显示名（自定义 LLM 时为其配置名） */
  aiName?: string | null
  /** 最近的表情弹幕（轮询差量取用，ts 单调） */
  recentReactions?: { emoji: string; from: string; color: number; ts: number }[]
  scores: { black: number; white: number }
  chat: ChatMsg[]
  rematch: { black: boolean; white: boolean }
  undoReq: number | null
  /** 每方本局剩余提示次数 */
  hints?: { black: number; white: number }
  /** 当前生效的提示（落子后服务端自动清除） */
  hint?: HintInfo | null
  /** 黑方估算胜率 0-100（每手随评估更新，观战/复盘用） */
  winRate?: number
  /** 评估曲线：每手后黑方胜率（整数百分比），evals[0]=50 开局 */
  evals?: number[]
  deadline: number | null
  disconnDeadline: number | null
  round: number
  /** 房间内真人连胜（跨局累计，null 表示无） */
  streak?: { playerId: string; count: number } | null
  /** 完整落子序列（供房内复盘） */
  moves?: ReplayMove[]
  serverTime: number
  /** 客户端接收时间（仅前端使用，用于倒计时推算） */
  receivedAt?: number
}

/** 房间预览（room:peek 应答，未入房只读公共信息） */
export interface RoomPeek {
  ok: true
  code: string
  mode: 'pvp' | 'solo'
  status: 'waiting' | 'playing' | 'ended'
  difficulty: Difficulty | null
  round: number
  hostName: string | null
  hostPid: string | null
  hostColor: 1 | 2
  blackName: string | null
  whiteName: string | null
  seatFree: boolean
  spectators: number
}

export const BOARD_SIZE = 15
export const CELLS = BOARD_SIZE * BOARD_SIZE
export const MOVE_SECONDS = 60
