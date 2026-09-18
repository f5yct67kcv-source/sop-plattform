// Offerten UND Rechnungen sehen im Betreiber-Bereich aus wie im Cockpit --
// GEMESSEN an beiden gerenderten Seiten, nicht im Quelltext nachgelesen
// (ENT-607, erweitert mit ENT-608).
//
// WOZU DIESE SUITE: Der Projektinhaber hat mehrfach verlangt, dass dieser
// Teil "eins zu eins" derselbe ist wie dort. Beim ersten Anlauf war der
// Bauplan identisch -- dieselben Felder, dieselbe Reihenfolge, dieselben
// Klassennamen -- und das Bild trotzdem ein anderes: Diese Seite gibt ihren
// eigenen Bausteinen pauschal 44 px Hoehe und 16 px Schrift, und diese
// Element-Regeln griffen auf die uebernommenen Bausteine durch. Kein Fehler
// war zu sehen, nichts ging kaputt, jede einzelne Regel las sich richtig --
// und das Formular war ueberall eine Spur groesser als sein Vorbild. Genau
// die Sorte Abweichung, die nur das Messen findet.
//
// Verglichen wird darum der GERENDERTE Zustand beider Dateien gegeneinander,
// Feld fuer Feld und Spalte fuer Spalte. Das haelt auch die andere Richtung
// fest: Aendert das Cockpit etwas und diese Seite zieht nicht mit, wird es
// hier rot. Eine Pruefung auf feste Zahlen koennte das nicht -- sie waere am
// Tag der Aenderung im Cockpit gruen und falsch.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Kein festes Datum nahe beim heutigen Tag (test_datumsfest.mjs): Die
// Rechnungsliste vergleicht "faellig am" mit HEUTE und schreibt
// "ueberfaellig" bzw. "x Tage" daneben -- ein hingeschriebenes Datum kippte
// beim naechsten Monatswechsel und machte die Suite ohne Codeaenderung rot.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

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
  // Die Beschriftungen des Formulars als TEXT. Sie unterscheiden sich je
  // Belegart ("Offertendatum" gegen "Rechnungsdatum"), und genau daran
  // faellt auf, wenn eine Rechnung das Formular einer Offerte traegt.
  const worte = [...wurzel.querySelectorAll('label')].filter(l => l.offsetParent !== null)
    .map(l => l.textContent.trim());
  return { nachId, nachFolge, worte };
};

// Abzug einer Liste: Spaltenkoepfe als Text, dazu die Gestalt jeder Zelle
// der ersten Zeile. Die Koepfe sagen, WAS dasteht, die Gestalt WIE.
const LISTEN_ABZUG = (wahl) => {
  const R = el => el.getBoundingClientRect();
  const tab = document.querySelector(wahl + ' table');
  if (!tab) { return null; }
  const stil = el => {
    const c = getComputedStyle(el);
    return [c.fontSize, c.fontWeight, c.textAlign, c.color, c.whiteSpace].join(' | ');
  };
  const kopf = [...tab.querySelectorAll('thead th')].map(t => ({
    wort: t.textContent.replace(/[▲▼]/g, '').trim(),
    sortbar: t.classList.contains('sortbar'),
    s: stil(t),
  }));
  const zeilen = [...tab.querySelectorAll('tbody tr')].map(tr => ({
    zellen: [...tr.children].map(td => ({ wort: td.textContent.replace(/\s+/g, ' ').trim(), s: stil(td) })),
    h: R(tr).height,
  }));
  return { kopf, zeilen };
};

const browser = await chromium.launch({ executablePath: browserPfad() });

// Dieselben Zahlen auf beiden Seiten -- 12 x CHF 120.00 zu 8.10 %. Wuerden
// zwei verschiedene Betraege dastehen, unterschieden sich die Spaltenbreiten
// und jede Messung waere wertlos.
const POSITION = { produkt_id: 1, produkt_name: 'Nutzung', beschreibung: 'Monatliche Nutzung',
                   menge: 12, einheit: 'Monat', einzelpreis_rappen: 12000,
                   rabatt_bp: 0, mwst_satz_bp: 810 };

