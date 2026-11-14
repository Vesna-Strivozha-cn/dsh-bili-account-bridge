import { normalizeConfig } from './config.mjs'

/**
 * 文本分流的判定核心：只认文本，不看人、不看视频。
 *   有规则命中 → 交给规则指定的那一边，按 action / reply / both 处理；
 *   没命中     → 正常回复（不惊动任何插件）。
 * 插件开关（gates）独立生效：总开关关掉时只报告闸门状态，不拦。
 * 两个功能各管各的：routing 关掉时永远返回正常回复。
 */
export function matchRule(text, cfg) {
  const raw = typeof text === 'string' ? text : ''
  const t = cfg.routing.caseInsensitive ? raw.toLowerCase() : raw
  for (const rule of cfg.routing.rules) {
    if (!rule.enabled) continue
    const p = rule.when.prefix
    const c = rule.when.contains
    const prefix = p ? (cfg.routing.caseInsensitive ? p.toLowerCase() : p) : ''
    const contains = c ? (cfg.routing.caseInsensitive ? c.toLowerCase() : c) : ''
    const hitPrefix = prefix ? t.startsWith(prefix) : true
    const hitContains = contains ? t.includes(contains) : true
    if (hitPrefix && hitContains) return rule
  }
  return null
}

export function gateFor(cfg, side, mode) {
  if (!cfg.gates.enabled) return { enforced: false, allowed: true, action: true, reply: true }
  const g = cfg.gates[side] || { action: true, reply: true }
  const allowed = mode === 'action' ? g.action : mode === 'reply' ? g.reply : (g.action && g.reply)
  return { enforced: true, allowed, action: g.action, reply: g.reply }
}

export function route(text, inputCfg) {
  const cfg = normalizeConfig(inputCfg)
  const raw = typeof text === 'string' ? text : ''
  const trimmed = raw.trim()
  if (!cfg.routing.enabled) {
    return {
      ok: true, decision: 'reply', side: null, mode: 'reply', allowed: true,
      reason: 'routing-off', matchedRule: null, gates: cfg.gates, textLength: trimmed.length,
    }
  }
  if (!trimmed) {
    return {
      ok: true, decision: 'reply', side: null, mode: 'reply', allowed: true,
      reason: 'empty-text', matchedRule: null, gates: cfg.gates, textLength: 0,
    }
  }
  const rule = matchRule(trimmed, cfg)
  if (!rule) {
    return {
      ok: true, decision: 'reply', side: null, mode: 'reply', allowed: true,
      reason: 'no-rule', matchedRule: null, gates: cfg.gates, textLength: trimmed.length,
    }
  }
  const gate = gateFor(cfg, rule.target, rule.mode)
  return {
    ok: true,
    decision: gate.allowed ? rule.target : 'blocked',
    side: rule.target,
    mode: rule.mode,
    allowed: gate.allowed,
    reason: gate.allowed ? 'rule-matched' : 'gate-closed',
    matchedRule: { id: rule.id, target: rule.target, mode: rule.mode, note: rule.note },
    gate,
    gates: cfg.gates,
    textLength: trimmed.length,
  }
}
