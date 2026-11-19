// Skins en jeu (Playwright MCP) : salon privé avec bots, mode QUARTIER (vue à
// la troisième personne), tous les joueurs à l'écran habillés à tour de
// rôle (window.__bladePerf.dress, ?debug=perf). Trois vues d'ensemble, puis
// le joueur local dans chaque tenue. Serveur et client lancés.
async (page) => {
  const cfg = { query: "gfx=v2", tag: "skins", theme: "neon", quality: "high" };
  const SKINS = ["", "recrue", "sentinelle", "ninja", "astronaute", "spectre", "robot", "renard", "chevalier", "demon",
    "skateur", "pousse", "martien", "pilote", "dj", "corbeau", "dandy", "samourai", "sorcier", "golem"];
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
  await page.evaluate(() => {
    const box = document.getElementById("create-bots");
    if (box && !box.checked) box.click();
  });
  await page.locator("#enter-btn").click();
  await page.mouse.move(640, 362);
  await page.waitForTimeout(5000);
  const start = page.getByText(/C'EST PARTI|LET'S GO/i);
  if (await start.count()) await start.first().click().catch(() => {});
  await page.mouse.move(640, 362);
  await page.waitForTimeout(800);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  // Vues d'ensemble : chacun sa tenue, la sienne et celles des bots croisés.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down("w");
    await page.evaluate((s) => window.__bladePerf.dress(s), SKINS.slice(7 + i * 4).concat(SKINS));
    await page.waitForTimeout(2500);
    await page.evaluate((s) => window.__bladePerf.dress(s), SKINS.slice(7 + i * 4).concat(SKINS));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}${cfg.tag}_wide${i}.png` });
    await page.keyboard.up("w");
    await page.keyboard.down("d");
    await page.waitForTimeout(600);
    await page.keyboard.up("d");
  }
  for (let i = 0; i < SKINS.length; i++) {
    await page.evaluate((s) => window.__bladePerf.dress([s]), SKINS[i]);
    await page.keyboard.down("s");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${dir}${cfg.tag}_${String(i).padStart(2, "0")}_${SKINS[i] || "base"}.png`, clip: { x: 515, y: 330, width: 250, height: 250 } });
    await page.keyboard.up("s");
    await page.keyboard.down("w");
    await page.waitForTimeout(450);
    await page.keyboard.up("w");
  }
  const perf = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t && t.startsWith("perf ·")));
  return { perf, errors };
}
