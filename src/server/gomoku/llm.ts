// 自定义 AI 走子：调用任意 OpenAI 兼容 /chat/completions 接口，让大模型落子
// 带 8s 超时与一次纠错重试；任何失败抛错，由调用方回退到内置启发式引擎

import { CELLS, SIZE, type Color, type Room } from './engine'
import type { AiModelConfig } from '@/lib/gomoku/ai-config'

const LLM_TIMEOUT_MS = 8000 // 控制在 Serverless 函数超时（10s）以内

/** 归一化 Base URL → 完整 chat/completions 端点 */
export function normalizeEndpoint(baseUrl: string): string {
  let u = String(baseUrl ?? '').trim().replace(/\s+/g, '')
  if (!u) throw new Error('Base URL 不能为空')
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  u = u.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(u)) return u
  return u + '/chat/completions'
}

/** 基础 SSRF 防护：禁内网保留地址（本机回环除外，便于 Ollama 等本地模型） */
export function assertPublicOrLocal(url: string) {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('Base URL 格式不正确')
  }
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  if (loopback) return
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[fc|\[fd)/.test(host)) {
    throw new Error('不允许访问内网地址')
  }
}

const COL_LETTERS = 'ABCDEFGHJKLMNOP' // 与提示/坐标展示一致（跳过 I）

function renderBoard(room: Room): string {
  const rows: string[] = []
  for (let r = 0; r < SIZE; r++) {
    let line = ''
    for (let c = 0; c < SIZE; c++) {
      const v = room.board[r * SIZE + c]
      line += v === 1 ? ' X' : v === 2 ? ' O' : ' .'
    }
    rows.push(`${String(SIZE - r).padStart(2, ' ')}${line}`)
  }
  // 列头与棋盘格对齐（每格 2 字符，前置 2 位行号缩进）
  let header = '  '
  for (const l of COL_LETTERS) header += l + ' '
  return header + '\n' + rows.join('\n')
}

