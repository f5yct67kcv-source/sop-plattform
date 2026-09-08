// Das Kundenportal (ENT-441) -- die Seite, die beim Kunden landet.
//
// Geprüft wird am gerenderten Zustand, nicht im Quelltext:
//   1. Der Anmeldeweg: Adresse, Code, Liste. Und dass die Antwort auf eine
//      Code-Anforderung NICHT verrät, ob es den Zugang gibt.
//   2. Die drei leeren Zustände sagen drei VERSCHIEDENE Dinge -- und keiner
//      davon sagt "keine Rundgänge", wenn in Wahrheit kein Revierdienst
//      eingerichtet ist (Hausregel: „unbekannt darf nie wie keine aussehen").
//   3. Die Masse für das Handy: Bedienelemente mindestens 44 px hoch,
//      Eingabefelder mindestens 16 px Schrift (darunter zoomt iOS hinein).
//      Zusätzlich am Desktop geprüft, wie CLAUDE.md es verlangt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const SEITE = `file://${WURZEL}/portal.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Klicken mit kurzer Frist und ohne Absturz: Fehlt ein Element, weil eine
// Gegenprobe es entfernt hat, wartet page.click() dreissig Sekunden und
// reisst die Suite mit. Rot ist sie dadurch zwar, aber die Zusammenfassung
// mit den BENANNTEN Aussagen kommt nie -- und genau die braucht man, um zu
// sehen, WELCHE Zusage verletzt ist (derselbe Grund wie in
// test_arbeitsergebnisse.mjs).
async function klick(sel, seite) {
  try { await (seite || page).click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}
// Dasselbe fuer das Ausfuellen -- ein unsichtbares Feld laesst page.fill()
// genauso lange warten wie ein unsichtbarer Knopf page.click().
async function fuell(sel, wert, seite) {
  try { await (seite || page).fill(sel, wert, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht ausfuellbar: ' + sel); return false; }
}

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const VOLL = {
  status: 'ok', kunde: 'Muster Liegenschaften AG', person: 'A. Beispielperson',
  zeitraum: { von: vorTagen(30), bis: vorTagen(0) },
  objekte: [{ id: 1, name: 'Testliegenschaft Nord', strasse: 'Musterweg 1', ort: 'Musterort' }],
  rundgaenge: [
    { id: 10, datum: vorTagen(2), objekt_id: 1, objekt_name: 'Testliegenschaft Nord',
      status: 'abgeschlossen', beginn: `${vorTagen(2)} 22:04:00`,
      dauer: { sekunden: 2220, quelle: 'ende' },
      fortschritt: { gesamt: 6, erledigt: 6, bestaetigt: 6, ersatzscan: 0 } },
    { id: 11, datum: vorTagen(5), objekt_id: 1, objekt_name: 'Testliegenschaft Nord',
      status: 'abgebrochen', beginn: `${vorTagen(5)} 21:30:00`,
      dauer: { sekunden: 600, quelle: 'ende' },
      fortschritt: { gesamt: 6, erledigt: 2, bestaetigt: 2, ersatzscan: 0 } },
    // Vollstaendig, aber ein Punkt nur per Fotobeleg (ENT-329). Genau der
    // Fall, in dem ein gruener Balken die Unwahrheit saegte.
    { id: 12, datum: vorTagen(8), objekt_id: 1, objekt_name: 'Testliegenschaft Nord',
      status: 'abgeschlossen', beginn: `${vorTagen(8)} 23:12:00`,
      dauer: { sekunden: 1800, quelle: 'ende' },
      fortschritt: { gesamt: 6, erledigt: 6, bestaetigt: 5, ersatzscan: 1 } },
    // Runde ohne hinterlegte Kontrollpunkte: "0 von 0" mit leerem Balken
    // saehe aus wie „nichts erledigt" -- es ist aber „nicht bekannt, wie
    // viele es sein sollten".
    { id: 13, datum: vorTagen(11), objekt_id: 1, objekt_name: 'Testliegenschaft Nord',
      status: 'abgeschlossen', beginn: `${vorTagen(11)} 20:45:00`,
      dauer: { sekunden: 900, quelle: 'ende' },
      fortschritt: { gesamt: 0, erledigt: 0, bestaetigt: 0, ersatzscan: 0 } },
  ],
};
// Ein 1x1-PNG als Fotobeleg. Der Inhalt ist gleichgueltig -- geprueft wird,
// dass ueberhaupt ein Bild ankommt und nicht ein Platzhaltertext bleibt.
const FOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

// Die Detailantworten, je Runde eine -- und sie stimmen mit den Zahlen der
// Liste ueberein. Ein Beleg, der in der Liste „6 von 6" sagt und im Detail
// drei Punkte zeigt, prueft nichts; er verwirrt nur den, der das Bild
// ansieht.
//
// Alle drei tragen ABSICHTLICH vorname/nachname: Sollte der Server sie
// eines Tages doch mitschicken, muss die Oberflaeche sie trotzdem nicht
// anzeigen -- der Name haengt an OP-423 und ist nicht entschieden.
const punkt = (id, name, zustand, zeit, zusatz = {}) => ({
  id, bezeichnung: name, aufgaben: zusatz.aufgaben || [],
  erledigt: zustand === null ? null : {
    scan_id: 500 + id, status: zustand, erfasst_am: zeit,
    beschreibung: zusatz.beschreibung || null, hat_foto: !!zusatz.hat_foto,
  },
});
const rumpf = (id, tag, zusatz) => ({
  id, datum: tag, objekt_name: 'Testliegenschaft Nord',
  vorname: 'Vorname', nachname: 'Nachnamenstest',
  rohzeit_start: `${tag} 22:04:00`, rohzeit_ende: `${tag} 22:41:00`,
  letzter_scan: `${tag} 22:39:00`, pause_minuten: 0,
  dauer: { sekunden: 2220, quelle: 'rohzeit_ende' },
  ereignisse: [], ...zusatz,
});
const DETAILS = {
  // Runde 10: alle sechs Punkte technisch bestaetigt -- der glatte Fall.
  10: rumpf(10, vorTagen(2), {
    status: 'abgeschlossen',
    fortschritt: { gesamt: 6, erledigt: 6, bestaetigt: 6, ersatzscan: 0, nicht_verfuegbar: 0 },
    kontrollpunkte: [
      punkt(1, 'Eingang Nord', 'bestaetigt', `${vorTagen(2)} 22:07:00`),
      punkt(2, 'Tiefgarage', 'bestaetigt', `${vorTagen(2)} 22:11:00`,
        { aufgaben: [{ id: 9, bezeichnung: 'Türe verschliessen',
                       erledigt: { status: 'erledigt', grund: null } }] }),
      punkt(3, 'Veloraum', 'bestaetigt', `${vorTagen(2)} 22:16:00`),
      punkt(4, 'Treppenhaus West', 'bestaetigt', `${vorTagen(2)} 22:23:00`),
      punkt(5, 'Waschküche', 'bestaetigt', `${vorTagen(2)} 22:30:00`),
      punkt(6, 'Aussenbereich', 'bestaetigt', `${vorTagen(2)} 22:38:00`),
    ],
  }),
  // Runde 11: abgebrochen nach zwei Punkten -- vier wurden nie besucht.
  11: rumpf(11, vorTagen(5), {
    status: 'abgebrochen',
    fortschritt: { gesamt: 6, erledigt: 2, bestaetigt: 2, ersatzscan: 0, nicht_verfuegbar: 0 },
    kontrollpunkte: [
      punkt(1, 'Eingang Nord', 'bestaetigt', `${vorTagen(5)} 21:33:00`),
      punkt(2, 'Tiefgarage', 'bestaetigt', `${vorTagen(5)} 21:38:00`),
      punkt(3, 'Veloraum', null, null),
      punkt(4, 'Treppenhaus West', null, null),
      punkt(5, 'Waschküche', null, null),
      punkt(6, 'Rückseite Veloraum', null, null),
    ],
    ereignisse: [{ id: 77, erfasst_am: `${vorTagen(5)} 21:36:00`,
                   art: 'Sachbeschädigung', bemerkung: 'Scheibe im Treppenhaus beschädigt',
                   hat_foto: true }],
  }),
  // Runde 12: vollstaendig, aber ein Punkt nur per Fotobeleg.
  12: rumpf(12, vorTagen(8), {
    status: 'abgeschlossen',
    fortschritt: { gesamt: 6, erledigt: 6, bestaetigt: 5, ersatzscan: 1, nicht_verfuegbar: 0 },
    kontrollpunkte: [
      punkt(1, 'Eingang Nord', 'bestaetigt', `${vorTagen(8)} 23:15:00`),
      punkt(2, 'Tiefgarage', 'ersatzscan', `${vorTagen(8)} 23:22:00`,
        { beschreibung: 'Chip liess sich nicht lesen', hat_foto: true }),
      punkt(3, 'Veloraum', 'bestaetigt', `${vorTagen(8)} 23:27:00`),
      punkt(4, 'Treppenhaus West', 'bestaetigt', `${vorTagen(8)} 23:31:00`),
      punkt(5, 'Waschküche', 'bestaetigt', `${vorTagen(8)} 23:36:00`),
      punkt(6, 'Aussenbereich', 'bestaetigt', `${vorTagen(8)} 23:40:00`),
    ],
  }),
};

const leer = grund => ({
  status: 'ok', kunde: 'Muster Liegenschaften AG', person: 'A. Beispielperson',
  zeitraum: { von: vorTagen(30), bis: vorTagen(0) },
  objekte: [], rundgaenge: [], leer_grund: grund,
});

// Der Weg einer Runde (ENT-474). Veraenderlich, weil drei verschiedene
// Antworten drei verschiedene Texte ergeben muessen.
const WEG_VOLL = {
  status: 'ok', eingerichtet: true, aufbewahrung_tage: 90,
  punkte: [
    { lat: 47.05, lng: 7.62, genauigkeit_m: 6, erfasst_am: `${vorTagen(8)} 23:14:00` },
    { lat: 47.0505, lng: 7.6208, genauigkeit_m: 9, erfasst_am: `${vorTagen(8)} 23:20:00` },
    { lat: 47.0511, lng: 7.6215, genauigkeit_m: 9, erfasst_am: `${vorTagen(8)} 23:33:00` },
  ],
};
let wegAntwort = WEG_VOLL;

// Der Briefkopf fuers Rapportblatt (ENT-477). Erfundene Firma, erfundenes
// Logo -- echte Betriebsdaten haben in Testdaten nichts zu suchen.
const BRIEFKOPF = {
  status: 'ok',
  briefkopf: {
    firma: 'Musterfirma Sicherheitsdienst GmbH',
    zusatz: 'Musterweg 1 · 0000 Musterort',
    fusszeile: 'Musterfirma Sicherheitsdienst GmbH\nMusterweg 1, 0000 Musterort',
    fusszeile2: 'Telefon 000 000 00 00\ninfo@example.invalid',
    logo: 'data:image/png;base64,'
      + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  },
};
// Wie oft Google Maps angefragt wurde. Die Kernzusage von ENT-474 ist, dass
// das VOR dem Knopfdruck NIE passiert -- ein Zaehler ist dafuer der einzige
// belastbare Nachweis.
let kartenRufe = 0;

let antwort = VOLL;
let anmeldeFehler = false;
let pwFehler = null;
let calls = [];

// Attrappe fuer Google Maps. Ohne sie liefe die Pruefung ins Netz -- und
// eine Pruefung, die vom Netz abhaengt, prueft das Netz. Sie ahmt genau die
// vier Bausteine nach, die wegKarteBauen() benutzt, und haelt fest, was
// ankam: die Zahl der Punkte in der Linie und dass die Karte gebaut wurde.
const MAPS_ATTRAPPE = `
  window.__karteGebaut = 0; window.__pfadPunkte = 0; window.__marken = 0;
  window.google = { maps: {
    Map: function (el) { window.__karteGebaut++; el.dataset.karte = '1';
                         this.fitBounds = function () {}; },
    Polyline: function (o) { window.__pfadPunkte = (o.path || []).length; },
    Marker: function () { window.__marken++; },
    LatLngBounds: function () { this.extend = function () {}; },
    SymbolPath: { CIRCLE: 0 },
  } };`;

async function setup(page) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname.split('/api/')[1];
    calls.push({ path, rumpf: req.postData() });
    const send = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('portal_link_anfordern')) {
      // Der echte Endpunkt antwortet IMMER so -- auch für eine Adresse, zu
      // der es gar keinen Zugang gibt.
      return send({ status: 'ok', gueltig_minuten: 30,
        message: 'Wenn zu dieser Adresse ein Zugang besteht, ist die Nachricht unterwegs.' });
    }
    if (path.includes('portal_neues_passwort')) {
      if (pwFehler) { return send({ status: 'error', message: pwFehler }, 422); }
      return send({ status: 'ok', token: 't', name: 'A. Beispielperson',
        kunde: 'Muster Liegenschaften AG' });
    }
    if (path.includes('portal_anmelden')) {
      if (anmeldeFehler) {
        return send({ status: 'error',
          message: 'E-Mail-Adresse oder Passwort stimmt nicht.' }, 401);
      }
      return send({ status: 'ok', token: 't', name: 'A. Beispielperson',
        kunde: 'Muster Liegenschaften AG' });
    }
    if (path.includes('portal_briefkopf')) return send(BRIEFKOPF);
    if (path.includes('portal_rundgang_weg')) return send(wegAntwort);
    if (path.includes('portal_rundgang_detail')) {
      const id = Number(new URL(req.url()).searchParams.get('rundgang_id'));
      const d = DETAILS[id];
      // Der echte Endpunkt antwortet auf eine fremde oder laufende Runde mit
      // genau diesem 404 -- eine eigene Antwort je Fall waere ein
      // Auskunftsdienst darueber, welche Nummern es gibt.
      return d ? send({ status: 'ok', rundgang: d })
               : send({ status: 'error', message: 'Dieser Rundgang ist nicht abrufbar.' }, 404);
    }
    if (path.includes('portal_rundgang_foto')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: FOTO_PNG });
    }
    if (path.includes('portal_rundgaenge')) return send(antwort);
    if (path.includes('portal_abmelden')) return send({ status: 'ok' });
    return send({ status: 'ok' });
  });
  // NACH der API-Route registriert, und das ist keine Geschmacksfrage:
  // Playwright nimmt bei mehreren Treffern die ZULETZT gesetzte Route, und
  // das Muster "**/api/**" passt auch auf
  // maps.googleapis.com/maps/**api**/js. In der anderen Reihenfolge bekommt
  // das Maps-Skript JSON geliefert und stirbt mit "Unexpected token ':'" --
  // die Karte sieht dann aus, als liesse sie sich nicht laden, und man sucht
  // den Fehler im Portal statt in der Attrappe.
  await page.route('https://maps.googleapis.com/**', route => {
    kartenRufe++;
    return route.fulfill({ status: 200, contentType: 'application/javascript',
      body: MAPS_ATTRAPPE });
  });
}

