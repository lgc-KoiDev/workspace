import fs from 'node:fs'
import pathLib from 'node:path'

import type Logger from 'reggol'
import z from 'schemastery'
import { simpleGit } from 'simple-git'
import type { Context } from 'yakumo'

export const inject = ['yakumo']

export interface Config {
  push: boolean
  defaultMessage: string
  retries: number
}

// eslint-disable-next-line ts/no-redeclare
export const Config: z<Config> = z.object({
  push: z.boolean().default(false),
  defaultMessage: z.string().default('chore: no commit message specified'),
  retries: z.number().default(3),
})

// eslint-disable-next-line antfu/top-level-function
const mapToErr = (e: unknown): Error => {
  return e instanceof Error ? e : new Error(String(e))
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('yakumo-commit')

  const action = async (
    logger: Logger,
    cwd: string,
    path: string,
    msg: string,
    push: boolean,
  ) => {
    const joinedPath = pathLib.join(cwd, path)

    if (!fs.existsSync(pathLib.join(joinedPath, '.git'))) {
      logger.warn(`skipped`)
      return
    }

    const git = simpleGit({ baseDir: joinedPath })

    let status = await git.status()

    if (status.isClean()) {
      logger.info(`no changes`)
    } else {
      logger.info(`committing...`)
      await git.add('.').commit(msg)
      status = await git.status()
    }

    if (push) {
      if (status.ahead) {
        logger.info(`pushing...`)
        await git.push()
      } else {
        logger.info(`no staged commits`)
      }
    }
  }

  const wrapRetry =
    <A extends any[], R>(
      fn: (...args: A) => R,
      retries: number,
      { logger: localLogger }: { logger?: Logger } = {},
    ) =>
    async (...args: A) => {
      for (let i = 0; i < retries; i++) {
        try {
          return await fn(...args)
        } catch (e) {
          ;(localLogger ?? logger).warn(`${e} (tried ${i} times)`)
        }
      }
    }

  ctx.register(
    'commit',
    async () => {
      const paths = ctx.yakumo.locate([])
      logger.info(`collected ${paths.length} workspaces`)

      const push: boolean = ctx.yakumo.argv.push ?? config.push
      const msg = ctx.yakumo.argv._[0] || config.defaultMessage
      const retries: number = ctx.yakumo.argv.retries ?? config.retries

      const results = await Promise.all(
        paths.map((path) => {
          const logger = ctx.logger(path)
          const f = wrapRetry(action, retries, { logger })
          return f(logger, ctx.yakumo.cwd, path, msg, push).catch(mapToErr)
        }),
      )

      const hasError = results.some(Boolean)
      if (hasError) {
        logger.error('error occurred, will not continue committing root workspace')
        return
      }

      const pathLogger = ctx.logger('/')
      const f = wrapRetry(action, retries, { logger: pathLogger })
      await f(pathLogger, ctx.yakumo.cwd, '/', msg, push)
    },
    {
      boolean: ['push'],
      number: ['retries'],
    },
  )
}
