// 自定义 AI（任意 OpenAI 兼容接口）共享类型与本地档案存储
// 客户端负责持久化（localStorage），创建人机房间时随 room:create 提交给服务端

export interface AiModelConfig {
  id: string
  /** 显示名（AI 座位昵称） */
  name: string
  /** OpenAI 兼容 Base URL，如 https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** 可选：追加到默认系统提示词之后（性格 / 棋风） */
  systemPrompt?: string
  /** 可选：采样温度 0-2，默认 0.3 */
  temperature?: number
}

/** 内置本地启发式引擎「弈心」 */
export const BUILTIN_AI_ID = 'builtin-yixin'
export const BUILTIN_AI_NAME = '弈心·AI'

const LS_PROFILES = 'gomoku-ai-profiles'
const LS_SELECTED = 'gomoku-ai-selected'

/** 常见厂商预设（填充 Base URL / 模型名，免手打） */
export const AI_PRESETS: { label: string; baseUrl: string; model: string; keyHint?: string }[] = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', keyHint: '本地服务无需 Key' },
]

export function listAiProfiles(): AiModelConfig[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_PROFILES)
    const arr = raw ? (JSON.parse(raw) as AiModelConfig[]) : []
    return Array.isArray(arr) ? arr.filter((p) => p && p.id && p.name && p.baseUrl && p.model) : []
  } catch {
    return []
  }
}

export function saveAiProfiles(list: AiModelConfig[]) {
  try {
    localStorage.setItem(LS_PROFILES, JSON.stringify(list))
    notifyAiConfigChanged()
  } catch {}
}

export function getSelectedAiId(): string {
  if (typeof window === 'undefined') return BUILTIN_AI_ID
  return localStorage.getItem(LS_SELECTED) || BUILTIN_AI_ID
}

export function setSelectedAiId(id: string) {
  try {
    localStorage.setItem(LS_SELECTED, id)
    notifyAiConfigChanged()
  } catch {}
}

// 档案变更通知：localStorage 没有跨组件事件，用 window 事件让 React 可订阅
const AI_CHANGE_EVENT = 'gomoku-ai-changed'

export function subscribeAiConfig(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(AI_CHANGE_EVENT, onChange)
  return () => window.removeEventListener(AI_CHANGE_EVENT, onChange)
}

function notifyAiConfigChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AI_CHANGE_EVENT))
}

/** 当前选中的 AI：内置弈心返回 null（走本地引擎），否则返回自定义配置 */
export function getActiveAiConfig(): AiModelConfig | null {
  const id = getSelectedAiId()
  if (id === BUILTIN_AI_ID) return null
  return listAiProfiles().find((p) => p.id === id) ?? null
}

export function newAiProfileId(): string {
  return 'ai-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}