// ── Die Farbkopie darf nicht auslaufen ───────────────────────────────
// portal.html traegt bewusst keinen Cockpit-Code (ENT-441 Punkt 8), die
// Verlaufs- und Glaswerte stehen darum als Kopie darin. Eine Kopie, die
// niemand vergleicht, laeuft beim naechsten Palettenwechsel auseinander --
// und man sieht es erst beim Kunden. Verglichen werden die WERTE, nicht der
// Wortlaut: Wo dashboard.html sie hinschreibt, ist ihm ueberlassen.
{
  const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
  const portal = readFileSync(`${WURZEL}/portal.html`, 'utf8');
  const werte = (text, name) => {
    const treffer = [...text.matchAll(new RegExp('--' + name + ':\\s*([^;]+);', 'g'))]
      .map(m => m[1].trim().replace(/\s+/g, ''));
    return [...new Set(treffer)].sort();
  };
  for (const name of ['glas-grund-1', 'glas-grund-2', 'glas-grund-3', 'glas-kachel',
                      'accent', 'accent-hi', 'warn']) {
    const d = werte(dash, name), p = werte(portal, name);
    check(`KRITISCH: --${name} ist im Portal derselbe Wert wie im Cockpit`,
      p.length > 0 && d.length > 0 && JSON.stringify(d) === JSON.stringify(p));
  }
  // Und die drei Kreise selbst: Groesse und Lage machen den Verlauf aus, die
  // Farbe allein waere ein anderer Grund.
  const kreise = t => [...t.matchAll(/radial-gradient\((\d+px \d+px at [^,]+),/g)].map(m => m[1].replace(/\s+/g, ' '));
  check('KRITISCH: die drei Verlaufskreise sitzen an derselben Stelle wie im Cockpit',
    JSON.stringify(kreise(portal)) === JSON.stringify(kreise(dash).slice(0, 3)));
}

const browser = await chromium.launch({ executablePath: EXE });

// ══ Handy ═══════════════════════════════════════════════════════════════
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);

check('Die Seite beginnt bei der Adresseingabe', await page.isVisible('#schritt-adresse'));
check('Die Rundgangliste ist vor der Anmeldung nicht sichtbar', !(await page.isVisible('#inhalt')));

// ── Masse auf dem Handy (CLAUDE.md) ──────────────────────────────────
const masse = await page.evaluate(() => {
  const el = s => document.querySelector(s);
  const h = s => Math.round(el(s).getBoundingClientRect().height);
  const f = s => parseFloat(getComputedStyle(el(s)).fontSize);
  return { email: { h: h('#email'), f: f('#email') }, knopf: h('#link-holen') };
});
check('KRITISCH: das Eingabefeld ist auf dem Handy mindestens 44 px hoch', masse.email.h >= 44);
check('KRITISCH: es hat mindestens 16 px Schrift (darunter zoomt iOS hinein)', masse.email.f >= 16);
check('KRITISCH: der Knopf ist mindestens 44 px hoch', masse.knopf >= 44);
// Ein Knopf wird nicht über die volle Breite gestreckt, nur weil er allein
// in seiner Zeile steht (Hausregel).
check('Der Knopf ist nicht über die volle Breite gestreckt',
  await page.evaluate(() => {
    const b = document.getElementById('link-holen').getBoundingClientRect();
    return b.width < document.body.getBoundingClientRect().width - 40;
  }));

