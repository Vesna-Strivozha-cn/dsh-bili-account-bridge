import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// lexicon-store.mjs —— 判定词库的读写（与两个插件共用同一份文件）
// 文件：<DSH_HOME>/gate-lexicon.json
// 结构：{ version:2, threshold:0.5, entries:[{ id, word, side:'both'|'whale'|'dafeiyu', weight:0..1 }] }
// 权重含义：1 = 100% 指令，0.5 = 50%，0 = 不计分；命中词权重累加（上限 1）>= threshold 即放行。
// 词至少两个字（2026-11-14 主人要求）：单字在「我发了个视频」里也会命中，基础词库不收。
// side 预设：明显指令口气归养鱼（whale），其余归大肥鱼（dafeiyu）。

export const LEXICON_NAME = 'gate-lexicon.json'
export const LEXICON_VERSION = 2

function wordLength(word) {
  return Array.from(String(word)).length
}

export function lexiconPath() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, LEXICON_NAME)
}

export function normalizeLexicon(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const t = Number(src.threshold)
  const threshold = Number.isFinite(t) ? Math.min(1, Math.max(0.05, t)) : 0.5
  const list = Array.isArray(src.entries) ? src.entries : []
  const seen = new Set()
  const entries = []
  for (const e of list) {
    const word = String((e && e.word) || '').trim()
    if (!word || wordLength(word) < 2) continue
    const side = ['both', 'whale', 'dafeiyu'].includes(e.side) ? e.side : 'dafeiyu'
    const key = side + '|' + word
    if (seen.has(key)) continue
    seen.add(key)
    const w = Number(e.weight)
    const weight = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0
    entries.push({ id: String(e.id || 'w' + (entries.length + 1)), word, side, weight })
  }
  return { version: LEXICON_VERSION, threshold, entries }
}

// 默认词库 = 2026-11-14 主人在设置页定下的这一份；文件没了/坏了就按这份显示 ✓
export const DEFAULT_ENTRIES = [
  ['下一个', 'whale', 1], ['安装', 'whale', 1], ['关闭', 'whale', 1], ['整一个', 'whale', 1],
  ['立刻进行', 'whale', 1], ['跑一次', 'whale', 1], ['下载', 'whale', 1],
]

export function defaultLexicon() {
  return {
    version: LEXICON_VERSION,
    threshold: 0.5,
    entries: DEFAULT_ENTRIES.map(([word, side, weight], i) => ({ id: 'd' + (i + 1), word, side, weight })),
  }
}

export function readLexicon() {
  const file = lexiconPath()
  try {
    const txt = fs.readFileSync(file, 'utf8')
    return { file, lexicon: normalizeLexicon(JSON.parse(txt)), error: '' }
  } catch (e) {
    return { file, lexicon: defaultLexicon(), error: String((e && e.message) || e) }
  }
}

export function saveLexicon(payload) {
  const file = lexiconPath()
  const lexicon = normalizeLexicon(payload)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(lexicon, null, 2))
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
  return { file, lexicon }
}

function normalizeText(raw) {
  let s = String(raw == null ? '' : raw)
  s = s.replace(/^(?:\s*@[^\s@]{1,40})+\s*/u, '')
  s = s.replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
  return s.replace(/[\s\u3000]+/g, ' ').trim()
}

const NARRATIVE_RE = /^(说真的|说实话|说起来|话说|看起来|听着|对了|其实|不过|然后|所以|就是|反正|总之)/

/** 只做打分预览，供设置页「试一下」用（与插件里的判定同一套规则） */
export function scoreText(raw, side, lex) {
  const text = normalizeText(raw)
  const s = side === 'dafeiyu' ? 'dafeiyu' : 'whale'
  const lexicon = normalizeLexicon(lex || readLexicon().lexicon)
  const lower = text.toLowerCase()
  const matches = []
  for (const e of lexicon.entries) {
    if (e.side !== 'both' && e.side !== s) continue
    if (!e.weight) continue
    const idx = lower.indexOf(e.word.toLowerCase())
    if (idx < 0) continue
    const tail = text.charAt(idx + e.word.length)
    if (/[了着过]/.test(tail) && e.word.length <= 2) continue
    matches.push({ word: e.word, weight: e.weight, idx, len: e.word.length })
  }
  const kept = matches.filter((a) => !matches.some((b) => b !== a && b.idx <= a.idx && b.idx + b.len >= a.idx + a.len && b.len > a.len))
  const hits = kept.map(({ word, weight }) => ({ word, weight }))
  let score = hits.reduce((n, x) => n + x.weight, 0)
  if (NARRATIVE_RE.test(text) && !hits.some((x) => x.weight >= 1)) score = 0
  score = Math.min(1, Math.round(score * 100) / 100)
  return { text, side: s, score, threshold: lexicon.threshold, directive: score >= lexicon.threshold, hits }
}

