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
| Kundenportal | https://rapport.itufeden.myhostpoint.ch/portal.html | Kunden, Handy und Desktop |
| Homepage | https://rapport.itufeden.myhostpoint.ch/homepage.html | öffentlich, Interessenten |
| Betreiber-Bereich | https://rapport.itufeden.myhostpoint.ch/betreiber.html | nur der Plattform-Betreiber, Desktop |

Erfassung und Dashboard teilen sich Anmeldung und Backend — wer angemeldet ist,
bleibt es beim Wechsel. Nicht-Admins werden vom Dashboard abgewiesen.

Das **Kundenportal** steht bewusst daneben und nicht dazwischen (ENT-441): Es hat
eigene Tabellen, eine eigene Anmeldung und eine eigene Sitzungsprüfung. Ein
Kundenzugang ist keine Zeile in `mitarbeiter` und erreicht darum keinen einzigen
Verwaltungsendpunkt — `require_session()` findet ihn schlicht nicht. Angelegt
werden die Zugänge im Cockpit unter **Administration → Kundenzugänge**.

Die **Homepage** (ENT-469) ist die öffentliche Verkaufsseite. Sie lädt
keinen Produktcode; ihre einzige Verbindung zum Server ist das
Demo-Formular (`backend/api/demo_anfrage.php`), das eine E-Mail an die
Adresse des Betriebs schickt — Cockpit → Administration → Einstellungen →
Betrieb. Fehlt die Adresse oder der SMTP-Zugang, sagt die Seite das beim
Absenden. Produktname („Wachtwerk") und Logo sind Platzhalter (OP-18);
Impressum, Datenschutz und AGB sind noch leere Verweise. Entwurf,
Gestaltungsentscheide und Faktenbasis der Werbeaussagen: Projekt-Repository,
`02-gate2-produkt-mvp/homepage-entwurf.md`.

Der **Betreiber-Bereich** (ENT-519) steht noch einmal daneben und gehört nicht
diesem Betrieb, sondern dem Betreiber der Plattform. Eigene Tabellen (`betreiber`,
`betreiber_sessions`), eigene Anmeldung, eigener Wächter `require_betreiber()` —
und als einziger der drei Wege ein **zwingender zweiter Faktor**, serverseitig
durchgesetzt (`require_betreiber_voll()`). Vom Cockpit führt bewusst kein Link
dorthin; die Adresse wird direkt aufgerufen. Zwei Dinge liegen trotzdem im
Cockpit, beide mit Absicht: das **erste Betreiber-Konto** (Einrichtung — solange
kein Mandant eingetragen ist, siehe ENT-528/ENT-529) und die
**Support-Freigabe** (Administration), die in der Datenbank des Mandanten lebt,
damit der Betreiber sie sich nicht selbst erteilen kann (ENT-526). Inbetriebnahme
Schritt für Schritt: Abschnitt „Betreiber-Bereich in Betrieb nehmen“ weiter unten.

## Aufbau

```
index.html         Erfassung (mobil, PWA-installierbar)
homepage.html      Oeffentliche Homepage (ENT-469), ohne Produktcode
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

> **Einmalig beim naechsten Deploy (ENT-501): Alle muessen sich neu
> anmelden.** Sitzungs-Token stehen seither nur noch als SHA-256-Abdruck in
> der Datenbank statt im Klartext — wer je Lesezugriff darauf bekam (eine
> Sicherungskopie, ein phpMyAdmin-Zugang), konnte damit vorher jede offene
> Sitzung uebernehmen, ohne Passwort und ohne zweiten Faktor. Die
> bestehenden Eintraege passen danach nicht mehr; betroffen sind
> Mitarbeitende **und** Kundenzugaenge. Ein Uebergang, der beides annimmt,
> haette den Klartext noch bis zu 30 Tage stehen lassen — also genau das
> Problem behalten. Nichts geht dabei verloren, es ist eine Neuanmeldung.

Jeder Push auf `main` loest den Workflow
`.github/workflows/deploy-hostpoint.yml` aus (ENT-341) und deployt nach
Produktion: Platzhalter (`__DB_HOST__`, `__ANTHROPIC_API_KEY__` usw.)
werden aus GitHub Secrets ersetzt, danach FTPS-Upload zu Hostpoint.
Ein Deploy nach Staging läuft über **denselben Workflow, dieselbe
Dateiliste**, aber ausschliesslich manuell gegen einen `qa-*`-Tag statt
per Push — kein dauerhafter Branch `staging` mehr (ENT-372, revidiert
ENT-341 Punkt 5). Welches GitHub Environment (`production`/`staging`,
siehe `Settings → Environments`) greift und damit welche Werte hinter den
Secret-Namen stehen, entscheidet in beiden Fällen der Ref (Branch `main`
oder `qa-*`-Tag). Siehe „Staging" weiter unten.

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
| — | `STAGING_BASIC_AUTH_USER` | Benutzername fuer den authentifizierten Suchmaschinenausschluss-Nachweis (ENT-387) | Hostpoint-Passwortschutz (Explorer → www/staging → Web-Einstellungen → Passwortschutz), eigener technischer Benutzer `qa-probe`, nicht der persoenliche Zugang |
| — | `STAGING_BASIC_AUTH_PASSWORD` | Passwort dazu | dieselbe Stelle; eigenes starkes Zufallspasswort |
| `VAPID_PRIVATE_PEM_B64` | `STAGING_VAPID_PRIVATE_PEM_B64` | Signierschluessel fuer Push-Benachrichtigungen (ENT-424) | selbst erzeugen, siehe unten — je Umgebung ein **eigener**, sonst klingeln Testversande auf den echten Telefonen |
| `VAPID_KONTAKT` | `STAGING_VAPID_KONTAKT` | Absenderkontakt im Push-JWT, `mailto:…` oder `https://…` (RFC 8292 verlangt ihn) | frei waehlbar, muss erreichbar sein |
| `PUSH_CRON_SCHLUESSEL` | `STAGING_PUSH_CRON_SCHLUESSEL` | Schluessel, mit dem der Hostpoint-Zeitgeber den Nachzuegler-Versand aufruft | selbst erzeugen: `openssl rand -hex 24` |

### Environment-Variablen (keine Secrets)

Zwei Werte sind **nicht** vertraulich und stehen darum als
Environment-Variable statt als Secret (`Settings → Environments → …
→ Variables`):

| Variable | Umgebung | Wofuer |
|---|---|---|
| `STAGING_DOMAIN` | staging | Adresse, unter der die Verifikationsschritte die Staging-Seite abrufen (ENT-384/ENT-387) |
| `APP_BASIS_URL` | production (optional) | Adresse der Anlage, aus der jeder per E-Mail verschickte Link gebaut wird (ENT-501) |

**Zu `APP_BASIS_URL` (ENT-501):** Bis dahin kam diese Adresse aus dem
`Host`-Kopf der Anfrage — und der laesst sich frei setzen. Wer die
unangemeldeten Endpunkte (`passwort_vergessen.php`,
`portal_link_anfordern.php`) mit einem fremden `Host`-Kopf aufrief, liess
den Server einen Ruecksetz-Link auf die eigene Adresse verschicken. Jetzt
traegt der Deploy die Adresse ein.

- **Production:** Ist die Variable nicht gesetzt, gilt die heutige Adresse
  als Vorgabe — es ist also nichts zu tun. Setzen muss man sie erst, wenn
  die Anlage einmal unter einer anderen Adresse laeuft.
- **Staging:** Kommt aus `STAGING_DOMAIN`. **Kein Rueckfall auf
  Production** — ein Staging-Link, der in die echte Anlage zeigt, waere
  genau der Fehler, den die alte Loesung vermeiden wollte. Fehlt
  `STAGING_DOMAIN`, verschicken die betroffenen Endpunkte dort **keinen**
  Link (und sagen das im Serverprotokoll), statt einen falschen.

**Erforderlich, sonst bricht der Deploy ab** (siehe Workflow-Schritt „Umgebung
waehlen und erforderliche Secrets pruefen"): `DB_*`, `HOSTPOINT_FTP_*` und
`MAPS_JS_KEY` — jeweils production- oder staging-seitig, je nachdem, ob
gegen `main` oder einen `qa-*`-Tag deployt wird —
sowie bei Staging zusaetzlich `STAGING_TESTMAIL`. **Optional, mit
eingebauter Ersatzmeldung statt Absturz:** `SMTP_*` (meldet „noch nicht
eingerichtet") und `ANTHROPIC_API_KEY` (KI-Funktionen liefern dann nichts,
statt zu scheitern) sowie `VAPID_*` und `PUSH_CRON_SCHLUESSEL` (Push meldet
„noch nicht eingerichtet") — dieselbe Regel gilt fuer die
`STAGING_`-Varianten.

### Push-Benachrichtigungen einrichten (ENT-424)

Drei Schritte, einmalig je Umgebung. Ohne sie laeuft alles Uebrige normal
weiter — die App meldet dann ausdruecklich „auf dem Server noch nicht
eingerichtet", statt so zu tun, als sei Push eingeschaltet.

**1. Schluesselpaar erzeugen** (auf dem eigenen Rechner, nicht auf dem
Server):

```
openssl ecparam -genkey -name prime256v1 -noout -out vapid.pem
base64 -w0 vapid.pem            # macOS: base64 -i vapid.pem
```

Die ausgegebene, **einzeilige** Zeichenkette ist der Wert fuer
`VAPID_PRIVATE_PEM_B64`. Einzeilig ist Pflicht: Die Ersetzung im Deploy ist
ein `sed`-Aufruf und vertraegt keine Zeilenumbrueche. `vapid.pem` danach in
den Passwortmanager legen und die Datei loeschen — sie gehoert nicht ins
Repository. Der **oeffentliche** Schluessel wird daraus abgeleitet und ist
kein eigenes Secret.

**2. `VAPID_KONTAKT` setzen**, z. B. `mailto:it@…`. Fehlt er, gilt Push als
nicht eingerichtet — mehrere Push-Dienste weisen ein JWT ohne `sub` ab.

**3. Zeitgeber einrichten** (Hostpoint-Kundencenter → Cronjobs), damit
vorbereitete Mitteilungen zum gesetzten Zeitpunkt klingeln:

```
*/15 * * * *  curl -s "https://<domain>/api/push_versand.php?schluessel=<PUSH_CRON_SCHLUESSEL>"
```

Ohne Zeitgeber geht nichts verloren: Eine sofort veroeffentlichte Mitteilung
klingelt weiterhin direkt beim Speichern, und eine vorbereitete wird
nachgeholt, sobald jemand im Cockpit die Mitteilungsseite oeffnet. Der
Zeitgeber ist der verlaessliche Weg, das Uebrige der Rueckfall.

**Was Push nicht kann:** Auf dem iPhone gibt es Web Push ausschliesslich fuer
Web-Apps, die ueber „Teilen → Zum Home-Bildschirm" installiert sind — im
Safari-Tab nicht, unabhaengig von jeder Erlaubnis. Android kann es auch im
Browser. Die App sagt das je Geraet ausdruecklich und zeigt auf dem iPhone
die noetigen Schritte.

**Wenn ein Wert je an eine falsche Stelle geraten ist** — in einen Commit, einen
Chat, ein Bildschirmfoto: **neu erzeugen, nicht loeschen.** Loeschen hilft nicht,
der alte Wert bleibt in der Git-Historie und in Zwischenspeichern stehen.

## Staging (ENT-341, Deploy-Mechanismus revidiert durch ENT-372)

Eine vollstaendig getrennte Testinstanz — dieselbe Codebasis, eigene
Datenbank, eigenes FTP-Ziel, eigene Secrets unter eigenen Namen, keine
echten Geschaeftsdaten. Beim SMTP-Versand teilt sich Staging das Postfach
mit Production, als bewusst begrenzte, mit sieben Bedingungen versehene
Ausnahme (ENT-367/ENT-371) — die Secret-*Namen* bleiben trotzdem eigene
(`STAGING_SMTP_*`), nur die *Werte* sind vorerst identisch; die zwingende
Empfaenger-Umleitung unten macht das unkritisch. Adresse und genaue
Hostpoint-Einrichtung stehen im Entscheidungsprotokoll des
Projekt-Repositories (ENT-341); hier nur, was den Code betrifft:

- **Kein dauerhafter Branch `staging`.** Ein Push auf `main` loest
  ausschliesslich den Production-Deploy aus. Ein Staging-Deploy entsteht
  **ausschliesslich manuell** ("Run workflow" in GitHub Actions) gegen
  einen **Git-Tag** der Form `qa-JJJJ-MM-TT-NNN` (z. B. `qa-2026-09-04-001`),
  der exakt auf einem bestehenden `main`-Commit liegt — nie gegen einen
  Branch. Grund (ENT-372): `main` bleibt alleinige Source of Truth, es darf
  keinen Staging-spezifischen Code geben, der spaeter zurueckgemergt werden
  muesste. Ein Tag ist dafuer die richtige Wahl, weil sich git-technisch
  kein Commit "auf" einen Tag pushen laesst — anders als bei einem Branch
  ist das kein Konventions-, sondern ein struktureller Schutz. Das
  GitHub-Environment `staging` ist zusaetzlich ueber "Deployment branches
  and tags" auf das Muster `qa-*` beschraenkt; der Workflow selbst bricht
  ausserdem ab, wenn ein Staging-Lauf gegen einen Ref ohne dieses Muster
  ausgeloest wird.
  ```
  git tag qa-2026-09-04-001 <main-commit>
  git push origin qa-2026-09-04-001
  # danach in GitHub Actions: "Run workflow" -> Use workflow from: dieser Tag
  ```
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
  bleibt im Betreff sichtbar, und der Absendername traegt ausserhalb der
  Produktion automatisch das Praefix `[STAGING]` (`smtp_absender_name()`,
  ENT-371 Bedingung 4) — unabhaengig davon, was im Secret
  `STAGING_SMTP_ABSENDER_NAME` konfiguriert ist.
- **HTTP-Basic-Auth vor der gesamten Staging-Instanz (ENT-384):** verwaltet
  bei Hostpoint selbst, ueber „Explorer → www/staging → Web-Einstellungen
  fuer aktuelles Verzeichnis → Passwortschutz". Die dortige `.htaccess`
  traegt oberhalb der Markierung `#@__HCP_END__@#` den von Hostpoint
  verwalteten Auth-Block, darunter von Hand eine Kopie von
  `htaccess-hostpoint`. Der Deploy-Workflow **schliesst `.htaccess` fuer
  Staging von Upload und Loeschung aus** (`exclude` bei der FTP-Deploy-
  Action) — sonst wuerde jeder Deploy den Passwortschutz stillschweigend
  entfernen. Ein **Drift-Guard** vergleicht bei jedem Staging-Deploy den
  aktuellen Hash von `htaccess-hostpoint` mit dem in
  `staging-htaccess.synced-sha256` festgehaltenen Stand der letzten
  manuellen Synchronisierung — weichen sie ab, bricht der Deploy ab, statt
  Staging mit veralteten eigenen Regeln weiterlaufen zu lassen (Schritt
  „Umgebung waehlen und erforderliche Secrets pruefen"). Nach jedem
  Staging-Deploy verifiziert ein eigener Schritt („Staging-Passwortschutz
  verifizieren") die echte, gerade deployte Seite: verlangt wird HTTP 401
  **und** ein `WWW-Authenticate: Basic`-Kopf — ein 401 aus einem anderen
  Grund waere kein Nachweis. Netzwerkfehler/Timeouts zaehlen als
  Fehlschlag. Die dafuer genutzte Domain steht als **Environment-Variable**
  `STAGING_DOMAIN` (nicht als Secret, da nicht vertraulich) im
  GitHub-Environment `staging`.
- **Suchmaschinenausschluss zusaetzlich zu Basic Auth (ENT-387):** Basic
  Auth bleibt primaerer Schutz; zwei weitere, unabhaengige Schichten
  greifen, falls er kuenftig versehentlich geschwaecht wird. `X-Robots-Tag:
  noindex, nofollow, noarchive` kommt ueber `mod_headers` aus
  `htaccess-staging-zusatz` — wie `htaccess-hostpoint` nur manuell
  unterhalb von `#@__HCP_END__@#` in die Staging-`.htaccess` eingetragen,
  nie Teil von `htaccess-hostpoint` selbst (sonst auch auf Production).
  `robots.txt` (`User-agent: *` / `Disallow: /`, Quelle
  `robots-staging.txt`) liegt einmalig manuell als eigene Datei in
  `www/staging`; der Deploy-Workflow schliesst fuer Staging **sowohl
  `.htaccess` als auch `robots.txt`** von Upload und Loeschung aus. Der
  Drift-Guard (`staging-htaccess.synced-sha256`) trackt inzwischen alle
  drei Quelldateien einzeln (`htaccess-hostpoint`, `htaccess-staging-
  zusatz`, `robots-staging.txt`). Nach jedem Staging-Deploy verifiziert ein
  eigener Schritt („Staging-Suchmaschinenausschluss verifizieren")
  authentifiziert (eigener technischer Benutzer `qa-probe` im
  Hostpoint-Passwortschutz, Secrets `STAGING_BASIC_AUTH_USER`/
  `STAGING_BASIC_AUTH_PASSWORD`): die Startseite liefert HTTP 200 mit
  `X-Robots-Tag: noindex`, `robots.txt` liefert HTTP 200 mit `User-agent:
  *`/`Disallow: /`. Ein unauthentifizierter Abruf waere hier kein Nachweis
  — wegen `Require valid-user` liefert jeder Pfad ohnehin 401, unabhaengig
  vom tatsaechlichen Dateiinhalt. Alle HTTP-Pruefungen in diesem Workflow
  verifizieren TLS reguraer (kein `-k`/`--insecure`) und folgen keiner
  Weiterleitung (kein `-L`/`--location`) — ein Redirect auf einen fremden
  Host kann so nie als Erfolg durchgehen; DNS-/TLS-/Netzwerk-/Timeout-Fehler
  gelten als Fehlschlag.
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

## Betreiber-Bereich in Betrieb nehmen (ENT-519 bis ENT-526)

Einmaliger Vorgang. Die Reihenfolge zaehlt — Schritt 4 laesst sich nur
einmal gefahrlos ueben.

### Vorweg: was Staging leisten kann und was nicht

**Ein Staging-Deploy laeuft ausschliesslich gegen einen Git-Tag, der auf
einem `main`-Commit liegt** (ENT-372, siehe Abschnitt „Staging"). Der Code
muss also zuerst nach `main` — und ein Push auf `main` loest den
Production-Deploy aus. Das ist kein Versehen, sondern der strukturelle
Schutz dagegen, dass Staging-spezifischer Code entsteht; umgehen laesst es
sich nicht.

**Was daraus folgt:** Nach Schritt 2 liegt der Code in *beiden* Umgebungen.
Was sich auf Staging gefahrlos ueben laesst, ist nicht der Code, sondern die
**Einrichtung** — sie legt Tabellen an und erzeugt das maechtigste Konto der
Anlage.

**Was beruhigt:** Bis jemand die Einrichtung ausfuehrt, ist der Bereich
inaktiv. `betreiber.html` ist nirgends verlinkt, die Tabellen existieren
nicht, und jeder Endpunkt antwortet mit „noch nicht eingerichtet" (HTTP
503). In `dashboard.html` erscheint lediglich die Kachel
„Support-Freigabe" — und auch die nur fuer Konten mit dem Recht
„Rollen & Berechtigungen".

### 1. htaccess bei Hostpoint nachtragen (betrifft nur Staging)

Production braucht diesen Schritt **nicht** — dort laedt der Deploy die
`.htaccess` selbst hoch.

`backend/betreiber.php` und `backend/support.php` sind in die
FilesMatch-Sperrliste von `htaccess-hostpoint` aufgenommen worden. Auf
Staging wird die `.htaccess` von Hand gepflegt (ENT-384), darum:

1. Hostpoint → Explorer → `www/staging` → Web-Einstellungen fuer aktuelles
   Verzeichnis → Passwortschutz
2. Die vollstaendige `FilesMatch`-Zeile aus `htaccess-hostpoint` **unterhalb**
   der Markierung `#@__HCP_END__@#` ersetzen
3. In `staging-htaccess.synced-sha256` die Nachtragsvermerke **(a) bis (e)**
   loeschen — sie sind dann erledigt

**Wird dieser Schritt uebersprungen,** laeuft der Deploy trotzdem durch (die
Hashes sind bereits mitgezogen, siehe die Vermerke dort). Auf Staging waeren
`betreiber.php` und `support.php` dann per URL erreichbar. Beide enthalten
ausschliesslich Funktionsdefinitionen und geben bei direktem Aufruf nichts
aus, und Staging liegt zusaetzlich hinter Basic Auth — der Schritt ist
wichtig, aber nicht dringend.

### 2. Den Branch nach `main`

```bash
git checkout main && git pull
git merge claude/elegant-darwin-vrso9j
node pruefungen/alle.mjs      # muss 139 von 139 gruen sein
git push
```

**Ab hier ist der Code live.** Der Production-Deploy laeuft automatisch.
Der Betreiber-Bereich bleibt inaktiv, bis Schritt 4 ausgefuehrt wird.

### 3. Tag setzen und Staging deployen

```bash
git tag qa-2026-09-11-001 main
git push origin qa-2026-09-11-001
```

Danach in GitHub Actions: **Run workflow** → *Use workflow from:* dieser Tag
→ Umgebung `staging`.

### 4. Einrichtung ausfuehren — zuerst auf Staging

Im Cockpit der **Staging**-Instanz, angemeldet mit einem Konto, das
„Rollen & Berechtigungen: schreiben" traegt:

1. Seitenleiste unten links → **Einrichtung**
2. **„Pruefen und einrichten"** — legt unter anderem die beiden neuen
   Tabellen `support_freigabe` und `support_zugriff` an
3. Im selben Dialog erscheint darunter der Abschnitt **„Betreiber-Bereich"**:
   - **„Tabellen anlegen"** → `betreiber`, `betreiber_sessions`, `mandant`,
     `betreiber_zwei_faktor`; der laufende Betrieb wird dabei als **Mandant 1**
     eingetragen, ohne dass eine Zeile seiner Daten bewegt wird
   - **„Erstes Konto anlegen"** → Name, E-Mail, Passwort
     (**mindestens 16 Zeichen** — es ist das maechtigste Konto der Anlage)

Der Abschnitt verschwindet danach von selbst. Ein zweites Konto legt nur
noch an, wer selbst eines hat (`be_bootstrap_offen`) — und ab dem zweiten
eingetragenen Mandanten ist der Weg ganz zu.

### 5. Anmelden und Zwei-Faktor einrichten

`https://<staging-adresse>/betreiber.html`

Beim ersten Anmelden fuehrt die Seite direkt zur Zwei-Faktor-Einrichtung —
sie ist hier **Pflicht**, nicht freiwillig wie im Cockpit. QR-Code scannen
oder den Schluessel abtippen, mit einem Code bestaetigen, dann erscheinen
die **zehn Notfallcodes**. Sie werden nur einmal angezeigt.

> **Bevor es weitergeht: ein zweites Betreiber-Konto anlegen.**
> Wer Telefon **und** Notfallcodes verliert, kommt sonst nicht mehr hinein —
> der Weg zurueck fuehrt ausschliesslich ueber ein zweites Konto
> (`betreiber_zf_zuruecksetzen.php`), und eine Hintertuer gibt es
> absichtlich nicht. Das zweite Konto ist keine Bequemlichkeit, sondern
> Betriebsvoraussetzung.

### 6. Auf Staging durchspielen

- Mandantenliste: der Bestandsbetrieb steht als Mandant 1, Verbindung
  „Standardverbindung", Einrichtung „erreichbar"
- **GAV** → die Unterstellung bestaetigen (Ja/Nein) — sie wird mit Zeitpunkt
  und Person festgehalten
- **Support** → muss „keine gueltige Support-Freigabe" melden
- Im Cockpit: **Administration → Betrieb → Support-Freigabe** → Zweck
  eintragen, freigeben
- Zurueck im Betreiber-Bereich: **Support** → jetzt kommen die
  Diagnosedaten
- Wieder im Cockpit: **Protokoll** → der Zugriff steht dort, mit Zeitpunkt
  und Konto

Stimmt das alles, ist der Ablauf erprobt.

### 7. Dasselbe auf Production

Schritt 4 und 5 auf der Produktivinstanz wiederholen. Schritt 6 ist dort
freiwillig — die Support-Freigabe an sich selbst zu erteilen und wieder
zurueckzuziehen schadet nichts und hinterlaesst einen Protokolleintrag.

### Was dabei ausdruecklich NICHT passiert

- **Kein Datenumzug.** Der laufende Betrieb behaelt seine Datenbank und wird
  nur im Mandantenstamm eingetragen. `WHERE id = 1` bleibt an allen 14
  Stellen richtig.
- **Keine Aenderung an bestehenden Tabellen.** Es kommen ausschliesslich
  neue dazu.
- **Kein Zugriff auf Betriebsdaten** ohne Freigabe des jeweiligen Betriebs —
  und auch mit Freigabe nur auf Diagnosedaten ohne Personenbezug.

### Offen, bevor ein ZWEITER Betrieb aufgenommen wird

Nicht fuer die Inbetriebnahme noetig, aber vorher zu klaeren:

| | |
|---|---|
| **OP-518** | Eigene Datenbank fuer die Betreiber-Ebene. Heute liegen ihre Tabellen in derselben Datenbank wie die Betriebsdaten — beim zweiten Mandanten laege der Mandantenstamm sonst in der Datenbank eines Kunden |
| **OP-526** | Deploy-Schritt fuer `__MANDANT_SECRETS__`. Ohne ihn laesst sich kein Mandant mit eigener Datenbank erreichen |
| **DSG** | Auftragsbearbeitungsvertrag. Sobald fremde Personendaten verarbeitet werden, ist er Pflicht (ENT-524, Risiken) |

---

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
