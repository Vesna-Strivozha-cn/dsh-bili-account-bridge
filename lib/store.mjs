import fs from 'node:fs'
import path from 'node:path'

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeFileSync(fd, JSON.stringify(obj, null, 2) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch {}
  return true
}

/** 单写者锁：跨进程也认（两个插件 + 桥可能同时想写）。 */
export function acquireLock(file, { staleMs = 15000 } = {}) {
  try {
    const fd = fs.openSync(file, 'wx')
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
    fs.closeSync(fd)
    let released = false
    return () => {
      if (released) return
      released = true
      try { fs.unlinkSync(file) } catch {}
    }
  } catch (e) {
    if (e?.code !== 'EEXIST') return null
    try {
      const st = fs.statSync(file)
      if (Date.now() - st.mtimeMs > staleMs) { fs.unlinkSync(file); return acquireLock(file, { staleMs }) }
    } catch {}
    return null
  }
}

export function appendEvent(file, event, { maxBytes = 512 * 1024 } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      const st = fs.statSync(file)
      if (st.size > maxBytes) {
        const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-200).join('\n') + '\n'
        fs.writeFileSync(file, keep)
      }
    } catch {}
    fs.appendFileSync(file, JSON.stringify(event) + '\n')
  } catch {}
}

export function readEvents(file, limit = 30) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
  } catch { return [] }
}
