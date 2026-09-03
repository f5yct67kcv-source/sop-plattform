# sop-plattform — Betriebswerkzeug der CUPI 24 GmbH

Internes Werkzeug der CUPI 24 GmbH: Einsatzplanung, Personalstamm,
Kundenstamm, Abgleich der Ist-Zeiten und Stundenerfassung.

Der frühere Name `Rapport_Cupi24` beschrieb nur den ersten Teil — die
Stundenerfassung. Umbenannt am 22.08.2026 (ENT-078).
Entwickelt unter der Ausnahme aus ENT-008/ENT-012 (rein interne Nutzung,
kein Verkauf) — siehe Entscheidungsprotokoll im Projekt-Repository.

## Adressen

| | Adresse | Für wen |
|---|---|---|
| Erfassung | https://rapport.itufeden.myhostpoint.ch | alle Mitarbeitenden, mobil |
| Dashboard | https://rapport.itufeden.myhostpoint.ch/dashboard.html | nur Admin, Desktop |

Beide Seiten teilen sich Anmeldung und Backend — wer angemeldet ist, bleibt es
beim Wechsel. Nicht-Admins werden vom Dashboard abgewiesen.

## Aufbau

```
index.html         Erfassung (mobil, PWA-installierbar)
dashboard.html     Verwaltungsoberflaeche (Desktop, admin-only)
manifest.json      PWA-Manifest
sw.js              Service Worker (nur fuer die Installierbarkeit)
icons/             App-Symbole

backend/
  db.php              PDO-Verbindung + require_session()
  ai.php              Anthropic-Anbindung (Diktat, Kundenrecherche, Planung)
  schema.sql          Grundschema, einmalig in phpMyAdmin ausfuehren
  schema_planung.sql  Nachtrag fuer die Einsatzplanung, ebenfalls einmalig
  api/*.php           Endpunkte, alle ueber X-Auth-Token abgesichert
```

## Einmaliger Schritt nach dem Deploy der Planung

`backend/schema_planung.sql` muss einmal im Hostpoint-Datenbank-Tool
(phpMyAdmin) ausgefuehrt werden — der Deploy legt keine Tabellen an. Solange
das nicht geschehen ist, zeigt der Bereich „Planung" einen entsprechenden
Hinweis; alle uebrigen Bereiche arbeiten unveraendert weiter.

**Die Datei enthaelt zwei Teile — genau einen davon ausfuehren:**

- **Teil A**, wenn `schema_planung.sql` noch nie gelaufen ist: der ganze
  obere Block (objekte, masterschichten, feiertage, einsaetze,
  einsatz_zuteilung).
- **Teil B**, wenn die erste Fassung vom 17.08. bereits lief (also
  `einsaetze` und `einsatz_zuteilung` schon bestehen): die drei neuen
  Tabellen anlegen und danach die auskommentierten ALTER-Befehle am Dateiende
  ausfuehren.

Danach im Dashboard unter **Planung → Übersicht → Feiertage** einmal pro Jahr
„Jahr eintragen" druecken. Der Kalender ist Kanton Solothurn, Quelle steht in
der Liste. Er markiert Tage — ueber Zuschlaege oder Entschaedigung sagt er
ausdruecklich nichts aus (siehe GAV-AUS-003 und GAV-AUS-006 im
Projekt-Repository).

Der Produktname des Dashboards steht noch nicht fest (Arbeitstitel „Cockpit",
siehe OP-18). Er haengt an der Konstante `APP_NAME` am Anfang des Skriptblocks
in `dashboard.html` — eine Zeile aendern genuegt.

## Deploy

