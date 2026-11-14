import assert from 'node:assert'

let exported = null
const regs = []

const noop = () => {}
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  useState: (init) => (typeof init === 'function' ? [init(), noop] : [init, noop]),
  useEffect: (fn) => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  Fragment: 'fragment',
}

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) { exported = factory(() => React) },
  },
}

await import('../client.js')
assert.ok(exported && typeof exported.apply === 'function', 'client 未导出 apply')

const ctx = {
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : noop },
  slots: {
    inject(name, fn) { return fn() },
    register(spec, comp) {
      regs.push({ name: spec.name, id: spec.id, key: spec.key, order: spec.order, label: typeof spec.label === 'function' ? spec.label() : spec.label, comp })
      return {}
    },
  },
}
exported.apply(ctx)

const byName = (n) => regs.filter((r) => r.name === n)
console.log('registrations:', JSON.stringify(regs.map((r) => ({ name: r.name, id: r.id, key: r.key, order: r.order, label: r.label }))))

assert.deepStrictEqual(byName('settings.section').map((r) => r.id), ['bili-bridge'], '设置页应合并成一页')
assert.deepStrictEqual(byName('main').map((r) => r.key), ['bili-bridge'], '缺少 main keyed 面板')
assert.deepStrictEqual(byName('sidebar.panellist').map((r) => r.id), ['bili-bridge'], '缺少侧栏面板入口')
assert.strictEqual(byName('sidebar.panellist')[0].label, 'B站桥')

const pageComp = byName('settings.section')[0].comp
const page = pageComp()
const pageFlat = JSON.stringify(page)
assert.ok(pageFlat.includes('B站桥'), '设置页缺少标题')
assert.ok(JSON.stringify(pageComp()).includes('B站桥'), '设置页标题走 h3')
assert.ok(pageComp === exported.SettingsPage, '设置页应渲染合并后的 SettingsPage')

const pageKids = page.props.children
const merged = pageKids.filter((n) => n && typeof n.type === 'function' && n.props && n.props.embedded === true)
assert.strictEqual(merged.length, 3, '合并页应同时内嵌登录态、行为设置与判定词库')
assert.ok(merged[0].type === exported.BridgeSection, '合并页第一块应是登录态')
assert.ok(merged[1].type === exported.SettingsSection, '合并页第二块应是行为设置')
assert.ok(merged[2].type === exported.LexiconPanel, '合并页第三块应是判定词库')
assert.ok(JSON.stringify(merged[0].type({ embedded: true })).includes('读取中'), '登录态区块首屏应显示读取中')
assert.ok(JSON.stringify(merged[1].type({ embedded: true })).includes('读取中'), '行为设置区块首屏应显示读取中')

const home = byName('main')[0].comp
const icon = byName('sidebar.panellist')[0].comp
const homeNode = home()
const homeFlat = JSON.stringify(homeNode)
assert.ok(homeFlat.includes('B站桥'), '主页缺少标题')
assert.ok(homeFlat.includes('两个插件的分工'), '主页缺少副标题')
const inner = homeNode.props.children[0].props.children
const embedded = inner.filter((n) => n && typeof n.type === 'function' && n.props && n.props.embedded === true)
assert.strictEqual(embedded.length, 3, '主页未组合三个内嵌区块')
assert.ok(embedded[0].type === exported.BridgeSection, '主页第一块应是登录态')
assert.ok(embedded[1].type === exported.SettingsSection, '主页第二块应是行为设置')
assert.ok(embedded[2].type === exported.LexiconPanel, '主页第三块应是判定词库')
assert.strictEqual(homeNode.props.style.height, '100%', '主页应占满主面板高度')

const iconNode = icon({ size: 18, active: true })
assert.strictEqual(iconNode.props.width, 18, '侧栏图标尺寸未透传')
assert.strictEqual(iconNode.props.viewBox, '0 0 16 16')

assert.ok(exported.BridgeSection, '未导出 BridgeSection')
assert.ok(exported.SettingsSection, '未导出 SettingsSection')
assert.ok(exported.BridgeHome === home, '未导出 BridgeHome')
assert.ok(exported.BridgeIcon === icon, '未导出 BridgeIcon')

console.log('客户端冒烟通过：合并后的设置页 + main 面板 + 侧栏入口')
process.exit(0)
