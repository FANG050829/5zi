'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  Flag,
  Flame,
  Hash,
  Lightbulb,
  LogOut,
  Maximize,
  MessageCircle,
  Shrink,
  Smile,
  Sprout,
  Swords,
  Target,
  Undo2,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { getMutedSnapshot, getMutedServerSnapshot, subscribeMuted, toggleMuted } from '@/lib/gomoku/sounds'
import { copyText, inviteText } from '@/lib/gomoku/share'
import { getMyId, REACTION_EMOJIS } from '@/lib/gomoku/useGomoku'
import { useLandscape } from '@/lib/gomoku/useLandscape'
import { DIFFICULTY_LABEL, type Difficulty, type HintKind, type Reaction, type RoomState, type SeatPub } from '@/lib/gomoku/types'
import { type ReplayMatch } from '@/lib/gomoku/replay'
import { EvalBar } from './EvalBar'
import { GameBoard } from './GameBoard'
import { RankBadge } from './RankBadge'
import { ChatPanel, type ChatPhase } from './ChatPanel'
import { ReplaySheet } from './ReplaySheet'
import { StoneIcon } from './StoneIcon'
import { ThemeToggle } from './ThemeToggle'
import { TurnTimer } from './TurnTimer'
import { WaitingRoom } from './WaitingRoom'

const noopSubscribe = () => () => {}

interface GomokuApi {
  room: RoomState | null
  myColor: 1 | 2 | null
  isSpectator: boolean
  connected: boolean
  reactions: Reaction[]
  move: (index: number) => void
  requestUndo: () => void
  acceptUndo: () => void
  rejectUndo: () => void
  requestHint: () => void
  toggleRematch: () => void
  resign: () => void
  sendChat: (text: string) => void
  sendReaction: (emoji: string) => void
  changeDifficulty: (difficulty: Difficulty) => void
  leaveRoom: () => void
}

const REASON_TEXT: Record<string, string> = {
  five: '五子连珠',
  timeout: '对手超时',
  resign: '对手认输',
  disconnect: '对手离场',
  draw: '满盘和棋',
}

const COL_LETTERS = 'ABCDEFGHJKLMNOP'
const coordText = (index: number) => `${COL_LETTERS[index % 15]}${15 - Math.floor(index / 15)}`
const HINT_TEXT: Record<HintKind, string> = {
  win: '必胜点',
  block: '防守点',
  best: '推荐点',
}

const DIFFICULTY_ICON: Record<Difficulty, typeof Sprout> = { easy: Sprout, normal: Target, hard: Crown }
const DIFFICULTY_DESC: Record<Difficulty, string> = {
  easy: '初学乍练 · 适合热身',
  normal: '棋力稳健 · 攻守平衡',
  hard: '深谋远虑 · 步步紧逼',
}

/** 交手记录（head-to-head，按设备标识） */
interface H2H {
  total: number
  myWins: number
  oppWins: number
  draws: number
  iWonLast: boolean
}

/** 胜利表情雨：胜者与观战者可见的终局彩蛋（全屏） */
const RAIN_EMOJIS = ['🎉', '✨', '👏', '🔥', '🎊', '⚪', '⚫', '♟']
const RAIN_EMOJIS_WIN = ['🎉', '✨', '👏', '🎉', '🔥', '🎊', '✨', '⚫', '⚪']

