/** 内置 /api 端点清单（不含前导 /api）。覆盖当前 API 全量（含非 RpcMethodMap 的 respond）。
 * 新增 API 方法时必须同步追加到此处或经 config.endpoints 扩展。 */
export const DEFAULT_ENDPOINTS: string[] = [
  'session.create', 'session.prompt', 'session.list', 'session.search',
  'session.history', 'session.models', 'session.selectModel', 'session.rename',
  'session.fork', 'session.export', 'session.cancel', 'session.attachment',
  'commands.execute', 'respond',
  'settings.describe', 'settings.update', 'settings.replace', 'settings.mutate',
  'settings.openDocument', 'credentials.describe', 'credentials.set',
  'credentials.unset', 'host.describe', 'host.pickDirectory', 'host.openPath',
  'llm.discoverModels', 'llm.providers', 'llm.models',
  'agentPreset.list', 'agentPreset.read', 'agentPreset.copy',
  'agentPreset.remove', 'agentPreset.openDocument',
]
