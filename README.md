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
`Settings → Environments → production` bzw. `→ staging` und lassen sich dort
**nicht mehr auslesen** — das ist kein Mangel, sondern der Sinn eines Secrets.

**Wichtig seit der Verschaerfung von ENT-341: Production- und
Staging-Secrets tragen unterschiedliche NAMEN**, nicht nur unterschiedliche
Werte im jeweiligen Environment. Ein Secret-Name, den es nur bei Production
gibt, hat bei Staging keinen gleichnamigen Rueckgriff — fehlt ein
Staging-Secret, bricht der Deploy mit einer klaren Fehlermeldung ab, statt
still auf den produktiven Wert zurueckzufallen (siehe „Staging" weiter
unten).

| Production-Secret | Staging-Secret | Wofuer | Woher der Wert kommt |
|---|---|---|---|
| `DB_HOST` | `STAGING_DB_HOST` | Datenbankserver | Hostpoint-Kundencenter → Datenbanken, je aus dem **eigenen** Account |
| `DB_NAME` | `STAGING_DB_NAME` | Name der Datenbank | dieselbe Stelle |
| `DB_USER` | `STAGING_DB_USER` | Datenbankbenutzer | dieselbe Stelle |
| `DB_PASSWORD` | `STAGING_DB_PASSWORD` | Passwort dazu | dieselbe Stelle; bei Verlust dort neu setzen |
| `HOSTPOINT_FTP_HOST` | `STAGING_HOSTPOINT_FTP_HOST` | Ziel des Deploys | Hostpoint-Kundencenter → FTP, je der **eigene** Account |
| `HOSTPOINT_FTP_USER` | `STAGING_HOSTPOINT_FTP_USER` | FTP-Benutzer | dieselbe Stelle |
| `HOSTPOINT_FTP_PASSWORD` | `STAGING_HOSTPOINT_FTP_PASSWORD` | Passwort dazu | dieselbe Stelle |
| `MAPS_JS_KEY` | `STAGING_MAPS_JS_KEY` | Google-Maps-Browserschluessel (Kontrollpunkt-Karte, Geofence-Auswahl, Objektplan) | console.cloud.google.com — je Umgebung ein **eigener** Schluessel, referrer-beschraenkt auf genau die eine Domain |
| `ANTHROPIC_API_KEY` | `STAGING_ANTHROPIC_API_KEY` | Diktat, Kundenrecherche, Planungsvorschlaege | console.anthropic.com; bei Verlust neu erzeugen, der alte laesst sich nicht anzeigen |
| `SMTP_HOST` | `STAGING_SMTP_HOST` | Mailserver fuer den Offert-Versand (ENT-192) | Hostpoint-Kundencenter → E-Mail → SMTP-Einstellungen — **dasselbe** Postfach wie Production (ENT-367: kein zweites kostenloses Postfach ohne eigene Domain verfuegbar), Werte identisch mit `SMTP_*` |
| `SMTP_PORT` | `STAGING_SMTP_PORT` | Port dazu (meist 587 mit `tls`, oder 465 mit `ssl`) | dieselbe Stelle |
| `SMTP_VERSCHLUESSELUNG` | `STAGING_SMTP_VERSCHLUESSELUNG` | `tls`, `ssl` oder leer | dieselbe Stelle, je nach Port |
| `SMTP_USER` | `STAGING_SMTP_USER` | Postfach-Login | dieselbe Stelle |
| `SMTP_PASSWORD` | `STAGING_SMTP_PASSWORD` | Passwort dazu | dieselbe Stelle; bei Verlust dort neu setzen |
| `SMTP_ABSENDER` | `STAGING_SMTP_ABSENDER` | Absenderadresse (muss zum jeweiligen Postfach passen) | dieselbe Stelle |
| `SMTP_ABSENDER_NAME` | `STAGING_SMTP_ABSENDER_NAME` | Angezeigter Absendername (optional) | frei waehlbar |
| — | `STAGING_TESTMAIL` | Zieladresse, auf die **jede** aus Staging versendete Mail umgeleitet wird | frei waehlbar, kein produktives Postfach |

**Erforderlich, sonst bricht der Deploy ab** (siehe Workflow-Schritt „Umgebung
waehlen und erforderliche Secrets pruefen"): `DB_*`, `HOSTPOINT_FTP_*` und
`MAPS_JS_KEY` — jeweils production- oder staging-seitig, je nach Branch —
sowie bei Staging zusaetzlich `STAGING_TESTMAIL`. **Optional, mit
eingebauter Ersatzmeldung statt Absturz:** `SMTP_*` (meldet „noch nicht
eingerichtet") und `ANTHROPIC_API_KEY` (KI-Funktionen liefern dann nichts,
statt zu scheitern) — dieselbe Regel gilt fuer die `STAGING_`-Varianten.

**Wenn ein Wert je an eine falsche Stelle geraten ist** — in einen Commit, einen
Chat, ein Bildschirmfoto: **neu erzeugen, nicht loeschen.** Loeschen hilft nicht,
der alte Wert bleibt in der Git-Historie und in Zwischenspeichern stehen.

## Staging (ENT-341)

Eine vollstaendig getrennte Testinstanz — dieselbe Codebasis, eigene
Datenbank, eigenes FTP-Ziel, eigene Secrets unter eigenen Namen, keine
echten Geschaeftsdaten. Beim SMTP-Versand teilt sich Staging das Postfach
mit Production (ENT-367) — die Secret-*Namen* bleiben trotzdem eigene
(`STAGING_SMTP_*`), nur die *Werte* sind vorerst identisch; die zwingende
Empfaenger-Umleitung unten macht das unkritisch. Adresse und genaue
Hostpoint-Einrichtung stehen im Entscheidungsprotokoll des
Projekt-Repositories (ENT-341); hier nur, was den Code betrifft:

- **Branch `staging`** loest denselben Deploy-Workflow aus wie `main`, mit
  dem GitHub Environment `staging` statt `production` (siehe oben).
- **Kein Rueckfall auf Production-Secrets:** Staging-Secrets tragen eigene
  Namen (`STAGING_DB_HOST` statt `DB_HOST` usw., siehe Tabelle oben). Der
  erste Schritt des Workflows loest fuer die aktive Umgebung den richtigen
  Satz auf und **bricht den Lauf ab**, wenn eines der erforderlichen fehlt
  — bevor irgendetwas kopiert oder hochgeladen wird.
- **`APP_ENV`** ist eine explizite, beim Deploy gesetzte Umgebungskennung
  (`production` oder `staging`) — **nicht** aus dem Hostnamen abgeleitet.
  `ist_produktion()`/`umgebung_ist_produktion()` in `backend/db.php` sind
  fail-safe: nur der exakte Wert `production` gilt als Produktion, jeder
  andere Wert (leer, unersetzt, ein Tippfehler) als Staging. Dieselbe
  Konstante und dieselbe Regel traegt `testumgebung.js` client-seitig fuer
  das sichtbare „TESTUMGEBUNG"-Kennzeichen (kleiner Hinweis unten rechts,
  ueberlagert nichts).
- **E-Mail-Versand** ausserhalb der Produktion geht ausschliesslich an die
  in `STAGING_TESTMAIL` konfigurierte Adresse — `backend/mailer.php`,
  Funktion `smtp_ziel()` — **unabhaengig davon**, ueber welches Postfach
  (`STAGING_SMTP_*`, seit ENT-367 mit denselben Werten wie `SMTP_*`) sie
  tatsaechlich verschickt wird. Der urspruenglich eingegebene Empfaenger
  bleibt im Betreff sichtbar.
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