function buildMessages(room: Room, retryFeedback?: string) {
  const aiColor: Color = room.turn
  const humanColor: Color = aiColor === 1 ? 2 : 1
  const diffText: Record<string, string> = { easy: '轻松 Mode：可以下得随意些', normal: '正常 Mode：认真攻防', hard: '大师 Mode：全力以赴，攻防兼备' }
  const system = [
    '你是五子棋（Gomoku，15×15 棋盘，五连获胜）AI 棋手，执' + (aiColor === 1 ? '黑棋 X' : '白棋 O') + '。',
    `对手执${humanColor === 1 ? '黑棋 X' : '白棋 O'}。你只能落在空位（.）上。`,
    '优先级：1) 你一步成五立即下；2) 对手一步成五必须堵；3) 制造双威胁（双活三/冲四活三）；4) 攻防均衡取最优。',
    '当前难度：' + (diffText[room.difficulty] ?? diffText.normal) + '。',
    room.aiConfig?.systemPrompt ? '棋手设定：' + room.aiConfig.systemPrompt : '',
    '输出要求：只输出一个 JSON 对象，格式 {"row": 行号, "col": 列号}，row/col 为 0-14 的整数（0 为最上/最左），不要输出任何其他文字。',
  ]
    .filter(Boolean)
    .join('\n')

  const lastMoves = room.moves.slice(-6)
  const history = lastMoves.length
    ? '最近落子（0 基坐标）：' +
      lastMoves.map((m) => `${m.color === 1 ? 'X' : 'O'}(${Math.floor(m.index / SIZE)},${m.index % SIZE})`).join(' ')
    : '这是第一手，建议下天元 (7,7) 附近。'

  const user = [
    `当前棋盘（行号左侧，X=黑，O=白，.=空）：\n${renderBoard(room)}`,
    history,
    `轮到你（${aiColor === 1 ? 'X 黑棋' : 'O 白棋'}）落子。`,
    retryFeedback ? `注意：你上一次的输出无法解析或不合法（${retryFeedback}），请重新给出一个合法空位的 JSON。` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 从回复文本里抠出落子：支持 {"row":r,"col":c}、{"index":i}、坐标串 "H8" */
export function parseMoveFromText(text: string): number {
  if (!text) return -1
  const jsonMatch = text.match(/\{[^{}]*\}/)
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const idxOf = (row: unknown, col: unknown) => {
        const r = Number(row)
        const c = Number(col)
        if (Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE) return r * SIZE + c
        return -1
      }
      // row/col（0 基）
      let idx = idxOf(obj.row, obj.col)
      if (idx >= 0) return idx
      // row/col（1 基：>14 时按 1 基修正，或坐标恰好合法但为 1 基习惯）
      const r1 = Number(obj.row)
      const c1 = Number(obj.col)
      if (Number.isInteger(r1) && Number.isInteger(c1) && (r1 > 14 || c1 > 14)) {
        idx = idxOf(r1 - 1, c1 - 1)
        if (idx >= 0) return idx
      }
      // index
      const i = Number(obj.index)
      if (Number.isInteger(i) && i >= 0 && i < CELLS) return i
      // 坐标串 "H8"
      const mv = String(obj.move ?? obj.coord ?? '')
      const cm = mv.toUpperCase().match(/^([A-N])(\d{1,2})$/)
      if (cm) {
        const c = COL_LETTERS.indexOf(cm[1])
        const r = SIZE - Number(cm[2])
        if (c >= 0 && r >= 0 && r < SIZE) return r * SIZE + c
      }
    } catch {
      /* 继续尝试纯文本 */
    }
  }
  // 纯坐标 "H8"
  const cm = text.toUpperCase().match(/\b([A-N])(\d{1,2})\b/)
  if (cm) {
    const c = COL_LETTERS.indexOf(cm[1])
    const r = SIZE - Number(cm[2])
    if (c >= 0 && r >= 0 && r < SIZE) return r * SIZE + c
  }
  // 纯数字 index
  const n = text.match(/\b(\d{1,3})\b/)
  if (n) {
    const i = Number(n[1])
    if (i >= 0 && i < CELLS) return i
  }
  return -1
}

async function chatOnce(cfg: AiModelConfig, messages: { role: string; content: string }[]): Promise<string> {
  const endpoint = normalizeEndpoint(cfg.baseUrl)
  assertPublicOrLocal(endpoint)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: typeof cfg.temperature === 'number' ? Math.max(0, Math.min(2, cfg.temperature)) : 0.3,
        max_tokens: 300,
        stream: false,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data?.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

const legalityNote = (room: Room, idx: number): string =>
  idx < 0 || idx >= CELLS ? '落子超出棋盘' : room.board[idx] !== 0 ? '该位置已有棋子' : ''

/**
 * 让自定义 LLM 在当前局面下落子，返回合法落点下标；失败/不合法时抛错（调用方回退启发式）。
 * 首次解析失败会带反馈重试一次。
 */
export async function llmChooseMove(room: Room, cfg: AiModelConfig): Promise<number> {
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chatOnce(cfg, buildMessages(room, feedback))
    const idx = parseMoveFromText(content)
    if (idx >= 0 && idx < CELLS && room.board[idx] === 0) return idx
    feedback = legalityNote(room, idx) || '输出格式不符合要求'
  }
  throw new Error('LLM 落子不合法')
}

/** 连通性测试（设置弹窗「测试连接」按钮）：发一条极短对话验证端点/密钥/模型可用 */
export async function testAiConnection(cfg: AiModelConfig): Promise<{ ok: boolean; latencyMs: number; reply?: string; error?: string }> {
  const started = Date.now()
  try {
    const endpoint = normalizeEndpoint(cfg.baseUrl)
    assertPublicOrLocal(endpoint)
    const content = await chatOnce(cfg, [
      { role: 'system', content: '你是连通性测试探针，只回复 OK。' },
      { role: 'user', content: 'ping' },
    ])
    return { ok: true, latencyMs: Date.now() - started, reply: content.slice(0, 40) }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) }
  }
}
