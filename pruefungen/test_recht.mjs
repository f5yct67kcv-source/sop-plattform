// Die Rechtsseiten von guardops.ch (ENT-563/OP-564): Impressum und
// Datenschutzerklaerung.
//
// Geprueft wird am gerenderten Zustand, nicht im Quelltext -- und die
// Aussagen der Datenschutzerklaerung werden gegen den CODE gehalten, nicht
// gegen sich selbst. Das ist der Kern dieser Suite: Eine Datenschutz-
// erklaerung ist eine Behauptung ueber Software. Aendert sich die Software,
// wird sie falsch, ohne dass jemand die Seite anfasst. Genau dann soll es
// hier rot werden.
//
// Was NICHT geprueft wird und auch nicht geprueft werden kann: ob der Text
// juristisch genuegt. Das ist offen (OP-564).
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = d => readFileSync(`${WURZEL}/${d}`, 'utf8');

const impressum = lies('impressum.html');
const datenschutz = lies('datenschutz.html');
const dsDemo = lies('datenschutz-demo.html');
const homepage = lies('homepage.html');
const workflow = lies('.github/workflows/deploy-hostpoint.yml');

// ══════════ DIE UNFERTIGE SEITE DARF NICHT LIVE GEHEN ════════════════
// Das Impressum traegt __IMPRESSUM_*__-Platzhalter, solange Firma, Adresse
// und Unternehmensnummer fehlen. Ein Impressum mit erfundenen Angaben waere
// schlimmer als keines -- also muss die Kopplung stimmen: entweder die
// Platzhalter sind weg, ODER die Seite wird nicht ausgeliefert. Beides
// zugleich ist der Fehler, den diese Pruefung verhindert.
{
  const offen = [...new Set([...impressum.matchAll(/__[A-Z][A-Z_]{2,}__/g)].map(m => m[0]))];
  // Die echte cp-Zeile, nicht eine Erwaehnung im Kommentar daneben -- die
  // Gegenprobe hat gezeigt, dass eine blosse Textsuche gruen bleibt, wenn
  // nur der Kommentar den Dateinamen noch nennt.
  const imBuendel = /^\s*cp\s+impressum\.html\s+dist-guardops\/\S+$/m.test(workflow);
  check('KRITISCH: das Impressum wird nur ausgeliefert, wenn keine Angabe mehr fehlt',
    offen.length === 0 || !imBuendel);
  if (offen.length) { console.log(`  ! Impressum noch offen: ${offen.join(', ')} — darum nicht im Deploy`); }

  // Dieselbe Kopplung fuer die Verweise: Eine Fusszeile, die auf eine Seite
  // zeigt, die es auf dem Server nicht gibt, ist ein 404 auf einer
  // Verkaufsseite. "Noch nicht da" darf nicht wie "da" aussehen.
  const verweistAufImpressum = /href="impressum\.html"/.test(homepage);
  check('KRITISCH: die Startseite verweist nur dann aufs Impressum, wenn es auch ausgeliefert wird',
    verweistAufImpressum === imBuendel);
  const verweistAufDatenschutz = /href="datenschutz\.html"/.test(homepage);
  check('KRITISCH: die Startseite verweist nur dann auf den Datenschutz, wenn er auch ausgeliefert wird',
    verweistAufDatenschutz === /^\s*cp\s+datenschutz\.html\s+dist-guardops\/\S+$/m.test(workflow));
}

