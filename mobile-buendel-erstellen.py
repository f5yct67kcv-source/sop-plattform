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
"""
from pathlib import Path
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
    ziel.write_text(inhalt, encoding='utf-8')
    print(f'{ziel} aus {quelle} erzeugt ({len(inhalt)} Zeichen).')
