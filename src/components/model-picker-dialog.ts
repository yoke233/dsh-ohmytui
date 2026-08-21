import { Input, getKeybindings, truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Translator } from '../i18n.ts'
import { frameBlock, type Palette } from '../theme.ts'

type ModelItem = {
  provider: string
  providerName: string
  id: string
  name?: string
  context?: number
  efforts: Array<{ id: string; name: string }>
}

/** One-screen provider, model, search, and reasoning-effort picker. */
export class ModelPickerDialog implements Component {
  private providerIndex = 0
  private modelIndex = 0
  private effortIndex = 0
  private searching = false
  private readonly search = new Input()

  constructor(
    private readonly items: readonly ModelItem[],
    private readonly palette: Palette,
    private readonly t: Translator,
    private readonly onDone: (value: ModelSelection | undefined) => void,
  ) {}

  handleInput(data: string): void {
    const kb = getKeybindings()
    if (this.searching) {
      if (kb.matches(data, 'tui.select.cancel')) { this.searching = false; return }
      if (kb.matches(data, 'tui.select.confirm')) { this.searching = false; this.modelIndex = 0; return }
      this.search.handleInput(data)
      this.modelIndex = 0
      return
    }
    if (kb.matches(data, 'tui.select.cancel')) return this.onDone(undefined)
    if (data === '/' || data === 's') { this.searching = true; return }
    if (data === '\t') { this.providerIndex = (this.providerIndex + 1) % this.providers.length; this.modelIndex = 0; this.effortIndex = 0; return }
    if (kb.matches(data, 'tui.select.up')) { this.moveModel(-1); return }
    if (kb.matches(data, 'tui.select.down')) { this.moveModel(1); return }
    if (data === '\x1b[D' || data === 'h') { this.moveEffort(-1); return }
    if (data === '\x1b[C' || data === 'l') { this.moveEffort(1); return }
    if (kb.matches(data, 'tui.select.confirm')) {
      const model = this.models[this.modelIndex]
      if (!model) return
      const effort = model.efforts[this.effortIndex]?.id
      this.onDone({ provider: model.provider, model: model.id, ...(effort ? { reasoningEffort: effort as ModelSelection['reasoningEffort'] } : {}) })
    }
  }

  invalidate(): void { this.search.invalidate() }

  render(width: number): string[] {
    const w = Math.max(50, width)
    const inner = w - 4
    const providers = this.providers
    const provider = providers[this.providerIndex] ?? ''
    const models = this.models
    if (this.modelIndex >= models.length) this.modelIndex = Math.max(0, models.length - 1)
    const current = models[this.modelIndex]
    if (current && this.effortIndex >= current.efforts.length) this.effortIndex = 0
    const rows: string[] = []
    rows.push(this.palette.bold('Models') + this.palette.dim('  choose model + thinking'))
    rows.push(this.palette.dim('─'.repeat(inner)))
    const tabs = providers.map((id, i) => i === this.providerIndex ? this.palette.selected(` ${this.providerName(id)} `) : this.palette.dim(this.providerName(id))).join(this.palette.dim('  ·  '))
    rows.push(`Provider  ‹  ${tabs}  ›`)
    const query = this.search.getValue()
    rows.push(`Search    ${this.searching ? this.search.render(Math.max(10, inner - 12))[0] ?? '' : (query || this.palette.dim('type / to filter this provider'))}  ${this.palette.dim(`${models.length} models`)}`)
    rows.push(this.palette.dim('─'.repeat(inner)))
    if (models.length === 0) rows.push(this.palette.dim('  No matching models'))
    for (const [i, model] of models.entries()) {
      const marker = i === this.modelIndex ? this.palette.accent('➜ ') : '  '
      const left = `${marker}${i === this.modelIndex ? this.palette.bold(model.id) : model.id}${model.name && model.name !== model.id ? `  ${this.palette.dim(model.name)}` : ''}`
      const meta = [model.context ? `${Math.round(model.context / 1000)}k` : '', model.efforts.length ? 'think' : ''].filter(Boolean).join('  ')
      const gap = Math.max(1, inner - visibleWidth(left) - visibleWidth(meta))
      rows.push(truncateToWidth(left + ' '.repeat(gap) + this.palette.dim(meta), inner))
    }
    rows.push(this.palette.dim('─'.repeat(inner)))
    if (current) {
      rows.push(`${this.palette.bold(current.id)}  ${this.palette.dim(current.name ?? '')}${' '.repeat(Math.max(1, inner - visibleWidth(current.id) - visibleWidth(current.name ?? '') - visibleWidth(current.providerName) - 2))}${this.palette.dim(current.providerName)}`)
      const efforts = current.efforts.length ? current.efforts : [{ id: 'off', name: 'off' }]
      rows.push('Thinking  ' + efforts.map((e, i) => i === this.effortIndex ? this.palette.selected(` ${e.name} `) : this.palette.dim(e.name)).join(this.palette.dim('  ·  ')))
    }
    rows.push('')
    rows.push(this.palette.dim('↑↓ model   ←→ thinking   Tab provider   / search   Enter apply   Esc close'))
    return frameBlock(rows, w, this.palette.accent, undefined)
  }

  private get providers(): string[] { return [...new Set(this.items.map(item => item.provider))] }
  private providerName(id: string): string { return this.items.find(item => item.provider === id)?.providerName ?? id }
  private get models(): ModelItem[] {
    const provider = this.providers[this.providerIndex]
    const q = this.search.getValue().trim().toLowerCase()
    return this.items.filter(item => item.provider === provider && (!q || item.id.toLowerCase().includes(q) || item.name?.toLowerCase().includes(q)))
  }
  private moveModel(delta: number): void { const n = this.models.length; if (n) this.modelIndex = (this.modelIndex + delta + n) % n; this.effortIndex = 0 }
  private moveEffort(delta: number): void { const n = this.models[this.modelIndex]?.efforts.length ?? 0; if (n) this.effortIndex = (this.effortIndex + delta + n) % n }
}

export type { ModelItem }
