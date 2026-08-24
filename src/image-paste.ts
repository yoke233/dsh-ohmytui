import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  EncodedImageAttachment,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { matchesKey, type KeyId } from '@earendil-works/pi-tui'

const require = createRequire(import.meta.url)
const LIST_TYPES_TIMEOUT_MS = 1_000
const READ_TIMEOUT_MS = 5_000
const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024
const SUPPORTED_IMAGE_MIME_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

interface NativeClipboard {
  hasImage(): boolean
  getImageBinary(): Promise<Array<number> | Uint8Array>
}

interface CommandResult {
  ok: boolean
  stdout: Buffer
  missingCommand: boolean
  overflow?: boolean
}

type CommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
  maxBufferBytes: number,
) => Promise<CommandResult>

export interface ReadClipboardImageOptions {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  maxBytes?: number
  mediaTypes?: readonly ImageMediaType[]
  /** Test/embedding seam; omit to resolve the optional native clipboard package. */
  nativeClipboard?: NativeClipboard | null
  /** Test/embedding seam for platform clipboard commands. */
  runCommand?: CommandRunner
}

interface ClipboardReaderResult {
  available: boolean
  image: SaveImageAttachment | null
}

export interface PendingImage {
  readonly index: number
  readonly marker: string
  readonly input: SaveImageAttachment
}

export interface ImagePasteSubmission {
  readonly images: readonly PendingImage[]
}

/** In-memory composer ownership for images that do not yet have durable refs. */
export class ImagePasteDraft {
  private images: PendingImage[] = []
  private nextIndex = 1

  constructor(private readonly limits: { maxImages: number; maxBytes: number } = {
    maxImages: Number.POSITIVE_INFINITY,
    maxBytes: Number.POSITIVE_INFINITY,
  }) {}

  get size(): number {
    return this.images.length
  }

  add(input: SaveImageAttachment): string {
    if (this.images.length >= this.limits.maxImages) {
      throw new Error(`An input can contain at most ${String(this.limits.maxImages)} images.`)
    }
    const totalBytes = this.images.reduce((total, image) => total + image.input.data.byteLength, 0)
    if (totalBytes + input.data.byteLength > this.limits.maxBytes) {
      throw new Error(`Draft images exceed the ${String(this.limits.maxBytes)} byte message limit.`)
    }
    const index = this.nextIndex++
    const marker = `[Image #${index}]`
    this.images.push({ index, marker, input })
    return `${marker} `
  }

  /** Detach the current draft, retaining only images whose markers remain in the submitted text. */
  take(text: string): ImagePasteSubmission {
    const images = this.images
      .map(image => ({ image, position: text.indexOf(image.marker) }))
      .filter(match => match.position >= 0)
      .sort((left, right) => left.position - right.position)
      .map(match => match.image)
    this.clear()
    return { images }
  }

  /** Restore a failed submission only when no newer draft images would be overwritten. */
  restore(submission: ImagePasteSubmission): boolean {
    if (this.images.length > 0 || submission.images.length === 0) return false
    this.images = [...submission.images]
    this.nextIndex = Math.max(...this.images.map(image => image.index)) + 1
    return true
  }

  /** Remove this draft's generated markers from editor text, then release its bytes. */
  discardFrom(text: string): string {
    let next = text
    for (const image of this.images) {
      next = next.replaceAll(`${image.marker} `, '').replaceAll(image.marker, '')
    }
    this.clear()
    return next
  }

  clear(): void {
    this.images = []
    this.nextIndex = 1
  }
}

