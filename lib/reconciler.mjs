import fs from 'node:fs'
import path from 'node:path'
import { readSide, writeSide, fingerprint, SIDES } from './adapters.mjs'
import { verifyCookie } from './verify.mjs'
import { readJson, writeJsonAtomic, acquireLock, appendEvent, readEvents } from './store.mjs'

/** 文件刚被写过就不碰：那是插件自己在写，抢着写只会把两边登录态搅坏。 */
const RECENT_WRITE_MS = 2500
/** 同一份 cookie 的验证结果缓存 5 分钟，别每 10 秒打一次 nav。 */
const VERIFY_TTL_MS = 5 * 60 * 1000
/** 对方"刚写过但验不过"的容忍次数：约 3 个 tick 后才判它真的坏了。 */
const SETTLE_TICKS = 3
const LABEL = { whale: '养鱼', dafeiyu: '大肥鱼' }

export function createReconciler({ paths, verify = verifyCookie, log = () => {}, now = () => Date.now() }) {
  const cache = new Map()
  const settle = { whale: 0, dafeiyu: 0 }
  let busy = false
  let timer = null
  let watchers = []
  let debounce = null
  let paused = false
  let last = {
    status: 'init', message: '还没跑过一轮', at: 0, conflict: null,
    lastHealAt: 0, lastAdoptAt: 0, sides: {}, canonical: null, boundUid: '',
  }

  async function verifySide(side, sideState, force) {
    if (!sideState.cookie) return null
    const key = side + ':' + sideState.fp
    const hit = cache.get(key)
    if (!force && hit && now() - hit.at < VERIFY_TTL_MS) return hit.result
    const result = await verify(sideState.cookie)
    cache.set(key, { at: now(), result })
    return result
  }

  function readSides() {
    const out = {}
    for (const side of SIDES) out[side] = readSide(side, paths[side])
    return out
  }

  function saveStore(prev, { uid, uname, cookie, source }) {
    const next = {
      version: 1,
      uid: String(uid),
      uname: String(uname || prev?.uname || ''),
      cookie: {
        sessdata: cookie.sessdata,
        bili_jct: cookie.bili_jct,
        buvid3: cookie.buvid3 || '',
        dedeuserid: cookie.dedeuserid || String(uid),
      },
      fingerprint: fingerprint(cookie),
      generation: Number(prev?.generation || 0) + 1,
      updatedAt: now(),
      verifiedAt: now(),
      source,
    }
    writeJsonAtomic(paths.store, next)
    return next
  }

  function clearConflict() { try { fs.unlinkSync(paths.conflict) } catch {} }

  function setConflict(conflict) {
    writeJsonAtomic(paths.conflict, conflict)
    appendEvent(paths.events, { at: now(), kind: 'conflict', reason: conflict.kind, detail: conflict.message })
    log('冲突：' + conflict.message)
  }

  /**
   * 把 from 侧已验证的 cookie 推到 to 侧。
   * 三道闸：目标不是刚落盘的、能拿到锁、内容确实不同。任何一道过不去这轮就不写。
   */
  function mirror(from, to, sides, { force = false } = {}) {
    const src = sides[from]
    const dst = sides[to]
    if (!src.cookie) return { ok: false, reason: 'source-empty' }
    if (dst.exists && dst.fp === src.fp) return { ok: true, reason: 'already-same' }
    if (dst.exists && !force && now() - dst.mtimeMs < RECENT_WRITE_MS) return { ok: false, reason: 'target-recently-written' }
    const release = acquireLock(path.join(paths.dir, 'bridge.lock'))
    if (!release) return { ok: false, reason: 'locked' }
    try {
      const written = writeSide(to, paths[to], src.cookie, { backupDir: paths.history, raw: dst.raw })
      appendEvent(paths.events, {
        at: now(), kind: 'mirror', from, to, uid: src.cookie.dedeuserid || '',
        fp: readSide(to, paths[to]).fp, backup: written.backup || '',
      })
      log('把 ' + LABEL[from] + ' 的登录态同步到 ' + LABEL[to] + '（' + written.bytes + ' 字节）')
      return { ok: true, reason: 'written', backup: written.backup }
    } catch (e) {
      return { ok: false, reason: 'write-failed: ' + (e?.message || e) }
    } finally { release() }
  }

  function sideMeta(sides, v) {
    const meta = {}
    for (const s of SIDES) {
      meta[s] = {
        label: LABEL[s],
        path: paths[s],
        exists: sides[s].exists,
        fingerprint: sides[s].fp,
        uid: (v[s] && v[s].ok && v[s].uid) || (sides[s].cookie && sides[s].cookie.dedeuserid) || '',
        uname: (v[s] && v[s].ok && v[s].uname) || '',
        verified: Boolean(v[s] && v[s].ok),
        verifyError: v[s] && !v[s].ok ? (v[s].message || v[s].code) : '',
        mtime: sides[s].mtimeMs,
        error: sides[s].error || '',
      }
    }
    return meta
  }

  function snapshot(extra = {}) {
    return {
      ok: true, status: last.status, message: last.message, paused,
      boundUid: last.boundUid, canonical: last.canonical, sides: last.sides,
      conflict: last.conflict, updatedAt: last.at,
      lastHealAt: last.lastHealAt, lastAdoptAt: last.lastAdoptAt,
      events: readEvents(paths.events, 8),
      paths: { whale: paths.whale, dafeiyu: paths.dafeiyu, dir: paths.dir },
      ...extra,
    }
  }

  function finish(status, message, extra = {}) {
    last = { ...last, status, message, at: now(), ...extra }
    if (status === 'adopted' || status === 'healed') last.lastHealAt = now()
    return snapshot()
  }

  async function tick({ force = false, reason = 'auto' } = {}) {
    if (paused || busy) return snapshot()
    busy = true
    try {
      const store = readJson(paths.store) || null
      const binding = readJson(paths.binding) || null
      const bound = String(store?.uid || binding?.activeUid || '')
      const sides = readSides()
      const v = {}
      for (const side of SIDES) v[side] = await verifySide(side, sides[side], force)
      const present = SIDES.filter((s) => sides[s].cookie)
      const valid = present.filter((s) => v[s] && v[s].ok)
      const meta = sideMeta(sides, v)
      const base = { sides: meta, boundUid: bound, conflict: null }
      let canonical = store

      if (!present.length) {
        clearConflict()
        return finish('empty', '两边都还没有登录态：去任意一个插件的设置页扫码，桥会接住并铺到另一边。', base)
      }

      if (present.length === 1) {
        const only = present[0]
        const other = SIDES.find((s) => s !== only)
        if (!v[only].ok) {
          clearConflict()
          return finish('expired', LABEL[only] + ' 的登录态已失效（' + (v[only].message || v[only].code) + '），去它的设置页重新扫码。', base)
        }
        if (bound && v[only].uid !== bound) {
          const conflict = { kind: 'uid-mismatch', at: now(), boundUid: bound, accounts: [{ side: only, uid: v[only].uid, uname: v[only].uname }], message: '检测到 ' + LABEL[only] + ' 登进了另一个账号（' + v[only].uid + '），本机绑定的是 ' + bound + '：没有自动切换。' }
          setConflict(conflict)
          return finish('conflict', conflict.message, { ...base, conflict })
        }
        canonical = saveStore(store, { uid: v[only].uid, uname: v[only].uname, cookie: sides[only].cookie, source: only })
        const m = mirror(only, other, sides, { force })
        clearConflict()
        return finish(m.ok ? 'adopted' : 'adopted-partial',
          '从 ' + LABEL[only] + ' 接管了账号 ' + v[only].uid + '，' + (m.ok ? '已铺到' : '但还没铺到（' + m.reason + '）') + LABEL[other] + '。',
          { ...base, canonical, lastAdoptAt: now() })
      }

      const sameFile = sides.whale.fp === sides.dafeiyu.fp
      if (sameFile) {
        const probeSide = valid[0] || null
        const probe = probeSide ? v[probeSide] : null
        if (!probe) {
          clearConflict()
          return finish('expired', '两边是同一份登录态，但已经失效了：随便挑一边重新扫码。', base)
        }
        if (bound && probe.uid !== bound) {
          const conflict = { kind: 'uid-mismatch', at: now(), boundUid: bound, accounts: [{ side: 'both', uid: probe.uid, uname: probe.uname }], message: '当前登录的是 ' + probe.uid + '，本机账本绑定的是 ' + bound + '：需要你确认换号。' }
          setConflict(conflict)
          return finish('conflict', conflict.message, { ...base, conflict })
        }
        canonical = saveStore(store, { uid: probe.uid, uname: probe.uname, cookie: sides.whale.cookie, source: 'both' })
        clearConflict()
        return finish('ok', '两边一致，账号 ' + probe.uid + ' 在线。', { ...base, canonical })
      }

      if (valid.length === 2) {
        if (v.whale.uid === v.dafeiyu.uid) {
          const winner = sides.whale.mtimeMs >= sides.dafeiyu.mtimeMs ? 'whale' : 'dafeiyu'
          const loser = winner === 'whale' ? 'dafeiyu' : 'whale'
          if (bound && v[winner].uid !== bound) {
            const conflict = { kind: 'uid-mismatch', at: now(), boundUid: bound, accounts: [{ side: 'both', uid: v[winner].uid, uname: v[winner].uname }], message: '两边都登在 ' + v[winner].uid + '，本机绑定的是 ' + bound + '：没有自动切换。' }
            setConflict(conflict)
            return finish('conflict', conflict.message, { ...base, conflict })
          }
          canonical = saveStore(store, { uid: v[winner].uid, uname: v[winner].uname, cookie: sides[winner].cookie, source: winner })
          const m = mirror(winner, loser, sides, { force })
          if (m.ok) clearConflict()
          return finish(m.ok ? 'healed' : 'heal-pending',
            '同一账号两套 cookie：以较新的' + LABEL[winner] + '为准，' + (m.ok ? '已覆盖' : '这轮没覆盖（' + m.reason + '）') + LABEL[loser] + '。',
            { ...base, canonical })
        }
        const conflict = {
          kind: 'two-accounts', at: now(), boundUid: bound,
          accounts: [
            { side: 'whale', uid: v.whale.uid, uname: v.whale.uname },
            { side: 'dafeiyu', uid: v.dafeiyu.uid, uname: v.dafeiyu.uname },
          ],
          message: '两边登的是两个不同的账号（养鱼=' + v.whale.uid + '，大肥鱼=' + v.dafeiyu.uid + '）：一个字节都没写，等你定。',
        }
        setConflict(conflict)
        return finish('conflict', conflict.message, { ...base, conflict })
      }

      if (valid.length === 1) {
        const good = valid[0]
        const bad = SIDES.find((s) => s !== good)
        const badState = sides[bad]
        if (bound && v[good].uid !== bound) {
          const conflict = { kind: 'uid-mismatch', at: now(), boundUid: bound, accounts: [{ side: good, uid: v[good].uid, uname: v[good].uname }], message: '有效的那份属于 ' + v[good].uid + '，本机绑定的是 ' + bound + '：没有自动切换。' }
          setConflict(conflict)
          return finish('conflict', conflict.message, { ...base, conflict })
        }
        if (badState.mtimeMs > sides[good].mtimeMs && settle[bad] < SETTLE_TICKS && !force) {
          settle[bad] += 1
          return finish('settling', LABEL[bad] + ' 刚写过登录态但还验不过（' + (badState.error || '未登录') + '），先等它落定（' + settle[bad] + '/' + SETTLE_TICKS + '）。', base)
        }
        canonical = saveStore(store, { uid: v[good].uid, uname: v[good].uname, cookie: sides[good].cookie, source: good })
        const m = mirror(good, bad, sides, { force })
        if (m.ok) { settle[bad] = 0; clearConflict() }
        return finish(m.ok ? 'healed' : 'heal-pending',
          LABEL[bad] + ' 的登录态坏了，' + (m.ok ? '已经用' : '这轮没能用') + LABEL[good] + ' 的有效登录态覆盖它' + (m.ok ? '。' : '（' + m.reason + '）。'),
          { ...base, canonical })
      }

      clearConflict()
      return finish('expired', '两边的登录态都失效了：随便挑一边重新扫码。', base)
    } catch (e) {
      log('tick 失败：' + (e?.stack || e))
      return finish('error', String(e?.message || e), {})
    } finally { busy = false }
  }

  async function adopt({ uid, confirm } = {}) {
    if (confirm !== true) return { ok: false, needConfirm: true, error: '改写登录态需要 confirm:true（这会覆盖另一侧现有的账号）。' }
    const target = String(uid || '').trim()
    if (!/^\d{5,20}$/.test(target)) return { ok: false, error: 'uid 看起来不像 B站 mid。' }
    const sides = readSides()
    const v = {}
    for (const side of SIDES) v[side] = sides[side].cookie ? await verify(sides[side].cookie) : null
    const from = SIDES.find((s) => v[s] && v[s].ok && v[s].uid === target)
    if (!from) return { ok: false, error: '两侧都没有可用的 ' + target + ' 登录态；先在对应插件里扫码。' }
    const to = SIDES.find((s) => s !== from)
    const saved = saveStore(readJson(paths.store), { uid: target, uname: v[from].uname, cookie: sides[from].cookie, source: from })
    const m = mirror(from, to, sides, { force: true })
    clearConflict()
    appendEvent(paths.events, { at: now(), kind: 'adopt-manual', uid: target, from, to, ok: m.ok })
    const s = await tick({ force: true, reason: 'after-adopt' })
    return {
      ok: m.ok, adopted: target, from, to, mirrored: m.ok, reason: m.reason || '',
      note: '大肥鱼的账号账本若仍记着旧 uid，它会在自己的设置页要求确认一次换号 —— 那是它的安全闸，不是桥失败。',
      store: { uid: saved.uid, uname: saved.uname, generation: saved.generation },
      status: s.status, message: s.message,
    }
  }

  function setPaused(next) {
    paused = Boolean(next)
    if (paused) appendEvent(paths.events, { at: now(), kind: 'paused' })
    return snapshot()
  }

  function start({ intervalMs = 10000, watch = true } = {}) {
    stop()
    timer = setInterval(() => { tick().catch(() => {}) }, intervalMs)
    if (timer.unref) timer.unref()
    if (watch) {
      for (const side of SIDES) {
        const file = paths[side]
        const dir = path.dirname(file)
        try {
          fs.mkdirSync(dir, { recursive: true })
          const watcher = fs.watch(dir, (_evt, name) => {
            if (name && String(name) !== path.basename(file)) return
            if (debounce) clearTimeout(debounce)
            debounce = setTimeout(() => { tick({ reason: 'file-change' }).catch(() => {}) }, 300)
            if (debounce.unref) debounce.unref()
          })
          if (watcher.unref) watcher.unref()
          watchers.push(watcher)
        } catch (e) { log('watch ' + side + ' 失败：' + (e?.message || e)) }
      }
    }
    tick({ reason: 'start' }).catch(() => {})
    return stop
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
    if (debounce) clearTimeout(debounce)
    debounce = null
    for (const watcher of watchers) { try { watcher.close() } catch {} }
    watchers = []
  }

  return { tick, adopt, start, stop, status: () => snapshot(), setPaused, isPaused: () => paused, paths }
}
