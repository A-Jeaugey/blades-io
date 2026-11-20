// Captures des agents (Playwright MCP) : pour chaque agent, un salon privé
// avec bots (serveur server-cheats de .claude/launch.json), /ult, puis la
// capacité (E) et l'ultime (R) visés au curseur ; relève l'état de l'agent
// et le compteur de shaders (« +0 en partie »). Outil de travail, pas un
// test.
async (page) => {
  // query : "x=1" pour le rendu d'origine, "gfx=v2&cam=iso" pour la version
  // de test.
  const cfg = { query: "x=1", tag: "agents", agents: ["volt", "sagaie", "brume", "vortex", "vigie", "rempart"] };
  const dir = "C:/dev/blades-io/art/shots/";
  await page.setViewportSize({ width: 1280, height: 720 });
  const perf = () => page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => t && t.startsWith("perf ·")));
  const agentState = () => page.evaluate(() => window.__bladePerf?.agent?.());
  const out = [];
  for (const [i, agent] of cfg.agents.entries()) {
    await page.goto(`http://localhost:5173/?${cfg.query}&debug=perf`);
    await page.evaluate((a) => {
      localStorage.setItem("blade.theme", "neon");
      localStorage.setItem("blade.settings", JSON.stringify({ qualityChoice: "high" }));
      localStorage.setItem("blade.agent", a);
    }, agent);
    await page.reload();
    await page.waitForTimeout(3500);
    if (i === 0) await page.screenshot({ path: `${dir}${cfg.tag}_lobby.png` });
    await page.getByPlaceholder("TON PSEUDO").fill("Test");
    await page.click('button[data-mode="create"]');
    if (!(await page.locator("#create-bots").isChecked())) await page.locator("#mode-create label.bio2-toggle").click();
    await page.click("#enter-btn");
    await page.waitForTimeout(4000);
    const start = page.getByText("C'EST PARTI");
    if (await start.count()) await start.first().click().catch(() => {});
    await page.waitForTimeout(500);
    // Triche : ultime chargé, capacité prête.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/ult");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    // Curseur du côté du centre de l'arène (on apparaît près du bord) : le
    // joueur y marche, la capacité y vise.
    const m = await page.evaluate(() => window.__bladePerf?.me?.());
    const d = m ? Math.hypot(m.x, m.y) : 0;
    const ux = d > 1 ? -m.x / d : 1;
    const uy = d > 1 ? -m.y / d : 0;
    await page.mouse.move(640 + ux * 220, 360 + uy * 160);
    await page.waitForTimeout(600);
    const before = await agentState();
    await page.screenshot({ path: `${dir}${cfg.tag}_${agent}_0hud.png` });
    await page.keyboard.press("e");
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}${cfg.tag}_${agent}_1e.png` });
    await page.waitForTimeout(600);
    const afterE = await agentState();
    await page.keyboard.press("r");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${dir}${cfg.tag}_${agent}_2r.png` });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${dir}${cfg.tag}_${agent}_3r.png` });
    out.push({ agent, before, afterE, afterR: await agentState(), perf: await perf() });
  }
  return out;
}
