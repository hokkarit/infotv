// Selaintestit aikajanan (app.js) asettelulle 1920x1080-näytöllä (ks.
// playwright.config.js). Data mockataan Hokkarit-rajapinnan muotoisilla
// kiinteillä testitapauksilla (ks. tests/fixtures.js) — ei siis riipu
// oikeasta rajapinnasta eikä mistään tietystä kalenteripäivästä.
//
// Ajo: npm install && npx playwright install chromium && npm test
"use strict";

const { test, expect } = require("@playwright/test");
const { SCENARIOS } = require("./fixtures");
const { gotoWithScenario, mockScenario } = require("./helpers");

// Kaikki skenaariot joilla on OIKEA (ei rikkinäinen) data — näille ajetaan
// yleiset asettelutarkistukset (ei päällekkäisyyksiä, ei pystysuuntaista
// leikkautumista). "malformedData" testataan erikseen omana tapauksenaan,
// koska sen pointti on nimenomaan virhebanneri, ei laatikoiden asettelu.
const LAYOUT_SCENARIOS = Object.keys(SCENARIOS).filter((name) => name !== "malformedData");

// Ryhmittää laatikot palstan SISÄLLÄ suurin piirtein samaan x-kohtaan
// (sarake) — kaksi laatikkoa samassa sarakkeessa eivät saa olla päällekkäin
// pystysuunnassa (ks. app.js layoutColumns/computeMaxHeightPx, ja
// aiemmat "Estä lyhyen tapahtuman laatikko valumasta seuraavan päälle"
// ym. korjaukset).
function groupByX(boxes) {
  const groups = [];
  for (const b of boxes) {
    let g = groups.find((g) => Math.abs(g.x - b.x) < 2);
    if (!g) {
      g = { x: b.x, items: [] };
      groups.push(g);
    }
    g.items.push(b);
  }
  return groups;
}

// Tarkistaa ettei mikään .event-block leiki NÄKYVÄSTI sisältöään
// (scrollHeight > clientHeight tarkoittaisi että jotain jää overflow:hidden
// -rajan taakse pystysuunnassa) — juuri se bugiluokka joka aiheutti
// "otsikko leikkaantuu pois" -tapauksen (ks. git-historia: chain-group +
// flex-shrink:0 -korjaus).
async function expectNoVerticalClipping(page) {
  const blocks = await page.locator(".event-block").all();
  for (const block of blocks) {
    const { scrollH, clientH, text } = await block.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      text: el.textContent,
    }));
    expect(scrollH, `laatikko leikkautuu pystysuunnassa: "${text}"`).toBeLessThanOrEqual(clientH + 1);
  }
}

async function expectNoOverlap(page) {
  const boxes = await page.locator(".resource-col-body .event-block").all();
  const rects = [];
  for (const b of boxes) {
    const box = await b.boundingBox();
    const text = await b.innerText();
    rects.push({ ...box, text });
  }
  for (const group of groupByX(rects)) {
    group.items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < group.items.length; i++) {
      const prev = group.items[i - 1];
      const cur = group.items[i];
      expect(
        cur.y,
        `"${cur.text}" alkaa ennen kuin "${prev.text}" päättyy samassa sarakkeessa`
      ).toBeGreaterThanOrEqual(prev.y + prev.height - 0.5);
    }
  }
}

test.describe("Yleiset asettelutarkistukset (kaikki skenaariot)", () => {
  for (const name of LAYOUT_SCENARIOS) {
    test(`${name}: ei päällekkäisyyksiä eikä leikkautumista`, async ({ page }) => {
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(err));

      await gotoWithScenario(page, SCENARIOS[name]);

      await expectNoOverlap(page);
      await expectNoVerticalClipping(page);
      expect(pageErrors, `sivulla tapahtui JS-virhe: ${pageErrors[0]}`).toHaveLength(0);

      await page.screenshot({
        path: `test-results/screenshots/${name}.png`,
        fullPage: true,
      });
    });
  }
});