// ── Anmeldeweg: erst das Passwort (der Normalfall) ───────────────────
check('Die Anmeldemaske fragt nach Passwort, nicht nach einem Code',
  await page.isVisible('#passwort') && await page.isVisible('#anmelden-pw'));
check('KRITISCH: das Passwortfeld verbirgt die Eingabe',
  await page.getAttribute('#passwort', 'type') === 'password');
// Der Codeweg steht daneben und ist beschriftet -- beim ersten Mal hat
// niemand ein Passwort, und wer eines vergessen hat, sucht genau hier.
check('Der Weg ueber einen Link ist von der Anmeldemaske aus erreichbar',
  await page.isVisible('#link-holen'));
// "Passwort vergessen" steht vorne: Sobald das Portal laeuft, ist das der
// haeufigere der beiden Faelle.
check('Der zweite Weg nennt zuerst das vergessene Passwort',
  /Passwort vergessen/.test(await page.textContent('#code-weg')));
check('Und er nennt auch den ersten Besuch, damit niemand ratlos bleibt',
  /zum ersten Mal/.test(await page.textContent('#code-weg')));
// KRITISCH: Die Seite fragt den Server NICHT, ob zu einer Adresse ein
// Passwort hinterlegt ist. Eine solche Auskunft verriete, dass es die
// Adresse gibt -- und damit, dass diese Firma Kunde ist.
{
  calls = [];
  await fuell('#email', 'irgendwer@example.invalid');
  await page.waitForTimeout(200);
  check('KRITISCH: das Eintippen der Adresse loest keine Abfrage beim Server aus',
    calls.length === 0);
  await fuell('#email', '');
}
check('Vor einem Fehlversuch steht der zweite Weg ruhig da',
  await page.evaluate(() => !document.getElementById('code-weg').classList.contains('hervor')));

await fuell('#email', 'a.beispiel@example.invalid');
await fuell('#passwort', 'ein sicheres langes wort');
calls = [];
await klick('#anmelden-pw');
await page.waitForTimeout(300);
{
  const an = calls.find(c => c.path.includes('portal_anmelden'));
  const rumpf = JSON.parse((an && an.rumpf) || '{}');
  check('KRITISCH: das Passwort geht an den Server, nicht ein Code',
    rumpf.passwort === 'ein sicheres langes wort' && rumpf.code === undefined);
}
check('Mit Passwort landet man direkt in der Liste', await page.isVisible('#inhalt'));

// Abmelden, damit der Codeweg von vorn geprueft werden kann.
await klick('#abmelden');
await page.waitForTimeout(250);
await klick('#wieder-anmelden');
await page.waitForTimeout(150);

// Nach einem fehlgeschlagenen Passwort-Versuch tritt der zweite Weg hervor --
// aus dem, was der Browser ohnehin weiss, nicht aus einer Serverauskunft.
{
  anmeldeFehler = true;
  await fuell('#email', 'a.beispiel@example.invalid');
  await fuell('#passwort', 'falschesPasswort123');
  await klick('#anmelden-pw');
  await page.waitForTimeout(300);
  check('KRITISCH: nach einem fehlgeschlagenen Passwort tritt der Weg zum Code hervor',
    await page.evaluate(() => document.getElementById('code-weg').classList.contains('hervor')));
  // Er WECHSELT dabei nicht die Stelle: Ein Element, das erst beim Fehler
  // erscheint, verschiebt alles darunter und laesst den Blick suchen.
  check('Und er stand vorher schon an derselben Stelle',
    await page.isVisible('#code-weg'));
  anmeldeFehler = false;
  await fuell('#passwort', '');
}

// ── Der zweite Weg: Link anfordern ───────────────────────────────────
// Ein FENSTER und kein weiterer Schritt: Die Anmeldemaske bleibt dahinter,
// und wer versehentlich geklickt hat, ist mit einem Schliessen zurueck.
await fuell('#email', 'a.beispiel@example.invalid');
await klick('#link-holen');
await page.waitForTimeout(200);
check('Der Klick öffnet ein Fenster', await page.isVisible('#anfrage-fenster'));
check('KRITISCH: die Anmeldemaske bleibt dahinter stehen und wechselt nicht',
  await page.isVisible('#schritt-adresse'));
// Was schon eingetippt war, wird nicht noch einmal verlangt.
check('Die bereits eingetippte Adresse ist übernommen',
  await page.inputValue('#anfrage-email') === 'a.beispiel@example.invalid');
check('KRITISCH: das Feld im Fenster ist 44 px hoch und hat 16 px Schrift',
  await page.evaluate(() => {
    const e = document.getElementById('anfrage-email');
    return e.getBoundingClientRect().height >= 44
        && parseFloat(getComputedStyle(e).fontSize) >= 16;
  }));

// Abbrechen fuehrt zurueck, ohne dass etwas passiert ist.
calls = [];
await klick('#anfrage-schliessen');
await page.waitForTimeout(150);
check('Abbrechen schliesst das Fenster, ohne etwas zu senden',
  !(await page.isVisible('#anfrage-fenster')) && calls.length === 0);

await klick('#link-holen');
await page.waitForTimeout(150);
calls = [];
await klick('#anfrage-senden');
await page.waitForTimeout(300);
{
  const an = calls.find(c => c.path.includes('portal_link_anfordern'));
  check('Die Anforderung erreicht den Server', !!an);
}
const fertigText = (await page.textContent('#anfrage-fertig')) || '';
check('KRITISCH: die Bestätigung behauptet nicht, dass der Zugang existiert',
  /Wenn zu .* ein Zugang besteht/.test(fertigText)
  && !/wurde gesendet|haben wir gesendet/.test(fertigText));
check('Sie nennt die Gültigkeitsdauer', /30 Minuten/.test(fertigText));
check('Und sie sagt, was ein Ausbleiben bedeutet',
  /kein Zugang hinterlegt/.test(fertigText));
await page.screenshot({ path: `${OUT}/portal-07-anfrage.png` });
await klick('#anfrage-zu');
await page.waitForTimeout(150);
check('Das Fenster lässt sich schliessen', !(await page.isVisible('#anfrage-fenster')));

// ── Der Link führt in die Passwortmaske ──────────────────────────────
// Der Token steht in der Adresszeile und muss SOFORT daraus verschwinden --
// er ist ein Geheimnis und hat weder im Verlauf noch in einem
// weitergegebenen Link etwas zu suchen.
await page.goto(SEITE + '?neu=einTestToken123');
await page.waitForTimeout(250);
check('KRITISCH: der Link führt direkt in die Passwortmaske',
  await page.isVisible('#schritt-passwort'));
check('KRITISCH: der Token ist sofort aus der Adresszeile entfernt',
  await page.evaluate(() => !location.search.includes('neu=')));
check('Beide Passwortfelder verbergen die Eingabe',
  await page.getAttribute('#pw-neu', 'type') === 'password'
  && await page.getAttribute('#pw-neu2', 'type') === 'password');

// Zwei verschiedene Eingaben faengt die Seite ab, ohne den Server zu fragen.
calls = [];
await fuell('#pw-neu', 'ein sicheres langes wort');
await fuell('#pw-neu2', 'ein anderes langes wort');
await klick('#pw-speichern');
await page.waitForTimeout(200);
check('KRITISCH: zwei verschiedene Eingaben werden gemeldet und nicht gesendet',
  await page.isVisible('#fehler-passwort')
  && !calls.some(c => c.path.includes('portal_neues_passwort')));

// Ein zu schwaches Passwort weist der SERVER ab -- seine Begruendung wird
// unveraendert gezeigt, nicht durch eine eigene ersetzt.
pwFehler = 'Das Passwort enthält ein zu naheliegendes Wort ("passwort").';
await fuell('#pw-neu', 'passwort123'); await fuell('#pw-neu2', 'passwort123');
await klick('#pw-speichern');
await page.waitForTimeout(250);
check('KRITISCH: die Begründung des Servers erscheint unverändert',
  (await page.textContent('#fehler-passwort')).includes('zu naheliegendes Wort'));
check('Und man bleibt auf der Maske, statt ohne Passwort weiterzukommen',
  await page.isVisible('#schritt-passwort'));

pwFehler = null;
calls = [];
await fuell('#pw-neu', 'ein sicheres langes wort');
await fuell('#pw-neu2', 'ein sicheres langes wort');
await klick('#pw-speichern');
await page.waitForTimeout(300);
{
  const setzen = calls.find(c => c.path.includes('portal_neues_passwort'));
  check('Das Passwort erreicht den Server', !!setzen);
  if (setzen) {
    const rumpf = JSON.parse(setzen.rumpf || '{}');
    check('KRITISCH: der Token aus dem Link geht mit, keine Zugangsnummer',
      rumpf.token === 'einTestToken123' && rumpf.passwort === 'ein sicheres langes wort'
      && rumpf.zugang_id === undefined && rumpf.kunde_id === undefined);
  }
}
// KRITISCH: Erst die Bestaetigung, dann die Uebersicht.
check('KRITISCH: nach dem Setzen kommt eine Bestätigung, nicht sofort die Liste',
  await page.isVisible('#pw-fertig') && !(await page.isVisible('#inhalt')));
