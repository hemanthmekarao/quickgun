// Renders web/icons/icon.svg to the PNG sizes stores/PWAs need. Uses Playwright (already present in this env).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../web/icons/icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch();
const render = async (size, name, pad = 0) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = size - pad * 2;
  await p.setContent(`<body style="margin:0;background:#0f766e"><div style="margin:${pad}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await p.screenshot({ path: new URL(`../web/icons/${name}`, import.meta.url).pathname, omitBackground: false });
  await p.close();
};
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', 64); // safe-zone padding for maskable
await b.close();
console.log('icons written');
