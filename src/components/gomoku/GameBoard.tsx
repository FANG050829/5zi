'use client'

import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { BOARD_SIZE, CELLS, type HintKind, type ReplayMove } from '@/lib/gomoku/types'

const M = 50 // 边距
const G = (660 - 2 * M) / (BOARD_SIZE - 1) // 格距 = 40
const VB = 660
const R = 17.5 // 棋子半径

// 配色由 globals.css 的 --board-* 变量控制（浅色宣纸 / 深色墨盘）
const LINE = 'var(--board-line)'
const EDGE = 'var(--board-edge)'
const STAR = 'var(--board-star)'
const COORD = 'var(--board-coord)'
const CROSS = 'var(--board-cross)'
const WIN = '#e11d48'

const LETTERS = 'ABCDEFGHJKLMNOP'

/** 提示标记配色：必胜玫红 / 防守琥珀 / 推荐翡翠绿 */
const HINT_COLOR: Record<HintKind, string> = {
  win: '#e11d48',
  block: '#d97706',
  best: '#059669',
}

function rc(i: number) {
  return { x: M + (i % BOARD_SIZE) * G, y: M + Math.floor(i / BOARD_SIZE) * G }
}

interface GameBoardProps {
  board: number[]
  myColor: 1 | 2 | null
  interactive: boolean
  winLine: number[] | null
  lastMove: number | null
  /** 落子提示标记（必胜/防守/推荐点） */
  hint?: { index: number; kind: HintKind } | null
  /** 手数标注：传入完整落子序列（按游标裁剪）后，在每颗棋子上显示第几手 */
  numbered?: boolean
  moves?: ReplayMove[]
  onPlay: (index: number) => void
  /** 满高模式（横屏对局）：棋盘撑满父容器高度，忽略 560px 上限 */
  fill?: boolean
}