Jeder Push auf `main` **oder** `staging` loest denselben Workflow
`.github/workflows/deploy-hostpoint.yml` aus (ENT-341): Platzhalter
(`__DB_HOST__`, `__ANTHROPIC_API_KEY__` usw.) werden aus GitHub Secrets
ersetzt, danach FTPS-Upload zu Hostpoint. `main` deployt nach Produktion,
`staging` nach der getrennten Testinstanz — **derselbe Workflow, dieselbe
Dateiliste**, nur das GitHub Environment (`production`/`staging`, siehe
`Settings → Environments`) und damit die Werte hinter den Secret-Namen
unterscheiden sich. Siehe „Staging" weiter unten.

**Im Quellcode stehen nie echte Zugangsdaten** — nur Platzhalter. Wer die Dateien
lokal oeffnet, sieht keine Geheimnisse.

`setup.php`/`setup.html` werden bewusst **nicht** mit ausgeliefert: die
Ersteinrichtung war ein einmaliger manueller Upload und ist erledigt (OP-17).

## Zugangsdaten — welche es gibt und woher sie kommen

**Hier stehen keine Werte, nur die Liste.** Die Werte selbst gehoeren in einen
Passwortmanager. In GitHub sind sie hinterlegt unter
`Settings → Secrets and variables → Actions` und lassen sich dort **nicht mehr
auslesen** — das ist kein Mangel, sondern der Sinn eines Secrets.

| Name in GitHub | Wofuer | Woher der Wert kommt |
|---|---|---|
| `DB_HOST` | Datenbankserver | Hostpoint-Kundencenter → Datenbanken |
| `DB_NAME` | Name der Datenbank | Hostpoint-Kundencenter → Datenbanken |
| `DB_USER` | Datenbankbenutzer | Hostpoint-Kundencenter → Datenbanken |
| `DB_PASSWORD` | Passwort dazu | Hostpoint-Kundencenter; bei Verlust dort neu setzen |
| `ANTHROPIC_API_KEY` | Diktat, Kundenrecherche, Planungsvorschlaege | console.anthropic.com; bei Verlust neu erzeugen, der alte laesst sich nicht anzeigen |
| `HOSTPOINT_FTP_HOST` | Ziel des Deploys | Hostpoint-Kundencenter → FTP |
| `HOSTPOINT_FTP_USER` | FTP-Benutzer | Hostpoint-Kundencenter → FTP |
| `HOSTPOINT_FTP_PASSWORD` | Passwort dazu | Hostpoint-Kundencenter → FTP |
| `SMTP_HOST` | Mailserver fuer den Offert-Versand (ENT-192) | Hostpoint-Kundencenter → E-Mail → SMTP-Einstellungen der Domain |
| `SMTP_PORT` | Port dazu (meist 587 mit `tls`, oder 465 mit `ssl`) | dieselbe Stelle |
| `SMTP_VERSCHLUESSELUNG` | `tls`, `ssl` oder leer | dieselbe Stelle, je nach Port |
| `SMTP_USER` | Postfach-Login | Hostpoint-Kundencenter → E-Mail |
| `SMTP_PASSWORD` | Passwort dazu | Hostpoint-Kundencenter → E-Mail; bei Verlust dort neu setzen |
| `SMTP_ABSENDER` | Absenderadresse der Offert-Mails (muss zum Postfach passen) | dieselbe Stelle |
| `SMTP_ABSENDER_NAME` | Angezeigter Absendername (optional, sonst nur die Adresse) | frei waehlbar |
| `MAPS_JS_KEY` | Google-Maps-Browserschluessel fuer Kontrollpunkt-Karte, Geofence-Auswahl, Objektplan | console.cloud.google.com — je Umgebung ein **eigener** Schluessel (ENT-341), referrer-beschraenkt auf genau die eine Domain |
| `STAGING_TESTMAIL` | Nur im Environment `staging` gesetzt: Zieladresse, auf die **jede** ausgehende Mail umgeleitet wird (ENT-341) | frei waehlbar, sollte kein produktives Postfach sein |

