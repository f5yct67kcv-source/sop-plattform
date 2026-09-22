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
handbuch/          Bedienungsanleitung fuers Cockpit (Erste Fassung, 11.09.2026).
                   Eigenstaendige, noch NICHT deployte Dateisammlung -- steht
                   nicht in deploy-hostpoint.yml. Siehe handbuch/index.html.

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
Dateiliste** und hat seit ENT-679 zwei Wege: manuell gegen einen
`qa-*`-Tag (wie bisher, ENT-372) **oder** automatisch per Push auf den
Branch `test`. Der Branch `test` ist ein Wegwerf-Branch für Code, der noch
nicht auf `main` ist; er wird nie nach `main` gemergt, sondern vor jedem
neuen Versuch frisch von `main` gesetzt. Einen dauerhaften Branch
`staging` gibt es weiterhin nicht. Welches GitHub Environment
(`production`/`staging`, siehe `Settings → Environments`) greift und damit
welche Werte hinter den Secret-Namen stehen, entscheidet in allen Fällen
der Ref: **nur** der Branch `main` ergibt `production`. Siehe „Staging"
weiter unten.

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

| Production-Secret | Staging-Secret | Demo-Secret | Wofuer | Woher der Wert kommt |
|---|---|---|---|---|
| `DB_HOST` | `STAGING_DB_HOST` | `DEMO_DB_HOST` | Datenbankserver | Hostpoint-Kundencenter → Datenbanken, je aus dem **eigenen** Account |
| `DB_NAME` | `STAGING_DB_NAME` | `DEMO_DB_NAME` | Name der Datenbank | dieselbe Stelle |
| `DB_USER` | `STAGING_DB_USER` | `DEMO_DB_USER` | Datenbankbenutzer | dieselbe Stelle |
| `DB_PASSWORD` | `STAGING_DB_PASSWORD` | `DEMO_DB_PASSWORD` | Passwort dazu | dieselbe Stelle; bei Verlust dort neu setzen |
| `HOSTPOINT_FTP_HOST` | `STAGING_HOSTPOINT_FTP_HOST` | `DEMO_HOSTPOINT_FTP_HOST` | Ziel des Deploys | Hostpoint-Kundencenter → FTP, je der **eigene** Account |
| `HOSTPOINT_FTP_USER` | `STAGING_HOSTPOINT_FTP_USER` | `DEMO_HOSTPOINT_FTP_USER` | FTP-Benutzer | dieselbe Stelle |
| `HOSTPOINT_FTP_PASSWORD` | `STAGING_HOSTPOINT_FTP_PASSWORD` | `DEMO_HOSTPOINT_FTP_PASSWORD` | Passwort dazu | dieselbe Stelle |
| `MAPS_JS_KEY` | `STAGING_MAPS_JS_KEY` | `DEMO_MAPS_JS_KEY` | Google-Maps-Browserschluessel (Kontrollpunkt-Karte, Geofence-Auswahl, Objektplan) | console.cloud.google.com — je Umgebung ein **eigener** Schluessel, referrer-beschraenkt auf genau die eine Domain |
| `ANTHROPIC_API_KEY` | `STAGING_ANTHROPIC_API_KEY` | `DEMO_ANTHROPIC_API_KEY` | Diktat, Kundenrecherche, Planungsvorschlaege | console.anthropic.com; bei Verlust neu erzeugen, der alte laesst sich nicht anzeigen. **Bei Demo anders als bei Production/Staging: erforderlich, kein optionaler Ausfall** — ENT-523-N1, der Projektinhaber will die KI-Funktion in der Demo aktiv sehen |
| `SMTP_HOST` | `STAGING_SMTP_HOST` | `DEMO_SMTP_HOST` | Mailserver fuer den Offert-Versand (ENT-192) | Hostpoint-Kundencenter → E-Mail → SMTP-Einstellungen — **dasselbe** Postfach wie Production (ENT-367: kein zweites kostenloses Postfach ohne eigene Domain verfuegbar), Werte identisch mit `SMTP_*` |
| `SMTP_PORT` | `STAGING_SMTP_PORT` | `DEMO_SMTP_PORT` | Port dazu (meist 587 mit `tls`, oder 465 mit `ssl`) | dieselbe Stelle |
| `SMTP_VERSCHLUESSELUNG` | `STAGING_SMTP_VERSCHLUESSELUNG` | `DEMO_SMTP_VERSCHLUESSELUNG` | `tls`, `ssl` oder leer | dieselbe Stelle, je nach Port |
| `SMTP_USER` | `STAGING_SMTP_USER` | `DEMO_SMTP_USER` | Postfach-Login | dieselbe Stelle |
| `SMTP_PASSWORD` | `STAGING_SMTP_PASSWORD` | `DEMO_SMTP_PASSWORD` | Passwort dazu | dieselbe Stelle; bei Verlust dort neu setzen |
| `SMTP_ABSENDER` | `STAGING_SMTP_ABSENDER` | `DEMO_SMTP_ABSENDER` | Absenderadresse (muss zum jeweiligen Postfach passen) | dieselbe Stelle |
| `SMTP_ABSENDER_NAME` | `STAGING_SMTP_ABSENDER_NAME` | `DEMO_SMTP_ABSENDER_NAME` | Angezeigter Absendername (optional) | frei waehlbar |
| — | `STAGING_TESTMAIL` | `DEMO_TESTMAIL` | Zieladresse, auf die **jede** aus Staging/Demo versendete Mail umgeleitet wird | frei waehlbar, kein produktives Postfach. Bei Demo formal optional (ohne sie wird schlicht nichts verschickt, `smtp_ziel()`), praktisch aber noetig, sonst bleibt der ganze Mailversand der Demo aus |
| — | `STAGING_BASIC_AUTH_USER` | — | Benutzername fuer den authentifizierten Suchmaschinenausschluss-Nachweis (ENT-387) | Hostpoint-Passwortschutz (Explorer → www/staging → Web-Einstellungen → Passwortschutz), eigener technischer Benutzer `qa-probe`, nicht der persoenliche Zugang. **Demo hat keinen Passwortschutz (ENT-523-N1) und darum kein Gegenstueck** |
| — | `STAGING_BASIC_AUTH_PASSWORD` | — | Passwort dazu | dieselbe Stelle; eigenes starkes Zufallspasswort |
| `VAPID_PRIVATE_PEM_B64` | `STAGING_VAPID_PRIVATE_PEM_B64` | `DEMO_VAPID_PRIVATE_PEM_B64` | Signierschluessel fuer Push-Benachrichtigungen (ENT-424) | selbst erzeugen, siehe unten — je Umgebung ein **eigener**, sonst klingeln Testversande auf den echten Telefonen |
| `VAPID_KONTAKT` | `STAGING_VAPID_KONTAKT` | `DEMO_VAPID_KONTAKT` | Absenderkontakt im Push-JWT, `mailto:…` oder `https://…` (RFC 8292 verlangt ihn) | frei waehlbar, muss erreichbar sein |
| `PUSH_CRON_SCHLUESSEL` | `STAGING_PUSH_CRON_SCHLUESSEL` | `DEMO_PUSH_CRON_SCHLUESSEL` | Schluessel, mit dem der Hostpoint-Zeitgeber den Nachzuegler-Versand aufruft | selbst erzeugen: `openssl rand -hex 24` |
| `DEMO_PLAETZE` | — | — | FTP- und Datenbankzugaenge der zehn Demo-Plaetze (ENT-600), base64-kodiertes JSON in EINEM Secret statt siebzig einzelner Namen | selbst zusammenstellen, Aufbau und Einrichtungsweg im Abschnitt „Demo-Plaetze" weiter unten. Nur Production — die Plaetze haengen an `main`, nicht an einem `demo-*`-Tag |

