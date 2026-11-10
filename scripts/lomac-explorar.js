// Explora la consulta pública del LOMAC (ANMAT, alojada por PAMI) para saber cómo extraer el listado
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const reqs = [];
  p.on('request', (r) => { if (r.method() === 'POST') reqs.push(r.url() + ' :: ' + (r.postData() || '').slice(0, 300)); });
  await p.goto('https://servicios.pami.org.ar/vademecum/views/consultaPublica/listado.zul', { waitUntil: 'networkidle', timeout: 90000 });
  await p.screenshot({ path: 'lomac1.png', fullPage: true });
  const txt = await p.evaluate(() => document.body.innerText);
  console.log('TEXTO', txt.slice(0, 2500));
  const inputs = await p.$$eval('input,select,button', (els) => els.map((e) => `${e.tagName} id=${e.id} type=${e.type} ph=${e.placeholder || ''} val=${(e.value || e.innerText || '').slice(0, 40)}`));
  console.log('CONTROLES', inputs.join('\n'));
  // probar una búsqueda
  const inp = await p.$('input[type=text]');
  if (inp) { await inp.fill('ibuprofeno'); await p.keyboard.press('Enter'); await p.waitForTimeout(6000); }
  const btn = await p.$('button:has-text("Buscar"), .z-button:has-text("Buscar")'); if (btn) { await btn.click(); await p.waitForTimeout(6000); }
  await p.screenshot({ path: 'lomac2.png', fullPage: true });
  console.log('TEXTO2', (await p.evaluate(() => document.body.innerText)).slice(0, 4000));
  console.log('POSTS', reqs.slice(-5).join('\n'));
  await b.close();
})().catch((e) => { console.log('ERROR', e.message); process.exit(0); });