const pwtext = await page.textContent('#pw-fertig');
check('KRITISCH: die Bestätigung sagt, dass das Passwort gesetzt ist',
  /Passwort ist gesetzt/.test(pwtext));
await klick('#pw-weiter');
await page.waitForTimeout(250);
check('Von dort geht es in die Liste', await page.isVisible('#inhalt'));

check('KRITISCH: der Kunde steht in der Kopfzeile — auf dem Handy sagt nur sie, wo man ist',
  (await page.textContent('#titel')).includes('Muster Liegenschaften AG'));

// ── Die Liste ────────────────────────────────────────────────────────
const liste = await page.textContent('#liste');
check('Eine abgeschlossene Runde ist als solche erkennbar', liste.includes('Abgeschlossen'));
// Ein Abbruch wird NICHT verschwiegen -- ein Nachweis, in dem das Fehlende
// fehlt, ist keiner.
check('KRITISCH: eine abgebrochene Runde erscheint ebenfalls', liste.includes('Abgebrochen'));
check('Die Kontrollpunkte stehen mit Bezug da, nicht als nackte Zahl',
  /6 von 6 Kontrollpunkten/.test(liste) && /2 von 6 Kontrollpunkten/.test(liste));
// Zwei Einheiten, zwei Zeilen: "Rundgänge" zählt Runden, "Kontrollpunkte"
// zählt Punkte darin (Hausregel: Einheiten nie vermischen).
const anzahl = await page.textContent('#anzahl');
check('KRITISCH: die Zahl bekommt einen Bezug, weil ein Zeitraum greift',
  /4 Rundgänge vom/.test(anzahl) && /1 Objekt/.test(anzahl));

// ── Beginn und Dauer (ENT-449) ───────────────────────────────────────
// Das Datum allein sagt nicht, dass nachts kontrolliert wurde -- der
// Beginn sagt es. Beide Werte tragen eine Beschriftung: "22:04" ohne Wort
// koennte auch das Ende sein.
check('Der Beginn der Runde steht mit Beschriftung da', /Beginn 22:04 Uhr/.test(liste));
check('Die Dauer ebenfalls', /Dauer 0:37 h/.test(liste));

// ── Der Fortschrittsbalken (ENT-449) ─────────────────────────────────
// Gemessen, nicht im Quelltext nachgelesen: Der Fuellstand muss dem
// Verhaeltnis erledigt/gesamt entsprechen. Ein Balken, dessen Breite nicht
// aus den Zahlen folgt, ist eine Verzierung.
const balken = async (p) => p.evaluate(() => [...document.querySelectorAll('#liste .zeile')].map(z => {
  const b = z.querySelector('.balken');
  if (!b) { return null; }
  const f = b.querySelector('.fuell');
  return {
    spur: Math.round(b.getBoundingClientRect().width),
    gefuellt: Math.round(f.getBoundingClientRect().width),
    farbe: getComputedStyle(f).backgroundColor,
    grund: getComputedStyle(b).backgroundColor,
  };
}));
const bHandy = await balken(page);
check('KRITISCH: eine vollständige Runde füllt den Balken ganz',
  bHandy[0] && bHandy[0].spur > 0 && bHandy[0].gefuellt >= bHandy[0].spur - 1);
check('KRITISCH: eine Runde mit 2 von 6 füllt ihn zu einem Drittel — gemessen',
  bHandy[1] && Math.abs(bHandy[1].gefuellt / bHandy[1].spur - 1 / 3) < 0.04);
// Ein Balken ohne sichtbaren Grund waere bei 0 % gar kein Balken -- und
// „nichts erledigt" saehe aus wie „keine Angabe" (Hausregel).
const grundKanaele = (bHandy[0].grund.match(/[\d.]+/g) || []).map(Number);
check('KRITISCH: der Balken hat einen sichtbaren Grund, nicht nur eine Füllung',
  grundKanaele.length >= 4 ? grundKanaele[3] > 0.05 : grundKanaele.length === 3);

// Die Farbe ist eine Aussage, keine Verzierung: Vollständig UND technisch
// bestätigt ist grün. Vollständig mit Fotobeleg ist es NICHT -- sonst
// verschwände der Unterschied, den ENT-329 gerade sichtbar machen wollte.
check('KRITISCH: eine vollständige Runde MIT Fotobeleg ist anders eingefärbt als eine ohne',
  bHandy[2] && bHandy[2].farbe !== bHandy[0].farbe);
check('KRITISCH: und eine abgebrochene wieder anders als beide',
  bHandy[1] && bHandy[1].farbe !== bHandy[0].farbe && bHandy[1].farbe !== bHandy[2].farbe);
// Grün ist die einzige Farbe, in der der Grünanteil führt -- so bleibt die
// Prüfung an der Aussage und nicht am Farbwert.
const kanal = f => (f.match(/\d+/g) || []).slice(0, 3).map(Number);
const [r0, g0, b0] = kanal(bHandy[0].farbe);
check('KRITISCH: die vollständig bestätigte Runde ist wirklich grün', g0 > r0 && g0 > b0);
const [r2, g2] = kanal(bHandy[2].farbe);
check('KRITISCH: die Runde mit Fotobeleg ist es nicht', !(g2 > r2));

// Der Fotobeleg steht sichtbar daneben und verschwindet nicht unter
// „erledigt".
check('KRITISCH: der Fotobeleg wird ausgewiesen, nicht unter „erledigt" versteckt',
  /6 von 6 Kontrollpunkten erledigt/.test(liste) && /1 davon mit Fotobeleg/.test(liste));
check('Und er ist farblich abgesetzt', await page.evaluate(() => {
  const z = document.querySelectorAll('#liste .zeile')[2];
  const p = z.querySelector('.punkte'), b = z.querySelector('.punkte .beleg');
  return !!b && getComputedStyle(b).color !== getComputedStyle(p).color;
}));

// Ohne hinterlegte Kontrollpunkte gibt es keinen Fuellstand. Ein Balken bei
// null waere hier die falsche Auskunft: „nichts erledigt" statt „nicht
// bekannt, wie viele es sein sollten" (Hausregel: unbekannt ist nicht
// keine).
check('KRITISCH: ohne hinterlegte Kontrollpunkte steht kein Balken bei null da',
  bHandy[3] === null);
check('KRITISCH: sondern der Grund, warum es keine Zahl gibt',
  /keine Kontrollpunkte hinterlegt/.test(liste) && !/0 von 0/.test(liste));

// Auf dem Handy liegt der Fortschritt unter dem Objekt und ueber die volle
// Breite -- rechts eingezwaengt waere der Balken 40 px breit und damit
// nicht mehr ablesbar.
check('KRITISCH: auf dem Handy steht der Balken über die volle Zeilenbreite',
  await page.evaluate(() => {
    const z = document.querySelector('#liste .zeile');
    return z.querySelector('.fortschritt').getBoundingClientRect().width
         >= z.getBoundingClientRect().width - 1;
  }));
// Beginn und Dauer sind zusammen eine feste, kurze Angabe -- sie darf auf
// 390 px nicht umbrechen. Ein Umbruch laesst hier ein einzelnes "h" auf der
// naechsten Zeile stehen; im Quelltext sieht man das nicht.
check('KRITISCH: die Zeile mit Beginn und Dauer bricht auf dem Handy nicht um',
  await page.evaluate(() => {
    const m = document.querySelector('#liste .zeile .meta');
    const eine = parseFloat(getComputedStyle(m).lineHeight);
    return m.getBoundingClientRect().height < eine * 1.6;
  }));

// ── Gemessen: gleiches Muster auf beiden Seiten (CLAUDE.md) ──────────
// Der Zustand gehoert RECHTS und nicht unter das Datum. Ohne die
// ausdrueckliche Rasterzuweisung rutscht das dritte Kind auf dem Handy in
// die naechste Zeile und steht linksbuendig da -- es sieht nicht kaputt aus,
// ist aber ein zweites Muster neben dem am Desktop.
const lage = async (p) => p.evaluate(() => {
  const z = document.querySelector('#liste .zeile');
  const d = z.querySelector('.datum').getBoundingClientRect();
  const r = z.querySelector('.rechts').getBoundingClientRect();
  return { datumRechts: d.right, markeLinks: r.left,
           datumMitte: d.top + d.height / 2, markeOben: r.top, markeUnten: r.bottom };
});
const lHandy = await lage(page);
check('KRITISCH: der Zustand steht rechts vom Datum, nicht darunter (Handy)',
  lHandy.markeLinks > lHandy.datumRechts);
check('KRITISCH: und auf derselben Hoehe wie das Datum (Handy)',
  lHandy.datumMitte >= lHandy.markeOben && lHandy.datumMitte <= lHandy.markeUnten);
