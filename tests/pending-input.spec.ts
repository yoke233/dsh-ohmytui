import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createTranslator } from '../src/i18n.ts'
import { createPalette, markdownTheme } from '../src/theme.ts'
import { PendingInputPanel } from '../src/components/pending-input.ts'

const palette = createPalette(false, 'dark', true)
const mdTheme = markdownTheme(palette)
const t = createTranslator('zh-CN')

describe('composer steer projection', () => {
  it('shows submitted user content until its durable message is rendered', () => {
    const panel = new PendingInputPanel(palette, mdTheme, t)
    const message = createUserMessage({
      content: [{ type: 'text', text: '补充这个约束' }],
      source: { kind: 'user' },
    })

    assert.equal(panel.insert(message), true)
    assert.equal(panel.count, 1)
    assert.match(panel.render(48).join('\n'), /steer · 待处理（1）/)
    assert.match(panel.render(48).join('\n'), /补充这个约束/)
    assert.equal(panel.render(48).at(-1), '')

    assert.equal(panel.remove(message.id), true)
    assert.equal(panel.count, 0)
    assert.deepEqual(panel.render(48), [])
  })

  it('renders every queued steer in insertion order', () => {
    const panel = new PendingInputPanel(palette, mdTheme, t)
    panel.insert(createUserMessage({
      content: [{ type: 'text', text: '第一条约束' }],
      source: { kind: 'user' },
    }))
    panel.insert(createUserMessage({
      content: [{ type: 'text', text: '第二条约束' }],
      source: { kind: 'user' },
    }))

    assert.match(panel.render(48).join('\n'), /第一条约束[\s\S]*第二条约束/)
    assert.equal(panel.render(48).at(-1), '')
  })

  it('projects only direct user messages when synchronizing an inbox', () => {
    const panel = new PendingInputPanel(palette, mdTheme, t)
    const direct = createUserMessage({
      content: [{ type: 'text', text: '直接输入' }],
      source: { kind: 'user' },
    })
    const plugin = createUserMessage({
      content: [{ type: 'text', text: '插件上下文' }],
      source: { kind: 'plugin', plugin: 'fixture' },
    })

    panel.sync([plugin, direct])

    const rendered = panel.render(48).join('\n')
    assert.equal(panel.count, 1)
    assert.match(rendered, /直接输入/)
    assert.doesNotMatch(rendered, /插件上下文/)

    panel.sync([])
    assert.equal(panel.count, 0)
    assert.deepEqual(panel.render(48), [])
  })

  it('bounds long pending input so the editor remains visible', () => {
    const panel = new PendingInputPanel(palette, mdTheme, t)
    panel.insert(createUserMessage({
      content: [{ type: 'text', text: '很长的待处理输入。'.repeat(100) }],
      source: { kind: 'user' },
    }))

    const rows = panel.render(24)
    assert.match(rows.at(-2)!, /…/)
    assert.equal(rows.at(-1), '')
  })
})
