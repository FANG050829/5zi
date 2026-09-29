'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomState, Difficulty, RoomPeek, type Reaction } from './types'
import { playNotify, playStone, playWin, playLose, playChat, playKnock, playJoin, playHintChime } from './sounds'
import { useToast } from '@/hooks/use-toast'
import type { AiModelConfig } from './ai-config'

const LS_NAME = 'gomoku-name'
const LS_PID = 'gomoku-pid'
const LS_ROOM = 'gomoku-room'

const POLL_MS = 1300 // 房间状态轮询间隔
const PRESENCE_MS = 4000 // 大厅在线人数轮询间隔

/** 表情弹幕白名单（与服务端保持一致） */
export const REACTION_EMOJIS = ['👏', '😂', '🤔', '😱', '😅', '🔥', '👍', '😮'] as const

export function getMyId(): string {
  if (typeof window === 'undefined') return ''
  let pid = localStorage.getItem(LS_PID)
  if (!pid) {
    pid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    localStorage.setItem(LS_PID, pid)
  }
  return pid
}

export function getSavedName(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(LS_NAME) ?? ''
}

export function saveName(name: string) {
  try {
    localStorage.setItem(LS_NAME, name)
  } catch {}
}

function getSavedRoom(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(LS_ROOM)
}

export function clearSavedRoom() {
  try {
    localStorage.removeItem(LS_ROOM)
  } catch {}
}

export function saveRoom(code: string) {
  try {
    localStorage.setItem(LS_ROOM, code)
  } catch {}
}

export type Phase = 'connecting' | 'lobby' | 'room'