// Der Abmeldeknopf gehoert auf beiden Breiten an dieselbe Stelle -- rechts.
check('Der Abmeldeknopf steht auch auf dem Handy rechts',
  await page.evaluate(() => {
    const k = document.getElementById('abmelden').getBoundingClientRect();
    const b = document.querySelector('.buehne').getBoundingClientRect();
    return b.right - k.right < 30;
  }));

await page.screenshot({ path: `${OUT}/portal-01-handy.png` });

// ══ Aufklappbares Detail (ENT-455) ══════════════════════════════════════
// Gefordert war ausdruecklich ein Aufklapper „auf derselben Zeilenbreite",
// kein Fenster. Das wird GEMESSEN: Die Tafel muss unter ihrer Zeile liegen
// und dieselbe Breite haben -- im Quelltext saehe man das nicht.
await klick('#liste .zeile');
await page.waitForTimeout(300);
const lage1 = await page.evaluate(() => {
  const z = document.querySelector('#liste .zeile');
  const t = z.nextElementSibling;
  if (!t || !t.classList.contains('detail')) { return null; }
  const a = z.getBoundingClientRect(), b = t.getBoundingClientRect();
  return { unter: b.top >= a.bottom - 1, links: Math.abs(a.left - b.left),
           breite: Math.abs(a.width - b.width), hoehe: b.height };
});
check('KRITISCH: der Klick öffnet eine Tafel DIREKT UNTER der Zeile, kein Fenster',
  !!lage1 && lage1.unter);
check('KRITISCH: und sie steht auf derselben Zeilenbreite',
  !!lage1 && lage1.links <= 1 && lage1.breite <= 1);
check('Die Tafel hat auch Inhalt, nicht nur Höhe null', !!lage1 && lage1.hoehe > 80);
check('Die Zeile meldet dem Vorleseprogramm, dass sie offen ist',
  (await page.getAttribute('#liste .zeile', 'aria-expanded')) === 'true');

const detail = await page.textContent('#liste .detail');
// Der Kern des Wunsches: „man sieht, wann welcher Punkt genommen worden ist".
check('KRITISCH: jeder Kontrollpunkt steht mit seiner Uhrzeit da',
  /22:07/.test(detail) && /Eingang Nord/.test(detail)
  && /22:38/.test(detail) && /Aussenbereich/.test(detail));
check('Die Aufgabe unter dem Kontrollpunkt steht mit ihrem Zustand da',
  /Türe verschliessen/.test(detail) && /Erledigt/.test(detail));
// „Kein Ereignis gemeldet" ist eine Aussage, ein fehlender Abschnitt keine.
check('KRITISCH: ohne Ereignisse steht der Satz da, nicht eine leere Fläche',
  /kein Ereignis gemeldet/.test(detail));
// Kennzahlen: Beschriftung oben, Wert darunter (Hausregel) -- gemessen.
check('KRITISCH: im Kennzahlenband steht die Beschriftung ÜBER dem Wert',
  await page.evaluate(() => {
    const k = document.querySelector('#liste .detail .kennzahlen > div');
    return k.querySelector('.k-l').getBoundingClientRect().bottom
        <= k.querySelector('.k-v').getBoundingClientRect().top + 1;
  }));
check('Start, Ende, Dauer und Kontrollpunkte stehen als vier Blöcke da',
  await page.evaluate(() =>
    document.querySelectorAll('#liste .detail .kennzahlen > div').length === 4));
check('KRITISCH: auf dem Handy stehen sie zu zweit nebeneinander, nicht zu viert',
  await page.evaluate(() => {
    const k = [...document.querySelectorAll('#liste .detail .kennzahlen > div')]
      .map(e => Math.round(e.getBoundingClientRect().top));
    return new Set(k).size === 2;
  }));
// Der Faden verbindet die Knoten. Ohne align-self:stretch faellt er in einem
// Raster mit align-items:start auf null zusammen: Die Punkte stehen da, die
// Linie dazwischen fehlt -- am Bild aufgefallen, im Quelltext unsichtbar.
check('KRITISCH: der Faden zwischen den Kontrollpunkten ist wirklich zu sehen',
  await page.evaluate(() => [...document.querySelectorAll('#liste .detail .v-faden')]
    .every(f => f.getBoundingClientRect().height > 10)));

// Der Name der eingesetzten Person bleibt draussen, solange OP-423 offen ist
// -- und zwar AUCH DANN, wenn der Server ihn mitschicken sollte. Der Beleg
// trägt ihn absichtlich.
check('KRITISCH: kein Personenname im Detail — auch wenn die Antwort einen trägt (OP-423)',
  !/Nachnamenstest/.test(detail) && !/Vorname/.test(detail));

// ── Zweite Runde: abgebrochen, vier Punkte nie besucht ───────────────
await page.evaluate(() => document.querySelectorAll('#liste .zeile')[1].click());
await page.waitForTimeout(300);
const detail2 = await page.evaluate(() =>
  document.querySelectorAll('#liste .zeile')[1].nextElementSibling.textContent);
// Ein Nachweis, in dem das Fehlende fehlt, ist keiner.
check('KRITISCH: nicht besuchte Punkte erscheinen ebenfalls und sind als solche benannt',
  /Waschküche/.test(detail2) && /Nicht besucht/.test(detail2));
check('KRITISCH: ein gemeldetes Ereignis erscheint mit Zeit und Art',
  /21:36/.test(detail2) && /Sachbeschädigung/.test(detail2));

// ── Dritte Runde: vollständig, aber mit Fotobeleg ────────────────────
await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
await page.waitForTimeout(500);
const detail3 = await page.evaluate(() =>
  document.querySelectorAll('#liste .zeile')[2].nextElementSibling.textContent);
check('Ein Fotobeleg heisst im Portal „Fotobeleg", nicht „Ersatzscan"',
  /Fotobeleg/.test(detail3) && !/Ersatzscan/.test(detail3));
check('KRITISCH: und der Hinweis sagt, was das bedeutet — nicht technisch bestätigt',
  /nicht technisch|statt technisch/.test(detail3));
check('KRITISCH: der Fotobeleg erscheint als Bild, nicht als Platzhaltertext',
  await page.evaluate(() => {
    const b = document.querySelectorAll('#liste .zeile')[2]
      .nextElementSibling.querySelector('.v-foto img');
    return !!b && b.naturalWidth > 0;
  }));
// Mehrere dürfen offen sein: Ein Aufklapper, der beim Öffnen einen anderen
// zuklappt, nimmt gerade das weg, wofür man ihn öffnet.
check('Ein zweiter und dritter Aufklapper schliessen die vorigen nicht',
  await page.evaluate(() => document.querySelectorAll('#liste .detail').length === 3));

// ══ Der Weg auf der Karte (ENT-474) ═════════════════════════════════════
// DIE KERNZUSAGE: Er kommt erst auf den Knopf. Das ist keine Bequemlichkeit,
// sondern der Grund, aus dem der Projektinhaber ENT-441 Punkt 3 überhaupt
// nur so weit revidiert hat. Drei Runden sind hier aufgeklappt — wäre die
// Spur Teil des Details, stünde sie längst dreifach geladen da.
check('KRITISCH: das Aufklappen lädt die Bewegungsspur NICHT',
  !calls.some(c => c.path.includes('portal_rundgang_weg')));
check('KRITISCH: und Google wird dabei überhaupt nicht angefragt', kartenRufe === 0);
check('Der Hinweis sagt vorher, dass die Karte von Google kommt',
  /von Google/.test(detail3));
// Auf dem Handy gilt dasselbe Mass wie für jedes andere Bedienelement.
// Ohne Null-Absicherung stuerzt diese Zusage ab, statt sich zu melden, wenn
// der Knopf fehlt -- und dann kommt die Zusammenfassung mit den BENANNTEN
// Aussagen nie. Bei der Gegenprobe genau so passiert.
check('KRITISCH: der Knopf ist auf dem Handy mindestens 44 px hoch',
  await page.evaluate(() => {
    const k = document.querySelector('[data-weg]');
    return !!k && k.getBoundingClientRect().height >= 44;
  }));

await klick('[data-weg="12"]');
await page.waitForTimeout(500);
check('KRITISCH: erst der Knopf holt den Weg',
  calls.some(c => c.path.includes('portal_rundgang_weg')));
check('KRITISCH: und erst dann wird Google angefragt', kartenRufe === 1);
const karte = await page.evaluate(() => ({
  gebaut: window.__karteGebaut, punkte: window.__pfadPunkte, marken: window.__marken,
  behaelter: !!document.querySelector('#liste .detail .weg-karte[data-karte]'),
  fuss: (document.querySelector('#liste .detail .weg-fuss') || {}).textContent || '',
}));
check('KRITISCH: die Karte wird gebaut und der Weg als Linie darauf gezeichnet',
  karte.gebaut === 1 && karte.behaelter && karte.punkte === 3);
// Eine Linie allein sagt nicht, in welche Richtung gelaufen wurde.
check('Anfang und Ende sind markiert', karte.marken === 2);
// Die Genauigkeit gehört dazu: Ein Punkt mit 80 m Streuung sieht auf der
// Karte genauso scharf aus wie einer mit 5 m.
check('KRITISCH: der Fuss nennt Messpunkte UND Genauigkeit — ohne sie zieht man Schlüsse, die die Messung nicht hergibt',
  /3 Messpunkte/.test(karte.fuss) && /± 8 m/.test(karte.fuss));