// Drei Rechnungen, die zusammen jeden Sonderfall der Liste zeigen: eine
// offene mit Frist in der Zukunft, eine ueberfaellige und eine bezahlte.
// Ohne die dritte bliebe die Spalte "Offener Betrag" ungeprueft.
const RECHNUNGEN = [
  { id: 31, art: 'rechnung', nummer: 'RE-0003', kunde_id: 1, kunde_name: 'Musterbetrieb AG',
    kundennummer: 'K0001', titel: 'Nutzung', referenz: 'B-77', datum: tag(-8),
    faellig_bis: tag(22), gueltig_bis: null, status: 'versendet', bezahlt: 0, bezahlt_am: null,
    rabatt_bp: 0, total_rappen: 155665, aktiv: 1, ist_vorlage: 0 },
  { id: 32, art: 'rechnung', nummer: 'RE-0002', kunde_id: 1, kunde_name: 'Musterbetrieb AG',
    kundennummer: 'K0001', titel: 'Nutzung', referenz: null, datum: tag(-60),
    faellig_bis: tag(-30), gueltig_bis: null, status: 'versendet', bezahlt: 0, bezahlt_am: null,
    rabatt_bp: 0, total_rappen: 104855, aktiv: 1, ist_vorlage: 0 },
  { id: 33, art: 'rechnung', nummer: 'RE-0001', kunde_id: 1, kunde_name: 'Musterbetrieb AG',
    kundennummer: 'K0001', titel: 'Einrichtung', referenz: null, datum: tag(-90),
    faellig_bis: tag(-60), gueltig_bis: null, status: 'versendet', bezahlt: 1, bezahlt_am: tag(-62),
    rabatt_bp: 0, total_rappen: 55295, aktiv: 1, ist_vorlage: 0 },
];

const ADRESSE = { id: 1, name: 'Musterbetrieb AG', kundennummer: 'K0001', plz: '3000',
                  ort: 'Musterstadt', aktiv: 1, personen: [], kontaktwege: [] };
const PRODUKT = { id: 1, nummer: 'P0001', name: 'Nutzung', beschreibung: '',
                  einzelpreis_rappen: 12000, einheit: 'Monat', mwst_satz_bp: 810,
                  sortierung: 10, aktiv: 1 };

async function seiteOeffnen(breite, hoehe, thema, glas) {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  await seite.addInitScript(([t, g]) => {
    try { localStorage.setItem('rv3_thema', t); localStorage.setItem('rv3_glas', g); } catch (e) { /* egal */ }
  }, [thema, glas]);
  return seite;
}

async function cockpit(breite, hoehe, thema, glas, was) {
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
    if (url.includes('produkt_list')) { return send({ status: 'ok', produkte: [PRODUKT] }); }
    if (url.includes('beleg_list')) {
      return url.includes('art=rechnung')
        ? send({ status: 'ok', naechste_nummer: 'RE-0004', belege: RECHNUNGEN })
        : send({ status: 'ok', naechste_nummer: 'OF-0001', belege: [] });
    }
    if (url.includes('kunden_list')) { return send({ status: 'ok', kunden: [ADRESSE] }); }
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
  let m = null;
  if (was === 'liste') {
    // Ueber die Wege der Seite selbst, nicht ueber nachgebautes Markup.
    await seite.evaluate(() => { go('kunden'); kuGoTab('rechnungen'); });
    await seite.waitForTimeout(250);
    m = await seite.evaluate(LISTEN_ABZUG, '#reTable');
  } else {
    await seite.evaluate(([art, p]) => { ofNeu(art); ofPos = [p]; ofZeilenZeichnen(); }, [was, POSITION]);
    await seite.waitForTimeout(150);
    m = await seite.evaluate(ABZUG);
  }
  await seite.close();
  return { m, fehler };
}

