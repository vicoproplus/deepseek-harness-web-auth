import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAuthHandler } from '../src/auth-handler.ts'

function fakeRes() {
  const calls: { status: number }[] = []
  const res = {
    writeHead(status: number) { calls.push({ status }) },
    end() {},
  }
  return { res: res as unknown as ServerResponse, calls }
}

function fakeReq(authorization?: string): IncomingMessage {
  return { headers: authorization === undefined ? {} : { authorization } } as IncomingMessage
}

describe('createAuthHandler', () => {
  const forward = async () => {}
  const handler = createAuthHandler({ token: 'secret-token', rejectStatus: 401, forward })

  it('无 Authorization 头 → rejectStatus 且不转发', async () => {
    const { res, calls } = fakeRes()
    let forwarded = false
    const h = createAuthHandler({ token: 't', rejectStatus: 401, forward: async () => { forwarded = true } })
    await h(fakeReq(), res)
    assert.deepEqual(calls, [{ status: 401 }])
    assert.equal(forwarded, false)
  })

  it('非 Bearer 格式 → 401', async () => {
    const { res, calls } = fakeRes()
    await handler(fakeReq('Basic abc'), res)
    assert.deepEqual(calls, [{ status: 401 }])
  })

  it('错误 token → 401 且不转发', async () => {
    const { res, calls } = fakeRes()
    let forwarded = false
    const h = createAuthHandler({ token: 'secret-token', rejectStatus: 401, forward: async () => { forwarded = true } })
    await h(fakeReq('Bearer wrong'), res)
    assert.deepEqual(calls, [{ status: 401 }])
    assert.equal(forwarded, false)
  })

  it('正确 token → 转发', async () => {
    const { res, calls } = fakeRes()
    let forwarded = false
    const h = createAuthHandler({ token: 'secret-token', rejectStatus: 401, forward: async () => { forwarded = true } })
    await h(fakeReq('Bearer secret-token'), res)
    assert.deepEqual(calls, [])
    assert.equal(forwarded, true)
  })

  it('rejectStatus 可配置为 403', async () => {
    const { res, calls } = fakeRes()
    const h = createAuthHandler({ token: 't', rejectStatus: 403, forward })
    await h(fakeReq(), res)
    assert.deepEqual(calls, [{ status: 403 }])
  })
})
