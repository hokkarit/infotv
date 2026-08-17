// Yhteiset apurit selaintesteille (ks. tests/board.spec.js).
"use strict";

const { LPS } = require("./fixtures");

// Mockaa sekä Hokkarit-rajapinnan (lps + kummankin palstan reservations)
// että pukukoppitaulun (kopit.js) ulkoisen Google Sheets -haun. Jälkimmäinen
// keskeytetään tarkoituksella (route.abort()) — emme halua testien riippuvan
// oikeasta Google Sheets -taulukosta emmekä sen hitaudesta/saatavuudesta,
// ja kopit.js laukaisee "koppijako:initial-load"-tapahtuman joka tapauksessa
// myös virhepolulla (ks. kopit.js refreshData() finally-lohko).
async function mockScenario(page, scenario) {
  await page.route("**/api/lpreservations/lps", (route) => route.fulfill({ json: LPS }));

  await page.route("**/api/lpreservations/reservations/129*", (route) =>
    route.fulfill({ json: scenario.jaahalli || [] })
  );
  await page.route("**/api/lpreservations/reservations/277*", (route) =>
    route.fulfill({ json: scenario.hokkarisali || [] })
  );

  await page.route("**docs.google.com/**", (route) => route.abort());
}

// Odottaa että sekä koppijakotaulu (kopit.js) että aikajana (app.js) ovat
// asettuneet lopulliseen tilaansa — ks. app.js waitForKoppijako() ja
// koppijakoWaitTimeoutMs. Ilman tätä laatikoiden pikselikorkeudet
// (containerHeightPx, ks. renderColumns) voisivat vielä muuttua kesken
// mittausten, koska #board:n korkeus riippuu koppitaulun rivimäärästä.
async function waitForBoardReady(page) {
  await page.waitForSelector(".resource-col");
  await page.waitForFunction(() => {
    const line = document.getElementById("nowLine");
    return line && line.style.display !== "none";
  });
  // Pieni lisämarginaali ResizeObserver-debouncelle (ks. app.js, 30 ms) ja
  // viimeistelylle, jotta laatikoiden lopulliset pikselikorkeudet ovat varmasti
  // asettuneet ennen mittauksia.
  await page.waitForTimeout(200);
}

async function gotoWithScenario(page, scenario) {
  await mockScenario(page, scenario);
  await page.goto("/");
  await waitForBoardReady(page);
}

module.exports = { mockScenario, waitForBoardReady, gotoWithScenario };
