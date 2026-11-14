#!/usr/bin/env node
/**
 * 自检：不碰真实凭据，全部在临时目录里造文件 + 注入假 verify。
 * 覆盖六种局面：空 / 单边 / 两边同 uid 不同 cookie / 两边不同账号 / 账本 uid 不符 / 两边都失效。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePaths } from '../lib/paths.mjs'
import { createReconciler } from '../lib/reconciler.mjs'
import { readSide } from '../lib/adapters.mjs'

let failed = 0
const ok = (cond, name, extra) => {
  if (cond) console.log('  ✓ ' + name)
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}

const cookie = (tag, uid) => ({
  sessdata: 'SESSDATA_' + tag + '_' + 'x'.repeat(30),
  bili_jct: 'a'.repeat(32),
  buvid3: 'BUV_' + tag,
  dedeuserid: uid || '',
})

function scene(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-bridge-'))
  const paths = resolvePaths({ USERPROFILE: root, DSH_HOME: path.join(root, '.dsh'), BILI_BRIDGE_HOME: path.join(root, '.dsh', 'bili-account-bridge') })
  fs.mkdirSync(path.dirname(paths.whale), { recursive: true })
  fs.mkdirSync(path.dirname(paths.dafeiyu), { recursive: true })
  fs.mkdirSync(paths.dir, { recursive: true })
  console.log('\n[' + name + ']')
  return { root, paths }
}

const put = (file, c) => fs.writeFileSync(file, JSON.stringify(c, null, 2))
const uidOf = (c) => c.dedeuserid

function make(paths, table) {
  const verify = async (c) => {
    const hit = table[JSON.stringify(c)]
    return hit || { ok: false, code: 'bad', message: '假校验：未知 cookie' }
  }
  return createReconciler({ paths, verify, log: () => {} })
}

// 1) 空
{
  const { paths } = scene('两边都空')
  const r = make(paths, {})
  const s = await r.tick({ force: true })
  ok(s.status === 'empty', '状态 = empty', s.status)
}

// 2) 只有养鱼有，且有效 → 接管并铺到大肥鱼
{
  const { paths } = scene('单边有登录态')
  const c = cookie('A', '3747582325034677')
  put(paths.whale, c)
  const r = make(paths, { [JSON.stringify(c)]: { ok: true, uid: '3747582325034677', uname: '达妮卡', at: Date.now() } })
  const s = await r.tick({ force: true })
  ok(s.status === 'adopted', '状态 = adopted', s.status)
  const d = readSide('dafeiyu', paths.dafeiyu)
  ok(d.cookie && d.cookie.sessdata === c.sessdata, '大肥鱼侧已被写入同一份 sessdata')
  ok(d.cookie && d.cookie.dedeuserid === '3747582325034677', 'dedeuserid 已补上')
  const store = JSON.parse(fs.readFileSync(paths.store, 'utf8'))
  ok(store.uid === '3747582325034677' && store.generation === 1, 'canonical store 落盘')
}

// 3) 两边同 uid 不同 cookie → 以较新为准覆盖较旧
{
  const { paths } = scene('同 uid 两套 cookie')
  const oldC = cookie('OLD', '3747582325034677')
  const newC = cookie('NEW', '3747582325034677')
  put(paths.whale, oldC)
  put(paths.dafeiyu, newC)
  fs.writeFileSync(paths.binding, JSON.stringify({ activeUid: '3747582325034677' }))
  const past = new Date(Date.now() - 60000)
  fs.utimesSync(paths.whale, past, past)
  const table = {}
  table[JSON.stringify(oldC)] = { ok: true, uid: '3747582325034677', uname: '达妮卡', at: Date.now() }
  table[JSON.stringify(newC)] = { ok: true, uid: '3747582325034677', uname: '达妮卡', at: Date.now() }
  const r = make(paths, table)
  const s = await r.tick({ force: true })
  ok(s.status === 'healed', '状态 = healed', s.status)
  ok(readSide('whale', paths.whale).cookie.sessdata === newC.sessdata, '较旧的一侧被较新的覆盖')
  ok(fs.readdirSync(paths.history).length >= 1, '覆盖前留了备份')
}

// 3b) 两边是同一份登录态（指纹相同）→ ok，不写任何一侧，也不许报假冲突
{
  const { paths } = scene('两边同一份登录态')
  const c = cookie('SAME', '3747582325034677')
  put(paths.whale, c)
  put(paths.dafeiyu, c)
  const r = make(paths, { [JSON.stringify(c)]: { ok: true, uid: '3747582325034677', uname: '达妮卡', at: Date.now() } })
  const s = await r.tick({ force: true })
  ok(s.status === 'ok', '状态 = ok', s.status)
  ok(!s.conflict, '没有假冲突')
  const store = JSON.parse(fs.readFileSync(paths.store, 'utf8'))
  ok(store.uid === '3747582325034677', 'canonical 记的是真实 uid', store.uid)
}
// 4) 两边不同账号 → 冲突，且一个字节都不写
{
  const { paths } = scene('两个不同账号')
  const a = cookie('A', '111111111')
  const b = cookie('B', '222222222')
  put(paths.whale, a)
  put(paths.dafeiyu, b)
  const table = {}
  table[JSON.stringify(a)] = { ok: true, uid: '111111111', uname: '甲', at: Date.now() }
  table[JSON.stringify(b)] = { ok: true, uid: '222222222', uname: '乙', at: Date.now() }
  const r = make(paths, table)
  const s = await r.tick({ force: true })
  ok(s.status === 'conflict' && s.conflict && s.conflict.kind === 'two-accounts', '状态 = conflict/two-accounts', s.status)
  ok(readSide('whale', paths.whale).cookie.sessdata === a.sessdata, '养鱼侧未被改写')
  ok(readSide('dafeiyu', paths.dafeiyu).cookie.sessdata === b.sessdata, '大肥鱼侧未被改写')
  ok(fs.existsSync(paths.conflict), 'conflict.json 落盘')
}

// 5) 账本绑定 A，但唯一有效的登录态是 B → 冲突，不静默换号
{
  const { paths } = scene('账本 uid 不符')
  const c = cookie('B', '222222222')
  put(paths.dafeiyu, c)
  fs.writeFileSync(paths.binding, JSON.stringify({ activeUid: '111111111' }))
  const r = make(paths, { [JSON.stringify(c)]: { ok: true, uid: '222222222', uname: '乙', at: Date.now() } })
  const s = await r.tick({ force: true })
  ok(s.status === 'conflict', '状态 = conflict', s.status)
  ok(!readSide('whale', paths.whale).exists, '没有把 B 的登录态铺到养鱼')
}

// 6) 两边都失效
{
  const { paths } = scene('两边都失效')
  put(paths.whale, cookie('A', '111111111'))
  put(paths.dafeiyu, cookie('B', '222222222'))
  const r = make(paths, {})
  const s = await r.tick({ force: true })
  ok(s.status === 'expired', '状态 = expired', s.status)
}

// 7) 暂停后不再写
{
  const { paths } = scene('暂停')
  const c = cookie('A', '3747582325034677')
  put(paths.whale, c)
  const r = make(paths, { [JSON.stringify(c)]: { ok: true, uid: '3747582325034677', uname: '达妮卡', at: Date.now() } })
  r.setPaused(true)
  const s = await r.tick({ force: true })
  ok(s.paused === true && !readSide('dafeiyu', paths.dafeiyu).exists, '暂停时两边都不写')
}

console.log(failed ? '\n失败 ' + failed + ' 项' : '\n全部通过')
process.exit(failed ? 1 : 0)
