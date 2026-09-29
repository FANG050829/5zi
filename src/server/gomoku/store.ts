// 房间与在线人数存储：本地/长驻进程用内存 Map；Netlify（Serverless）用 Netlify Blobs。
// 统一异步接口，路由层无感知。

import {
  ROOM_TTL_MS,
  type Room,
} from './engine'

/** 是否运行在 Netlify 生产环境（函数内注入的上下文变量） */
function shouldUseBlobs(): boolean {
  return (
    process.env.NETLIFY === 'true' ||
    !!process.env.NETLIFY_BLOBS_CONTEXT ||
    (!!process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.CONTEXT === 'production')
  )
}

interface RoomStore {
  get(code: string): Promise<Room | null>
  set(room: Room): Promise<void>
  delete(code: string): Promise<void>
  /** 物理回收空房（emptyAt 超过 TTL）与超量房间 */
  sweep(): Promise<void>
}

// ---------------- 内存实现（本地 dev / 长驻 Node） ----------------

const memoryRooms = new Map<string, Room>()

const memoryRoomStore: RoomStore = {
  async get(code) {
    return memoryRooms.get(code) ?? null
  },
  async set(room) {
    memoryRooms.set(room.code, room)
  },
  async delete(code) {
    memoryRooms.delete(code)
  },
  async sweep() {
    const now = Date.now()
    for (const [code, room] of memoryRooms) {
      if (room.emptyAt && now - room.emptyAt > ROOM_TTL_MS) memoryRooms.delete(code)
    }
  },
}

// ---------------- Netlify Blobs 实现 ----------------

async function blobsStore() {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'gomoku-rooms', consistency: 'strong' })
}

const blobsRoomStore: RoomStore = {
  async get(code) {
    const store = await blobsStore()
    const raw = await store.get(`room:${code}`, { type: 'text' })
    if (!raw) return null
    try {
      return JSON.parse(raw) as Room
    } catch {
      return null
    }
  },
  async set(room) {
    const store = await blobsStore()
    await store.setJSON(`room:${room.code}`, room)
  },
  async delete(code) {
    const store = await blobsStore()
    await store.delete(`room:${code}`).catch(() => {})
  },
  async sweep() {
    const store = await blobsStore()
    const now = Date.now()
    const listed = await store.list({ prefix: 'room:' })
    for (const b of listed.blobs) {
      const code = b.key.slice('room:'.length)
      const room = await this.get(code)
      if (room && room.emptyAt && now - room.emptyAt > ROOM_TTL_MS) await this.delete(code)
    }
  },
}

export const roomStore: RoomStore = shouldUseBlobs() ? blobsRoomStore : memoryRoomStore

// ---------------- 在线人数（大厅展示） ----------------

interface PresenceStore {
  /** 刷新心跳并返回当前在线数（30s 窗口内的活跃 pid 数） */
  heartbeat(pid: string): Promise<number>
}

const memoryPresence = new Map<string, number>()

const PRESENCE_WINDOW_MS = 30_000

const memoryPresenceStore: PresenceStore = {
  async heartbeat(pid) {
    const now = Date.now()
    memoryPresence.set(pid, now)
    for (const [p, ts] of memoryPresence) {
      if (now - ts > PRESENCE_WINDOW_MS) memoryPresence.delete(p)
    }
    return memoryPresence.size
  },
}

async function blobsPresence() {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'gomoku-meta', consistency: 'strong' })
}

const blobsPresenceStore: PresenceStore = {
  async heartbeat(pid) {
    const store = await blobsPresence()
    const now = Date.now()
    const data = ((await store.get('presence', { type: 'json' })) as Record<string, number> | null) ?? {}
    data[pid] = now
    // 裁剪过期心跳，控制 blob 体积
    for (const p of Object.keys(data)) {
      if (now - data[p] > PRESENCE_WINDOW_MS * 4) delete data[p]
    }
    await store.setJSON('presence', data)
    return Object.values(data).filter((ts) => now - ts < PRESENCE_WINDOW_MS).length
  },
}

export const presenceStore: PresenceStore = shouldUseBlobs() ? blobsPresenceStore : memoryPresenceStore

// ---------------- 房间创建（容量上限控制） ----------------

const MAX_ROOMS = 500

export async function allocateRoom(room: Room): Promise<void> {
  // 以概率触发空房回收（内存立即生效；Blobs 尽力而为）
  if (Math.random() < 0.05) await roomStore.sweep().catch(() => {})
  if (!shouldUseBlobs() && memoryRooms.size >= MAX_ROOMS) {
    // 回收最早创建的房间
    const oldest = [...memoryRooms.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) memoryRooms.delete(oldest.code)
  }
  await roomStore.set(room)
}
