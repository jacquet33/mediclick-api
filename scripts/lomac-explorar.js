const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.goto('https://servicios.pami.org.ar/vademecum/views/consultaPublica/listado.zul', { waitUntil: 'networkidle', timeout: 90000 });
  const info = async (tag) => {
    const d = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('tr.z-row, tr.z-listitem')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()));
      const pag = [...document.querySelectorAll('.z-paging, .z-paging-text, .z-paging-info')].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' | ');
      const html = (document.querySelector('.z-paging') || {}).outerHTML || '';
      return { n: rows.length, primera: rows[0], ultima: rows[rows.length - 1], pag, html: html.slice(0, 1500) };
    });
    console.log(tag, JSON.stringify(d));
  };
  // 1) Búsqueda vacía
  await p.click('button:has-text("Buscar")'); await p.waitForTimeout(8000); await info('VACIA');
  // 2) Nombre comercial "a"
  await p.fill('#zk_comp_34', 'a'); await p.click('button:has-text("Buscar")'); await p.waitForTimeout(8000); await info('COMERCIAL_a');
  // 3) siguiente página
  const next = await p.$('.z-paging-next, a.z-paging-next, button.z-paging-next');
  if (next) { await next.click(); await p.waitForTimeout(5000); await info('PAG2'); }
  // 4) genérico "%"
  await p.fill('#zk_comp_34', ''); await p.fill('#zk_comp_28', '%'); await p.click('button:has-text("Buscar")'); await p.waitForTimeout(8000); await info('GEN_PCT');
  await b.close();
})().catch((e) => { console.log('ERROR', e.message); process.exit(0); });
