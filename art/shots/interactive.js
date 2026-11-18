// Captures du décor interactif (Playwright MCP) : casse un rack, puis charge
// un obélisque et photographie la charge, le préavis et l'onde. Outil de
// travail, pas un test.
async (page) => {
  // query : "x=1" pour le rendu d'origine, "gfx=v2&cam=iso" pour la version
  // de test ; yaw : Math.PI / 4 avec cam=iso.
  const cfg = { query: "x=1", tag: "ia", yaw: 0 };
  const dir = "C:/dev/blades-io/art/shots/";
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`http://localhost:5173/?${cfg.query}&debug=perf`);
  await page.evaluate(() => {
    localStorage.setItem("blade.theme", "neon");
    localStorage.setItem("blade.settings", JSON.stringify({ qualityChoice: "high" }));
  });
  await page.reload();
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
  const goTo = async (tx, ty, timeoutMs = 40000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const m = await me();
      if (!m || !m.alive) { await respawn(); continue; }
      const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
      if (d < 0.5) break;
      const k = Math.min(240, 45 + d * 30);
      const sx = (dx * c - dy * s) / d, sy = (dx * s + dy * c) / d;
      await page.mouse.move(640 + sx * k, 390 + sy * k * 0.8);
      await page.waitForTimeout(80);
    }
    await page.mouse.move(640, 392);
    await page.waitForTimeout(300);
    return await me();
  };
  const out = [];
  // Rack de droite de la paire sud : on se colle à lui par le sud.
  out.push(["rack", await goTo(2.5, 63.6)]);
  await page.screenshot({ path: `${dir}${cfg.tag}_rack_0.png` });
  for (let i = 1; i <= 3; i++) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${dir}${cfg.tag}_rack_${i}.png` });
  }
  out.push(["after rack", await me()]);
  // Obélisque de l'anneau intérieur le plus proche (21,5 ; 40,6).
  out.push(["obelisk", await goTo(21.5, 43.0)]);
  for (let i = 0; i < 44; i++) {
    await page.screenshot({ path: `${dir}${cfg.tag}_ob_${String(i).padStart(2, "0")}.png` });
    await page.waitForTimeout(500);
  }
  out.push(["end", await me(), await perf()]);
  return out;
}
