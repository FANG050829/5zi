'use client'

// AI 设置弹窗：管理任意 OpenAI 兼容大模型接入（增删改 / 一键测试 / 选用）
// 档案保存在本机 localStorage；创建人机房间时随 room:create 提交给服务端，
// 服务端在 AI 回合调用该模型落子，失败自动回退内置「弈心」启发式引擎。

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, Loader2, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AI_PRESETS,
  BUILTIN_AI_ID,
  BUILTIN_AI_NAME,
  getSelectedAiId,
  listAiProfiles,
  newAiProfileId,
  saveAiProfiles,
  setSelectedAiId,
  type AiModelConfig,
} from '@/lib/gomoku/ai-config'

interface DraftState {
  id: string | null // null = 新建
  name: string
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  temperature: string
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  systemPrompt: '',
  temperature: '0.3',
}

export function AiSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [profiles, setProfiles] = useState<AiModelConfig[]>([])
  const [selectedId, setSelectedId] = useState<string>(BUILTIN_AI_ID)
  const [draft, setDraft] = useState<DraftState | null>(null) // null = 列表视图
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const resultTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reload = useCallback(() => {
    setProfiles(listAiProfiles())
    setSelectedId(getSelectedAiId())
  }, [])

  useEffect(() => {
    if (open) {
      reload()
      setDraft(null)
      setTestResult(null)
    }
  }, [open, reload])

  useEffect(() => () => clearTimeout(resultTimer.current), [])

  const commit = (list: AiModelConfig[], selected: string) => {
    saveAiProfiles(list)
    setSelectedAiId(selected)
    setProfiles(list)
    setSelectedId(selected)
  }

  const startCreate = () => {
    setTestResult(null)
    setDraft({ ...EMPTY_DRAFT })
  }

  const startEdit = (p: AiModelConfig) => {
    setTestResult(null)
    setDraft({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      systemPrompt: p.systemPrompt ?? '',
      temperature: String(p.temperature ?? 0.3),
    })
  }

  const saveDraft = () => {
    if (!draft) return
    const name = draft.name.trim() || draft.model.trim() || '自定义AI'
    const cfg: AiModelConfig = {
      id: draft.id ?? newAiProfileId(),
      name: name.slice(0, 16),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      systemPrompt: draft.systemPrompt.trim() || undefined,
      temperature: Math.max(0, Math.min(2, Number(draft.temperature) || 0.3)),
    }
    if (!cfg.baseUrl || !cfg.model) {
      setTestResult({ ok: false, text: 'Base URL 与模型名必填' })
      return
    }
    const list = profiles.filter((p) => p.id !== cfg.id).concat(cfg)
    commit(list, cfg.id) // 保存后自动选用
    setDraft(null)
  }

  const removeProfile = (id: string) => {
    const list = profiles.filter((p) => p.id !== id)
    const selected = selectedId === id ? BUILTIN_AI_ID : selectedId
    commit(list, selected)
  }

  const applyPreset = (label: string) => {
    const preset = AI_PRESETS.find((p) => p.label === label)
    if (!preset || !draft) return
    setDraft({
      ...draft,
      baseUrl: preset.baseUrl,
      model: preset.model,
      name: draft.name || preset.label,
    })
  }

  const testConnection = async () => {
    if (!draft) return
    if (!draft.baseUrl.trim() || !draft.model.trim()) {
      setTestResult({ ok: false, text: 'Base URL 与模型名必填' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/gomoku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ai:test',
          config: {
            id: draft.id ?? 'test',
            name: draft.name || '测试',
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey,
            model: draft.model,
            systemPrompt: draft.systemPrompt,
            temperature: Number(draft.temperature) || 0.3,
          },
        }),
      })
      const data = await res.json()
      const text = data?.ok
        ? `连接成功 · ${data.latencyMs}ms${data.reply ? ` · 回复「${String(data.reply).slice(0, 20)}」` : ''}`
        : `连接失败：${data?.error ?? '未知错误'}`
      setTestResult({ ok: !!data?.ok, text })
    } catch {
      setTestResult({ ok: false, text: '连接失败：网络异常' })
    } finally {
      setTesting(false)
    }
  }

  const selectProfile = (id: string) => {
    setSelectedAiId(id)
    setSelectedId(id)
  }

  const draftValid = !!draft && draft.baseUrl.trim() && draft.model.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <Bot className="h-4 w-4" />
            AI 对手设置
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            内置「弈心」本地引擎无需配置；也可接入任意 OpenAI 兼容大模型（DeepSeek / OpenAI / 智谱 / Kimi / Ollama
            等）作为人机对手。密钥仅保存在本机浏览器。
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="flex flex-col gap-2">
            {/* 内置引擎 */}
            <button
              onClick={() => selectProfile(BUILTIN_AI_ID)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                selectedId === BUILTIN_AI_ID
                  ? 'border-stone-800 bg-stone-50'
                  : 'border-stone-200 hover:border-stone-400'
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-900 text-white">
                <Bot className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-stone-800">{BUILTIN_AI_NAME}（内置）</span>
                <span className="block text-[10px] text-stone-400">本地启发式引擎 · 三档难度 · 无需任何配置</span>
              </span>
              {selectedId === BUILTIN_AI_ID && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
            </button>

            {/* 自定义模型列表 */}
            {profiles.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                  selectedId === p.id ? 'border-stone-800 bg-stone-50' : 'border-stone-200 hover:border-stone-400'
                }`}
              >
                <button onClick={() => selectProfile(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <PlugZap className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-stone-800">{p.name}</span>
                    <span className="block truncate text-[10px] text-stone-400">
                      {p.model} · {p.baseUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </span>
                  {selectedId === p.id && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => startEdit(p)} aria-label="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-stone-400 hover:text-rose-600"
                  onClick={() => removeProfile(p.id)}
                  aria-label="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            <Button variant="outline" onClick={startCreate} className="mt-1 h-10 rounded-xl border-dashed">
              <Plus className="mr-1.5 h-4 w-4" />
              添加自定义 AI 模型
            </Button>
            <p className="px-1 text-[10px] leading-4 text-stone-400">
              模型调用失败或超时会自动回退到内置引擎，人机对局不会中断。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {AI_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.label)}
                  className="rounded-full border border-stone-200 px-2.5 py-1 text-[11px] text-stone-500 transition-colors hover:border-stone-800 hover:text-stone-900"
                >
                  {p.label}
                </button>
              ))}
              <span className="self-center text-[10px] text-stone-300">点击预设自动填充</span>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ai-name" className="text-xs text-stone-500">
                显示名（AI 座位昵称）
              </Label>
              <Input
                id="ai-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="如：DeepSeek 棋圣"
                maxLength={16}
                className="h-9 rounded-lg"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ai-url" className="text-xs text-stone-500">
                Base URL（OpenAI 兼容）
              </Label>
              <Input
                id="ai-url"
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="h-9 rounded-lg font-mono text-xs"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ai-key" className="text-xs text-stone-500">
                API Key
              </Label>
              <Input
                id="ai-key"
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-...（本地模型可留空）"
                autoComplete="off"
                className="h-9 rounded-lg font-mono text-xs"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ai-model" className="text-xs text-stone-500">
                模型名
              </Label>
              <Input
                id="ai-model"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="deepseek-chat / gpt-4o-mini / glm-4-flash"
                className="h-9 rounded-lg font-mono text-xs"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ai-prompt" className="text-xs text-stone-500">
                棋风设定（可选，追加到系统提示词）
              </Label>
              <Textarea
                id="ai-prompt"
                value={draft.systemPrompt}
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                placeholder="如：棋风激进，擅长三步杀；说话简短傲娇。"
                rows={2}
                maxLength={500}
                className="rounded-lg text-xs"
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ai-temp" className="text-xs text-stone-500">
                  温度（0-2，默认 0.3）
                </Label>
                <Input
                  id="ai-temp"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
                  className="h-9 rounded-lg"
                />
              </div>
              <Button variant="outline" onClick={testConnection} disabled={testing || !draftValid} className="h-9 rounded-lg">
                {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}
                测试连接
              </Button>
            </div>

            {testResult && (
              <p
                className={`rounded-lg border px-3 py-2 text-[11px] leading-4 ${
                  testResult.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-600'
                }`}
                aria-live="polite"
              >
                {testResult.text}
              </p>
            )}

            <div className="mt-1 flex gap-2">
              <Button variant="outline" onClick={() => setDraft(null)} className="h-10 flex-1 rounded-xl">
                取消
              </Button>
              <Button onClick={saveDraft} disabled={!draftValid} className="h-10 flex-1 rounded-xl bg-stone-900 hover:bg-stone-700">
                保存并选用
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
