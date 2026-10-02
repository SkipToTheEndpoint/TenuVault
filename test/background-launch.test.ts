import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { BackgroundLaunch, launchAgent, WINDOWS_TASK } from '../src/main/backup/background-launch'
it('uses an interactive non-elevated Windows task with login, catch-up and overlap protection', () => {
  expect(WINDOWS_TASK).toContain('-LogonType Interactive -RunLevel Limited')
  expect(WINDOWS_TASK).toContain('-AtLogOn')
  expect(WINDOWS_TASK).toContain('-StartWhenAvailable -MultipleInstances IgnoreNew')
  expect(WINDOWS_TASK).not.toContain('-Password')
})
it('installs and removes a user-session launch agent without interpolating executable text as code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tv-background-'))
  let loaded = false
  const exec = vi.fn(async (_file: string, args: string[]) => {
    if (args[0] === 'print' && !loaded) throw new Error('Could not find service')
    if (args[0] === 'bootstrap') loaded = true
    if (args[0] === 'bootout') loaded = false
    return { stdout: '/usr/bin/open /Applications/A&B.app' }
  })
  const launcher = new BackgroundLaunch({ platform: 'darwin', packaged: true, executable: '/Applications/A&B.app/Contents/MacOS/A&B', home: root, data: root, uid: 501, exec })
  try {
    expect(await launcher.install()).toEqual({ supported: true, installed: true })
    const plist = await readFile(join(root, 'Library/LaunchAgents/com.tenuvault.desktop.background.plist'), 'utf8')
    expect(plist).toContain('A&amp;B')
    expect(plist).toContain('<string>Aqua</string>')
    expect(exec.mock.calls.find(call => call[1][0] === 'bootstrap')).toEqual(['/bin/launchctl', ['bootstrap', 'gui/501', join(root, 'Library/LaunchAgents/com.tenuvault.desktop.background.plist')]])
    loaded = false
    expect(await launcher.status()).toEqual({ supported: true, installed: false })
    expect(await launcher.install()).toEqual({ supported: true, installed: true })
    expect(await launcher.remove()).toEqual({ supported: true, installed: false })
    expect(exec.mock.calls.some(call => call[1][0] === 'bootout')).toBe(true)
    expect(plist).toContain('<string>/usr/bin/open</string>')
    expect(plist).not.toContain('/Contents/MacOS/')
    expect(exec.mock.calls.some(call => call[1][0] === 'disable')).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('does not install on unsupported platforms or development builds', async () => {
  const exec = vi.fn(async () => ({ stdout: '' }))
  const launcher = new BackgroundLaunch({ platform: 'linux', packaged: true, executable: '/app', home: '/unused', data: '/unused', exec })
  await expect(launcher.install()).rejects.toThrow('installed Windows or macOS')
  expect(exec).not.toHaveBeenCalled()
  expect(launchAgent('/Applications/Test.app/Contents/MacOS/Test')).toContain('<integer>300</integer>')
})
it('replaces a stale launch helper after the application bundle moves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tv-background-move-'))
  let loaded: string | null = null
  const exec = vi.fn(async (_file: string, args: string[]) => {
    if (args[0] === 'print') { if (!loaded) throw new Error('Could not find service'); return { stdout: loaded } }
    if (args[0] === 'bootout') loaded = null
    if (args[0] === 'bootstrap') loaded = (await readFile(args[2]!, 'utf8')).replace(/&amp;/g, '&')
    return { stdout: '' }
  })
  const options = { platform: 'darwin' as const, packaged: true, home: root, data: root, uid: 501, exec }
  try {
    await new BackgroundLaunch({ ...options, executable: '/Applications/Old.app/Contents/MacOS/Old' }).install()
    const moved = new BackgroundLaunch({ ...options, executable: '/Applications/New.app/Contents/MacOS/New' })
    expect((await moved.status()).installed).toBe(false)
    expect((await moved.install()).installed).toBe(true)
    expect(exec.mock.calls.filter(call => call[1][0] === 'bootout')).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('removes a legacy direct-launch agent without terminating its running app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tv-background-legacy-'))
  const plist = join(root, 'Library/LaunchAgents/com.tenuvault.desktop.background.plist')
  const exec = vi.fn(async (_file: string, _args: string[]) => ({ stdout: '/Applications/Old.app/Contents/MacOS/Old' }))
  const launcher = new BackgroundLaunch({ platform: 'darwin', packaged: true, executable: '/Applications/New.app/Contents/MacOS/New', home: root, data: root, uid: 501, exec })
  try {
    await mkdir(join(root, 'Library/LaunchAgents'), { recursive: true })
    await writeFile(plist, 'legacy direct-launch definition')
    expect((await launcher.status()).installed).toBe(true)
    expect((await launcher.remove()).installed).toBe(false)
    await expect(readFile(plist)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(exec.mock.calls).toContainEqual(['/bin/launchctl', ['disable', 'gui/501/com.tenuvault.desktop.background']])
    expect(exec.mock.calls).not.toContainEqual(['/bin/launchctl', ['bootout', 'gui/501/com.tenuvault.desktop.background']])
    await expect(launcher.install()).rejects.toThrow('before reinstalling')
  } finally { await rm(root, { recursive: true, force: true }) }
})
