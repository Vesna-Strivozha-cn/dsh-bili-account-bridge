import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** 两侧文件字段名一样（都是小写），但"该写哪几个"不一样。 */
export const SIDES = ['whale', 'dafeiyu']

const str = (v) => (typeof v === 'string' ? v.trim() : '')

/** 指纹只表示"是不是同一份登录态"，不泄露内容。 */
export function fingerprint(cookie) {
  if (!cookie) return ''
  return crypto.createHash('sha256')
    .update('v1|' + (cookie.sessdata || '') + '|' + (cookie.bili_jct || ''))
    .digest('hex').slice(0, 16)
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const cookie = {
    sessdata: str(raw.sessdata || raw.SESSDATA),
    bili_jct: str(raw.bili_jct || raw.BILI_JCT),
    buvid3: str(raw.buvid3 || raw.BUVID3),
    dedeuserid: str(raw.dedeuserid || raw.DedeUserID),
  }
  if (!cookie.sessdata || !cookie.bili_jct) return null
  return cookie
}

export function readSide(side, file) {
  let text = null
  let st = null
  try { text = fs.readFileSync(file, 'utf8'); st = fs.statSync(file) }
  catch (e) {
    return { side, file, exists: false, cookie: null, fp: '', mtimeMs: 0, error: e?.code || 'read-failed', raw: null }
  }
  let raw = null
  try { raw = JSON.parse(text) } catch { raw = null }
  const cookie = normalize(raw)
  return {
    side, file, exists: true, raw, cookie, fp: fingerprint(cookie),
    mtimeMs: st.mtimeMs, bytes: st.size,
    error: cookie ? '' : 'credential-incomplete',
  }
}

/** 写回时保留原文件里的其它键，只覆盖凭据字段。 */
export function shapeFor(side, cookie, raw) {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  const out = { ...base, sessdata: cookie.sessdata, bili_jct: cookie.bili_jct, buvid3: cookie.buvid3 || '' }
  if (side === 'dafeiyu') out.dedeuserid = cookie.dedeuserid || ''
  else if (cookie.dedeuserid) out.dedeuserid = cookie.dedeuserid
  return out
}

function backup(file, dir, side) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = path.join(dir, stamp + '-' + side + '.json')
    fs.copyFileSync(file, dest)
    try { fs.chmodSync(dest, 0o600) } catch {}
    return dest
  } catch { return null }
}

/** 原子写：临时文件 + fsync + rename；覆盖前先备份。 */
export function writeSide(side, file, cookie, { backupDir, raw = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = JSON.stringify(shapeFor(side, cookie, raw), null, 2) + '\n'
  const saved = backupDir && fs.existsSync(file) ? backup(file, backupDir, side) : null
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeFileSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch {}
  return { ok: true, side, file, bytes: Buffer.byteLength(body), backup: saved }
}