// ———————————————— 与插件闸门 / 文本分流的联动 ————————————————
// 词库先说这句话像哪一侧的口吻，再看那一侧的闸门（gates）开没开：
//   gates.whale.action / reply、gates.dafeiyu.action / reply、gates.enabled 总闸。
// 分流规则（routing）优先于词库：命中规则就按规则的 target/mode 走，再受该侧闸门约束。
// 两个插件里的 gateIncoming 与这里的 decideText 是同一套判定。

function asBool(v, dflt) {
  return v === true ? true : v === false ? false : dflt
}

export function normalizeGates(raw) {
  const g = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: asBool(g.enabled, true),
    whale: { action: asBool(g?.whale?.action, true), reply: asBool(g?.whale?.reply, true) },
    dafeiyu: { action: asBool(g?.dafeiyu?.action, true), reply: asBool(g?.dafeiyu?.reply, true) },
  }
}

export function gateForCfg(gates, side, mode) {
  const g = gates || normalizeGates()
  const cur = side === 'dafeiyu' ? g.dafeiyu : g.whale
  const allowed = mode === 'both' ? (cur.action && cur.reply) : mode === 'reply' ? cur.reply : cur.action
  return { enforced: g.enabled !== false, allowed: g.enabled === false ? true : allowed, action: cur.action, reply: cur.reply }
}

export function scoreSides(raw, lex) {
  return {
    whale: scoreText(raw, 'whale', lex),
    dafeiyu: scoreText(raw, 'dafeiyu', lex),
  }
}

/**
 * 最终结论：这句话要不要回、由哪一侧回、按什么模式、闸门放没放。
 * @param {string} raw 文本
 * @param {object} cfg 已经 normalizeConfig 过的配置（gates + routing）
 */
export function decideText(raw, cfg, opts = {}) {
  const lexicon = normalizeLexicon(opts.lexicon || readLexicon().lexicon)
  const gates = normalizeGates(cfg && cfg.gates ? cfg.gates : undefined)
  const routing = (cfg && cfg.routing) || {}
  const sides = scoreSides(raw, lexicon)
  const text = sides.whale.text
  const scores = { whale: sides.whale.score, dafeiyu: sides.dafeiyu.score }
  const base = {
    text, threshold: lexicon.threshold, scores,
    hits: { whale: sides.whale.hits, dafeiyu: sides.dafeiyu.hits },
    gates, textLength: text.length,
  }
  if (!text) return { ok: true, decision: 'blocked', allow: false, side: null, mode: null, reason: 'empty-text', rule: null, gate: null, ...base }
  let rule = null
  if (routing.enabled) {
    const ci = routing.caseInsensitive !== false
    const t = ci ? text.toLowerCase() : text
    for (const r of Array.isArray(routing.rules) ? routing.rules : []) {
      if (r.enabled === false) continue
      const when = r.when || r
      const prefix = String(when.prefix || '')
      const contains = String(when.contains || '')
      if (!prefix && !contains) continue
      if (prefix && !(ci ? t.startsWith(prefix.toLowerCase()) : t.startsWith(prefix))) continue
      if (contains && !(ci ? t.includes(contains.toLowerCase()) : t.includes(contains))) continue
      rule = r
      break
    }
  }
  let side = null
  let mode = null
  if (rule) {
    side = rule.target === 'whale' || rule.target === 'dafeiyu' ? rule.target : null
    mode = ['action', 'reply', 'both'].includes(rule.mode) ? rule.mode : 'reply'
  } else {
    const w = scores.whale >= lexicon.threshold
    const d = scores.dafeiyu >= lexicon.threshold
    if (w && (!d || scores.whale >= scores.dafeiyu)) side = 'whale'
    else if (d) side = 'dafeiyu'
    if (side) mode = side === 'whale' ? 'action' : 'reply'
  }
  if (!side) {
    // 词库只给倾向，不硬拦：判不出养鱼，就归大肥鱼，能不能动看那一侧的闸门。
    side = 'dafeiyu'
    mode = 'reply'
    const g = gateForCfg(gates, side, mode)
    const lean = { ok: true, side, mode, rule: null, gate: g, ...base }
    if (!g.enforced) return { ...lean, decision: side, allow: true, reason: 'gate-off' }
    if (!g.allowed) return { ...lean, decision: 'blocked', allow: false, reason: 'gate-closed:' + side + '.' + mode }
    return { ...lean, decision: side, allow: true, reason: side }
  }
  const gate = gateForCfg(gates, side, mode)
  const out = { ok: true, side, mode, rule: rule ? { id: rule.id, target: side, mode, note: rule.note || '' } : null, gate, ...base }
  if (!gate.enforced) return { ...out, decision: side, allow: true, reason: 'gate-off' }
  if (!gate.allowed) return { ...out, decision: 'blocked', allow: false, reason: 'gate-closed:' + side + '.' + mode }
  return { ...out, decision: side, allow: true, reason: rule ? 'rule:' + rule.id : 'score:' + scores[side] }
}

