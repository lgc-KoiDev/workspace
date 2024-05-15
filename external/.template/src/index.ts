import { Context, Schema } from 'koishi'

import zhCNLocale from './locales/zh-CN.yml'

export const name = 'template'
export const inject = []

export interface Config {}
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({}),
]).i18n({
  'zh-CN': zhCNLocale._config,
  zh: zhCNLocale._config,
})

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh-CN', zhCNLocale)
  ctx.i18n.define('zh', zhCNLocale)
}
