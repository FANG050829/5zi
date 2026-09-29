'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { motion } from 'framer-motion'
import { Bot, Crown, Loader2, Smartphone, Sprout, Target, TrendingUp, User, Users } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DIFFICULTY_LABEL, type Difficulty } from '@/lib/gomoku/types'
import { rankFromRecord } from '@/lib/gomoku/rank'
import { getMyId } from '@/lib/gomoku/useGomoku'
import { StoneIcon } from './StoneIcon'

const noopSubscribe = () => () => {}

interface AllMatch {
  id: number
  blackName: string
  whiteName: string
  winnerColor: number
  endReason: string
  moveCount: number
  durationMs: number
  mode: string
  difficulty: string
  createdAt: string
}

/** 我的单局视角结果：win / lose / draw */
type Outcome = 'win' | 'lose' | 'draw'

/** 本机档案单局（设备维度，API ?pid= 返回） */
interface DeviceGame {
  id: number
  roomCode: string
  myColor: 1 | 2
  oppName: string
  blackName?: string
  whiteName?: string
  outcome: Outcome
  endReason: string
  mode: string
  difficulty: string
  moveCount: number
  durationMs: number
  createdAt: string
}

interface MyGame extends AllMatch {
  myColor: 1 | 2
  outcome: Outcome
}

function aggregate(games: MyGame[]) {
  const wins = games.filter((g) => g.outcome === 'win').length
  const losses = games.filter((g) => g.outcome === 'lose').length
  const draws = games.filter((g) => g.outcome === 'draw').length
  const asBlack = games.filter((g) => g.myColor === 1)
  const asWhite = games.filter((g) => g.myColor === 2)

  // 连胜统计（按时间序）
  let curStreak = 0
  let bestStreak = 0
  for (const g of games) {
    if (g.outcome === 'win') {
      curStreak += 1
      bestStreak = Math.max(bestStreak, curStreak)
    } else if (g.outcome === 'lose') {
      curStreak = 0
    }
  }

  // 与 AI 各难度战绩
  const byDiff: Record<Difficulty, { w: number; l: number; d: number }> = {
    easy: { w: 0, l: 0, d: 0 },
    normal: { w: 0, l: 0, d: 0 },
    hard: { w: 0, l: 0, d: 0 },
  }
  for (const g of games) {
    if (g.mode === 'solo' && g.difficulty in byDiff) {
      const d = byDiff[g.difficulty as Difficulty]
      if (g.outcome === 'win') d.w += 1
      else if (g.outcome === 'lose') d.l += 1
      else d.d += 1
    }
  }

  const winsGames = games.filter((g) => g.outcome === 'win')
  const fastestWin = winsGames.length ? Math.min(...winsGames.map((g) => g.moveCount)) : null
  const avgMoves = games.length ? Math.round(games.reduce((s, g) => s + g.moveCount, 0) / games.length) : null
  const totalMs = games.reduce((s, g) => s + g.durationMs, 0)
  const avgDurationMin = games.length ? Math.round(totalMs / games.length / 60000) : null

  return {
    total: games.length,
    wins,
    losses,
    draws,
    winRate: games.length ? Math.round((wins / games.length) * 100) : 0,
    blackWR: asBlack.length ? Math.round((asBlack.filter((g) => g.outcome === 'win').length / asBlack.length) * 100) : null,
    blackN: asBlack.length,
    whiteWR: asWhite.length ? Math.round((asWhite.filter((g) => g.outcome === 'win').length / asWhite.length) * 100) : null,
    whiteN: asWhite.length,
    pvpN: games.filter((g) => g.mode === 'pvp').length,
    soloN: games.filter((g) => g.mode === 'solo').length,
    curStreak,
    bestStreak,
    byDiff,
    fastestWin,
    avgMoves,
    avgDurationMin,
  }
}

type Agg = ReturnType<typeof aggregate>

/** 视角：昵称档案 / 本机设备档案 */
type StatsView = 'name' | 'device'

