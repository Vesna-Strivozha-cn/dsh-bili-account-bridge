#!/usr/bin/env node
import { resolvePaths } from '../lib/paths.mjs'
import { readSide, fingerprint, SIDES } from '../lib/adapters.mjs'
import { verifyCookie } from '../lib/verify.mjs'
const paths = resolvePaths()
const out = { store: paths.store, sides: {} }
for (const side of SIDES) {
  const s = readSide(side, paths[side])
  const fp = s.cookie ? fingerprint(s.cookie) : null
  let v = null
  if (s.cookie) v = await verifyCookie(s.cookie).catch((e) => ({ ok: false, message: String((e && e.message) || e) }))
  out.sides[side] = { exists: s.exists, hasCookie: Boolean(s.cookie), fp, verify: v && { ok: v.ok, uid: v.uid, uname: v.uname, message: v.message } }
}
const uids = Object.values(out.sides).map((x) => (x.verify && x.verify.ok ? x.verify.uid : null))
const fps = Object.values(out.sides).map((x) => x.fp)
out.sameUid = Boolean(uids[0] && uids[0] === uids[1])
out.sameFp = Boolean(fps[0] && fps[0] === fps[1])
console.log(JSON.stringify(out, null, 2))

