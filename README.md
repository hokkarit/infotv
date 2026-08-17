# Jäähallin infonäyttö — päivän jääajat

Staattinen, riippumaton HTML/CSS/JS-sivu Hämeenkyrön Jäähallin aulan
pystysuuntaiselle FullHD-infonäytölle. Yhdellä sivulla kaksi osaa:

- **yläosa**: pukukoppijako (mikä koppi kuuluu kenellekin)
- **alaosa**: **tämän päivän** jääajat pystysuuntaisena aikajanana, yksi
  palsta per liikuntapaikka, ja punainen viiva joka näyttää missä kohtaa
  päivää mennään juuri nyt

Ei build-vaihetta, ei riippuvuuksia — kuusi tiedostoa:

- `index.html` — sivurunko, lataa sekä `kopit.js`:n että `app.js`:n
- `style.css` — yhteinen tyylitiedosto molemmille osille
- `app.js` — aikajanan logiikka (Hokkarit-rajapinta)
- `kopit.js` — pukukoppijaon logiikka (Google Sheets, ks. alla)
- `sijainnit.json` — koppien nuolten suunnat per näyttötila (ks. "Koppien sijainnit")
- `server.py` — kevyt palvelin joka lähettää `Cache-Control: no-store`
  -otsikot (ks. "Käyttöönotto TV:llä")

## Datalähde

Sivu hakee datan suoraan selaimessa Hokkarit ry:n julkisesta
varausrajapinnasta (sama rajapinta jota `hokkarit.fi/vuorovaraukset`
itse käyttää):

- `GET https://www.hokkarit.fi/api/lpreservations/lps` — liikuntapaikkojen lista
- `GET https://www.hokkarit.fi/api/lpreservations/reservations/{id}?year=&month=&day=` — kyseisen kuukauden varaukset

Rajapinta sallii CORS:n (`Access-Control-Allow-Origin: *`), joten
mikä tahansa domain — myös paikallinen `file://`-sivu — saa haettua
sen suoraan. Dataa haetaan uudelleen 3 minuutin välein
(`CONFIG.refreshIntervalMs` tiedostossa `app.js`).

**Pukukopit:** Hokkarit-rajapinta ei välitä minkäänlaista pukukoppi-
tai vapaata kommenttikenttää vuorojen yhteydessä — vain vuoron nimen,
ajan ja tilan. Koppijako haetaan siis erikseen, `kopit.js`:llä, suoraan
tästä Google Sheets -taulukosta (CSV-vienti, 5 min välein):
<https://docs.google.com/spreadsheets/d/1Cn1DqQy1BJHFSoBV2u7cm2awDpaKfhKmBqACV6wa9DY/edit>

HUOM tämän hauraudesta: Sheetsin CSV-vientilinkki on dokumentoimaton
Google-käyttäytymä (ei virallinen API) joka toimii koska taulukko on
jaettu "kaikki linkin saaneet voivat katsoa" -tilassa ja Google
sattuu lähettämään CORS-otsikot export-vastauksessa — kumpi tahansa
voi hajota ilman varoitusta. Jos näin käy, viimeisin onnistuneesti
haettu koppijako jää näkyviin ja sivulle ilmestyy virheilmoitus jossa
pyydetään ottamaan yhteyttä ylläpitoon (ks. `kopit.js` → `DataShapeError`).

## Koppien sijainnit (`sijainnit.json`)

Kunkin pukukopin nuolen suunta (vasen/oikea) ei tule Google Sheets
-taulukosta eikä koodiin kovakoodatusta koppinumerosta, vaan tiedostosta
`sijainnit.json`. Syy: sama koppi voi olla eri suuntaan riippuen siitä
kummasta hallin sisäänkäynnistä/näytöstä katsotaan — tätä varten
osoitteeseen voi lisätä `?display=<tila>`-parametrin, joka valitsee mitkä
rivit `sijainnit.json`:sta ovat voimassa.

Tiedoston muoto — taulukko `{ display, room, location }`-rivejä:

```json
[
  { "display": "default", "room": "Koppi 1", "location": "left" },
  { "display": "default", "room": "Koppi 2", "location": "left" },
  { "display": "default", "room": "Koppi 3", "location": "right" },
  { "display": "default", "room": "Koppi 4", "location": "right" },
  { "display": "default", "room": "Koppi 5", "location": "left" },
  { "display": "main",    "room": "Koppi 1", "location": "left" },
  { "display": "main",    "room": "Koppi 2", "location": "left" },
  { "display": "main",    "room": "Koppi 3", "location": "left" },
  { "display": "main",    "room": "Koppi 4", "location": "left" },
  { "display": "main",    "room": "Koppi 5", "location": "left" }
]
```