/** DeviceGame → MyGame 适配（复用同一套 aggregate/对手榜/近期状态逻辑；保留当局真实昵称） */
function deviceToMyGame(g: DeviceGame, fallbackName: string): MyGame {
  return {
    id: g.id,
    roomCode: g.roomCode,
    blackName: g.blackName ?? (g.myColor === 1 ? fallbackName : g.oppName),
    whiteName: g.whiteName ?? (g.myColor === 2 ? fallbackName : g.oppName),
    winnerColor: g.outcome === 'draw' ? 0 : g.outcome === 'win' ? g.myColor : g.myColor === 1 ? 2 : 1,
    endReason: g.endReason,
    moveCount: g.moveCount,
    durationMs: g.durationMs ?? 0,
    mode: g.mode,
    difficulty: g.difficulty,
    createdAt: g.createdAt,
    myColor: g.myColor,
    outcome: g.outcome,
  }
}

/** 胜率环：极简 SVG donut */
function WinRing({ rate, size = 108 }: { rate: number; size?: number }) {
  const r = (size - 12) / 2
  const circ = 2 * Math.PI * r
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ui-track)" strokeWidth={7} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ui-bar)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - rate / 100) }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-2xl font-light tabular-nums text-stone-900"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
        >
          {rate}
          <span className="text-xs text-stone-400">%</span>
        </motion.span>
        <span className="text-[9px] tracking-widest text-stone-400">胜率</span>
      </div>
    </div>
  )
}

/** 迷你横条 */
function MiniBar({ pct, tone = 'dark' }: { pct: number; tone?: 'dark' | 'amber' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
      <motion.div
        className="h-full rounded-full"
        style={{ background: tone === 'amber' ? '#d97706' : 'var(--ui-bar)' }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
    </div>
  )
}

/** 近期状态圆点：最近 N 局 */
function FormDots({ games, n = 12 }: { games: MyGame[]; n?: number }) {
  const recent = games.slice(-n)
  return (
    <div className="flex items-center gap-1.5">
      {recent.length === 0 && <span className="text-[11px] text-stone-300">暂无对局</span>}
      {recent.map((g) => (
        <motion.span
          key={g.id}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          title={`${g.blackName} 对 ${g.whiteName} · ${g.outcome === 'win' ? '胜' : g.outcome === 'lose' ? '负' : '和'}`}
          className={`h-2.5 w-2.5 rounded-full ${
            g.outcome === 'win'
              ? 'bg-stone-900'
              : g.outcome === 'lose'
                ? 'border-[1.5px] border-stone-300 bg-white'
                : 'bg-stone-200'
          }`}
        />
      ))}
    </div>
  )
}

function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-stone-100 bg-white px-2 py-2.5">
      <span className="text-base font-light tabular-nums text-stone-900">{value}</span>
      <span className="text-[9px] tracking-widest text-stone-400">{label}</span>
      {sub && <span className="text-[9px] text-stone-300">{sub}</span>}
    </div>
  )
}

const DIFF_ICON: Record<Difficulty, typeof Sprout> = { easy: Sprout, normal: Target, hard: Crown }

