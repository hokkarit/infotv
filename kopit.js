/* ============================================================
   Hämeenkyrön Jäähalli — pukukoppijaon infonäyttö
   ------------------------------------------------------------
   Yksinkertainen viittaustaulu: mikä koppi kuuluu kenellekin.
   Data haetaan livenä Google Sheetsistä (CSV-vienti) 5 min välein.

   Kunkin kopin nuolen suunta (vasen/oikea) EI tule Sheetsistä eikä
   koppinumerosta, vaan paikallisesta tiedostosta sijainnit.json, joka
   listaa suunnan per (näyttötila, koppi) -pari. Osoitteeseen lisätty
   ?display=<tila> valitsee minkä näyttötilan rivit ovat voimassa (esim.
   ?display=main); puuttuva/tuntematon arvo käyttää "default"-tilaa.
   Ks. resolveSijainti() ja README.md.

   HUOM tämän tavan hauraudesta: Sheetsin CSV-vientilinkki on
   dokumentoimaton Google-käyttäytymä (ei virallinen API), joka
   toimii koska:
     1) taulukko on jaettu "kaikki linkin saaneet voivat katsoa"
     2) Google sattuu lähettämään Access-Control-Allow-Origin: *
        -otsikon export-vastauksessa (todennettu, ei taattu pysyväksi)
   Kumpi tahansa voi hajota ilman varoitusta. Siksi:
     - viimeisin onnistuneesti haettu data pidetään muistissa ja
       näytetään edelleen jos haku epäonnistuu (ei tyhjää näyttöä)
     - saatu data validoidaan kevyesti, ja jos rakenne ei täsmää
       odotettuun, näytetään sama tyylinen virheilmoitus kuin
       pääsivulla (ks. app.js DataShapeError) pyytäen ottamaan
       yhteyttä ylläpitoon.
   ============================================================ */

