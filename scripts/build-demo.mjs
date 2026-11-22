/**
 * Builds the self-contained browser demo (in-memory data, no Supabase/AI/Google) into
 * dist-demo/ so it can be hosted under ANY path prefix:
 *   - bundles move from _expo/static/js/web/ to js/ and absolute URLs are made relative,
 *   - a <base> is pinned to the page's original folder before anything loads, so assets and
 *     lazy route chunks still resolve after the router changes the URL with pushState.
 * Usage: npm run build:demo
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('dist-demo');
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx expo export --platform web --output-dir ${out}`, {
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_DEMO: '1', EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_ANON_KEY: '' },
});

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

// Some hosts reserve names starting with "_": move the bundles to js/.
fs.renameSync(path.join(out, '_expo', 'static', 'js', 'web'), path.join(out, 'js'));
fs.rmSync(path.join(out, '_expo'), { recursive: true, force: true });
fs.rmSync(path.join(out, 'metadata.json'), { force: true });
for (const file of walk(path.join(out, 'js'))) {
  if (!file.endsWith('.js')) continue;
  const src = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, src.replaceAll('"/_expo/static/js/web/', '"js/').replaceAll('"/assets/', '"assets/'));
}

const indexPath = path.join(out, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const pinBase = `<script>(function(){try{var b=document.createElement('base');b.href=location.href.replace(/[?#].*$/,'').replace(/[^/]*$/,'');document.head.prepend(b);}catch(e){}})();</script>`;
html = html
  .replace('<head>', `<head>\n    ${pinBase}`)
  .replaceAll('src="/_expo/static/js/web/', 'src="js/')
  .replace('href="/favicon.ico"', 'href="favicon.ico"')
  .replace('href="/manifest.json"', 'href="manifest.json"')
  .replace('href="/apple-touch-icon.png"', 'href="apple-touch-icon.png"')
  // The hosted demo is not an installable app: no service worker there.
  .replace("if ('serviceWorker' in navigator && ", 'if (false && ')
  .replace('<html lang="en">', '<html lang="vi">')
  .replace('<title>Nhịp</title>', '<title>Nhịp — bản demo</title>');
fs.writeFileSync(indexPath, html);

const files = walk(out);
const bytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`demo ready: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${out}`);
