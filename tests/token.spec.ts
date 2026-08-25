import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveToken, tokenMatches } from '../src/token.ts'

describe('resolveToken', () => {
  it('auto 模式生成 64 位 hex', () => {
    const t = resolveToken({ tokenMode: 'auto' })
    assert.match(t, /^[0-9a-f]{64}$/)
  })
  it('auto 模式两次生成不同', () => {
    assert.notEqual(resolveToken({ tokenMode: 'auto' }), resolveToken({ tokenMode: 'auto' }))
  })
  it('manual 模式返回配置值', () => {
    assert.equal(resolveToken({ tokenMode: 'manual', token: 'my-token' }), 'my-token')
  })
  it('manual 模式缺 token 抛错', () => {
    assert.throws(() => resolveToken({ tokenMode: 'manual' }), /token/)
  })
})

describe('tokenMatches', () => {
  it('相同 token 返回 true', () => {
    assert.equal(tokenMatches('abc123', 'abc123'), true)
  })
  it('不同 token 返回 false', () => {
    assert.equal(tokenMatches('abc123', 'abc124'), false)
  })
  it('长度不等返回 false（不抛错）', () => {
    assert.equal(tokenMatches('short', 'a-much-longer-token-value'), false)
  })
})
