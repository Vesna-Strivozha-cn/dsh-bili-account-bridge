import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeConfig, patchConfig, saveConfig, loadConfig } from '../lib/config.mjs'
import { route } from '../lib/router.mjs'

let pass = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

const cfgWith = (patch) => patchConfig(normalizeConfig(null), patch)
const rule = (o) => ({ id: o.id || 'r1', enabled: o.enabled !== false, when: { prefix: o.prefix || '', contains: o.contains || '' }, target: o.target || 'whale', mode: o.mode || 'both', note: '' })

// 1) 默认值
const def = normalizeConfig(null)
ok('默认闸门开着且两侧全放行', def.gates.enabled && def.gates.whale.action && def.gates.whale.reply && def.gates.dafeiyu.reply)
ok('默认分流关着', def.routing.enabled === false)

// 2) 分流关 → 永远正常回复
const off = cfgWith({ routing: { enabled: false, rules: [rule({ prefix: '养鱼:' })] } })
ok('分流关掉时忽略规则', route('养鱼: 干活', off).decision === 'reply' && route('养鱼: 干活', off).reason === 'routing-off')

// 3) 空文本
const on = cfgWith({ routing: { enabled: true, rules: [rule({ prefix: '养鱼:' })] } })
ok('空文本落正常回复', route('   ', on).reason === 'empty-text')

// 4) 没命中
ok('没命中规则 → 正常回复', route('随便聊聊', on).decision === 'reply' && route('随便聊聊', on).reason === 'no-rule')

// 5) 前缀命中
const hit = route('养鱼: 去刷一轮', on)
ok('前缀命中交给养鱼', hit.decision === 'whale' && hit.matchedRule.id === 'r1' && hit.reason === 'rule-matched')
ok('前缀必须从头匹配', route('今天养鱼: 吗', on).decision === 'reply')

// 6) 闸门关闭 → blocked
const gated = cfgWith({ gates: { whale: { action: false } }, routing: { enabled: true, rules: [rule({ prefix: '养鱼:', mode: 'action' })] } })
const blocked = route('养鱼: 干活', gated)
ok('闸门关行为处理 → blocked', blocked.decision === 'blocked' && blocked.allowed === false && blocked.reason === 'gate-closed')

// 7) 闸门总开关关掉 → 不拦但报告
const bypass = cfgWith({ gates: { enabled: false, whale: { action: false } }, routing: { enabled: true, rules: [rule({ prefix: '养鱼:', mode: 'action' })] } })
ok('总闸关掉时只报告不拦', route('养鱼: 干活', bypass).decision === 'whale' && route('养鱼: 干活', bypass).gate.enforced === false)

// 8) both 模式需要两边都开
const both = cfgWith({ gates: { whale: { reply: false } }, routing: { enabled: true, rules: [rule({ prefix: '综合:', mode: 'both' })] } })
ok('both 模式缺一边即拦', route('综合: ?', both).decision === 'blocked')

// 9) 顺序优先
const order = cfgWith({ routing: { enabled: true, rules: [rule({ id: 'a', prefix: 'x', target: 'whale' }), rule({ id: 'b', prefix: 'x', target: 'dafeiyu' })] } })
ok('第一条命中优先', route('x 内容', order).matchedRule.id === 'a')

// 10) 大小写
const ci = cfgWith({ routing: { enabled: true, rules: [rule({ prefix: 'Fish:' })] } })
ok('默认忽略大小写', route('fish: hello', ci).decision === 'whale')
const cs = cfgWith({ routing: { enabled: true, caseInsensitive: false, rules: [rule({ prefix: 'Fish:' })] } })
ok('可关掉大小写忽略', route('fish: hello', cs).decision === 'reply')

// 11) 只写包含
const contains = cfgWith({ routing: { enabled: true, rules: [rule({ contains: '私信' })] } })
ok('只填包含也能命中', route('帮我看看私信', contains).decision === 'whale' && route('公开评论', contains).decision === 'reply')

// 12) 禁用规则跳过
const disabled = cfgWith({ routing: { enabled: true, rules: [rule({ enabled: false, prefix: 'y' })] } })
ok('禁用规则不参与', route('y 内容', disabled).decision === 'reply')

// 13) 非法规则被丢弃
const messy = normalizeConfig({ routing: { enabled: true, rules: [
  { id: 'ok', when: { prefix: 'p' }, target: 'whale' },
  { when: { prefix: '' }, target: 'whale' },
  { when: { prefix: 'q' }, target: 'someone' },
  { id: 'ok', when: { prefix: 'z' }, target: 'dafeiyu' },
] } })
ok('非法规则被丢弃', messy.routing.rules.length === 2, JSON.stringify(messy.routing.rules.map((r) => r.id)))
ok('重复 id 自动改名', messy.routing.rules[0].id !== messy.routing.rules[1].id)

// 14) 落盘往返
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'))
const file = path.join(dir, 'config.json')
saveConfig(file, cfgWith({ gates: { dafeiyu: { reply: false } }, routing: { enabled: true, rules: [rule({ prefix: '私:' })] } }))
const back = loadConfig(file).config
ok('保存后读回一致', back.gates.dafeiyu.reply === false && back.routing.rules.length === 1 && back.routing.rules[0].when.prefix === '私:')
ok('文件是合法 JSON', !!JSON.parse(fs.readFileSync(file, 'utf8')).routing)
fs.rmSync(dir, { recursive: true, force: true })

console.log('')
if (fails.length) { console.log('失败 ' + fails.length + ' 项：'); for (const f of fails) console.log(' - ' + f); process.exit(1) }
console.log('全部通过（' + pass + ' 项）')
