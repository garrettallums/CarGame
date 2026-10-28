// Builds a single self-contained HTML file (JS and CSS inlined) that can be
// published as a claude.ai Artifact: node scripts/build-artifact.mjs [out.html]
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = 'dist-artifact';
const outFile = process.argv[2] || join(outDir, 'sand-and-steel.html');

await build({
  mode: 'artifact',
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true, cssCodeSplit: false, modulePreload: false, copyPublicDir: false, target: 'es2020' },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8'));
if (js.length !== 1) throw new Error(`expected one JS chunk, got ${js.length}`);

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const page = `<title>Sand &amp; Steel</title>
<style>
${css.join('\n')}
</style>
${body}
<script type="module">
${js[0].replace(/<\/script/gi, '<\\/script')}
</script>
`;
writeFileSync(outFile, page);
console.log(`wrote ${outFile} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
