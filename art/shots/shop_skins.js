// Skins vus de près : l'aperçu 3D de la boutique (onglet SKINS), une image
// par article essayé. Client lancé (.claude/launch.json), rendu v2.
async (page) => {
  const dir = "C:/dev/blades-io/art/shots/";
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost:5173/?gfx=v2");
  await page.evaluate(() => {
    localStorage.setItem("blade.theme", "neon");
    localStorage.setItem("blade.settings", JSON.stringify({ qualityChoice: "high" }));
  });
  await page.reload();
  await page.waitForTimeout(3500);
  await page.locator("#open-boutique-btn").click();
  await page.waitForTimeout(1200);
  await page.locator('.boutique-tab[data-tab="skins"]').click();
  await page.waitForTimeout(800);
  const cards = page.locator('.boutique-pane[data-pane="skins"] .cos-card .cos-preview');
  const n = await cards.count();
  const stage = page.locator('.boutique-pane[data-pane="skins"] .cos-stage canvas');
  for (let i = 0; i < n; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded();
    await cards.nth(i).click();
    await page.waitForTimeout(450);
    await stage.scrollIntoViewIfNeeded();
    await stage.screenshot({ path: `${dir}shop_${String(i).padStart(2, "0")}.png` });
  }
  return { n };
}
