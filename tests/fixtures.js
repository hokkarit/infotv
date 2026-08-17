// Testidataa selaintesteille (ks. tests/board.spec.js).
//
// HUOM: app.js hakee AINA "tämän päivän" (tai ?date=-parametrin) dataa —
// tapahtumat suodatetaan sen mukaan mikä päivämäärä tapahtuman start-kentässä
// on (ks. loadReservationsForToday). Siksi kaikki testitapahtumat luodaan
// tässä AINA suhteessa siihen päivään jona testit oikeasti ajetaan (ks.
// todayYMD), ei mihinkään kiinteään kalenteripäivään — muuten testit
// alkaisivat epäonnistua tietyn päivän jälkeen.

"use strict";

// Samat liikuntapaikat ja id:t kuin oikeassa Hokkarit-rajapinnassa (ks.
// CONFIG.resourceOrder app.js:ssä) — nimien PITÄÄ täsmätä täsmälleen, koska
// app.js suodattaa/järjestää palstat niiden mukaan.
const LPS = [
  { id: 129, name: "Hämeenkyrön Jäähalli", status: 1 },
  { id: 277, name: "Hokkarisali", status: 1 },
];

function todayYMD(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const pad = (n) => String(n).padStart(2, "0");

// Rakentaa yhden rajapinnan muotoisen tapahtuman. hh1:mm1 - hh2:mm2, tämän
// päivän (tai offsetDays:n verran siirretyn päivän) sisällä.
function ev(title, hh1, mm1, hh2, mm2, opts = {}) {
  const date = todayYMD(opts.offsetDays || 0);
  const start = `${date} ${pad(hh1)}:${pad(mm1)}`;
  const end = `${date} ${pad(hh2)}:${pad(mm2)}`;
  return {
    title,
    start,
    end,
    allDay: false,
    className: opts.className || "lp-reserved",
    description: `${title} Hämeenkyrön Jäähalli\nPvm: ${date}\nAika: ${pad(hh1)}:${pad(mm1)}-${pad(hh2)}:${pad(mm2)}`,
  };
}

// Jokainen skenaario: { name, description, jaahalli: [...], hokkarisali: [...] }
// hokkarisali oletuksena tyhjä (testaa samalla ettei tyhjä palsta hajoa).
const SCENARIOS = {
  normal: {
    description: "Tavalliset, väljästi peräkkäiset vuorot — perussilmämääräinen tarkistus.",
    jaahalli: [
      ev("Hokkarit-U15", 15, 30, 16, 30),
      ev("Hokkarit-U11", 16, 45, 17, 45),
    ],
    hokkarisali: [ev("Seniors-35", 18, 0, 19, 0)],
  },

  chainTwoShort: {
    description:
      "Alkuperäinen ongelmatapaus: kaksi ilman väliä peräkkäistä lyhyttä vuoroa " +
      "(ks. commit 'Yhdistä toisiaan koskettavat lyhyet vuorot yhdeksi laatikoksi'). " +
      "Kolmas, 20 min päähän jäävä ottelu EI saa imeytyä mukaan ketjuun.",
    jaahalli: [
      ev("MESTIS alkulämpö tuomarit", 17, 40, 17, 50),
      ev("MESTIS alkulämpö pelaajat", 17, 50, 18, 10),
      ev("MESTIS harjoitusottelu Nokian Pyry - K-Vantaa", 18, 30, 21, 0),
    ],
  },

  chainThreeShort: {
    description: "Kolme peräkkäistä, ilman väliä olevaa lyhyttä osuutta ketjutuu yhdeksi laatikoksi.",
    jaahalli: [
      ev("Turnaus alkulämpö A-lohko", 12, 0, 12, 10),
      ev("Turnaus alkulämpö B-lohko", 12, 10, 12, 20),
      ev("Turnaus alkulämpö C-lohko", 12, 20, 12, 35),
      ev("Turnaus ottelu", 12, 50, 13, 50),
    ],
  },

  chainNoCommonPrefix: {
    description:
      "Kaksi koskettavaa lyhyttä vuoroa joiden otsikoissa ei ole yhtään yhteistä " +
      "sanaa — splitCommonPrefix():n pitää pudota täysiin otsikoihin siististi.",
    jaahalli: [ev("Ilves", 14, 0, 14, 10), ev("Tappara", 14, 10, 14, 25)],
  },

  chainShortThenLong: {
    description:
      "Lyhyt vuoro koskettaa suoraan PITKÄÄ (80 min) vuoroa ilman väliä — ketju " +
      "vetää poikkeuksellisesti mukaansa myös ison naapurin, koska muuten lyhyt " +
      "osuus ei mahtuisi mihinkään.",
    jaahalli: [ev("Cup alkulämpö", 16, 0, 16, 10), ev("Cup ottelu", 16, 10, 17, 30)],
  },

  sharedIce: {
    description: "Jaettu jää: kaksi tapahtumaa TÄSMÄLLEEN samalla ajalla -> yksi yhdistetty laatikko.",
    jaahalli: [
      ev("Hokkarit-U9 1/2", 16, 45, 17, 45),
      ev("Hokkarit-U8 1/2", 16, 45, 17, 45, { className: "lp-waiting" }),
    ],
  },

  sharedIceThree: {
    description: "Jaettu jää kolmella osapuolella samaan aikaan.",
    jaahalli: [
      ev("Hokkarit-U7 1/3", 9, 0, 10, 0),
      ev("Hokkarit-U6 2/3", 9, 0, 10, 0),
      ev("Hokkarit-U5 3/3", 9, 0, 10, 0),
    ],
  },

  overlapPartial: {
    description: "Kaksi AIDOSTI (ei täsmälleen) päällekkäistä vuoroa -> vierekkäiset kapeat sarakkeet.",
    jaahalli: [ev("Joukkue A", 10, 0, 11, 0), ev("Joukkue B", 10, 30, 11, 30)],
  },

  overlapTriple: {
    description: "Kolme keskenään lomittaista vuoroa -> kolme saraketta.",
    jaahalli: [
      ev("Ryhmä 1", 9, 0, 10, 30),
      ev("Ryhmä 2", 9, 15, 10, 0),
      ev("Ryhmä 3", 9, 30, 10, 15),
    ],
  },

  longTitle: {
    description: "Hyvin pitkä otsikko joka ei mahdu yhdelle riville ilman katkaisua.",
    jaahalli: [ev("Erittäin pitkä turnauksen nimi joka ei mitenkään mahdu yhdelle riville ollenkaan", 13, 0, 14, 0)],
  },

  beforeDayStart: {
    description: "Vuoro alkaa ennen CONFIG.dayStartHour:ia (07) -> aikajanan alkua pitää aikaistaa automaattisesti.",
    jaahalli: [ev("Aamujää", 5, 30, 6, 30)],
  },

  afterDayEnd: {
    description: "Vuoro jatkuu CONFIG.dayEndHour:in (22) yli -> pitää leikkautua näkyvän alueen reunaan, ei venyä yli.",
    jaahalli: [ev("Iltavuoro", 21, 30, 23, 30)],
  },

  emptyDay: {
    description: "Ei yhtään vuoroa kummallakaan palstalla -> 'Ei vuoroja tänään' -viesti, ei kaadu.",
    jaahalli: [],
    hokkarisali: [],
  },

  touchingNormalLength: {
    description:
      "Kaksi TAVALLISEN pituista (45 min) vuoroa ilman väliä — EI saa ketjuuntua " +
      "(kumpikin mahtuu jo yksinään), pitää pysyä kahtena erillisenä koskettavana laatikkona.",
    jaahalli: [ev("Joukkue X", 17, 0, 17, 45), ev("Joukkue Y", 17, 45, 18, 30)],
  },

  malformedData: {
    description: "Rajapinnan rakenne rikki (puuttuva kenttä) -> DataShapeError-virhebanneri, ei kaadu koko sivua.",
    // Huom: EI käytetä ev()-apuria, koska tarkoitus on juuri jättää kenttä pois.
    jaahalli: [
      {
        title: "Rikkinäinen tapahtuma",
        start: `${todayYMD()} 10:00`,
        end: `${todayYMD()} 11:00`,
        allDay: false,
        // className puuttuu tarkoituksella -> assertShape() app.js:ssä heittää.
      },
    ],
  },
};

module.exports = { LPS, SCENARIOS, ev, todayYMD };
