#!/usr/bin/env python3
"""Macht aus entwuerfe/anmeldung-deckblatt.html eine eigenstaendige Datei.

Der Entwurf im Repository verweist auf ../img, ../icons und ../fonts -- so
ist er lesbar und traegt keine Datenblobs im Quelltext. Zum Verschicken oder
Anschauen ausserhalb des Repositories braucht es eine Fassung, die alles
mitbringt. Genau das macht dieses Skript. Ergebnis ist eine Kopie, kein
Ersatz -- die Quelle bleibt unveraendert.

    python3 entwuerfe/deckblatt-buendeln.py [ziel.html]
"""
import base64, pathlib, sys

wurzel = pathlib.Path(__file__).resolve().parent.parent
quelle = wurzel / 'entwuerfe' / 'anmeldung-deckblatt.html'
ziel = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else wurzel / 'entwuerfe' / 'anmeldung-deckblatt.eigenstaendig.html'

ERSATZ = {
    '../fonts/inter-latin.woff2': 'font/woff2',
    '../img/anmeldung-nacht.webp': 'image/webp',
    '../logo-quellen/cupi24-original.png': 'image/png',
}

text = quelle.read_text(encoding='utf-8')
for pfad, typ in ERSATZ.items():
    roh = (wurzel / pfad.replace('../', '')).read_bytes()
    datenUrl = 'data:' + typ + ';base64,' + base64.b64encode(roh).decode('ascii')
    if pfad not in text:
        raise SystemExit('Verweis nicht gefunden: ' + pfad)
    text = text.replace(pfad, datenUrl)

ziel.write_text(text, encoding='utf-8')
print(ziel, '—', round(len(text) / 1024), 'KB')
