import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const NPM_LATEST_URL = 'https://registry.npmjs.org/@yoke233%2Fomdsh/latest'
const MAX_TARBALL_BYTES = 50 * 1024 * 1024
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

function distribution(metadata) {
  const dist = metadata?.dist
  const tarball = typeof dist?.tarball === 'string' ? dist.tarball : ''
  const integrity = typeof dist?.integrity === 'string' ? dist.integrity : ''
  let tarballUrl
  try {
    tarballUrl = new URL(tarball)
  } catch {
    throw new Error('npm latest package has no valid tarball URL')
  }
  if (tarballUrl.protocol !== 'https:') {
    throw new Error('npm latest package tarball URL must use HTTPS')
  }
  const sha512 = integrity.split(/\s+/).find(value => /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value))
  if (sha512 === undefined || Buffer.from(sha512.slice('sha512-'.length), 'base64').length !== 64) {
    throw new Error('npm latest package has no valid SHA-512 integrity')
  }
  return { tarballUrl: tarballUrl.href, integrity: sha512 }
}

export function npmPackageVersion(metadata) {
  const version = typeof metadata?.version === 'string' ? metadata.version : ''
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`npm latest package has an invalid version: ${version || '<missing>'}`)
  }
  distribution(metadata)
  return version
}

export async function fetchLatestNpmPackage(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch()')
  const response = await fetchImpl(options.registryUrl ?? NPM_LATEST_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'omdsh-updater',
    },
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`npm latest package request failed: HTTP ${response.status}`)
  const metadata = await response.json()
  npmPackageVersion(metadata)
  return metadata
}

export async function downloadNpmTarball(metadata, destinationDir, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch()')
  const version = npmPackageVersion(metadata)
  const dist = distribution(metadata)
  const response = await fetchImpl(dist.tarballUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'omdsh-updater',
    },
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`npm tarball download failed: HTTP ${response.status}`)
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_TARBALL_BYTES) {
    throw new Error(`npm tarball exceeds ${MAX_TARBALL_BYTES} bytes`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_TARBALL_BYTES) throw new Error(`npm tarball exceeds ${MAX_TARBALL_BYTES} bytes`)

  const expected = Buffer.from(dist.integrity.slice('sha512-'.length), 'base64')
  const actual = crypto.createHash('sha512').update(bytes).digest()
  if (!crypto.timingSafeEqual(actual, expected)) {
    throw new Error(`npm tarball integrity mismatch for @yoke233/omdsh@${version}`)
  }

  fs.mkdirSync(destinationDir, { recursive: true })
  const assetName = `yoke233-omdsh-${version}.tgz`
  const destination = path.join(destinationDir, assetName)
  const temporary = path.join(destinationDir, `.${assetName}.${process.pid}.tmp`)
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    fs.rmSync(destination, { force: true })
    fs.renameSync(temporary, destination)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
  return { path: destination, version, integrity: dist.integrity }
}
