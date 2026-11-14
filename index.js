import { resolvePaths } from './lib/paths.mjs'
import { createReconciler } from './lib/reconciler.mjs'
import { loadConfig, saveConfig, patchConfig } from './lib/config.mjs'
import { readLexicon, saveLexicon, scoreText, decideText } from './lib/lexicon-store.mjs'
import { loadHostDeps } from './lib/hostdeps.mjs'
import fs from 'node:fs'
import path from 'node:path'

/** 启动探针：宿主不给我们 stdout，激活/失败都写 $DSH_HOME/bili-account-bridge/boot.log。 */
function bootMark(msg) {
  try {
    const p = resolvePaths()
    fs.mkdirSync(p.dir, { recursive: true })
    fs.appendFileSync(path.join(p.dir, 'boot.log'), new Date().toISOString() + ' ' + msg + '\n')
  } catch {}
}

/**
 * dsh-bili-account-bridge —— host 半端
 * ============================================================================
 * 解决的问题：两个插件各自扫码，互相把对方的登录态顶掉。
 *   养鱼（dsh-bili-whale）读 ~/.bili-ai/credentials.json；
 *   大肥鱼（dsh-dafeiyu-life）读 $DSH_HOME/bili-duty/bili_credential.json。
 *   两份文件互不通气 —— 一边重新扫码，另一边就成了失效 cookie；它下次启动又自己扫，
 *   登录态于是在两套 cookie / 两个账号之间来回横跳。
 *
 * 桥只做四件事，全是本地文件 + 一次只读 nav 校验：
 *   1. 盯住两个文件（fs.watch + 10 秒兜底轮询）；
 *   2. 谁的有效就验谁（/x/web-interface/nav），只认本机账本绑定的那个 uid；
 *   3. 同一个 uid 的两套 cookie → 以较新的为准，原子覆盖另一边（覆盖前备份）；
 *   4. 不同 uid → 一个字节都不写，落 conflict.json，等主人用 bili_bridge_adopt 定夺。
 * ============================================================================
 */
const hostDeps = await loadHostDeps()
const defineTool = hostDeps?.defineTool || null

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
}