- `display` — näyttötilan nimi, sama kuin `?display=`-parametrin arvo.
  `"default"`-tila on voimassa kun parametria ei ole annettu lainkaan tai
  sen arvo ei täsmää mihinkään `sijainnit.json`:n riviin.
- `room` — koppi täsmälleen samassa muodossa kuin Sheets-taulukon
  ensimmäisessä sarakkeessa ("Koppi N").
- `location` — `"left"` tai `"right"`.

**Käyttö TV:llä/näytöllä:** `index.html?display=main` näyttää kaikkien
koppien nuolet vasemmalle (yllä olevalla esimerkkidatalla) sen sijaan
että se päättelisi suunnan koppinumerosta. Uuden näyttötilan lisääminen
ei vaadi koodimuutoksia — riittää lisätä `sijainnit.json`:iin uudet rivit
halutulla `display`-arvolla kaikille kopeille.

Varamekanismit jos jotain puuttuu (ks. `kopit.js` → `resolveSijainti`):
1. jos annetulle `?display=`-arvolle ei löydy riviä tietylle kopille,
   käytetään `"default"`-tilan riviä samalle kopille (konsoliin varoitus)
2. jos koppia ei löydy `sijainnit.json`:sta lainkaan (esim. Sheetsiin on
   lisätty uusi koppi jota ei ole vielä lisätty `sijainnit.json`:iin),
   arvataan suunta koppinumerosta (1–2 = vasen, muut = oikea)
3. jos `sijainnit.json`:in lataus epäonnistuu kokonaan, käytetään
   `kopit.js`:ään sisäänrakennettua kopiota samasta datasta
   (`FALLBACK_SIJAINNIT`) — nuolet piirtyvät siis aina, vaikka tiedosto
   katoaisi tai olisi hetkellisesti tavoittamattomissa.

## Osoiteparametrit

| Parametri | Vaikutus |
|---|---|
| `?display=<tila>` | Valitsee minkä `sijainnit.json`:n rivit ovat voimassa koppien nuolten suunnalle (ks. yllä "Koppien sijainnit"). Esim. `?display=main`. Puuttuva tai tuntematon arvo = `"default"`-tila. |
| `?date=YYYY-MM-DD` | Pakottaa aikajanan (alaosa) näyttämään jonkin toisen päivän vuorot tämän päivän sijaan, esim. testausta varten. Kellonaika pysyy silti oikeana. Rajattu ±14 vrk oikeasta päivästä, ja ruudun oikeaan yläkulmaan ilmestyy silloin violetti "TESTIPÄIVÄ"-merkki (ks. `app.js` → `CONFIG.dateOverrideMaxDays`). |

Parametrit voi yhdistää, esim. `index.html?display=main&date=2026-08-20`.

## Käyttöönotto TV:llä

1. Kopioi nämä neljä tiedostoa jollekin web-palvelimelle ja käynnistä
   mukana tuleva `server.py` (**ei** pelkkä `python3 -m http.server`) —
   se lähettää `Cache-Control: no-store` -otsikot, jotta selain ei jää
   tarjoilemaan vanhaa `app.js`/`style.css`-versiota välimuistista kun
   tiedostoja päivitetään levyllä. Vaihtoehtoisesti `index.html` voi
   avata suoraan kioskiselaimessa `file://`-polusta.
2. Aseta näytön selain **kioskitilaan** pystyasennossa osoittaen
   `index.html`-tiedostoon.
3. Varmista, että selain käynnistyy automaattisesti uudelleen jos TV
   sammuu/käynnistyy (esim. Chromiumin `--kiosk --incognito` +
   käyttöjärjestelmän autostart).
4. Sivu päivittää itse itsensä (data 3 min välein, kello 15 s
   välein) eikä vaadi manuaalista päivitystä. Se myös lataa itsensä
   kokonaan uudelleen kerran vuorokaudessa klo 04:00
   (`CONFIG.dailyReloadHour`) pitkän ajon muistivuotojen varalta —
   voit poistaa tämän asettamalla arvoksi `null`.

## Muokattavat asetukset (`app.js` → `CONFIG`)

