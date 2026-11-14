import fs from 'node:fs'
import path from 'node:path'

/**
 * 桥的配置：两个功能各自一个总开关，互不牵连。
 *   gates   —— 插件开关：养鱼 / 大肥鱼 各自的「行为处理」「正常回复」允不允许。
 *   routing —— 文本分流：按前置文本条件把一段话分给哪一边、以什么方式处理。
 * 配置只落本地 JSON，不碰任何账号凭据。
 */
export const DEFAULT_CONFIG = {
  version: 1,
  gates: {
    enabled: true,
    whale: { action: true, reply: true },
    dafeiyu: { action: true, reply: true },
  },
  routing: {
    enabled: false,
    defaultMode: 'reply',
    caseInsensitive: true,
    rules: [],
  },
}

const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const str = (v, d) => (typeof v === 'string' ? v.trim() : d)

export function normalizeRule(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const when = raw.when && typeof raw.when === 'object' ? raw.when : {}
  const prefix = str(when.prefix, '')
  const contains = str(when.contains, '')
  const target = str(raw.target, '')
  const mode = str(raw.mode, 'both')
  if (!target) return null
  if (!prefix && !contains) return null
  if (target !== 'whale' && target !== 'dafeiyu') return null
  if (mode !== 'action' && mode !== 'reply' && mode !== 'both') return null
  return {
    id: str(raw.id, 'r' + (index + 1)),
    enabled: bool(raw.enabled, true),
    when: { prefix, contains },
    target,
    mode,
    note: str(raw.note, ''),
  }
}

export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const gates = src.gates && typeof src.gates === 'object' ? src.gates : {}
  const routing = src.routing && typeof src.routing === 'object' ? src.routing : {}
  const side = (name) => {
    const s = gates[name] && typeof gates[name] === 'object' ? gates[name] : {}
    return { action: bool(s.action, true), reply: bool(s.reply, true) }
  }
  const rules = Array.isArray(routing.rules) ? routing.rules : []
  const seen = new Set()
  const clean = []
  rules.forEach((r, i) => {
    const n = normalizeRule(r, clean.length + i)
    if (!n) return
    if (seen.has(n.id)) n.id = 'r' + (clean.length + 1)
    seen.add(n.id)
    clean.push(n)
  })
  return {
    version: 1,
    gates: {
      enabled: bool(gates.enabled, true),
      whale: side('whale'),
      dafeiyu: side('dafeiyu'),
    },
    routing: {
      enabled: bool(routing.enabled, false),
      defaultMode: str(routing.defaultMode, 'reply') === 'reply' ? 'reply' : 'reply',
      caseInsensitive: bool(routing.caseInsensitive, true),
      rules: clean,
    },
  }
}

export function loadConfig(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return { config: normalizeConfig(JSON.parse(text)), existed: true, error: '' }
  } catch (e) {
    const missing = e && e.code === 'ENOENT'
    return { config: normalizeConfig(null), existed: false, error: missing ? '' : String((e && e.message) || e) }
  }
}

export function saveConfig(file, cfg) {
  const next = normalizeConfig(cfg)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(next, null, 2) + '\n')
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
  return next
}

/** 只接受这几个字段的部分更新；rules 传数组即整组替换。 */
export function patchConfig(current, patch) {
  const src = patch && typeof patch === 'object' ? patch : {}
  const next = normalizeConfig(current)
  if (src.gates && typeof src.gates === 'object') {
    if (typeof src.gates.enabled === 'boolean') next.gates.enabled = src.gates.enabled
    for (const name of ['whale', 'dafeiyu']) {
      const s = src.gates[name]
      if (!s || typeof s !== 'object') continue
      if (typeof s.action === 'boolean') next.gates[name].action = s.action
      if (typeof s.reply === 'boolean') next.gates[name].reply = s.reply
    }
  }
  if (src.routing && typeof src.routing === 'object') {
    if (typeof src.routing.enabled === 'boolean') next.routing.enabled = src.routing.enabled
    if (typeof src.routing.caseInsensitive === 'boolean') next.routing.caseInsensitive = src.routing.caseInsensitive
    if (Array.isArray(src.routing.rules)) next.routing.rules = src.routing.rules
  }
  return normalizeConfig(next)
}
