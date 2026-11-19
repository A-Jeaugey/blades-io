// Capture d'une orbite de N lames (Playwright MCP) : salon privé, triche
// /blades (serveur lancé avec CHEATS=1 : configuration « server-cheats » de
// .claude/launch.json), puis une image. Outil de travail, pas un test.
async (page) => {
  // query : "x=1" pour le rendu d'origine, "gfx=v2", "gfx=v2&cam=iso" ou
  // "gfx=v2&cam=tps" (troisième personne).
  const cfg = { query: "gfx=v2&cam=tps", tag: "tps", theme: "neon", quality: "high", blades: 30 };
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
  // Salon privé : la triche n'y est acceptée que là.
  await page.locator('[data-i18n="lobby.createRoom"]').click();
  await page.waitForTimeout(300);
  await page.locator("#enter-btn").click();
  // Curseur sur le joueur (zone morte) : sinon il marche vers le bouton
  // pendant le chargement, jusque dans le mur.
  await page.mouse.move(640, 362);
  await page.waitForTimeout(4500);
  const start = page.getByText(/C'EST PARTI|LET'S GO/i);
  if (await start.count()) await start.first().click().catch(() => {});
  await page.mouse.move(640, 362);
  const say = async (text) => {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  };
  await say(`/blades ${cfg.blades}`);
  await page.waitForTimeout(2500);
  const me = await page.evaluate(() => window.__bladePerf?.me?.());
  await page.screenshot({ path: `${dir}${cfg.tag}.png` });
  await page.screenshot({ path: `${dir}${cfg.tag}_zoom.png`, clip: { x: 440, y: 190, width: 400, height: 400 } });
  // Quelques secondes de course au clavier : la caméra à la troisième
  // personne se place dans le dos du joueur.
  await page.keyboard.down("w");
  await page.waitForTimeout(1200);
  await page.keyboard.down("d");
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${dir}${cfg.tag}_run.png` });
  await page.keyboard.up("d");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${dir}${cfg.tag}_run2.png` });
  // Suite de la course : de quoi croiser une caisse ou un power-up.
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${dir}${cfg.tag}_walk${i}.png` });
  }
  await page.keyboard.up("w");
  const perf = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t && t.startsWith("perf ·")));
  return { me, perf };
}
