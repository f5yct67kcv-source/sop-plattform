#!/usr/bin/env python3
"""Kopiert app.html unveraendert nach mobile/www/index.html.

Variante A (ENT-588): Der Web-Inhalt liegt fest im App-Buendel, nicht
nachgeladen von der gehosteten Seite. app.html bleibt die einzige Quelle --
die Unterscheidung Browser/native Huelle steckt in app.html selbst
(nativeAppHuelle(), erkennt window.Capacitor zur Laufzeit). Eine reine
Kopie reicht darum aus, kein Platzhalter-Ersatz noetig ausser beim
Maps-Schluessel (siehe unten).

    python3 mobile-buendel-erstellen.py

Nach jeder Aenderung an app.html erneut ausfuehren, bevor "npx cap sync"
in mobile/ laeuft. test_php.mjs schlaegt an, wenn die beiden auseinander-
laufen.

Der Maps-JS-Schluessel (__MAPS_JS_KEY__) bleibt in mobile/www/index.html
ein unersetzter Platzhalter -- es gibt fuer die native Huelle keine
GitHub-Actions-Ersetzung wie fuer den Web-Deploy. Vor einem echten
Geraete-Build lokal ersetzen, nie committen:

    sed -i '' "s|__MAPS_JS_KEY__|<echter Schluessel>|g" mobile/www/index.html
"""
from pathlib import Path
import sys

quelle = Path('app.html')
ziel = Path('mobile/www/index.html')

if not quelle.exists() or not ziel.parent.exists():
    sys.exit('app.html oder mobile/www/ fehlt -- im Repo-Wurzelverzeichnis ausfuehren.')

inhalt = quelle.read_text(encoding='utf-8')
ziel.write_text(inhalt, encoding='utf-8')
print(f'mobile/www/index.html aus app.html erzeugt ({len(inhalt)} Zeichen).')
