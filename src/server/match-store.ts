// 对局记录存储：本地用 Prisma + SQLite；Netlify（Serverless）用 Netlify Blobs。
// 聚合查询（rank / head2head / heatmap / 最近对局）统一在内存中过滤，
// 记录规模上限 800 条，对毕设演示场景绰绰有余。

export interface MatchRecord {
  id: number
  roomCode: string
  blackName: string
  whiteName: string
  blackPid: string
  whitePid: string
  winnerColor: number // 1 黑胜 2 白胜 0 和棋
  endReason: string
  moveCount: number
  durationMs: number
  mode: string // pvp / solo
  difficulty: string
  moves: string // "idx,color;idx,color"
  evals: string // "50,62,..."
  createdAt: string // ISO 字符串
}

export type NewMatch = Omit<MatchRecord, 'id' | 'createdAt'>

function shouldUseBlobs(): boolean {
  return (
    process.env.NETLIFY === 'true' ||
    !!process.env.NETLIFY_BLOBS_CONTEXT ||
    (!!process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.CONTEXT === 'production')
  )
}

const MAX_MATCHES = 800

async function blobsMatches() {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'gomoku-matches', consistency: 'strong' })
}

interface BlobPayload {
  seq: number
  items: MatchRecord[]
}

async function readPayload(): Promise<BlobPayload> {
  const store = await blobsMatches()
  const data = (await store.get('all', { type: 'json' })) as BlobPayload | null
  return data ?? { seq: 0, items: [] }
}

const byCreatedAsc = (a: MatchRecord, b: MatchRecord) => a.createdAt.localeCompare(b.createdAt)

/** 追加一条对局记录，返回分配的 id */
export async function createMatch(data: NewMatch): Promise<number> {
  if (shouldUseBlobs()) {
    const store = await blobsMatches()
    const payload = await readPayload()
    const id = payload.seq + 1
    payload.seq = id
    payload.items.push({ ...data, id, createdAt: new Date().toISOString() })
    if (payload.items.length > MAX_MATCHES) payload.items = payload.items.slice(-MAX_MATCHES)
    await store.setJSON('all', payload)
    return id
  }
  const { db } = await import('@/lib/db')
  const m = await db.match.create({ data })
  return m.id
}

/** 全量记录（按创建时间升序） */
export async function getAllMatches(): Promise<MatchRecord[]> {
  if (shouldUseBlobs()) {
    const payload = await readPayload()
    return [...payload.items].sort(byCreatedAsc)
  }
  const { db } = await import('@/lib/db')
  const rows = await db.match.findMany({ orderBy: { createdAt: 'asc' }, take: MAX_MATCHES })
  return rows.map((m) => ({
    id: m.id,
    roomCode: m.roomCode,
    blackName: m.blackName,
    whiteName: m.whiteName,
    blackPid: m.blackPid,
    whitePid: m.whitePid,
    winnerColor: m.winnerColor,
    endReason: m.endReason,
    moveCount: m.moveCount,
    durationMs: m.durationMs,
    mode: m.mode,
    difficulty: m.difficulty,
    moves: m.moves,
    evals: m.evals,
    createdAt: (m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)).toISOString(),
  }))
}
