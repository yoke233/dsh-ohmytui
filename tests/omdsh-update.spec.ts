import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  downloadNpmTarball,
  fetchLatestNpmPackage,
  npmPackageVersion,
} from '../scripts/omdsh-update.js'

const bytes = Buffer.from('packed omdsh fixture')
const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`
const packageMetadata = {
  version: '0.6.1',
  dist: {
    tarball: 'https://registry.npmjs.org/@yoke233/omdsh/-/omdsh-0.6.1.tgz',
    integrity,
  },
}

describe('omdsh npm updater', () => {
  it('validates the latest package version and distribution metadata', () => {
    assert.equal(npmPackageVersion(packageMetadata), '0.6.1')
    assert.throws(() => npmPackageVersion({ ...packageMetadata, version: 'latest' }), /invalid version/)
    assert.throws(
      () => npmPackageVersion({ ...packageMetadata, dist: { ...packageMetadata.dist, integrity: undefined } }),
      /SHA-512 integrity/,
    )
  })

  it('fetches the public npm latest endpoint without GitHub credentials', async () => {
    let requested = ''
    const result = await fetchLatestNpmPackage({
      fetchImpl: async (url) => {
        requested = String(url)
        return new Response(JSON.stringify(packageMetadata), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    assert.equal(requested, 'https://registry.npmjs.org/@yoke233%2Fomdsh/latest')
    assert.equal(result.version, '0.6.1')
  })

  it('verifies npm integrity and atomically stores the tarball', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-update-test-'))
    try {
      const result = await downloadNpmTarball(packageMetadata, destination, {
        fetchImpl: async () => new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.length) },
        }),
      })
      assert.equal(result.version, '0.6.1')
      assert.deepEqual(fs.readFileSync(result.path), bytes)
      assert.deepEqual(fs.readdirSync(destination), ['yoke233-omdsh-0.6.1.tgz'])
    } finally {
      fs.rmSync(destination, { recursive: true, force: true })
    }
  })

  it('rejects a tarball whose npm integrity does not match', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-update-test-'))
    try {
      await assert.rejects(
        downloadNpmTarball({
          ...packageMetadata,
          dist: { ...packageMetadata.dist, integrity: `sha512-${Buffer.alloc(64).toString('base64')}` },
        }, destination, { fetchImpl: async () => new Response(bytes, { status: 200 }) }),
        /integrity mismatch/,
      )
      assert.deepEqual(fs.readdirSync(destination), [])
    } finally {
      fs.rmSync(destination, { recursive: true, force: true })
    }
  })
})
