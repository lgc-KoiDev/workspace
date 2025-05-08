import fs from 'node:fs'
import pathLib from 'node:path'

import z from 'schemastery'
import { simpleGit } from 'simple-git'
import type { Context } from 'yakumo'

export const inject = ['yakumo']

export interface Config {
  push: boolean
}

// eslint-disable-next-line ts/no-redeclare
export const Config: z<Config> = z.object({
  push: z.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('yakumo-commit')

  const realAction = async (cwd: string, path: string, msg: string) => {
    const joinedPath = pathLib.join(cwd, path)

    if (!fs.existsSync(pathLib.join(joinedPath, '.git'))) {
      logger.warn(`${path} | skipped`)
      return
    }

    const git = simpleGit({ baseDir: joinedPath })

    let status = await git.status()

    if (status.isClean()) {
      logger.info(`${path} | no changes`)
    } else {
      logger.info(`${path} | committing...`)
      await git.add('.').commit(msg)
      status = await git.status()
    }

    // has not pushed commits
    if (config.push) {
      if (status.ahead) {
        logger.info(`${path} | pushing...`)
        await git.push()
      } else {
        logger.info(`${path} | no changes to push`)
      }
    }
  }

  const action = async (
    cwd: string,
    path: string,
    msg: string,
    retries: number = 3,
  ) => {
    try {
      return await realAction(cwd, path, msg)
    } catch (e) {
      logger.warn(`${path} | ${e} (${retries} tries left)`)
      if (retries > 0) {
        return await action(cwd, path, msg, retries - 1)
      } else {
        throw e
      }
    }
  }

  ctx.register(
    'commit',
    async () => {
      const paths = ctx.yakumo.locate([])
      logger.info(`collected ${paths.length} workspaces`)

      const msg = ctx.yakumo.argv._[0] || 'up'

      const results = await Promise.all(
        paths.map((path) =>
          action(ctx.yakumo.cwd, path, msg).catch((e) =>
            e instanceof Error ? e : new Error(e),
          ),
        ),
      )

      const hasError = results.some((e) => e instanceof Error)
      if (hasError) {
        logger.error('error occurred, will not continue committing root workspace')
        return
      }

      await action(ctx.yakumo.cwd, '/', msg)
    },
    {
      boolean: ['push'],
    },
  )
}
