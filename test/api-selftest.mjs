import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-api-'))
process.env.BILI_BRIDGE_HOME = path.join(tmp, 'bridge')
process.env.BILI_WHALE_CREDENTIALS = path.join(tmp, 'whale.json')
process.env.BILI_DAFEIYU_CREDENTIALS = path.join(tmp, 'dafeiyu.json')
process.env.USERPROFILE = tmp

const plugin = (await import('../index.js')).default

const routes = new Map()
const toolsReg = []
const ctx = {
  webServer: { register(spec) { routes.set(spec.path, spec.handler); return () => {} } },
  tools: { register(def) { toolsReg.push(def); return { dispose() {} } } },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get() { return undefined },
}
plugin.apply(ctx)

function fakeReq(method, body) {
  const handlers = {}
  const req = {
    method,
    headers: { host: '127.0.0.1:51643' },
    on(ev, cb) {
      (handlers[ev] = handlers[ev] || []).push(cb)
      if (ev === 'end') {
        setTimeout(() => {
          if (body !== undefined) for (const f of handlers.data || []) f(Buffer.from(body))
          for (const f of handlers.end || []) f()
        }, 0)
      }
      return req
    },
    destroy() {},
  }
  return req
}

function call(pathname, method, body) {
  return new Promise((resolve, reject) => {
    let code = 200
    let payload = ''
    const res = {
      writeHead(c) { code = c },
      set statusCode(v) { code = v },
      end(s) { if (s) payload += s; resolve({ code, body: payload ? JSON.parse(payload) : null }) },
    }
    Promise.resolve(routes.get(pathname)(fakeReq(method, body), res)).catch(reject)
    setTimeout(() => reject(new Error('timeout ' + pathname)), 8000)
  })
}

let pass = 0
const fails = []
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }

const cfg0 = await call('/dsh-bili-bridge/api/config', 'GET')
ok('GET config 200', cfg0.code === 200 && cfg0.body.ok === true)
ok('默认分流关、闸门开', cfg0.body.config.routing.enabled === false && cfg0.body.config.gates.enabled === true)

const patched = await call('/dsh-bili-bridge/api/config', 'POST', JSON.stringify({ patch: { gates: { whale: { action: false } }, routing: { enabled: true, caseInsensitive: true, rules: [{ id: 'r1', enabled: true, when: { prefix: '养鱼:', contains: '' }, target: 'whale', mode: 'action', note: '' }] } } }))
ok('POST config 写入成功', patched.code === 200 && patched.body.config.routing.enabled === true)
ok('闸门字段落库', patched.body.config.gates.whale.action === false)

const cfg1 = await call('/dsh-bili-bridge/api/config', 'GET')
ok('再读还是改后的值', cfg1.body.config.gates.whale.action === false && cfg1.body.config.routing.rules.length === 1)

const blocked = await call('/dsh-bili-bridge/api/route', 'POST', JSON.stringify({ text: '养鱼: 干活' }))
ok('命中但被闸门拦住', blocked.body.decision === 'blocked' && blocked.body.reason === 'gate-closed:whale.action' && blocked.body.rule && blocked.body.rule.id === 'r1')

const plain = await call('/dsh-bili-bridge/api/route', 'POST', JSON.stringify({ text: '随便聊聊' }))
ok('没命中 → 归大肥鱼', plain.body.decision === 'dafeiyu' && plain.body.allow === true && plain.body.reason === 'dafeiyu')

const bad = await call('/dsh-bili-bridge/api/config', 'POST', JSON.stringify({ patch: { gates: { whale: { action: 'no' } } } }))
ok('非法值被忽略而不是写坏', bad.code === 200 && bad.body.config.gates.whale.action === false)

const file = path.join(process.env.BILI_BRIDGE_HOME, 'config.json')
ok('config.json 真的落盘', fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).routing.enabled === true)

await call('/dsh-bili-bridge/api/config', 'POST', JSON.stringify({ patch: { gates: { whale: { action: true } } } }))
const link1 = await call('/dsh-bili-bridge/api/route', 'POST', JSON.stringify({ text: '安装这个插件' }))
ok('词库判给养鱼、闸门开着就放行', link1.body.decision === 'whale' && link1.body.allow === true && link1.body.reason === 'score:1')

const off1 = await call('/dsh-bili-bridge/api/config', 'POST', JSON.stringify({ patch: { gates: { whale: { action: false } } } }))
const link2 = await call('/dsh-bili-bridge/api/route', 'POST', JSON.stringify({ text: '安装这个插件' }))
ok('养鱼闸门关掉，同一句话就拦下', link2.body.decision === 'blocked' && link2.body.reason === 'gate-closed:whale.action')

await call('/dsh-bili-bridge/api/config', 'POST', JSON.stringify({ patch: { gates: { whale: { action: true } } } }))
const link3 = await call('/dsh-bili-bridge/api/route', 'POST', JSON.stringify({ text: '看看说说' }))
ok('非指令口吻归大肥鱼', link3.body.decision === 'dafeiyu' && link3.body.side === 'dafeiyu' && link3.body.allow === true)

const status = await call('/dsh-bili-bridge/api/status', 'GET')
ok('status 仍可用', status.code === 200 && status.body.ok !== false)

ok('新工具已注册', ['bili_bridge_config', 'bili_bridge_route'].every((n) => toolsReg.some((t) => t.name === n)))

fs.rmSync(tmp, { recursive: true, force: true })
console.log('')
if (fails.length) { console.log('失败 ' + fails.length + ' 项：'); for (const f of fails) console.log(' - ' + f); process.exit(1) }
console.log('全部通过（' + pass + ' 项）')
process.exit(0)
