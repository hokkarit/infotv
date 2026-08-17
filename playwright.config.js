// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/*
 * Selaintestien asetukset. Sivu on infonäyttö joka pyörii OIKEASTI
 * PYSTYASENNOSSA olevalla FullHD-näytöllä — fyysinen paneeli on 1920x1080,
 * mutta pystyyn käännettynä selaimen viewport on 1080x1920 (kapea ja
 * korkea). Testit ajetaan siis TÄSSÄ koossa, ei vaakasuunnassa — juuri
 * kapeus on se mikä tekee "jännistä" ahtaista tilanteista (lyhyet vuorot,
 * ketjut) todenmukaisia: leveys vaikuttaa mm. siihen kuinka moneen riviin
 * otsikko rivittyy, mikä taas vaikuttaa laatikon tarvitsemaan korkeuteen.
 *
 * Palvelin: käytetään repon omaa server.py:tä (ei mitään ylimääräistä
 * build-/dev-serveriä) — Playwright käynnistää ja sammuttaa sen automaattisesti.
 */
module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",

  use: {
    baseURL: "http://localhost:8000",
    viewport: { width: 1080, height: 1920 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium-fullhd-portrait",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1080, height: 1920 } },
    },
  ],

  webServer: {
    command: "python3 server.py 8000",
    url: "http://localhost:8000/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