export function GameBoard({ board, myColor, interactive, winLine, lastMove, hint, numbered = false, moves, onPlay, fill = false }: GameBoardProps) {
  const [hover, setHover] = useState<number | null>(null)
  /** 键盘光标（焦点内显示；方向键移动，回车落子） */
  const [cursor, setCursor] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const winSet = useMemo(() => new Set(winLine ?? []), [winLine])
  /** 格子 -> 第几手（1 起） */
  const moveNo = useMemo(() => {
    const m = new Map<number, number>()
    ;(moves ?? []).forEach((mv, k) => m.set(mv.index, k + 1))
    return m
  }, [moves])

  const coordLabel = (i: number) => `${LETTERS[i % BOARD_SIZE]}${BOARD_SIZE - Math.floor(i / BOARD_SIZE)}`

  /** 伪横屏（.gomoku-landscape-css rotate90°）下视觉轴与棋盘轴互换，需换算坐标 */
  const isRotated = () => !!svgRef.current?.closest('.gomoku-landscape-css')

  const cellFromEvent = (e: React.PointerEvent | React.MouseEvent): number | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const rotated = isRotated()
    // 旋转态：内容 x 轴（列）沿视觉 y 轴向下，内容 y 轴（行）自视觉右向左
    const x = (rotated ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width) * VB
    const y = (rotated ? (rect.right - e.clientX) / rect.width : (e.clientY - rect.top) / rect.height) * VB
    const c = Math.round((x - M) / G)
    const r = Math.round((y - M) / G)
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null
    // 距离交叉点太远不吸附
    const px = M + c * G
    const py = M + r * G
    if (Math.hypot(x - px, y - py) > G * 0.48) return null
    return r * BOARD_SIZE + c
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!interactive) return
    const idx = cellFromEvent(e)
    setHover(idx !== null && board[idx] === 0 ? idx : null)
    // 鼠标悬停同步键盘光标，指针/键盘体验一致
    if (idx !== null) setCursor(idx)
  }

  const handleClick = (e: React.MouseEvent) => {
    if (!interactive) return
    const idx = cellFromEvent(e)
    if (idx !== null && board[idx] === 0) onPlay(idx)
  }

  /** 键盘导航：方向键移动光标，回车/空格落子（a11y）；伪横屏下方向轴互换保持视觉直觉 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return
    const cur = cursor ?? 7 * BOARD_SIZE + 7
    const rotated = isRotated()
    const rowStart = Math.floor(cur / BOARD_SIZE) * BOARD_SIZE
    switch (e.key) {
      case 'ArrowUp':
        setCursor(rotated ? Math.max(rowStart, cur - 1) : Math.max(0, cur - BOARD_SIZE))
        break
      case 'ArrowDown':
        setCursor(rotated ? Math.min(rowStart + BOARD_SIZE - 1, cur + 1) : Math.min(CELLS - 1, cur + BOARD_SIZE))
        break
      case 'ArrowLeft':
        setCursor(rotated ? Math.min(CELLS - 1, cur + BOARD_SIZE) : Math.max(rowStart, cur - 1))
        break
      case 'ArrowRight':
        setCursor(rotated ? Math.max(0, cur - BOARD_SIZE) : Math.min(rowStart + BOARD_SIZE - 1, cur + 1))
        break
      case 'Enter':
      case ' ':
        if (board[cur] === 0) onPlay(cur)
        break
      case 'Escape':
        setCursor(null)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const winEnds = useMemo(() => {
    if (!winLine || winLine.length === 0) return null
    const a = rc(winLine[0])
    const b = rc(winLine[winLine.length - 1])
    return { a, b }
  }, [winLine])

  return (
    <div className={fill ? 'aspect-square h-full max-w-none self-center' : 'w-full max-w-[560px] self-center'}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB} ${VB}`}
        className={`w-full select-none rounded-2xl border border-stone-200 bg-[var(--board-bg)] shadow-[0_1px_2px_rgba(28,25,23,0.04),0_2px_12px_rgba(28,25,23,0.05)] outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 ${
          interactive ? 'cursor-pointer' : 'cursor-default'
        }`}
        tabIndex={interactive ? 0 : -1}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (!interactive) return
          setFocused(true)
          setCursor((c) => c ?? 7 * BOARD_SIZE + 7)
        }}
        onBlur={() => {
          setFocused(false)
          setCursor(null)
        }}
        role="grid"
        aria-label={`五子棋棋盘${cursor !== null ? `，光标 ${coordLabel(cursor)}` : ''}，方向键移动，回车落子`}
      >
        <defs>
          {/* 纸质感：柔和暗角 + 顶部微光，模拟宣纸（深色为墨盘微光） */}
          <radialGradient id="paper-vignette" cx="50%" cy="42%" r="78%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="72%" stopColor="var(--paper-vg2)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--paper-vg3)" stopOpacity="0.5" />
          </radialGradient>
          <linearGradient id="paper-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" style={{ stopOpacity: 'var(--paper-sheen-op)' }} />
            <stop offset="18%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 纸质感覆盖层 */}
        <rect x={0} y={0} width={VB} height={VB} fill="url(#paper-vignette)" pointerEvents="none" />
        <rect x={0} y={0} width={VB} height={VB * 0.3} fill="url(#paper-sheen)" pointerEvents="none" />
        {/* 网格线 */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => {
          const p = M + i * G
          const w = i === 0 || i === BOARD_SIZE - 1
          return (
            <g key={`l${i}`}>
              <line x1={M} y1={p} x2={VB - M} y2={p} stroke={w ? EDGE : LINE} strokeWidth={w ? 1.6 : 1} />
              <line x1={p} y1={M} x2={p} y2={VB - M} stroke={w ? EDGE : LINE} strokeWidth={w ? 1.6 : 1} />
            </g>
          )
        })}

        {/* 星位 */}
        {[[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]].map(([r, c]) => (
          <circle key={`s${r}-${c}`} cx={M + c * G} cy={M + r * G} r={3.4} fill={STAR} />
        ))}

        {/* 坐标 */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <g key={`c${i}`}>
            <text x={M + i * G} y={M - 22} textAnchor="middle" fontSize={12.5} fill={COORD} fontFamily="ui-sans-serif">
              {LETTERS[i]}
            </text>
            <text x={M - 26} y={M + i * G + 4} textAnchor="middle" fontSize={12.5} fill={COORD} fontFamily="ui-sans-serif">
              {BOARD_SIZE - i}
            </text>
          </g>
        ))}

        {/* 悬停十字定位线（细、stone 色系、低透明度） */}
        {interactive && hover !== null && board[hover] === 0 && (
          <g stroke={CROSS} strokeWidth={1} strokeDasharray="3 5" opacity={0.4}>
            <line x1={M} y1={rc(hover).y} x2={VB - M} y2={rc(hover).y} />
            <line x1={rc(hover).x} y1={M} x2={rc(hover).x} y2={VB - M} />
          </g>
        )}

        {/* 悬停虚影（轻微呼吸） */}
        {interactive && hover !== null && board[hover] === 0 && myColor && (
          <motion.circle
            cx={rc(hover).x}
            cy={rc(hover).y}
            r={R}
            fill={myColor === 1 ? '#1c1917' : '#ffffff'}
            stroke={myColor === 2 ? '#a8a29e' : 'none'}
            strokeWidth={1}
            animate={{ opacity: [0.28, 0.46, 0.28], scale: [1, 1.05, 1] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        )}

        {/* 键盘光标（焦点态显示；虚线圆角框 + 中心点） */}
        {interactive && focused && cursor !== null && (
          <g pointerEvents="none">
            <motion.rect
              x={rc(cursor).x - R - 4}
              y={rc(cursor).y - R - 4}
              width={(R + 4) * 2}
              height={(R + 4) * 2}
              rx={7}
              fill="none"
              stroke="#57534e"
              strokeWidth={1.4}
              strokeDasharray="4 3.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.55, 0.9, 0.55] }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
            />
            <circle cx={rc(cursor).x} cy={rc(cursor).y} r={1.8} fill="#57534e" opacity={0.7} />
          </g>
        )}

        {/* 落子提示标记（呼吸虚线环 + 中心点 + 微光晕） */}
        {hint && board[hint.index] === 0 && !winLine && (
          <motion.g
            key={`hint-${hint.index}-${hint.kind}`}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 20 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            pointerEvents="none"
          >
            <motion.circle
              cx={rc(hint.index).x}
              cy={rc(hint.index).y}
              r={R + 5}
              fill="none"
              stroke={HINT_COLOR[hint.kind]}
              strokeWidth={2}
              strokeDasharray="6 6"
              strokeLinecap="round"
              animate={{ rotate: 360, opacity: [0.55, 1, 0.55] }}
              transition={{
                rotate: { repeat: Infinity, duration: 9, ease: 'linear' },
                opacity: { repeat: Infinity, duration: 1.6, ease: 'easeInOut' },
              }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
            <motion.circle
              cx={rc(hint.index).x}
              cy={rc(hint.index).y}
              r={R + 11}
              fill={HINT_COLOR[hint.kind]}
              animate={{ opacity: [0.02, 0.1, 0.02] }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
            />
            <circle cx={rc(hint.index).x} cy={rc(hint.index).y} r={3.2} fill={HINT_COLOR[hint.kind]} />
          </motion.g>
        )}

        {/* 棋子 */}
        {board.map((v, i) => {
          if (!v) return null
          const { x, y } = rc(i)
          const dim = winLine ? (winSet.has(i) ? 1 : 0.35) : 1
          const isLast = lastMove === i
          const no = numbered ? moveNo.get(i) : undefined
          return (
            <motion.g
              key={i}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 26 }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center', opacity: dim }}
            >
              {v === 1 ? (
                <circle
                  cx={x}
                  cy={y}
                  r={R}
                  fill="#1c1917"
                  stroke="var(--stone-black-ring)"
                  strokeWidth={1.4}
                  style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
                />
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={R}
                  fill="#ffffff"
                  stroke="#d6d0c6"
                  strokeWidth={1}
                  style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.18))' }}
                />
              )}
              {no !== undefined && (
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={no > 99 ? 13 : 15}
                  fontWeight={500}
                  letterSpacing={-0.5}
                  fill={v === 1 ? 'rgba(255,255,255,0.94)' : '#57534e'}
                  fontFamily="ui-sans-serif, system-ui"
                  pointerEvents="none"
                >
                  {no}
                </text>
              )}
              {isLast && (
                <motion.circle
                  cx={x}
                  cy={y}
                  r={numbered ? R + 3.5 : 7}
                  fill="none"
                  stroke={WIN}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  animate={{ opacity: [0.9, 0.35, 0.9] }}
                  transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                />
              )}
            </motion.g>
          )
        })}

        {/* 胜利连线（柔和光晕） */}
        {winEnds && (
          <>
            <motion.line
              x1={winEnds.a.x}
              y1={winEnds.a.y}
              x2={winEnds.b.x}
              y2={winEnds.b.y}
              stroke={WIN}
              strokeWidth={10}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.16 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            <motion.line
              x1={winEnds.a.x}
              y1={winEnds.a.y}
              x2={winEnds.b.x}
              y2={winEnds.b.y}
              stroke={WIN}
              strokeWidth={4}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0.9 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{ filter: 'drop-shadow(0 0 5px rgba(225,29,72,0.4))' }}
            />
          </>
        )}
      </svg>
    </div>
  )
}