export function useGomoku() {
  const { toast } = useToast()
  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingRoomCode, setPendingRoomCode] = useState<string | null>(null) // 通过链接 ?room= 进来
  const [online, setOnline] = useState(0) // 全服在线人数（大厅展示）
  const [reactions, setReactions] = useState<Reaction[]>([]) // 表情弹幕（瞬时，自动过期）
  const [activeCode, setActiveCode] = useState<string | null>(null) // 当前轮询的房间

  const pendingJoin = useRef<string | null>(null)
  const prevStatus = useRef<string | null>(null)
  const prevChatLen = useRef(0)
  const prevMoveCount = useRef(0)
  const prevUndoReq = useRef<number | null>(null)
  const prevHintKey = useRef('')
  const prevRound = useRef(0)
  const leftCode = useRef<string | null>(null) // 主动退出的房间号，忽略其后续状态
  const lastSentReactAt = useRef(0) // 表情弹幕客户端限频
  const lastReactionTs = useRef(0) // 服务端弹幕差量水位
  const failCount = useRef(0) // 连续失败计数（连接状态）
  const activeCodeRef = useRef<string | null>(null)
  activeCodeRef.current = activeCode

  // 音效：落子 / 胜负 / 提示 / 聊天 / 悔棋请求 / 开局
  useEffect(() => {
    if (!room) return
    if (room.moveCount > prevMoveCount.current) playStone()
    prevMoveCount.current = room.moveCount
    if (prevStatus.current && prevStatus.current !== 'ended' && room.status === 'ended') {
      const myColor = room.black?.playerId === getMyId() ? 1 : room.white?.playerId === getMyId() ? 2 : null
      if (room.winner && myColor && room.winner === myColor) playWin()
      else if (room.winner) playLose()
    }
    prevStatus.current = room.status
    if (room.chat.length > prevChatLen.current && prevChatLen.current > 0) {
      const last = room.chat[room.chat.length - 1]
      if (last && last.color !== 0) playChat()
      else if (last?.color === 0 && /悔棋|再来|断开|回归|加入|开始|离开|开局|接管/.test(last.text)) playNotify()
    }
    prevChatLen.current = room.chat.length
    // 悔棋/再战请求出现（对己方相关时响两下敲击）
    if (room.undoReq && !prevUndoReq.current) playKnock()
    prevUndoReq.current = room.undoReq
    // 新一局开始（再战/好友入座开局）
    if (room.round > prevRound.current && prevRound.current >= 0 && prevStatus.current !== null) playJoin()
    prevRound.current = room.round
    // 提示揭示（仅自己请求的提示响铃）
    const myId = getMyId()
    const hintKey = room.hint ? `${room.round}:${room.hint.index}:${room.hint.kind}` : ''
    if (room.hint && hintKey !== prevHintKey.current) {
      const mine =
        (room.hint.color === 1 && room.black?.playerId === myId) ||
        (room.hint.color === 2 && room.white?.playerId === myId)
      if (mine) playHintChime()
    }
    prevHintKey.current = hintKey
  }, [room])

  /** 应用服务端房间状态 + 弹幕差量 */
  const applyState = useCallback((state: RoomState) => {
    if (leftCode.current === state.code) return // 已主动退出的房间，忽略残留状态
    state.receivedAt = Date.now()
    setRoom(state)
    setPhase('room')
    if (state.code) saveRoom(state.code)
    for (const r of state.recentReactions ?? []) {
      if (r.ts <= lastReactionTs.current) continue
      lastReactionTs.current = r.ts
      const item: Reaction = {
        id: `${r.ts}-${Math.random().toString(36).slice(2, 8)}`,
        emoji: String(r.emoji ?? ''),
        from: String(r.from ?? ''),
        color: Number(r.color ?? 0),
        ts: Number(r.ts ?? Date.now()),
        dx: Math.round(Math.random() * 44 - 22), // 横向抖动 -22~22px
      }
      setReactions((prev) => [...prev.slice(-11), item])
      setTimeout(() => {
        setReactions((prev) => prev.filter((x) => x.id !== item.id))
      }, 2600)
    }
  }, [])

  /** 房间状态轮询（替代 socket 推送；首跳兼作断线检测与老玩家回归） */
  useEffect(() => {
    if (!activeCode) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/gomoku?code=${encodeURIComponent(activeCode)}&pid=${encodeURIComponent(getMyId())}&name=${encodeURIComponent(getSavedName())}`,
          { cache: 'no-store' }
        )
        const data = await res.json()
        if (!alive) return
        failCount.current = 0
        setConnected(true)
        if (data?.ok && data.state) {
          applyState(data.state)
        } else {
          // 房间已解散/过期：静默清理，回到大厅
          if (leftCode.current !== activeCode) {
            clearSavedRoom()
            setRoom(null)
            setPhase('lobby')
            toast({ title: '房间已解散', description: '房间不存在或已回收', variant: 'destructive' })
          }
          leftCode.current = null
          setActiveCode(null)
          return
        }
      } catch {
        if (!alive) return
        failCount.current += 1
        if (failCount.current >= 3) setConnected(false)
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS)
      }
    }
    tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [activeCode, applyState, toast])

  // 大厅在线人数轮询（房内由房间轮询兼任心跳；首跳完成后解除 connecting 骨架屏）
  useEffect(() => {
    if (activeCode) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = true
    const tick = async () => {
      try {
        const res = await fetch(`/api/gomoku?mode=presence&pid=${encodeURIComponent(getMyId())}`, { cache: 'no-store' })
        const data = await res.json()
        if (!alive) return
        failCount.current = 0
        setConnected(true)
        setOnline(Math.max(0, Number(data?.online ?? 0)))
      } catch {
        if (!alive) return
        failCount.current += 1
        if (failCount.current >= 2) setConnected(false)
      } finally {
        if (alive) {
          if (first) {
            first = false
            setPhase((p) => (p === 'connecting' ? 'lobby' : p))
          }
          timer = setTimeout(tick, PRESENCE_MS)
        }
      }
    }
    tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [activeCode])

  // 启动引导：邀请链接 ?room= / 本机保存的房间
  useEffect(() => {
    const url = new URL(window.location.href)
    const fromLink = url.searchParams.get('room')
    if (fromLink) {
      pendingJoin.current = fromLink.toUpperCase()
      history.replaceState(null, '', '/')
    }
    const saved = getSavedRoom()
    if (saved && fromLink && saved !== fromLink.toUpperCase()) {
      // 邀请链接优先：不再回到旧房间，主动忽略其残留状态，避免双房间状态竞争
      leftCode.current = saved
      clearSavedRoom()
      void fetch('/api/gomoku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'room:leave', code: saved, playerId: getMyId() }),
      }).catch(() => {})
    } else if (saved && !fromLink) {
      // 保存的房间直接进入轮询（服务端按 pid 自动回归座位）
      setActiveCode(saved)
    }
    if (pendingJoin.current && getSavedName()) {
      const code = pendingJoin.current
      pendingJoin.current = null
      void (async () => {
        try {
          const res = await fetch('/api/gomoku', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'room:join', code, playerId: getMyId(), name: getSavedName() }),
          })
          const data = await res.json()
          if (data?.ok) {
            saveRoom(code)
            setActiveCode(code)
          } else {
            toast({ title: '加入失败', description: data?.message ?? '房间不存在', variant: 'destructive' })
            clearSavedRoom()
          }
        } catch {
          toast({ title: '加入失败', description: '网络异常，请重试', variant: 'destructive' })
        }
      })()
    } else if (pendingJoin.current) {
      // 有邀请链接但未填昵称 → 预填房号进大厅
      setPendingRoomCode(pendingJoin.current)
      setPhase('lobby')
    }
  }, [])

  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch('/api/gomoku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: getMyId(), ...body }),
        })
        const data = (await res.json()) as Record<string, unknown>
        if (data?.ok) {
          failCount.current = 0
          setConnected(true)
          if (data.state) applyState(data.state as RoomState)
        }
        return data
      } catch {
        return null
      }
    },
    [applyState]
  )

  /** 通过链接加入：若无昵称先返回昵称，再自动入房 */
  const consumePendingJoin = useCallback(
    (name: string) => {
      const code = pendingJoin.current
      if (!code) return false
      pendingJoin.current = null
      void (async () => {
        const data = await postAction({ action: 'room:join', code, name })
        if (data?.ok) {
          saveName(name)
          saveRoom(code)
          setActiveCode(code)
        } else {
          toast({ title: '加入失败', description: (data?.message as string) ?? '房间不存在', variant: 'destructive' })
        }
      })()
      return true
    },
    [postAction, toast]
  )

  const createRoom = useCallback(
    (name: string, mode: 'pvp' | 'solo' = 'pvp', difficulty: Difficulty = 'normal', aiConfig?: AiModelConfig | null) => {
      if (!connected) return
      setBusy(true)
      saveName(name)
      leftCode.current = null
      void (async () => {
        const data = await postAction({
          action: 'room:create',
          name,
          mode,
          difficulty,
          aiConfig: aiConfig ?? undefined,
        })
        setBusy(false)
        if (data?.ok && typeof data.code === 'string') {
          saveRoom(data.code)
          setActiveCode(data.code)
        }
      })()
    },
    [connected, postAction]
  )

  const joinRoom = useCallback(
    (code: string, name: string) => {
      if (!connected) return
      setBusy(true)
      saveName(name)
      leftCode.current = null
      const target = code.trim().toUpperCase()
      void (async () => {
        const data = await postAction({ action: 'room:join', code: target, name })
        setBusy(false)
        if (data?.ok) {
          saveRoom(target)
          setActiveCode(target)
        } else {
          toast({ title: '加入失败', description: (data?.message as string) ?? '房间不存在', variant: 'destructive' })
        }
      })()
    },
    [connected, postAction, toast]
  )

  const leaveRoom = useCallback(() => {
    if (room?.code) leftCode.current = room.code
    const code = room?.code
    setRoom(null)
    setPhase('lobby')
    setActiveCode(null)
    clearSavedRoom()
    prevStatus.current = null
    prevChatLen.current = 0
    prevMoveCount.current = 0
    prevUndoReq.current = null
    prevHintKey.current = ''
    prevRound.current = 0
    lastReactionTs.current = 0
    setReactions([])
    if (code) void postAction({ action: 'room:leave', code })
  }, [room, postAction])

  const move = useCallback(
    (index: number) => {
      const code = activeCodeRef.current
      if (code) void postAction({ action: 'game:move', code, index })
    },
    [postAction]
  )

  const requestUndo = useCallback(() => {
    const code = activeCodeRef.current
    if (code) void postAction({ action: 'game:undo-request', code })
  }, [postAction])
  const acceptUndo = useCallback(() => {
    const code = activeCodeRef.current
    if (code) void postAction({ action: 'game:undo-accept', code })
  }, [postAction])
  const rejectUndo = useCallback(() => {
    const code = activeCodeRef.current
    if (code) void postAction({ action: 'game:undo-reject', code })
  }, [postAction])
  const requestHint = useCallback(() => {
    const code = activeCodeRef.current
    if (code) void postAction({ action: 'game:hint', code })
  }, [postAction])
  const toggleRematch = useCallback(() => {
    const code = activeCodeRef.current
    if (code) void postAction({ action: 'game:rematch', code })
  }, [postAction])
  const resign = useCallback(() => {
    const code = activeCodeRef.current
    if (code) void postAction({ action: 'game:resign', code })
  }, [postAction])

  const sendChat = useCallback(
    (text: string) => {
      const code = activeCodeRef.current
      if (text.trim() && code) void postAction({ action: 'chat:send', code, text: text.trim() })
    },
    [postAction]
  )

  const sendReaction = useCallback(
    (emoji: string) => {
      const now = Date.now()
      if (now - lastSentReactAt.current < 650) return
      const code = activeCodeRef.current
      if (!code) return
      lastSentReactAt.current = now
      void postAction({ action: 'game:react', code, emoji })
    },
    [postAction]
  )

  /** solo 房内切换 AI 难度（对局中即时生效） */
  const changeDifficulty = useCallback(
    (difficulty: Difficulty) => {
      const code = activeCodeRef.current
      if (code) void postAction({ action: 'room:difficulty', code, difficulty })
    },
    [postAction]
  )

  /** 房间预览：不加入房间只读公共信息（大厅输房号/邀请链接进入时展示房主资料卡） */
  const peekRoom = useCallback(
    async (code: string): Promise<RoomPeek | null> => {
      if (!connected || !code.trim()) return null
      try {
        const res = await fetch(`/api/gomoku?mode=peek&code=${encodeURIComponent(code.trim().toUpperCase())}`, {
          cache: 'no-store',
        })
        const data = await res.json()
        return data?.ok ? (data as RoomPeek) : null
      } catch {
        return null
      }
    },
    [connected]
  )

  const myColor: 1 | 2 | null = room
    ? room.black?.playerId === getMyId()
      ? 1
      : room.white?.playerId === getMyId()
        ? 2
        : null
    : null

  return {
    connected,
    phase,
    room,
    busy,
    myColor,
    isSpectator: !!room && !myColor,
    online,
    reactions,
    createRoom,
    joinRoom,
    leaveRoom,
    move,
    requestUndo,
    acceptUndo,
    rejectUndo,
    requestHint,
    toggleRematch,
    resign,
    sendChat,
    sendReaction,
    changeDifficulty,
    peekRoom,
    consumePendingJoin,
    pendingRoomCode,
    enterLobby: () => setPhase('lobby'),
  }
}
