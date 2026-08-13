#!/usr/bin/env python3
"""
Yksinkertainen staattinen palvelin infonäyttöä varten.

Sama kuin `python3 -m http.server`, mutta lähettää jokaisen vastauksen
mukana `Cache-Control: no-store` -otsikon. Ilman tätä selaimet (varsinkin
mobiilit) saattavat jäädä tarjoilemaan vanhaa index.html/style.css/app.js
-versiota välimuistista, vaikka tiedostot on levyllä jo päivitetty —
tämä koskee sekä testausta että oikeaa TV-käyttöä.

Käyttö:
    python3 server.py [portti]   # oletusportti 8000
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    HTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()
