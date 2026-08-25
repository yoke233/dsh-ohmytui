import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { WORKING_WORDS, WorkingWordRotation, formatWorkingElapsed, workingActivityText } from '../src/working-words.ts'

describe('working activity words', () => {
  it('keeps a random word for five messages before changing it', () => {
    const randomValues = [0, 0.999]
    const rotation = new WorkingWordRotation(() => randomValues.shift() ?? 0)
    const firstFive = Array.from({ length: 5 }, () => rotation.next())
    assert.deepEqual(firstFive, Array(5).fill('Baking'))
    const sixth = rotation.next()
    assert.notEqual(sixth, 'Baking')
    assert.ok(WORKING_WORDS.includes(sixth as (typeof WORKING_WORDS)[number]))
  })

  it('adds the three-dot suffix to the animated label', () => {
    assert.equal(workingActivityText('✶', 'Brewing'), '✶ Brewing...')
  })

  it('formats elapsed status time compactly', () => {
    assert.equal(formatWorkingElapsed(999), '0s')
    assert.equal(formatWorkingElapsed(13 * 60_000 + 24_000), '13m 24s')
    assert.equal(formatWorkingElapsed(3_661_000), '1h 1m 1s')
  })
})