| Asetus | Merkitys |
|---|---|
| `resourceOrder` | Mitkä liikuntapaikat näytetään ja missä järjestyksessä (nimen perusteella). Tyhjä lista `[]` = näytä kaikki aktiiviset. |
| `refreshIntervalMs` | Kuinka usein data haetaan uudelleen. |
| `dayStartHour` | Aikajanan alkuaika — aikaistuu automaattisesti jos tapahtumia alkaa tätä ennen. |
| `dayEndHour` | Aikajanan loppuaika — kiinteä, ei venytetä vaikka joku vuoro päättyisi myöhemmin (se leikkautuu pois näkyvistä). |
| `dailyReloadHour` | Klo, jolloin sivu lataa itsensä kokonaan uudelleen. `null` = ei koskaan. |

## Paikallinen testaus

```bash
cd pukukoppi
python3 server.py 8080
# avaa http://localhost:8080 selaimessa
```

(Käytä nimenomaan `server.py` äläkä pelkkää `python3 -m http.server` —
jälkimmäinen ei lähetä `Cache-Control: no-store` -otsikkoa, jolloin
selain voi jäädä näyttämään vanhaa versiota vaikka tiedostot on
päivitetty. Jos näyttö on joskus ajanut ilman `server.py`:tä, tee
kioskiselaimeen myös kertaalleen täysi välimuistin tyhjennys / kova
päivitys — pelkkä otsikon lisääminen ei poista jo tallennettua
vanhaa versiota.)

## Selaintestit (Playwright)

Sivu itse pysyy tarkoituksella riippuvuuksettomana (ks. yllä), mutta
`tests/`-hakemistossa on Playwright-selaintestejä aikajanan asettelulle —
näiden riippuvuudet (`package.json`) koskevat VAIN testien ajamista, eivät
itse sivua. Testit mockaavat Hokkarit-rajapinnan (ei siis riipu oikeasta
rajapinnasta eikä mistään tietystä kalenteripäivästä) ja ajavat aidossa
Chromiumissa 1080×1920-näytöllä (pystyasento) — samalla mittakaavalla kuin oikea TV.

```bash
npm install
npx playwright install chromium   # kertaalleen, lataa selaimen
npm test                          # ajaa kaikki testit (playwright.config.js
                                   # käynnistää/sammuttaa server.py:n automaattisesti)
```

Muita hyödyllisiä komentoja:

```bash
npm run test:headed   # sama, mutta näkyvässä selainikkunassa
npm run test:ui       # Playwrightin interaktiivinen testieksplorer
npm run test:report   # avaa viimeisimmän ajon HTML-raportin
```

**Testidata** (`tests/fixtures.js`): kokoelma "jänniä" reunatapauksia joita
aikajanan asettelulogiikka joutuu käsittelemään — mm. toisiaan koskettavat
lyhyet vuorot jotka pitää yhdistää yhdeksi laatikoksi (ks. commit "Yhdistä
toisiaan koskettavat lyhyet vuorot yhdeksi laatikoksi"), 2-, 3- ja
useampiosaiset ketjut, ketju jolla ei ole yhteistä otsikon osaa, ketju joka
koskettaa pitkää vuoroa, jaettu jää (2 ja 3 osapuolta), aidosti päällekkäiset
vuorot (2 ja 3 saraketta), tavallisen pituiset koskettavat vuorot jotka EIVÄT
saa ketjuuntua, hyvin pitkä otsikko, vuoro joka alkaa ennen `dayStartHour`:ia,
vuoro joka jatkuu yli `dayEndHour`:in, tyhjä päivä ja rakenteeltaan
rikkinäinen rajapintavastaus (`DataShapeError`). Uusi tilanne lisätään
uutena avaimena `SCENARIOS`-olioon fixtures.js:ssä.

**Yleiset tarkistukset joka skenaariolle** (`tests/board.spec.js`):
ettei mikään `.event-block` mene päällekkäin toisen kanssa samassa
sarakkeessa, ja ettei minkään laatikon sisältö leikkaudu pystysuunnassa
(`scrollHeight` vs. `clientHeight` — juuri se bugiluokka joka aiheutti
alkuperäisen "otsikko leikkaantuu pois" -tapauksen). Näiden lisäksi
skenaariokohtaiset testit tarkistavat mm. ketjujen osien lukumäärän ja
otsikoinnin, jaetun jään yhdistymisen ja sarakemäärän.
