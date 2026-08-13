/* ============================================================
   Hämeenkyrön Jäähalli — pukukoppijaon infonäyttö
   ------------------------------------------------------------
   Yksinkertainen viittaustaulu: mikä koppi kuuluu kenellekin.
   Data haetaan livenä Google Sheetsistä (CSV-vienti) 5 min välein.

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
  };

  // Aloitusdata ennen kuin ensimmäinen haku on ehtinyt onnistua, jottei
  // näyttö ole hetkeäkään täysin tyhjä.
  const FALLBACK_DATA = [
    { koppi: "Koppi 1", teksti: "U14" },
    { koppi: "Koppi 2", teksti: "U15" },
    { koppi: "Koppi 3", teksti: "Seniors" },
    { koppi: "Koppi 4", teksti: "U12" },
  ];

  const STATE = {
    data: FALLBACK_DATA,
    consecutiveFailures: 0,
  };

  const el = {
    table: document.getElementById("koppiTable"),
    statusBanner: document.getElementById("koppiStatusBanner"),
  };

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

  // Muuntaa CSV-rivit näyttödataksi. Odotettu muoto (ks. taulukon otsikko
  // "Haluttu teksti"): ensimmäinen sarake "Koppi N", toinen näytettävä teksti.
  // Suunta (nuolen suunta) ei tule taulukosta — se päätellään koppinumerosta
  // (1-2 = vasen, muut = oikea), koska taulukossa ei ole sille saraketta.
  function csvToKoppiData(rows) {
    const dataRows = rows.slice(1); // ensimmäinen rivi on otsikko
    const parsed = [];
    dataRows.forEach((r) => {
      const koppi = (r[0] || "").trim();
      const teksti = (r[1] || "").trim();
      const m = /^Koppi\s+(\d+)$/i.exec(koppi);
      if (!m) return; // ohitetaan tyhjät/ylimääräiset rivit hiljaa
      const n = Number(m[1]);
      parsed.push({ koppi, teksti, sijainti: n <= 2 ? "left" : "right" });
    });
    assertShape(
      parsed.length > 0,
      `Taulukosta ei löytynyt yhtään "Koppi N" -muotoista riviä (${dataRows.length} riviä luettu).`
    );
    return parsed;
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
    sijaintiEl.innerHTML = row.sijainti === "left" ? ARROW_LEFT_SVG : ARROW_RIGHT_SVG;
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
  refreshData();
  setInterval(refreshData, CONFIG.refreshIntervalMs);
})();