/** Extract one supported local image path from a complete terminal bracketed-paste payload. */
export function pastedImageFilePath(data: string): string | null {
  const match = /^\x1b\[200~([\s\S]*)\x1b\[201~$/u.exec(data)
  if (match === null) return null

  let value = (match[1] ?? '').trim()
  if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  if (value === '' || /[\r\n\0]/u.test(value)) return null
  if (value.startsWith('file://')) {
    try {
      value = fileURLToPath(value)
    } catch {
      return null
    }
  }
  return IMAGE_MEDIA_TYPE_BY_EXTENSION[extname(value).toLowerCase()] === undefined ? null : value
}

/** Load one pasted image file as an in-memory composer attachment. */
export async function readPastedImageFile(
  filePath: string,
  maxBytes: number = DEFAULT_MAX_IMAGE_BYTES,
  mediaTypes: readonly ImageMediaType[] = SUPPORTED_IMAGE_MIME_TYPES,
): Promise<SaveImageAttachment> {
  const mediaType = IMAGE_MEDIA_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()]
  if (mediaType === undefined || !mediaTypes.includes(mediaType)) {
    throw new Error(`Unsupported pasted image file: ${filePath}`)
  }
  const data = await readFile(filePath)
  if (data.byteLength > maxBytes) throw imageLimitError(maxBytes)
  return { data, mediaType, name: basename(filePath) }
}

/** Match the image-paste shortcuts used by the reference extension without stealing Windows text paste. */
export function isImagePasteShortcut(data: string, platform: NodeJS.Platform = process.platform): boolean {
  const shortcuts: readonly KeyId[] = platform === 'win32'
    ? ['alt+v', 'ctrl+alt+v']
    : ['ctrl+v', 'alt+v', 'ctrl+alt+v']
  return shortcuts.some(shortcut => matchesKey(data, shortcut))
}

/** Convert one detached draft to the wire form expected by dsh command execution. */
export function encodeImageSubmission(submission: ImagePasteSubmission): EncodedImageAttachment[] {
  return submission.images.map(({ input }) => ({
    mediaType: input.mediaType,
    data: Buffer.from(input.data.buffer as ArrayBuffer, input.data.byteOffset, input.data.byteLength).toString('base64'),
    ...(input.name === undefined ? {} : { name: input.name }),
  }))
}

let cachedNativeClipboard: NativeClipboard | null | undefined

function loadNativeClipboard(): NativeClipboard | null {
  if (cachedNativeClipboard !== undefined) return cachedNativeClipboard
  try {
    cachedNativeClipboard = require('@mariozechner/clipboard') as NativeClipboard
  } catch {
    cachedNativeClipboard = null
  }
  return cachedNativeClipboard
}

function commandRunner(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  maxBufferBytes: number,
): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true })
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    let overflow = false

    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const terminate = (overflow = false): void => {
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.kill()
      finish({ ok: false, stdout: Buffer.alloc(0), missingCommand: false, overflow })
    }
    const timer = setTimeout(() => { terminate() }, timeoutMs)
    child.stderr?.resume()

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxBufferBytes) {
        overflow = true
        terminate(true)
        return
      }
      chunks.push(buffer)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        stdout: Buffer.alloc(0),
        missingCommand: error.code === 'ENOENT',
      })
    })
    child.on('close', code => {
      finish({
        ok: code === 0 && !overflow,
        stdout: overflow ? Buffer.alloc(0) : Buffer.concat(chunks),
        missingCommand: false,
        overflow,
      })
    })
  })
}

function normalizedMimeType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? value.trim().toLowerCase()
}

function preferredMimeType(
  values: readonly string[],
  mediaTypes: readonly ImageMediaType[],
): ImageMediaType | undefined {
  const normalized = values.map(normalizedMimeType)
  return mediaTypes.find(type => normalized.includes(type))
}

function imageLimitError(maxBytes: number): Error {
  return new Error(`Clipboard image exceeds the ${String(maxBytes)} byte attachment limit.`)
}

function boundedImage(
  data: Uint8Array,
  mediaType: ImageMediaType,
  maxBytes: number,
): SaveImageAttachment | null {
  if (data.length === 0) return null
  if (data.length > maxBytes) throw imageLimitError(maxBytes)
  const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice('image/'.length)
  return { data, mediaType, name: `clipboard.${extension}` }
}

