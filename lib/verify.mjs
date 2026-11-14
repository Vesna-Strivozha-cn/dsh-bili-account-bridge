/** 用 /x/web-interface/nav 验一份 cookie 是否有效、对应哪个 uid。只读。 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

export async function verifyCookie(cookie, { timeoutMs = 8000 } = {}) {
  if (!cookie || !cookie.sessdata || !cookie.bili_jct) {
    return { ok: false, code: 'incomplete', message: '凭据不完整' }
  }
  const parts = ['SESSDATA=' + cookie.sessdata]
  if (cookie.dedeuserid) parts.push('DedeUserID=' + cookie.dedeuserid)
  parts.push('bili_jct=' + cookie.bili_jct)
  if (cookie.buvid3) parts.push('buvid3=' + cookie.buvid3)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: parts.join('; ') },
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, code: 'http-' + res.status, message: 'HTTP ' + res.status }
    const body = await res.json()
    if (body?.code !== 0) return { ok: false, code: body?.code ?? 'unknown', message: body?.message || '接口返回非 0' }
    const data = body.data || {}
    if (data.isLogin !== true || !data.mid) return { ok: false, code: 'not-login', message: 'cookie 已失效（未登录）' }
    return { ok: true, code: 0, uid: String(data.mid), uname: String(data.uname || ''), at: Date.now() }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, code: aborted ? 'timeout' : 'network', message: aborted ? '验证超时' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}
