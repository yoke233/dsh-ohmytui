import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const GITHUB_REPOSITORY = 'yoke233/omdsh'
const MAX_TARBALL_BYTES = 50 * 1024 * 1024

function githubHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    'User-Agent': 'omdsh-updater',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token === undefined || token === '' ? {} : { Authorization: `Bearer ${token}` }),
  }
}

export function releaseVersion(release) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : ''
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`GitHub latest release has an invalid tag: ${tag || '<missing>'}`)
  }
  return tag.slice(1)
}

export function selectReleaseAsset(release) {
  const expectedName = `yoke233-omdsh-${releaseVersion(release)}.tgz`
  const matches = Array.isArray(release?.assets)
    ? release.assets.filter(asset => asset?.name === expectedName)
    : []
  if (matches.length !== 1) {
    throw new Error(`GitHub release must contain exactly one ${expectedName} asset; found ${matches.length}`)
  }
  const asset = matches[0]
  if (typeof asset.browser_download_url !== 'string' || asset.browser_download_url === '') {
    throw new Error('GitHub release tarball has no download URL')
  }
  if (typeof asset.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
    throw new Error('GitHub release tarball has no valid SHA-256 digest')
  }
  return asset
}

export async function fetchLatestRelease(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch()')
  const repository = options.repository ?? GITHUB_REPOSITORY
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: githubHeaders(options.token),
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`GitHub latest release request failed: HTTP ${response.status}`)
  const release = await response.json()
  releaseVersion(release)
  selectReleaseAsset(release)
  return release
}

export async function downloadReleaseAsset(release, destinationDir, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const asset = selectReleaseAsset(release)
  const response = await fetchImpl(asset.browser_download_url, {
    headers: githubHeaders(options.token, 'application/octet-stream'),
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`GitHub release download failed: HTTP ${response.status}`)
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_TARBALL_BYTES) {
    throw new Error(`GitHub release tarball exceeds ${MAX_TARBALL_BYTES} bytes`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_TARBALL_BYTES) throw new Error(`GitHub release tarball exceeds ${MAX_TARBALL_BYTES} bytes`)

  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
    const expected = asset.digest.slice('sha256:'.length).toLowerCase()
    const actual = crypto.createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) throw new Error(`GitHub release checksum mismatch: expected ${expected}, got ${actual}`)
  }

  fs.mkdirSync(destinationDir, { recursive: true })
  const destination = path.join(destinationDir, asset.name)
  const temporary = path.join(destinationDir, `.${asset.name}.${process.pid}.tmp`)
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    fs.rmSync(destination, { force: true })
    fs.renameSync(temporary, destination)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
  return { path: destination, version: releaseVersion(release), asset }
}
