import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ImagePasteDraft,
  encodeImageSubmission,
  isImagePasteShortcut,
  pastedImageFilePath,
  readClipboardImage,
} from '../src/image-paste.ts'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])

describe('image paste draft', () => {
  it('attaches only markers retained by the user and follows their text order', () => {
    const draft = new ImagePasteDraft()
    const first = draft.add({ data: png, mediaType: 'image/png', name: 'first.png' })
    const second = draft.add({ data: Uint8Array.from([1, 2, 3]), mediaType: 'image/jpeg' })

    assert.equal(first, '[Image #1] ')
    assert.equal(second, '[Image #2] ')

    const submission = draft.take(`compare ${second.trim()} with no first marker`)
    assert.equal(submission.images.length, 1)
    assert.equal(submission.images[0]?.marker, '[Image #2]')
    assert.equal(draft.size, 0)

    assert.deepEqual(encodeImageSubmission(submission), [{
      mediaType: 'image/jpeg',
      data: Buffer.from([1, 2, 3]).toString('base64'),
    }])
  })

  it('bounds unsent image memory by the attachment message policy', () => {
    const countBound = new ImagePasteDraft({ maxImages: 1, maxBytes: 100 })
    countBound.add({ data: png, mediaType: 'image/png' })
    assert.throws(
      () => { countBound.add({ data: png, mediaType: 'image/png' }) },
      /at most 1 images/u,
    )

    const byteBound = new ImagePasteDraft({ maxImages: 2, maxBytes: png.byteLength })
    byteBound.add({ data: png, mediaType: 'image/png' })
    assert.throws(
      () => { byteBound.add({ data: Uint8Array.of(1), mediaType: 'image/png' }) },
      /byte message limit/u,
    )
  })

  it('removes generated markers when a composer switches sessions', () => {
    const draft = new ImagePasteDraft()
    const first = draft.add({ data: png, mediaType: 'image/png' })
    const second = draft.add({ data: png, mediaType: 'image/png' })

    assert.equal(draft.discardFrom(`before ${first}${second}after`), 'before after')
    assert.equal(draft.size, 0)
  })

  it('restores a failed submission without overwriting a newer draft', () => {
    const draft = new ImagePasteDraft()
    const marker = draft.add({ data: png, mediaType: 'image/png' })
    const submission = draft.take(marker)

    assert.equal(draft.restore(submission), true)
    assert.equal(draft.size, 1)

    const next = draft.take(marker)
    draft.add({ data: png, mediaType: 'image/png' })
    assert.equal(draft.restore(next), false)
  })
})

describe('image paste shortcut', () => {
  it('uses Alt+V on Windows without stealing ordinary Ctrl+V text paste', () => {
    assert.equal(isImagePasteShortcut('\x1bv', 'win32'), true)
    assert.equal(isImagePasteShortcut('\x16', 'win32'), false)
    assert.equal(isImagePasteShortcut('\x16', 'linux'), true)
  })
})

describe('pasted image file path', () => {
  it('recognizes a single quoted image path in terminal bracketed paste', () => {
    assert.equal(
      pastedImageFilePath('\x1b[200~"C:\\screenshots\\hello world.PNG"\x1b[201~'),
      'C:\\screenshots\\hello world.PNG',
    )
    assert.equal(pastedImageFilePath('\x1b[200~C:\\notes\\todo.txt\x1b[201~'), null)
    assert.equal(pastedImageFilePath('C:\\screenshots\\plain.png'), null)
  })
})

describe('clipboard image reader', () => {
  it('reads native clipboard bytes as an unpersisted PNG draft', async () => {
    const image = await readClipboardImage({
      platform: 'darwin',
      environment: {},
      nativeClipboard: {
        hasImage: () => true,
        getImageBinary: async () => png,
      },
    })

    assert.deepEqual(image, {
      data: png,
      mediaType: 'image/png',
      name: 'clipboard.png',
    })
  })

  it('falls back to Windows PowerShell when the native reader is unavailable', async () => {
    let invoked = false
    const image = await readClipboardImage({
      platform: 'win32',
      environment: {},
      nativeClipboard: null,
      runCommand: async (command, args) => {
        invoked = true
        assert.equal(command, 'powershell.exe')
        assert.equal(args.includes('-STA'), true)
        const encoded = args.at(-1) ?? ''
        const script = Buffer.from(encoded, 'base64').toString('utf16le')
        assert.match(script, /ContainsFileDropList/u)
        assert.match(script, /GetFileDropList/u)
        return {
          ok: true,
          stdout: Buffer.from(JSON.stringify({
            mediaType: 'image/png',
            name: 'copied-file.png',
            data: Buffer.from(png).toString('base64'),
          })),
          missingCommand: false,
        }
      },
    })

    assert.equal(invoked, true)
    assert.deepEqual(Array.from(image?.data ?? []), Array.from(png))
    assert.equal(image?.mediaType, 'image/png')
    assert.equal(image?.name, 'copied-file.png')
  })

  it('uses the attachment policy MIME list when probing Linux clipboard formats', async () => {
    const calls: string[][] = []
    const image = await readClipboardImage({
      platform: 'linux',
      environment: { DISPLAY: ':0' },
      mediaTypes: ['image/jpeg'],
      nativeClipboard: null,
      runCommand: async (command, args) => {
        calls.push([command, ...args])
        if (command === 'xclip' && args.includes('TARGETS')) {
          return { ok: true, stdout: Buffer.from('image/png\nimage/jpeg\n'), missingCommand: false }
        }
        if (command === 'xclip' && args.includes('image/jpeg')) {
          return { ok: true, stdout: Buffer.from([1, 2, 3]), missingCommand: false }
        }
        return { ok: false, stdout: Buffer.alloc(0), missingCommand: true }
      },
    })

    assert.equal(image?.mediaType, 'image/jpeg')
    assert.equal(calls.some(call => call.includes('image/png') && !call.includes('TARGETS')), false)
  })

  it('rejects native or command output that exceeds the attachment byte limit', async () => {
    await assert.rejects(readClipboardImage({
      platform: 'darwin',
      environment: {},
      maxBytes: 2,
      nativeClipboard: {
        hasImage: () => true,
        getImageBinary: async () => png,
      },
    }), /2 byte attachment limit/u)

    await assert.rejects(readClipboardImage({
      platform: 'win32',
      environment: {},
      maxBytes: 2,
      nativeClipboard: null,
      runCommand: async () => ({
        ok: false,
        stdout: Buffer.alloc(0),
        missingCommand: false,
        overflow: true,
      }),
    }), /2 byte attachment limit/u)
  })

  it('reports an empty clipboard and rejects headless Linux sessions', async () => {
    const empty = await readClipboardImage({
      platform: 'darwin',
      environment: {},
      nativeClipboard: {
        hasImage: () => false,
        getImageBinary: async () => png,
      },
    })
    assert.equal(empty, null)

    await assert.rejects(
      readClipboardImage({ platform: 'linux', environment: {}, nativeClipboard: null }),
      /graphical Linux session/u,
    )
  })
})
