import plugin from '../index.js'

const routes = []
const toolsReg = []
const ctx = {
  webServer: { register(spec) { routes.push(spec.path); return () => {} } },
  tools: { register(def) { toolsReg.push(def.name ?? def.spec?.name ?? '?'); return { dispose() {} } } },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get() { return undefined },
}

console.log('name:', plugin.name, '| inject:', JSON.stringify(plugin.inject))
plugin.apply(ctx)
console.log('routes:', JSON.stringify(routes))
console.log('tools:', JSON.stringify(toolsReg))

const needRoutes = ['/dsh-bili-bridge/api/status', '/dsh-bili-bridge/api/heal', '/dsh-bili-bridge/api/adopt', '/dsh-bili-bridge/api/config', '/dsh-bili-bridge/api/route']
const needTools = ['bili_bridge_status', 'bili_bridge_heal', 'bili_bridge_adopt', 'bili_bridge_config', 'bili_bridge_route']
const missR = needRoutes.filter((r) => !routes.includes(r))
const missT = needTools.filter((t) => !toolsReg.includes(t))
if (missR.length || missT.length) {
  console.log('MISSING routes:', JSON.stringify(missR), 'tools:', JSON.stringify(missT))
  process.exit(1)
}
console.log('冒烟通过：' + needRoutes.length + ' 条路由、' + needTools.length + ' 个工具')
process.exit(0)