const safe = (v) => {
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const readBody = (req, limit = 32 * 1024) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

export default {
  name: 'dsh-bili-account-bridge',
  inject: ['webServer', 'tools'],
  apply(ctx) {
    try {
    bootMark('apply:enter')
    const paths = resolvePaths()
    bootMark('apply:paths ' + paths.dir)
    const log = (...a) => { try { console.log('[bili-bridge]', ...a) } catch {} }
    const rec = createReconciler({ paths, log })
    let cfg = loadConfig(paths.config).config
    bootMark('apply:cfg')

    /** 与养鱼同一套信任判定：回环直接信；否则问 connection；拿不到就拒。 */
    function trusted(req) {
      const host = String(req.headers?.host ?? '').toLowerCase()
      const h = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
      if (h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1') return true
      try {
        const conn = ctx.get('connection')
        if (conn && typeof conn.isTrusted === 'function') return conn.isTrusted(req) === true
      } catch {}
      return false
    }

    function fenced(req, res) {
      if (!trusted(req)) { json(res, 403, { ok: false, error: '不受信任的访问来源' }); return true }
      try {
        const conn = ctx.get('connection')
        if (conn && typeof conn.requestRejection === 'function') {
          const code = conn.requestRejection(req)
          if (code !== undefined && code !== null && code !== false) {
            res.statusCode = typeof code === 'number' ? code : 403
            res.end()
            return true
          }
        }
      } catch {}
      return false
    }

    const disposers = []
    function route(pathname, handler) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: pathname,
        handler: async (req, res) => {
          if (fenced(req, res)) return
          try { await handler(req, res) } catch (e) { try { json(res, 500, { ok: false, error: String(e?.message || e) }) } catch {} }
        },
      }))
    }

    route('/dsh-bili-bridge/api/status', async (req, res) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false }); return }
      json(res, 200, rec.status())
    })

    route('/dsh-bili-bridge/api/heal', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse((await readBody(req)) || '{}')
      json(res, 200, await rec.tick({ force: body.force !== false, reason: 'manual-heal' }))
    })

    route('/dsh-bili-bridge/api/adopt', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse((await readBody(req)) || '{}')
      json(res, 200, await rec.adopt({ uid: body.uid, confirm: body.confirm === true }))
    })

    route('/dsh-bili-bridge/api/config', async (req, res) => {
      if (req.method === 'GET') {
        json(res, 200, { ok: true, paused: rec.isPaused(), config: cfg, file: paths.config })
        return
      }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse((await readBody(req)) || '{}')
      if (typeof body.paused === 'boolean') rec.setPaused(body.paused)
      if (body.patch && typeof body.patch === 'object') {
        try { cfg = saveConfig(paths.config, patchConfig(cfg, body.patch)) }
        catch (e) { json(res, 400, { ok: false, error: '配置没写进去：' + String(e?.message || e) }); return }
      }
      json(res, 200, { ok: true, paused: rec.isPaused(), config: cfg })
    })

    route('/dsh-bili-bridge/api/route', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse((await readBody(req)) || '{}')
      json(res, 200, decideText(body.text, cfg))
    })

    // 判定词库：两个插件共用 <DSH_HOME>/gate-lexicon.json，这里读写同一份
    route('/dsh-bili-bridge/api/lexicon', async (req, res) => {
      if (req.method === 'GET') {
        const r = readLexicon()
        json(res, 200, { ok: !r.error, file: r.file, lexicon: r.lexicon, error: r.error })
        return
      }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse((await readBody(req)) || '{}')
      try {
        const r = saveLexicon(body.lexicon ?? body)
        json(res, 200, { ok: true, file: r.file, lexicon: r.lexicon })
      } catch (e) {
        json(res, 400, { ok: false, error: '词库没写进去：' + String((e && e.message) || e) })
      }
    })

    route('/dsh-bili-bridge/api/lexicon/test', async (req, res) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse((await readBody(req)) || '{}')
      const score = scoreText(body.text, body.side, body.lexicon)
      const decision = decideText(body.text, cfg, { lexicon: body.lexicon })
      json(res, 200, { ok: true, ...score, decision, gates: decision.gates, allow: decision.allow, side: decision.side, mode: decision.mode, reason: decision.reason })
    })

    bootMark('apply:routes ' + disposers.length)

    // 生命周期挂在宿主上：插件卸载时定时器与文件监听一起收掉，不留野进程。
    ctx.effect(() => {
      const off = rec.start({ intervalMs: 10000, watch: true })
      return () => { try { off() } catch {} }
    }, 'bili-bridge: watch both credential files')

    ctx.effect(() => () => { for (const d of disposers) { try { d?.() } catch {} } }, 'bili-bridge: routes')

    bootMark('apply:effects')

    if (!defineTool) {
      log('拿不到 defineTool，工具未注册（设置页仍可用）')
      bootMark('apply:no-defineTool')
      return
    }

    const tool = (spec) => {
      bootMark('tool:begin ' + spec.name)
      try {
        const d = ctx.tools.register(defineTool({
          ...spec,
          output: textOutput,
          async execute(args) { return safe(await spec.execute(args)) },
        }))
        bootMark('tool:ok ' + spec.name)
        return d
      } catch (e) {
        // 重复注册（同一进程里被挂载两次）不该把整个插件连路由一起带走：记一笔、跳过这一件。
        bootMark('tool:throw ' + spec.name + ' :: ' + ((e && e.stack) || e))
        return null
      }
    }

    tool({
      name: 'bili_bridge_status',
      description: '看 B站桥状态：本机绑定的 uid、养鱼与大肥鱼两侧各是哪个账号、是否有效、有没有冲突。只读，不改任何文件。',
      parameters: {},
      async execute() { return rec.status() },
    })

    tool({
      name: 'bili_bridge_heal',
      description: '立刻对齐一次：用有效的那份登录态覆盖失效/较旧的那份（同 uid 才覆盖，覆盖前备份）。不改账号身份，只写本地文件。',
      parameters: { confirm: { type: 'boolean', description: '确认现在就写（会覆盖另一侧旧的登录态）；不传则只检查不写。' } },
      async execute(args) {
        if (args?.confirm !== true) {
          const s = await rec.tick({ force: false, reason: 'dry-check' })
          return { ok: true, dryRun: true, wouldBe: s.status, message: s.message, sides: s.sides, conflict: s.conflict }
        }
        return rec.tick({ force: true, reason: 'manual-heal' })
      },
    })

    tool({
      name: 'bili_bridge_config',
      description: '读 / 改 B站桥的两个功能开关：插件闸门（养鱼、大肥鱼各自的「行为处理」「正常回复」）与文本分流（按前置文本条件决定一段话交给谁）。不给 patch 就是读。',
      parameters: { patch: { type: 'object', additionalProperties: true, properties: {}, description: '{"gates":{"enabled":true,"whale":{"action":true,"reply":true},"dafeiyu":{"action":true,"reply":true}},"routing":{"enabled":true,"caseInsensitive":true,"rules":[{"id":"r1","enabled":true,"when":{"prefix":"养鱼:","contains":""},"target":"whale","mode":"both","note":""}]}}' } },
      async execute(args) {
        if (args && args.patch && typeof args.patch === 'object') {
          cfg = saveConfig(paths.config, patchConfig(cfg, args.patch))
          return { ok: true, changed: true, config: cfg, file: paths.config }
        }
        return { ok: true, config: cfg, file: paths.config }
      },
    })

    tool({
      name: 'bili_bridge_route',
      description: '只读预判：拿一段文本，按当前分流规则判断该交给养鱼、大肥鱼，还是正常回复；同时报告对应插件闸门是否放行。不改任何文件。',
      parameters: { text: { type: 'string', description: '要判断的原文' } },
      async execute(args) { return decideText(args?.text, cfg) },
    })

    tool({
      name: 'bili_gate_lexicon',
      description: '读写判定词库（两个插件共用）：每个词有 side（both/whale/dafeiyu），面板加词按 weight=1 计；老词仍带历史小权重。命中词累加 >= threshold（默认 0.5）判给养鱼，其余归大肥鱼（只定归属，不拦）。不给参数就是读；给 text 只试判；给 lexicon 就整份替换。',
      parameters: {
        lexicon: {
          type: 'object',
          additionalProperties: true,
          properties: {},
          description: '{"threshold":0.5,"entries":[{"word":"帮我","side":"both","weight":1}]}',
        },
        text: { type: 'string', description: '可选：只判断一段文本的分值（只读预览）' },
      },
      async execute(args) {
        if (args && typeof args.text === 'string') return { ok: true, ...scoreText(args.text, args.side) }
        if (args && args.lexicon && typeof args.lexicon === 'object') {
          const r = saveLexicon(args.lexicon)
          return { ok: true, changed: true, file: r.file, lexicon: r.lexicon }
        }
        const r = readLexicon()
        return { ok: !r.error, file: r.file, lexicon: r.lexicon, error: r.error }
      },
    })

    tool({
      name: 'bili_bridge_adopt',
      description: '冲突之后由主人定夺：把某个 uid 定为这台机器的账号，并把它的登录态铺到另一侧。会覆盖另一侧现有登录态，必须 confirm:true。',
      parameters: {
        uid: { type: 'string', description: '要绑定的 B站 mid（数字字符串）。' },
        confirm: { type: 'boolean', description: '仅当主人明确要求换到这个账号时设 true。' },
      },
      async execute(args) { return rec.adopt({ uid: args?.uid, confirm: args?.confirm === true }) },
    })
    bootMark('apply:tools ok')
    } catch (e) { bootMark('apply:throw :: ' + ((e && e.stack) || e)); throw e }
  },
}