check('Und die Aufbewahrungsfrist', /90 Tage/.test(karte.fuss));
await page.screenshot({ path: `${OUT}/portal-10-weg-handy.png` });

// Die Frist steht NICHT als Zahl im Anzeigetext: Stünde sie an zwei Orten,
// liefen Server und Oberfläche auseinander und die Seite behauptete eine
// Frist, die nicht gilt.
wegAntwort = { ...WEG_VOLL, aufbewahrung_tage: 45 };
await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
await page.waitForTimeout(400);
await klick('[data-weg="12"]');
await page.waitForTimeout(400);
check('KRITISCH: die Aufbewahrungsfrist kommt vom Server, nicht aus dem Text',
  /45 Tage/.test(await page.evaluate(() => {
    const f = document.querySelector('#liste .detail .weg-fuss');
    return f ? f.textContent : '';
  })));

// Drei verschiedene Aussagen, drei verschiedene Texte (Hausregel).
const wegText = async (fall) => {
  wegAntwort = fall;
  await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
  await page.waitForTimeout(400);
  await klick('[data-weg="12"]');
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const t = document.querySelectorAll('#liste .zeile')[2].nextElementSibling;
    const h = t && t.querySelector('.weg-huelle');
    return h ? h.textContent : '(keine Weg-Hülle)';
  });
};
const ohnePunkte = await wegText({ status: 'ok', eingerichtet: true, aufbewahrung_tage: 90, punkte: [] });
check('KRITISCH: „kein Weg aufgezeichnet" sagt auch, warum das sein kann',
  /kein Weg aufgezeichnet/.test(ohnePunkte)
  && /vor der Aufzeichnung|keinen Standort/.test(ohnePunkte));
const nichtEing = await wegText({ status: 'ok', eingerichtet: false, aufbewahrung_tage: 90, punkte: [] });
check('KRITISCH: „noch nicht eingerichtet" ist ein ANDERER Text als „kein Weg vorhanden"',
  nichtEing !== ohnePunkte && /noch nicht\s+aufgezeichnet/.test(nichtEing));
// Dem Kunden wird nicht erzählt, dass im Betrieb eine Einrichtung fehlt --
// das ist eine Auskunft über den Betrieb und geht ihn nichts an.
check('KRITISCH: und er verrät dem Kunden nichts über den Zustand des Betriebs',
  !/Einrichtung|einrichten|Datenbank|Tabelle/i.test(nichtEing));
wegAntwort = WEG_VOLL;

// ══ Das Rapportblatt als PDF (ENT-477) ══════════════════════════════════
// Der Kunde holt sich hier dasselbe Blatt, das er heute per Mail bekommt.
calls = [];
// Den Zwischenspeicher des Briefkopfs leeren: Ohne das kann die Zusage
// „beim Aufklappen wird er nicht geholt" gar nicht anschlagen -- ein früherer
// Aufruf hätte ihn längst abgelegt, und die Prüfung wäre eine Behauptung.
await page.evaluate(() => { briefkopf = null; });
await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelectorAll('#liste .zeile')[2].click());
await page.waitForTimeout(500);

// html2pdf wiegt rund 950 KB. Wer nur liest, soll es nie laden -- dasselbe
// Muster wie bei der Karte, und aus demselben Grund gemessen statt behauptet.
check('KRITISCH: html2pdf wird beim Aufklappen NICHT geladen',
  await page.evaluate(() =>
    !document.querySelector('script[src*="html2pdf"]')));
check('KRITISCH: und der Briefkopf ebenso wenig',
  !calls.some(c => c.path.includes('portal_briefkopf')));
check('KRITISCH: der PDF-Knopf ist auf dem Handy mindestens 44 px hoch',
  await page.evaluate(() => {
    const k = document.querySelector('[data-pdf]');
    return !!k && k.getBoundingClientRect().height >= 44;
  }));
// Ein Knopf wird NICHT über die volle Breite gestreckt, nur weil er allein
// in seiner Zeile steht (Hausregel) -- gemessen, nicht nachgelesen.
check('KRITISCH: und er ist nicht über die volle Breite gestreckt',
  await page.evaluate(() => {
    const k = document.querySelector('[data-pdf]');
    const t = k.closest('.detail');
    return k.getBoundingClientRect().width < t.getBoundingClientRect().width - 40;
  }));

// html2pdf wird hier WIRKLICH geladen und erzeugt ein echtes PDF -- eine
// Attrappe prüfte nur, dass wir sie richtig aufrufen, nicht dass am Ende
// eine Datei herauskommt.
const dlVersprechen = page.waitForEvent('download', { timeout: 40000 }).catch(() => null);
await klick('[data-pdf="12"]');
const datei = await dlVersprechen;
check('KRITISCH: der Knopf erzeugt tatsächlich eine Datei', !!datei);
check(`Und zwar ein PDF mit sprechendem Namen (${datei ? datei.suggestedFilename() : '–'})`,
  !!datei && /^Rapport-.+-\d{4}-\d{2}-\d{2}\.pdf$/.test(datei.suggestedFilename()));
check('KRITISCH: erst der Klick lädt html2pdf nach',
  await page.evaluate(() => !!document.querySelector('script[src*="html2pdf"]')));
check('Und holt den Briefkopf', calls.some(c => c.path.includes('portal_briefkopf')));

const blatt = await page.textContent('#blatt');
check('Das Blatt trägt den Briefkopf des Betriebs',
  /Musterfirma Sicherheitsdienst/.test(blatt));
check('KRITISCH: es nennt Objekt, Kontrollrunde, Zeiten und Zustand',
  /Testliegenschaft Nord/.test(blatt) && /Kontrollrunde/.test(blatt)
  && /23:15/.test(blatt) && /Abgeschlossen/.test(blatt));
check('KRITISCH: jeder Kontrollpunkt steht mit seiner Uhrzeit im Blatt',
  /Eingang Nord/.test(blatt) && /Aussenbereich/.test(blatt) && /23:40/.test(blatt));
check('Der Fotobeleg wird im Blatt ausgewiesen und erklärt',
  /Fotobeleg/.test(blatt) && /statt technischer Bestätigung/.test(blatt));
check('KRITISCH: „kein Ereignis gemeldet" steht auch im Blatt, nicht ein fehlender Abschnitt',
  /kein Ereignis gemeldet/.test(blatt));
// Der Beleg trägt absichtlich einen Namen. Er darf im Blatt nicht auftauchen.
check('KRITISCH: KEIN Personenname im Blatt — auch wenn die Antwort einen trägt (OP-423)',
  !/Nachnamenstest/.test(blatt) && !/Vorname/.test(blatt));
// ENT-322 gilt unverändert: Der Weg gehört ins Portal, wo der Kunde ihn
// ausdrücklich aufruft — nicht auf ein Blatt, das er beiläufig mitbekommt.
check('KRITISCH: KEINE Karte im Blatt (ENT-322 bleibt)',
  !/Weg während der Runde/.test(blatt)
  && await page.evaluate(() => !document.querySelector('#blatt .weg-karte, #blatt iframe')));
// Das Blatt entsteht in einem eigenen Behälter, nicht als Abzug der Tafel.
check('KRITISCH: das Blatt steht ausserhalb des Bildes, aber nicht auf display:none',
  await page.evaluate(() => {
    const h = document.getElementById('blattHuelle');
    return getComputedStyle(h).display !== 'none'
        && h.getBoundingClientRect().right < 0
        && document.getElementById('blatt').getBoundingClientRect().height > 100;
  }));

// Der Briefkopf wird EINMAL geholt, nicht bei jedem Blatt.
calls = [];
const dl2 = page.waitForEvent('download', { timeout: 40000 }).catch(() => null);
await klick('[data-pdf="12"]');
await dl2;
check('KRITISCH: der Briefkopf wird nur einmal geholt, nicht bei jedem PDF',
  !calls.some(c => c.path.includes('portal_briefkopf')));

await page.screenshot({ path: `${OUT}/portal-08-detail-handy.png` });

// Erst alles zuklappen, damit die naechste Zusage bei null anfaengt.
await page.evaluate(() => document.querySelectorAll('#liste .zeile.offen').forEach(z => z.click()));
await page.waitForTimeout(200);
check('Alle Tafeln lassen sich wieder schliessen',
  await page.evaluate(() => document.querySelectorAll('#liste .detail').length === 0));

// Unter dem letzten Eintrag der Liste haengt kein Trennstrich -- in BEIDEN
// Zustaenden. Genau darum wird die Tafel beim Zuklappen entfernt und nicht
// versteckt: Ein verstecktes Element zaehlt fuer :last-child weiter mit,
// und die letzte Zeile behielte dann einen Strich ins Leere.
const letzterStrich = () => page.evaluate(() => {
  const k = document.querySelectorAll('#liste > *');
  const e = k[k.length - 1];
  return { was: e.className, strich: parseFloat(getComputedStyle(e).borderBottomWidth) };
});
const zuStand = await letzterStrich();
check('KRITISCH: unter dem letzten Eintrag haengt kein Trennstrich (zugeklappt)',
  zuStand.was.includes('zeile') && zuStand.strich === 0);
