import { readFile, writeFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { build } from 'esbuild'

const PREFIX = 'dsh-status-'

/**
 * Collect every class selector in a stylesheet. Matches `.name` wherever a
 * rule references it, including attribute-composed selectors (`.toast[data-x]`).
 */
function classNames(text) {
  return [...new Set([...text.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(match => match[1]))]
}

/**
 * Plain CSS Modules substitute: default import yields a class map prefixed
 * with `dsh-status-` (collision-safe across plugins); `?raw` import yields the
 * stylesheet text with the same prefix applied, for the apply-time style tag.
 */
const prefixedCssPlugin = {
  name: 'prefixed-css',
  setup(build) {
    build.onResolve({ filter: /\.css(\?raw)?$/ }, (args) => {
      const rawQuery = args.path.endsWith('?raw')
      const clean = args.path.replace(/\?raw$/, '')
      const absolute = resolvePath(args.resolveDir, clean)
      return { path: rawQuery ? `${absolute}?raw` : absolute, namespace: 'css' }
    })
    build.onLoad({ filter: /.*/, namespace: 'css' }, async (args) => {
      const rawQuery = args.path.endsWith('?raw')
      const absolute = args.path.replace(/\?raw$/, '')
      const text = await readFile(absolute, 'utf8')
      const names = classNames(text)
      const prefixed = text.replace(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g, (match, name) => {
        return names.includes(name) ? `.${PREFIX}${name}` : match
      })
      if (rawQuery) {
        return { contents: `export default ${JSON.stringify(prefixed)}`, loader: 'js' }
      }
      const map = Object.fromEntries(names.map(name => [name, `${PREFIX}${name}`]))
      return { contents: `export default ${JSON.stringify(map)}`, loader: 'js' }
    })
  },
}

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
  plugins: [prefixedCssPlugin],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-status-plugin", factory: (require) => { const module = { exports: {} }; const exports = module.exports;',
  },
  footer: {
    js: ' return module.exports; } });',
  },
})

// esbuild emits dsh-status- prefixed runtime classes; keep the map readable on disk.
const output = await readFile('lib/client.js', 'utf8')
await writeFile('lib/client.js', output, 'utf8')
console.log('lib/client.js built')