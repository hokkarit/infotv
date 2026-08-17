/* ============================================================
   Hämeenkyrön Jäähalli — infonäytön logiikka
   ------------------------------------------------------------
   Näyttää TÄMÄN PÄIVÄN jääajat pystysuuntaisena aikajanana,
   yksi pystypalsta per liikuntapaikka (esim. Jäähalli, Hokkarisali),
   ja punaisen "nyt"-viivan joka kertoo missä kohtaa päivää mennään.

   Data haetaan suoraan Hokkarit ry:n julkisesta varausrajapinnasta
   (sama rajapinta jota heidän oma /vuorovaraukset-sivunsa käyttää).
   Rajapinta sallii CORS:n (Access-Control-Allow-Origin: *), joten
   haku onnistuu suoraan selaimesta millä tahansa domainilla.

   HUOM pukukopit: julkinen rajapinta ei tällä hetkellä välitä
   mitään pukukoppi-/kommenttikenttää (kokeiltu — ei näy datassa),
   joten tämä näkymä näyttää vain vuorot ja niiden tilan
   (odottaa kuittausta / kuitattu / vapautettu). Jos joskus
   pukukoppitieto saadaan osaksi rajapintaa, se on helppo lisätä
   renderEvent()-funktioon.
   ============================================================ */