await page.evaluate(() => {
  const z = document.querySelectorAll('#liste .zeile');
  z[z.length - 1].click();
});
await page.waitForTimeout(300);
const aufStand = await letzterStrich();
check('KRITISCH: und auch nicht, wenn die letzte Zeile offen ist',
  aufStand.was.includes('detail') && aufStand.strich === 0);
await page.evaluate(() => document.querySelectorAll('#liste .zeile.offen').forEach(z => z.click()));
await page.waitForTimeout(200);

// Zuklappen. Die Tafel wird ENTFERNT und nicht versteckt -- sonst zählte
// sie für :last-child weiter mit und die letzte Zeile behielte einen Strich.
await klick('#liste .zeile');
await page.waitForTimeout(300);
await klick('#liste .zeile');
await page.waitForTimeout(200);
check('KRITISCH: ein zweiter Klick klappt wieder zu',
  await page.evaluate(() => document.querySelectorAll('#liste .detail').length === 0));
check('Und die Zeile meldet das auch',
  (await page.getAttribute('#liste .zeile', 'aria-expanded')) === 'false');

// Eine Zeile, die nur die Maus öffnet, ist für die Tastatur eine Sackgasse.
await page.focus('#liste .zeile');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('KRITISCH: die Zeile lässt sich auch mit der Tastatur öffnen',
  await page.evaluate(() => document.querySelectorAll('#liste .detail').length === 1));
// Mehrere dürfen offen sein: Ein Aufklapper, der beim Öffnen einen anderen
// zuklappt, nimmt gerade das weg, wofür man ihn öffnet.
await page.evaluate(() => document.querySelectorAll('#liste .zeile.offen').forEach(z => z.click()));
await page.waitForTimeout(200);

// ── Die drei leeren Zustände ─────────────────────────────────────────
const texte = {};
for (const grund of ['kein_revierdienst', 'noch_nichts_erfasst', 'kein_treffer_im_zeitraum']) {
  antwort = leer(grund);
  await page.evaluate(() => laden());
  await page.waitForTimeout(200);
  texte[grund] = await page.textContent('#liste');
}
check('KRITISCH: "kein Revierdienst eingerichtet" sagt genau das',
  /Kein Revierdienst eingerichtet/.test(texte.kein_revierdienst));
// Und es sagt ausdrücklich, dass daraus KEINE Aussage über die Leistung folgt.
check('KRITISCH: und es behauptet nicht, es sei nicht gearbeitet worden',
  /keine Leistung erbracht/.test(texte.kein_revierdienst));
check('KRITISCH: "noch nichts erfasst" ist eine eigene Aussage',
  /Noch keine Rundgänge erfasst/.test(texte.noch_nichts_erfasst));
check('KRITISCH: "kein Treffer im Zeitraum" ist eine eigene Aussage',
  /Keine Rundgänge im gewählten Zeitraum/.test(texte.kein_treffer_im_zeitraum));
check('KRITISCH: die drei sagen drei VERSCHIEDENE Dinge',
  texte.kein_revierdienst !== texte.noch_nichts_erfasst
  && texte.noch_nichts_erfasst !== texte.kein_treffer_im_zeitraum
  && texte.kein_revierdienst !== texte.kein_treffer_im_zeitraum);
// Keiner der drei darf wie der andere klingen -- vor allem darf bei
// fehlendem Revierdienst nicht "keine Rundgänge" stehen.
check('KRITISCH: bei fehlendem Revierdienst steht nicht "keine Rundgänge"',
  !/[Kk]eine Rundgänge/.test(texte.kein_revierdienst));

// ── Abmelden ─────────────────────────────────────────────────────────
antwort = VOLL;
await page.evaluate(() => laden());
await page.waitForTimeout(200);
calls = [];
await klick('#abmelden');
await page.waitForTimeout(250);
check('Das Abmelden erreicht den Server (der Token wird dort gelöscht)',
  calls.some(c => c.path.includes('portal_abmelden')));
// KRITISCH: Nicht zurueck zur Anmeldemaske. Die sieht aus, als sei die
// Abmeldung fehlgeschlagen und man muesse es erneut versuchen -- und man
// weiss nicht, ob man das Fenster jetzt schliessen darf.
check('KRITISCH: nach dem Abmelden kommt eine Bestätigung, nicht wieder die Anmeldemaske',
  await page.isVisible('#abgemeldet') && !(await page.isVisible('#schritt-adresse')));
const abtext = await page.textContent('#abgemeldet');
check('KRITISCH: die Bestätigung sagt, dass die Abmeldung geklappt hat',
  /erfolgreich abgemeldet/.test(abtext));
check('KRITISCH: und dass man das Fenster jetzt schliessen kann',
  /schliessen/.test(abtext));
check('Von dort führt ein Weg zurück zur Anmeldung', await page.isVisible('#wieder-anmelden'));
// Auch dieser Knopf steht allein in seiner Zeile und wird darum NICHT ueber
// die volle Breite gestreckt (Hausregel). Zentriert sieht am Bild breiter
// aus, als er ist -- darum gemessen und nicht nach Augenschein beurteilt.
check('Der Knopf der Bestätigung ist nicht über die volle Breite gestreckt',
  await page.evaluate(() => {
    const k = document.getElementById('wieder-anmelden').getBoundingClientRect();
    const z = document.getElementById('wieder-anmelden').parentElement.getBoundingClientRect();
    return k.width < z.width - 40;
  }));
check('KRITISCH: der Token ist danach auch im Browser weg',
  await page.evaluate(() => !localStorage.getItem('portal_token')));
await page.screenshot({ path: `${OUT}/portal-05-abgemeldet.png` });
await klick('#wieder-anmelden');
await page.waitForTimeout(150);
check('Der Weg zurück führt zur Anmeldemaske', await page.isVisible('#schritt-adresse'));

// ── Der Link gilt auch, wenn schon eine Sitzung im Speicher liegt ────
// Ein Link zum Passwortsetzen geht IMMER vor -- dasselbe Vorgehen wie in
// app.html seit ENT-373. Sonst kaeme jemand, der an einem fremden oder
// alten Browser einen Link oeffnet, in die Liste des dort Angemeldeten
// statt in seine eigene Passwortmaske.
await page.evaluate(() => { try { localStorage.setItem('portal_token', 'alteSitzung'); } catch (e) {} });
await page.goto(SEITE + '?neu=nochEinToken456');
await page.waitForTimeout(250);
check('KRITISCH: der Link geht auch einer bestehenden Sitzung vor',
  await page.isVisible('#schritt-passwort') && !(await page.isVisible('#inhalt')));
check('KRITISCH: die Passwortfelder sind auf dem Handy 44 px hoch und 16 px gross',
  await page.evaluate(() => ['pw-neu', 'pw-neu2'].every(id => {
    const e = document.getElementById(id);
    return e.getBoundingClientRect().height >= 44
        && parseFloat(getComputedStyle(e).fontSize) >= 16;
  })));
await page.screenshot({ path: `${OUT}/portal-06-passwort-setzen.png` });
await fuell('#pw-neu', 'ein sicheres langes wort');
await fuell('#pw-neu2', 'ein sicheres langes wort');
await klick('#pw-speichern');
await page.waitForTimeout(300);
await klick('#pw-weiter');
await page.waitForTimeout(250);

calls = [];
await klick('#abmelden');
await page.waitForTimeout(250);

// ══ Desktop ═════════════════════════════════════════════════════════════
// Jede Änderung am Handy-Layout wird zusätzlich am Desktop geprüft, und
// umgekehrt (CLAUDE.md).
const gross = await browser.newPage({ viewport: { width: 1440, height: 900 } });
gross.on('pageerror', e => bad.push('JS-Fehler (Desktop): ' + e.message));
await setup(gross);
await gross.goto(SEITE);
await gross.evaluate(() => localStorage.clear());
await gross.goto(SEITE);
await fuell('#email', 'a.beispiel@example.invalid', gross);
await fuell('#passwort', 'ein sicheres langes wort', gross);
await klick('#anmelden-pw', gross);
await gross.waitForTimeout(300);
check('Die Liste erscheint auch am Desktop', await gross.isVisible('#inhalt'));
// Die Seite darf am breiten Bildschirm nicht über die volle Breite laufen --
// eine Textzeile über 1440 px ist unlesbar.
const breite = await gross.evaluate(() =>
  Math.round(document.querySelector('.buehne').getBoundingClientRect().width));
check('KRITISCH: der Inhalt bleibt am Desktop auf lesbarer Breite', breite <= 940);
const lDesktop = await lage(gross);
check('KRITISCH: auch am Desktop steht der Zustand rechts vom Datum',
  lDesktop.markeLinks > lDesktop.datumRechts);
check('KRITISCH: und dort ebenfalls auf derselben Hoehe -- dasselbe Muster auf beiden Breiten',
  lDesktop.datumMitte >= lDesktop.markeOben && lDesktop.datumMitte <= lDesktop.markeUnten);

