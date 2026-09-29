'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bot,
  ChevronsLeft,
  ChevronLeft,
  Play,
  Pause,
  ChevronRight,
  ChevronsRight,
  Hash,
  Loader2,
  Users,
  AlertCircle,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DIFFICULTY_LABEL, type Difficulty } from '@/lib/gomoku/types'
import { boardFromMoves, lastWinLine, type ReplayMatch } from '@/lib/gomoku/replay'
import { GameBoard } from './GameBoard'
import { StoneIcon } from './StoneIcon'

const REASON_TEXT: Record<string, string> = {
  five: '五连取胜',
  timeout: '超时判负',
  resign: '认输',
  disconnect: '离场判负',
  draw: '满盘和棋',
}

const noop = () => {}

/** 棋谱回放弹层：逐手播放已结束的对局（支持传 matchId 拉取或 inlineMatch 直接房内复盘） */
export function ReplaySheet({
  matchId,
  inlineMatch = null,
  open,
  onOpenChange,
}: {
  matchId: number | null
  /** 房内复盘：直接传入棋谱数据（优先于 matchId） */
  inlineMatch?: ReplayMatch | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  // 已加载的棋谱按 id 缓存；match 是否可见由 id 派生，避免陈旧数据闪现
  const [data, setData] = useState<{ id: number | null; match: ReplayMatch | null }>({ id: null, match: null })
  const [cursor, setCursor] = useState(0) // 已展示的手数
  const [playingIntent, setPlayingIntent] = useState(false)
  const [speed, setSpeed] = useState<1 | 2>(1)
  const [numbered, setNumbered] = useState(true) // 手数标注（回放默认开启）

  const inline = open ? inlineMatch : null
  const match = inline ?? (open && matchId !== null && data.id === matchId ? data.match : null)
  const loading = !inline && open && matchId !== null && data.id !== matchId
  const failed = !inline && open && matchId !== null && data.id === matchId && !data.match

  // 打开时拉取棋谱详情（inline 模式不拉取；setState 均在异步回调中）
  useEffect(() => {
    if (!open || inline || !matchId || data.id === matchId) return
    let alive = true
    fetch(`/api/matches/${matchId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setData({ id: matchId, match: d?.ok ? d.match : null })
        setCursor(0)
        setPlayingIntent(false)
      })
      .catch(() => {
        if (!alive) return
        setData({ id: matchId, match: null })
      })
    return () => {
      alive = false
    }
  }, [open, inline, matchId, data.id])

  const total = match?.moves.length ?? 0
  const playing = playingIntent && !!match && cursor < total

  // 自动播放：每步一个 timeout，链式推进（playing 由 cursor 派生自动停止）
  useEffect(() => {
    if (!playing || !match) return
    const t = setTimeout(() => setCursor((c) => Math.min(c + 1, total)), speed === 1 ? 700 : 320)
    return () => clearTimeout(t)
  }, [playing, cursor, speed, total, match])

  // 游标重置：父组件用 key 绑定棋谱标识（新棋谱重挂载归零），无需 effect

  const board = useMemo(() => {
    if (!match) return new Array(225).fill(0)
    return boardFromMoves(match.moves.slice(0, cursor))
  }, [match, cursor])

  const winLine = useMemo(() => {
    if (!match || cursor < match.moves.length) return null
    return lastWinLine(match.moves)
  }, [match, cursor])

  const lastMove = match && cursor > 0 ? match.moves[cursor - 1].index : null

  const goto = (c: number) => {
    setPlayingIntent(false)
    setCursor(Math.max(0, Math.min(c, total)))
  }

  const togglePlay = () => {
    if (!match) return
    if (!playingIntent && cursor >= total) setCursor(0) // 播完再按 = 重播
    setPlayingIntent(!playingIntent)
  }

  const resultText =
    match && (match.winnerColor === 0 ? '和棋' : `${match.winnerColor === 1 ? '黑方' : '白方'}胜 · ${REASON_TEXT[match.endReason] ?? ''}`)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] overflow-y-auto rounded-t-3xl border-stone-200 px-5 pb-8 pt-4 shadow-[0_-8px_40px_-12px_rgba(28,25,23,0.2)] sm:max-w-md sm:left-0 sm:right-0 sm:rounded-3xl [&>button]:hidden"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">棋谱回放</SheetTitle>
          <SheetDescription className="sr-only">逐步回放已结束的对局，可快进快退与自动播放</SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-stone-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-xs tracking-widest">正在载入棋谱…</p>
          </div>
        )}

        {failed && (
          <div className="flex flex-col items-center gap-3 py-16 text-stone-400">
            <AlertCircle className="h-5 w-5" />
            <p className="text-xs">棋谱不存在或已失效</p>
          </div>
        )}

        {match && (
          <>
            {/* 对局信息 */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <StoneIcon color={1} size={16} />
                <span className="truncate text-[13px] font-medium text-stone-800">{match.blackName}</span>
                <span className="text-[10px] text-stone-300">对</span>
                <StoneIcon color={2} size={16} />
                <span className="truncate text-[13px] font-medium text-stone-800">{match.whiteName}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-stone-400">
                {match.mode === 'solo' ? (
                  <span className="flex items-center gap-0.5 rounded bg-stone-100 px-1.5 py-0.5">
                    <Bot className="h-3 w-3" />
                    {DIFFICULTY_LABEL[(match.difficulty as Difficulty) ?? 'normal'] ?? '陪练'}
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 rounded bg-stone-100 px-1.5 py-0.5">
                    <Users className="h-3 w-3" />
                    好友
                  </span>
                )}
                <span className="rounded bg-stone-100 px-1.5 py-0.5 tracking-widest">{match.roomCode}</span>
              </div>
            </div>

            {/* 只读棋盘 */}
            <div className="mx-auto w-full max-w-[320px]">
              <GameBoard
                board={board}
                myColor={null}
                interactive={false}
                winLine={winLine}
                lastMove={lastMove}
                numbered={numbered}
                moves={match.moves.slice(0, cursor)}
                onPlay={noop}
              />
            </div>

            {/* 状态行 */}
            <div className="mt-3 flex items-center justify-between text-[11px] text-stone-400">
              <span>
                {cursor === 0
                  ? '开局 · 黑先行'
                  : cursor >= total
                    ? resultText ?? '终局'
                    : `第 ${cursor} 手 · ${(match.moves[cursor - 1].color === 1 ? '黑' : '白') + '方落子'}`}
              </span>
              <span className="tabular-nums">
                {cursor} / {total}
              </span>
            </div>

            {/* 进度条（可点击跳转） */}
            <div
              className="group relative mt-1.5 h-4 cursor-pointer"
              role="slider"
              aria-label="回放进度"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={cursor}
              tabIndex={0}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = (e.clientX - rect.left) / rect.width
                goto(Math.round(ratio * total))
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') goto(cursor - 1)
                if (e.key === 'ArrowRight') goto(cursor + 1)
              }}
            >
              <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-stone-100" />
              <motion.div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-stone-400"
                animate={{ width: `${total ? (cursor / total) * 100 : 0}%` }}
                transition={{ duration: 0.18 }}
              />
              <motion.div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-800 shadow-[0_1px_4px_rgba(28,25,23,0.35)]"
                animate={{ left: `${total ? (cursor / total) * 100 : 0}%` }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            </div>

            {/* 胜率曲线（评估数据可用时展示，可点击跳转） */}
            {match.evals && match.evals.length >= 2 && (
              <EvalCurve evals={match.evals} cursor={cursor} onSeek={goto} />
            )}

            {/* 控制条 */}
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <ReplayBtn label="回到开局" onClick={() => goto(0)} disabled={cursor === 0}>
                <ChevronsLeft className="h-4 w-4" />
              </ReplayBtn>
              <ReplayBtn label="上一手" onClick={() => goto(cursor - 1)} disabled={cursor === 0}>
                <ChevronLeft className="h-4 w-4" />
              </ReplayBtn>
              <button
                onClick={togglePlay}
                aria-label={playing ? '暂停' : '播放'}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-900 text-white shadow-[0_2px_10px_rgba(28,25,23,0.3)] transition-all duration-200 hover:scale-105 hover:bg-stone-700 active:scale-95"
              >
                {playing ? <Pause className="h-4.5 w-4.5" /> : <Play className="ml-0.5 h-4.5 w-4.5" />}
              </button>
              <ReplayBtn label="下一手" onClick={() => goto(cursor + 1)} disabled={cursor >= total}>
                <ChevronRight className="h-4 w-4" />
              </ReplayBtn>
              <ReplayBtn label="跳到终局" onClick={() => goto(total)} disabled={cursor >= total}>
                <ChevronsRight className="h-4 w-4" />
              </ReplayBtn>
              <button
                onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))}
                aria-label="切换播放速度"
                className={`ml-1 h-8 rounded-lg border px-2 text-[10px] tabular-nums transition-colors ${
                  speed === 2 ? 'border-stone-800 bg-stone-900 text-white' : 'border-stone-200 text-stone-500 hover:border-stone-400'
                }`}
              >
                {speed}x
              </button>
              <button
                onClick={() => setNumbered((v) => !v)}
                aria-pressed={numbered}
                aria-label="切换手数标注"
                title={numbered ? '隐藏手数标注' : '显示手数标注'}
                className={`ml-1 flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] transition-colors ${
                  numbered
                    ? 'border-stone-800 bg-stone-900 text-white'
                    : 'border-stone-200 text-stone-500 hover:border-stone-400'
                }`}
              >
                <Hash className="h-3 w-3" />
                手数
              </button>
            </div>

            <p className="mt-3 text-center text-[10px] text-stone-300">
              房间 {match.roomCode} · 共 {match.moveCount} 手 · 点击进度条可跳转
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** 胜率曲线：黑方估算胜率随每手变化，游标随回放同步，点击可跳转 */
function EvalCurve({
  evals,
  cursor,
  onSeek,
}: {
  evals: number[] // 整数百分比，长度 = 手数 + 1
  cursor: number
  onSeek: (c: number) => void
}) {
  const W = 340
  const H = 64
  const PAD = 8
  const n = evals.length
  const px = (i: number) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2)
  const py = (v: number) => PAD + (1 - v / 100) * (H - PAD * 2)
  const points = evals.map((v, i) => `${px(i)},${py(v)}`).join(' ')
  const cur = evals[Math.min(cursor, n - 1)]

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-stone-400">
        <span className="tracking-widest">胜率曲线</span>
        <span className="flex items-center gap-1 tabular-nums">
          <StoneIcon color={1} size={9} />
          黑 {cur}%
          <span className="text-stone-300">/</span>
          白 {100 - cur}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-pointer rounded-xl border border-stone-100 bg-white"
        role="slider"
        aria-label="胜率曲线（点击跳转回放进度）"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={cursor}
        tabIndex={0}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          onSeek(Math.round(ratio * (n - 1)))
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSeek(cursor - 1)
          if (e.key === 'ArrowRight') onSeek(cursor + 1)
        }}
      >
        {/* 50% 基准虚线 */}
        <line x1={PAD} y1={py(50)} x2={W - PAD} y2={py(50)} stroke="#d6d0c6" strokeWidth={1} strokeDasharray="3 4" />
        {/* 评估曲线 */}
        <polyline
          points={points}
          fill="none"
          stroke="#78716c"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 游标竖线 + 圆点 */}
        <motion.line
          x1={px(cursor)}
          x2={px(cursor)}
          y1={PAD - 2}
          y2={H - PAD + 2}
          stroke="#1c1917"
          strokeWidth={1}
          opacity={0.35}
          animate={{ x1: px(cursor), x2: px(cursor) }}
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
        <motion.circle
          cx={px(cursor)}
          cy={py(cur)}
          r={3.2}
          fill="#1c1917"
          stroke="#fafaf9"
          strokeWidth={1.2}
          animate={{ cx: px(cursor), cy: py(cur) }}
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      </svg>
      <p className="mt-1 text-center text-[9px] text-stone-300">上方为黑方胜势 · 下方为白方胜势 · 点击曲线可跳转</p>
    </div>
  )
}

function ReplayBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:border-stone-400 enabled:hover:shadow-[0_3px_8px_rgba(28,25,23,0.1)] active:translate-y-0 active:scale-95 disabled:opacity-35"
    >
      {children}
    </button>
  )
}
