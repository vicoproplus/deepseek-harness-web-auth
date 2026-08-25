import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'

/** 载波体上限：与 client-connection 现有默认一致（300 MiB）。 */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

/** 校验通过后把 node:http 请求桥接到 API 网关：body 缓冲 → fetch Request → 流式回写。 */
export async function forwardToApi(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<void> {
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > maxRequestBodyBytes) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    chunks.push(buffer)
  }
  const request = new Request(new URL(req.url ?? '/', 'http://dsh.internal'), {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][]),
    ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
  })
  const response = await toFetchHandler(apiProxy).fetch(request)
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    // 背压：socket 缓冲满则等待 drain，避免无界缓冲（慢速/挂起 SSE 消费端）
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          res.off('drain', done)
          res.off('close', done)
          resolve()
        }
        res.once('drain', done)
        res.once('close', done)
      })
    }
  }
  res.end()
}
