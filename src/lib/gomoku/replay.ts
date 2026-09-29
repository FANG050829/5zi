// 棋谱回放工具：由 moves 序列重建棋盘 / 计算胜线
import { BOARD_SIZE } from './types'

export interface ReplayMove {
  index: number
  color: 1 | 2
}

export interface ReplayMatch {
  id: number
  roomCode: string
  blackName: string
  whiteName: string
  winnerColor: number
  endReason: string
  moveCount: number
  durationMs: number
  mode: string
  difficulty: string
  moves: ReplayMove[]
  /** 每手后黑方胜率（整数百分比），长度 = 手数+1；旧棋谱无此数据 */
  evals?: number[]
  createdAt: string
}

export function boardFromMoves(moves: ReplayMove[]): number[] {
  const board = new Array(BOARD_SIZE * BOARD_SIZE).fill(0)
  for (const m of moves) board[m.index] = m.color
  return board
}

/** 从 (r,c) 出发找连成 >=5 的同色线（与服务端判定一致） */
function findWinLine(board: number[], index: number, color: number): number[] | null {
  const r0 = Math.floor(index / BOARD_SIZE)
  const c0 = index % BOARD_SIZE
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]
  for (const [dr, dc] of dirs) {
    const line: number[] = [index]
    for (const sign of [1, -1] as const) {
      let rr = r0 + dr * sign
      let cc = c0 + dc * sign
      while (rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE && board[rr * BOARD_SIZE + cc] === color) {
        line.push(rr * BOARD_SIZE + cc)
        rr += dr * sign
        cc += dc * sign
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a - b)
  }
  return null
}

/** 整局走完后的胜线（无胜线返回 null） */
export function lastWinLine(moves: ReplayMove[]): number[] | null {
  const last = moves[moves.length - 1]
  if (!last) return null
  return findWinLine(boardFromMoves(moves), last.index, last.color)
}
