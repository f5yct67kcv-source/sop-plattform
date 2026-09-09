# Lasttest — Belastbarkeit bei 50 Kunden im Tagesbetrieb

Diese Werkzeuge messen, was das Werkzeug unter der Last eines Betriebs mit
**50 Kunden** aushält. Sie laufen gegen den **echten** Quelltext: echtes
Schema, echte Endpunkte, echte Abfragen — nicht gegen eine Nachbildung.

Sie gehören **nicht** zur Regression. `alle.mjs` findet nur `test_*.mjs`
direkt in `pruefungen/`; hier liegt nichts, was bei jedem Push mitläuft.
Ein Lasttest dauert Minuten und braucht eine eigene Datenbank — er wird
gefahren, wenn eine Frage nach der Belastbarkeit ansteht, nicht vor jedem
Commit.

**Der Befund des Laufs vom 09.09.2026 steht in [`BEFUND-2026-09-09.md`](BEFUND-2026-09-09.md).**

## Was gebraucht wird

- MariaDB oder MySQL, erreichbar auf `127.0.0.1`
- PHP 8 mit `pdo_mysql`
- Node 18+

Zugangsdaten kommen aus der Umgebung, mit Vorgaben für eine
Wegwerfdatenbank auf dem eigenen Rechner:

```
LAST_DB_NAME   (Vorgabe: lasttest)
LAST_DB_USER   (Vorgabe: lasttest)
LAST_DB_PASS   (Vorgabe: lasttest)
LAST_PORT      (Vorgabe: 8080)
LAST_ARBEITER  (Vorgabe: 16)   PHP-Arbeitsprozesse
LAST_PASSWORT  (Vorgabe: Lasttest-Kennwort)  Kennwort aller Testkonten
```

Die Datenmenge lässt sich ebenfalls über die Umgebung verstellen. Das ist
nicht Bequemlichkeit, sondern der Weg, um zu **messen**, wie die Kosten mit
der Betriebsgrösse wachsen, statt es zu behaupten — zweimal fahren, einmal
mit `LAST_KUNDEN=50`, einmal mit `LAST_KUNDEN=100`:

```
LAST_KUNDEN LAST_OBJEKTE LAST_MITARBEITER LAST_TAGE_ZURUECK LAST_TAGE_VORAUS
LAST_EINSAETZE_PRO_TAG LAST_KONTROLLPUNKTE LAST_POSITIONEN
LAST_FOTO_ANTEIL LAST_FOTO_BYTES LAST_SAAT
```

**Nie gegen Produktion oder Staging laufen lassen.** Der Aufbau löscht die
Datenbank, die er benutzt, und legt sie neu an.

## Ablauf

```bash
cd pruefungen/last

./aufbau.sh                  # Datenbank neu, Schema, Einrichtung, PHP-Server
php erzeuge_daten.php        # ein Jahr Betrieb mit 50 Kunden (dauert ~4 min)
./einzelmessung.sh           # was EIN Aufruf je Endpunkt kostet
./lauf.sh nachtspitze 25 2 5 # Lastlauf: 25 Wächter, 2 Cockpit, 5 Portal
```

`aufbau.sh` legt eine Arbeitskopie des Repositoriums unter `arbeitskopie/`
an und ersetzt dort die Platzhalter in `backend/db.php`. Das Repository
selbst bleibt unberührt — es kommen nie Zugangsdaten in eine versionierte
Datei.

## Was der Lastgenerator nachbildet

Drei Sorten Nutzer, mit den Takten, die die Oberflächen tatsächlich haben:

| Sorte | Was sie tut |
|---|---|
| **Wächter** (App) | Schichten und Mitteilungen beim Öffnen; danach im Rundgang alle **15 s** einen Standortpunkt (`RG_SPUR_SEKUNDEN` in `app.html` — dort zusätzlich an 10 m Bewegung geknüpft, hier im vollen Takt, weil ein Rundgang aus Gehen besteht), dazwischen gelegentlich Schichten/Mitteilungen |
| **Cockpit** (Desktop) | Kennzahlen, Einsatzliste, Objekte, Personal, Kunden, Rundgänge, Rapporte — mit Denkpause von 4–15 s zwischen den Seiten |
| **Portal** (Kunde) | Einsätze ansehen, dann Rundgänge, dann Pause |

Gemessen werden Antwortzeiten (p50/p95/p99/max), Fehlerquote, übertragene
Datenmenge je Endpunkt und nebenher die Zahl der offenen
Datenbankverbindungen.

## Die Datenmenge

`erzeuge_daten.php` erzeugt einen **vollen Jahrgang** — nicht eine
Handvoll Zeilen:

| | Menge |
|---|---|
| Kunden | 50 |
| Objekte | 130 |
| Mitarbeitende | 200 (180 aktiv) |
| Einsätze | ~44 000 (365 Tage zurück, 60 voraus) |
| Zuteilungen | ~53 000 |
| Rapporte | ~32 000 |
| Rundgänge | ~50 000 |
| Scans | ~600 000 (2 % mit Foto) |
| GPS-Punkte | ~6 000 000 |

Alle Daten sind durchnummerierte Platzhalter — keine echten Kunden-,
Objekt- oder Personennamen. Alle Datumsangaben werden zur Laufzeit relativ
zu heute gerechnet, es steht kein festes Datum in den Testdaten.

**Dauerzustand herstellen:** Die Spur wird nach 90 Tagen abgeräumt
(`RUNDGANG_SPUR_TAGE`). Wer messen will, wie sich das Werkzeug *im Betrieb*
verhält und nicht am ersten Tag nach der Einführung, räumt vor dem Lastlauf
einmal auf:

```sql
DELETE FROM rundgang_position WHERE erfasst_am < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

Das ist keine Kosmetik: Solange ein Rückstand da ist, findet das Aufräumen
sofort etwas und ist schnell. Erst wenn nichts mehr abzuräumen ist, zeigt
sich, was der Aufräumschritt wirklich kostet.

## Grenzen der Messung

- Gemessen wurde auf 4 Kernen mit 16 GB Arbeitsspeicher und einer
  Datenbank auf demselben Rechner. Ein Platz im geteilten Webhosting hat
  weniger davon und die Datenbank auf einem anderen Rechner. **Die Zahlen
  sind Bestwerte, keine Erwartungswerte.**
- Der PHP-Entwicklungsserver ersetzt Apache. Er sagt nichts über
  Prozessgrenzen, Kompression oder Zwischenspeicher des echten Servers.
- Der Generator misst das Backend. Wie lange der Browser braucht, um eine
  5-MB-Antwort zu zeichnen, steht auf einem anderen Blatt.