(() => {
  "use strict";

  const CONFIG = {
    sheetUrl: "https://docs.google.com/spreadsheets/d/1Cn1DqQy1BJHFSoBV2u7cm2awDpaKfhKmBqACV6wa9DY/export?format=csv",
    refreshIntervalMs: 5 * 60 * 1000, // 5 min
    sijainnitUrl: "sijainnit.json",
  };

  // Aloitusdata ennen kuin ensimmäinen haku on ehtinyt onnistua, jottei
  // näyttö ole hetkeäkään täysin tyhjä.
  const FALLBACK_DATA = [
    { koppi: "Koppi 1", teksti: "U14" },
    { koppi: "Koppi 2", teksti: "U15" },
    { koppi: "Koppi 3", teksti: "Seniors" },
    { koppi: "Koppi 4", teksti: "U12" },
  ];

  // Varakopio tiedostosta sijainnit.json — käytössä ennen kuin tiedosto on
  // ehtinyt latautua ja jos lataus epäonnistuu kokonaan (ks. loadSijainnit).
  // Pidä sisältö samana kuin sijainnit.json:ssa.
  const FALLBACK_SIJAINNIT = [
    { display: "default", room: "Koppi 1", location: "left" },
    { display: "default", room: "Koppi 2", location: "left" },
    { display: "default", room: "Koppi 3", location: "right" },
    { display: "default", room: "Koppi 4", location: "right" },
    { display: "main", room: "Koppi 1", location: "left" },
    { display: "main", room: "Koppi 2", location: "left" },
    { display: "main", room: "Koppi 3", location: "left" },
    { display: "main", room: "Koppi 4", location: "left" },
  ];

  const STATE = {
    data: FALLBACK_DATA,
    sijaintiLookup: buildSijaintiLookup(FALLBACK_SIJAINNIT),
    consecutiveFailures: 0,
    // Tosi kun ensimmäinen refreshData() (Sheets-koppidata) on ehtinyt joko
    // onnistua tai epäonnistua kertaalleen. Ennen sitä renderLoading() pitää
    // "Haetaan dataa…" -tekstin näkyvissä — loadSijainnit() ei saa piirtää
    // sen yli välikädessä, vaikka se (pieni paikallinen tiedosto) ehtisikin
    // latautua ennen Sheets-hakua (ks. loadSijainnit).
    initialLoadDone: false,
  };

  // Tosi kun "koppijako:initial-load"-tapahtuma on jo laukaistu kertaalleen
  // (ks. refreshData) — app.js odottaa sitä ennen "nyt"-viivan näyttämistä,
  // eikä sitä tarvitse (eikä pidä) laukaista uudelleen myöhemmillä,
  // ajastetuilla päivityksillä.
  let koppijakoReadyFired = false;

  const el = {
    table: document.getElementById("koppiTable"),
    statusBanner: document.getElementById("koppiStatusBanner"),
  };

  // -------------------- Näyttötila (?display=) --------------------

  // Eri näytöillä (esim. hallin eri sisäänkäynneillä) sama koppi voidaan
  // haluta osoittaa eri suuntaan, koska "vasen"/"oikea" riippuu siitä mistä
  // suunnasta katsotaan. Mikä nuoli mihinkin koppiin piirretään per
  // näyttötila, määritellään tiedostossa sijainnit.json (ei koodissa) —
  // ks. resolveSijainti(). Osoitteeseen lisätty ?display=<tila> valitsee
  // rivin; puuttuva tai tuntematon arvo käyttää "default"-tilaa.
  // Esim. ?display=main -> kaikki kopit vasemmalle (ks. sijainnit.json).
  // Ks. dokumentaatio README.md:ssä.
  const DISPLAY_MODE = (new URLSearchParams(location.search).get("display") || "").trim() || "default";

  // Staattiset, luotetut SVG-merkkijonot (ei koskaan käyttäjä-/rajapintadataa
  // interpoloituna) — turvallista käyttää innerHTML:llä juuri siksi.
  const ARROW_LEFT_SVG =
    '<svg class="koppi-dir-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ' +
    'stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" ' +
    'stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>';
  const ARROW_RIGHT_SVG =
    '<svg class="koppi-dir-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ' +
    'stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" ' +
    'stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg>';

  // -------------------- Virhetyyppi datan rakenteelle --------------------

  class DataShapeError extends Error {
    constructor(message) {
      super(message);
      this.name = "DataShapeError";
    }
  }

  function assertShape(condition, message) {
    if (!condition) throw new DataShapeError(message);
  }

  // -------------------- CSV-jäsennys --------------------

  // Pieni mutta oikeaoppinen CSV-jäsennin (tukee lainausmerkein
  // ympäröityjä kenttiä ja niiden sisäisiä pilkkuja/rivinvaihtoja),
  // koska Sheetsin CSV-vienti voi tuottaa niitä jos solussa on pilkku.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ohitetaan, \n hoitaa rivinvaihdon
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // Muuntaa CSV-rivit näyttödataksi. Odotettu muoto: jokin sarake "Koppi N",
  // vieressä näytettävä teksti. Nuolen suunta ei tule tästä taulukosta — se
  // ratkaistaan renderöintihetkellä sijainnit.json:in ja nykyisen näyttötilan
  // perusteella (ks. resolveSijainti).
  //
  // HUOM: ei oleteta minkään TIETYN rivin (esim. ensimmäisen) olevan
  // otsikkorivi joka pitäisi ohittaa — käydään KAIKKI rivit läpi ja
  // poimitaan ne joiden ensimmäinen sarake täsmää "Koppi N" -muotoon.
  // Otsikkorivi (esim. "Haluttu teksti") ei koskaan täsmää tähän, joten se
  // ohittuu automaattisesti riippumatta siitä onko sellaista rivillä 1 vai
  // ei ollenkaan — jos otsikkorivin sijainti oletettaisiin kiinteäksi,
  // sen poistaminen/lisääminen taulukosta siirtäisi kaikki muut rivit ja
  // pudottaisi vahingossa aidon datarivin pois (näin kävi kerran koppi
  // 1:lle kun otsikkorivi poistettiin taulukosta).
  function csvToKoppiData(rows) {
    const parsed = [];
    rows.forEach((r) => {
      const koppi = (r[0] || "").trim();
      const teksti = (r[1] || "").trim();
      const m = /^Koppi\s+(\d+)$/i.exec(koppi);
      if (!m) return; // ohitetaan otsikko-/tyhjät/ylimääräiset rivit hiljaa
      parsed.push({ koppi, teksti });
    });
    assertShape(
      parsed.length > 0,
      `Taulukosta ei löytynyt yhtään "Koppi N" -muotoista riviä (${rows.length} riviä luettu).`
    );
    return parsed;
  }

  // -------------------- Koppien sijainnit (sijainnit.json) --------------------

  // Rakentaa hakurakenteen "display|room" -> "left"/"right" sijainnit.json:in
  // (tai FALLBACK_SIJAINNIT:in) riveistä, jotta resolveSijainti() ei joudu
  // silmukoimaan koko listaa jokaista koppiriviä kohti.
  function buildSijaintiLookup(rows) {
    const map = new Map();
    rows.forEach((r) => map.set(`${r.display}|${r.room}`, r.location));
    return map;
  }

  function sijainnitJsonToRows(json) {
    assertShape(Array.isArray(json), "sijainnit.json: odotettiin taulukkoa.");
    json.forEach((r, i) => {
      assertShape(
        r && typeof r.display === "string" && typeof r.room === "string" &&
          (r.location === "left" || r.location === "right"),
        `sijainnit.json[${i}] puuttuu odotettuja kenttiä tai location ei ole "left"/"right": ${JSON.stringify(r)}`
      );
    });
    return json;
  }

  // Ratkaisee mihin suuntaan koppi osoitetaan nykyisellä näyttötilalla
  // (DISPLAY_MODE, ks. yllä). Varaketjut jos jokin puuttuu:
  //   1) täsmäävä (DISPLAY_MODE, room) sijainnit.json:sta
  //   2) sama koppi "default"-tilasta (jos DISPLAY_MODE oli joku muu eikä
  //      löytynyt sille omaa riviä)
  //   3) koppinumeroon perustuva vanha nyrkkisääntö (1-2 = vasen, muut =
  //      oikea) — vain jos koppia ei löydy sijainnit.json:sta lainkaan
  //      (esim. koppitaulukkoon on lisätty uusi koppi jota ei ole vielä
  //      lisätty sijainnit.json:iin), jottei nuoli jää kokonaan piirtämättä.
  function resolveSijainti(room) {
    const lookup = STATE.sijaintiLookup;

    const own = lookup.get(`${DISPLAY_MODE}|${room}`);
    if (own) return own;

    if (DISPLAY_MODE !== "default") {
      const fallback = lookup.get(`default|${room}`);
      if (fallback) {
        console.warn(
          `[pukukoppi/kopit] Näyttötilalle "${DISPLAY_MODE}" ei löytynyt sijaintia koppille "${room}" — käytetään "default"-tilan sijaintia.`
        );
        return fallback;
      }
    }

    const m = /(\d+)/.exec(room);
    const n = m ? Number(m[1]) : NaN;
    console.warn(
      `[pukukoppi/kopit] Koppille "${room}" ei löytynyt sijaintia sijainnit.json:sta (näyttötila "${DISPLAY_MODE}") — arvataan koppinumeron perusteella.`
    );
    return !Number.isNaN(n) && n <= 2 ? "left" : "right";
  }

  async function loadSijainnit() {
    try {
      const res = await fetch(CONFIG.sijainnitUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} @ ${CONFIG.sijainnitUrl}`);
      const json = sijainnitJsonToRows(await res.json());
      STATE.sijaintiLookup = buildSijaintiLookup(json);
      // Piirretään uudelleen VAIN jos koppitaulukko on jo näkyvissä — muuten
      // tämä (yleensä nopeampi kuin Sheets-haku) piirtäisi FALLBACK_DATA:n
      // "Haetaan dataa…" -tekstin päälle ennen kuin refreshData() on edes
      // ehtinyt yrittää kertaakaan.
      if (STATE.initialLoadDone) render();
    } catch (err) {
      // Ei kriittinen: FALLBACK_SIJAINNIT (asetettu jo STATE:n alustuksessa)
      // jää voimaan, joten nuolet piirtyvät silti, vaikka ehkä väärään suuntaan
      // jos joku näyttötila on muokannut vain sijainnit.json:ia.
      console.error("[pukukoppi/kopit] sijainnit.json:in lataus epäonnistui, käytetään sisäänrakennettua varakonfiguraatiota:", err);
    }
  }

  // -------------------- Data haku --------------------

  async function fetchKoppiData() {
    const res = await fetch(CONFIG.sheetUrl, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${CONFIG.sheetUrl}`);
    const text = await res.text();
    // Jos jako-oikeudet on joskus vaihdettu yksityiseksi, Google palauttaa
    // HTTP 200:n mutta HTML-kirjautumissivun CSV:n sijaan — tunnistetaan se.
    assertShape(
      !text.trim().startsWith("<"),
      "Rajapinta palautti HTML:ää CSV:n sijaan (taulukon jako-oikeudet voivat olla muuttuneet)."
    );
    return csvToKoppiData(parseCsv(text));
  }

  async function refreshData() {
    try {
      STATE.data = await fetchKoppiData();
      STATE.consecutiveFailures = 0;
      setStatusBanner(null);
      render();
      console.log(`[pukukoppi/kopit] Tieto päivitetty ${new Date().toLocaleTimeString("fi-FI")}:`, STATE.data);
    } catch (err) {
      STATE.consecutiveFailures += 1;
      console.error("[pukukoppi/kopit] Koppitiedon haku epäonnistui:", err);

      if (err instanceof DataShapeError) {
        setStatusBanner(
          "Koppijakoa ei voitu päivittää, koska taulukon tietorakenne on muuttunut. " +
            "Näytetään viimeisin tunnettu tilanne. Ota yhteyttä: iiro.uusitalo@hokkarit.fi",
          "error"
        );
      } else if (STATE.consecutiveFailures >= 2) {
        setStatusBanner(
          "Ei yhteyttä koppijakotaulukkoon — näytetään viimeisin tunnettu tilanne."
        );
      }
      // Näytetään joka tapauksessa viimeisin tunnettu (tai aloitus-) data.
      render();
    } finally {
      // Vasta nyt "Haetaan dataa…" -aloitusteksti on varmasti korvattu
      // oikealla (tai FALLBACK_DATA:n) sisällöllä — ks. loadSijainnit().
      STATE.initialLoadDone = true;

      // Ilmoitetaan muille skripteille (app.js) että koppijakotaulun
      // ensimmäinen lataus on asettunut lopulliseen korkeuteensa — se
      // vaikuttaa flexissä #board:n (aikajanan) käytettävissä olevaan
      // tilaan, ja app.js odottaa tätä ennen "nyt"-viivan näyttämistä
      // ettei se väläh­dä hetkeksi väärään kohtaan. Tapahtuma kannattaa
      // laukaista vain kerran (myös virhetapauksessa) — myöhemmät
      // päivitykset (refreshInterval) eivät enää muuta korkeutta yhtä
      // rajusti kuin "Haetaan dataa…" -> oikea rivimäärä.
      if (!koppijakoReadyFired) {
        koppijakoReadyFired = true;
        window.dispatchEvent(new CustomEvent("koppijako:initial-load"));
      }
    }
  }

  function setStatusBanner(msg, level = "warning") {
    if (!msg) {
      el.statusBanner.hidden = true;
      el.statusBanner.textContent = "";
      el.statusBanner.classList.remove("status-banner-error");
    } else {
      el.statusBanner.hidden = false;
      el.statusBanner.textContent = msg;
      el.statusBanner.classList.toggle("status-banner-error", level === "error");
    }
  }

  // -------------------- Renderöinti --------------------

  function renderRow(row) {
    const div = document.createElement("div");
    div.className = "koppi-row";

    const koppiEl = document.createElement("div");
    koppiEl.className = "koppi-cell koppi-cell-koppi";
    koppiEl.textContent = row.koppi;
    div.appendChild(koppiEl);

    const tekstiEl = document.createElement("div");
    tekstiEl.className = "koppi-cell koppi-cell-teksti";
    tekstiEl.textContent = row.teksti;
    div.appendChild(tekstiEl);

    const sijaintiEl = document.createElement("div");
    sijaintiEl.className = "koppi-cell koppi-cell-sijainti";
    sijaintiEl.innerHTML = resolveSijainti(row.koppi) === "left" ? ARROW_LEFT_SVG : ARROW_RIGHT_SVG;
    div.appendChild(sijaintiEl);

    return div;
  }

  function render() {
    el.table.innerHTML = "";

    const header = document.createElement("div");
    header.className = "koppi-row koppi-row-header";
    ["Koppi", "Joukkue", "Sijainti"].forEach((label) => {
      const cell = document.createElement("div");
      cell.className = "koppi-cell";
      cell.textContent = label;
      header.appendChild(cell);
    });
    el.table.appendChild(header);

    STATE.data.forEach((row) => el.table.appendChild(renderRow(row)));
  }

  function renderLoading() {
    el.table.innerHTML = "";
    const div = document.createElement("div");
    div.className = "koppi-loading";
    div.textContent = "Haetaan dataa…";
    el.table.appendChild(div);
  }

  // -------------------- Käynnistys --------------------

  renderLoading(); // ekalla kerralla näytetään latausteksti, ei vielä dataa
  loadSijainnit(); // ei kriittisen tiellä: render() kutsutaan jo refreshData():sta
  refreshData();
  setInterval(refreshData, CONFIG.refreshIntervalMs);
})();
