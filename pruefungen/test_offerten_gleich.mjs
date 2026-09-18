// Das Offertformular sieht im Betreiber-Bereich aus wie im Cockpit -- GEMESSEN
// an beiden gerenderten Seiten, nicht im Quelltext nachgelesen (ENT-607).
//
// WOZU DIESE SUITE: Der Projektinhaber hat zweimal verlangt, dass der
// Offertenteil hier "eins zu eins" derselbe ist wie dort. Beim ersten Anlauf
// war der Bauplan identisch -- dieselben Felder, dieselbe Reihenfolge,
// dieselben Klassennamen -- und das Bild trotzdem ein anderes: Diese Seite
// gibt ihren eigenen Bausteinen pauschal 44 px Hoehe und 16 px Schrift, und
// diese Element-Regeln griffen auf die uebernommenen Bausteine durch. Kein
// Fehler war zu sehen, nichts ging kaputt, jede einzelne Regel las sich
// richtig -- und das Formular war ueberall eine Spur groesser als sein
// Vorbild. Genau die Sorte Abweichung, die nur das Messen findet.
//
// Verglichen wird darum der GERENDERTE Zustand beider Dateien gegeneinander,
// Feld fuer Feld. Das haelt auch die andere Richtung fest: Aendert das
// Cockpit seine Eingabefelder und diese Seite zieht nicht mit, wird es hier
// rot. Eine Pruefung auf feste Zahlen koennte das nicht -- sie waere am Tag
// der Aenderung im Cockpit gruen und falsch.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Was verglichen wird: Schrift, Hoehe, Polster, Kanten, Farben, Ausrichtung.
// Also alles, was den Eindruck ausmacht -- und nichts, was vom Inhalt der
// Testdaten abhinge.
const ABZUG = () => {
  const R = el => el.getBoundingClientRect();
  // Die Hoehe steht NEBEN der Merkmalskette, nicht darin: Ein Kasten von
  // 16.5 px misst je nach Lage im Raster 16 oder 17 px, und ein Vergleich
  // Zeichen fuer Zeichen waere daran haengengeblieben, ohne dass etwas
  // anders aussieht. Verglichen wird sie darum mit einem Pixel Spielraum.
  const stil = el => {
    const c = getComputedStyle(el);
    return { s: [c.fontSize, c.fontWeight, c.padding, c.borderRadius, c.borderWidth,
                 c.borderStyle, c.backgroundColor, c.color, c.textAlign].join(' | '),
             h: R(el).height };
  };
  const wurzel = document.getElementById('view-offerte') || document.getElementById('of-formular');
  if (!wurzel) { return null; }
  const nachId = {};
  for (const el of wurzel.querySelectorAll('[id]')) { nachId['#' + el.id] = stil(el); }
  // Die Bausteine ohne Bezeichner werden ueber ihre REIHENFOLGE verglichen,
  // nicht ueber ihren Klassennamen: Der Zurueck-Knopf heisst hier .of-zurueck
  // und dort .ku-zurueck (die kurzen Namen waren hier schon vergeben), ist
  // aber derselbe Knopf. Die Reihenfolge haelt zugleich fest, dass in der
  // Kopfzeile nicht ploetzlich ein Knopf mehr oder weniger steht.
  const nachFolge = [];
  for (const el of wurzel.querySelectorAll('button, .card, .card-bd, .of-pos, .of-summe-z, label, .check, .seg2')) {
    if (el.offsetParent === null) { continue; }
    const m = stil(el);
    nachFolge.push({ s: el.tagName.toLowerCase() + ' ' + m.s, h: m.h });
  }
  return { nachId, nachFolge };
};

const browser = await chromium.launch({ executablePath: browserPfad() });

// Dieselben Zahlen auf beiden Seiten -- 12 x CHF 120.00 zu 8.10 %. Wuerden
// zwei verschiedene Betraege dastehen, unterschieden sich die Spaltenbreiten
// und jede Messung waere wertlos.
const POSITION = { produkt_id: 1, produkt_name: 'Nutzung', beschreibung: 'Monatliche Nutzung',
                   menge: 12, einheit: 'Monat', einzelpreis_rappen: 12000,
                   rabatt_bp: 0, mwst_satz_bp: 810 };

