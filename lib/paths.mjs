import os from 'node:os'
import path from 'node:path'

/** 家目录 / DSH 家目录：与两个插件读同一套环境变量，保证指向同一批文件。 */
export const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir()
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')

/**
 * 所有落点集中在这里。测试与自检可以用 env 覆盖，生产环境就是默认值。
 *   whale   : 养鱼读它自己的 ~/.bili-ai/credentials.json
 *   dafeiyu : 大肥鱼读 $DSH_HOME/bili-duty/bili_credential.json
 *   binding : 大肥鱼的账号账本（activeUid 是"这台机器绑的是谁"的权威记录）
 */
export function resolvePaths(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir()
  const dshHome = env.DSH_HOME || path.join(home, '.dsh')
  const dir = env.BILI_BRIDGE_HOME || path.join(dshHome, 'bili-account-bridge')
  return {
    home,
    dshHome,
    dir,
    whale: env.BILI_WHALE_CREDENTIALS || path.join(home, '.bili-ai', 'credentials.json'),
    dafeiyu: env.BILI_DAFEIYU_CREDENTIALS || path.join(dshHome, 'bili-duty', 'bili_credential.json'),
    binding: path.join(dshHome, 'bili-duty', 'account-binding.json'),
    store: path.join(dir, 'account.json'),
    config: path.join(dir, 'config.json'),
    state: path.join(dir, 'state.json'),
    events: path.join(dir, 'events.jsonl'),
    conflict: path.join(dir, 'conflict.json'),
    history: path.join(dir, 'history'),
  }
}