export function GameRoom({ gomoku }: { gomoku: GomokuApi }) {
  const { room, myColor, isSpectator, connected, reactions } = gomoku
  const { toast } = useToast()
  const [chatOpen, setChatOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)
  const [resignOpen, setResignOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [dismissedAtRound, setDismissedAtRound] = useState<number | null>(null)
  const [numbered, setNumbered] = useState(false) // 手数标注开关
  const muted = useSyncExternalStore(subscribeMuted, getMutedSnapshot, getMutedServerSnapshot)
  const myId = useSyncExternalStore(noopSubscribe, getMyId, () => '')

  // 横屏对局模式（Fullscreen + 方向锁定，iOS 等不支持环境自动降级 CSS 旋转）
  const { active: landActive, mode: landMode, enter: enterLandscape, exit: exitLandscape } = useLandscape()
  /** 终局不自动退出横屏（结果弹窗/表情雨直接在横屏内展示）；
   *  仅两种方式退出：手动点「退出横屏」，或关闭房间（room 置空回大厅）时自动退出 */
  useEffect(() => {
    if (!room && landActive) exitLandscape()
  }, [room, landActive, exitLandscape])

  /** 房内复盘：由当前房间 moves 构建回放数据（hooks 必须在早退之前） */
  const inlineMatch: ReplayMatch | null = useMemo(() => {
    if (!room?.moves || room.moves.length === 0) return null
    return {
      id: -room.round,
      roomCode: room.code,
      blackName: room.black?.name ?? '黑方',
      whiteName: room.white?.name ?? '白方',
      winnerColor: room.winner ?? 0,
      endReason: room.endReason || 'five',
      moveCount: room.moves.length,
      durationMs: 0,
      mode: room.difficulty ? 'solo' : 'pvp',
      difficulty: room.difficulty ?? '',
      moves: room.moves,
      evals: room.evals,
      createdAt: new Date().toISOString(),
    }
  }, [room])

  /** 复盘弹窗绑定局数：新对局自动关闭（open 由状态派生，无需 effect） */
  const [replayForRound, setReplayForRound] = useState<number | null>(null)

  /** 终局彩蛋：全屏表情雨 + 大字盖章（仅「从对局中打完」这一刻触发，重连进已结束房间不触发） */
  const [rain, setRain] = useState<{ key: number; win: boolean; label: string } | null>(null)
  const reduceMotion = useReducedMotion()
  const prevSigRef = useRef<string | null>(null)
  useEffect(() => {
    if (!room) return
    const sig = `${room.round}:${room.status}`
    const prev = prevSigRef.current
    prevSigRef.current = sig
    if (room.status !== 'ended' || prev === null || prev.endsWith(':ended')) return
    const iWon = !!myColor && room.winner === myColor
    const spectatingEnd = isSpectator && !!room.winner
    if (iWon) {
      setRain({ key: room.round, win: true, label: '胜' })
    } else if (spectatingEnd) {
      const wname = room.winner === 1 ? room.black?.name : room.white?.name
      setRain({ key: room.round, win: false, label: `${wname ?? (room.winner === 1 ? '黑方' : '白方')} 胜` })
    }
  }, [room, myColor, isSpectator])
  // 雨停：3.6s 后自动清理
  useEffect(() => {
    if (!rain) return
    const t = setTimeout(() => setRain(null), 3600)
    return () => clearTimeout(t)
  }, [rain])
  /** 雨滴参数：每次触发重新生成（纯渲染派生；全屏 44 枚） */
  const rainDrops = useMemo(() => {
    if (!rain) return []
    const pool = rain.win ? RAIN_EMOJIS_WIN : RAIN_EMOJIS
    return Array.from({ length: 44 }, () => ({
      emoji: pool[Math.floor(Math.random() * pool.length)],
      left: Math.random() * 96,
      delay: Math.random() * 0.7,
      duration: 1.7 + Math.random() * 1.3,
      drift: Math.round((Math.random() - 0.5) * 120),
      rot: Math.round((Math.random() - 0.5) * 280),
      size: 18 + Math.random() * 20,
    }))
  }, [rain])

  /** 开/关聊天面板时将当前消息标记为已读（事件驱动，无 effect） */
  const handleChatOpenChange = (open: boolean) => {
    setChatOpen(open)
    setSeenCount(room?.chat.length ?? 0)
  }

  /** 对手信息（座位玩家视角；观战者不展示交手记录） */
  const oppPid = useMemo(() => {
    if (!room || !myColor) return ''
    const seat = myColor === 1 ? room.white : room.black
    return seat?.playerId ?? ''
  }, [room, myColor])
  const oppName = useMemo(() => {
    if (!room || !myColor) return ''
    const seat = myColor === 1 ? room.white : room.black
    return seat?.name ?? ''
  }, [room, myColor])

  /** 交手记录：对手/局数/状态变化时重拉（终局后自动刷新战绩） */
  const [h2h, setH2h] = useState<H2H | null>(null)
  const h2hKey = `${oppPid}:${room?.round ?? 0}:${room?.status ?? ''}`
  useEffect(() => {
    if (!oppPid || !myId) return
    let alive = true
    fetch(`/api/matches/head2head?aPid=${encodeURIComponent(myId)}&bPid=${encodeURIComponent(oppPid)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.ok) return
        setH2h({
          total: Number(d.total ?? 0),
          myWins: Number(d.aWins ?? 0),
          oppWins: Number(d.bWins ?? 0),
          draws: Number(d.draws ?? 0),
          iWonLast: d.lastWinnerPid === myId,
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [myId, oppPid, h2hKey])

  if (!room) return null

  const replayOpen = replayForRound === room.round && !!inlineMatch
  const showResult = room.status === 'ended' && dismissedAtRound !== room.round
  const unread = chatOpen ? 0 : Math.max(0, room.chat.length - seenCount)
  const playing = room.status === 'playing'
  const myTurn = playing && !!myColor && room.turn === myColor
  const interactive = myTurn && connected && !isSpectator
  const blackSeatOff = !!room.black && !room.black.connected
  const whiteSeatOff = !!room.white && !room.white.connected
  const disconnecting = playing && (blackSeatOff || whiteSeatOff)
  const myStones = myColor ? room.board.filter((v) => v === myColor).length : 0
  const oppConnected = myColor === 1 ? !!room.white?.connected : !!room.black?.connected
  const hintsLeft = myColor === 1 ? room.hints?.black ?? 0 : myColor === 2 ? room.hints?.white ?? 0 : 0
  const myHint = room.hint && room.hint.color === myColor ? room.hint : null

  const iWon = !!room.winner && !!myColor && room.winner === myColor
  const isDraw = room.winner === 0
  const winnerName = room.winner === 1 ? room.black?.name : room.winner === 2 ? room.white?.name : null
  const myRematchKey = myColor === 1 ? 'black' : 'white'
  const myRematch = !!myColor && room.rematch[myRematchKey]
  const oppRematch = !!myColor && room.rematch[myColor === 1 ? 'white' : 'black']

  const copyInvite = async () => {
    const ok = await copyText(inviteText(room.code))
    toast({ description: ok ? '邀请已复制，发给微信好友即可' : '复制失败，请重试' })
  }

  const handleLeaveConfirm = () => {
    setLeaveOpen(false)
    gomoku.leaveRoom()
  }

  // ---------------- 子渲染 ----------------

  const header = (
    <header className="sticky top-0 z-20 border-b border-stone-100 bg-stone-50/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl text-stone-500 hover:bg-stone-100"
          aria-label="退出房间"
          onClick={() => (playing && myColor ? setLeaveOpen(true) : handleLeaveConfirm())}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex flex-1 items-center justify-center gap-2">
          <button
            onClick={copyInvite}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium tracking-[0.25em] text-stone-700 transition-colors hover:border-stone-400"
            title="复制邀请"
          >
            {room.code}
          </button>
          <span className="text-[11px] text-stone-400">
            {!connected ? '重连中…' : room.status === 'waiting' ? '等待加入' : playing ? `第 ${room.moveCount + 1} 手` : '已结束'}
          </span>
        </div>

        <div className="flex min-w-9 items-center justify-end gap-1 text-[11px] text-stone-400">
          <Eye className="h-3.5 w-3.5" />
          {room.spectatorCount}
        </div>
        {room.status !== 'waiting' && (
          <button
            onClick={() => void enterLandscape()}
            aria-label="横屏对局"
            title="横屏对局 · 全屏放大棋盘"
            className="flex h-8 items-center gap-1 rounded-xl px-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
          >
            <Maximize className="h-4 w-4" />
            <span className="hidden text-[11px] sm:inline">横屏</span>
          </button>
        )}
        <ThemeToggle className="h-8 w-8 border-transparent bg-transparent" />
      </div>
    </header>
  )

  if (room.status === 'waiting') {
    return (
      <div className="flex flex-1 flex-col">
        {header}
        <WaitingRoom room={room} onLeave={handleLeaveConfirm} />
        <ChatSheet
          open={chatOpen}
          onOpenChange={handleChatOpenChange}
          chat={room.chat}
          onSend={gomoku.sendChat}
          phase="waiting"
        />
      </div>
    )
  }

  const canControlDifficulty = !!room.difficulty && !!myColor && !isSpectator
  const seatCard = (seat: SeatPub | null, color: 1 | 2) => {
    const active = playing && room.turn === color
    const off = !!seat && !seat.connected
    const isMe = !!seat && seat.playerId === myId
    const streakN = seat && room.streak && room.streak.playerId === seat.playerId ? room.streak.count : 0
    const aiBadge = (trigger: React.ReactNode) => (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-60 rounded-2xl border-stone-200 p-1.5 shadow-[0_10px_36px_-12px_rgba(28,25,23,0.3)]">
          <p className="px-2.5 pb-1.5 pt-1 text-[10px] tracking-widest text-stone-400">AI 难度 · 即时生效</p>
          {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => {
            const Icon = DIFFICULTY_ICON[d]
            const current = room.difficulty === d
            return (
              <button
                key={d}
                onClick={() => gomoku.changeDifficulty(d)}
                disabled={current}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  current ? 'bg-stone-900 text-white' : 'hover:bg-stone-100'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${current ? 'text-stone-300' : 'text-stone-400'}`} />
                <span className="flex-1">
                  <span className={`block text-xs ${current ? 'text-white' : 'text-stone-700'}`}>
                    {DIFFICULTY_LABEL[d]}
                    {current && ' · 当前'}
                  </span>
                  <span className={`block text-[10px] ${current ? 'text-stone-400' : 'text-stone-400'}`}>
                    {DIFFICULTY_DESC[d]}
                  </span>
                </span>
                {current && <Check className="h-3.5 w-3.5 text-stone-300" />}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
    )
    return (
      <div
        className={`flex flex-1 items-center gap-2 rounded-2xl border p-2.5 transition-all duration-300 ${
          active ? 'seat-active-glow border-stone-900/70 bg-white' : 'border-stone-200/80 bg-white/55'
        } ${off ? 'opacity-55' : ''}`}
      >
        <StoneIcon color={color} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-stone-800">{seat?.name ?? '虚位以待'}</span>
            {seat && !seat.isAI && seat.playerId && <RankBadge pid={seat.playerId} />}
            {seat?.isAI &&
              (canControlDifficulty ? (
                aiBadge(
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`切换 AI 难度，当前${DIFFICULTY_LABEL[room.difficulty ?? 'normal']}`}
                    title="点击切换 AI 难度"
                    className="flex cursor-pointer items-center gap-0.5 rounded border border-stone-200 bg-stone-50 px-1 py-px text-[8px] leading-3 text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-800"
                  >
                    <Bot className="h-2.5 w-2.5" />
                    <span className="hidden sm:inline">AI</span>
                    <span className="hidden sm:inline">· {DIFFICULTY_LABEL[room.difficulty ?? 'normal']}</span>
                    <ChevronDown className="h-2.5 w-2.5" />
                  </span>
                )
              ) : (
                <span className="flex items-center gap-0.5 rounded border border-stone-200 bg-stone-50 px-1 py-px text-[8px] leading-3 text-stone-500">
                  <Bot className="h-2.5 w-2.5" />
                  <span className="hidden sm:inline">AI</span>
                  {room.difficulty && <span className="hidden sm:inline">· {DIFFICULTY_LABEL[room.difficulty]}</span>}
                </span>
              ))}
            {isMe && <span className="rounded bg-stone-900 px-1 py-px text-[8px] leading-3 text-white">你</span>}
            {off && <WifiOff className="h-3 w-3 text-rose-500" />}
            {streakN >= 2 && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                title={`房间内连胜 ${streakN} 局`}
                className="flex shrink-0 items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[8px] font-medium leading-3 text-amber-700"
              >
                <Flame className={`h-2.5 w-2.5 text-amber-500 ${streakN >= 5 ? 'animate-pulse' : ''}`} />
                {streakN}
                <span className="hidden sm:inline">连胜</span>
              </motion.span>
            )}
          </div>
          <span className={`text-[10px] ${active ? 'text-stone-700' : 'text-stone-400'}`}>
            {off ? '连接断开' : active ? '正在落子' : color === 1 ? '执黑' : '执白'}
          </span>
        </div>
        {active && !off ? (
          <TurnTimer
            deadline={room.deadline}
            serverTime={room.serverTime}
            receivedAt={room.receivedAt}
            tickSound={!!myColor && active && room.turn === myColor}
          />
        ) : (
          <span className="hidden w-[30px] sm:block" />
        )}
        <span className="hidden w-7 shrink-0 text-right text-xs tabular-nums text-stone-500 sm:inline">
          {room.scores[color === 1 ? 'black' : 'white']}胜
        </span>
      </div>
    )
  }

  const undoBanner = () => {
    if (!room.undoReq) return null
    if (isSpectator) {
      return (
        <Banner key="undo-spec" tone="info">
          {room.undoReq === 1 ? '黑方' : '白方'}请求悔棋，等待对方回应…
        </Banner>
      )
    }
    if (room.undoReq === myColor) {
      return <Banner key="undo-self">已发出悔棋请求，等待对方回应（可直接落子取消）…</Banner>
    }
    return (
      <Banner key="undo-req" tone="warn">
        <span className="flex-1">对方请求悔一步棋，是否同意？</span>
        <Button size="sm" variant="outline" className="h-7 rounded-lg px-3 text-xs transition-all active:scale-[0.96]" onClick={gomoku.rejectUndo}>
          拒绝
        </Button>
        <Button size="sm" className="h-7 rounded-lg bg-stone-900 px-3 text-xs transition-all enabled:hover:-translate-y-px enabled:hover:bg-stone-700 active:translate-y-0 active:scale-[0.96]" onClick={gomoku.acceptUndo}>
          同意
        </Button>
      </Banner>
    )
  }

  // ---------------- 竖屏/横屏共用片段（单一来源） ----------------

  const statusText = !connected
    ? '连接中断，正在重连…'
    : playing
      ? isSpectator
        ? '观战中'
        : myTurn
          ? room.undoReq === myColor
            ? '等待对方回应悔棋请求'
            : '轮到你落子 ♟'
          : `等待 ${(room.turn === 1 ? room.black?.name : room.white?.name) ?? '对方'} 落子…`
      : room.status === 'ended'
        ? isSpectator
          ? '对局已结束'
          : myRematch
            ? '已同意再战，等待对方…'
            : oppRematch
              ? '对方想再来一局！'
              : '对局已结束'
        : '等待好友加入'

  const disconnectBannerEl = disconnecting ? (
    <Banner key="disconnect" tone="warn">
      <WifiOff className="h-3.5 w-3.5" />
      <span className="flex-1">
        {(blackSeatOff ? room.black?.name : room.white?.name) ?? '对方'} 连接断开，超时将判负
      </span>
      <TurnTimer deadline={room.disconnDeadline} serverTime={room.serverTime} receivedAt={room.receivedAt} size={26} />
    </Banner>
  ) : null

  const hintBannerEl = !disconnecting && myHint ? (
    <Banner key={`hint-${room.round}-${myHint.index}-${myHint.kind}`} tone="hint">
      <Lightbulb className="h-3.5 w-3.5" />
      <span className="flex-1">
        {HINT_TEXT[myHint.kind]} {coordText(myHint.index)}
        {myHint.kind === 'win' ? ' · 落此即五连！' : myHint.kind === 'block' ? ' · 对方在此成五，须封堵' : ' · 攻防均衡之选'}
      </span>
    </Banner>
  ) : null

  const specBannerEl = isSpectator && playing ? <Banner key="spectate">观战模式 · 可查看棋局与聊天</Banner> : null

  /** 横屏模式下的浮动横幅（优先级：断线 > 提示 > 悔棋 > 观战） */
  const activeBanner = disconnecting ? disconnectBannerEl : myHint ? hintBannerEl : room.undoReq ? undoBanner() : specBannerEl

  const numberedToggle = (
    <button
      onClick={() => setNumbered((v) => !v)}
      aria-pressed={numbered}
      title={numbered ? '隐藏手数标注' : '显示手数标注'}
      className={`absolute right-2 top-2 z-10 flex h-7 items-center gap-1 rounded-lg border px-2 text-[10px] backdrop-blur transition-all duration-200 ${
        numbered
          ? 'border-stone-900/70 bg-stone-900 text-white shadow-[0_2px_8px_rgba(28,25,23,0.3)]'
          : 'border-stone-200/80 bg-white/75 text-stone-500 hover:border-stone-400 hover:text-stone-800'
      } active:scale-95`}
    >
      <Hash className="h-3 w-3" />
      手数
    </button>
  )

  const reactionLayer = (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 24, scale: 0.5, x: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -240,
              scale: [0.5, 1.2, 1.1, 1],
              x: r.dx,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 2.5,
              ease: 'easeOut',
              opacity: { duration: 2.5, times: [0, 0.12, 0.68, 1] },
            }}
            className="absolute bottom-4 flex flex-col items-center gap-0.5"
            style={{ left: `${r.color === 1 ? 20 : r.color === 2 ? 64 : 42}%` }}
          >
            <span className="text-[30px] leading-none drop-shadow-[0_2px_6px_rgba(28,25,23,0.28)]">
              {r.emoji}
            </span>
            {r.color === 0 ? (
              /* 观战者：墨色胶囊区分身份 */
              <span className="rounded-full bg-stone-900/85 px-1.5 py-px text-[9px] text-stone-100 shadow-sm ring-1 ring-white/20">
                {r.from}
              </span>
            ) : (
              <span className="rounded-full border border-stone-100 bg-white/85 px-1.5 py-px text-[9px] text-stone-500 shadow-sm">
                {r.from}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )

  const emojiPopover = (side: 'top' | 'left' = 'top') => (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="发表情弹幕"
          title="发表情弹幕"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition-all duration-200 hover:-translate-y-px hover:border-stone-400 hover:text-stone-800 hover:shadow-[0_3px_8px_rgba(28,25,23,0.1)] active:translate-y-0 active:scale-95"
        >
          <Smile className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align="end" className="w-auto rounded-2xl border-stone-200 p-2 shadow-[0_8px_30px_-10px_rgba(28,25,23,0.25)]">
        <p className="mb-1 px-1 text-[10px] tracking-widest text-stone-400">表情弹幕 · 全场可见</p>
        <div className="grid grid-cols-4 gap-1">
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => gomoku.sendReaction(e)}
              aria-label={`发送表情 ${e}`}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl transition-all duration-150 hover:scale-110 hover:bg-stone-100 active:scale-90"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const boardEl = (fill: boolean) => (
    <GameBoard
      board={room.board}
      myColor={myColor}
      interactive={interactive}
      winLine={room.winLine}
      lastMove={room.lastMove}
      hint={myHint}
      numbered={numbered}
      moves={room.moves}
      onPlay={gomoku.move}
      fill={fill}
    />
  )

  // ---------------- 横屏对局布局 ----------------

  /** 横屏紧凑座位卡（纵向排布：棋子/昵称/状态/计时） */
  const compactSeat = (seat: SeatPub | null, color: 1 | 2) => {
    const active = playing && room.turn === color
    const off = !!seat && !seat.connected
    const isMe = !!seat && seat.playerId === myId
    const streakN = seat && room.streak && room.streak.playerId === seat.playerId ? room.streak.count : 0
    return (
      <div
        className={`flex flex-col items-center gap-1 rounded-2xl border p-2 transition-all duration-300 ${
          active ? 'seat-active-glow border-stone-900/70 bg-white' : 'border-stone-200/80 bg-white/55'
        } ${off ? 'opacity-55' : ''}`}
      >
        <StoneIcon color={color} size={22} />
        <span className="w-full truncate text-center text-[11px] font-medium text-stone-800">{seat?.name ?? '虚位以待'}</span>
        <span className="flex flex-wrap items-center justify-center gap-1">
          {isMe && <span className="rounded bg-stone-900 px-1 text-[8px] leading-3 text-white">你</span>}
          {off && <WifiOff className="h-3 w-3 text-rose-500" />}
          {streakN >= 2 && (
            <span
              title={`房间内连胜 ${streakN} 局`}
              className="flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1 text-[8px] font-medium leading-3 text-amber-700"
            >
              <Flame className={`h-2.5 w-2.5 text-amber-500 ${streakN >= 5 ? 'animate-pulse' : ''}`} />
              {streakN}
            </span>
          )}
        </span>
        <span className={`text-[9px] ${active ? 'text-stone-700' : 'text-stone-400'}`}>
          {off ? '连接断开' : active ? '正在落子' : color === 1 ? '执黑' : '执白'}
        </span>
        {active && !off && (
          <TurnTimer
            deadline={room.deadline}
            serverTime={room.serverTime}
            receivedAt={room.receivedAt}
            size={22}
            tickSound={!!myColor && room.turn === myColor}
          />
        )}
      </div>
    )
  }

  /** 横屏右列小按钮（横向排布 icon+文字，省高度） */
  const landBtn = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    opts?: { disabled?: boolean; badge?: number; active?: boolean; strong?: boolean }
  ) => (
    <button
      onClick={onClick}
      disabled={opts?.disabled}
      className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-xl border px-2 text-[10px] transition-all duration-150 ${
        opts?.strong
          ? 'border-stone-900/80 bg-stone-900 text-white enabled:hover:bg-stone-700 active:scale-[0.97]'
          : opts?.disabled
            ? 'border-stone-100 bg-white/40 text-stone-300'
            : opts?.active
              ? 'border-stone-900/70 bg-white text-stone-900 shadow-[0_1px_6px_rgba(28,25,23,0.08)]'
              : 'border-stone-200 bg-white text-stone-600 enabled:hover:border-stone-400 enabled:hover:bg-stone-50 active:scale-[0.97]'
      }`}
    >
      {icon}
      {label}
      {!!opts?.badge && opts.badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-0.5 text-[8px] text-white">
          {opts.badge > 9 ? '9+' : opts.badge}
        </span>
      )}
    </button>
  )

  const landscapeView = landActive ? (
    <div
      role="dialog"
      aria-label="横屏对局模式"
      className={`fixed z-[30] flex bg-background text-foreground ${
        landMode === 'css' ? 'gomoku-landscape-css' : 'inset-0'
      }`}
    >
      {/* 左列：黑方座位 + 房间信息 */}
      <aside className="flex h-full w-24 shrink-0 flex-col gap-2 border-r border-stone-100 p-2 sm:w-32">
        {compactSeat(room.black, 1)}
        <div className="mt-auto flex flex-col items-center gap-1 text-center">
          <button
            onClick={copyInvite}
            title="复制邀请"
            className="rounded-lg border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-[0.2em] text-stone-600 transition-colors hover:border-stone-400"
          >
            {room.code}
          </button>
          <span className="text-[10px] text-stone-400">{playing ? `第 ${room.moveCount + 1} 手` : '已结束'}</span>
          <p className="text-[10px] leading-4 text-stone-500" aria-live="polite">
            {statusText}
          </p>
          <button
            onClick={() => (playing && myColor ? setLeaveOpen(true) : handleLeaveConfirm())}
            aria-label="离开房间"
            title={playing && myColor ? '离开房间（对局中将视为认输）' : '关闭房间回大厅'}
            className="mt-1 flex h-8 w-full items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white text-[10px] text-stone-500 transition-colors hover:border-rose-300 hover:text-rose-600"
          >
            <LogOut className="h-3.5 w-3.5" />
            离开
          </button>
        </div>
      </aside>

      {/* 中央：满高棋盘（正方形容器随高度撑满，宽屏下棋盘最大化） */}
      <main className="relative flex h-full min-w-0 flex-1 items-center justify-center p-1">
        {activeBanner && (
          <div className="absolute left-1/2 top-2 z-20 w-[92%] max-w-md -translate-x-1/2">{activeBanner}</div>
        )}
        <div className="relative flex h-full max-w-full items-center justify-center" style={{ aspectRatio: '1 / 1' }}>
          {boardEl(true)}
          {numberedToggle}
          {reactionLayer}
        </div>
      </main>

      {/* 右列：白方座位 + 竖排控制 */}
      <aside className="flex h-full w-24 shrink-0 flex-col gap-1.5 border-l border-stone-100 p-2 sm:w-32">
        {compactSeat(room.white, 2)}
        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-1 overflow-y-auto pt-1">
          {playing && myColor && (
            <>
              {landBtn(<Undo2 className="h-3.5 w-3.5" />, '悔棋', gomoku.requestUndo, {
                disabled: !myTurn || myStones === 0 || !oppConnected || !!room.undoReq,
              })}
              {landBtn(<Lightbulb className="h-3.5 w-3.5" />, `提示 ${hintsLeft}`, gomoku.requestHint, {
                disabled: !myTurn || hintsLeft <= 0 || !!room.undoReq,
              })}
              {landBtn(<Flag className="h-3.5 w-3.5" />, '认输', () => setResignOpen(true))}
            </>
          )}
          {room.status === 'ended' && myColor && (
            <>
              {landBtn(<Swords className="h-3.5 w-3.5" />, myRematch ? '等待中' : '再战', gomoku.toggleRematch, {
                disabled: myRematch,
                active: myRematch || oppRematch,
              })}
              {landBtn(<Eye className="h-3.5 w-3.5" />, '复盘', () => setReplayForRound(room.round), { disabled: !inlineMatch })}
            </>
          )}
          {landBtn(muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />, muted ? '静音' : '声音', () => toggleMuted())}
          {landBtn(<MessageCircle className="h-3.5 w-3.5" />, '聊天', () => setChatOpen(true), { badge: unread })}
          <div className="flex shrink-0 justify-end">{emojiPopover('left')}</div>
          {landBtn(<Hash className="h-3.5 w-3.5" />, '手数', () => setNumbered((v) => !v), { active: numbered })}
          {landBtn(<Shrink className="h-3.5 w-3.5" />, '退出横屏', () => exitLandscape(), { strong: true })}
        </div>
      </aside>
    </div>
  ) : null

  return (
    <div className="flex flex-1 flex-col">
      {landActive ? (
        landscapeView
      ) : (
        <>
      {header}

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-6 pt-4">
        {/* 双方信息 */}
        <div className="flex items-stretch gap-2">
          {seatCard(room.black, 1)}
          <div className="flex w-8 flex-col items-center justify-center gap-1 text-stone-300">
            <span className="text-[10px] font-light">VS</span>
          </div>
          {seatCard(room.white, 2)}
        </div>

        {/* 历史交手记录（座位玩家视角） */}
        <AnimatePresence initial={false}>
          {!isSpectator && h2h && (
            <motion.div
              key={`h2h-${oppPid}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex items-center justify-center gap-2 text-[11px] text-stone-400"
            >
              <Swords className="h-3 w-3 text-stone-300" />
              {h2h.total === 0 ? (
                <span>
                  与 <span className="text-stone-600">{oppName || '对手'}</span> 首次交手 · 祝好运 ♟
                </span>
              ) : (
                <span className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
                  <span>
                    历史交锋 <span className="font-medium tabular-nums text-stone-600">{h2h.total}</span>
                  </span>
                  <span className="text-stone-200">·</span>
                  <span>
                    你 <span className="font-medium tabular-nums text-stone-700">{h2h.myWins}</span> 胜
                  </span>
                  <span className="text-stone-200">·</span>
                  <span>
                    {oppName || '对方'} <span className="tabular-nums">{h2h.oppWins}</span> 胜
                  </span>
                  {h2h.draws > 0 && (
                    <>
                      <span className="text-stone-200">·</span>
                      <span className="tabular-nums">{h2h.draws} 和</span>
                    </>
                  )}
                  {h2h.total > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-px text-[9px] leading-3 ${
                        h2h.iWonLast ? 'bg-stone-900 text-stone-50' : 'border border-stone-200 bg-white text-stone-400'
                      }`}
                    >
                      {h2h.iWonLast ? '上局你赢' : '上局对方赢'}
                    </span>
                  )}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 观战视角：实时局势评估条 */}
        {isSpectator && !!room.evals && room.evals.length > 0 && (
          <EvalBar evals={room.evals} status={playing ? 'playing' : room.status === 'ended' ? 'ended' : 'waiting'} />
        )}

        {/* 提示条（进出带动画） */}
        <AnimatePresence initial={false}>
          {disconnecting && disconnectBannerEl}
          {!disconnecting && myHint && hintBannerEl}
          {!disconnecting && !myHint && undoBanner()}
          {isSpectator && playing && specBannerEl}
        </AnimatePresence>

        {/* 棋盘（含手数标注开关与表情弹幕层） */}
        <div className="relative mx-auto w-full max-w-[560px]">
          {boardEl(false)}
          {numberedToggle}
          {reactionLayer}
        </div>

        {/* 观战快捷表情条：一排常驻 emoji，点即发弹幕（带 650ms 冷却反馈） */}
        {isSpectator && playing && (
          <SpectatorReactionStrip onSend={gomoku.sendReaction} />
        )}

        {/* 我的状态提示 + 表情弹幕入口 */}
        <div className="relative flex items-center justify-center px-9">
          <p className="text-center text-xs text-stone-400" aria-live="polite">
            {statusText}
          </p>
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            {emojiPopover('top')}
          </div>
        </div>

        {/* 控制按钮 */}
        <div className={`mt-1 grid gap-1.5 ${playing && myColor ? 'grid-cols-6' : 'grid-cols-5'}`}>
          {playing && myColor && (
            <>
              <CtrlBtn
                icon={<Undo2 className="h-4 w-4" />}
                label="悔棋"
                disabled={!myTurn || myStones === 0 || !oppConnected || !!room.undoReq}
                onClick={gomoku.requestUndo}
              />
              <CtrlBtn
                icon={<Lightbulb className="h-4 w-4" />}
                label={`提示 ${hintsLeft}`}
                disabled={!myTurn || hintsLeft <= 0 || !!room.undoReq}
                onClick={gomoku.requestHint}
              />
              <CtrlBtn icon={<Flag className="h-4 w-4" />} label="认输" onClick={() => setResignOpen(true)} />
            </>
          )}
          {room.status === 'ended' && myColor && (
            <>
              <CtrlBtn
                icon={<Swords className="h-4 w-4" />}
                label={myRematch ? '等待中' : '再战'}
                disabled={myRematch}
                active={myRematch || oppRematch}
                onClick={gomoku.toggleRematch}
              />
              <CtrlBtn
                icon={<Eye className="h-4 w-4" />}
                label="复盘"
                disabled={!inlineMatch}
                onClick={() => setReplayForRound(room.round)}
              />
            </>
          )}
          <CtrlBtn
            icon={muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            label={muted ? '静音' : '声音'}
            onClick={() => toggleMuted()}
          />
          <CtrlBtn
            icon={<MessageCircle className="h-4 w-4" />}
            label="聊天"
            badge={unread}
            onClick={() => setChatOpen(true)}
          />
          <CtrlBtn icon={<Copy className="h-4 w-4" />} label="邀请" onClick={copyInvite} />
        </div>
      </div>
        </>
      )}

      {/* 认输确认 */}
      <AlertDialog open={resignOpen} onOpenChange={setResignOpen}>
        <AlertDialogContent className="max-w-xs rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-normal">确认认输？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-stone-500">本局将判负，比分保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl border-stone-200">再想想</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-stone-900 hover:bg-stone-700"
              onClick={() => {
                setResignOpen(false)
                gomoku.resign()
              }}
            >
              认输
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 离开确认（对局中视为认输） */}
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent className="max-w-xs rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-normal">离开房间？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-stone-500">对局尚未结束，离开将视为认输。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl border-stone-200">继续对局</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-stone-900 hover:bg-stone-700" onClick={handleLeaveConfirm}>
              离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 结果弹窗：open 由状态派生，dismission 记在当前局数上 */}
      <ResultDialog
        open={showResult}
        onDismiss={() => setDismissedAtRound(room.round)}
        onReplay={() => setReplayForRound(room.round)}
        replayReady={!!inlineMatch}
        room={room}
        iWon={iWon}
        isDraw={isDraw}
        isSpectator={isSpectator}
        winnerName={winnerName}
        myRematch={myRematch}
        oppRematch={oppRematch}
        onRematch={gomoku.toggleRematch}
      />

      <ChatSheet open={chatOpen} onOpenChange={handleChatOpenChange} chat={room.chat} onSend={gomoku.sendChat} phase={room.status === 'ended' ? 'ended' : 'playing'} />

      {/* 房内复盘：直接用房间 moves，无需请求；key 绑局数，新对局自动重置 */}
      <ReplaySheet
        key={`room-replay-${room.round}`}
        matchId={null}
        inlineMatch={replayOpen ? inlineMatch : null}
        open={replayOpen}
        onOpenChange={(v) => !v && setReplayForRound(null)}
      />

      {/* 终局全屏彩蛋：表情雨 + 大字盖章（reduced-motion 用户跳过动画） */}
      <AnimatePresence>
        {rain && !reduceMotion && (
          <motion.div
            key={rain.key}
            className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            aria-hidden
          >
            {rainDrops.map((d, i) => (
              <motion.span
                key={i}
                className="absolute top-0 select-none leading-none"
                style={{ left: `${d.left}%`, fontSize: d.size }}
                initial={{ y: '-8vh', x: 0, rotate: 0, opacity: 0 }}
                animate={{ y: '108vh', x: d.drift, rotate: d.rot, opacity: [0, 1, 1, 0.85, 0] }}
                transition={{
                  duration: d.duration,
                  delay: d.delay,
                  ease: 'easeIn',
                  opacity: { duration: d.duration, times: [0, 0.08, 0.62, 0.85, 1] },
                }}
              >
                {d.emoji}
              </motion.span>
            ))}

            {/* 中央盖章 */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                initial={{ scale: 2.4, opacity: 0, rotate: -16 }}
                animate={{ scale: 1, opacity: 1, rotate: -7 }}
                exit={{ scale: 1.12, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 210, damping: 17, delay: 0.12 }}
                className="flex flex-col items-center gap-2.5"
              >
                <span
                  className={`rounded-2xl border-[3px] px-6 py-2 backdrop-blur-[2px] ${
                    rain.win ? 'border-rose-600/80 text-rose-600' : 'border-stone-800/75 text-stone-800'
                  }`}
                  style={{
                    fontSize: 64,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    lineHeight: 1.05,
                    textShadow: '0 2px 18px rgba(28,25,23,0.18)',
                    boxShadow: '0 10px 44px -12px rgba(28,25,23,0.35)',
                    background: 'rgba(255,255,255,0.74)',
                  }}
                >
                  {rain.label}
                </span>
                <motion.span
                  className="rounded-full bg-stone-900/85 px-3.5 py-1 text-[11px] tracking-[0.3em] text-stone-100"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.42 }}
                >
                  五子连珠
                </motion.span>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------- 小组件 ----------------

function Banner({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'hint' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
        tone === 'warn'
          ? 'border-amber-200 bg-amber-50/70 text-amber-800'
          : tone === 'hint'
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
            : 'border-stone-200 bg-white/70 text-stone-500'
      }`}
    >
      {children}
    </motion.div>
  )
}

/** 观战快捷表情条：常驻一排 emoji，点击即发弹幕（650ms 冷却，与服务端限频一致） */
function SpectatorReactionStrip({ onSend }: { onSend: (emoji: string) => void }) {
  const [coolUntil, setCoolUntil] = useState(0)
  const [cooling, setCooling] = useState(false)
  useEffect(() => {
    if (!cooling) return
    const left = Math.max(0, coolUntil - Date.now())
    const t = setTimeout(() => setCooling(false), left + 30)
    return () => clearTimeout(t)
  }, [cooling, coolUntil])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex items-center justify-center gap-1"
      role="toolbar"
      aria-label="观战快捷表情"
    >
      <span className="mr-1 text-[10px] tracking-widest text-stone-300">快评</span>
      {REACTION_EMOJIS.map((e) => {
        const dim = cooling
        return (
          <button
            key={e}
            disabled={dim}
            aria-label={`发送表情 ${e}`}
            title={dim ? '稍等片刻…' : `发个 ${e}`}
            onClick={() => {
              if (cooling) return
              setCoolUntil(Date.now() + 650)
              setCooling(true)
              onSend(e)
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-full border border-stone-200/80 bg-white/80 text-base transition-all duration-150 ${
              dim ? 'scale-90 opacity-40' : 'hover:-translate-y-0.5 hover:scale-110 hover:border-stone-400 hover:shadow-[0_3px_8px_rgba(28,25,23,0.12)] active:scale-95'
            }`}
          >
            {e}
          </button>
        )
      })}
    </motion.div>
  )
}

function CtrlBtn({
  icon,
  label,
  onClick,
  disabled,
  badge,
  active,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  badge?: number
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex h-[62px] flex-col items-center justify-center gap-1 rounded-2xl border text-[10px] transition-all duration-200 ${
        disabled
          ? 'border-stone-100 bg-white/40 text-stone-300'
          : active
            ? 'border-stone-900/70 bg-white text-stone-900 shadow-[0_1px_6px_rgba(28,25,23,0.08)] enabled:hover:-translate-y-px enabled:hover:shadow-[0_3px_10px_rgba(28,25,23,0.12)] active:translate-y-0 active:scale-[0.96]'
            : 'border-stone-200 bg-white text-stone-600 enabled:hover:-translate-y-px enabled:hover:border-stone-400 enabled:hover:bg-stone-50 enabled:hover:shadow-[0_3px_10px_rgba(28,25,23,0.1)] active:translate-y-0 active:scale-[0.96]'
      }`}
    >
      {icon}
      {label}
      {!!badge && badge > 0 && (
        <span className="absolute right-2 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

/**
 * 结果弹窗：open 由父组件按对局状态派生；
 * dismissed 内部状态 + key 重挂载实现「新对局自动弹出」
 */
function ResultDialog({
  open,
  onDismiss,
  onReplay,
  replayReady,
  room,
  iWon,
  isDraw,
  isSpectator,
  winnerName,
  myRematch,
  oppRematch,
  onRematch,
}: {
  open: boolean
  onDismiss: () => void
  onReplay: () => void
  replayReady: boolean
  room: RoomState
  iWon: boolean
  isDraw: boolean
  isSpectator: boolean
  winnerName?: string | null
  myRematch: boolean
  oppRematch: boolean
  onRematch: () => void
}) {
  const big = isDraw ? '和' : iWon ? '胜' : isSpectator ? '终' : '负'

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onDismiss()}>
      <SheetContent
        side="bottom"
        className="mx-auto rounded-t-3xl border-stone-200 px-6 pb-10 pt-4 shadow-[0_-8px_40px_-12px_rgba(28,25,23,0.2)] sm:max-w-md sm:left-0 sm:right-0 sm:rounded-3xl [&>button]:hidden"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">对局结果</SheetTitle>
          <SheetDescription className="sr-only">本局胜负与双方比分，可选择换边再战或复盘棋局</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col items-center gap-1 text-center">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.06 }}
            className={`text-7xl font-extralight ${isDraw ? 'text-stone-500' : iWon ? 'text-stone-900' : 'text-stone-400'}`}
          >
            {big}
          </motion.span>
          <p className="mt-2 text-sm text-stone-700">
            {isDraw
              ? '满盘皆子，握手言和'
              : `${room.winner === 1 ? '黑方' : '白方'} · ${winnerName ?? ''} 胜 · ${REASON_TEXT[room.endReason] ?? ''}`}
          </p>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-stone-100 bg-white px-5 py-2.5 text-sm shadow-[0_1px_2px_rgba(28,25,23,0.04),0_6px_20px_-8px_rgba(28,25,23,0.12)]">
            <span className="flex items-center gap-1.5">
              <StoneIcon color={1} size={14} />
              {room.black?.name}
            </span>
            <span className="text-lg font-light tabular-nums">
              {room.scores.black} : {room.scores.white}
            </span>
            <span className="flex items-center gap-1.5">
              {room.white?.name}
              <StoneIcon color={2} size={14} />
            </span>
          </div>
          <p className="mt-1 text-[11px] text-stone-400">共 {room.moveCount} 手 · 房间 {room.code}</p>

          <div className="mt-4 flex w-full max-w-60 items-center gap-2">
            {!isSpectator && (
              <Button
                onClick={onRematch}
                disabled={myRematch}
                className="h-11 flex-1 rounded-xl bg-stone-900 text-sm tracking-widest transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:bg-stone-700 enabled:hover:shadow-[0_8px_20px_-8px_rgba(28,25,23,0.4)] active:translate-y-0 active:scale-[0.98]"
              >
                {myRematch ? '已同意，等待对方…' : oppRematch ? '对方已就绪 · 再战' : '再来一局（换边）'}
              </Button>
            )}
            {isSpectator && (
              <Button
                onClick={onDismiss}
                className="h-11 flex-1 rounded-xl bg-stone-900 text-sm tracking-widest transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:bg-stone-700 active:translate-y-0 active:scale-[0.98]"
              >
                查看终局
              </Button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-4">
            {replayReady && (
              <button
                onClick={onReplay}
                className="flex items-center gap-1 text-xs text-stone-400 underline-offset-4 transition-colors hover:text-stone-600 hover:underline"
              >
                <Eye className="h-3.5 w-3.5" />
                复盘棋局
              </button>
            )}
            {!isSpectator && (
              <button
                onClick={onDismiss}
                className="text-xs text-stone-400 underline-offset-4 transition-colors hover:text-stone-600 hover:underline"
              >
                查看终局
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ChatSheet({
  open,
  onOpenChange,
  chat,
  onSend,
  phase,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chat: RoomState['chat']
  onSend: (text: string) => void
  phase: ChatPhase
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[70vh] rounded-t-3xl border-stone-200 p-0 shadow-[0_-8px_40px_-12px_rgba(28,25,23,0.2)] [&>button]:hidden">
        <SheetHeader className="border-b border-stone-100 px-4 py-3">
          <SheetTitle className="text-center text-sm font-normal tracking-widest text-stone-500">对局聊天</SheetTitle>
          <SheetDescription className="sr-only">与对局好友实时聊天，可使用快捷短语</SheetDescription>
        </SheetHeader>
        <div className="h-[calc(70vh-53px)]">
          <ChatPanel chat={chat} onSend={onSend} phase={phase} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
