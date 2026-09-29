'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bot, BarChart3, Dices, Loader2, LogIn, Play, Plus, ScanLine, Settings2, Sprout, Target, Crown, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { DIFFICULTY_LABEL, type Difficulty, type RoomPeek } from '@/lib/gomoku/types'
import {
  BUILTIN_AI_ID,
  BUILTIN_AI_NAME,
  getActiveAiConfig,
  getSelectedAiId,
  subscribeAiConfig,
  type AiModelConfig,
} from '@/lib/gomoku/ai-config'
import { AiSettingsDialog } from './AiSettingsDialog'
import { rankFromRecord, type RankInfo, type RankRecord } from '@/lib/gomoku/rank'
import { fetchRankRecord, invalidateRank, RankBadge } from './RankBadge'
import { getMyId } from '@/lib/gomoku/useGomoku'
import { StoneIcon } from './StoneIcon'
import { ReplaySheet } from './ReplaySheet'
import { StatsSheet } from './StatsSheet'
import { ThemeToggle } from './ThemeToggle'

/** 本机视角对局行：GET /api/matches?pid= 返回的 mine[] */
interface MyMatch {
  id: number
  roomCode: string
  myColor: 1 | 2
  oppName: string
  blackName: string
  whiteName: string
  outcome: 'win' | 'lose' | 'draw'
  endReason: string
  moveCount: number
  mode: string
  difficulty: string
  hasReplay: boolean
  createdAt: string
}

const RANDOM_NAMES = ['棋客', '小茶', '阿白', '黑白之间', '落子无悔', '南山樵夫', '云手', '快棋手', '星位控', '先手党']

const noopSubscribe = () => () => {}

// 大厅 AI 卡片展示（选中档案 id + 昵称）：源自 localStorage 外部存储，
// 服务端渲染与水合期间固定为内置弈心，档案保存后经 subscribeAiConfig 自动刷新
const AI_DISPLAY_BUILTIN = { id: BUILTIN_AI_ID, name: BUILTIN_AI_NAME }
let aiDisplayCache = AI_DISPLAY_BUILTIN
function getAiDisplay() {
  const cfg = getActiveAiConfig()
  const next = { id: getSelectedAiId(), name: cfg?.name ?? BUILTIN_AI_NAME }
  if (next.id !== aiDisplayCache.id || next.name !== aiDisplayCache.name) aiDisplayCache = next
  return aiDisplayCache
}

const DIFFICULTY_OPTIONS = [
  { key: 'easy' as Difficulty, label: '入门', hint: '新手友好 · 偶有失误', icon: Sprout },
  { key: 'normal' as Difficulty, label: '进阶', hint: '攻防均衡 · 稳健应对', icon: Target },
  { key: 'hard' as Difficulty, label: '大师', hint: '前瞻算杀 · 极具挑战', icon: Crown },
]

