import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../packages/straddle-js/build'

await build(join(tmpdir(), 'straddle-js-demo'))
console.log('✓ straddle.js built as published')
