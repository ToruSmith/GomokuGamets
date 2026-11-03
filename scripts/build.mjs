// 建置腳本。esbuild 負責打包，其餘（HTML、Service Worker、靜態檔）都在這裡處理。
//   node scripts/build.mjs            正式版，輸出 dist/
//   node scripts/build.mjs --demo     單一 HTML 試玩版，輸出 dist-demo/（無線上對戰）
//   node scripts/build.mjs --e2e      端對端測試版，輸出 dist-e2e/（線上對戰走本機模擬）
//   node scripts/build.mjs --serve    開發伺服器
//   node scripts/build.mjs --preview  建置正式版並啟動靜態伺服器
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import esbuild from 'esbuild';

const flags = new Set(process.argv.slice(2));
const demo = flags.has('--demo');
const e2e = flags.has('--e2e');
const serve = flags.has('--serve');
const preview = flags.has('--preview');
const port = Number(process.env.PORT ?? 5173);

const outdir = demo ? 'dist-demo' : e2e ? 'dist-e2e' : 'dist';
const backend = demo ? 'none' : e2e ? 'local' : 'firebase';

/** 把 inline-worker:./x.ts 打包成字串 */
const inlineWorker = {
  name: 'inline-worker',
  setup(build) {
    build.onResolve({ filter: /^inline-worker:/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice('inline-worker:'.length)),
      namespace: 'inline-worker',
    }));
    build.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async (args) => {
      const result = await esbuild.build({
        entryPoints: [args.path],
        bundle: true,
        minify: !serve,
        write: false,
        format: 'iife',
        target: 'es2022',
      });
      return {
        contents: result.outputFiles[0].text,
        loader: 'text',
        watchFiles: result.metafile ? Object.keys(result.metafile.inputs) : [],
      };
    });
  },
};

const options = {
  entryPoints: { app: 'src/main.ts' },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  metafile: true,
  outdir: `${outdir}/assets`,
  entryNames: serve ? '[name]' : '[name]-[hash]',
  loader: { '.webp': 'dataurl' },
  legalComments: 'none',
  define: {
    __ROOM_BACKEND__: JSON.stringify(backend),
    __PWA__: String(!demo && !serve && !e2e),
    __DEMO__: String(demo),
  },
  plugins: [inlineWorker],
};

const template = fs.readFileSync('index.template.html', 'utf8');

function renderHtml({ css, js, links }) {
  return template
    .replace('<!--head-links-->', links)
    .replace('<!--app-css-->', () => css)
    .replace('<!--app-js-->', () => js);
}

const PWA_LINKS = `<link rel="manifest" href="./manifest.webmanifest" />
    <link rel="icon" href="./icons/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />`;

function outputsOf(metafile) {
  const files = Object.keys(metafile.outputs);
  const jsFile = files.find((file) => file.endsWith('.js'));
  const cssFile = files.find((file) => file.endsWith('.css'));
  return { jsFile, cssFile };
}

function copyPublic() {
  fs.cpSync('public', outdir, { recursive: true });
}

function writeServiceWorker(jsFile, cssFile) {
  const assets = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icons/favicon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    `./${path.relative(outdir, jsFile)}`,
    `./${path.relative(outdir, cssFile)}`,
  ];
  const hash = createHash('sha256').update(assets.join()).digest('hex').slice(0, 10);
  const source = fs
    .readFileSync('public/sw.js', 'utf8')
    .replace('__VERSION__', hash)
    .replace('__ASSETS__', JSON.stringify(assets));
  fs.writeFileSync(`${outdir}/sw.js`, source);
}

function serveStatic(root) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
  };
  http
    .createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
      if (!file.startsWith(path.resolve(root)) && !file.startsWith(root)) {
        response.writeHead(403).end();
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          response.writeHead(404).end('Not found');
          return;
        }
        response.writeHead(200, {
          'content-type': types[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        response.end(data);
      });
    })
    .listen(port, () => console.log(`http://localhost:${port}/`));
}

async function main() {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });

  if (serve) {
    copyPublic();
    fs.writeFileSync(
      `${outdir}/index.html`,
      renderHtml({
        links: PWA_LINKS,
        css: '<link rel="stylesheet" href="./assets/app.css" />',
        js: '<script type="module" src="./assets/app.js"></script>',
      }),
    );
    const context = await esbuild.context(options);
    await context.watch();
    serveStatic(outdir);
    return;
  }

  const result = await esbuild.build(options);
  const { jsFile, cssFile } = outputsOf(result.metafile);

  if (demo) {
    // 單檔版：把 JS 與 CSS 直接嵌進 HTML
    const css = fs.readFileSync(cssFile, 'utf8');
    const js = fs.readFileSync(jsFile, 'utf8').replaceAll('</script', '<\\/script');
    const page = renderHtml({
      links: '',
      css: `<style>${css}</style>`,
      js: `<script type="module">${js}</script>`,
    });
    // 試玩版發布時由平台包上 <html> 外殼，這裡只留內容
    const head = /<head>([\s\S]*)<\/head>/.exec(page)[1];
    const body = /<body>([\s\S]*)<\/body>/.exec(page)[1];
    fs.writeFileSync(
      `${outdir}/index.html`,
      head.replace(/<meta (charset|name="viewport")[^>]*\/>\s*/g, '') + body,
    );
    fs.rmSync(`${outdir}/assets`, { recursive: true, force: true });
  } else {
    copyPublic();
    fs.writeFileSync(
      `${outdir}/index.html`,
      renderHtml({
        links: PWA_LINKS,
        css: `<link rel="stylesheet" href="./${path.relative(outdir, cssFile)}" />`,
        js: `<script type="module" src="./${path.relative(outdir, jsFile)}"></script>`,
      }),
    );
    writeServiceWorker(jsFile, cssFile);
  }

  const sizes = fs
    .readdirSync(demo ? outdir : `${outdir}/assets`)
    .map((file) => {
      const full = path.join(demo ? outdir : `${outdir}/assets`, file);
      return `${file} ${(fs.statSync(full).size / 1024).toFixed(0)} KB`;
    })
    .join(', ');
  console.log(`${outdir}: ${sizes}`);

  if (preview) serveStatic(outdir);
}

await main();
