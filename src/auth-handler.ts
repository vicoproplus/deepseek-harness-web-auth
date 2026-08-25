import type { IncomingMessage, ServerResponse } from 'node:http'
import { tokenMatches } from './token.ts'

export interface AuthHandlerDeps {
  /** 期望的共享密钥 */
  token: string
  /** 未认证响应码 */
  rejectStatus: 401 | 403
  /** 校验通过后的转发实现（依赖注入，便于单测与组装解耦） */
  forward: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

/** 构造 /api 端点 handler：校验 Authorization 头，未通过返回 rejectStatus，通过则转发。 */
export function createAuthHandler(deps: AuthHandlerDeps) {
  return async function authHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers['authorization']
    const provided = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined
    if (provided === undefined || !tokenMatches(provided, deps.token)) {
      res.writeHead(deps.rejectStatus)
      res.end()
      return
    }
    await deps.forward(req, res)
  }
}