test.describe("Ketjutus (buildRenderUnits/renderChainGroup)", () => {
  test("chainTwoShort: kaksi lyhyttä koskettavaa vuoroa yhdistyy, kolmas (etäämpänä) ei", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.chainTwoShort);

    await expect(page.locator(".event-block.chain-group")).toHaveCount(1);
    // Ottelu 20 min tauolla ei saa olla ketjun sisällä, vaan oma laatikkonsa.
    await expect(page.locator(".event-block:not(.chain-group)")).toHaveCount(1);

    const chain = page.locator(".event-block.chain-group");
    await expect(chain.locator(".chain-item")).toHaveCount(2);
    await expect(chain.locator(".ev-title")).toHaveText("MESTIS alkulämpö");
    await expect(chain.locator(".chain-item-label").nth(0)).toHaveText("tuomarit");
    await expect(chain.locator(".chain-item-label").nth(1)).toHaveText("pelaajat");
  });

  test("chainThreeShort: kolme peräkkäistä lyhyttä osuutta yhdistyy yhdeksi laatikoksi", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.chainThreeShort);

    const chain = page.locator(".event-block.chain-group");
    await expect(chain).toHaveCount(1);
    await expect(chain.locator(".chain-item")).toHaveCount(3);
    await expect(page.locator(".event-block:not(.chain-group)")).toHaveCount(1); // "Turnaus ottelu"
  });

  test("chainNoCommonPrefix: ei yhteistä otsikon osaa -> täydet otsikot listassa, ei ev-title-riviä", async ({
    page,
  }) => {
    await gotoWithScenario(page, SCENARIOS.chainNoCommonPrefix);

    const chain = page.locator(".event-block.chain-group");
    await expect(chain).toHaveCount(1);
    await expect(chain.locator(".ev-title")).toHaveCount(0);
    await expect(chain.locator(".chain-item-label").nth(0)).toHaveText("Ilves");
    await expect(chain.locator(".chain-item-label").nth(1)).toHaveText("Tappara");
  });

  test("chainShortThenLong: lyhyt vuoro vetää mukaan koskettavan pitkän naapurin", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.chainShortThenLong);

    const chain = page.locator(".event-block.chain-group");
    await expect(chain).toHaveCount(1);
    await expect(chain.locator(".chain-item")).toHaveCount(2);
    await expect(chain.locator(".ev-title")).toHaveText("Cup");
  });

  test("touchingNormalLength: kaksi tavallisen pituista koskettavaa vuoroa EI ketjuunnu", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.touchingNormalLength);

    await expect(page.locator(".event-block.chain-group")).toHaveCount(0);
    await expect(page.locator(".event-block")).toHaveCount(2);
  });
});

test.describe("Jaettu jää (groupSharedEvents)", () => {
  test("sharedIce: kaksi samanaikaista vuoroa yhdistyy yhdeksi koko levyiseksi laatikoksi", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.sharedIce);

    const boxes = page.locator(".event-block");
    await expect(boxes).toHaveCount(1);
    await expect(boxes.first()).toContainText("U9 / U8");
    await expect(boxes.first()).not.toHaveClass(/chain-group/);
  });

  test("sharedIceThree: kolme samanaikaista vuoroa yhdistyy", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.sharedIceThree);

    const boxes = page.locator(".event-block");
    await expect(boxes).toHaveCount(1);
    const text = await boxes.first().innerText();
    expect(text).toContain("U7");
    expect(text).toContain("U6");
    expect(text).toContain("U5");
  });
});

test.describe("Päällekkäiset (ei-identtiset) vuorot -> sarakkeet", () => {
  test("overlapPartial: kaksi osittain päällekkäistä vuoroa -> 2 saraketta", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.overlapPartial);

    const boxes = await page.locator(".resource-col-body .event-block").all();
    expect(boxes).toHaveLength(2);
    const xs = new Set();
    for (const b of boxes) {
      const box = await b.boundingBox();
      xs.add(Math.round(box.x));
    }
    expect(xs.size).toBe(2);
  });

  test("overlapTriple: kolme lomittaista vuoroa -> 3 saraketta", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.overlapTriple);

    const boxes = await page.locator(".resource-col-body .event-block").all();
    expect(boxes).toHaveLength(3);
    const xs = new Set();
    for (const b of boxes) {
      const box = await b.boundingBox();
      xs.add(Math.round(box.x));
    }
    expect(xs.size).toBe(3);
  });
});

test.describe("Aikajanan reunatapaukset", () => {
  test("beforeDayStart: aikajanan alkua aikaistetaan automaattisesti", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.beforeDayStart);

    const marks = await page.locator(".hour-mark").allInnerTexts();
    expect(marks).toContain("05:00");
  });

  test("afterDayEnd: yli CONFIG.dayEndHour:in jatkuva vuoro leikkautuu näkyvän alueen reunaan", async ({
    page,
  }) => {
    await gotoWithScenario(page, SCENARIOS.afterDayEnd);

    const box = await page.locator(".resource-col-body .event-block").first().boundingBox();
    const body = await page.locator(".resource-col-body").first().boundingBox();
    // +2px toleranssi: kaksi ERILLISTÄ boundingBox()-kutsua voivat pyöristää
    // alipikselin verran eri suuntiin, se ei ole todellista ylivuotoa
    // (todellinen bugi näkyisi kymmenien pikselien erona, ei murto-osina).
    expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height + 2);
  });

  test("emptyDay: kummallakin palstalla näkyy 'Ei vuoroja tänään' eikä sivu kaadu", async ({ page }) => {
    await gotoWithScenario(page, SCENARIOS.emptyDay);

    await expect(page.locator(".empty-message", { hasText: "Ei vuoroja tänään" })).toHaveCount(2);
  });
});

test.describe("Rajapinnan virhetilanteet", () => {
  test("malformedData: rakenteeltaan rikki data näyttää virhebannerin eikä kaada sivua", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // EI gotoWithScenario/waitForBoardReady: rikkinäisellä datalla renderColumns()
    // ei koskaan luo .resource-col-elementtejä (ks. app.js — resources.length===0
    // -> "Ladataan tietoja…" -viesti), joten sitä ei kannata jäädä odottamaan.
    await mockScenario(page, SCENARIOS.malformedData);
    await page.goto("/");

    const banner = page.locator("#statusBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/status-banner-error/);
    await expect(banner).toContainText("iiro.uusitalo@hokkarit.fi");

    expect(pageErrors, `sivulla tapahtui JS-virhe: ${pageErrors[0]}`).toHaveLength(0);
  });
});
