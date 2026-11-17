// Tournée de captures (Playwright MCP) : entre en partie rapide, marche
// jusqu'à chaque point de vue et enregistre une image. Outil de travail de
// la refonte graphique, pas un test.
async (page) => {
  // À régler avant de lancer : paramètres de l'adresse, préfixe des images,
  // lacet de la caméra (Math.PI / 4 avec cam=iso), stockage local à poser
  // (thème, qualité) et points de vue [nom, x, y].
  const cfg = {
    query: "gfx=v2",
    tag: "v2",
    yaw: 0,
    storage: { "blade.theme": "neon", "blade.settings": JSON.stringify({ qualityChoice: "high" }) },
    shots: [["racks", 0, 69], ["bush", 24, 71], ["obelisk", 20, 49], ["pillar", 0, 9], ["arch", 85, 40]],
  };
  const dir = "C:/dev/blades-io/art/shots/";
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`http://localhost:5173/?${cfg.query}&debug=perf`);
  if (cfg.storage) {
    await page.evaluate((st) => { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, cfg.storage);
    await page.reload();
  }
  await page.waitForTimeout(3500);
  await page.getByPlaceholder("TON PSEUDO").fill("Test");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);
  const start = page.getByText("C'EST PARTI");
  if (await start.count()) await start.first().click().catch(() => {});
  const me = () => page.evaluate(() => window.__bladePerf?.me?.());
  const perf = () => page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t && t.startsWith("perf ·")));
  const respawn = async () => {
    const b = page.getByText("REJOUER");
    if (await b.count()) { await b.first().click().catch(() => {}); await page.waitForTimeout(1500); }
  };
  const c = Math.cos(cfg.yaw), s = Math.sin(cfg.yaw);
  const goTo = async (tx, ty, timeoutMs = 35000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const m = await me();
      if (!m || !m.alive) { await respawn(); continue; }
      const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
      if (d < 1.0) break;
      const k = Math.min(240, 50 + d * 30);
      // Direction au sol -> direction à l'écran (caméra tournée de yaw).
      const sx = (dx * c - dy * s) / d, sy = (dx * s + dy * c) / d;
      await page.mouse.move(640 + sx * k, 390 + sy * k * 0.8);
      await page.waitForTimeout(100);
    }
    await page.mouse.move(640, 392);
    await page.waitForTimeout(400);
    return await me();
  };
  const out = [];
  for (const [name, x, y] of cfg.shots ?? [["racks", 0, 69], ["bush", 24, 71], ["obelisk", 20, 49], ["pillar", 0, 9]]) {
    const r = await goTo(x, y);
    await page.screenshot({ path: `${dir}${cfg.tag}_${name}.png` });
    out.push([name, r && Math.round(r.x) + "," + Math.round(r.y), await perf()]);
  }
  return out;
}
