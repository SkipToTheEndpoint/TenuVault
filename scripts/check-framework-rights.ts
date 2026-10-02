import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

/** Git may check out CRLF on Windows; the reviewed content hash uses canonical LF text. */
function contentHash(file: string): string {
  return createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
}

/** Fail the actual Electron build if a provider changes without a recorded content review. */
export function checkFrameworkRights(root: string): void {
  const base = resolve(root, 'src/shared/compliance')
  const manifest = JSON.parse(readFileSync(resolve(base, 'rights.json'), 'utf8')) as { providers: { file: string; sha256: string; distributionDecision: string }[]; dataFiles: { file: string; sha256: string }[] }
  const approved = new Set(manifest.providers.map(p => p.file))
  for (const file of readdirSync(resolve(base, 'frameworks')).filter(f => f.endsWith('.ts'))) {
    if (!approved.has(file)) throw new Error(`Framework ${file} has no reviewed rights entry.`)
  }
  for (const provider of manifest.providers) {
    if (provider.distributionDecision !== 'included' || !/^[a-z0-9-]+\.ts$/.test(provider.file)) throw new Error('Unresolved framework content cannot be packaged.')
    const hash = contentHash(resolve(base, 'frameworks', provider.file))
    if (hash !== provider.sha256) throw new Error(`Framework ${provider.file} changed. Review content rights and update its provenance hash.`)
  }
  for (const data of manifest.dataFiles) {
    if (!/^frameworks\/[a-z0-9-]+\.json$/.test(data.file) || contentHash(resolve(base, data.file)) !== data.sha256) throw new Error('Framework dataset changed without a recorded rights review.')
  }
  const notices = readFileSync(resolve(root, 'resources/framework-NOTICES.txt'), 'utf8')
  if (!notices.includes('Elastic License 2.0') || !notices.includes('CC BY 4.0') || !notices.includes('Open Government Licence')) throw new Error('Framework distribution notices are incomplete.')
}
