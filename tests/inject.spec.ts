import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { injectTokenScript } from '../src/inject.ts'

const HTML = '<head></head><body></body>'

describe('injectTokenScript', () => {
  it('auto 模式注入 token 全局量', () => {
    const out = injectTokenScript('auto', 'abc123')(HTML)
    assert.ok(out.includes('window.__DSH_AUTH_TOKEN__'))
    assert.ok(out.includes('abc123'))
  })
  it('auto 模式保留原 HTML 结构', () => {
    const out = injectTokenScript('auto', 't')(HTML)
    assert.ok(out.startsWith('<head>'))
    assert.ok(out.includes('</body>'))
  })
  it('manual 模式注入登录提示标记且不含 token', () => {
    const out = injectTokenScript('manual', 'never-exposed')(HTML)
    assert.ok(out.includes('__DSH_AUTH_MANUAL__'))
    assert.ok(!out.includes('never-exposed'))
  })
  it('manual 模式注入 fetch 包装（同源 /api 附加 Authorization）', () => {
    const out = injectTokenScript('manual', 't')(HTML)
    assert.ok(out.includes('fetch'))
    assert.ok(out.includes('Authorization'))
  })
})
