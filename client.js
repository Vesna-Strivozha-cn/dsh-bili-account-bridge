/**
 * dsh-bili-account-bridge —— 客户端半边：DSH「设置」里的「B站桥」。
 * 三块内容：登录态桥（原样保留）、插件闸门、文本分流。
 * 数据来自 /dsh-bili-bridge/api/*（同源 fetch），与 host 半端是同一份状态。
 */
window.__ModuleLoader__.load({
  id: "dsh-bili-account-bridge",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = "/dsh-bili-bridge/api"

    const STATUS_TEXT = {
      ok: "两侧一致", adopted: "已接管并铺开", "adopted-partial": "已接管，另一侧还没铺开",
      healed: "已对齐", "heal-pending": "待对齐", settling: "等另一侧落定",
      conflict: "冲突：需要你定夺", expired: "登录态失效", empty: "两侧都还没登录",
      paused: "已暂停", error: "出错", init: "启动中",
    }
    const SIDE_TEXT = { whale: "养鱼", dafeiyu: "大肥鱼" }
    const MODE_TEXT = { action: "行为处理", reply: "正常回复", both: "两者都" }
    const DECISION_TEXT = { reply: "正常回复", whale: "走养鱼", dafeiyu: "走大肥鱼", blocked: "被闸门拦住" }

    const box = { border: "0.5px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "10px 12px" }
    const hint = { color: "var(--dsw-alias-label-tertiary)", fontSize: "11.5px", lineHeight: "17px" }
    const label = { fontSize: "13px", lineHeight: "19px" }
    const btn = { height: "28px", padding: "0 12px", fontSize: "12.5px", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2)", background: "transparent", color: "var(--dsw-alias-label-primary)" }
    const input = { height: "26px", padding: "0 8px", fontSize: "12.5px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l2)", background: "transparent", color: "var(--dsw-alias-label-primary)" }
    const select = { ...input, height: "28px" }

    function SideCard(props) {
      const s = props.side
      if (!s) return null
      const okText = s.verified ? "有效" : (s.exists ? "无效" : "无文件")
      const color = s.verified ? "#2bb673" : (s.exists ? "#ff6b6b" : "var(--dsw-alias-label-tertiary)")
      return h("div", { style: { ...box, flex: "1 1 260px", minWidth: "240px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px" } },
          h("div", { style: { fontWeight: 600, fontSize: "13px" } }, s.label),
          h("div", { style: { color, fontSize: "12px" } }, okText)),
        h("div", { style: { ...label, marginTop: "6px" } }, s.uid ? ("账号 " + s.uname + "（" + s.uid + "）") : "未识别账号"),
        h("div", { style: hint }, "指纹 " + (s.fingerprint || "—") + " · " + (s.mtime ? new Date(s.mtime).toLocaleString() : "无")),
        s.verifyError ? h("div", { style: { ...hint, color: "#ff6b6b" } }, "校验：" + s.verifyError) : null,
        s.error ? h("div", { style: { ...hint, color: "#ffb020" } }, "读取：" + s.error) : null,
        h("div", { style: { ...hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, s.path))
    }

    function Switch(props) {
      return h("label", { style: { display: "inline-flex", gap: "6px", alignItems: "center", fontSize: "12.5px", cursor: props.disabled ? "not-allowed" : "pointer", opacity: props.disabled ? 0.45 : 1 } },
        h("input", { type: "checkbox", checked: !!props.checked, disabled: !!props.disabled, onChange: (e) => props.onChange(e.target.checked) }),
        props.label)
    }

    function GatePanel(props) {
      const cfg = props.cfg
      const gates = cfg.gates
      return h("div", { style: box },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h("div", { style: { fontWeight: 600, fontSize: "13px" } }, "插件闸门"),
          h("div", { style: hint }, "闸门和词库是连着的：词库判给哪一侧，就看那一侧的开关。关掉「行为处理」，那一侧即使判成指令也不会进会话。"),
          h(Switch, { checked: gates.enabled, label: "启用闸门", onChange: (v) => props.patch({ gates: { enabled: v } }) })),
        h("div", { style: { ...hint, margin: "4px 0 8px" } }, "关掉哪一项，那一边就不许做对应的事；总开关关掉时只报告状态，不拦。"),
        ["whale", "dafeiyu"].map((side) => h("div", { key: side, style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap", padding: "4px 0" } },
          h("span", { style: { width: "64px", fontSize: "12.5px" } }, SIDE_TEXT[side]),
          h(Switch, { checked: gates[side].action, disabled: !gates.enabled, label: "行为处理", onChange: (v) => props.patch({ gates: { [side]: { action: v } } }) }),
          h(Switch, { checked: gates[side].reply, disabled: !gates.enabled, label: "正常回复", onChange: (v) => props.patch({ gates: { [side]: { reply: v } } }) }))))
    }

    function RoutingPanel(props) {
      const r = props.cfg.routing
      const rules = r.rules || []
      const applyRules = (next) => {
        props.setConfig({ ...props.cfg, routing: { ...r, rules: next } })
        props.saveRules(next)
      }
      const setField = (i, patch) => {
        props.setConfig({ ...props.cfg, routing: { ...r, rules: rules.map((x, j) => (j === i ? { ...x, ...patch } : x)) } })
      }
      const row = { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", padding: "5px 0", borderTop: "0.5px solid var(--dsw-alias-border-l2)" }
      return h("div", { style: box },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h("div", { style: { fontWeight: 600, fontSize: "13px" } }, "文本分流"),
          h(Switch, { checked: r.enabled, label: "启用分流", onChange: (v) => props.patch({ routing: { enabled: v } }) })),
        h("div", { style: { ...hint, margin: "4px 0 8px" } }, "只按文本判断：前缀在前、包含在后，都填就得同时满足；从上往下，第一条命中的算。没命中就正常回复。"),
        rules.length ? rules.map((rule, i) => h("div", { key: rule.id, style: row },
          h("input", { type: "checkbox", checked: rule.enabled, onChange: (e) => applyRules(rules.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x))) }),
          h("span", { style: { ...hint, width: "18px" } }, rule.id),
          h("input", { value: rule.when.prefix, placeholder: "前缀（如 养鱼:）", style: { ...input, width: "130px" }, onChange: (e) => setField(i, { when: { ...rule.when, prefix: e.target.value } }), onBlur: () => props.saveRules(rules) }),
          h("input", { value: rule.when.contains, placeholder: "包含（可空）", style: { ...input, width: "110px" }, onChange: (e) => setField(i, { when: { ...rule.when, contains: e.target.value } }), onBlur: () => props.saveRules(rules) }),
          h("select", { value: rule.target, style: select, onChange: (e) => applyRules(rules.map((x, j) => (j === i ? { ...x, target: e.target.value } : x))) },
            h("option", { value: "whale" }, "养鱼"), h("option", { value: "dafeiyu" }, "大肥鱼")),
          h("select", { value: rule.mode, style: select, onChange: (e) => applyRules(rules.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x))) },
            h("option", { value: "action" }, "行为处理"), h("option", { value: "reply" }, "正常回复"), h("option", { value: "both" }, "两者都")),
          h("input", { value: rule.note || "", placeholder: "备注", style: { ...input, width: "100px" }, onChange: (e) => setField(i, { note: e.target.value }), onBlur: () => props.saveRules(rules) }),
          h("button", { style: { ...btn, height: "26px", padding: "0 8px" }, onClick: () => applyRules(rules.filter((_, j) => j !== i)) }, "删"))) : null,
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" } },
          h("button", { style: btn, onClick: () => applyRules(rules.concat([{ id: "r" + (rules.length + 1), enabled: true, when: { prefix: "", contains: "" }, target: "whale", mode: "reply", note: "" }])) }, "加一条规则"),
          h("span", { style: hint }, "前缀为空时按包含匹配；两个都空则该规则不生效")),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "10px", flexWrap: "wrap" } },
          h("input", { value: props.test, placeholder: "拿一段话试一下分到哪边", style: { ...input, flex: "1 1 220px" }, onChange: (e) => props.setTest(e.target.value) }),
          h("button", { style: btn, disabled: !props.test.trim() || props.busy === "route", onClick: props.runTest }, props.busy === "route" ? "判断中…" : "试一下")),
        props.testResult ? h("div", { style: { ...hint, marginTop: "6px" } },
          "→ " + (DECISION_TEXT[props.testResult.decision] || props.testResult.decision) + "（" + ((props.testResult.rule || props.testResult.matchedRule) ? "规则 " + (props.testResult.rule || props.testResult.matchedRule).id : "没命中规则") + "，" + props.testResult.reason + (props.testResult.scores ? " · 养鱼 " + props.testResult.scores.whale + " / 大肥鱼 " + props.testResult.scores.dafeiyu : "") + "）") : null)
    }

    function BridgeSection(props) {
      const embedded = !!(props && props.embedded)
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState("")
      const [err, setErr] = useState("")
      const [uid, setUid] = useState("")

      const load = useCallback(async () => {
        try {
          const res = await fetch(API + "/status", { cache: "no-store" })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || ("HTTP " + res.status))
          setData(body)
          setErr("")
          if (body.conflict && body.conflict.accounts && body.conflict.accounts.length) {
            setUid((prev) => prev || String(body.conflict.accounts[0].uid || ""))
          }
        } catch (e) { setErr(String(e && e.message || e)) }
      }, [])

      useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])

      const post = useCallback(async (path, body, tag) => {
        setBusy(tag)
        try {
          const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
          const out = await res.json()
          if (!res.ok || out.ok === false) throw new Error(out.error || ("HTTP " + res.status))
          await load()
          return out
        } catch (e) { setErr(String(e && e.message || e)) } finally { setBusy("") }
      }, [load])

      if (!data) {
        return h("div", { style: { maxWidth: embedded ? "none" : "760px" } },
          embedded ? null : h("h3", { style: { margin: 0, fontSize: "16px", fontWeight: 500 } }, "B站桥"),
          err ? h("div", { style: { color: "#ff6b6b", fontSize: "12.5px" } }, err) : h("div", { style: hint }, "读取中…"))
      }

      const st = data.status
      const badgeColor = st === "ok" || st === "healed" || st === "adopted" ? "#2bb673" : (st === "conflict" || st === "expired" || st === "error" ? "#ff6b6b" : "#ffb020")
      const events = data.events || []

      return h("div", { style: { maxWidth: embedded ? "none" : "760px", display: "flex", flexDirection: "column", gap: "10px", color: "var(--dsw-alias-label-primary)" } },
        embedded ? null : h("h3", { style: { margin: 0, fontSize: "16px", fontWeight: 500 } }, "B站桥"),
        embedded ? null : h("p", { style: { ...hint, margin: 0 } },
          "养鱼与大肥鱼共用一份 B站 登录态。开关与分流在「B站行为设置」那一页。"),

        h("div", { style: { ...box, display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
          h("span", { style: { color: badgeColor, fontWeight: 600, fontSize: "13px" } }, "● " + (STATUS_TEXT[st] || st)),
          h("span", { style: { ...hint, flex: "1 1 320px" } }, data.message || ""),
          data.paused ? h("span", { style: { ...hint, color: "#ffb020" } }, "同步已暂停") : null),

        h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
          h(SideCard, { side: data.sides && data.sides.whale }),
          h(SideCard, { side: data.sides && data.sides.dafeiyu })),

        data.conflict ? h("div", { style: { ...box, borderColor: "#ff6b6b" } },
          h("div", { style: { fontWeight: 600, fontSize: "13px", color: "#ff6b6b" } }, "冲突：" + (data.conflict.kind || "")),
          h("div", { style: { ...hint, marginTop: "4px" } }, data.conflict.message || ""),
          (data.conflict.accounts || []).map((a) => h("div", { key: a.side, style: hint }, "· " + a.side + " → " + a.uid + (a.uname ? "（" + a.uname + "）" : ""))),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" } },
            h("input", { value: uid, onChange: (e) => setUid(e.target.value), placeholder: "要绑定的 mid", style: { ...input, width: "150px" } }),
            h("button", { style: btn, disabled: !!busy || !uid, onClick: () => post("/adopt", { uid, confirm: true }, "adopt") },
              busy === "adopt" ? "写入中…" : "就用这个账号"),
            h("span", { style: hint }, "会覆盖另一侧现有登录态（覆盖前备份）"))) : null,

        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", { style: btn, disabled: !!busy, onClick: () => load() }, "刷新"),
          h("button", { style: btn, disabled: !!busy, onClick: () => post("/heal", { force: true }, "heal") }, busy === "heal" ? "对齐中…" : "立即对齐"),
          h("button", { style: btn, disabled: !!busy, onClick: () => post("/config", { paused: !data.paused }, "pause") },
            data.paused ? "恢复同步" : "暂停同步"),
          ),

        err ? h("div", { style: { ...hint, color: "#ff6b6b" } }, err) : null,

        events.length ? h("div", null,
          h("div", { style: { fontSize: "12.5px", fontWeight: 600, marginBottom: "4px" } }, "最近动作"),
          events.map((e, i) => h("div", { key: i, style: hint },
            new Date(e.at).toLocaleString() + " · " + e.kind + (e.from ? " " + e.from + "→" + e.to : "") + (e.uid ? " · " + e.uid : "")))) : null,

        h("div", { style: hint },
          "数据目录：" + ((data.paths && data.paths.dir) || "") + " · 备份在 history/ 下 · 配置在 config.json"))
    }

    function SettingsSection(props) {
      const embedded = !!(props && props.embedded)
      const [cfg, setConfig] = useState(null)
      const [busy, setBusy] = useState("")
      const [err, setErr] = useState("")
      const [test, setTest] = useState("")
      const [testResult, setTestResult] = useState(null)

      const loadCfg = useCallback(async () => {
        try {
          const res = await fetch(API + "/config", { cache: "no-store" })
          const body = await res.json()
          if (!res.ok || body.ok === false) throw new Error(body.error || ("HTTP " + res.status))
          setConfig(body.config)
          setErr("")
        } catch (e) { setErr(String(e && e.message || e)) }
      }, [])

      useEffect(() => { loadCfg() }, [loadCfg])

      const post = useCallback(async (path, body, tag) => {
        setBusy(tag)
        try {
          const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
          const out = await res.json()
          if (!res.ok || out.ok === false) throw new Error(out.error || ("HTTP " + res.status))
          return out
        } catch (e) { setErr(String(e && e.message || e)); return null } finally { setBusy("") }
      }, [])

      const patch = useCallback(async (p) => {
        const out = await post("/config", { patch: p }, "cfg")
        if (out && out.config) setConfig(out.config)
      }, [post])

      const saveRules = useCallback(async (rules) => {
        const out = await post("/config", { patch: { routing: { rules } } }, "rules")
        if (out && out.config) setConfig(out.config)
      }, [post])

      const runTest = useCallback(async () => {
        setBusy("route")
        try {
          const res = await fetch(API + "/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: test }) })
          const out = await res.json()
          if (!res.ok || out.ok === false) throw new Error(out.error || ("HTTP " + res.status))
          setTestResult(out)
        } catch (e) { setErr(String(e && e.message || e)) } finally { setBusy("") }
      }, [test])

      if (!cfg) {
        return h("div", { style: { maxWidth: embedded ? "none" : "760px" } },
          embedded ? null : h("h3", { style: { margin: 0, fontSize: "16px", fontWeight: 500 } }, "B站行为设置"),
          err ? h("div", { style: { color: "#ff6b6b", fontSize: "12.5px" } }, err) : h("div", { style: hint }, "读取中…"))
      }

      return h("div", { style: { maxWidth: embedded ? "none" : "760px", display: "flex", flexDirection: "column", gap: "10px", color: "var(--dsw-alias-label-primary)" } },
        embedded ? null : h("h3", { style: { margin: 0, fontSize: "16px", fontWeight: 500 } }, "B站行为设置"),
        embedded ? null : h("p", { style: { ...hint, margin: 0 } }, "两件事各自开关：谁可以动（闸门），以及一句话该交给谁（文本分流）。改完即时保存。"),
        h(GatePanel, { cfg, patch }),
        h(RoutingPanel, { cfg, patch, setConfig, saveRules, test, setTest, testResult, runTest, busy }),
        err ? h("div", { style: { ...hint, color: "#ff6b6b" } }, err) : null)
    }

    /** 判定词库：两个插件共用一份 gate-lexicon.json，这里可增删词、改侧别与权重。 */
    function LexiconPanel(props) {
      const [lex, setLex] = useState(null)
      const [err, setErr] = useState("")
      const [busy, setBusy] = useState("")
      const [q, setQ] = useState("")
      const [draft, setDraft] = useState({ word: "", side: "whale" })
      const [probe, setProbe] = useState("")
      const [result, setResult] = useState(null)

      const load = useCallback(async () => {
        setBusy("load"); setErr("")
        try {
          const r = await fetch(API + "/lexicon", { credentials: "same-origin" })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || String(r.status))
          setLex(j.lexicon)
          if (j.error) setErr(j.error)
        } catch (e) { setErr("读词库失败：" + String((e && e.message) || e)) }
        finally { setBusy("") }
      }, [])
      useEffect(() => { load() }, [load])

      const put = useCallback(async (next) => {
        setBusy("save"); setErr("")
        try {
          const r = await fetch(API + "/lexicon", {
            method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
            body: JSON.stringify({ lexicon: next }),
          })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || String(r.status))
          setLex(j.lexicon)
          return true
        } catch (e) { setErr("保存失败：" + String((e && e.message) || e)); return false }
        finally { setBusy("") }
      }, [])

      const runProbe = async () => {
        setBusy("probe"); setResult(null); setErr("")
        try {
          const r = await fetch(API + "/lexicon/test", {
            method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
            body: JSON.stringify({ text: probe, lexicon: lex }),
          })
          setResult(await r.json())
        } catch (e) { setErr("试判失败：" + String((e && e.message) || e)) }
        finally { setBusy("") }
      }

      if (!lex) {
        return h("div", { style: box },
          h("div", { style: { fontWeight: 500 } }, "判定词库"),
          h("div", { style: hint }, busy === "load" ? "读取中…" : "还没读到词库。"),
          err ? h("div", { style: { ...hint, color: "var(--dsw-alias-state-danger-primary)" } }, err) : null,
          h("button", { style: btn, onClick: load }, "重试"))
      }

      const entries = lex.entries || []
      const kw = String(q || "").trim().toLowerCase()
      const shown = kw ? entries.filter((e) => e.word.toLowerCase().includes(kw)) : entries
      const cap = 120

      const update = (idx, patch) => {
        const next = entries.map((e, i) => (i === idx ? { ...e, ...patch } : e))
        setLex({ ...lex, entries: next })
      }
      const remove = (idx) => {
        setLex({ ...lex, entries: entries.filter((_, i) => i !== idx) })
      }
      const add = () => {
        const word = String(draft.word || "").trim()
        if (!word) { setErr("词不能为空"); return }
        if (Array.from(word).length < 2) { setErr("词要两个字以上：单字在「我发了个视频」里也会命中，会误判"); return }
        setLex({ ...lex, entries: entries.concat([{ id: "w" + Date.now(), word, side: draft.side, weight: 1 }]) })
        setDraft({ word: "", side: draft.side })
        setErr("")
      }

      const rows = []
      const limit = Math.min(shown.length, cap)
      for (let i = 0; i < limit; i++) {
        const e = shown[i]
        const idx = entries.indexOf(e)
        rows.push(h("div", { key: e.id || e.word + i, style: { display: "flex", gap: "6px", alignItems: "center" } },
          h("input", { style: { ...input, flex: "1 1 140px" }, value: e.word, onChange: (ev) => update(idx, { word: ev.target.value }) }),
          h("select", { style: { ...select, width: "108px" }, value: e.side, onChange: (ev) => update(idx, { side: ev.target.value }) },
            h("option", { value: "both" }, "两边"),
            h("option", { value: "whale" }, "养鱼"),
            h("option", { value: "dafeiyu" }, "大肥鱼")),
          h("button", { style: btn, onClick: () => remove(idx) }, "删")))
      }

      return h("div", { style: box },
        h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
          h("div", { style: { fontWeight: 500 } }, "判定词库"),
          h("span", { style: hint }, entries.length + " 个词 · 两个插件共用一份 · 命中即计分")),
        h("div", { style: hint }, "分数只表示倾向：过阈值的判给养鱼，其余一律交给大肥鱼，没有「谁都不回」这一档。判给哪一侧，还要看那一侧的闸门开没开。改完要点「保存词库」。" ),
        h("div", { style: hint }, "预设：明显指令口气的词归「养鱼」，其余归「大肥鱼」；词至少两个字（单字容易误判，会被丢掉）。" ),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
          h("span", { style: label }, "阈值"),
          h("input", {
            style: { ...input, width: "80px" }, type: "number", min: 0.05, max: 1, step: 0.05, value: String(lex.threshold),
            onChange: (ev) => {
              const n = Number(ev.target.value)
              setLex({ ...lex, threshold: Number.isFinite(n) ? Math.min(1, Math.max(0.05, n)) : 0.5 })
            },
          }),
          h("button", { style: btn, onClick: () => put(lex), disabled: busy === "save" }, busy === "save" ? "保存中…" : "保存词库"),
          h("button", { style: btn, onClick: load }, "重新读取")),
        err ? h("div", { style: { ...hint, color: "var(--dsw-alias-state-danger-primary)" } }, err) : null,

        h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
          h("span", { style: label }, "新增"),
          h("input", { style: { ...input, flex: "1 1 140px" }, placeholder: "词（两字以上），例如 帮我", value: draft.word, onChange: (ev) => setDraft({ ...draft, word: ev.target.value }) }),
          h("select", { style: { ...select, width: "108px" }, value: draft.side, onChange: (ev) => setDraft({ ...draft, side: ev.target.value }) },
            h("option", { value: "both" }, "两边"),
            h("option", { value: "whale" }, "养鱼"),
            h("option", { value: "dafeiyu" }, "大肥鱼")),
          h("button", { style: btn, onClick: add }, "加进词库")),

        h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
          h("span", { style: label }, "找词"),
          h("input", { style: { ...input, flex: "1 1 160px" }, placeholder: "按词过滤", value: q, onChange: (ev) => setQ(ev.target.value) }),
          h("span", { style: hint }, kw ? "筛出 " + shown.length + " 个" : "全 " + entries.length + " 个")),

        h("div", { style: { display: "flex", flexDirection: "column", gap: "5px", maxHeight: "340px", overflow: "auto", paddingRight: "4px" } }, rows),
        shown.length > cap ? h("div", { style: hint }, "只显示前 " + cap + " 个，用「找词」缩小范围。") : null,

        h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
          h("span", { style: label }, "试一句"),
          h("input", { style: { ...input, flex: "1 1 200px" }, placeholder: "把一句话粘进来，看它是几分", value: probe, onChange: (ev) => setProbe(ev.target.value) }),
          h("button", { style: btn, onClick: runProbe, disabled: !probe || busy === "probe" }, busy === "probe" ? "判中…" : "判一下")),
        result ? h("div", { style: hint },
          "得分 " + String(result.score) + " / 阈值 " + String(result.threshold) +
          "　命中：" + ((result.hits || []).map((x) => x.word).join("、") || "无") +
          "　→ " + (!result.decision ? "只看这一侧" :
            result.decision.allow
              ? "走" + (result.decision.side === "whale" ? "养鱼" : "大肥鱼")
              : "拦下（" + "那一侧闸门关着" + "）")) : null)
    }

    /** 设置里的那一页：登录态 + 闸门 + 分流，全在同一页（不再拆两页）。 */
    function SettingsPage() {
      return h("div", { style: { maxWidth: "900px", display: "flex", flexDirection: "column", gap: "14px", color: "var(--dsw-alias-label-primary)" } },
        h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
          h("h3", { style: { margin: 0, fontSize: "16px", fontWeight: 500 } }, "B站桥"),
          h("span", { style: hint }, "一份登录态、两个插件的分工")),
        h(BridgeSection, { embedded: true }),
        h(SettingsSection, { embedded: true }),
        h(LexiconPanel, { embedded: true }),
        h("div", { style: hint }, "词库是两个插件共用的同一份：在这里加的词，养鱼和大肥鱼都按它判断。"))
    }

    function BridgeHome() {
      return h("div", { style: { height: "100%", overflow: "auto", boxSizing: "border-box", padding: "26px 30px 44px", color: "var(--dsw-alias-label-primary)" } },
        h("div", { style: { maxWidth: "980px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" } },
          h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
            h("h2", { style: { margin: 0, fontSize: "20px", fontWeight: 600 } }, "B站桥"),
            h("span", { style: hint }, "养鱼 · 大肥鱼：一份登录态，两个插件的分工")),
          h(BridgeSection, { embedded: true }),
          h(SettingsSection, { embedded: true }),
          h(LexiconPanel, { embedded: true }),
          h("div", { style: hint }, "这一页和设置里的「B站桥」共享同一份状态：这里看登录态、管闸门、排文本分流、维护判定词库，改完即时生效。左侧图标可随时切回来。")))
    }

    function BridgeIcon(props) {
      const size = (props && props.size) || 16
      return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", "aria-hidden": "true" },
        h("circle", { cx: 3.9, cy: 8, r: 2.1 }),
        h("circle", { cx: 12.1, cy: 8, r: 2.1 }),
        h("path", { d: "M6 8h4" }))
    }

    const inject = ["slots"]

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            { name: "settings.section", id: "bili-bridge", order: 7, label: () => "B站桥" },
            SettingsPage,
          ), "bili-bridge: settings section"),
        "bili-bridge: settings section",
      )

      ctx.effect(
        () => ctx.slots.inject("main", () =>
          ctx.slots.register(
            { name: "main", key: "bili-bridge" },
            BridgeHome,
          ), "bili-bridge: main panel"),
        "bili-bridge: main panel",
      )
      ctx.effect(
        () => ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            { name: "sidebar.panellist", id: "bili-bridge", order: 50, label: () => "B站桥" },
            BridgeIcon,
          ), "bili-bridge: sidebar panel"),
        "bili-bridge: sidebar panel",
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.BridgeSection = BridgeSection
    exports.SettingsSection = SettingsSection
    exports.LexiconPanel = LexiconPanel
    exports.SettingsPage = SettingsPage
    exports.BridgeHome = BridgeHome
    exports.BridgeIcon = BridgeIcon

    return module.exports
  },
})