async function readNativeClipboard(
  clipboard: NativeClipboard | null,
  maxBytes: number,
): Promise<ClipboardReaderResult> {
  if (clipboard === null) return { available: false, image: null }
  let value: Array<number> | Uint8Array
  try {
    if (!clipboard.hasImage()) return { available: true, image: null }
    value = await clipboard.getImageBinary()
  } catch {
    return { available: false, image: null }
  }
  const data = value instanceof Uint8Array ? value : Uint8Array.from(value)
  return { available: true, image: boundedImage(data, 'image/png', maxBytes) }
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function readWindowsClipboard(
  run: CommandRunner,
  maxBytes: number,
  mediaTypes: readonly ImageMediaType[],
): Promise<ClipboardReaderResult> {
  const extensions = Object.entries(IMAGE_MEDIA_TYPE_BY_EXTENSION)
    .filter(([, mediaType]) => mediaTypes.includes(mediaType))
    .map(([extension]) => '\'' + extension + '\'')
    .join(', ')
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image) { return }
  $stream = New-Object System.IO.MemoryStream
  try {
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $result = @{ mediaType = 'image/png'; name = 'clipboard.png'; data = [Convert]::ToBase64String($stream.ToArray()) }
    [Console]::Out.Write(($result | ConvertTo-Json -Compress))
  } finally {
    $stream.Dispose()
    $image.Dispose()
  }
  return
}
if (-not [System.Windows.Forms.Clipboard]::ContainsFileDropList()) { return }
$allowed = @(${extensions})
foreach ($path in [System.Windows.Forms.Clipboard]::GetFileDropList()) {
  $extension = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($allowed -notcontains $extension) { continue }
  $mediaType = switch ($extension) {
    '.png' { 'image/png' }
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.webp' { 'image/webp' }
    '.gif' { 'image/gif' }
  }
  $result = @{
    mediaType = $mediaType
    name = [System.IO.Path]::GetFileName($path)
    data = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
  }
  [Console]::Out.Write(($result | ConvertTo-Json -Compress))
  return
}`
  const maxBufferBytes = Math.ceil(maxBytes * 4 / 3) + 4096
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-STA',
    '-EncodedCommand',
    encodePowerShell(script),
  ], READ_TIMEOUT_MS, maxBufferBytes)
  if (result.missingCommand) return { available: false, image: null }
  if (result.overflow === true) throw imageLimitError(maxBytes)
  if (!result.ok) return { available: true, image: null }
  const output = result.stdout.toString('utf8').trim()
  if (output === '') return { available: true, image: null }

  // Accept the old bare-base64 form for embedding runners that still provide it.
  if (!output.startsWith('{')) {
    return { available: true, image: boundedImage(Buffer.from(output, 'base64'), 'image/png', maxBytes) }
  }
  try {
    const value = JSON.parse(output) as { data?: unknown; mediaType?: unknown; name?: unknown }
    if (typeof value.data !== 'string' || typeof value.mediaType !== 'string' || typeof value.name !== 'string') {
      return { available: true, image: null }
    }
    if (!mediaTypes.includes(value.mediaType as ImageMediaType)) return { available: true, image: null }
    const image = boundedImage(Buffer.from(value.data, 'base64'), value.mediaType as ImageMediaType, maxBytes)
    return { available: true, image: image === null ? null : { ...image, name: value.name } }
  } catch {
    return { available: true, image: null }
  }
}

async function readWlPaste(
  run: CommandRunner,
  maxBytes: number,
  mediaTypes: readonly ImageMediaType[],
): Promise<ClipboardReaderResult> {
  const types = await run('wl-paste', ['--list-types'], LIST_TYPES_TIMEOUT_MS, 64 * 1024)
  if (types.missingCommand) return { available: false, image: null }
  if (!types.ok) return { available: true, image: null }
  const mediaType = preferredMimeType(types.stdout.toString('utf8').split(/\r?\n/u), mediaTypes)
  if (mediaType === undefined) return { available: true, image: null }
  const image = await run('wl-paste', ['--type', mediaType, '--no-newline'], READ_TIMEOUT_MS, maxBytes + 1)
  if (image.overflow === true) throw imageLimitError(maxBytes)
  if (!image.ok) return { available: true, image: null }
  return { available: true, image: boundedImage(image.stdout, mediaType, maxBytes) }
}

async function readXclip(
  run: CommandRunner,
  maxBytes: number,
  mediaTypes: readonly ImageMediaType[],
): Promise<ClipboardReaderResult> {
  const targets = await run(
    'xclip',
    ['-selection', 'clipboard', '-t', 'TARGETS', '-o'],
    LIST_TYPES_TIMEOUT_MS,
    64 * 1024,
  )
  if (targets.missingCommand) return { available: false, image: null }
  const advertised = targets.ok
    ? targets.stdout.toString('utf8').split(/\r?\n/u)
    : []
  const preferred = preferredMimeType(advertised, mediaTypes)
  const candidates = [...new Set([
    ...(preferred === undefined ? [] : [preferred]),
    ...mediaTypes,
  ])]
  for (const mediaType of candidates) {
    const image = await run(
      'xclip',
      ['-selection', 'clipboard', '-t', mediaType, '-o'],
      READ_TIMEOUT_MS,
      maxBytes + 1,
    )
    if (image.overflow === true) throw imageLimitError(maxBytes)
    if (image.ok && image.stdout.length > 0) {
      return { available: true, image: boundedImage(image.stdout, mediaType, maxBytes) }
    }
  }
  return { available: true, image: null }
}

function unavailableMessage(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'No Windows clipboard image reader is available.'
  if (platform === 'darwin') return 'No macOS clipboard image reader is available.'
  if (platform === 'linux') return 'Install wl-clipboard or xclip, or enable the native clipboard package.'
  return `Clipboard image paste is not supported on ${platform}.`
}

/** Read one clipboard image without persisting it. */
export async function readClipboardImage(options: ReadClipboardImageOptions = {}): Promise<SaveImageAttachment | null> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES
  const mediaTypes = options.mediaTypes ?? SUPPORTED_IMAGE_MIME_TYPES
  const run = options.runCommand ?? commandRunner
  const nativeClipboard = Object.hasOwn(options, 'nativeClipboard')
    ? options.nativeClipboard ?? null
    : loadNativeClipboard()

  if (environment.TERMUX_VERSION !== undefined) return null
  if (platform === 'linux' && environment.DISPLAY === undefined && environment.WAYLAND_DISPLAY === undefined) {
    throw new Error('Clipboard image paste requires a graphical Linux session.')
  }

  const results: ClipboardReaderResult[] = []
  const attempt = async (reader: () => Promise<ClipboardReaderResult>): Promise<SaveImageAttachment | null> => {
    const result = await reader()
    results.push(result)
    return result.image
  }

  if (platform === 'win32') {
    const native = await attempt(() => readNativeClipboard(nativeClipboard, maxBytes))
    if (native !== null) return native
    const powershell = await attempt(() => readWindowsClipboard(run, maxBytes, mediaTypes))
    if (powershell !== null) return powershell
  } else if (platform === 'linux') {
    const readers = environment.WAYLAND_DISPLAY !== undefined || environment.XDG_SESSION_TYPE === 'wayland'
      ? [readWlPaste, readXclip]
      : [readXclip, readWlPaste]
    for (const reader of readers) {
      const image = await attempt(() => reader(run, maxBytes, mediaTypes))
      if (image !== null) return image
    }
    const native = await attempt(() => readNativeClipboard(nativeClipboard, maxBytes))
    if (native !== null) return native
  } else {
    const native = await attempt(() => readNativeClipboard(nativeClipboard, maxBytes))
    if (native !== null) return native
  }

  if (results.some(result => result.available)) return null
  throw new Error(unavailableMessage(platform))
}