async function betreiber(breite, hoehe, thema, glas, was) {
  const seite = await seiteOeffnen(breite, hoehe, thema, glas);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  // Auch hier die Wege der Seite selbst: bereichZeigen('rechnungen') laedt
  // die Liste nach. Ohne Antwort liefe sie in "Nicht abrufbar" und
  // ueberschriebe die eingesetzten Testdaten -- der Abzug maesse dann den
  // Fehlerzustand statt der Liste.
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('betreiber_beleg_list.php')) {
      return url.includes('art=rechnung')
        ? send({ status: 'ok', eingerichtet: true, naechste_nummer: 'RE-0004', belege: RECHNUNGEN })
        : send({ status: 'ok', eingerichtet: true, naechste_nummer: 'OF-0001', belege: [] });
    }
    if (url.includes('betreiber_kunden_list.php')) {
      return send({ status: 'ok', eingerichtet: true, naechste_nummer: 'K0002', kunden: [ADRESSE] });
    }
    if (url.includes('betreiber_produkt_list.php')) {
      return send({ status: 'ok', eingerichtet: true, produkte: [PRODUKT] });
    }
    return send({ status: 'ok' });
  });
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(([p, adr, prod, re]) => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    offertenBereit = true;
    ofNaechsteNummer = 'OF-0001';
    reNaechsteNummer = 'RE-0004';
    produkte = [prod];
    adressen = [Object.assign({ mandant_id: null }, adr)];
    belege = [];
    rechnungen = re;
  }, [POSITION, ADRESSE, PRODUKT, RECHNUNGEN]);
  let m = null;
  if (was === 'liste') {
    await seite.evaluate(() => { bereichZeigen('rechnungen'); renderRechnungen(); });
    await seite.waitForTimeout(250);
    m = await seite.evaluate(LISTEN_ABZUG, '#reTable');
  } else {
    await seite.evaluate(([art, p]) => { ofNeu(art); ofPos = [p]; ofZeilenZeichnen(); }, [was, POSITION]);
    await seite.waitForTimeout(150);
    m = await seite.evaluate(ABZUG);
  }
  await seite.close();
  return { m, fehler };
}

const wieText = m => `${m.s} | ${m.h.toFixed(1)}h`;
const passt = (a, b) => a.s === b.s && Math.abs(a.h - b.h) <= 1;