async function seiteOeffnen(breite, hoehe, thema, glas) {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  await seite.addInitScript(([t, g]) => {
    try { localStorage.setItem('rv3_thema', t); localStorage.setItem('rv3_glas', g); } catch (e) { /* egal */ }
  }, [thema, glas]);
  return seite;
}

async function cockpit(breite, hoehe, thema, glas) {
  const seite = await seiteOeffnen(breite, hoehe, thema, glas);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) { return send({ status: 'ok', token: 't', name: 'pruef', ist_admin: true }); }
    if (url.includes('me.php')) {
      return send({ status: 'ok', name: 'pruef', ist_admin: true, rollen: [],
        rechte: ['kunden_lesen', 'kunden_schreiben', 'offerten_lesen', 'offerten_schreiben',
                 'leistungen_lesen', 'leistungen_schreiben', 'betrieb_lesen'] });
    }
    if (url.includes('produkt_list')) {
      return send({ status: 'ok', produkte: [{ id: 1, name: 'Nutzung', beschreibung: '',
        einzelpreis_rappen: 12000, einheit: 'Monat', mwst_satz_bp: 810, sortierung: 10, aktiv: 1 }] });
    }
    if (url.includes('beleg_list')) { return send({ status: 'ok', naechste_nummer: 'OF-0001', belege: [] }); }
    if (url.includes('kunden_list')) {
      return send({ status: 'ok', kunden: [{ id: 1, name: 'Musterbetrieb AG', kundennummer: 'K0001',
        plz: '3000', ort: 'Musterstadt', aktiv: 1, personen: [], kontaktwege: [] }] });
    }
    if (url.includes('dashboard_stats')) {
      return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0, stunden_monat: 0,
        stunden_vormonat: 0, mitarbeiter: 0, kunden: 0, rapporte_total: 0 },
        verlauf: [], angemeldet: [], letzte_rapporte: [], ereignisse: [],
        ereignisse_unvollstaendig: [], pro_mitarbeiter: [] });
    }
    return send({ status: 'ok' });
  });
  await seite.goto(`file://${WURZEL}/dashboard.html`);
  await seite.fill('#gName', 'pruef'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#shell.on');
  await seite.waitForTimeout(350);
  // Ueber die Funktionen der Seite selbst, nicht ueber nachgebautes Markup:
  // Ein nachgebautes Formular pruefte den Nachbau.
  await seite.evaluate(p => { ofNeu('offerte'); ofPos = [p]; ofZeilenZeichnen(); }, POSITION);
  await seite.waitForTimeout(150);
  const m = await seite.evaluate(ABZUG);
  await seite.close();
  return { m, fehler };
}

async function betreiber(breite, hoehe, thema, glas) {
  const seite = await seiteOeffnen(breite, hoehe, thema, glas);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(p => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    offertenBereit = true;
    ofNaechsteNummer = 'OF-0001';
    produkte = [{ id: 1, nummer: 'P0001', name: 'Nutzung', beschreibung: '',
                  einzelpreis_rappen: 12000, einheit: 'Monat', mwst_satz_bp: 810,
                  aktiv: 1, sortierung: 0 }];
    adressen = [{ id: 1, kundennummer: 'K0001', name: 'Musterbetrieb AG', plz: '3000',
                  ort: 'Musterstadt', aktiv: 1, mandant_id: null, kontaktwege: [], personen: [] }];
    belege = [];
    document.getElementById('b-offerten').classList.remove('versteckt');
    ofNeu();
    ofPos = [p];
    ofZeilenZeichnen();
  }, POSITION);
  await seite.waitForTimeout(150);
  const m = await seite.evaluate(ABZUG);
  await seite.close();
  return { m, fehler };
}

