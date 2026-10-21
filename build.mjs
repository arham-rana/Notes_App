// Builds everything the browser loads. Run by `npm run build` (and in Docker).
//  - public/js/vendor/collab.js: the editor engine and KaTeX (maths)
//  - public/dist/: the app's own code combined into compact files, and a compact stylesheet
// The readable sources in public/js and public/css are what you edit.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// The server also serves /shared/*.mjs to the browser; when bundling, read them from disk.
const sharedFiles = { name: 'shared-files', setup(b) {
  b.onResolve({ filter: /^\/shared\// }, (a) => ({ path: path.resolve(a.path.slice(1)) }));
  // The editor engine stays a separate, cacheable file loaded from its own address.
  b.onResolve({ filter: /^\/js\/vendor\// }, (a) => ({ path: a.path, external: true }));
} };

await build({
  entryPoints: { collab: 'client-src/collab.js' },
  outdir: 'public/js/vendor',
  bundle: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
});

rmSync('public/dist', { recursive: true, force: true });
await build({
  // The app, and the page people open from a share link (they share common code).
  entryPoints: { app: 'public/js/app.js', 'share-link': 'public/js/share-link.js' },
  outdir: 'public/dist',
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [sharedFiles],
});
await build({
  entryPoints: { app: 'public/css/app.css' },
  outdir: 'public/dist',
  bundle: true, minify: true, logLevel: 'warning',
});

mkdirSync('public/vendor/katex', { recursive: true });
cpSync('node_modules/katex/dist/katex.min.css', 'public/vendor/katex/katex.min.css');
cpSync('node_modules/katex/dist/fonts', 'public/vendor/katex/fonts', { recursive: true });
console.log('Built the editor, the app and the stylesheet.');
