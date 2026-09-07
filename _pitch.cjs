const http = require('http'), fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
               '.html':'text/html', '.glb':'model/gltf-binary', '.png':'image/png',
               '.json':'application/json', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const CHARS = 'public/js/characters.js';
const S = process.argv[2];
const set = (field, v) => {
  let s = fs.readFileSync(CHARS, 'utf8');
  s = s.replace(new RegExp('(\n\s*' + field + ': )[\d.]+'), '$1' + v);
  fs.writeFileSync(CHARS, s);
};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (c, t, b) => { res.writeHead(c, { 'Content-Type': t }); res.end(b); };
  if (u.pathname === '/api/admin/me') return send(200, 'application/json', '{"admin":true}');
  if (u.pathname.startsWith('/api')) return send(200, 'application/json', '{}');
  const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, '');
  const f = path.join('public', rel);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return send(404, 'text/plain', 'no');
  send(200, MIME[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
});
async function shoot(browser, out) {
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 640, deviceScaleFactor: 2 });
  await p.goto('http://localhost:8748/', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(3200);
  await p.evaluate(() => document.getElementById('guest-btn')?.click());
  await wait(1400);
  await p.evaluate(() => document.getElementById('char-btn')?.click());
  await wait(6000);
  await p.evaluate(() => {
    const c = [...document.querySelectorAll('#char-modal .char-card')]
      .find((x) => (x.textContent || '').includes('발명'));
    if (c) c.click();
  });
  await wait(1100);
  await p.evaluate(() => document.getElementById('char-close')?.click());
  await wait(500);
  await p.evaluate(() => document.getElementById('start-btn')?.click());
  await wait(700);
  await p.screenshot({ path: path.join(S, out), clip: { x: 375, y: 245, width: 150, height: 155 } });
  await p.close();
}
srv.listen(8748, async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const cases = [
    ['지금',        { pitch: 0,    scale: 0.85 }, 'p_now.png'],
    ['눕힘 0.35',   { pitch: 0.35, scale: 0.85 }, 'p_035.png'],
    ['눕힘 0.6',    { pitch: 0.6,  scale: 0.85 }, 'p_06.png'],
    ['눕힘0.35+크게',{ pitch: 0.35, scale: 1.0  }, 'p_035big.png'],
  ];
  for (const [label, vals, out] of cases) {
    set('pitch', vals.pitch); set('scale', vals.scale);
    await shoot(b, out);
    console.log(label, '찍음');
  }
  set('pitch', 0); set('scale', 0.85);
  await b.close(); srv.close();
});