// ══════════ DIE AUSSAGEN GEGEN DEN CODE ══════════════════════════════
// Jede dieser Aussagen steht so in datenschutz.html. Stimmt sie nicht mehr,
// ist die Seite eine falsche Auskunft an den Besucher -- nicht nur ein
// veralteter Text.
{
  const setztCookies = /document\.cookie|localStorage|sessionStorage|indexedDB/.test(homepage)
    || ['backend/api/demo_anfordern.php', 'backend/demo_bremse.php', 'backend/demo_zugang.php']
       .some(d => /setcookie|session_start/i.test(lies(d)));
  check('KRITISCH: die Behauptung "keine Cookies" stimmt mit dem Code ueberein',
    !setztCookies && /keine Cookies/i.test(datenschutz));

  // Fremde Abrufe: Die Seite behauptet, nichts von fremden Servern zu laden.
  // test_homepage.mjs misst das am Browser; hier wird die BEHAUPTUNG an
  // dieselbe Tatsache gekoppelt.
  //
  // Gemeint ist, was der Browser VON SELBST holt -- nicht jede fremde
  // Adresse im Quelltext. Ein <link rel="canonical"> wird nie abgerufen
  // (es ist ein Metadatum), und ein <a href> erst, wenn jemand klickt.
  // Die erste Fassung dieser Pruefung zaehlte beides mit und schlug an,
  // sobald die kanonische Adresse dazukam.
  const ohneKommentare = homepage.replace(/<!--[\s\S]*?-->/g, '');
  const holtFremd =
    /\ssrc="https?:\/\//.test(ohneKommentare)                                  // Bild, Skript, iframe
    || /<link\b(?![^>]*rel="canonical")[^>]*href="https?:\/\//.test(ohneKommentare)  // Stilblatt, Icon, preload
    || /url\(\s*['"]?https?:\/\//.test(ohneKommentare);                        // CSS
  check('KRITISCH: die Behauptung "nichts von fremden Servern" stimmt mit dem Code ueberein',
    !holtFremd && /fremden Servern/i.test(datenschutz));

  // Seit ENT-601 die Gegenrichtung: Der Endpunkt, an den das Formular
  // tatsaechlich geht, LEGT einen Datensatz an -- die Seite muss das genau
  // so sagen, nicht mehr das Gegenteil behaupten. Waere je kein INSERT mehr
  // da, waere die neue Behauptung ihrerseits falsch.
  const endpunkt = lies('backend/api/demo_anfordern.php');
  // Absolute Adresse seit dem 2026-09-18-Nachtrag: guardops.ch traegt keine
  // Datenbank-Zugangsdaten, der Endpunkt liegt darum auf
  // betreiber.guardops.ch (mit eng begrenzter CORS-Freigabe genau fuer
  // dieses Formular, siehe cors_erlaubte_herkunft() in backend/db.php).
  check('KRITISCH: das Formular fuehrt tatsaechlich zu diesem Endpunkt',
    /action="https:\/\/betreiber\.guardops\.ch\/api\/demo_anfordern\.php"/.test(homepage));
  // Seit ENT-624 schreibt der Endpunkt selbst in demo_bestaetigung; der
  // Eintrag im Register entsteht erst beim Bestaetigen, in
  // demo_zugang_einrichten(). Geprueft wird die AUSSAGE -- irgendwo wird
  // gespeichert --, nicht mehr eine bestimmte Zeile in einer bestimmten
  // Datei. Verschwaende der letzte INSERT, waere die Erklaerung falsch.
  const einrichten = lies('backend/demo_instanz.php');
  check('KRITISCH: die Behauptung "wird in einer Datenbank gespeichert" stimmt mit dem Code ueberein',
    /INSERT INTO demo_bestaetigung/i.test(endpunkt)
    && /INSERT INTO demo_zugang/i.test(einrichten)
    && /werden dafür in\s*\n?\s*einer Datenbank gespeichert/i.test(datenschutz.replace(/\s+/g, ' ')));
  // Der Zwischenschritt selbst muss dastehen: Wer liest, sie bekomme
  // sofort einen Zugang, wartet sonst auf Zugangsdaten, die erst nach
  // seiner Bestaetigung kommen.
  check('KRITISCH: die Erklaerung nennt den Bestaetigungsschritt',
    /Bestätigungslink/i.test(datenschutz) && /Erst wenn Sie darin bestätigen/i.test(datenschutz));
  // Und den Abdruck der Zustimmung -- er ist selbst eine Datenbearbeitung
  // und darf nicht unerwaehnt bleiben.
  check('KRITISCH: die Erklaerung nennt, was beim Abdruck der Zustimmung festgehalten wird',
    /Abdruck Ihrer Zustimmung/i.test(datenschutz)
    && /welche Fassung/i.test(datenschutz.replace(/<[^>]+>/g, '')));
  check('KRITISCH: die Seite behauptet NICHT mehr, nichts werde gespeichert',
    !/nicht in\s*\n?\s*einer Datenbank gespeichert/i.test(datenschutz.replace(/\s+/g, ' ')));

  // Die Bremse: Pruefwert statt Adresse, und die genannte Frist muss die
  // im Code eingestellte sein -- eine Erklaerung, die 15 Minuten verspricht,
  // waehrend der Code 60 zaehlt, ist falsch.
  const bremse = lies('backend/demo_bremse.php');
  const fenster = (bremse.match(/DEMO_BREMSE_FENSTER_MIN\s*=\s*(\d+)/) || [])[1];
  check('KRITISCH: die genannte Aufbewahrungsfrist der Bremse ist die im Code eingestellte',
    !!fenster && new RegExp(`nach ${fenster} Minuten`).test(datenschutz));
  check('KRITISCH: die Behauptung "Pruefwert statt Adresse" stimmt mit dem Code ueberein',
    /hash\('sha256'/.test(bremse) && /SHA-256/.test(datenschutz)
    && !/REMOTE_ADDR[^\n]*file_put_contents/.test(bremse));

  // Und die Gegenrichtung: Die Seite darf nicht MEHR versprechen, als der
  // Code haelt. "Nicht rueckrechenbar" waere bei einer IPv4-Adresse eine
  // Uebertreibung -- der Adressraum ist klein genug zum Durchprobieren.
  check('KRITISCH: die Seite behauptet NICHT, der Pruefwert sei nicht rueckrechenbar',
    !/nicht r(ü|ue)ckrechenbar|anonymisiert|unkenntlich gemacht/i.test(datenschutz));

  // Jedes Feld, das das Formular erhebt, muss in der Erklaerung vorkommen --
  // sonst sammelt die Seite mehr, als sie zugibt. Die Zuordnung Feldname zu
  // Wort steht hier: Kommt ein Feld dazu, das hier fehlt, faellt die Pruefung
  // ebenfalls. Ein neues Feld laesst sich damit nicht stillschweigend
  // ergaenzen, ohne dass jemand die Erklaerung anfasst.
  // "vorwahl" ist kein eigenes Datum: Die Auswahl (seit 2026-09-19) traegt
  // die Landesvorwahl der Telefonnummer, mehr erhebt sie nicht. Sie steht
  // darum unter demselben Wort in der Erklaerung.
  // Die beiden Haken (ENT-624) erheben keine Stammdaten, sondern eine
  // Zustimmung und einen Widerspruch -- beides steht in der Erklaerung
  // unter eigenen Ueberschriften, und beides ist eine Bearbeitung.
  const WORT_ZUM_FELD = { firma: 'Firma', name: 'Name', email: 'E-Mail-Adresse',
    telefon: 'Telefonnummer', vorwahl: 'Telefonnummer',
    bedingungen: 'Abdruck Ihrer Zustimmung', kein_rueckruf: 'Rückruf' };
  // Unterstrich MIT (Befund 2026-09-19): Das Muster kannte vorher nur
  // Buchstaben und uebersah damit jedes Feld mit einem Unterstrich im
  // Namen -- kein_rueckruf waere still durchgerutscht, und die Pruefung
  // haette grun behauptet, alle Felder stuenden in der Erklaerung.
  const erhoben = [...homepage.matchAll(/<(?:input|select|textarea)[^>]*\bname="([a-zA-Z_]+)"/g)]
    .map(m => m[1])
    .filter(n => n !== 'website');   // Das Fallenfeld erhebt nichts, es faengt Skripte.
  const ohneZuordnung = erhoben.filter(n => !WORT_ZUM_FELD[n]);
  const ungenannt = erhoben.filter(n => WORT_ZUM_FELD[n] && !datenschutz.includes(WORT_ZUM_FELD[n]));
  // Seit ENT-601 sind es vier Pflichtangaben, keine optionalen mehr
  // (Mitarbeitende/Nachricht sind mit dem Kontaktformular weggefallen).
  // Die Telefonnummer besteht aus Vorwahl und Nummer, dazu die beiden
  // Haken -- und seit ENT-649 die E-Mail-Adresse ein zweites Mal, im
  // zugeklappten Formular "Zugangsdaten nicht erhalten?". Dasselbe Datum,
  // schon in der Erklaerung genannt; gezaehlt wird es trotzdem, weil die
  // feste Zahl sonst nicht mehr faengt, was dazukommt. Genau dafuer ist
  // sie da: Beim Einbau jenes Formulars ist sie angeschlagen.
  check('KRITISCH: jedes Feld, das das Formular erhebt, steht in der Datenschutzerklaerung',
    erhoben.length === 8 && ohneZuordnung.length === 0 && ungenannt.length === 0);
  if (ohneZuordnung.length) { bad.push('Feld ohne Zuordnung in dieser Pruefung: ' + ohneZuordnung.join(', ')); }
  if (ungenannt.length) { bad.push('Feld fehlt in der Datenschutzerklaerung: ' + ungenannt.join(', ')); }
}

// ══════════ DIE FASSUNG DER NUTZUNGSBEDINGUNGEN ══════════════════════
//
// Sie steht an zwei Orten: sichtbar auf der Seite und als Konstante im
// Backend, die in den Abdruck der Zustimmung geschrieben wird. Laufen die
// beiden auseinander, hält der Abdruck eine Fassung fest, die niemand
// gesehen hat -- und genau das soll er beweisen. Geprueft wird die
// Uebereinstimmung, nicht der Wortlaut der Konstante.
{
  const seite = lies('nutzungsbedingungen.html');
  const kern  = lies('backend/demo_bestaetigung.php');
  const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli',
    'August','September','Oktober','November','Dezember'];
  const t = seite.match(/<p class="stand">Fassung vom (\d{1,2})\. (\p{L}+) (\d{4})<\/p>/u);
  const k = kern.match(/const DEMO_BEDINGUNGEN_FASSUNG = '(\d{4})-(\d{2})-(\d{2})'/);
  const ausSeite = t
    ? `${t[3]}-${String(MONATE.indexOf(t[2]) + 1).padStart(2, '0')}-${t[1].padStart(2, '0')}`
    : null;
  check('KRITISCH: die Fassung auf der Seite und die im Abdruck sind dieselbe',
    t !== null && k !== null && ausSeite === `${k[1]}-${k[2]}-${k[3]}`);
  // Die Seite muss auch wirklich sagen, worauf sich jemand einlaesst --
  // die vier Punkte, die der Projektinhaber ausdruecklich abgedeckt haben
  // wollte (ENT-624).
  // Zeilenumbrueche zu Leerzeichen: Ein Satz, der im Quelltext ueber zwei
  // Zeilen laeuft, ist derselbe Satz -- eine Pruefung, die daran
  // scheitert, prueft die Formatierung statt der Aussage.
  const nurText = seite.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const [was, muster] of [
    ['Haftung', /Haftung/i],
    ['keine Verfügbarkeitszusage', /keine Verfügbarkeit zu|sagen aber keine Verfügbarkeit/i],
    ['Löschung nach 14 Tagen', /14\s*<?\/?b?>?\s*Tage/i],
    ['keine echten Personendaten', /keine echten Personendaten/i],
    ['Rückruf', /Rückruf/i],
    ['Auswertung der Nutzung', /Auswertung der Nutzung/i],
  ]) {
    check('die Nutzungsbedingungen decken ab: ' + was, muster.test(nurText));
  }
  // Der Verweis muss vom Formular aus erreichbar sein, sonst hat niemand
  // gelesen, dem etwas zur Kenntnis gebracht werden sollte.
  check('KRITISCH: das Formular verweist auf die Nutzungsbedingungen',
    /href="nutzungsbedingungen\.html"/.test(lies('homepage.html')));
}

// ══════════ DIE DEMO-ERKLAERUNG GEGEN DEN CODE ═══════════════════════
// Eigene Seite fuer den Demobereich (2026-09-17). Die Erklaerung von
// guardops.ch beschreibt eine Seite ohne Anmeldung, ohne Sitzung und ohne
// Datenbank -- der Demobereich ist die Software selbst. Dieselbe Kopplung
// wie oben: Jede pruefbare Aussage haengt am Code, nicht an sich selbst.
{
  const dash = lies('dashboard.html');
  const anmeldung = lies('backend/anmeldung.php');
  const resetLauf = lies('.github/workflows/demo-reset.yml');
  const resetKern = lies('backend/demo_reset.php');
  const flach = dsDemo.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ');

  // Die Kopplung "Verweis nur auf eine Seite, die es auf dem Server gibt".
  // Der Demobereich verweist ABSOLUT auf guardops.ch -- ein 404 faende
  // niemand von uns, sondern der Interessent auf der Anmeldemaske.
  const imBuendel = /^\s*cp\s+datenschutz-demo\.html\s+dist-guardops\/\S+$/m.test(workflow);
  check('KRITISCH: die Anmeldemaske verweist nur dann auf die Demo-Erklaerung, wenn sie ausgeliefert wird',
    /datenschutz-demo\.html/.test(dash) === imBuendel);

  // "Er setzt keine Cookies": dashboard.html haelt die Sitzung im lokalen
  // Speicher. Ein setcookie/document.cookie waere die Falschaussage.
  check('KRITISCH: die Behauptung "keine Cookies" stimmt mit dem Cockpit ueberein',
    !/document\.cookie/.test(dash) && /setzt keine Cookies/i.test(flach));

  // "Heute wird nichts gemessen": kein Analysewerkzeug, kein fremdes
  // Skript. Gemeint ist wieder, was der Browser VON SELBST holt.
  const dashOhneKommentare = dash.replace(/<!--[\s\S]*?-->/g, '');
  const holtFremd = /\ssrc="https?:\/\//.test(dashOhneKommentare)
    || /<link\b(?![^>]*rel="canonical")[^>]*href="https?:\/\//.test(dashOhneKommentare);
  check('KRITISCH: die Behauptung "heute wird nichts gemessen" stimmt mit dem Cockpit ueberein',
    !holtFremd && /Heute wird nichts davon gemessen/i.test(flach));

  // Der Abschnitt zur geplanten Auswertung beschreibt ein VORHABEN. Wird
  // die Messung eines Tages gebaut, muss er vorher in die Gegenwart
  // gesetzt werden -- diese Pruefung haelt beides zusammen.
  check('KRITISCH: die geplante Auswertung steht als Vorhaben da, nicht als Zustand',
    /geplant, heute nicht in Betrieb/i.test(flach));

  // Die Fristen der Anmeldebremse: genannt wird, was im Code steht.
  const sperre = (anmeldung.match(/ANMELD_SPERRE_MIN\s*=\s*(\d+)/) || [])[1];
  check('KRITISCH: die genannte Sperrfrist ist die im Code eingestellte',
    !!sperre && new RegExp(`f(ue|\u00fc)r ${sperre} Minuten gesperrt`, 'i').test(flach));
  check('KRITISCH: die Aufbewahrung der Fehlversuche ("nach einem Tag") steht so im Code',
    /INTERVAL 1 DAY/.test(anmeldung) && /nach einem Tag gel(oe|\u00f6)scht/i.test(flach));

  // Und die Gegenrichtung, derselbe Gedanke wie beim Pruefwert oben: Die
  // Seite darf nicht weniger zugeben, als der Code tut. Die Adresse steht
  // bei Fehlversuchen im KLARTEXT -- das muss dastehen.
  check('KRITISCH: die Seite gibt zu, dass die Adresse bei Fehlversuchen im Klartext steht',
    /INSERT INTO anmeldeversuche \(login_name, adresse\)/.test(anmeldung)
    && /im Klartext/i.test(flach));

  // Das naechtliche Leeren: Uhrzeit und Umfang aus dem Zeitplan und dem
  // Rechenkern, nicht aus der Erinnerung.
  const cron = (resetLauf.match(/cron:\s*'(\d+)\s+(\d+)\s/) || []);
  check('KRITISCH: die genannte Uhrzeit des naechtlichen Leerens ist die eingestellte',
    cron.length === 3 && new RegExp(`${cron[2].padStart(2, '0')}:${cron[1].padStart(2, '0')} UTC`).test(flach));
  check('KRITISCH: die Behauptung "jede Tabelle" stimmt mit dem Rechenkern ueberein',
    /DATABASE\(\)/.test(resetKern) && /jede Tabelle/i.test(flach));

  // Die Sitzung: in der Datenbank nur der Abdruck (ENT-501).
  check('KRITISCH: die Behauptung "nur ein Pruefwert der Sitzung" stimmt mit dem Code ueberein',
    /sitzung_abdruck/.test(lies('backend/db.php')) && /nur ein Pr(ue|\u00fc)fwert/i.test(flach));

  // Der Hinweis, der den Besucher schuetzt, muss stehen bleiben: Der
  // Zugang ist gemeinsam, also sieht jeder alles.
  check('KRITISCH: die Seite warnt davor, echte Personendaten einzutragen',
    /keine echten Personen-, Kunden- oder Objektdaten/i.test(flach));
}

// ══════════ GERENDERT ════════════════════════════════════════════════
const browser = await chromium.launch({ executablePath: browserPfad() });

// Farbwerte aus dem Cockpit, nicht aehnliche -- dieselbe Kopplung wie in
// test_homepage.mjs.
const dash = lies('dashboard.html');
const block = ab => { const i = dash.indexOf(ab); return i < 0 ? '' : dash.slice(i, dash.indexOf('}', i)); };
const marke = (b, n) => (b.match(new RegExp(`--${n}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1] || '';
const rgb = h => `rgb(${parseInt(h.slice(1,3),16)}, ${parseInt(h.slice(3,5),16)}, ${parseInt(h.slice(5,7),16)})`;
const hell = block(':root {');
const dunkel = block('html[data-thema="dunkel"] {');

for (const [datei, titel] of [['impressum.html', 'Impressum'], ['datenschutz.html', 'Datenschutz'],
                              ['datenschutz-demo.html', 'Datenschutz Demobereich']]) {
  for (const [breite, hoehe, wo] of [[1440, 900, 'Desktop'], [390, 844, 'Handy']]) {
    const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
    const fremde = [];
    seite.on('request', r => { if (/^https?:/.test(r.url())) { fremde.push(r.url()); } });
    await seite.goto(`file://${WURZEL}/${datei}`, { waitUntil: 'load' });

    check(`${titel} (${wo}): kein Abruf bei einem fremden Server`, fremde.length === 0);

    const ueberlauf = await seite.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${titel} (${wo}): kein waagrechter Ueberlauf`, ueberlauf <= 0);

    if (wo === 'Handy') {
      // Jedes Bedienelement mindestens 44 px hoch -- die Regel gilt auch fuer
      // eine reine Textseite: Die Verweise in Kopf und Fuss sind Bedienelemente.
      const zuKlein = await seite.evaluate(() =>
        [...document.querySelectorAll('header a, footer a')]
          .map(a => ({ t: a.textContent.trim().slice(0, 24), h: Math.round(a.getBoundingClientRect().height) }))
          .filter(x => x.h < 44));
      check(`${titel} (Handy): jeder Verweis in Kopf und Fuss ist mindestens 44 px hoch`, zuKlein.length === 0);
      if (zuKlein.length) { bad.push(`${titel}: zu klein — ` + zuKlein.map(x => `${x.t} ${x.h}px`).join(', ')); }

      const klein = await seite.evaluate(() =>
        parseFloat(getComputedStyle(document.body).fontSize));
      check(`${titel} (Handy): der Fliesstext ist mindestens 16 px gross`, klein >= 16);
    }

    if (wo === 'Desktop') {
      const gemessen = await seite.evaluate(() => {
        const k = document.querySelector('.kopf');
        const m = document.querySelector('.marke svg');
        const v = document.querySelector('.vorzeile');
        const h1 = document.querySelector('h1');
        return {
          kopfGrund: getComputedStyle(k).backgroundColor,
          bodyGrund: getComputedStyle(document.body).backgroundColor,
          vorzeileFarbe: getComputedStyle(v).color,
          markeBreite: m.getBoundingClientRect().width,
          markeHoehe: m.getBoundingClientRect().height,
          // Ueberschrift oben, Wert darunter: Die feine Versalzeile muss
          // UEBER dem Titel stehen, nicht darunter.
          vorzeileOben: v.getBoundingClientRect().top,
          titelOben: h1.getBoundingClientRect().top,
          titelSchrift: getComputedStyle(h1).fontFamily,
          vorzeileVersal: getComputedStyle(v).textTransform,
        };
      });
      check(`${titel}: der Kopf traegt den Nachtgrund des Cockpits (${marke(dunkel, 'bg')})`,
        gemessen.kopfGrund === rgb(marke(dunkel, 'bg')));
      check(`${titel}: der Seitengrund traegt den hellen Grund des Cockpits (${marke(hell, 'bg')})`,
        gemessen.bodyGrund === rgb(marke(hell, 'bg')));
      check(`${titel}: die Vorzeile traegt den hellen Akzent des Cockpits (${marke(hell, 'accent')})`,
        gemessen.vorzeileFarbe === rgb(marke(hell, 'accent')));
      // 460:593 aus dem Original -- ein gestauchtes Schild faellt sonst nur
      // jemandem auf, der es danebenhaelt.
      check(`${titel}: die Bildmarke behaelt ihr Seitenverhaeltnis (460:593)`,
        Math.abs(gemessen.markeBreite / gemessen.markeHoehe - 460 / 593) < 0.02);
      check(`${titel}: die Beschriftung steht UEBER dem Titel, nicht darunter`,
        gemessen.vorzeileOben < gemessen.titelOben);
      check(`${titel}: der Titel steht in der schmalen Anzeigeschrift`,
        /Archivo/.test(gemessen.titelSchrift));
      check(`${titel}: die Vorzeile ist versalgesetzt`, gemessen.vorzeileVersal === 'uppercase');

      // Die drei Schriften muessen wirklich geladen sein, nicht still auf den
      // System-Stapel zurueckfallen.
      const geladen = await seite.evaluate(() =>
        [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
      check(`${titel}: Archivo und IBM Plex Sans sind wirklich geladen`,
        geladen.includes('Archivo') && geladen.includes('IBM Plex Sans'));

      // Der Markenname steht im HTML, nicht in einem Skript (ENT-562).
      const namen = await seite.evaluate(() =>
        [...document.querySelectorAll('[data-brand]')].map(e => e.textContent.trim()));
      check(`${titel}: der Markenname steht ueberall gleich da`,
        namen.length >= 2 && new Set(namen).size === 1 && namen[0] === 'GuardOpS');
    }
    await seite.close();
  }
}

// Jeder Verweis zwischen den Seiten muss eine Datei treffen, die es gibt.
{
  const ziele = new Set();
  for (const inhalt of [impressum, datenschutz, dsDemo]) {
    for (const m of inhalt.matchAll(/href="([a-z0-9_.-]+\.(?:html|css))"/g)) { ziele.add(m[1]); }
  }
  const fehlend = [...ziele].filter(z => !existsSync(`${WURZEL}/${z}`));
  check('KRITISCH: jeder Verweis der Rechtsseiten trifft eine vorhandene Datei', fehlend.length === 0);
  if (fehlend.length) { bad.push('ins Leere: ' + fehlend.join(', ')); }
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
