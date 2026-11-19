// Tour du quartier (mode « district », Playwright MCP) : salon privé, mode
// QUARTIER, puis une promenade au clavier avec une image à chaque étape.
// Serveur et client lancés (.claude/launch.json). Outil de travail.
async (page) => {
  // query : "gfx=v2" pour le quartier modélisé, "x=1" pour les blocs.
  const cfg = { query: "gfx=v2", tag: "real", theme: "neon", quality: "high" };
  const dir = "C:/dev/blades-io/art/shots/";
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`http://localhost:5173/?${cfg.query}&debug=perf`);
  await page.evaluate((c) => {
    localStorage.setItem("blade.theme", c.theme);
    localStorage.setItem("blade.settings", JSON.stringify({ qualityChoice: c.quality }));
  }, cfg);
  await page.reload();
  await page.waitForTimeout(3500);
  await page.getByPlaceholder(/PSEUDO|NAME/i).fill("Test");
  await page.locator('[data-i18n="lobby.createRoom"]').click();
  await page.waitForTimeout(300);
  await page.locator(".bio2-mode", { hasText: /QUARTIER|DISTRICT/ }).click();
  // Bots : la case est stylée (cachée), on la coche par le script.
  await page.evaluate(() => {
    const box = document.getElementById("create-bots");
    if (box && !box.checked) box.click();
  });
  await page.waitForTimeout(200);
  await page.locator("#enter-btn").click();
  await page.mouse.move(640, 362);
  await page.waitForTimeout(5000);
  const start = page.getByText(/C'EST PARTI|LET'S GO/i);
  if (await start.count()) await start.first().click().catch(() => {});
  await page.mouse.move(640, 362);
  await page.waitForTimeout(1500);
  const shots = [];
  const shot = async (name) => {
    await page.screenshot({ path: `${dir}${cfg.tag}_${name}.png` });
    shots.push({ name, me: await page.evaluate(() => window.__bladePerf?.me?.()) });
  };
  await shot("spawn");
  // Promenade : chaque étape tient des touches un moment. Haut = droit
  // devant, la caméra suit dans le dos.
  const legs = [["w", 2500], ["wd", 1800], ["w", 3000], ["wa", 1800], ["w", 3500], ["wd", 2200], ["w", 3500], ["wa", 2000], ["w", 3000]];
  for (let i = 0; i < legs.length; i++) {
    const [keys, ms] = legs[i];
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await shot(`walk${i}`);
    for (const k of keys) await page.keyboard.up(k);
  }
  const perf = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t && t.startsWith("perf ·")));
  const errors = await page.evaluate(() => window.__errs ?? null);
  return { shots, perf, errors };
}
