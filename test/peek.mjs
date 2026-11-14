import { resolvePaths } from '../lib/paths.mjs'
import { readSide } from '../lib/adapters.mjs'
const paths = resolvePaths()
const show = (n, p) => {
  const s = readSide(n, p)
  console.log(n, '|', s.exists ? 'exists' : 'missing', '| uid', s.cookie?.dedeuserid || s.cookie?.uid || '(none)', '| fp', s.fingerprint || '-', '| mtime', s.mtime ? new Date(s.mtime).toISOString() : '-', '|', p)
  if (s.error) console.log('   err', s.error)
}
console.log('dir:', paths.dir)
show('whale  ', paths.whale)
show('dafeiyu', paths.dafeiyu)