Fehlen die SMTP-Secrets, meldet „Per E-Mail versenden" im Dashboard „noch
nicht eingerichtet" — es wird nie versucht, mit einem Platzhalter als Hostnamen
zu verbinden. Fehlt `STAGING_TESTMAIL` im Environment `staging`, bricht der
Versand dort mit einer eigenen Fehlermeldung ab, statt irgendwohin zu senden.

Alle Secrets bis auf `STAGING_TESTMAIL` existieren in **beiden** Environments
(`production` und `staging`), aber mit **unterschiedlichen Werten** — siehe
„Staging" weiter unten. Zwei Namen sind besonders leicht zu verwechseln:
`DB_*`/`HOSTPOINT_FTP_*` je aus dem **jeweils eigenen** Hostpoint-Account, nie
aus dem anderen kopiert.

**Wenn ein Wert je an eine falsche Stelle geraten ist** — in einen Commit, einen
Chat, ein Bildschirmfoto: **neu erzeugen, nicht loeschen.** Loeschen hilft nicht,
der alte Wert bleibt in der Git-Historie und in Zwischenspeichern stehen.

## Staging (ENT-341)

Eine vollstaendig getrennte Testinstanz — dieselbe Codebasis, eigene
Datenbank, eigenes FTP-Ziel, eigene Secrets, keine echten Geschaeftsdaten.
Adresse und genaue Hostpoint-Einrichtung stehen im Entscheidungsprotokoll
des Projekt-Repositories (ENT-341); hier nur, was den Code betrifft:

- **Branch `staging`** loest denselben Deploy-Workflow aus wie `main`, mit
  dem GitHub Environment `staging` statt `production` (siehe oben).
- **`ist_produktion()`** in `backend/db.php` erkennt die Produktionsdomain
  am Hostnamen (`PRODUKTIONS_DOMAIN`-Konstante) — jeder andere Hostname
  gilt als „nicht Produktion". Dieselbe Unterscheidung trifft
  `testumgebung.js` client-seitig fuer das sichtbare
  „TESTUMGEBUNG"-Kennzeichen (kleiner Hinweis unten rechts, ueberlagert
  nichts).
- **E-Mail-Versand** ausserhalb der Produktion geht ausschliesslich an die
  in `STAGING_TESTMAIL` konfigurierte Adresse — `backend/mailer.php`,
  Funktion `smtp_ziel()`. Der urspruenglich eingegebene Empfaenger bleibt
  im Betreff sichtbar.
- **Einrichtung einer neuen/leeren Staging-Datenbank:** `backend/schema.sql`
  einmalig in phpMyAdmin ausfuehren, danach `setup.php`/`setup.html`
  temporaer hochladen und den ersten Admin-Account anlegen (**danach
  sofort wieder loeschen**, siehe oben), danach im Dashboard unter
  „Betrieb → Einrichtung" den bestehenden, idempotenten
  `planung_einrichten.php`-Endpunkt ausfuehren. Kein eigenes
  Migrations-Werkzeug noetig — dieser Ablauf existiert bereits fuer
  Produktion und funktioniert unveraendert fuer Staging.
- **Zuruecksetzen** einer Staging-Datenbank ist bewusst manuell (siehe
  ENT-341, Punkt 6): Datenbank in phpMyAdmin leeren, obigen Ablauf
  wiederholen. Es gibt keinen automatischen Reset-Endpunkt.

### Lokal testen

Wer auf dem eigenen Rechner gegen die echte Datenbank oder die Anthropic-API
testen will, braucht die Werte lokal. Dafuer ist in `.gitignore` der Dateiname
`secrets.local.php` reserviert — Git nimmt ihn nie mit. Die Datei existiert
noch nicht und `db.php` liest sie heute auch nicht; das waere eine eigene,
bewusst zu entscheidende Aenderung.

### Ein bekanntes Restrisiko