// ── Dieselben Angaben, andere Anordnung (ENT-449) ────────────────────
// Am Desktop stehen die vier Bloecke nebeneinander statt untereinander.
// Geprueft wird die ANORDNUNG am gerenderten Zustand: dass sie wirklich auf
// einer Zeile liegen und in dieser Reihenfolge -- eine Rasterzuweisung, die
// eine spaetere Regel ueberschreibt, faellt sonst nicht auf.
const reihe = await gross.evaluate(() => {
  const z = document.querySelector('#liste .zeile');
  const kasten = k => { const e = z.querySelector(k); return e && e.getBoundingClientRect(); };
  const a = kasten('.datum'), b = kasten('.haupt'), c = kasten('.fortschritt'), d = kasten('.rechts');
  return { a, b, c, d,
           schneiden: [b, c, d].every(x => x.top < a.bottom && x.bottom > a.top) };
});
check('KRITISCH: am Desktop liegen Datum, Objekt, Fortschritt und Zustand auf EINER Zeile',
  reihe.schneiden);
check('KRITISCH: und in dieser Reihenfolge von links nach rechts',
  reihe.a.right <= reihe.b.left + 1 && reihe.b.right <= reihe.c.left + 1
  && reihe.c.right <= reihe.d.left + 1);
// Ein Balken, der von Zeile zu Zeile verschieden lang ist, laesst sich nicht
// mit dem darueber vergleichen -- und genau das ist sein Zweck.
const bDesk = (await balken(gross)).filter(Boolean);
check('KRITISCH: alle Balken sind gleich breit und damit vergleichbar',
  bDesk.length >= 3 && bDesk.every(x => Math.abs(x.spur - bDesk[0].spur) <= 1));
// Gleich breit genügt nicht -- sie müssen auch an derselben Stelle beginnen.
// Jede Zeile ist ein eigenes Raster; mit einer Spalte auf 'auto' schiebt das
// längere Zustandswort die ganze Zeile, und die Balken stehen versetzt
// untereinander. Sichtbar erst im Bild, nicht im Quelltext.
check('KRITISCH: und sie beginnen an derselben Stelle — sonst sind sie nicht vergleichbar',
  await gross.evaluate(() => {
    const l = [...document.querySelectorAll('#liste .zeile .balken')]
      .map(b => b.getBoundingClientRect().left);
    return l.length >= 3 && l.every(x => Math.abs(x - l[0]) <= 1);
  }));
// Und die Zustandsmarken enden bündig an derselben Kante. Ohne die
// Rechtsbündigkeit stehen sie je nach Wortlänge unterschiedlich weit innen --
// eine ausgefranste rechte Kante, die man erst im Bild sieht.
check('KRITISCH: die Zustandsmarken enden alle an derselben rechten Kante',
  await gross.evaluate(() => {
    const kanten = [...document.querySelectorAll('#liste .zeile .marke-zustand')]
      .map(m => m.getBoundingClientRect().right);
    // Nur die rechten Kanten: Die Marken sind verschieden breit, also fällt
    // eine verlorene Rechtsbündigkeit genau hier auf (linksbündig endeten
    // sie an verschiedenen Stellen).
    return kanten.length >= 3 && kanten.every(x => Math.abs(x - kanten[0]) <= 1);
  }));
check('KRITISCH: und der Füllstand stimmt auch am Desktop mit den Zahlen überein',
  Math.abs(bDesk[1].gefuellt / bDesk[1].spur - 1 / 3) < 0.04);
check('Der Fotobeleg-Hinweis steht auch am Desktop da',
  /1 davon mit Fotobeleg/.test(await gross.textContent('#liste')));

// Dasselbe Aufklappen am Desktop -- jede Änderung am Handy-Layout wird
// zusätzlich am Desktop geprüft (CLAUDE.md).
await klick('#liste .zeile', gross);
await gross.waitForTimeout(400);
const lageD = await gross.evaluate(() => {
  const z = document.querySelector('#liste .zeile');
  const t = z.nextElementSibling;
  if (!t || !t.classList.contains('detail')) { return null; }
  const a = z.getBoundingClientRect(), b = t.getBoundingClientRect();
  return { unter: b.top >= a.bottom - 1, breite: Math.abs(a.width - b.width),
           spalten: new Set([...t.querySelectorAll('.kennzahlen > div')]
             .map(e => Math.round(e.getBoundingClientRect().top))).size };
});
check('KRITISCH: auch am Desktop öffnet die Tafel unter der Zeile und auf deren Breite',
  !!lageD && lageD.unter && lageD.breite <= 1);
// Vier Blöcke auf 390 px wären 80 px breit; am Desktop ist der Platz da.
check('KRITISCH: am Desktop stehen die vier Kennzahlen auf EINER Zeile',
  !!lageD && lageD.spalten === 1);
const detailD = await gross.textContent('#liste .detail');
check('Auch am Desktop stehen die Kontrollpunkte mit ihren Uhrzeiten da',
  /22:07/.test(detailD) && /Eingang Nord/.test(detailD));
check('KRITISCH: und auch am Desktop kein Personenname (OP-423)',
  !/Nachnamenstest/.test(detailD) && !/Vorname/.test(detailD));
// Der nicht besuchte Punkt gehört auch hier ins Bild.
await gross.evaluate(() => document.querySelectorAll('#liste .zeile')[1].click());
await gross.waitForTimeout(300);
check('KRITISCH: auch am Desktop erscheinen die nicht besuchten Punkte',
  await gross.evaluate(() => {
    const t = document.querySelectorAll('#liste .zeile')[1].nextElementSibling.textContent;
    return /Waschküche/.test(t) && /Nicht besucht/.test(t);
  }));
await gross.screenshot({ path: `${OUT}/portal-09-detail-desktop.png` });
await gross.evaluate(() => document.querySelectorAll('#liste .zeile.offen').forEach(z => z.click()));
await gross.waitForTimeout(200);

// Und nichts läuft seitlich aus dem Bild (weder hier noch auf dem Handy).
check('KRITISCH: die Seite scrollt nicht waagrecht',
  await gross.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check('KRITISCH: auch auf dem Handy scrollt sie nicht waagrecht',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await gross.screenshot({ path: `${OUT}/portal-02-desktop.png` });

// ══ Dunkle Fassung ══════════════════════════════════════════════════════
// Die Seite folgt dem Geraet und hat keinen Umschalter -- also muessen
// BEIDE Fassungen stimmen. Gemessen wird am gerenderten Zustand: ob die
// Kachel wirklich durchscheint und die Schrift darauf noch traegt.
const dunkel = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
dunkel.on('pageerror', e => bad.push('JS-Fehler (dunkel): ' + e.message));
await setup(dunkel);
await dunkel.goto(SEITE);
await dunkel.evaluate(() => localStorage.clear());
await dunkel.goto(SEITE);
check('Der Empfang steht auch in der dunklen Fassung', await dunkel.isVisible('#empfang'));
await dunkel.screenshot({ path: `${OUT}/portal-04-empfang.png` });
const dunkelWerte = await dunkel.evaluate(() => {
  const koerper = getComputedStyle(document.body);
  const vor = getComputedStyle(document.body, '::before');
  return {
    grund: koerper.backgroundColor,
    tinte: koerper.color,
    verlauf: vor.backgroundImage,
    karte: getComputedStyle(document.querySelector('.karte')).backgroundColor,
  };
});
// Der dunkle Grund ist wirklich dunkel -- und nicht der helle, weil eine
// Medienabfrage danebengegriffen hat.
const kanaele = t => (t.match(/\d+/g) || []).slice(0, 3).map(Number);
const [gr, gg, gb] = kanaele(dunkelWerte.grund);
check('KRITISCH: in der dunklen Fassung ist der Grund wirklich dunkel',
  gr < 60 && gg < 60 && gb < 60);
const [tr, tg, tb] = kanaele(dunkelWerte.tinte);
check('KRITISCH: und die Schrift darauf hell', tr > 200 && tg > 200 && tb > 200);
// Der Verlauf ist die halbe Miete: Ohne ihn gibt es nichts zu brechen, und
// die Glaskante saehe bloss blass aus.
check('KRITISCH: die Verlaufsebene liegt hinter der Seite (drei Kreise)',
  (dunkelWerte.verlauf.match(/radial-gradient/g) || []).length === 3);
// Und die Kachel scheint wirklich durch -- eine deckende Flaeche waere kein
// Glas, sondern nur eine Karte mit runden Ecken.
check('KRITISCH: die Kachel ist durchscheinend, nicht deckend',
  /^rgba\(/.test(dunkelWerte.karte) && parseFloat(dunkelWerte.karte.split(',')[3]) < 0.95);
await fuell('#email', 'a.beispiel@example.invalid', dunkel);
await fuell('#passwort', 'ein sicheres langes wort', dunkel);
await klick('#anmelden-pw', dunkel);
await dunkel.waitForTimeout(300);
check('Die Liste erscheint auch in der dunklen Fassung', await dunkel.isVisible('#inhalt'));
await dunkel.screenshot({ path: `${OUT}/portal-03-dunkel.png` });
await dunkel.evaluate(() => localStorage.clear());

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