### Environment-Variablen (keine Secrets)

Drei Werte sind **nicht** vertraulich und stehen darum als
Environment-Variable statt als Secret (`Settings → Environments → …
→ Variables`):

| Variable | Umgebung | Wofuer |
|---|---|---|
| `STAGING_DOMAIN` | staging | Adresse, unter der die Verifikationsschritte die Staging-Seite abrufen (ENT-384/ENT-387) |
| `DEMO_DOMAIN` | demo | Adresse, unter der der Verifikationsschritt die Demo-Seite abruft (ENT-523) — **erforderlich**, siehe unten |
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
- **Demo:** Kommt aus `DEMO_DOMAIN`, aus demselben Grund kein Rueckfall auf
  Production. Fehlt sie, bricht der Demo-Deploy sogar ganz ab — nicht erst
  beim Linkversand: Der Verifikationsschritt „Demo-Suchmaschinenausschluss
  verifizieren" braucht die Adresse, um die frisch deployte Seite
  abzurufen, und ohne sie liesse sich der Suchmaschinenausschluss nicht
  nachweisen.

**Erforderlich, sonst bricht der Deploy ab** (siehe Workflow-Schritt „Umgebung
waehlen und erforderliche Secrets pruefen"): `DB_*`, `HOSTPOINT_FTP_*` und
`MAPS_JS_KEY` — jeweils production-, staging- oder demo-seitig, je nachdem,
ob gegen `main`, einen `qa-*`-Tag oder einen `demo-*`-Tag deployt wird —
sowie bei Staging zusaetzlich `STAGING_TESTMAIL`, bei Demo zusaetzlich
`DEMO_ANTHROPIC_API_KEY` (siehe Tabelle oben, ENT-523-N1) und
`DEMO_DOMAIN` (als Environment-Variable, siehe oben — der Deploy-Lauf
selbst kommt zwar auch ohne sie durch, scheitert aber sicher am
Verifikationsschritt am Ende). **Optional, mit eingebauter Ersatzmeldung
statt Absturz:** `SMTP_*` (meldet „noch nicht eingerichtet") sowie
`ANTHROPIC_API_KEY` bei Production/Staging (KI-Funktionen liefern dann
nichts, statt zu scheitern — bei Demo dagegen erforderlich, siehe oben)
sowie `VAPID_*` und `PUSH_CRON_SCHLUESSEL` (Push meldet „noch nicht
eingerichtet") — dieselbe Regel gilt fuer die `STAGING_`- und
`DEMO_`-Varianten.

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

## Staging (ENT-341, Deploy-Mechanismus revidiert durch ENT-372, erweitert durch ENT-679)

Eine vollstaendig getrennte Testinstanz — dieselbe Codebasis, eigene
Datenbank, eigenes FTP-Ziel, eigene Secrets unter eigenen Namen, keine
echten Geschaeftsdaten. Beim SMTP-Versand teilt sich Staging das Postfach
mit Production, als bewusst begrenzte, mit sieben Bedingungen versehene
Ausnahme (ENT-367/ENT-371) — die Secret-*Namen* bleiben trotzdem eigene
(`STAGING_SMTP_*`), nur die *Werte* sind vorerst identisch; die zwingende
Empfaenger-Umleitung unten macht das unkritisch. Adresse und genaue
Hostpoint-Einrichtung stehen im Entscheidungsprotokoll des
Projekt-Repositories (ENT-341); hier nur, was den Code betrifft:

- **Zwei Wege nach Staging, kein dauerhafter Branch `staging`.** Ein Push
  auf `main` loest ausschliesslich den Production-Deploy aus. Ein
  Staging-Deploy entsteht entweder **manuell** ("Run workflow" in GitHub
  Actions) gegen einen **Git-Tag** der Form `qa-JJJJ-MM-TT-NNN` (z. B.
  `qa-2026-09-04-001`), der exakt auf einem bestehenden `main`-Commit
  liegt, **oder automatisch** durch einen Push auf den Branch `test`
  (ENT-679). Der Tag-Weg war urspruenglich der einzige (ENT-372): `main`
  bleibt alleinige Source of Truth, es darf keinen Staging-spezifischen
  Code geben, der spaeter zurueckgemergt werden muesste, und auf einen Tag
  laesst sich git-technisch kein Commit pushen — ein struktureller statt
  eines Konventionsschutzes. Genau darum kann ein `qa-*`-Tag aber nur
  zeigen, was **schon auf `main` ist**. Fuer alles davor gibt es seit
  ENT-679 den Branch `test`.
  ```
  git tag qa-2026-09-04-001 <main-commit>
  git push origin qa-2026-09-04-001
  # danach in GitHub Actions: "Run workflow" -> Use workflow from: dieser Tag
  ```
- **Der Branch `test` (ENT-679).** Wegwerf-Branch fuer Code, der noch
  nicht auf `main` ist. Ein Push dorthin deployt automatisch nach Staging,
  ohne Tag und ohne "Run workflow". Er wird **nie nach `main` gemergt** —
  der Weg nach `main` laeuft unveraendert ueber den Feature-Branch und
  seinen Pull Request. Vor jedem neuen Versuch frisch von `main` setzen:
  ```
  git checkout -B test main
  git merge --no-ff <feature-branch>      # oder cherry-pick
  git push -u --force-with-lease origin test
  ```
  Dass `test` nicht zurueckgemergt wird, ist eine **Disziplinregel, kein
  struktureller Schutz** — das ist der bewusst akzeptierte Preis von
  ENT-679. Production bleibt davon unberuehrt: `production` haengt
  ausschliesslich am Ref-Namen `main`, ein Push auf `test` kann die echte
  Anlage nicht erreichen (geprueft in `test_deploy.mjs`).
- **Beide Wege sind im Workflow abgesichert.** Das GitHub-Environment
  `staging` ist ueber "Deployment branches and tags" beschraenkt; dort
  muessen seit ENT-679 **beide** Eintraege stehen (Muster `qa-*` **und**
  Branch `test`), sonst blockiert GitHub den `test`-Lauf. Zusaetzlich
  bricht der Workflow selbst ab, wenn ein Staging-Lauf gegen einen Ref
  laeuft, der weder `qa-*`-Tag noch exakt `test` ist. In
  `qa-version.json` steht bei einem `test`-Push folgerichtig `"test"`
  statt eines Tags; unterscheidbar bleiben die Staende ueber
  `commit_sha`.
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

## Demo (ENT-523)

Eine dritte, vollstaendig getrennte Instanz fuer Interessenten — dieselbe
Codebasis wie Staging, aber ohne Passwortschutz (ENT-523-N1: der
Interessent soll den Link einfach oeffnen koennen) und mit einer
Musterbetrieb-Erzeugung (`backend/demo_daten.php`), die Staging nicht hat.
Adresse und genaue Hostpoint-Einrichtung gehoeren dir; hier nur, was den
Code betrifft.

- **Kein dauerhafter Branch `demo`.** Wie bei Staging entsteht ein
  Demo-Deploy **ausschliesslich manuell** ("Run workflow" in GitHub
  Actions) gegen einen **Git-Tag** der Form `demo-JJJJ-MM-TT-NNN`, der
  exakt auf einem bestehenden `main`-Commit liegt:
  ```
  git tag demo-2026-09-12-001 <main-commit>
  git push origin demo-2026-09-12-001
  # danach in GitHub Actions: "Run workflow" -> Use workflow from: dieser Tag
  ```
  Das GitHub-Environment `demo` sollte zusaetzlich ueber „Deployment
  branches and tags" auf das Muster `demo-*` beschraenkt werden (Settings →
  Environments → demo) — der Workflow selbst bricht ausserdem ab, wenn ein
  Demo-Lauf gegen einen Ref ohne dieses Muster ausgeloest wird.
- **Kein Ruckfall auf Production- oder Staging-Secrets:** Demo-Secrets
  tragen eigene Namen (`DEMO_DB_HOST` usw., siehe Tabelle weiter oben).
  Fehlt eines der erforderlichen, bricht der Lauf ab, bevor irgendetwas
  kopiert oder hochgeladen wird.
- **`APP_ENV`** wird beim Deploy explizit auf `demo` gesetzt.
  `ist_demo()`/`umgebung_ist_demo()` in `backend/db.php` sind fail-safe:
  nur der exakte Wert `demo` gilt als Demo. `testumgebung.js` zeigt das
  sichtbare „TESTUMGEBUNG"-Kennzeichen entsprechend auch dort.
- **E-Mail-Versand** geht ausschliesslich an die in `DEMO_TESTMAIL`
  konfigurierte Adresse (`smtp_ziel()` in `backend/mailer.php`) — eine
  **eigene**, nicht die von Staging (ENT-523-N1: die beiden teilen sich
  keine Mailziele). Fehlt `DEMO_TESTMAIL`, wird schlicht nichts
  verschickt, statt an eine falsche Adresse zu gehen. Der Absendername
  traegt ausserhalb der Produktion automatisch das Praefix `[DEMO]`.
- **Kein Passwortschutz (ENT-523-N1).** Anders als Staging braucht Demo
  keine manuelle Hostpoint-Einrichtung fuer `.htaccess`/`robots.txt` und
  keinen Drift-Guard: `htaccess-demo-zusatz` (X-Robots-Tag: `noindex,
  nofollow, noarchive`) und `robots-demo.txt` (`Disallow: /`) werden bei
  jedem Deploy **automatisch** aus dem Repository kopiert, wie jede andere
  Datei auch. Der Suchmaschinenausschluss ist die einzige Schutzschicht;
  nach jedem Demo-Deploy verifiziert ein eigener Schritt
  („Demo-Suchmaschinenausschluss verifizieren") unauthentifiziert die
  echte, gerade deployte Seite: HTTP 200 mit `X-Robots-Tag: noindex` auf
  `/`, HTTP 200 mit `User-agent: *`/`Disallow: /` auf `/robots.txt`.
  Netzwerkfehler, Timeouts oder eine Weiterleitung zaehlen als Fehlschlag.
- **Musterbetrieb erzeugen (nur bei der Ersteinrichtung von Hand):** Im
  Cockpit unter „Betrieb → Einrichtung" zuerst `planung_einrichten.php`
  ausfuehren wie bei jeder neuen Instanz, danach den Endpunkt
  `api/demo_daten_erzeugen.php` einmalig aufrufen (Recht
  `betrieb_schreiben`) — er fuellt eine leere Datenbank mit einem
  erfundenen, funktionsfaehigen Bewachungsbetrieb samt einem
  abgeschlossenen Lohnlauf fuer den Vormonat. Die Vorbedingung prueft
  `kunden`/`objekte` (nicht `mitarbeiter`) und vertraegt sich darum mit dem
  einen Bootstrap-Konto aus `setup.php`, ohne das der Endpunkt ueberhaupt
  erst erreichbar waere; ein zweiter Lauf ohne vorherigen Reset bricht
  kontrolliert ab, statt zu verdoppeln.
- **Einrichtung** ansonsten wie bei Staging: `schema.sql` einmalig in
  phpMyAdmin, `setup.php`/`setup.html` temporaer fuer den ersten
  Admin-Account (danach sofort wieder loeschen), dann wie oben.
- **Naechtlicher Reset (ENT-523 Punkt 3, automatisch seit Stufe 4):**
  `.github/workflows/demo-reset.yml` ruft taeglich um 02:00 UTC (MEZ 03:00,
  MESZ 04:00) `api/demo_reset_ausfuehren.php` auf — der leert die gesamte
  Demo-Datenbank und ruft anschliessend dieselbe Musterbetrieb-Erzeugung
  wie oben erneut auf. Ausgeloest ueber ein Geheimnis in der Adresse, nicht
  ueber eine Sitzung (gleiches Prinzip wie `PUSH_CRON_SCHLUESSEL` bei
  `api/push_versand.php`) — dafuer im GitHub-Environment „demo" zusaetzlich
  zu den bestehenden `DEMO_*`-Secrets ein **`DEMO_RESET_TOKEN`** eintragen
  (langer, zufaelliger Wert) und einmal deployen. Laesst sich unter
  Actions → „Demo naechtlich zuruecksetzen" → „Run workflow" auch von Hand
  ausloesen, etwa zwischen zwei Interessenten am selben Tag.

## Demo-Plätze (ENT-600/ENT-601/ENT-613)

Etwas anderes als die Demo-Umgebung darüber, auch wenn der Name ähnlich
klingt. Die Demo-Umgebung (ENT-523) ist **eine** Instanz, die gegen einen
`demo-*`-Tag beliefert wird und sich nächtlich selbst zurücksetzt. Die
Demo-Plätze sind **zehn** Instanzen mit je eigener Datenbank, von denen
jede 14 Tage lang einem einzelnen Interessenten gehört. Beides läuft
nebeneinander und teilt sich nichts — weder Datenbank noch Mailziel noch
Adresse.

**Beide tragen trotzdem denselben `APP_ENV=demo`** — die Unterscheidung
"welche der beiden Demo-Anlagen läuft hier gerade" braucht darum einen
zweiten, eigenen Platzhalter: `__IST_DEMO_PLATZ__` in `testumgebung.js`,
nur bei den zehn Plätzen auf `"1"` gesetzt, überall sonst auf `"0"`
(Befund des Projektinhabers, 2026-09-21 — bis dahin zeigte das Dashboard
eines Demo-Platzes fälschlich die Datenschutzseite der ENT-523-Umgebung,
die vom gemeinsamen Zugang und vom nächtlichen Leeren erzählt, keins von
beidem trifft aber auf einen Demo-Platz zu). `window.APP_UMGEBUNG_DEMO_PLATZ`
steuert in `dashboard.html`, welche der beiden Seiten
(`datenschutz-demo.html` oder `datenschutz-demo-platz.html`) der
Datenschutzlink im Anmelde-Tor öffnet.

Ein Interessent trägt sich auf guardops.ch ein, `api/demo_anfordern.php`
sucht den ersten freien Platz, leert dessen Instanz, füllt sie mit dem
Musterbetrieb, legt ein Konto an und verschickt die Zugangsdaten. Damit
unter `https://demoN.guardops.ch` dann etwas steht, müssen die Dateien
dort liegen — genau das ist der Teil, den dieser Abschnitt beschreibt.

**Beliefert wird bei jedem Push auf `main`** (Festlegung des
Projektinhabers, 2026-09-19), nicht über einen Tag. Ein Platz trägt zwei
Wochen lang einen echten Interessenten; liefe er nicht mit, sähe der
ältere Software als die Homepage bewirbt — und das fällt niemandem auf,
weil es kein Fehler ist, sondern nur ein alter Stand.

### Das Secret `DEMO_PLAETZE`

Ein einziges Secret statt siebzig einzelner Namen (zehn Plätze mal sieben
Werte). Es steht im GitHub-Environment **production** und trägt ein
base64-kodiertes JSON — kodiert aus demselben Grund wie
`MANDANT_SECRETS` (OP-526): `sed` verträgt weder `&` noch `|` in einem
Passwort, und eine `KEY=value`-Zeile verträgt keinen Zeilenumbruch.

```json
{
  "gemeinsam": {
    "maps_js_key": "…",
    "anthropic_api_key": "…",
    "testmail": "…",
    "vapid_private_pem_b64": "…",
    "vapid_kontakt": "mailto:…",
    "push_cron_schluessel": "…",
    "ftp_host": "…", "ftp_user": "…", "ftp_passwort": "…"
  },
  "plaetze": {
    "demo1": {
      "db_host": "itufeden.mysql.db.internal",
      "db_name": "itufeden_demo1",
      "db_user": "itufeden_demo1",
      "secret_name": "…"
    },
    "demo2": { … }
  }
}
```

Erzeugen und eintragen:

```
base64 -w0 demo-plaetze.json      # -w0: eine einzige Zeile
# Ausgabe als Secret DEMO_PLAETZE unter Settings → Environments → production
rm demo-plaetze.json              # die Datei gehört nicht ins Repository
```

- **Kein Postfach im Vorrat.** Die Plätze verschicken über dasselbe
  `info@guardops.ch` wie die Homepage — die Zugangsdaten stehen schon als
  `GUARDOPS_SMTP_*` im Deploy (ENT-569/ENT-570). Sind die nicht gesetzt,
  meldet `smtp_konfiguriert()` „nicht eingerichtet", statt mit einem
  Platzhalter zu verschicken.
- **Ein FTP-Zugang für alle zehn**, unter `gemeinsam`. Er zeigt auf den
  gemeinsamen Elternordner der zehn Document-Roots, nicht auf einen
  einzelnen Platz — getrennt werden sie über das Zielverzeichnis. Welcher
  Platz wohin geht, ist nicht einstellbar: Der Unterordner heisst wie der
  Platz.
- **Das Datenbank-Passwort steht hier nicht drin.** Es kommt über
  `secret_name` aus `MANDANT_SECRETS` — demselben Secret, aus dem der
  Betreiber-Bereich es holt (OP-526), und demselben Vorgang, mit dem die
  ersten Plätze hinterlegt worden sind. Zwei Orte für dasselbe Passwort
  hiessen, dass eine Änderung an einem davon vergessen werden kann, und
  zwar still: Der Betreiber-Bereich käme weiter an die Instanz heran, der
  Platz selbst nicht mehr. Steht zum `secret_name` kein Eintrag in
  `MANDANT_SECRETS`, bricht der Schritt mit genau dieser Auskunft ab.
- **Nur die Plätze eintragen, die wirklich eingerichtet sind.** Ein Platz
  ohne Eintrag wird schlicht nicht beliefert, und der Lauf sagt am Ende
  namentlich, welche das waren.
- **Drei Werte unter `gemeinsam` sind Pflicht**, sonst bricht der Schritt
  ab und kein Platz wird beliefert:
  - `testmail` — in der Demo leitet `smtp_ziel()` **jede** Mail auf diese
    eine Adresse um. Das ist keine Bequemlichkeit, sondern die Sperre, die
    verhindert, dass ein Interessent beim Ausprobieren eine Offerte an
    eine echte Adresse schickt.
  - `maps_js_key` — ohne ihn bleiben Kontrollpunkt-Karte,
    Geofence-Auswahl und Objektplan leer, und zwar wortlos. Der Schlüssel
    ist referrer-beschränkt, und zwar über eine **Liste**: Ein einziger
    Schlüssel reicht für alle zehn Plätze, aber jede Platz-Adresse muss in
    der Google Cloud Console in seiner Referrer-Liste stehen
    (`https://demo1.guardops.ch/*` und so weiter). Fehlt eine, bleibt
    genau dort die Karte leer. Der bestehende Demo-Schlüssel lässt sich
    dafür verwenden — es braucht keinen neuen je Platz.
  - `anthropic_api_key` — ENT-523-N1: Die KI-Funktion soll in der Demo
    aktiv sein, nicht als „nicht eingerichtet" dastehen.
- **Ein halb ausgefüllter Platz bricht den Lauf ab.** Fehlt einem Platz
  eines der sieben Felder, ist das ein Fehler und keine Warnung: Eine
  Adresse, die läuft, aber auf keine Datenbank zeigt, merkt erst der
  Interessent.
- Das Rapport-Tool, die Homepage, der Betreiber-Bereich, das Portal und
  die Adresse der Mandantin sind zu diesem Zeitpunkt bereits ausgeliefert.
  Ein Fehler in `DEMO_PLAETZE` färbt den Lauf rot, hält aber keine der
  anderen Adressen auf.

### Einen Platz einrichten

Sieben Schritte, die ersten drei bei Hostpoint. Ein Platz ist erst dann
einsatzbereit, wenn alle sieben erledigt sind — und er steht im
Betreiber-Bereich trotzdem schon vorher im Vorrat.

1. **Subdomain `demoN.guardops.ch`** anlegen, mit SSL-Zertifikat (die
   Zugangsmail verschickt `https://`-Links) und — das ist der Punkt, an
   dem alles hängt — mit dem Document-Root im **gemeinsamen
   Elternordner**:

   ```
   /home/itufeden/www/demos/demo1     ← Document-Root von demo1.guardops.ch
   /home/itufeden/www/demos/demo2     ← Document-Root von demo2.guardops.ch
   …
   ```

   Der Ordnername **muss** der Platzname sein; der Deploy lädt in
   `/demoN/` unterhalb des Zugangs und kennt kein Ausweichfeld dafür.
2. **Datenbank und Datenbankbenutzer** anlegen — eine eigene je Platz.
   Die Trennung der Interessenten läuft über die Datenbank und nicht über
   eine Spalte in jeder Tabelle (ENT-600, Punkt 2). Und nicht über ein
   geteiltes Verzeichnis: In der `db.php` jedes Platzes stehen seine
   Datenbank und seine Adresse fest eingetragen, darum braucht jeder Platz
   ein eigenes Verzeichnis und kann nicht als Alias auf ein gemeinsames
   zeigen.
3. **Einen FTP-Zugang** auf den Elternordner anlegen — einen für alle
   zehn, nicht einen je Platz (Festlegung des Projektinhabers,
   2026-09-19). **Nicht** auf `/home/itufeden/www`: Von dort erreichte
   derselbe Zugang auch `cupi24.guardops.ch`, `betreiber.guardops.ch`,
   `portal.guardops.ch` und `guardops.ch`, und ein Fehler im Deploy
   überschriebe die Anlage der Mandantin.
   **Achtung, das ist hier schon einmal schiefgegangen** (ENT-580,
   Portal-Umzug): Der Document-Root der Subdomain muss wirklich auf
   `<Elternordner>/demoN` zeigen. Stimmt das nicht, lädt der Deploy
   erfolgreich an eine unbediente Stelle hoch, und die Adresse liefert
   trotzdem 403 — ohne dass der Lauf etwas meldet.
4. **`MANDANT_SECRETS` ergänzen**: das DB-Passwort des Platzes unter
   einem `secret_name` eintragen. Das Secret ist ein base64-kodiertes
   JSON `{"<secret_name>": "<passwort>", …}`, also: bestehenden Wert
   entschlüsseln, den Eintrag dazuschreiben, neu kodieren, ersetzen.
   ```
   # bisherigen Wert aus GitHub kopieren, dann:
   echo '<bisheriger base64-wert>' | base64 -d > mandant-secrets.json
   # Eintrag ergänzen, danach:
   base64 -w0 mandant-secrets.json && rm mandant-secrets.json
   ```
5. **`DEMO_PLAETZE` ergänzen** (siehe oben) und einmal nach `main` pushen.
6. **Mandantenzeile im Betreiber-Bereich** anlegen: Name, `subdomain` =
   `demoN`, `db_host`, `db_name`, `db_user` und derselbe `secret_name`
   wie in Schritt 4. Darüber findet der Betreiber-Bereich die Datenbank
   des Platzes, wenn er ihn leert oder ein Passwort neu setzt.
7. **Tabellen anlegen** über die Schema-Prüfung im Betreiber-Bereich
   (`api/betreiber_schema_pruefen.php`, ENT-612). Danach zeigt die
   Mandantenliste den Platz als erreichbar mit vollständigem Tabellensatz.

### Was der Deploy je Platz einträgt

- **Eigene Datenbank** aus dem Vorrat — nie die produktive. Die Vorlage
  für die Platz-Bündel wird **vor** der Platzhalter-Ersetzung aus `dist/`
  gezogen; rutschte diese Zeile dahinter, trügen alle zehn Plätze die
  Zugangsdaten der Anlage der Mandantin. `test_demo_plaetze.mjs` wacht
  darüber.
- **Eigene Adresse** `https://demoN.guardops.ch` (ENT-501: aus dem Deploy,
  nie aus der Anfrage).
- **`APP_ENV=demo`.** Daran hängt `ist_demo()`, und daran hängt nach
  ENT-587 die Sperre, die einen Demo-Besucher daran hindert, sich im
  Betreiber-Bereich ein Konto auszustellen.
- **Kein Suchmaschinen-Eintrag**: `htaccess-demo-zusatz` und
  `robots-demo.txt`, dieselben zwei Dateien wie bei der Demo-Umgebung.
  Eine Demo-Instanz unter dem Firmennamen eines Interessenten bei Google
  wäre ein Datenschutzvorfall mit Ansage.
- **Das Ziel ist der Unterordner des Platzes**, nie der Elternordner. Der
  Upload räumt sein Zielverzeichnis auf; ginge ein Platz versehentlich in
  den Elternordner, verschwänden dabei die Verzeichnisse der neun
  anderen. `test_demo_plaetze.mjs` wacht auch darüber.
- **Leer bleiben** der Empfänger des Kontaktformulars (das steht auf
  guardops.ch), der Zeitgeber-Schlüssel des nächtlichen Resets (ein Platz
  wird beim Zuteilen und beim Ablauf geleert, nicht nächtlich) und die
  Zugangsdaten der Betreiber-Ebene.

### Keine Dateien, trotzdem im Vorrat

Ein Platz, der in `DEMO_PLAETZE` fehlt, steht im Betreiber-Bereich
weiterhin als **frei** — die Anzeige rechnet nur die Belegung, nicht die
Einrichtung. Wird er zugeteilt, bekommt der Interessent eine Mail mit
Zugangsdaten und liest unter dem Link 403. Der Deploy warnt darum am Ende
jedes Laufs namentlich, welche Plätze ohne Dateien geblieben sind.
`api/demo_anfordern.php` fängt den Fall serverseitig ab, wenn der Platz
auch im Mandantenstamm fehlt; steht er dort und hat nur keine Dateien,
greift diese Sperre **nicht**.

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

> **Bevor es weitergeht: ein zweites Betreiber-Konto einrichten.**
> Wer Telefon **und** Notfallcodes verliert, kommt sonst nicht mehr hinein —
> der Weg zurueck fuehrt ausschliesslich ueber ein zweites Konto
> (`betreiber_zf_zuruecksetzen.php`), und eine Hintertuer gibt es
> absichtlich nicht. Das zweite Konto ist keine Bequemlichkeit, sondern
> Betriebsvoraussetzung (ENT-659).
>
> **Seit ENT-663 geschieht das ueber eine EINLADUNG**, nicht ueber ein hier
> vergebenes Passwort: Konten → *Neues Konto* → Anrede, Name, E-Mail. Der
> Server verschickt einen Link, die eingeladene Person setzt ihr Passwort
> selbst und richtet danach den zweiten Faktor ein. Bis dahin steht das
> Konto in der Liste als **eingeladen** und kommt nirgends hinein.
>
> **Zwei Dinge, die dabei schiefgehen koennen:**
> - **Ohne funktionierenden E-Mail-Versand geht gar nichts.** Der Endpunkt
>   sagt das deutlich (503), statt ein unbrauchbares Konto zu hinterlassen.
>   Auf einer frischen Anlage also zuerst SMTP pruefen.
> - **Der Link gilt 48 Stunden.** Laeuft er ab, laesst sich die Einladung
>   heute nicht erneuern (OP-664) — das Konto muesste stillgelegt und unter
>   einer anderen Adresse neu eingeladen werden. Darum den Link zeitnah
>   einloesen.
>
> Das **allererste** Konto entsteht weiterhin mit Passwort (Schritt 4): Dort
> gibt es noch keinen Betreiber und keine erprobte Versandstrecke.

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
| **OP-518** | Eigene Datenbank fuer die Betreiber-Ebene. Heute liegen ihre Tabellen in derselben Datenbank wie die Betriebsdaten — beim zweiten Mandanten laege der Mandantenstamm sonst in der Datenbank eines Kunden. **Schrittweise Anleitung:** Abschnitt „Die Betreiber-Ebene auf eine eigene Datenbank ziehen" weiter unten |
| ~~**OP-526**~~ | Deploy-Schritt fuer `__MANDANT_SECRETS__` — **erledigt.** Der Platzhalter wird in `dist-betreiber` und `dist-cupi24` ersetzt, auf den Demo-Plaetzen absichtlich geleert |
| **DSG** | Auftragsbearbeitungsvertrag. Sobald fremde Personendaten verarbeitet werden, ist er Pflicht (ENT-524, Risiken) |

---

## Die Betreiber-Ebene auf eine eigene Datenbank ziehen (OP-518)

Einmaliger Vorgang, **bevor der zweite Mandant aufgenommen wird**. Danach ist
es kein Umzug mehr, sondern eine Trennung von Kundendaten — ungleich teurer.

### Warum

Heute liegen die 16 Betreiber-Tabellen in derselben Datenbank wie die
Betriebsdaten des ersten Mandanten. Solange dieser Mandant dem Betreiber
selbst gehoert, ist das folgenlos. Kommt ein zweiter dazu, laege der
**Mandantenstamm mitsamt allen anderen Kunden in der Datenbank eines
Kunden** — genau die Vermischung, die die getrennte Datenhaltung verhindern
soll.

### Was schon steht — und was wirklich fehlt

**Kein Codeeingriff noetig.** Die Trennung ist gebaut:

- `betreiber_db()` in `backend/betreiber.php` ist eine eigene Verbindung.
  Faellt `__BETREIBER_DB_NAME__` leer aus, faellt sie bewusst auf `db()`
  zurueck — der heutige Zustand, ausdruecklich kein Fehler.
- Der Deploy ersetzt die vier Platzhalter bereits in **allen** Zielen
  (`dist`, `dist-betreiber`, `dist-cupi24`; auf den Demo-Plaetzen
  absichtlich leer).
- Die beiden frueher hier genannten Vorbedingungen sind erledigt:
  **OP-526** (`__MANDANT_SECRETS__` wird seit dem Deploy-Lauf ersetzt) und
  **OP-606 (b)** (`hat_tabelle()` merkt sich sein Ergebnis seit dem
  2026-09-19 per `WeakMap` an der Verbindung, nicht mehr am Tabellennamen —
  ohne das haette eine Tabelle, die es nur auf einer Seite gibt, auf der
  anderen als vorhanden gegolten).

**Es fehlt also nur:** eine zweite Datenbank, vier Secrets, ein Umzug der
Daten.

### Die 18 Tabellen

```
betreiber                betreiber_sessions       betreiber_zwei_faktor
betreiber_einladung
mandant                  mandant_zaehlstand
support_vorgang          support_nachricht
be_kunden                be_kunden_person         be_kunden_kontaktweg
be_produkte              be_belege                be_beleg_positionen
be_beleg_nachricht       be_aenderungslog         be_briefkopf
be_demo_nutzung_archiv
```

Alles mit Praefix `be_` gehoert zum Belegteil des Betreibers und hat nichts
mit den gleichnamigen Tabellen ohne Praefix zu tun — jene sind Kundendaten
des Mandanten und bleiben, wo sie sind.

### Reihenfolge

**Erst auf Staging.** Der Umzug laesst sich dort vollstaendig durchspielen.

1. **Zweite Datenbank bei Hostpoint anlegen.** Eigener Datenbankbenutzer,
   eigenes Passwort — nicht derselbe Benutzer wie fuer die Betriebsdaten,
   sonst ist die Trennung eine Buchhaltung ohne Wirkung.
2. **Die 18 Tabellen exportieren**, aus der heutigen Datenbank, mit Daten.
   In phpMyAdmin: Export → *Angepasst* → nur diese 16 auswaehlen.
   Struktur **und** Daten.
3. **In die neue Datenbank einspielen.** Danach zaehlen: 18 Tabellen, und
   die Zeilenzahl in `betreiber`, `mandant` und `be_belege` muss mit der
   alten uebereinstimmen.
4. **Die vier Secrets setzen** — GitHub → Settings → Environments →
   `production` (bzw. `staging`):
   `BETREIBER_DB_HOST`, `BETREIBER_DB_NAME`, `BETREIBER_DB_USER`,
   `BETREIBER_DB_PASSWORD`.
   Der Platzhalter im Code heisst `__BETREIBER_DB_PASS__`, das Secret
   `BETREIBER_DB_PASSWORD` — die Zuordnung steht im Deploy, das ist kein
   Tippfehler.
5. **Deploy ausloesen.** Ab dem naechsten Lauf zeigt `betreiber_db()` auf die
   neue Datenbank.
6. **Nachsehen, nicht annehmen:** Im Betreiber-Bereich anmelden (die Sitzung
   liegt in `betreiber_sessions` und ist mitgezogen — bleibt die Anmeldung
   haengen, ist etwas schiefgelaufen), Mandantenliste oeffnen, eine Rechnung
   aufrufen. Im Cockpit pruefen, dass der Betrieb unveraendert laeuft.
7. **Die alten 18 Tabellen erst danach loeschen**, und nicht am selben Tag.
   Solange sie stehen, ist der Rueckweg ein Zuruecksetzen der vier Secrets
   und ein Deploy. Sind sie weg, ist er ein Wiedereinspielen aus dem Export.

### Fallen

- **Zwischen Schritt 3 und 5 wird zweigleisig geschrieben.** Was in dieser
  Zeit im Betreiber-Bereich entsteht, landet in der alten Datenbank und
  fehlt in der neuen. Den Umzug darum zu einer Zeit machen, in der niemand
  dort arbeitet — und Schritt 2 und 3 unmittelbar vor Schritt 4 ausfuehren,
  nicht Tage vorher.
- **`mandant.id = 1` bleibt richtig.** Der Bestandsbetrieb wird nicht
  bewegt, nur der Stamm zieht um.
- **Die Einrichtung legt fehlende Tabellen selbst an.** Wird Schritt 2/3
  uebersprungen, entstehen die 18 Tabellen in der neuen Datenbank **leer** —
  inklusive eines wieder offenen Bootstraps. Das sieht aus wie ein frischer
  Betreiber-Bereich und ist in Wahrheit ein verlorener.
- **Der Export enthaelt Zugangsdaten** (Passwort-Hashes, Zwei-Faktor-
  Schluessel, Sitzungsabdruecke). Er gehoert nicht ins Repository und nicht
  in einen Chat.

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
