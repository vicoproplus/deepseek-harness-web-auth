import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_ENDPOINTS } from './endpoints.ts'
import { resolveToken } from './token.ts'
import { createAuthHandler } from './auth-handler.ts'
import { forwardToApi } from './forward.ts'
import { injectTokenScript } from './inject.ts'

export const name = 'dsh-web-auth'

/** 服务依赖：webServer 就绪后 apply 才被调用；apiProxy 经 ctx.get('apiProxy') 按需获取 */
export const inject = ['webServer']

/** 插件配置：默认值写在 schema，可在 cordis.yml 覆盖 */
export interface Config {
  /** 共享密钥；tokenMode=manual 时必须提供（或经环境变量注入） */
  token?: string
  /** 插件总开关。默认 true */
  enabled: boolean
  /** 需拦截的 /api 端点清单（不含前导 /api）。内置全量方法，可扩展 */
  endpoints: string[]
  /** 未认证响应码。默认 401 */
  rejectStatus: 401 | 403
  /** auto=启动生成+注入+打印；manual=手动粘贴（token 不落地响应） */
  tokenMode: 'auto' | 'manual'
  /** 允许 0.0.0.0 网络暴露（配合反向代理/手动模式使用）。默认 false */
  allowNetworkExposure: boolean
}

export const Config: Schema<Config> = Schema.object({
  token: Schema.string().optional(),
  enabled: Schema.boolean().default(true),
  endpoints: Schema.array(String).default(DEFAULT_ENDPOINTS),
  rejectStatus: Schema.union([Schema.const(401), Schema.const(403)]).default(401),
  tokenMode: Schema.union(['auto', 'manual']).default('auto'),
  allowNetworkExposure: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return
  // 0.0.0.0 网络暴露守卫：默认拒绝启动（漏洞报告 Critical 升级条件）
  if (ctx.webServer.host === '0.0.0.0' && !config.allowNetworkExposure) {
    throw new Error('dsh-web-auth: webServer 绑定 0.0.0.0 存在远程未认证 RCE 风险；如确需网络暴露，请显式设置 allowNetworkExposure: true')
  }
  const token = resolveToken(config)
  ctx.effect(() => {
    const disposers = config.endpoints.map((endpoint) => ctx.webServer.register({
      kind: 'exact',
      path: `/api/${endpoint}`,
      handler: createAuthHandler({
        token,
        rejectStatus: config.rejectStatus,
        forward: (req, res) => forwardToApi(ctx, req, res),
      }),
    }))
    const untap = ctx.webServer.tapIndex(injectTokenScript(config.tokenMode, token))
    if (config.tokenMode === 'auto') {
      ctx.logger.info(`dsh-web-auth token: ${token}`)
    }
    return () => {
      for (const dispose of disposers) dispose()
      untap()
    }
  }, 'dsh-web-auth: exact routes + index tap')
}