/** 近 N 局净胜分走势折线（胜 +1 / 负 −1 / 和 0，累计曲线） */
function TrendLine({ games, n = 20 }: { games: MyGame[]; n?: number }) {
  const recent = useMemo(() => games.slice(-n), [games, n])
  const pts = useMemo(() => {
    const seq = [0]
    for (const g of recent) seq.push(seq[seq.length - 1] + (g.outcome === 'win' ? 1 : g.outcome === 'lose' ? -1 : 0))
    return seq
  }, [recent])
  const W = 300
  const H = 64
  const PADX = 7
  const PADY = 9
  const maxAbs = Math.max(2, ...pts.map((v) => Math.abs(v)))
  const x = (i: number) => PADX + (i / Math.max(1, pts.length - 1)) * (W - PADX * 2)
  const y = (v: number) => H / 2 - (v / maxAbs) * (H / 2 - PADY)
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`
  const latest = pts[pts.length - 1]
  const rising = latest > 0
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`近 ${recent.length} 局净胜分走势，当前 ${latest > 0 ? '+' : ''}${latest}`}>
        {/* 零轴虚线 */}
        <line x1={PADX} y1={y(0)} x2={W - PADX} y2={y(0)} stroke="var(--ui-track)" strokeWidth={1} strokeDasharray="3 4" />
        <motion.path d={area} fill="var(--ui-bar)" initial={{ opacity: 0 }} animate={{ opacity: 0.07 }} transition={{ duration: 0.9 }} />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--ui-bar)"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        {pts.slice(1).map((v, k) => {
          const o = recent[k]?.outcome
          return (
            <motion.circle
              key={k}
              cx={x(k + 1)}
              cy={y(v)}
              r={2.6}
              fill={o === 'win' ? '#1c1917' : o === 'lose' ? '#ffffff' : '#d6d3d1'}
              stroke={o === 'lose' ? '#a8a29e' : 'none'}
              strokeWidth={1}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.5 + k * 0.022, type: 'spring', stiffness: 500, damping: 24 }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          )
        })}
        {/* 最新点高亮 */}
        {pts.length > 1 && (
          <motion.circle
            cx={x(pts.length - 1)}
            cy={y(latest)}
            r={4}
            fill="none"
            stroke={rising ? '#1c1917' : latest < 0 ? '#e11d48' : '#a8a29e'}
            strokeWidth={1.6}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.9, type: 'spring', stiffness: 400, damping: 18 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-stone-300">
        <span>近 {recent.length} 局净胜分</span>
        <span className={rising ? 'font-medium text-stone-700' : latest < 0 ? 'font-medium text-rose-600' : ''}>
          当前 {latest > 0 ? '+' : ''}{latest}
        </span>
      </div>
    </div>
  )
}

/** 段位卡：由当前视角战绩推导 */
function RankCard({ wins, losses, draws }: { wins: number; losses: number; draws: number }) {
  const rank = rankFromRecord({ wins, losses, draws })
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-widest text-stone-400">段位</span>
        <span className="text-[9px] text-stone-300">RP = 胜×3 + 和 − 负</span>
      </div>
      <div className="flex items-center gap-3">
        <motion.span
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-stone-900 text-white shadow-[0_2px_10px_rgba(28,25,23,0.25)]"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          title={rank.tier.motto}
        >
          <span className="text-[13px] font-medium leading-none">{rank.tier.name}</span>
          <span className="mt-0.5 text-[8px] leading-none text-stone-400">LV{rank.tier.tier + 1}</span>
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-stone-800">{rank.tier.motto}</span>
            <span className="text-[10px] tabular-nums text-stone-400">{rank.rp} RP</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
            <motion.div
              className="h-full rounded-full bg-stone-900"
              initial={{ width: 0 }}
              animate={{ width: `${rank.progress * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
            />
          </div>
          <p className="mt-1 text-[10px] text-stone-300">
            {rank.next ? (
              <>再积 <span className="tabular-nums text-stone-500">{rank.rpToNext}</span> RP 晋升「{rank.next.name}」· {rank.next.motto}</>
            ) : (
              <>已至最高段位 · 独孤求败 ♟</>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

/** 落子热区：执黑/执白双迷你棋盘渲染本人落点频率（随视角切换数据源） */
const HM_LETTERS = 'ABCDEFGHJKLMNOP'
interface HmSplit {
  cells: number[]
  stones: number
  max: number
  top: number[]
}
function HmBoard({ data, label, side }: { data: HmSplit; label: string; side: 'black' | 'white' }) {
  const { cells, max, top, stones } = data
  const PAD = 9
  const CELL = 15.2
  const coord = (i: number) => `${HM_LETTERS[i % 15]}${15 - Math.floor(i / 15)}`
  const fav = top.length ? `${coord(top[0])}（${cells[top[0]]} 次）` : '—'
  return (
    <div className="min-w-0 flex flex-col items-center">
      <svg
        viewBox={`0 0 ${PAD * 2 + CELL * 14} ${PAD * 2 + CELL * 14}`}
        className="h-[132px] w-[132px] sm:h-[148px] sm:w-[148px]"
        role="img"
        aria-label={`${label}执${side === 'black' ? '黑' : '白'}热区图，共 ${stones} 子，最常落 ${fav}`}
      >
        {/* 网格 */}
        {Array.from({ length: 15 }, (_, i) => (
          <g key={i} className="stroke-stone-200" strokeWidth="0.8">
            <line x1={PAD} y1={PAD + i * CELL} x2={PAD + 14 * CELL} y2={PAD + i * CELL} />
            <line x1={PAD + i * CELL} y1={PAD} x2={PAD + i * CELL} y2={PAD + 14 * CELL} />
          </g>
        ))}
        {/* 星位 */}
        {[3, 11].map((r) =>
          [3, 11].map((c) => (
            <circle key={`${r}-${c}`} cx={PAD + c * CELL} cy={PAD + r * CELL} r="1.6" className="fill-stone-300" />
          ))
        )}
        {/* 热区圆点：黑子深墨点 / 白子描边空心点 */}
        {cells.map((v, i) => {
          if (!v) return null
          const r = Math.floor(i / 15)
          const c = i % 15
          const intensity = max > 0 ? v / max : 0
          const isTop = top.slice(0, 3).includes(i)
          return (
            <g key={i}>
              {isTop && (
                <circle
                  cx={PAD + c * CELL}
                  cy={PAD + r * CELL}
                  r="6.2"
                  fill="none"
                  className={i === top[0] ? 'stroke-amber-500' : 'stroke-stone-400'}
                  strokeWidth={i === top[0] ? 1.6 : 1.1}
                  strokeDasharray="2.4 1.8"
                />
              )}
              {side === 'black' ? (
                <circle
                  cx={PAD + c * CELL}
                  cy={PAD + r * CELL}
                  r={3.2 + intensity * 1.8}
                  className="fill-stone-800"
                  opacity={0.18 + intensity * 0.8}
                >
                  <title>{`${coord(i)} · 执黑落子 ${v} 次`}</title>
                </circle>
              ) : (
                <g>
                  <circle
                    cx={PAD + c * CELL}
                    cy={PAD + r * CELL}
                    r={3.2 + intensity * 1.8}
                    className="fill-stone-50"
                    opacity={0.55 + intensity * 0.45}
                  />
                  <circle
                    cx={PAD + c * CELL}
                    cy={PAD + r * CELL}
                    r={3.2 + intensity * 1.8}
                    fill="none"
                    className="stroke-stone-700"
                    strokeWidth="1.4"
                    opacity={0.35 + intensity * 0.65}
                  >
                    <title>{`${coord(i)} · 执白落子 ${v} 次`}</title>
                  </circle>
                </g>
              )}
            </g>
          )
        })}
      </svg>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-stone-700">
        {side === 'black' ? (
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-stone-900" aria-hidden />
        ) : (
          <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-stone-500 bg-white" aria-hidden />
        )}
        执{side === 'black' ? '黑' : '白'} · {stones} 子
      </p>
      <p className="text-[9px] text-stone-400">{stones > 0 ? `最常落 ${fav}` : '尚未执子'}</p>
    </div>
  )
}
function HeatMap({ srcKey, qs, label }: { srcKey: string; qs: string; label: string }) {
  /** 带 key 快照，切换视角时旧数据不闪烁（同步 setState 会触发 react-hooks 规则） */
  const [state, setState] = useState<{ key: string; d: { stones: number; black: HmSplit; white: HmSplit } } | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/matches/heatmap?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.ok) return
        const empty: HmSplit = { cells: new Array(225).fill(0), stones: 0, max: 0, top: [] }
        setState({
          key: srcKey,
          d: {
            stones: Number(d.stones) || 0,
            black: d.black ?? empty,
            white: d.white ?? empty,
          },
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [srcKey, qs])
  const data = state && state.key === srcKey ? state.d : null

  if (!data || data.stones === 0) return null
  const { black, white, stones } = data
  const onlyColor: 'black' | 'white' | null = black.stones > 0 && white.stones === 0 ? 'black' : white.stones > 0 && black.stones === 0 ? 'white' : null

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-widest text-stone-400">执子热区</span>
        <span className="text-[9px] text-stone-300">
          {label} · 共 {stones} 子 · 越深越常落
        </span>
      </div>
      {onlyColor ? (
        <div className="flex flex-col items-center gap-2">
          <HmBoard data={onlyColor === 'black' ? black : white} label={label} side={onlyColor} />
          <p className="text-[9px] text-stone-300">该棋手至今只执过{onlyColor === 'black' ? '黑' : '白'}子</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <HmBoard data={black} label={label} side="black" />
          <HmBoard data={white} label={label} side="white" />
        </div>
      )}
      <p className="mt-2 text-center text-[9px] leading-4 text-stone-300">琥珀圈 = 该色最常落点 · 悬停圆点看明细</p>
    </div>
  )
}

/** 战绩统计中心：昵称 / 本机双视角聚合个人战绩 */
export function StatsSheet({
  open,
  onOpenChange,
  name,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  name: string
}) {
  const [games, setGames] = useState<MyGame[] | null>(null)
  const [allCount, setAllCount] = useState(0)
  const [deviceGames, setDeviceGames] = useState<DeviceGame[] | null>(null)
  const [view, setView] = useState<StatsView>('name')
  const pid = useSyncExternalStore(noopSubscribe, getMyId, () => '')
  // loading 由状态派生：打开且当前视角的数据尚未拿到即为加载中
  const loading = open && (view === 'name' ? games === null : deviceGames === null)

  // 昵称档案：全量拉取后按昵称过滤
  useEffect(() => {
    if (!open || games) return
    let alive = true
    fetch('/api/matches?all=1')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const all: AllMatch[] = d?.all ?? []
        const mine: MyGame[] = all
          .filter((m) => m.blackName === name || m.whiteName === name)
          .map((m) => {
            const myColor: 1 | 2 = m.blackName === name ? 1 : 2
            const outcome: Outcome = m.winnerColor === 0 ? 'draw' : m.winnerColor === myColor ? 'win' : 'lose'
            return { ...m, myColor, outcome }
          })
        setGames(mine)
        setAllCount(all.length)
      })
      .catch(() => {
        if (alive) {
          setGames([])
          setAllCount(0)
        }
      })
    return () => {
      alive = false
    }
  }, [open, games, name])

  // 本机档案：设备维度独立拉取（与昵称档案互不取消，修复共享 alive 导致的竞态丢失）
  useEffect(() => {
    if (!open || !pid) return
    let alive = true
    fetch(`/api/matches?pid=${encodeURIComponent(pid)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setDeviceGames((d?.mine ?? []) as DeviceGame[])
      })
      .catch(() => {
        if (alive) setDeviceGames([])
      })
    return () => {
      alive = false
    }
  }, [open, pid])

  // 关闭后清缓存，下次打开取最新（事件回调，非 effect）
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setGames(null)
      setAllCount(0)
      setDeviceGames(null)
      setView('name')
    }
    onOpenChange(v)
  }

  /** 当前视角数据源：昵称档案 or 本机档案（适配为同一结构） */
  const deviceAllGames: MyGame[] | null = useMemo(
    () => (deviceGames ? deviceGames.map((g) => deviceToMyGame(g, name)) : null),
    [deviceGames, name]
  )
  const activeGames: MyGame[] | null = view === 'name' ? games : deviceAllGames

  const agg: Agg | null = useMemo(() => (activeGames ? aggregate(activeGames) : null), [activeGames])
  const soloAgg = useMemo(() => (activeGames ? aggregate(activeGames.filter((g) => g.mode === 'solo')) : null), [activeGames])
  const pvpAgg = useMemo(() => (activeGames ? aggregate(activeGames.filter((g) => g.mode === 'pvp')) : null), [activeGames])

  /** 本机档案聚合（设备维度） */
  const deviceAgg = useMemo(() => {
    if (!deviceGames) return null
    const wins = deviceGames.filter((g) => g.outcome === 'win').length
    const losses = deviceGames.filter((g) => g.outcome === 'lose').length
    const total = deviceGames.length
    return {
      total,
      wins,
      losses,
      draws: total - wins - losses,
      winRate: total ? Math.round((wins / total) * 100) : 0,
    }
  }, [deviceGames])

  /** 对手榜：按交手次数排序的前 5 位对手（随视角切换） */
  const rivals = useMemo(() => {
    if (!activeGames) return []
    const map = new Map<string, { name: string; n: number; w: number; l: number; d: number }>()
    for (const g of activeGames) {
      const opp = g.myColor === 1 ? g.whiteName : g.blackName
      const e = map.get(opp) ?? { name: opp, n: 0, w: 0, l: 0, d: 0 }
      e.n += 1
      if (g.outcome === 'win') e.w += 1
      else if (g.outcome === 'lose') e.l += 1
      else e.d += 1
      map.set(opp, e)
    }
    return [...map.values()]
      .sort((a, b) => b.n - a.n || b.w - a.w)
      .slice(0, 5)
      .map((r) => ({ ...r, wr: Math.round((r.w / r.n) * 100) }))
  }, [activeGames])

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88vh] overflow-y-auto rounded-t-3xl border-stone-200 px-5 pb-9 pt-4 shadow-[0_-8px_40px_-12px_rgba(28,25,23,0.2)] sm:max-w-md sm:left-0 sm:right-0 sm:rounded-3xl [&>button]:hidden"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">战绩统计</SheetTitle>
          <SheetDescription className="sr-only">按昵称聚合的个人胜率、执子胜率、分模式与 AI 难度战绩</SheetDescription>
        </SheetHeader>

        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex shrink-0 items-center gap-1.5 text-sm font-medium tracking-widest text-stone-700">
            <TrendingUp className="h-4 w-4 text-stone-400" />
            战绩中心
          </h2>
          <div
            role="tablist"
            aria-label="战绩视角"
            className="flex items-center gap-0.5 rounded-full border border-stone-200 bg-white p-0.5"
          >
            {(
              [
                { key: 'name', label: '昵称视角', icon: User },
                { key: 'device', label: '本机视角', icon: Smartphone },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] transition-all duration-200 ${
                  view === key
                    ? 'bg-stone-900 text-white shadow-[0_1px_4px_rgba(28,25,23,0.25)]'
                    : 'text-stone-400 hover:text-stone-700'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mb-3 text-center text-[10px] text-stone-300">
          {view === 'name' ? (
            <>按昵称「{name || '未填昵称'}」聚合 · 换昵称会分开统计</>
          ) : (
            <>按本机设备聚合 · 换昵称也计入（数据存在本机标识中）</>
          )}
        </p>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-14 text-stone-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-xs tracking-widest">正在统计战绩…</p>
          </div>
        )}

        {!loading && agg && agg.total === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-stone-200 py-12 text-center">
            <StoneIcon color={2} size={28} />
            <p className="text-xs text-stone-400">
              {view === 'name' ? `「${name}」还没有对局记录` : '本机还没有对局记录'}
            </p>
            <p className="text-[10px] text-stone-300">下完一局再来，胜率环就亮起来了 ♟</p>
            {view === 'name' && deviceAgg && deviceAgg.total > 0 && (
              <button
                onClick={() => setView('device')}
                className="mt-1 text-[10px] text-stone-400 underline underline-offset-4 transition-colors hover:text-stone-700"
              >
                本机已有 {deviceAgg.total} 局记录（其他昵称）· 点击查看本机视角 →
              </button>
            )}
          </div>
        )}

        {!loading && agg && agg.total > 0 && (
          <motion.div
            className="flex flex-col gap-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* 总览：胜率环 + 四格 */}
            <div className="flex items-center gap-4 rounded-2xl border border-stone-100 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.03)]">
              <WinRing rate={agg.winRate} />
              <div className="grid flex-1 grid-cols-2 gap-2">
                <StatCell label="总对局" value={agg.total} />
                <StatCell label="胜 · 负 · 和" value={`${agg.wins}/${agg.losses}/${agg.draws}`} />
                <StatCell label="当前连胜" value={agg.curStreak > 0 ? `${agg.curStreak} 连胜` : '—'} />
                <StatCell label="最长连胜" value={agg.bestStreak > 0 ? `${agg.bestStreak} 连胜` : '—'} />
              </div>
            </div>

            {/* 段位（由当前视角战绩推导，随视角切换） */}
            <RankCard wins={agg.wins} losses={agg.losses} draws={agg.draws} />

            {/* 本机档案（设备维度，仅在昵称视角展示摘要卡；本机视角全页即本机数据） */}
            {view === 'name' && deviceAgg && deviceGames && deviceAgg.total > 0 && (
              <div className="rounded-2xl border border-stone-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-widest text-stone-400">
                    <Smartphone className="h-3.5 w-3.5" />
                    本机档案
                  </span>
                  <span className="text-[10px] text-stone-300">按设备统计 · 换昵称也计入</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <StatCell label="本机对局" value={deviceAgg.total} />
                  <StatCell label="胜" value={deviceAgg.wins} />
                  <StatCell label="负" value={deviceAgg.losses} />
                  <StatCell label="胜率" value={`${deviceAgg.winRate}%`} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-stone-300">近期</span>
                  <div className="flex items-center gap-1.5">
                    {deviceGames.slice(0, 14).map((g) => (
                      <motion.span
                        key={g.id}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                        title={`vs ${g.oppName} · ${g.outcome === 'win' ? '胜' : g.outcome === 'lose' ? '负' : '和'}`}
                        className={`h-2.5 w-2.5 rounded-full ${
                          g.outcome === 'win'
                            ? 'bg-stone-900'
                            : g.outcome === 'lose'
                              ? 'border-[1.5px] border-stone-300 bg-white'
                              : 'bg-stone-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                {agg && deviceAgg.total > agg.total && (
                  <p className="mt-2.5 text-[10px] text-stone-300">
                    另有 {deviceAgg.total - agg.total} 局来自其他昵称，仅计入本机档案
                  </p>
                )}
              </div>
            )}

            {/* 执黑 / 执白 */}
            <div className="rounded-2xl border border-stone-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-widest text-stone-400">执子胜率</span>
                <span className="text-[10px] text-stone-300">越黑越旺</span>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex w-14 items-center gap-1.5 text-xs text-stone-600">
                    <StoneIcon color={1} size={12} /> 执黑
                  </span>
                  <div className="flex-1">
                    <MiniBar pct={agg.blackWR ?? 0} />
                  </div>
                  <span className="w-16 text-right text-[11px] tabular-nums text-stone-500">
                    {agg.blackWR === null ? '—' : `${agg.blackWR}% · ${agg.blackN}局`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex w-14 items-center gap-1.5 text-xs text-stone-600">
                    <StoneIcon color={2} size={12} /> 执白
                  </span>
                  <div className="flex-1">
                    <MiniBar pct={agg.whiteWR ?? 0} tone="amber" />
                  </div>
                  <span className="w-16 text-right text-[11px] tabular-nums text-stone-500">
                    {agg.whiteWR === null ? '—' : `${agg.whiteWR}% · ${agg.whiteN}局`}
                  </span>
                </div>
              </div>
            </div>

            {/* 分模式 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-stone-100 bg-white p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-stone-500">
                  <Users className="h-3.5 w-3.5" />
                  好友对战
                </div>
                <p className="text-xl font-light tabular-nums text-stone-900">
                  {pvpAgg?.total ?? 0} <span className="text-[10px] text-stone-400">局</span>
                </p>
                <p className="mt-0.5 text-[10px] text-stone-400 tabular-nums">
                  胜率 {pvpAgg && pvpAgg.total ? `${pvpAgg.winRate}%` : '—'} · {pvpAgg?.wins ?? 0} 胜
                </p>
              </div>
              <div className="rounded-2xl border border-stone-100 bg-white p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-stone-500">
                  <Bot className="h-3.5 w-3.5" />
                  人机对战
                </div>
                <p className="text-xl font-light tabular-nums text-stone-900">
                  {soloAgg?.total ?? 0} <span className="text-[10px] text-stone-400">局</span>
                </p>
                <p className="mt-0.5 text-[10px] text-stone-400 tabular-nums">
                  胜率 {soloAgg && soloAgg.total ? `${soloAgg.winRate}%` : '—'} · {soloAgg?.wins ?? 0} 胜
                </p>
              </div>
            </div>

            {/* AI 难度战绩（有 solo 对局才显示） */}
            {soloAgg && soloAgg.total > 0 && (
              <div className="rounded-2xl border border-stone-100 bg-white p-4">
                <div className="mb-3 text-[11px] font-medium tracking-widest text-stone-400">对弈心·AI 各难度战绩</div>
                <div className="flex flex-col gap-2.5">
                  {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => {
                    const s = agg.byDiff[d]
                    const n = s.w + s.l + s.d
                    const Icon = DIFF_ICON[d]
                    return (
                      <div key={d} className="flex items-center gap-3">
                        <span className="flex w-16 items-center gap-1 text-xs text-stone-600">
                          <Icon className="h-3 w-3 text-stone-400" />
                          {DIFFICULTY_LABEL[d]}
                        </span>
                        <div className="flex-1">
                          <MiniBar pct={n ? (s.w / n) * 100 : 0} />
                        </div>
                        <span className="w-20 text-right text-[11px] tabular-nums text-stone-500">
                          {n ? `${s.w}胜 ${s.l}负${s.d ? ` ${s.d}和` : ''}` : '未交手'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 对手榜（交手次数前 5） */}
            {rivals.length > 0 && (
              <div className="rounded-2xl border border-stone-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-widest text-stone-400">对手榜</span>
                  <span className="text-[9px] text-stone-300">按交手次数排序</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {rivals.map((r, i) => (
                    <div key={r.name} className="flex items-center gap-3">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] tabular-nums ${
                          i === 0 ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-400'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-stone-600">
                        {r.name === '弈心·AI' ? (
                          <Bot className="h-3 w-3 shrink-0 text-stone-400" />
                        ) : (
                          <User className="h-3 w-3 shrink-0 text-stone-300" />
                        )}
                        <span className="truncate" title={r.name}>
                          {r.name}
                        </span>
                      </span>
                      <div className="flex-1">
                        <MiniBar pct={r.wr} tone={r.name === '弈心·AI' ? 'amber' : 'dark'} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-stone-500">
                        {r.wr}% · {r.w}胜{r.l}负{r.d ? ` ${r.d}和` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 近期状态 + 走势折线 + 细节数据 */}
            <div className="rounded-2xl border border-stone-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-widest text-stone-400">近期状态</span>
                <span className="text-[9px] text-stone-300">实心胜 · 空心负 · 灰点和</span>
              </div>
              <FormDots games={activeGames!} />
              {activeGames!.length >= 2 && (
                <div className="mt-4 border-t border-stone-50 pt-3">
                  <TrendLine games={activeGames!} />
                </div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatCell label="最快取胜" value={agg.fastestWin ? `${agg.fastestWin} 手` : '—'} />
                <StatCell label="平均手数" value={agg.avgMoves ?? '—'} />
                <StatCell label="平均用时" value={agg.avgDurationMin ? `${agg.avgDurationMin} 分` : '—'} />
              </div>
            </div>

            {/* 落子热区（随视角切换数据源；有落子数据才显示） */}
            {view === 'name'
              ? name.trim() && (
                  <HeatMap
                    srcKey={`name:${name}`}
                    qs={`name=${encodeURIComponent(name.trim().slice(0, 20))}`}
                    label={`「${name.trim().slice(0, 12)}」`}
                  />
                )
              : pid && <HeatMap srcKey={`pid:${pid}`} qs={`pid=${encodeURIComponent(pid)}`} label="本机" />}

            <p className="text-center text-[10px] text-stone-300">
              {view === 'name'
                ? `按昵称「${name}」聚合最近 ${allCount} 局记录 · 换昵称会分开统计`
                : `按本机设备聚合 ${deviceAgg?.total ?? 0} 局记录 · 清除浏览器数据将重置`}
            </p>
          </motion.div>
        )}
      </SheetContent>
    </Sheet>
  )
}
