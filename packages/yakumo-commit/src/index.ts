import fs from 'node:fs'
import pathLib from 'node:path'

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

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('yakumo-commit')

  const action = async (
    cwd: string,
    path: string,
    msg: string,
    push: boolean,
    retries: number = 3,
  ) => {
    const logger = ctx.logger(path)

    const realAction = async () => {
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

      // has not pushed commits
      if (push) {
        if (status.ahead) {
          logger.info(`pushing...`)
          await git.push()
        } else {
          logger.info(`no staged commits`)
        }
      }
    }

    for (let i = 0; i < retries; i++) {
      try {
        return await realAction()
      } catch (e) {
        logger.warn(`${e} (tried ${i} times)`)
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
        paths.map((path) =>
          action(ctx.yakumo.cwd, path, msg, push, retries).catch((e) =>
            e instanceof Error ? e : new Error(e),
          ),
        ),
      )

      const hasError = results.some((e) => e instanceof Error)
      if (hasError) {
        logger.error('error occurred, will not continue committing root workspace')
        return
      }

      await action(ctx.yakumo.cwd, '/', msg, push, retries)
    },
    {
      boolean: ['push'],
      number: ['retries'],
    },
  )
}