Der Anthropic-Schluessel steht nach dem Deploy im Klartext in `ai.php` auf dem
Server. Solange PHP laeuft, sieht ihn niemand — der Server fuehrt die Datei aus
und liefert nur das Ergebnis. Faellt PHP aus, liefern Webserver den Quelltext
mitunter unveraendert aus, und dann stuende der Schluessel im Browser. Das ist
unwahrscheinlich, aber es ist kein theoretischer Fall. Festgehalten, damit es
eine bewusste Inkaufnahme bleibt und keine Ueberraschung.

## Skizzenmodus

Der Skizzenmodus legt eine Notizebene über die laufende Seite. Gedacht, um visuell
festzuhalten, was sich ändern soll, statt es in Prosa zu beschreiben.

Einschalten mit `Alt+S`, oder `?skizze=1` an die URL hängen. `Esc` beendet.
Werkzeuge über die Zahlen `1` bis `9`, `Cmd+Z` nimmt den letzten Schritt zurück.

Mehrere Elemente auf einmal: `Shift`+Klick nimmt eines dazu oder raus, `G` wählt
alle Geschwister im selben Container, `H` alles, was optisch auf derselben
waagrechten Linie sitzt — auch über Container hinweg, aber nur ähnlich hohe
Elemente. Die Änderung wirkt dann auf alle gleichzeitig und steht als ein
Eintrag im Protokoll. Gilt für Verschieben, Abstand, Grösse, Farbe, Ausblenden
und Duplizieren.

Beim Ziehen erscheinen Ausrichtungshilfen: sobald eine Kante oder Mitte mit
einem anderen Element fluchtet, zeigt eine Linie das an und das Element rastet
ein. `Alt` beim Ziehen hält das Einrasten an.

Auswählen zeigt Selektor und Masse. Verschieben, Abstand, Grösse, Schrift und
Reihenfolge arbeiten mit den Pfeiltasten, `Shift` macht grössere Schritte, `Alt`
schaltet beim Abstand von innen auf aussen. Der Innenabstand wirkt symmetrisch
und nie negativ, der Aussenabstand gerichtet — der Pfeil zeigt, wohin das
Element soll — und darf ins Minus gehen, damit sich auch ein Block nach oben
ziehen lässt, der oben keinen eigenen Abstand hat. Beim Schrift-Werkzeug ändern `↑` und
`↓` die Schriftgrösse, `←` und `→` die Schriftstärke. Dazu Text ändern,
Duplizieren, Ausblenden, Farbe, Messen, freie Platzhalter-Rechtecke für noch
nicht existierende Elemente und Notizen an einzelnen Elementen.

Haben mehrere gewählte Elemente verschiedene Ausgangswerte, steht im Protokoll
die Spanne (`11–15px → 13–17px`) statt eines Werts, den keines von ihnen hat.

Jede Handlung landet im Protokoll mit Selektor, Alt-Neu-Wert und dem Rahmen, in
dem das Element danach steht. Der Zielrahmen ist wichtig, weil ein Verschieben
per `transform` im Layout keinen Platz kostet, das gebaute Ergebnis aber schon:
ohne ihn ist nicht zu erkennen, ob etwas in dieselbe Zeile gehört oder in eine
neue. Dazu wird die Fenstergrösse festgehalten. `Kopieren` legt
das Protokoll als Text und JSON in die Zwischenablage, `Datei` speichert es als
JSON. Nichts davon wird gespeichert: Neuladen setzt die Seite zurück.

Der Code steht **inline in `dashboard.html`**, nicht als eigene Datei. Der
Deploy-Workflow kopiert nur namentlich gelistete Dateien, und das Ändern des
Workflows braucht das Recht `workflow`, das der GitHub-Login hier nicht hat.
`skizze.js` liegt als lesbare Quelle daneben und wird nicht ausgeliefert.
Wer am Skizzenmodus etwas ändert, bearbeitet `skizze.js` und gleicht dann ab:

```bash
python3 skizze-einbetten.py
```
