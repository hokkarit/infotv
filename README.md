# Jäähallin infonäyttö — päivän jääajat

Staattinen, riippumaton HTML/CSS/JS-sivu Hämeenkyrön Jäähallin aulan
pystysuuntaiselle FullHD-infonäytölle. Yhdellä sivulla kaksi osaa:

- **yläosa**: pukukoppijako (mikä koppi kuuluu kenellekin)
- **alaosa**: **tämän päivän** jääajat pystysuuntaisena aikajanana, yksi
  palsta per liikuntapaikka, ja punainen viiva joka näyttää missä kohtaa
  päivää mennään juuri nyt

Ei build-vaihetta, ei riippuvuuksia — viisi tiedostoa:

- `index.html` — sivurunko, lataa sekä `kopit.js`:n että `app.js`:n
- `style.css` — yhteinen tyylitiedosto molemmille osille
- `app.js` — aikajanan logiikka (Hokkarit-rajapinta)
- `kopit.js` — pukukoppijaon logiikka (Google Sheets, ks. alla)
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
| `dayStartHour` / `dayEndHour` | Aikajanan oletusnäkyvyysväli — laajenee automaattisesti jos tapahtumia on tämän ulkopuolella. |
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
