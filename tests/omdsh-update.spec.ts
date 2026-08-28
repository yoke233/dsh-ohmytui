import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  downloadReleaseAsset,
  fetchLatestRelease,
  releaseVersion,
  selectReleaseAsset,
} from '../scripts/omdsh-update.js'

const bytes = Buffer.from('packed omdsh fixture')
const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`
const release = {
  tag_name: 'v0.6.0',
  assets: [{
    name: 'yoke233-omdsh-0.6.0.tgz',
    browser_download_url: 'https://example.test/yoke233-omdsh-0.6.0.tgz',
    digest,
  }],
}

describe('omdsh GitHub updater', () => {
  it('selects the single scoped-package release asset and version', () => {
    assert.equal(releaseVersion(release), '0.6.0')
    assert.equal(selectReleaseAsset(release).name, 'yoke233-omdsh-0.6.0.tgz')
    assert.throws(() => selectReleaseAsset({ ...release, assets: [] }), /exactly one/)
    assert.throws(
      () => selectReleaseAsset({ ...release, assets: [{ ...release.assets[0], digest: undefined }] }),
      /SHA-256 digest/,
    )
    assert.throws(() => releaseVersion({ ...release, tag_name: 'latest' }), /invalid tag/)
  })

  it('fetches release metadata from the configured GitHub repository', async () => {
    let requested = ''
    const result = await fetchLatestRelease({
      repository: 'owner/repository',
      fetchImpl: async (url) => {
        requested = String(url)
        return new Response(JSON.stringify(release), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    assert.equal(requested, 'https://api.github.com/repos/owner/repository/releases/latest')
    assert.equal(result.tag_name, 'v0.6.0')
  })

  it('verifies and atomically stores the release tarball', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-update-test-'))
    try {
      const result = await downloadReleaseAsset(release, destination, {
        fetchImpl: async () => new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.length) },
        }),
      })
      assert.equal(result.version, '0.6.0')
      assert.deepEqual(fs.readFileSync(result.path), bytes)
      assert.deepEqual(fs.readdirSync(destination), ['yoke233-omdsh-0.6.0.tgz'])
    } finally {
      fs.rmSync(destination, { recursive: true, force: true })
    }
  })

  it('rejects a release asset whose digest does not match', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-update-test-'))
    try {
      await assert.rejects(
        downloadReleaseAsset({
          ...release,
          assets: [{ ...release.assets[0], digest: `sha256:${'0'.repeat(64)}` }],
        }, destination, { fetchImpl: async () => new Response(bytes, { status: 200 }) }),
        /checksum mismatch/,
      )
      assert.deepEqual(fs.readdirSync(destination), [])
    } finally {
      fs.rmSync(destination, { recursive: true, force: true })
    }
  })
})