(() => {
  "use strict";

  // Kellon hero-ikoni ev-time-tekstin eteen. Staattinen, luotettu merkkijono
  // (ei sisällä mitään käyttäjä-/rajapintadataa) — turvallista käyttää
  // innerHTML:llä juuri siksi ettei siihen koskaan interpoloida mitään.
  const CLOCK_ICON_SVG =
    '<svg class="ev-time-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ' +
    'stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" ' +
    'stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>';

  // -------------------- Asetukset --------------------

  const CONFIG = {
    apiBase: "https://www.hokkarit.fi/api/lpreservations",

    // Mitkä liikuntapaikat näytetään pystypalstoina, ja missä järjestyksessä.
    // Jätä tyhjäksi [] jos haluat näyttää KAIKKI aktiiviset paikat rajapinnasta.
    // HUOM: nämä nimet ovat täsmäysavaimia Hokkarit-rajapinnan dataan
    // (STATE.lps[].name) — EI pelkkää näyttötekstiä. Älä lyhennä näitä; jos
    // haluat palstan otsikkoon lyhyemmän tekstin, käytä alla olevaa
    // displayNames-mäppäystä sen sijaan.
    resourceOrder: ["Hämeenkyrön Jäähalli", "Hokkarisali"],

    // Näytettävä (lyhyempi) nimi palstan otsikkoon, jos eri kuin rajapinnan
    // antama nimi. Avain on rajapinnan nimi (sama kuin resourceOrder:issa),
    // arvo mitä TV:llä näytetään. Paikka joka puuttuu tästä näyttää oman
    // rajapintanimensä sellaisenaan (ks. resourceDisplayName()).
    displayNames: {
      "Hämeenkyrön Jäähalli": "Jäähalli",
    },

    // Kuinka usein päivän varaukset haetaan uudelleen (ms).
    refreshIntervalMs: 25 * 60 * 1000, // 25 min

    // Kuinka usein kello / nyt-viiva päivitetään (ms). Sekuntikello vaatii
    // 1000 ms:n välin, jotta se näyttää juoksevalta eikä hyppivältä.
    tickIntervalMs: 1000, // 1 s

    // Aikajanan näkyvä alkuaika. Jos päivän tapahtumat alkavat tätä
    // aiemmin, alkua aikaistetaan automaattisesti (30 min marginaalilla).
    dayStartHour: 7,

    // Aikajanan näkyvä loppuaika — kiinteä, ei venytetä vaikka joku vuoro
    // päättyisi tätä myöhemmin (ks. computeRange). Tuon ajan jälkeiset
    // vuorot/osuudet leikkautuvat pois näkyvistä (pctOf rajaa 100 %:iin).
    dayEndHour: 22,

    // Yläpuolella oleva koppijakotaulu (kopit.js) lataa oman datansa
    // itsenäisesti ja muuttaa kokoaan kun "Haetaan dataa…" -teksti korvautuu
    // oikealla rivimäärällä — se vie/vapauttaa tilaa #board:lta (flex),
    // mikä liikuttaisi "nyt"-viivan pikselikohtaa. Odotetaan siis koppijaon
    // ensimmäistä valmistumista ennen kuin viiva näytetään ensi kertaa (ks.
    // "koppijako:initial-load" alempana), jottei sitä näy hetkeksi väärässä
    // kohdassa. Aikakatkaisu varmuudeksi, jos kopit.js puuttuu/jumiutuu.
    koppijakoWaitTimeoutMs: 4000,

    // Turvaverkko: lataa koko sivu uudelleen kerran vuorokaudessa hiljaisena
    // hetkenä, jotta pitkään auki ollut selain ei kerää muistivuotoja.
    // Aseta null jos et halua automaattista uudelleenlatausta.
    dailyReloadHour: 4,

    // Testausta varten: ?date=YYYY-MM-DD -osoiteparametrilla voi pakottaa
    // sivun näyttämään jonkin toisen päivän datan (esim. huomisen) sen
    // sijaan että aina näytettäisiin oikea tämä päivä. Kellonaika (tunnit/
    // minuutit) pysyy silti oikeana, vain päivä vaihtuu — ks. getEffectiveNow().
    // Rajattu ±N vuorokauteen oikeasta päivästä, jottei parametrilla voi jäädä
    // vahingossa pysyvästi jumiin täysin väärään päivään (esim. jos joku
    // unohtaa sen URL:iin oikealla TV:llä — ks. myös näytön "TESTIPÄIVÄ"-merkki).
    dateOverrideMaxDays: 14,
  };

  const STATE = {
    lps: [],              // liikuntapaikat rajapinnasta
    eventsByLp: new Map(), // lp.id -> tämän päivän tapahtumat
    lastGoodDate: null,    // millekä päivälle data on viimeksi haettu onnistuneesti
    consecutiveFailures: 0,
    dateOverride: null,    // { y, m, d } jos ?date=-parametri on validi, muuten null
  };

  // -------------------- DOM-viitteet --------------------

  const el = {
    board: document.getElementById("board"),
    hourRail: document.getElementById("hourRail"),
    columns: document.getElementById("columns"),
    nowLine: document.getElementById("nowLine"),
    nowLineLabel: document.getElementById("nowLineLabel"),
    statusBanner: document.getElementById("statusBanner"),
    testDateBanner: document.getElementById("testDateBanner"),
  };

  // -------------------- Testipäivän ohitus (?date=YYYY-MM-DD) --------------------

  // Lukee ja validoi ?date=-parametrin. Palauttaa { y, m, d } tai null.
  // Tarkoituksella TIUKKA: väärän muotoinen tai epäjärkevä arvo hylätään
  // kokonaan (pudotaan oikeaan tämän päivän dataan), eikä raakaa
  // merkkijonoa koskaan käytetä mihinkään muuhun kuin näiden kolmen
  // validoidun kokonaisluvun rakentamiseen — sitä ei siis pistetä DOM:iin
  // eikä rajapintakutsuun sellaisenaan.
  function parseDateOverride() {
    const raw = new URLSearchParams(location.search).get("date");
    if (!raw) return null;

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) {
      console.warn(`[pukukoppi] Virheellinen ?date=-parametri (${JSON.stringify(raw)}), näytetään oikea tämä päivä.`);
      return null;
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    // Date() normalisoi hiljaa esim. kuukauden 13 -> seuraavan vuoden
    // tammikuuksi. Tarkistetaan että annetut luvut todella vastaavat
    // syntynyttä päivämäärää, muuten hylätään.
    const check = new Date(y, mo - 1, d);
    if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) {
      console.warn(`[pukukoppi] Epäkelpo ?date=-arvo (${JSON.stringify(raw)}), näytetään oikea tämä päivä.`);
      return null;
    }

    // Aikaikkuna: ettei parametrilla voi jäädä vahingossa pysyvästi jumiin
    // täysin väärään päivään (ks. CONFIG.dateOverrideMaxDays).
    const diffDays = Math.abs(check - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000;
    if (diffDays > CONFIG.dateOverrideMaxDays) {
      console.warn(`[pukukoppi] ?date=-arvo (${raw}) on yli ${CONFIG.dateOverrideMaxDays} vrk päässä oikeasta päivästä, ei käytetä.`);
      return null;
    }

    return { y, m: mo, d };
  }

  // Kellonaika (tunnit/minuutit/sekunnit) pysyy aina oikeana — vain
  // vuosi/kuukausi/päivä vaihtuu jos testipäivä on asetettu.
  function getEffectiveNow() {
    const real = new Date();
    if (!STATE.dateOverride) return real;
    const { y, m, d } = STATE.dateOverride;
    return new Date(y, m - 1, d, real.getHours(), real.getMinutes(), real.getSeconds(), real.getMilliseconds());
  }

  // -------------------- Apufunktiot --------------------

  // Erillinen virhetyyppi: rajapinnan DATAN/RAKENTEEN muuttumiselle (kentät
  // puuttuvat, ovat väärää tyyppiä tai väärässä muodossa) — eri asia kuin
  // verkko-/yhteysvirhe. refreshData() näyttää tästä oman, selvästi eri
  // virheilmoituksen jossa pyydetään ottamaan yhteyttä ylläpitoon, koska
  // rakenneongelma ei korjaannu itsestään uudelleenyrittämällä.
  class DataShapeError extends Error {
    constructor(message) {
      super(message);
      this.name = "DataShapeError";
    }
  }

  function assertShape(condition, message) {
    if (!condition) throw new DataShapeError(message);
  }

  function todayKey(d = new Date()) {
    // Paikallinen YYYY-MM-DD, ei UTC (vältetään aikavyöhykesudennuksia).
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseApiDateTime(s) {
    // Rajapinta antaa "YYYY-MM-DD HH:MM" paikallisessa ajassa.
    assertShape(
      typeof s === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s),
      `Odottamaton päivämäärämuoto rajapinnasta: ${JSON.stringify(s)}`
    );
    const [datePart, timePart] = s.split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm] = timePart.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm);
  }

  function fmtHM(d) {
    return d.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
  }

  function statusClass(className) {
    if (className === "lp-waiting") return "status-waiting";
    if (className === "lp-freed") return "status-freed";
    return "status-reserved";
  }

  function decodeEntities(str) {
    const t = document.createElement("textarea");
    t.innerHTML = str;
    return t.value;
  }

  // Siisti otsikko: erottaa mahdollisen "N/M" jako-osuuden omaksi merkiksi,
  // esim. "Hokkarit-U10 1/2" -> { title: "Hokkarit-U10", badge: "puolikas 1/2" }
  function splitTitle(rawTitle) {
    const m = rawTitle.match(/^(.*?)[\s]+(\d+)\/(\d+)\s*$/);
    if (!m) return { title: stripHokkaritPrefix(rawTitle.trim()), badge: null };
    const [, base, num, den] = m;
    if (num === den && den === "1") {
      return { title: stripHokkaritPrefix(base.trim()), badge: null };
    }
    return {
      title: stripHokkaritPrefix(base.trim()),
      badge: `jaettu ${num}/${den}`,
    };
  }

  // Jos otsikko on PELKÄSTÄÄN "Hokkarit-<joukkue>" (esim. "Hokkarit-U10"),
  // pudotetaan "Hokkarit-" pois turhana toistona (kaikki vuorot ovat Hokkarit ry:n).
  function stripHokkaritPrefix(title) {
    const m = title.match(/^Hokkarit-(\S+)$/);
    return m ? m[1] : title;
  }

  // -------------------- Data haku --------------------

  async function fetchJson(url) {
    // HUOM: rajapinta tekee kielikohtaista sisällönvälitystä. Jos selaimen
    // oma Accept-Language-oletus (esim. käyttöjärjestelmän kieli = englanti)
    // menee ensin, rajapinta palauttaa joukkueiden/vuorojen NIMET tyhjinä
    // (vain "N/M"-jako-osuus jää jäljelle) — data näyttää siis validilta
    // JSON:lta, mutta otsikot puuttuvat. Pyydetään siksi suomea eksplisiittisesti,
    // riippumatta selaimen omasta kieliasetuksesta.
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "Accept-Language": "fi" },
      // Ei lähetetä Referer-otsikkoa rajapinnalle (ei kerrota mistä sivusta
      // pyyntö tulee). HUOM: Origin-otsikkoa selain ei koskaan anna JS:n
      // piilottaa tai muuttaa cross-origin-pyynnöissä — se on selaimen oma,
      // tarkoituksella "kielletty header" CORS-turvamallin takia, joten
      // sille ei ole vastaavaa asetusta.
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.json();
  }

  async function loadResources() {
    const lps = await fetchJson(`${CONFIG.apiBase}/lps`);
    assertShape(Array.isArray(lps), "Odotettiin taulukkoa /lps-vastaukselta.");
    lps.forEach((lp, i) => {
      assertShape(
        lp && typeof lp.id !== "undefined" && typeof lp.name === "string" && typeof lp.status !== "undefined",
        `/lps[${i}] puuttuu odotettuja kenttiä (id/name/status): ${JSON.stringify(lp)}`
      );
    });
    return lps
      .filter((lp) => lp.status === 1)
      .map((lp) => ({ ...lp, name: decodeEntities(lp.name) }));
  }

  async function loadReservationsForToday(lpId, now) {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const raw = await fetchJson(
      `${CONFIG.apiBase}/reservations/${lpId}?year=${y}&month=${m}&day=${d}`
    );
    assertShape(Array.isArray(raw), `Odotettiin taulukkoa /reservations/${lpId}-vastaukselta.`);
    raw.forEach((ev, i) => {
      assertShape(
        ev && typeof ev.title === "string" && typeof ev.start === "string" &&
          typeof ev.end === "string" && typeof ev.className === "string",
        `/reservations/${lpId}[${i}] puuttuu odotettuja kenttiä (title/start/end/className): ${JSON.stringify(ev)}`
      );
    });
    const key = todayKey(now);
    return raw
      .map((ev) => ({
        ...ev,
        startDt: parseApiDateTime(ev.start),
        endDt: parseApiDateTime(ev.end),
      }))
      .filter((ev) => todayKey(ev.startDt) === key)
      .sort((a, b) => a.startDt - b.startDt);
  }

  async function refreshData() {
    const now = getEffectiveNow();
    try {
      if (STATE.lps.length === 0) {
        STATE.lps = await loadResources();
      }

      let resources = STATE.lps;
      if (CONFIG.resourceOrder.length > 0) {
        resources = CONFIG.resourceOrder
          .map((name) => STATE.lps.find((lp) => lp.name === name))
          .filter(Boolean);
        // jos konfiguroitu nimi ei löydy, älä kaadu — käytä mitä löytyi
        if (resources.length === 0) resources = STATE.lps;
      }

      const results = await Promise.all(
        resources.map((lp) => loadReservationsForToday(lp.id, now))
      );

      STATE.eventsByLp = new Map();
      resources.forEach((lp, i) => STATE.eventsByLp.set(lp.id, results[i]));
      STATE.activeResources = resources;

      STATE.lastGoodDate = todayKey(now);
      STATE.consecutiveFailures = 0;
      setStatusBanner(null);
      renderBoard();
    } catch (err) {
      STATE.consecutiveFailures += 1;
      console.error("Datan haku epäonnistui:", err);

      if (err instanceof DataShapeError) {
        // Rajapinnan data/rakenne on muuttunut oletetusta — tämä ei korjaannu
        // itsestään uudelleenyrittämällä, joten näytetään heti (ei odoteta
        // useampaa peräkkäistä epäonnistumista kuten yhteysvirheissä).
        setStatusBanner(
          "Vuorotietojen näyttäminen epäonnistui, koska rajapinnan tietorakenne " +
            "on muuttunut. Ota yhteyttä: iiro.uusitalo@hokkarit.fi",
          "error"
        );
      } else if (STATE.consecutiveFailures >= 2) {
        setStatusBanner(
          "Ei yhteyttä varausjärjestelmään — näytetään viimeisin tunnettu tilanne."
        );
      }
      // Jos meillä ei ole minkäänlaista dataa vielä, piirretään tyhjä runko silti.
      if (!STATE.activeResources) renderBoard();
    }
  }

  // level: "warning" (oletus, väliaikainen yhteysongelma) tai "error"
  // (pysyvämpi, esim. rajapinnan rakenne muuttunut — vaatii ylläpidon
  // toimenpiteitä eikä korjaannu itsestään uudelleenyrittämällä).
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

  // -------------------- Aikajanan skaala --------------------

  function computeRange(now) {
    let startHour = CONFIG.dayStartHour;

    const allEvents = [];
    (STATE.activeResources || []).forEach((lp) => {
      (STATE.eventsByLp.get(lp.id) || []).forEach((ev) => allEvents.push(ev));
    });

    if (allEvents.length > 0) {
      const earliest = Math.min(...allEvents.map((e) => e.startDt.getHours() + e.startDt.getMinutes() / 60));
      startHour = Math.min(startHour, Math.floor(earliest - 0.5));
    }

    startHour = Math.max(0, startHour);

    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0);
    // Aikajana piirretään AINA CONFIG.dayEndHour:iin asti — ei venytetä
    // pidemmälle vaikka joku vuoro päättyisi myöhään (se leikkautuu pois,
    // ks. pctOf), ja "nyt"-viiva (ks. positionNowLine) katoaa tuon ajan
    // jälkeen samoin kuin ennen dayStartHour:ia aamulla.
    const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CONFIG.dayEndHour, 0);
    return { rangeStart, rangeEnd };
  }

  function pctOf(date, rangeStart, rangeEnd) {
    const total = rangeEnd - rangeStart;
    const pos = date - rangeStart;
    return Math.min(100, Math.max(0, (pos / total) * 100));
  }

  // Palauttaa listan { date, top, half } -merkeistä rangeStart..rangeEnd
  // väliltä puolen tunnin välein — half=false täydet tunnit, half=true :30-kohdat.
  // HUOM: emme laske tuntia irrottamalla sitä rangeEnd:istä (rangeEnd.getHours()),
  // koska jos aikaväli ulottuu tasan puoleenyöhön asti, new Date(y,m,d,24,0)
  // normalisoituu JS:ssä seuraavan päivän 00:00:ksi ja getHours() palauttaisi
  // silloin virheellisesti 0:n koko välin pituuden sijaan — silmukka ei
  // tällöin piirtäisi mitään. Lasketaan siis askelten määrä suoraan välin
  // kestosta, jolloin viimeinenkin merkki (esim. keskiyö) laskeutuu oikein.
  function hourMarkers(rangeStart, rangeEnd) {
    const HALF_HOUR_MS = 30 * 60 * 1000;
    const totalHalfHours = Math.round((rangeEnd - rangeStart) / HALF_HOUR_MS);
    const marks = [];
    for (let i = 0; i <= totalHalfHours; i++) {
      const date = new Date(rangeStart.getTime() + i * HALF_HOUR_MS);
      marks.push({ date, top: pctOf(date, rangeStart, rangeEnd), half: i % 2 === 1 });
    }
    return marks;
  }

  // -------------------- Päällekkäisyyksien asettelu --------------------

  // Erottaa "jaettu jää" -tapaukset (kaksi+ tapahtumaa TÄSMÄLLEEN samalla
  // alku- ja loppuajalla, esim. "Hokkarit-U9 1/2" + "Hokkarit-U8 1/2"
  // klo 16:45–17:45) muista tapahtumista. Nämä eivät ole vain ajallisesti
  // päällekkäisiä vaan saman jääosuuden virallinen jako — ne piirretään
  // (ks. renderColumns) YHTENÄ, tavallisen näköisenä renderEvent()-laatikkona
  // jonka otsikossa osapuolten nimet on yhdistetty, ei kahtena kapeana
  // vierekkäisenä laatikkona (ks. aiempi, ahdas ja muista poikkeava ulkoasu).
  // Muut (aidosti vain osittain päällekkäiset, esim. peräkkäiset varaukset
  // joiden ajat menevät hieman limittäin) menevät edelleen layoutColumns():iin.
  function groupSharedEvents(events) {
    const byTime = new Map();
    events.forEach((ev) => {
      const key = `${ev.startDt.getTime()}_${ev.endDt.getTime()}`;
      if (!byTime.has(key)) byTime.set(key, []);
      byTime.get(key).push(ev);
    });
    const shared = [];
    const solo = [];
    byTime.forEach((group) => {
      if (group.length > 1) shared.push(group);
      else solo.push(group[0]);
    });
    return { shared, solo };
  }

  // Ryhmittää samassa palstassa ajallisesti päällekkäiset tapahtumat
  // ja jakaa niille oman leveysosuuden vierekkäin.
  function layoutColumns(events) {
    const withCols = events.map((ev) => ({ ev, col: 0, cols: 1 }));

    // Yksinkertainen "sweep" -algoritmi: käydään ajassa eteenpäin,
    // pidetään kirjaa aktiivisista tapahtumista.
    let active = [];
    for (const item of withCols) {
      active = active.filter((a) => a.ev.endDt > item.ev.startDt);
      const usedCols = new Set(active.map((a) => a.col));
      let col = 0;
      while (usedCols.has(col)) col++;
      item.col = col;
      active.push(item);
      const maxCols = Math.max(...active.map((a) => a.col)) + 1;
      active.forEach((a) => (a.cols = maxCols));
    }
    return withCols;
  }

  // Alle tämän (pikseleinä, laskettuna suoraan tapahtuman todellisesta
  // kestosta) jäävä YKSITTÄINEN tapahtuma ei enää mahdu luettavasti edes
  // .tiny-asetteluun (ks. TINY_BELOW_PX alempana) JOS sen vieressä on
  // TÄSMÄLLEEN ilman väliä alkava seuraava tapahtuma — silloin
  // computeMaxHeightPx pakottaa laatikon tarkalleen tuon lyhyen keston
  // korkuiseksi eikä mihinkään jää venymisvaraa (esim. MESTIS-ottelun
  // "alkulämpö tuomarit" 17:40–17:50 heti perässä "alkulämpö pelaajat"
  // 17:50–18:10 — ks. buildRenderUnits). Hieman TINY_BELOW_PX:ää
  // suurempi, jotta ketjuun otetaan mukaan myös raja-tapaukset joissa
  // .tiny periaatteessa mahtuisi mutta ei enää mukavasti.
  const CHAIN_MERGE_BELOW_PX = 34;

  // Yhdistää PERÄKKÄISET, TOISIAAN KOSKETTAVAT (ei väliä) ja liian lyhyet
  // tapahtumat "ketjuiksi" jotka piirretään (ks. renderChainGroup) YHTENÄ
  // laatikkona, jossa jokainen osa näkyy omalla rivillään OMALLA
  // kellonajallaan — ei siis vain yhtä yhdistettyä kokonaisaikaa, koska
  // esim. tuomareiden ja pelaajien alkulämmöt ovat eri pituisia ja osapuolten
  // pitää nähdä juuri OMA aikansa (ks. käyttäjän toive: "osa-ajat näkyviin").
  // Laatikon kokonaiskorkeus vastaa silti ketjun TODELLISTA yhteiskestoa
  // (ensimmäisen alusta viimeisen loppuun) — ei siis mitään keinotekoista
  // venytystä, sama periaate kuin "jaettu jää":ssäkin (ks. groupSharedEvents).
  //
  // Ketju jatkuu eteenpäin niin kauan kuin VIIMEISIN mukaan otettu osa
  // itsessään olisi liian lyhyt seisomaan yksin JA koskettaa suoraan
  // seuraavaa — jos välissä on tauko tai edellinen osa on jo riittävän
  // korkea yksinään, ketju katkeaa (ei siis niellä esim. tavallista
  // tunnin harjoitusta mukaan vain koska sitä edeltää lyhyt alkulämpö).
  function buildRenderUnits(soloEvents, rangeStart, rangeEnd, containerHeightPx) {
    const sorted = [...soloEvents].sort((a, b) => a.startDt - b.startDt);
    const units = [];
    let i = 0;
    while (i < sorted.length) {
      const chain = [sorted[i]];
      while (i + chain.length < sorted.length) {
        const last = chain[chain.length - 1];
        const next = sorted[i + chain.length];
        if (last.endDt.getTime() !== next.startDt.getTime()) break; // väli -> ei jatketa
        const lastNaturalPx =
          ((pctOf(last.endDt, rangeStart, rangeEnd) - pctOf(last.startDt, rangeStart, rangeEnd)) / 100) *
          containerHeightPx;
        if (lastNaturalPx >= CHAIN_MERGE_BELOW_PX) break; // edellinen mahtuu jo yksinään
        chain.push(next);
      }
      i += chain.length;
      units.push(
        chain.length > 1
          ? { startDt: chain[0].startDt, endDt: chain[chain.length - 1].endDt, chain }
          : chain[0]
      );
    }
    return units;
  }

  // Erottaa ketjun otsikoista sanatasolla yhteisen etuliitteen, esim.
  // ["MESTIS alkulämpö tuomarit", "MESTIS alkulämpö pelaajat"] ->
  // { common: "MESTIS alkulämpö", rests: ["tuomarit", "pelaajat"] }.
  // Jos yhteistä ei löydy (tai se söisi jonkun otsikon KOKONAAN, jolloin
  // erottavaa jäisi näkyviin nolla merkkiä), common on null ja rests ovat
  // täydet (siistityt) otsikot sellaisenaan.
  function splitCommonPrefix(titles) {
    const wordLists = titles.map((t) => t.split(/\s+/));
    let commonLen = 0;
    outer: for (let w = 0; w < wordLists[0].length; w++) {
      const word = wordLists[0][w];
      for (const list of wordLists) {
        if (list[w] !== word) break outer;
      }
      commonLen++;
    }
    const shortest = Math.min(...wordLists.map((w) => w.length));
    if (commonLen === 0 || commonLen >= shortest) {
      return { common: null, rests: titles };
    }
    return {
      common: wordLists[0].slice(0, commonLen).join(" "),
      rests: wordLists.map((w) => w.slice(commonLen).join(" ")),
    };
  }

  // -------------------- Renderöinti --------------------

  // Palauttaa rajapinnan liikuntapaikan nimelle näytettävän tekstin —
  // CONFIG.displayNames:in mukaisen lyhennyksen jos sellainen on määritelty,
  // muuten rajapinnan nimen sellaisenaan. Käytä tätä VAIN näyttämiseen; älä
  // käytä täsmäykseen (siihen CONFIG.resourceOrder ja lp.name suoraan).
  function resourceDisplayName(lp) {
    return CONFIG.displayNames[lp.name] || lp.name;
  }

  function renderBoard() {
    const now = getEffectiveNow();
    const { rangeStart, rangeEnd } = computeRange(now);

    renderHourRail(rangeStart, rangeEnd);
    renderColumns(rangeStart, rangeEnd);
    positionNowLine(now, rangeStart, rangeEnd);
  }

  function renderHourRail(rangeStart, rangeEnd) {
    el.hourRail.innerHTML = "";

    // Tyhjä täyte palstojen otsikon korkuinen, jotta kellonajat alkavat
    // täsmälleen siitä missä palstojen sisältökin alkaa (otsikoiden alta),
    // eivätkä valu otsikon taakse/päälle.
    const spacer = document.createElement("div");
    spacer.className = "hour-rail-spacer";
    el.hourRail.appendChild(spacer);

    const railBody = document.createElement("div");
    railBody.className = "hour-rail-body";
    el.hourRail.appendChild(railBody);

    // Tuntipalkkiin vain kokonaistunnit lukemalla — puolen tunnin kohdat
    // näkyvät ainoastaan katkoviivoina palstojen sisällä (ks. renderColumns).
    const fullHourMarks = hourMarkers(rangeStart, rangeEnd).filter((mk) => !mk.half);
    // Viimeinen merkki on pelkkää piirtoreunusta varten lisätty ylimääräinen
    // tunti (ks. computeRange) — sille ei piirretä lukemaa, vain edellisille.
    fullHourMarks.slice(0, -1).forEach(({ date, top }) => {
      const div = document.createElement("div");
      div.className = "hour-mark";
      div.style.top = `${top}%`;
      div.textContent = String(date.getHours()).padStart(2, "0") + ":00";
      railBody.appendChild(div);
    });
  }

  function renderColumns(rangeStart, rangeEnd) {
    el.columns.innerHTML = "";
    const resources = STATE.activeResources || [];

    // Todellinen pikselikorkeus, jonka aikajana saa käyttöönsä. Tätä tarvitaan,
    // jotta lyhyille (esim. 15 min) tapahtumille voidaan taata edes
    // luettava vähimmäiskorkeus — pelkkä prosenttikorkeus menee olemattomiin
    // pienillä (mobiili-) näytöillä, joilla koko aikajana on muutenkin matalampi.
    //
    // HUOM: el.columns:in korkeus sisältää myös palstojen otsikkorivin
    // (.resource-col-header, ks. --col-header-h), mutta tapahtumien top:%
    // lasketaan .resource-col-body:n (otsikon ALAPUOLISEN, pienemmän) alueen
    // suhteen — jos containerHeightPx otettaisiin el.columns:ista, kaikki
    // pikseleinä asetetut min-height-arvot olisivat systemaattisesti hieman
    // liian suuria suhteessa prosenttikorkeuteen, ja jokainen laatikko
    // venyisi todellista kestoaan pidemmäksi (esim. muutama pikseli yli
    // tasatunnin, vaikka kesto päättyisi tasan siihen). Mitataan siis
    // #hourRail:n sisältöalue (.hour-rail-body), joka on täsmälleen saman
    // korkuinen kuin .resource-col-body — sama alue jota positionNowLine()
    // jo käyttää "nyt"-viivan sijoitukseen.
    const hourRailBodyEl = el.hourRail.querySelector(".hour-rail-body");
    const containerHeightPx =
      (hourRailBodyEl && hourRailBodyEl.getBoundingClientRect().height) ||
      el.columns.getBoundingClientRect().height ||
      window.innerHeight * 0.7;

    if (resources.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-message";
      div.textContent = "Ladataan tietoja…";
      el.columns.appendChild(div);
      return;
    }

    resources.forEach((lp) => {
      const col = document.createElement("div");
      col.className = "resource-col";

      const header = document.createElement("div");
      header.className = "resource-col-header";
      header.textContent = resourceDisplayName(lp);
      col.appendChild(header);

      const body = document.createElement("div");
      body.className = "resource-col-body";
      col.appendChild(body);

      // Tuntiviivat palstan sisällä — kokotunnit yhtenäisellä viivalla,
      // puolen tunnin kohdat katkoviivalla (.half, ks. style.css).
      hourMarkers(rangeStart, rangeEnd).forEach(({ top, half }) => {
        const line = document.createElement("div");
        line.className = half ? "hour-grid-line half" : "hour-grid-line";
        line.style.top = `${top}%`;
        body.appendChild(line);
      });

      const events = STATE.eventsByLp.get(lp.id) || [];
      if (events.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-message";
        empty.textContent = "Ei vuoroja tänään";
        body.appendChild(empty);
      } else {
        const { shared, solo } = groupSharedEvents(events);

        // Kuinka paljon TÄMÄ tapahtuma saa korkeintaan kasvaa alle
        // vähimmäiskorkeuden (ks. renderEvent) törmäämättä SEURAAVAAN
        // samalla palstalla alkavaan tapahtumaan — ks. computeMaxHeightPx.
        const maxHeightFor = (startDt, endDt) =>
          computeMaxHeightPx(startDt, endDt, events, rangeStart, rangeEnd, containerHeightPx);

        // Ensin yhdistetään toisiaan koskettavat liian lyhyet tapahtumat
        // ketjuiksi (ks. buildRenderUnits) — layoutColumns saa näin joko
        // yksittäisiä tapahtumia TAI ketju-"stand-in"-olioita, jotka sillekin
        // näyttävät ihan tavalliselta ajanjaksolta (startDt/endDt), koska se
        // ei muuten välitä sisällöstä.
        const units = buildRenderUnits(solo, rangeStart, rangeEnd, containerHeightPx);
        const laidOut = layoutColumns(units);
        laidOut.forEach(({ ev: unit, col: c, cols }) => {
          const maxHeightPx = maxHeightFor(unit.startDt, unit.endDt);
          body.appendChild(
            unit.chain
              ? renderChainGroup(unit.chain, c, cols, rangeStart, rangeEnd, containerHeightPx, maxHeightPx)
              : renderEvent(unit, c, cols, rangeStart, rangeEnd, containerHeightPx, maxHeightPx)
          );
        });

        // Jaettu jää piirretään ihan samalla renderEvent()-laatikolla kuin
        // kaikki muutkin tapahtumat (sama fontti, aika, koko) — ei omaa,
        // erilaiselta näyttävää ulkoasua. Ainoa muutos sisältöön on että
        // otsikossa näkyvät KAIKKIEN osapuolten nimet yhdistettynä
        // (esim. "U9 / U8"), koko jään levyisenä laatikkona (colIndex 0,
        // colCount 1) kahden kapean, samaa aikaa toistavan laatikon sijaan.
        shared.forEach((group) => {
          const combinedTitle = group
            .map((ev) => splitTitle(decodeEntities(ev.title)).title)
            .join(" / ");
          const merged = { ...group[0], title: combinedTitle };
          const maxHeightPx = maxHeightFor(merged.startDt, merged.endDt);
          body.appendChild(renderEvent(merged, 0, 1, rangeStart, rangeEnd, containerHeightPx, maxHeightPx));
        });
      }

      el.columns.appendChild(col);
    });
  }

  // Ei enää keinotekoista vähimmäiskorkeutta (aiempi MIN_BLOCK_PX): laatikon
  // korkeus seuraa aina suoraan tapahtuman todellista kestoa, jotta laatikon
  // alareuna vastaa aina oikeaa päättymisaikaa aikajanalla eikä näytä
  // tapahtuman jatkuvan pidempään kuin se oikeasti kestää. Lyhyillä
  // tapahtumilla (esim. alkulämpö) laatikko voi silti kasvaa hieman tätä
  // korkeammaksi jos otsikko/kellonaika ei muuten mahtuisi (ks. min-height
  // alempana ja .compact-asettelu CSS:ssä) — se on kuitenkin vain sen
  // verran kuin teksti oikeasti vaatii, ei kiinteä lisäpakko. Kasvu on
  // kuitenkin rajattu jos seuraava tapahtuma alkaa lähellä (ks.
  // computeMaxHeightPx), ettei laatikko valu sen päälle.
  const COMPACT_BELOW_PX = 46; // tämän alle kellonaika siirtyy otsikon viereen (ks. .compact CSS:ssä)
  // Hyvin lyhyet (esim. 15 min alkulämpö) tapahtumat eivät mahdu edes
  // .compact-asettelun tekstikokoon ilman että laatikko venyy selvästi
  // todellista kestoaan pidemmäksi ja tulvii seuraavan tunnin puolelle —
  // pienennetään fontti ja piilotetaan kellonaikaikoni entisestään, jotta
  // vaadittu vähimmäiskorkeus lähenee todellista kestoa (ks. .tiny CSS:ssä).
  const TINY_BELOW_PX = 26;

  // Kuinka korkeaksi laatikko saa KORKEINTAAN kasvaa alle oman todellisen
  // kestonsa (ks. min-height yllä) törmäämättä SEURAAVAAN samalla palstalla
  // alkavaan tapahtumaan. HUOM: kahden peräkkäisen, ilman väliä olevan
  // LYHYEN vuoron tapaus (esim. "MESTIS alkulämpö tuomarit" 17:40–17:50,
  // heti perässä "...pelaajat" 17:50–18:10) ei enää päädy tänne asti
  // tiukasti rajoitettuna — ne yhdistetään jo ennen tätä yhdeksi ketjuksi
  // (ks. buildRenderUnits/CHAIN_MERGE_BELOW_PX), koska pelkkä katto ei
  // riittänyt: 10 minuutin osuus on pikseleinä niin kapea ettei edes
  // .tiny-fontti (ks. TINY_BELOW_PX) mahtunut siihen luettavasti. Tätä
  // funktiota tarvitaan silti edelleen — esim. kun lyhyt tapahtuma on
  // ainoa yksittäinen palstallaan mutta koskettaa suoraan MUUTA (ei ketjuun
  // kelpuutettua) seuraavaa tapahtumaa. Etsitään siis lähin seuraava
  // tapahtuma joka alkaa VASTA tämän päätyttyä (ei siis ajallisesti
  // päällekkäinen — ne on jo eroteltu omiin sarakkeisiinsa, ks.
  // layoutColumns, eikä niitä pidä rajoittaa tällä), ja käytetään sen
  // alkukohtaa kattona. Palauttaa null jos ei rajoitusta (esim. päivän
  // viimeinen tapahtuma palstalla).
  function computeMaxHeightPx(startDt, endDt, allEvents, rangeStart, rangeEnd, containerHeightPx) {
    let boundaryDt = null;
    for (const other of allEvents) {
      if (other.startDt < endDt) continue; // ajallisesti päällekkäinen -> oma sarake, ei rajoita
      if (other.startDt <= startDt) continue; // ei "seuraava"
      if (boundaryDt === null || other.startDt < boundaryDt) boundaryDt = other.startDt;
    }
    if (boundaryDt === null) return null;
    const top = pctOf(startDt, rangeStart, rangeEnd);
    const boundaryPct = pctOf(boundaryDt, rangeStart, rangeEnd);
    return Math.max(0, ((boundaryPct - top) / 100) * containerHeightPx);
  }

  function renderEvent(ev, colIndex, colCount, rangeStart, rangeEnd, containerHeightPx, maxHeightPx) {
    const top = pctOf(ev.startDt, rangeStart, rangeEnd);
    const bottom = pctOf(ev.endDt, rangeStart, rangeEnd);
    const heightPct = Math.max(0.5, bottom - top);
    const heightPx = (heightPct / 100) * containerHeightPx;

    const widthPct = 100 / colCount;
    const leftPct = widthPct * colIndex;

    // splitTitle erottaa myös "N/M"-jako-osuuden otsikosta (esim.
    // "Hokkarit-U15 2/2" -> "Hokkarit-U15"), vaikka sitä ei enää näytetä
    // omana badgena — tilan säästämiseksi jaettu jää näkyy jo siitä että
    // laatikoita on vierekkäin, joten erillinen "jaettu N/M" -teksti
    // olisi vain toistoa.
    const { title } = splitTitle(decodeEntities(ev.title));

    const block = document.createElement("div");
    block.className = `event-block ${statusClass(ev.className)}`;
    if (heightPx < COMPACT_BELOW_PX) block.classList.add("compact");
    if (heightPx < TINY_BELOW_PX) block.classList.add("tiny");
    block.style.top = `${top}%`;
    // min-height (ei height): jos otsikko tarvitsee enemmän tilaa kuin ajan
    // suhteesta laskettu korkeus antaisi, laatikko saa kasvaa sen verran —
    // muuten kiinteä korkeus + overflow:hidden leikkaisi otsikon kesken.
    block.style.minHeight = `${heightPx}px`;
    // Katto vain jos seuraava tapahtuma on lähellä (ks. computeMaxHeightPx) —
    // muuten laatikko saisi kasvaa rajattomasti kuten ennenkin. Kun katto on
    // asetettu, overflow:hidden estää sisällön (harvinaisessa ääritapauksessa,
    // esim. hyvin lyhyt + pitkä otsikko) valumasta seuraavan laatikon päälle.
    if (maxHeightPx !== null && maxHeightPx !== undefined) {
      block.style.maxHeight = `${maxHeightPx}px`;
      block.style.overflow = "hidden";
    }
    block.style.left = `calc(${leftPct}% + 16px)`;
    block.style.width = `calc(${widthPct}% - 32px)`;

    const titleEl = document.createElement("div");
    titleEl.className = "ev-title";
    titleEl.textContent = title;
    block.appendChild(titleEl);

    const timeEl = document.createElement("div");
    timeEl.className = "ev-time";
    timeEl.innerHTML = CLOCK_ICON_SVG; // vakio, ei koskaan käyttäjädataa
    const timeText = document.createElement("span");
    timeText.textContent = `${fmtHM(ev.startDt)}–${fmtHM(ev.endDt)}`;
    timeEl.appendChild(timeText);
    block.appendChild(timeEl);

    return block;
  }

  // Piirtää ketjuksi yhdistetyt, toisiaan koskettavat lyhyet tapahtumat
  // (ks. buildRenderUnits) YHTENÄ laatikkona: yhteinen osa otsikoista
  // yläriville (jos sellainen löytyy, ks. splitCommonPrefix) ja jokainen
  // osa omalle rivilleen OMALLA kellonajallaan (ei siis vain yhtä
  // yhdistettyä kokonaisaikaa) — näin esim. tuomarit näkevät suoraan että
  // heidän oma aikansa on vain 17:40–17:50, vaikka koko laatikko kattaa
  // 17:40–18:10. Laatikon koko/sijainti lasketaan muuten täsmälleen samoin
  // kuin renderEvent()issä (ks. sielläkin selitetyt top/min-height/max-height).
  function renderChainGroup(chain, colIndex, colCount, rangeStart, rangeEnd, containerHeightPx, maxHeightPx) {
    const startDt = chain[0].startDt;
    const endDt = chain[chain.length - 1].endDt;
    const top = pctOf(startDt, rangeStart, rangeEnd);
    const bottom = pctOf(endDt, rangeStart, rangeEnd);
    const heightPct = Math.max(0.5, bottom - top);
    const heightPx = (heightPct / 100) * containerHeightPx;

    const widthPct = 100 / colCount;
    const leftPct = widthPct * colIndex;

    const titles = chain.map((ev) => splitTitle(decodeEntities(ev.title)).title);
    const { common, rests } = splitCommonPrefix(titles);

    const block = document.createElement("div");
    // Väri/reunaviiva ensimmäisen osan tilan mukaan (ks. statusClass) —
    // "chain-group" antaa CSS:ssä oman, listamaisen sisäasettelun.
    block.className = `event-block chain-group ${statusClass(chain[0].className)}`;
    block.style.top = `${top}%`;
    block.style.minHeight = `${heightPx}px`;
    if (maxHeightPx !== null && maxHeightPx !== undefined) {
      block.style.maxHeight = `${maxHeightPx}px`;
      block.style.overflow = "hidden";
    }
    block.style.left = `calc(${leftPct}% + 16px)`;
    block.style.width = `calc(${widthPct}% - 32px)`;

    if (common) {
      const titleEl = document.createElement("div");
      titleEl.className = "ev-title";
      titleEl.textContent = common;
      block.appendChild(titleEl);
    }

    const list = document.createElement("div");
    list.className = "chain-list";
    chain.forEach((ev, i) => {
      const row = document.createElement("div");
      row.className = "chain-item";
      const label = document.createElement("span");
      label.className = "chain-item-label";
      label.textContent = rests[i] || titles[i];
      const time = document.createElement("span");
      time.className = "chain-item-time";
      time.textContent = `${fmtHM(ev.startDt)}–${fmtHM(ev.endDt)}`;
      row.appendChild(label);
      row.appendChild(time);
      list.appendChild(row);
    });
    block.appendChild(list);

    return block;
  }

  // Tosi kun koppijakotaulu (kopit.js) on ilmoittanut asettuneensa lopulliseen
  // korkeuteensa (tai aikakatkaisu on lauennut) — ks. koppijakoWaitTimeoutMs
  // ja waitForKoppijako() alempana. Kunnes tämä on tosi, "nyt"-viiva
  // pidetään piilossa vaikka data olisi muuten valmis, ettei se väläh­dä
  // hetkeksi väärään pikselikohtaan #board:n vielä muuttuessa kokoaan.
  let koppijakoSettled = false;

  function positionNowLine(now, rangeStart, rangeEnd) {
    if (!koppijakoSettled) {
      el.nowLine.style.display = "none";
      return;
    }

    // Aikajana piirretään aina CONFIG.dayEndHour:iin asti (ks. computeRange),
    // joten "nyt"-viiva näkyy koko sen näkyvän aikavälin ajan — piilotetaan
    // vain jos ollaan aidosti sen ulkopuolella (esim. ennen dayStartHour:ia
    // aamulla, tai dayEndHour:in jälkeen illalla).
    if (now < rangeStart || now > rangeEnd) {
      el.nowLine.style.display = "none";
      return;
    }
    el.nowLine.style.display = "block";
    const pct = pctOf(now, rangeStart, rangeEnd);

    // pct on prosenttiosuus SISÄLTÖalueesta (otsikkorivin alapuolelta, ks.
    // hour-rail-body / resource-col-body — sama alue johon tuntimerkit ja
    // tapahtumatkin asemoidaan). #nowLine on kuitenkin #board:n lapsi, joka
    // sisältää myös otsikkorivin, joten pelkkä "${pct}%" veti viivan liian
    // ylös (osittain otsikon päälle). Lasketaan siis pikselikohtainen
    // sijainti niin että 0 % osuu otsikkorivin alareunaan, ei #board:n
    // yläreunaan.
    //
    // HUOM: #nowLine:n "top" on suhteessa #board:n SISÄLTÖalueen (padding
    // edge) yläreunaan, eli reunaviivan (border-top) SISÄPUOLELLE — mutta
    // getBoundingClientRect() palauttaa reunaboksin (border box) ulkoreunan.
    // Jos board.clientTop (= border-top-width, tässä 1px) jätetään
    // vähentämättä, viiva piirtyy juuri sen verran liian alas jokaisessa
    // kohdassa (esim. tasatunneilla pari pikseliä "tuntimerkin" ohi).
    const boardRect = el.board.getBoundingClientRect();
    const bodyEl = el.hourRail.querySelector(".hour-rail-body");
    const bodyRect = (bodyEl || el.board).getBoundingClientRect();
    const topPx = (bodyRect.top - boardRect.top - el.board.clientTop) + (pct / 100) * bodyRect.height;
    el.nowLine.style.top = `${topPx}px`;
    el.nowLineLabel.textContent = fmtHM(now);
  }

  // -------------------- Ajastimet --------------------

  function tick() {
    // Vuorokauden vaihtuminen: jos päivä on vaihtunut viimeisimmästä
    // onnistuneesta hausta, haetaan heti uuden päivän data. HUOM: jos
    // testipäivä (?date=) on asetettu, tämä pysyy tarkoituksella samana
    // eikä etene automaattisesti oikean vuorokauden vaihtuessa — testipäivä
    // on "pinnattu" kunnes sivu ladataan ilman parametria.
    const key = todayKey(getEffectiveNow());
    if (STATE.lastGoodDate && STATE.lastGoodDate !== key) {
      refreshData();
      return;
    }

    if (STATE.activeResources) {
      const now = getEffectiveNow();
      const { rangeStart, rangeEnd } = computeRange(now);
      positionNowLine(now, rangeStart, rangeEnd);
    }
  }

  let dailyReloadTriggered = false;
  function maybeDailyReload() {
    // Tarkoituksella OIKEA kellonaika (ei getEffectiveNow()) — automaattinen
    // uudelleenlataus ei saa riippua testipäivästä.
    if (CONFIG.dailyReloadHour === null) return;
    const now = new Date();
    const inWindow = now.getHours() === CONFIG.dailyReloadHour && now.getMinutes() === 0;
    if (inWindow && !dailyReloadTriggered) {
      dailyReloadTriggered = true;
      location.reload();
    } else if (!inWindow) {
      dailyReloadTriggered = false; // varaudutaan seuraavaan päivään
    }
  }

  // Tapahtumakorkeudet lasketaan pikseleinä renderöintihetken näyttökoon
  // mukaan (ks. renderEvent), joten koon muuttuessa (esim. puhelimen kierto)
  // asettelu on piirrettävä uudelleen — muuten korkeudet jäävät vanhoiksi.
  let resizeDebounce = null;
  function onResize() {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (STATE.activeResources) renderBoard();
    }, 150);
  }

  // Piirtää koko laudan (tuntipalkki, tapahtumapalstat, "nyt"-viiva)
  // uudelleen tämänhetkisen ajan/koon mukaan — käytetään sekä alla olevasta
  // ResizeObserverista että koppijaon valmistumisesta. HUOM: pelkkä
  // "nyt"-viivan uudelleensijoitus ei riitä, koska tapahtumalaatikoiden
  // korkeudet (ks. renderEvent) lasketaan pikseleinä #board:n SEN HETKISEN
  // korkeuden mukaan — jos vain viiva päivitettäisiin, laatikot jäisivät
  // vanhaan pikselikorkeuteen ja näyttäisivät kestävän väärän ajan.
  function refreshLayout() {
    if (!STATE.activeResources) return;
    renderBoard();
  }

  // #board:n korkeus ei ole kiinteä: se saa flex-tilaa sen mukaan paljonko
  // yläpuolella oleva koppijakotaulu (kopit.js, oma erillinen datahaku) vie.
  // Sekä "nyt"-viivan pikselikohta että tapahtumalaatikoiden pikselikorkeus
  // lasketaan #board:n SEN HETKISEN korkeuden mukaan (ks. positionNowLine,
  // renderEvent) — jos koppitaulu latautuu myöhemmin ja muuttaa kokoaan
  // (esim. "Haetaan dataa…" -> N riviä), #board kutistuu/kasvaa ilman että
  // kumpikaan skripti tietää toisesta. koppijakoSettled-odotus (ks.
  // waitForKoppijako alla) hoitaa ENSIMMÄISEN näyttökerran; tämä
  // ResizeObserver on varmuuden vuoksi sen jälkeenkin, jos #board:n koko
  // muuttuu jostain muusta syystä (esim. koppijaon rivimäärä vaihtuu
  // myöhemmällä päivityksellä).
  if (window.ResizeObserver) {
    let boardResizeDebounce = null;
    new ResizeObserver(() => {
      clearTimeout(boardResizeDebounce);
      boardResizeDebounce = setTimeout(refreshLayout, 30);
    }).observe(el.board);
  }

  // Odottaa koppijakotaulun (kopit.js) ensimmäisen latauksen valmistumista
  // ennen kuin "nyt"-viiva päästetään näkyviin ensimmäistä kertaa (ks.
  // koppijakoSettled / positionNowLine). kopit.js laukaisee
  // "koppijako:initial-load"-tapahtuman heti kun se on piirtänyt joko
  // oikean datan tai virhetilanteen — molemmissa tapauksissa #board:n koko
  // on siinä vaiheessa asettunut lopulliseksi. Aikakatkaisu varmistaa
  // ettei viiva jää piiloon ikuisesti, jos kopit.js puuttuu sivulta tai
  // sen lataus jumiutuu kokonaan (esim. verkko ei koskaan aikakatkea).
  function waitForKoppijako() {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      koppijakoSettled = true;
      refreshLayout();
    };
    window.addEventListener("koppijako:initial-load", settle, { once: true });
    setTimeout(settle, CONFIG.koppijakoWaitTimeoutMs);
  }

  function start() {
    STATE.dateOverride = parseDateOverride();
    if (STATE.dateOverride) {
      const { y, m, d } = STATE.dateOverride;
      const label = `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
      el.testDateBanner.textContent = `TESTIPÄIVÄ: ${label}`;
      el.testDateBanner.hidden = false;
      console.warn(`[pukukoppi] Testipäivä käytössä: ${label} (poista ?date=-parametri näyttääksesi oikean päivän).`);
    }

    refreshData();
    waitForKoppijako();

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    setInterval(refreshData, CONFIG.refreshIntervalMs);
    setInterval(() => {
      tick();
      maybeDailyReload();
    }, CONFIG.tickIntervalMs);
  }

  start();
})();
