// Contrôles à la troisième personne (mode « district », Playwright MCP) :
// le lacet de la caméra (lu sur la rotation de la minimap) et la position
// du joueur pendant qu'on avance, recule, tourne et pousse contre un mur ;
// et la cadence de redessin de la minimap. Serveur et client lancés
// (.claude/launch.json). Outil de travail, pas un test.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("http://localhost:5173/?gfx=v2&debug=perf");
  await page.evaluate(() => {
    localStorage.setItem("blade.theme", "neon");
    localStorage.setItem("blade.settings", JSON.stringify({ qualityChoice: "high" }));
  });
  await page.reload();
  await page.waitForTimeout(3500);
  await page.getByPlaceholder(/PSEUDO|NAME/i).fill("Test");
  await page.locator('[data-i18n="lobby.createRoom"]').click();
  await page.waitForTimeout(300);
  await page.locator(".bio2-mode", { hasText: /QUARTIER|DISTRICT/ }).click();
  await page.locator("#enter-btn").click();
  await page.mouse.move(640, 362);
  await page.waitForTimeout(5000);
  const start = page.getByText(/C'EST PARTI|LET'S GO/i);
  if (await start.count()) await start.first().click().catch(() => {});
  await page.mouse.move(640, 362);
  await page.waitForTimeout(1000);
  const read = () => page.evaluate(() => {
    const m = /rotate\((-?[\d.]+)deg\)/.exec(document.getElementById("minimap").style.transform);
    const me = window.__bladePerf?.me?.();
    return { yaw: m ? Number(m[1]) : 0, x: me ? Math.round(me.x * 10) / 10 : null, y: me ? Math.round(me.y * 10) / 10 : null };
  });
  const out = { start: await read() };
  const hold = async (keys, ms, name) => {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(150);
    out[name] = await read();
  };
  await hold("w", 1500, "avance");
  await hold("s", 2000, "recule");
  await hold("d", 800, "droite");
  await hold("w", 6000, "contre un mur");
  await hold("s", 1500, "recule encore");
  // Cadence de la minimap : redessins comptés pendant une seconde de course.
  await page.evaluate(() => {
    const ctx = document.getElementById("minimap").getContext("2d");
    window.__mmDraws = 0;
    const clear = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...a) => { window.__mmDraws++; return clear(...a); };
  });
  await page.keyboard.down("a");
  await page.waitForTimeout(1000);
  out.minimapDrawsPerSecond = await page.evaluate(() => window.__mmDraws);
  await page.keyboard.up("a");
  await page.screenshot({ path: "C:/dev/blades-io/art/shots/controls.png" });
  return out;
}
