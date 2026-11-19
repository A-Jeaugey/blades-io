// Coup d'œil rapide au quartier (Playwright MCP) : entre en salon privé,
// mode QUARTIER, marche un peu et prend trois images. Pour régler le rendu
// sans refaire tout le tour (district.js). Serveur et client lancés.
async (page) => {
  // query : "gfx=v2" (rendu réaliste), plus "debug=ao" pour l'occlusion seule.
  // path "/v2" et mode /^ARÈNE|^ARENA/ : l'arène en cadrage isométrique.
  const cfg = { path: "/", query: "gfx=v2", tag: "look", theme: "neon", quality: "high", mode: /QUARTIER|DISTRICT/ };
  const dir = "C:/dev/blades-io/art/shots/";
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`http://localhost:5173${cfg.path}?${cfg.query}${cfg.query.includes("debug=") ? "" : "&debug=perf"}`);
  await page.evaluate((c) => {
    localStorage.setItem("blade.theme", c.theme);
    localStorage.setItem("blade.settings", JSON.stringify({ qualityChoice: c.quality }));
  }, cfg);
  await page.reload();
  await page.waitForTimeout(3500);
  await page.getByPlaceholder(/PSEUDO|NAME/i).fill("Test");
  await page.locator('[data-i18n="lobby.createRoom"]').click();
  await page.waitForTimeout(300);
  if (cfg.mode) await page.locator(".bio2-mode", { hasText: cfg.mode }).click();
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
  await page.waitForTimeout(1200);
  const shot = (name) => page.screenshot({ path: `${dir}${cfg.tag}_${name}.png` });
  await shot("a");
  const legs = [["w", 2600, "b"], ["wa", 1700, null], ["w", 3200, "c"]];
  for (const [keys, ms, name] of legs) {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    if (name) await shot(name);
    for (const k of keys) await page.keyboard.up(k);
  }
  const perf = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t && t.startsWith("perf ·")));
  return { perf };
}
