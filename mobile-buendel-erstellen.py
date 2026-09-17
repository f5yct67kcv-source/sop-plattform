#!/usr/bin/env python3
"""Kopiert app.html und seine Begleitdateien unveraendert nach mobile/www/.

Variante A (ENT-588): Der Web-Inhalt liegt fest im App-Buendel, nicht
nachgeladen von der gehosteten Seite. app.html bleibt die einzige Quelle --
die Unterscheidung Browser/native Huelle steckt in app.html selbst
(nativeAppHuelle(), erkennt window.Capacitor zur Laufzeit). Eine reine
Kopie reicht darum aus, kein Platzhalter-Ersatz noetig ausser beim
Maps-Schluessel (siehe unten).

app.html laedt vier eigenstaendige Skripte per <script src> (gav.js,
zeitwahl.js, unterschrift.js, testumgebung.js) -- die muessen als
eigene Dateien neben index.html im Buendel liegen, ein reines Kopieren
von app.html allein reicht nicht (Befund vom 2026-09-17: bis dahin
fehlten sie im Buendel komplett, GAV-Rechnung, Zeitwahl und Unterschrift
liefen in der App ins Leere, ohne dass ein Fehler das gemeldet haette).

index.html (Rapport Tool Verkehrsdienst) und dashboard.html (Cockpit)
werden ebenfalls kopiert -- index.html als rapport-tool.html, weil der
Name index.html im Buendel schon durch die kopierte app.html belegt ist;
dashboard.html unter unveraendertem Namen. Wie app.html tragen beide
ihre eigene native-Erkennung (nativeAppHuelle()) und brauchen darum
keine Anpassung beim Kopieren.

    python3 mobile-buendel-erstellen.py

Nach jeder Aenderung an app.html, index.html oder einer der vier
Begleitdateien erneut ausfuehren, bevor "npx cap sync" in mobile/
laeuft. test_php.mjs schlaegt an, wenn eine Kopie vom Original
abweicht.

Der Maps-JS-Schluessel (__MAPS_JS_KEY__) bleibt in mobile/www/index.html
ein unersetzter Platzhalter -- es gibt fuer die native Huelle keine
GitHub-Actions-Ersetzung wie fuer den Web-Deploy. Vor einem echten
Geraete-Build lokal ersetzen, nie committen:

    sed -i '' "s|__MAPS_JS_KEY__|<echter Schluessel>|g" mobile/www/index.html

testumgebung.js traegt denselben Platzhalter-Mechanismus fuer __APP_ENV__
(siehe die Datei selbst) -- anders als der Maps-Schluessel ist der Wert
fuer die native Huelle aber nie geraete- oder personenabhaengig: Die App
im Store spricht immer mit der echten Produktivumgebung. Er wird darum
hier direkt auf "production" gesetzt (Befund vom 2026-09-17: unersetzt
zeigte die App faelschlich den TESTUMGEBUNG-Hinweis, weil die fail-safe-
Logik in testumgebung.js jeden Wert ausser "production" als Testumgebung
wertet).

icons/ und img/ werden komplett mitkopiert -- app.html, index.html und
dashboard.html laden ihre Logos (icons/guardops-*.png) und die Anmelde-
Anmation (img/anmeldung-nacht.*) relativ. Ohne die Ordner im Buendel
zeigte die App an deren Stelle ein kaputtes Bildsymbol (Befund vom
2026-09-17, test_sperren.mjs verlangt ausdruecklich "Das Logo ist
geblieben" -- der Fehler war das fehlende Bild, nicht das <img> selbst).
"""
from pathlib import Path
import shutil
import sys

ZIEL_ORDNER = Path('mobile/www')

if not Path('app.html').exists() or not ZIEL_ORDNER.exists():
    sys.exit('app.html oder mobile/www/ fehlt -- im Repo-Wurzelverzeichnis ausfuehren.')

DATEIEN = [
    ('app.html', 'index.html'),
    ('index.html', 'rapport-tool.html'),
    ('dashboard.html', 'dashboard.html'),
    ('gav.js', 'gav.js'),
    ('zeitwahl.js', 'zeitwahl.js'),
    ('unterschrift.js', 'unterschrift.js'),
    ('testumgebung.js', 'testumgebung.js'),
]

for quelle_name, ziel_name in DATEIEN:
    quelle = Path(quelle_name)
    ziel = ZIEL_ORDNER / ziel_name
    inhalt = quelle.read_text(encoding='utf-8')
    if quelle_name == 'testumgebung.js':
        inhalt = inhalt.replace("'__APP_ENV__'", "'production'")
    ziel.write_text(inhalt, encoding='utf-8')
    print(f'{ziel} aus {quelle} erzeugt ({len(inhalt)} Zeichen).')

for ordner_name in ('icons', 'img'):
    quelle = Path(ordner_name)
    ziel = ZIEL_ORDNER / ordner_name
    shutil.rmtree(ziel, ignore_errors=True)
    shutil.copytree(quelle, ziel)
    anzahl = sum(1 for _ in ziel.rglob('*') if _.is_file())
    print(f'{ziel}/ aus {quelle}/ erzeugt ({anzahl} Dateien).')