const REASON_TEXT: Record<string, string> = {
  five: '五连',
  timeout: '超时',
  resign: '认输',
  disconnect: '离场',
  draw: '和棋',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

/** 房间预览卡（room:peek 结果：未入房即可见房主资料与房间状态） */
function RoomPeekCard({ peek }: { peek: RoomPeek }) {
  /** 带 pid 快照，避免房主切换时旧战绩闪烁（同步 setState 会触发 react-hooks 规则） */
  const [rec, setRec] = useState<{ pid: string; record: RankRecord | null }>({ pid: '', record: null })
  useEffect(() => {
    const pid = peek.hostPid ?? ''
    if (!pid) return
    let alive = true
    fetchRankRecord(pid).then((r) => {
      if (alive) setRec({ pid, record: r })
    })
    return () => {
      alive = false
    }
  }, [peek.hostPid])
  const record = rec.pid === (peek.hostPid ?? '') ? rec.record : null

  const total = record ? record.wins + record.losses + record.draws : 0
  const winRate = total > 0 ? Math.round((record!.wins / total) * 100) : 0
  const statusPill =
    peek.status === 'waiting'
      ? { text: '等待对手', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : peek.status === 'playing'
        ? { text: '对局中', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
        : { text: '已结束', cls: 'bg-stone-100 text-stone-500 border-stone-200' }
  const hint = peek.seatFree
    ? peek.status === 'playing'
      ? '席位已满 · 加入后可观战学习棋局'
      : peek.status === 'waiting'
        ? '正等一位对手 · 填好昵称点右侧按钮即入座'
        : '对局已结束 · 加入可回看终局棋盘'
    : `房间已满 · 加入将作为观战${peek.spectators > 0 ? ` · 已有 ${peek.spectators} 人观战` : ''}`

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -6, height: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50/60 p-3" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <StoneIcon color={peek.hostColor} size={18} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-stone-800">{peek.hostName ?? '棋客'}</span>
              {peek.hostPid && peek.hostPid !== 'ai-yixin' && <RankBadge pid={peek.hostPid} />}
              <span className={`ml-auto flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] ${statusPill.cls}`}>
                {statusPill.text}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] leading-4 text-stone-400">
              <span className="shrink-0">
                {peek.mode === 'solo' ? `人机 · ${peek.whiteName ?? '弈心'}${peek.difficulty ? DIFFICULTY_LABEL[peek.difficulty] : ''}` : '好友对战'}
              </span>
              <span className="text-stone-300">·</span>
              <span className="truncate">
                {total > 0
                  ? `房主战绩 ${record!.wins}胜${record!.losses}负${record!.draws > 0 ? `${record!.draws}和` : ''} · 胜率 ${winRate}%`
                  : '房主是新棋友'}
              </span>
            </div>
          </div>
        </div>
        <p className="mt-2 border-t border-stone-200/70 pt-2 text-[10px] text-stone-400">{hint}</p>
      </div>
    </motion.div>
  )
}

export function Lobby({
  initialName,
  pendingCode,
  busy,
  connected,
  online = 0,
  onCreate,
  onJoin,
  consumePendingJoin,
  peekRoom,
}: {
  initialName: string
  pendingCode?: string | null
  busy: boolean
  connected: boolean
  online?: number
  onCreate: (name: string, mode: 'pvp' | 'solo', difficulty: Difficulty, aiConfig: AiModelConfig | null) => void
  onJoin: (code: string, name: string) => void
  consumePendingJoin: (name: string) => boolean
  peekRoom: (code: string) => Promise<RoomPeek | null>
}) {
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState(pendingCode ?? '')
  const [mode, setMode] = useState<'pvp' | 'solo'>('pvp')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  // 自定义 AI：选中的档案（外部存储订阅刷新）+ 设置弹窗开关
  const [aiOpen, setAiOpen] = useState(false)
  const aiDisplay = useSyncExternalStore(subscribeAiConfig, getAiDisplay, () => AI_DISPLAY_BUILTIN)
  const [recent, setRecent] = useState<MyMatch[]>([])
  const [summary, setSummary] = useState<{ total: number; wins: number; losses: number; draws: number } | null>(null)
  const [replayId, setReplayId] = useState<number | null>(null)
  const [replayOpen, setReplayOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  // 房号预览（room:peek）：输满 4 位后自动查询，展示房主资料与房间状态
  const [peek, setPeek] = useState<RoomPeek | null>(null)
  const [peekState, setPeekState] = useState<'idle' | 'loading' | 'found' | 'missing'>('idle')
  // 本机设备标识（用于最近对局「本机」徽章；SSR 安全快照）
  const myPid = useSyncExternalStore(noopSubscribe, getMyId, () => '')
  const [myRank, setMyRank] = useState<RankInfo | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // 我的段位（回大厅时强刷缓存，确保刚结束的对局立即计入）
  useEffect(() => {
    if (!myPid) return
    let alive = true
    invalidateRank(myPid)
    fetchRankRecord(myPid).then((rec) => {
      if (alive && rec) setMyRank(rankFromRecord(rec))
    })
    return () => {
      alive = false
    }
  }, [myPid])

  // 仅做输入焦点定位（纯 DOM 副作用）
  useEffect(() => {
    if (pendingCode) {
      setTimeout(() => codeRef.current?.focus(), 300)
    } else if (!initialName) {
      setTimeout(() => nameRef.current?.focus(), 300)
    }
  }, [pendingCode, initialName])

  // 最近对局：只取本机（pid 维度）参与的对局，大厅不再展示他人战况
  const loadRecent = useCallback(() => {
    if (!myPid) return
    fetch(`/api/matches?pid=${encodeURIComponent(myPid)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setRecent((d.mine ?? []).slice(0, 8))
          setSummary(d.summary ?? null)
        }
      })
      .catch(() => {})
  }, [myPid])

  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  // 房号输满 4 位后防抖 peek（未入房，仅读公共信息；所有 setState 均在异步回调内，符合 react-hooks 规则）
  useEffect(() => {
    const c = code.trim().toUpperCase()
    let alive = true
    const t = setTimeout(() => {
      if (!alive) return
      if (!connected || c.length !== 4) {
        setPeek(null)
        setPeekState('idle')
        return
      }
      setPeekState('loading')
      peekRoom(c).then((res) => {
        if (!alive) return
        setPeek(res)
        setPeekState(res ? 'found' : 'missing')
      })
    }, 320)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [code, connected, peekRoom])

  const ensureName = (): string | null => {
    const n = name.trim().slice(0, 12)
    if (!n) {
      nameRef.current?.focus()
      return null
    }
    setName(n)
    return n
  }

  const handleCreate = () => {
    const n = ensureName()
    if (n && connected) onCreate(n, mode, difficulty, mode === 'solo' ? getActiveAiConfig() : null)
  }

  const handleJoin = () => {
    const n = ensureName()
    if (!n || !connected) return
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (c.length < 4) {
      codeRef.current?.focus()
      return
    }
    onJoin(c, n)
  }

  const randomName = () => {
    setName(RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] + Math.floor(Math.random() * 90 + 10))
  }

  const openReplay = (id: number) => {
    setReplayId(id)
    setReplayOpen(true)
  }

  /** 再约一局：建房（pvp）并记住对手名，等待页自动复制邀请链接 */
  const handleRematch = (oppName: string) => {
    const n = ensureName()
    if (!n || !connected || busy) return
    try {
      sessionStorage.setItem('gomoku:reinvite', oppName)
    } catch {
      /* 隐私模式忽略 */
    }
    onCreate(n, 'pvp', difficulty, null)
  }

  const canCreate = connected && name.trim().length > 0 && !busy

  return (
    <div className="relative mx-auto w-full max-w-md px-5 pb-10 pt-10 sm:pt-14">
      {/* 主题切换（右上角固定） */}
      <div className="absolute right-5 top-5 sm:top-7">
        <ThemeToggle />
      </div>
      {/* 标题区 */}
      <motion.header
        className="mb-10 text-center"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mb-5 flex items-center justify-center gap-3">
          <motion.span
            className="inline-flex"
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 3.6, ease: 'easeInOut' }}
          >
            <StoneIcon color={1} size={26} />
          </motion.span>
          <span className="h-px w-8 bg-stone-200" />
          <motion.span
            className="inline-flex"
            animate={{ y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 3.6, ease: 'easeInOut', delay: 1.8 }}
          >
            <StoneIcon color={2} size={26} />
          </motion.span>
        </div>
        <h1 className="text-5xl font-extralight tracking-[0.35em] text-stone-900 [text-indent:0.35em]">五子</h1>
        <p className="mt-3 text-[11px] uppercase tracking-[0.4em] text-stone-400 [text-indent:0.4em]">Gomoku · 极简对弈</p>
        {/* 在线人数（实时推送） */}
        <div
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-stone-100 bg-white/70 px-3 py-1 text-[10px] text-stone-400"
          aria-label={`当前 ${online} 人在线`}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          {online > 0 ? `${online} 人在线` : '连接中…'}
        </div>
      </motion.header>

      {/* 表单卡片 */}
      <motion.section
        className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
      >
        <label className="mb-1.5 block text-xs font-medium text-stone-500" htmlFor="nickname">
          你的昵称
        </label>
        <div className="flex gap-2">
          <Input
            id="nickname"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (code ? handleJoin() : handleCreate())}
            placeholder="微信里朋友怎么叫你"
            maxLength={12}
            className="h-11 rounded-xl border-stone-200 bg-stone-50/50 text-center text-base focus-visible:ring-stone-300"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={randomName}
            aria-label="随机昵称"
            className="h-11 w-11 shrink-0 rounded-xl border-stone-200 text-stone-400 hover:text-stone-700"
          >
            <Dices className="h-4 w-4" />
          </Button>
        </div>

        {/* 对局模式 */}
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1" role="radiogroup" aria-label="对局模式">
          {(
            [
              { key: 'pvp', label: '好友对战', icon: Users, hint: '微信邀请好友对弈' },
              { key: 'solo', label: '人机对战', icon: Bot, hint: '弈心·AI 陪你练手' },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              role="radio"
              aria-checked={mode === m.key}
              onClick={() => setMode(m.key)}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-[13px] transition-all duration-200 ${
                mode === m.key
                  ? 'bg-white text-stone-900 shadow-[0_1px_4px_rgba(28,25,23,0.1)]'
                  : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          ))}
        </div>

        {/* AI 难度（人机模式专属，展开动画） */}
        <AnimatePresence initial={false}>
          {mode === 'solo' && (
            <motion.div
              key="difficulty"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1"
                role="radiogroup"
                aria-label="AI 难度"
              >
                {DIFFICULTY_OPTIONS.map((d) => {
                  const active = difficulty === d.key
                  return (
                    <button
                      key={d.key}
                      role="radio"
                      aria-checked={active}
                      title={d.hint}
                      onClick={() => setDifficulty(d.key)}
                      className={`flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-200 ${
                        active
                          ? 'bg-white text-stone-900 shadow-[0_1px_4px_rgba(28,25,23,0.1)]'
                          : 'text-stone-400 hover:text-stone-600'
                      }`}
                    >
                      <span className="flex items-center gap-1 text-[13px]">
                        <d.icon className={`h-3.5 w-3.5 ${active ? 'text-amber-600' : ''}`} />
                        {d.label}
                      </span>
                      <span className="text-[9px] leading-3 text-stone-400">{d.hint.split(' · ')[0]}</span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI 引擎选择（人机模式专属）：内置弈心或自定义大模型 */}
        <AnimatePresence initial={false}>
          {mode === 'solo' && (
            <motion.div
              key="ai-select"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2">
                <Bot className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] text-stone-400">AI 对手</span>
                  <span className="block truncate text-[13px] text-stone-700">
                    {aiDisplay.id === BUILTIN_AI_ID ? `${aiDisplay.name}（内置引擎）` : aiDisplay.name}
                    {aiDisplay.id !== BUILTIN_AI_ID && <span className="ml-1 text-[10px] text-amber-600">自定义模型</span>}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAiOpen(true)}
                  className="h-8 shrink-0 rounded-lg border-stone-300 px-2.5 text-xs text-stone-600 hover:bg-white"
                >
                  <Settings2 className="mr-1 h-3.5 w-3.5" />
                  设置
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Button
          onClick={handleCreate}
          disabled={!canCreate}
          className="mt-3 h-12 w-full rounded-xl bg-stone-900 text-base font-normal tracking-wide text-white shadow-none transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:bg-stone-700 enabled:hover:shadow-[0_8px_20px_-8px_rgba(28,25,23,0.4)] active:translate-y-0 active:scale-[0.99] disabled:hover:translate-y-0"
        >
          {mode === 'pvp' ? (
            <>
              <Plus className="mr-1.5 h-4 w-4" />
              创建房间 · 邀请微信好友
            </>
          ) : (
            <>
              <Bot className="mr-1.5 h-4 w-4" />
              开始人机对弈 · {aiDisplay.id === BUILTIN_AI_ID ? '弈心陪练' : aiDisplay.name}
            </>
          )}
        </Button>
        {!connected && <p className="mt-2 text-center text-xs text-amber-600">正在连接对战服务…</p>}
        {connected && mode === 'solo' && (
          <p className="mt-2 text-center text-[11px] text-stone-400">
            与 {DIFFICULTY_LABEL[difficulty]}弈心即刻开局 · 好友点链接可接管 AI 座位变真人对抗
          </p>
        )}

        <div className="my-5 flex items-center gap-3">
          <Separator className="flex-1 bg-stone-100" />
          <span className="text-[10px] uppercase tracking-widest text-stone-300">或 加入房号</span>
          <Separator className="flex-1 bg-stone-100" />
        </div>

        <div className="flex gap-2">
          <Input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="房号"
            inputMode="text"
            autoCapitalize="characters"
            className="h-11 rounded-xl border-stone-200 bg-stone-50/50 text-center text-lg font-medium tracking-[0.5em] uppercase placeholder:tracking-normal focus-visible:ring-stone-300"
          />
          <Button
            onClick={handleJoin}
            disabled={!connected || code.trim().length < 4 || busy}
            variant="outline"
            className="h-11 w-[72px] shrink-0 rounded-xl border-stone-300 text-stone-700 transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:bg-stone-100 enabled:hover:shadow-[0_4px_12px_-6px_rgba(28,25,23,0.25)] active:translate-y-0 active:scale-[0.97]"
          >
            {peekState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          </Button>
        </div>
        {/* 房间预览卡（防抖 peek 结果） */}
        <AnimatePresence mode="wait" initial={false}>
          {peekState === 'found' && peek && <RoomPeekCard key={peek.code + peek.status + String(peek.round)} peek={peek} />}
          {peekState === 'missing' && (
            <motion.p
              key="missing"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 rounded-xl border border-dashed border-stone-200 bg-stone-50/60 px-3 py-2.5 text-center text-[11px] text-stone-400"
              aria-live="polite"
            >
              没有找到房间 {code.toUpperCase()} · 请核对房号，或让好友重新发送邀请
            </motion.p>
          )}
        </AnimatePresence>
      </motion.section>

      {/* 三步玩法 */}
      <motion.ol
        className="mt-6 grid grid-cols-3 gap-2 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {['填写昵称', '创建房间', '链接发给好友'].map((s, i) => (
          <li key={s} className="rounded-xl border border-stone-100 bg-white/60 px-2 py-3">
            <span className="mb-1 block text-[10px] text-stone-300">{['壹', '贰', '叁'][i]}</span>
            <span className="text-xs text-stone-600">{s}</span>
          </li>
        ))}
      </motion.ol>

      {/* 最近对局 */}
      <motion.section
        className="mt-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 text-xs font-medium tracking-widest text-stone-400">
            <ScanLine className="h-3.5 w-3.5" />
            最近对局
          </h2>
          <div className="flex items-center gap-2">
            {myRank && (
              <span
                className="hidden items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-1 text-[10px] text-stone-500 transition-colors hover:border-stone-400 sm:flex"
                title={`${myRank.tier.motto} · ${myRank.rp} RP${myRank.next ? ` · 距「${myRank.next.name}」还差 ${myRank.rpToNext} RP` : ' · 已至顶段'}`}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: myRank.tier.tier >= 6 ? '#1c1917' : myRank.tier.tier >= 3 ? '#57534e' : '#a8a29e' }}
                />
                {myRank.tier.name}
                <span className="tabular-nums text-stone-300">{myRank.rp}</span>
              </span>
            )}
            {summary && summary.total > 0 && (
              <span className="text-[11px] text-stone-400">
                本机 {summary.total} 局 · 胜 {summary.wins} / 负 {summary.losses}
                {summary.draws > 0 ? ` / 和 ${summary.draws}` : ''}
              </span>
            )}
            <button
              onClick={() => setStatsOpen(true)}
              className="flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-stone-500 transition-all duration-200 hover:-translate-y-px hover:border-stone-400 hover:text-stone-800 hover:shadow-[0_3px_8px_rgba(28,25,23,0.08)] active:translate-y-0 active:scale-[0.96]"
              title="查看个人战绩统计"
            >
              <BarChart3 className="h-3 w-3" />
              战绩
            </button>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 py-8 text-center text-xs text-stone-400">
            本机还没有对局，来下第一局 ♟
          </div>
        ) : (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-100 bg-white">
            {recent.map((m) => {
              const solo = m.mode === 'solo'
              const myName = m.myColor === 1 ? m.blackName : m.whiteName
              const oppName = m.oppName
              const canRematch = !solo && !!oppName && oppName !== '弈心·AI'
              const inner = (
                <>
                  {/* 本机视角：我执色 + 胜负徽章 + 对手名（自适应截断），悬停可见当局详情 */}
                  <StoneIcon color={m.myColor} size={14} />
                  {m.outcome === 'win' ? (
                    <span className="shrink-0 whitespace-nowrap rounded bg-stone-900 px-1.5 py-0.5 text-[10px] text-white" title="本机胜局">
                      胜{m.endReason ? ` · ${REASON_TEXT[m.endReason] ?? ''}` : ''}
                    </span>
                  ) : m.outcome === 'lose' ? (
                    <span className="shrink-0 whitespace-nowrap rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600" title="本机负局">
                      负{m.endReason ? ` · ${REASON_TEXT[m.endReason] ?? ''}` : ''}
                    </span>
                  ) : (
                    <span className="shrink-0 whitespace-nowrap rounded bg-stone-50 px-1.5 py-0.5 text-[10px]">和棋</span>
                  )}
                  <span className="shrink-0 text-stone-300">对</span>
                  <span
                    className={`min-w-0 flex-1 truncate text-left ${m.outcome === 'lose' ? 'font-semibold text-stone-900' : 'text-stone-600'}`}
                    title={`${myName} 执${m.myColor === 1 ? '黑' : '白'} · 共 ${m.moveCount} 手`}
                  >
                    {oppName}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-stone-400">
                    {solo && (
                      <span className="hidden items-center gap-0.5 whitespace-nowrap rounded bg-stone-50 px-1.5 py-0.5 text-[10px] sm:flex">
                        <Bot className="h-2.5 w-2.5" />
                        {m.difficulty && DIFFICULTY_LABEL[m.difficulty as Difficulty] ? DIFFICULTY_LABEL[m.difficulty as Difficulty] : '陪练'}
                      </span>
                    )}
                    <span className="hidden whitespace-nowrap sm:inline">{m.moveCount} 手</span>
                    {canRematch && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`再约 ${oppName} 对弈`}
                        title={`再约 ${oppName}：立即建房并复制邀请链接`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRematch(oppName)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                            e.preventDefault()
                            handleRematch(oppName)
                          }
                        }}
                        className="flex h-6 shrink-0 items-center rounded-lg border border-stone-200 px-2 text-[10px] text-stone-500 transition-all duration-200 hover:-translate-y-px hover:border-stone-800 hover:bg-stone-900 hover:text-white hover:shadow-[0_3px_8px_rgba(28,25,23,0.2)] active:translate-y-0 active:scale-95"
                      >
                        再约
                      </span>
                    )}
                    <span className={`${canRematch ? 'hidden sm:inline' : ''} w-14 shrink-0 text-right text-[10px] text-stone-300`}>
                      {timeAgo(m.createdAt)}
                    </span>
                    {m.hasReplay && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-stone-200 text-stone-400 transition-colors group-hover:border-stone-400 group-hover:text-stone-700">
                        <Play className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                </>
              )
              const cls = `group flex w-full items-center gap-3 px-4 py-2.5 text-xs transition-colors duration-200 ${
                m.hasReplay ? 'cursor-pointer hover:bg-stone-50/80' : 'cursor-default'
              }`
              return (
                <li key={m.id}>
                  {m.hasReplay ? (
                    <button onClick={() => openReplay(m.id)} className={cls} title="回放棋谱" aria-label={`回放 ${m.blackName} 对 ${m.whiteName} 的棋谱`}>
                      {inner}
                    </button>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {recent.some((m) => m.hasReplay) && (
          <p className="mt-2 px-1 text-[10px] text-stone-300">点击带 ▶ 的对局可逐步回放棋谱 · 「再约」一键建房复发邀请</p>
        )}
      </motion.section>

      {/* 棋谱回放（key 绑棋谱 id，切换时重置播放进度） */}
      <ReplaySheet key={`lobby-replay-${replayId ?? 'none'}`} matchId={replayId} open={replayOpen} onOpenChange={setReplayOpen} />

      {/* 战绩统计中心 */}
      <StatsSheet open={statsOpen} onOpenChange={setStatsOpen} name={name.trim().slice(0, 12)} />

      {/* AI 对手设置（自定义大模型接入） */}
      <AiSettingsDialog open={aiOpen} onOpenChange={setAiOpen} />
    </div>
  )
}
