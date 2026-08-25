import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 解析共享密钥：auto 生成 32 字节 hex；manual 读取配置值（缺失即启动失败）。 */
export function resolveToken(config: { token?: string; tokenMode: 'auto' | 'manual' }): string {
  if (config.tokenMode === 'manual') {
    if (config.token === undefined || config.token.length === 0) {
      throw new Error('dsh-web-auth: tokenMode=manual 需要提供 config.token（或经环境变量注入）')
    }
    return config.token
  }
  return randomBytes(32).toString('hex')
}

/** 时序安全比对：两侧先 SHA-256 归一为等长摘要再 timingSafeEqual，避免长度侧信道。 */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
