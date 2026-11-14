// 参数 schema 静态检查：dsh-tools 的 parameterSchemaSpecToJsonSchema 要求
// 对象型参数显式写 additionalProperties（true/false），否则 defineTool 直接抛错、
// 该工具在宿主里静默消失（2026-11-14 踩过：bili_bridge_config 的 patch 参数）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'index.js'), 'utf8')
let failed = 0
const ok = (cond, msg) => { if (cond) console.log('ok   ' + msg); else { failed++; console.log('FAIL ' + msg) } }

// 所有 type: 'object' 的参数都必须带 additionalProperties（同一层内，允许嵌套 {}）。
const hits = [...src.matchAll(/type:\s*'object'/g)].map((m) => src.slice(m.index, m.index + 220))
ok(hits.length > 0, '源码里至少有一个 object 类型参数（bili_bridge_config 的 patch）')
ok(hits.every((s) => /additionalProperties:\s*(true|false)/.test(s)), '每个 object 类型参数都在其后显式声明 additionalProperties')

// 五个工具必须都在源码里注册。
for (const name of ['bili_bridge_status', 'bili_bridge_heal', 'bili_bridge_config', 'bili_bridge_route', 'bili_bridge_adopt']) {
  ok(src.includes("name: '" + name + "'"), '注册了 ' + name)
}

console.log(failed === 0 ? '参数 schema 检查通过' : '参数 schema 检查失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