function formularVergleichen(was, co, be) {
  check(`${was}: beide Seiten zeigen das Formular ohne JS-Fehler`,
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push('Cockpit: ' + co.fehler[0]); }
  if (be.fehler.length) { bad.push('Betreiber: ' + be.fehler[0]); }

  check(`${was}: beide Formulare wurden ueberhaupt gemessen`,
    co.m && be.m && Object.keys(co.m.nachId).length > 15);
  if (!co.m || !be.m) { return; }

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

  // Und die Wortlaute: Dieselben Beschriftungen in derselben Reihenfolge.
  check(`KRITISCH ${was}: dieselben Beschriftungen im selben Wortlaut`,
    JSON.stringify(co.m.worte) === JSON.stringify(be.m.worte));
  if (JSON.stringify(co.m.worte) !== JSON.stringify(be.m.worte)) {
    bad.push(`${was}: Cockpit ${JSON.stringify(co.m.worte)}\n      Betreiber ${JSON.stringify(be.m.worte)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// TEIL 1 — Das Formular, beide Belegarten, drei Fassungen
// ══════════════════════════════════════════════════════════════════════
//
// Der Handy-Fall ist der wichtigere von den ersten beiden: Dort greifen auf
// beiden Seiten die 44-px-Regeln, und genau dort koennten sie auseinander-
// laufen, ohne dass es am Schreibtisch auffiele.
const FAELLE = [
  ['Desktop, dunkel, Glas an', 1500, 1000, 'dunkel', 'an'],
  ['Handy, hell, Glas an', 390, 844, 'hell', 'an'],
  ['Desktop, hell, Glas aus', 1500, 1000, 'hell', 'aus'],
];

for (const [wie, breite, hoehe, thema, glas] of FAELLE) {
  for (const art of ['offerte', 'rechnung']) {
    const co = await cockpit(breite, hoehe, thema, glas, art);
    const be = await betreiber(breite, hoehe, thema, glas, art);
    formularVergleichen(`${wie}, ${art}`, co, be);
  }
}

// ══════════════════════════════════════════════════════════════════════
// TEIL 2 — Die Rechnungsliste
// ══════════════════════════════════════════════════════════════════════
//
// Zehn Spalten, drei Zeilen, und zwei davon rechnen: "Fällig" zaehlt Tage,
// "Offener Betrag" ist entweder null oder der volle Betrag. Genau diese
// beiden Spalten gibt es bei einer Offerte nicht -- sie sind der Grund,
// warum die Rechnungsliste eine eigene Funktion ist und kein Aufruf der
// Offertenliste mit einem Schalter.
{
  const co = await cockpit(1500, 1000, 'dunkel', 'an', 'liste');
  const be = await betreiber(1500, 1000, 'dunkel', 'an', 'liste');

  check('Rechnungsliste: beide Seiten zeigen sie ohne JS-Fehler',
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push('Cockpit: ' + co.fehler[0]); }
  if (be.fehler.length) { bad.push('Betreiber: ' + be.fehler[0]); }
  check('Rechnungsliste: beide wurden ueberhaupt gemessen',
    !!co.m && !!be.m && co.m.zeilen.length === 3);
  if (co.m && be.m) {
    check('KRITISCH Rechnungsliste: dieselben Spalten im selben Wortlaut',
      JSON.stringify(co.m.kopf.map(k => k.wort)) === JSON.stringify(be.m.kopf.map(k => k.wort)));
    if (JSON.stringify(co.m.kopf.map(k => k.wort)) !== JSON.stringify(be.m.kopf.map(k => k.wort))) {
      bad.push('Cockpit   ' + JSON.stringify(co.m.kopf.map(k => k.wort))
        + '\n      Betreiber ' + JSON.stringify(be.m.kopf.map(k => k.wort)));
    }
    check('KRITISCH Rechnungsliste: dieselben Spalten sind sortierbar',
      JSON.stringify(co.m.kopf.map(k => k.sortbar)) === JSON.stringify(be.m.kopf.map(k => k.sortbar)));
    check('KRITISCH Rechnungsliste: dieselben Zeilen in derselben Reihenfolge',
      JSON.stringify(co.m.zeilen.map(z => z.zellen.map(c => c.wort)))
        === JSON.stringify(be.m.zeilen.map(z => z.zellen.map(c => c.wort))));
    if (JSON.stringify(co.m.zeilen.map(z => z.zellen.map(c => c.wort)))
        !== JSON.stringify(be.m.zeilen.map(z => z.zellen.map(c => c.wort)))) {
      const cz = co.m.zeilen.map(z => z.zellen.map(c => c.wort));
      const bz = be.m.zeilen.map(z => z.zellen.map(c => c.wort));
      for (let i = 0; i < Math.max(cz.length, bz.length); i++) {
        if (JSON.stringify(cz[i]) !== JSON.stringify(bz[i])) {
          bad.push(`Zeile ${i}\n      Cockpit   ${JSON.stringify(cz[i])}\n      Betreiber ${JSON.stringify(bz[i])}`);
        }
      }
    }
    const zellenGleich = co.m.zeilen.every((z, i) => be.m.zeilen[i]
      && z.zellen.every((c, j) => be.m.zeilen[i].zellen[j] && be.m.zeilen[i].zellen[j].s === c.s));
    check('KRITISCH Rechnungsliste: und sie sind gleich gestaltet', zellenGleich);
    if (!zellenGleich) {
      co.m.zeilen.forEach((z, i) => z.zellen.forEach((c, j) => {
        const g = be.m.zeilen[i] && be.m.zeilen[i].zellen[j];
        if (!g || g.s !== c.s) {
          bad.push(`Zelle ${i}/${j} (${c.wort})\n      Cockpit   ${c.s}\n      Betreiber ${g ? g.s : '—'}`);
        }
      }));
    }
    // Die beiden gerechneten Spalten ausdruecklich: Eine bezahlte Rechnung
    // zeigt CHF 0.00 offen und traegt keine Tageszahl mehr.
    const bezahlt = be.m.zeilen.find(z => z.zellen[0].wort === 'Bezahlt');
    check('KRITISCH Rechnungsliste: die bezahlte Rechnung hat nichts mehr offen',
      !!bezahlt && bezahlt.zellen[8].wort === 'CHF 0.00' && bezahlt.zellen[1].wort === '–');
    const ueberfaellig = be.m.zeilen.find(z => z.zellen[0].wort === 'Überfällig');
    check('KRITISCH Rechnungsliste: die ueberfaellige sagt, wie lange schon',
      !!ueberfaellig && /\d+ Tage überfällig/.test(ueberfaellig.zellen[1].wort));
  }
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
