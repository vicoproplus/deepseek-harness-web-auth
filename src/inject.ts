/** tapIndex transform：把鉴权引导脚本注入 index.html（renderIndex 后、注册顺序应用）。 */
export function injectTokenScript(tokenMode: 'auto' | 'manual', token: string) {
  return (html: string): string => {
    if (tokenMode === 'auto') {
      const script = `<script>window.__DSH_AUTH_TOKEN__=${JSON.stringify(token)}</script>`
      return html.replace('<head>', `<head>${script}`)
    }
    // manual：页面脚本提示输入 token 存入 localStorage，并包装 fetch 为同源 /api 附加 Authorization
    const script = `<script>
(function () {
  window.__DSH_AUTH_MANUAL__ = true
  function getToken() {
    try {
      var t = localStorage.getItem('dsh-web-auth-token')
      if (!t) {
        t = window.prompt('DSH web auth token:') || ''
        if (t) localStorage.setItem('dsh-web-auth-token', t)
      }
      return t
    } catch (e) { return '' }
  }
  var _token = getToken()
  var _fetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    try {
      var u = new URL(url, window.location.href)
      if (u.origin === window.location.origin && u.pathname.indexOf('/api/') === 0 && _token) {
        init = init || {}
        init.headers = Object.assign({}, init.headers, { 'Authorization': 'Bearer ' + _token })
      }
    } catch (e) {}
    return _fetch(input, init)
  }
})()
</script>`
    return html.replace('<head>', `<head>${script}`)
  }
}