// Drei Faelle. Der Handy-Fall ist der wichtigere von den ersten beiden: Dort
// greifen auf beiden Seiten die 44-px-Regeln, und genau dort koennten sie
// auseinanderlaufen, ohne dass es am Schreibtisch auffiele.
const FAELLE = [
  ['Desktop, dunkel, Glas an', 1500, 1000, 'dunkel', 'an'],
  ['Handy, hell, Glas an', 390, 844, 'hell', 'an'],
  ['Desktop, hell, Glas aus', 1500, 1000, 'hell', 'aus'],
];

for (const [was, breite, hoehe, thema, glas] of FAELLE) {
  const co = await cockpit(breite, hoehe, thema, glas);
  const be = await betreiber(breite, hoehe, thema, glas);

  check(`${was}: beide Seiten zeigen das Formular ohne JS-Fehler`,
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push('Cockpit: ' + co.fehler[0]); }
  if (be.fehler.length) { bad.push('Betreiber: ' + be.fehler[0]); }

  check(`${was}: beide Formulare wurden ueberhaupt gemessen`,
    co.m && be.m && Object.keys(co.m.nachId).length > 15);
  if (!co.m || !be.m) { continue; }

  // Dieselben Felder unter denselben Bezeichnern. Ein Feld, das hier fehlt
  // oder dazukommt, ist keine Gestaltungsfrage mehr, sondern ein anderes
  // Formular.
  const nurCo = Object.keys(co.m.nachId).filter(k => !(k in be.m.nachId));
  const nurBe = Object.keys(be.m.nachId).filter(k => !(k in co.m.nachId));
  check(`KRITISCH ${was}: dieselben Bausteine, keiner fehlt und keiner ist zuviel`,
    nurCo.length === 0 && nurBe.length === 0);
  if (nurCo.length) { bad.push(`${was}: fehlt im Betreiber-Bereich: ` + nurCo.join(', ')); }
  if (nurBe.length) { bad.push(`${was}: nur im Betreiber-Bereich: ` + nurBe.join(', ')); }

  const gleich = Object.keys(co.m.nachId).filter(k => k in be.m.nachId);
  const wieText = m => `${m.s} | ${m.h.toFixed(1)}h`;
  const passt = (a, b) => a.s === b.s && Math.abs(a.h - b.h) <= 1;
  const anders = gleich.filter(k => !passt(co.m.nachId[k], be.m.nachId[k]));
  check(`KRITISCH ${was}: jeder Baustein ist gleich gestaltet (${gleich.length} verglichen)`,
    gleich.length >= 20 && anders.length === 0);
  if (anders.length) {
    bad.push(`${was}: ` + anders.slice(0, 5)
      .map(k => `${k}\n      Cockpit:   ${wieText(co.m.nachId[k])}\n      Betreiber: ${wieText(be.m.nachId[k])}`).join('\n    '));
  }

  // Und dasselbe noch einmal ueber die Reihenfolge, fuer alles ohne
  // Bezeichner -- Karten, Beschriftungen, Knoepfe der Kopfzeile.
  check(`KRITISCH ${was}: gleich viele Karten, Knoepfe und Beschriftungen`,
    co.m.nachFolge.length === be.m.nachFolge.length);
  const folgeAnders = co.m.nachFolge
    .map((m, i) => (be.m.nachFolge[i] && passt(m, be.m.nachFolge[i]) ? null : i))
    .filter(i => i !== null);
  check(`KRITISCH ${was}: sie stehen auch in derselben Reihenfolge und Gestalt`,
    co.m.nachFolge.length === be.m.nachFolge.length && folgeAnders.length === 0);
  if (folgeAnders.length) {
    const i = folgeAnders[0];
    bad.push(`${was}: Stelle ${i}\n      Cockpit:   ${wieText(co.m.nachFolge[i])}`
      + `\n      Betreiber: ${be.m.nachFolge[i] ? wieText(be.m.nachFolge[i]) : '—'}`);
  }
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
