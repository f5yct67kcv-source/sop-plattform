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
  // Auch Innenabstand, Ausrichtung in der Zeile und Grund: Genau diese drei
  // sind hier lange unbemerkt auseinandergelaufen, weil sie nicht gemessen
  // wurden -- die Tabelle stand eine Spur enger als im Cockpit.
  const stil = el => {
    const c = getComputedStyle(el);
    return [c.fontSize, c.fontWeight, c.textAlign, c.color, c.whiteSpace,
            c.padding, c.verticalAlign, c.backgroundColor, c.letterSpacing].join(' | ');
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

// Abzug der Handy-Karten einer Liste. Gemessen wird die Karte selbst (sie
// war hier lange ein eigener Kasten mit Rahmen, waehrend das Cockpit Zeilen
// mit feiner Trennlinie zeigt -- am Desktop unsichtbar, auf dem Handy eine
// andere Liste) und der Inhalt der aufgeklappten Beschriftungsliste.
const KARTEN_ABZUG = () => {
  const stil = el => {
    const c = getComputedStyle(el);
    return [c.fontSize, c.fontWeight, c.padding, c.borderRadius, c.borderWidth,
            c.borderBottomWidth, c.borderStyle, c.marginBottom, c.cursor].join(' | ');
  };
  const karten = [...document.querySelectorAll('.nur-schmal .ag-karte')]
    .filter(k => k.offsetParent !== null);
  if (!karten.length) { return null; }
  return karten.map(k => ({
    s: stil(k),
    offen: k.getAttribute('aria-expanded'),
    kopf: (k.querySelector('.kopf') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
    wer: (k.querySelector('.wer') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
    zeiten: (k.querySelector('.zeiten') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
    dt: [...k.querySelectorAll('.kk-koerper .dl dt')].map(t => t.textContent.trim()),
    dd: [...k.querySelectorAll('.kk-koerper .dl dd')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
    dlS: k.querySelector('.kk-koerper .dl')
      ? getComputedStyle(k.querySelector('.kk-koerper .dl')).gridTemplateColumns : '',
  }));
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

// Zwei Adressen fuer die Adressenliste: eine vollstaendige und eine ohne
// Telefon und E-Mail. Ohne die zweite bliebe der Strich-Fall ungeprueft --
// und "unbekannt darf nie wie keine aussehen" faellt genau dort um.
//
// Die Belegzahl ist absichtlich dieselbe Zahl wie die Rapportzahl im
// Cockpit: Dann unterscheiden sich in der ganzen Zeile nur der Spaltenkopf
// und sonst nichts, und die Pruefung darunter kann genau diese eine
// Abweichung benennen, statt sie in einer Sammelmeldung zu verstecken.
const ADRESSEN_BE = [
  { id: 1, kundennummer: 'K0001', name: 'Musterbetrieb AG', art: 'unternehmen',
    anrede: '', vorname: '', nachname: '', zusatzfeld: '',
    strasse: 'Musterweg', hausnummer: '12', adresszusatz: '', plz: '3000', ort: 'Musterstadt',
    uid: '', mwst_nr: '', telefon: '031 000 00 00', kontaktperson: 'Leitung Betrieb',
    email: 'post@musterbetrieb.example', notiz: 'Beispielnotiz', aktiv: 1,
    personen: [], kontaktwege: [], belege_anzahl: 3 },
  { id: 2, kundennummer: 'K0002', name: 'Zweitbetrieb GmbH', art: 'unternehmen',
    anrede: '', vorname: '', nachname: '', zusatzfeld: '',
    strasse: 'Beispielstrasse', hausnummer: '4', adresszusatz: '', plz: '4000', ort: 'Beispielort',
    uid: '', mwst_nr: '', telefon: '', kontaktperson: '', email: '', notiz: '', aktiv: 1,
    personen: [], kontaktwege: [], belege_anzahl: 0 },
];
// Die Rapporte des Cockpits, die zu derselben Zahl fuehren (gezaehlt wird
// dort ueber den Kundennamen).
const RAPPORTE = [0, 1, 2].map(i => ({ id: 900 + i, kunde: 'Musterbetrieb AG' }));
// Dieselben Adressen ohne das Feld, das es im Cockpit nicht gibt.
const ADRESSEN_CO = ADRESSEN_BE.map(({ belege_anzahl, ...rest }) => rest);
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
  } else if (was === 'adressen' || was === 'karten') {
    await seite.evaluate(() => { go('kunden'); kuGoTab('uebersicht'); });
    await seite.waitForTimeout(300);
    // Erst NACH dem Laden setzen: Sonst ueberschriebe die noch laufende
    // Antwort die eingesetzten Daten und gemessen waere etwas anderes.
    await seite.evaluate(([liste, rap]) => { kunden = liste; rapporte = rap; renderKunden(); },
      [ADRESSEN_CO, RAPPORTE]);
    await seite.waitForTimeout(150);
    if (was === 'karten') {
      await seite.evaluate(() => kuKarteUm(1));
      await seite.waitForTimeout(150);
      m = await seite.evaluate(KARTEN_ABZUG);
    } else {
      m = await seite.evaluate(LISTEN_ABZUG, '#kuTable');
    }
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
  } else if (was === 'adressen' || was === 'karten') {
    await seite.evaluate(() => { bereichZeigen('adressen'); });
    await seite.waitForTimeout(300);
    await seite.evaluate(liste => { offertenBereit = true; adressen = liste; adZeichnen(); }, ADRESSEN_BE);
    await seite.waitForTimeout(150);
    if (was === 'karten') {
      await seite.evaluate(() => adKarteUm(1));
      await seite.waitForTimeout(150);
      m = await seite.evaluate(KARTEN_ABZUG);
    } else {
      m = await seite.evaluate(LISTEN_ABZUG, '#adTable');
    }
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

/* Bausteine, die es NUR im Betreiber-Formular gibt -- namentlich und mit
   Grund, gleiche Haltung wie OHNE_ANMELDUNG in test_php.mjs. Ohne diese
   Liste bliebe nur, die Pruefung aufzuweichen, und dann faenden auch
   versehentliche Unterschiede nie wieder jemanden.

   Die Laufzeit (ENT-637) gehoert zum Vertrag, und den schreibt allein die
   Betreiberin: Die Tabelle `belege` des Mandanten kennt die Belegart gar
   nicht. Im Cockpit waeren diese Felder darum kein fehlender Baustein,
   sondern einer ohne Zweck.

   WICHTIG: Sie stehen hier trotzdem unter Beobachtung -- der Test prueft
   unten, dass sie bei Offerte und Rechnung tatsaechlich VERBORGEN sind.
   Eine Ausnahme, die nicht mehr geprueft wird, ist ein Loch. */
const NUR_BETREIBER = ['#ofLaufzeitKarte', '#of_vbeginn', '#of_vmindest',
                       '#of_vfrist', '#of_vverlaengerung'];

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
  const nurBe = Object.keys(be.m.nachId)
    .filter(k => !(k in co.m.nachId) && !NUR_BETREIBER.includes(k));
  check(`KRITISCH ${was}: dieselben Bausteine, keiner fehlt und keiner ist zuviel`,
    nurCo.length === 0 && nurBe.length === 0);
  if (nurCo.length) { bad.push(`${was}: fehlt im Betreiber-Bereich: ` + nurCo.join(', ')); }
  if (nurBe.length) { bad.push(`${was}: nur im Betreiber-Bereich: ` + nurBe.join(', ')); }

  /* Die Ausnahmen sind nur ausgenommen, solange sie WEG sind. Steht die
     Laufzeitkarte auf einer Offerte offen da, ist es kein Sonderfall mehr,
     sondern ein zweites Formular. */
  const sichtbareAusnahmen = NUR_BETREIBER
    .filter(k => be.m.nachId[k] && be.m.nachId[k].h > 0);
  check(`KRITISCH ${was}: die Vertragsfelder bleiben verborgen`,
    sichtbareAusnahmen.length === 0);
  if (sichtbareAusnahmen.length) {
    bad.push(`${was}: sichtbar, obwohl nur fuer den Vertrag: ` + sichtbareAusnahmen.join(', '));
  }

  const gleich = Object.keys(co.m.nachId)
    .filter(k => k in be.m.nachId && !NUR_BETREIBER.includes(k));
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

// ══════════════════════════════════════════════════════════════════════
// TEIL 3 — Die Adressenliste
// ══════════════════════════════════════════════════════════════════════
//
// Acht Spalten, sortierbare Koepfe, auf dem Handy aufklappbare Karten.
// EINE Spalte ist mit Absicht nicht dieselbe: Das Cockpit zaehlt dort
// Rapporte, die Betreiberin hat keine und zaehlt Belege. Die Pruefung
// benennt genau diese eine Abweichung und verlangt sonst Gleichheit --
// so kann sie nicht als Sammelfreibrief fuer weitere Unterschiede dienen.
const ZAEHLSPALTE = 6;

{
  const co = await cockpit(1500, 1000, 'dunkel', 'an', 'adressen');
  const be = await betreiber(1500, 1000, 'dunkel', 'an', 'adressen');

  check('Adressenliste: beide Seiten zeigen sie ohne JS-Fehler',
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push('Cockpit: ' + co.fehler[0]); }
  if (be.fehler.length) { bad.push('Betreiber: ' + be.fehler[0]); }
  check('Adressenliste: beide wurden ueberhaupt gemessen',
    !!co.m && !!be.m && co.m.zeilen.length === 2 && co.m.kopf.length === 8);

  if (co.m && be.m) {
    const cw = co.m.kopf.map(k => k.wort), bw = be.m.kopf.map(k => k.wort);
    check('KRITISCH Adressenliste: die Zaehlspalte heisst hier Belege statt Rapporte',
      cw[ZAEHLSPALTE] === 'Rapporte' && bw[ZAEHLSPALTE] === 'Belege');
    const cwRest = cw.filter((_, i) => i !== ZAEHLSPALTE);
    const bwRest = bw.filter((_, i) => i !== ZAEHLSPALTE);
    check('KRITISCH Adressenliste: alle uebrigen Spalten heissen gleich und stehen gleich',
      JSON.stringify(cwRest) === JSON.stringify(bwRest));
    if (JSON.stringify(cwRest) !== JSON.stringify(bwRest)) {
      bad.push('Cockpit   ' + JSON.stringify(cw) + '\n      Betreiber ' + JSON.stringify(bw));
    }
    check('KRITISCH Adressenliste: dieselben Spalten sind sortierbar',
      JSON.stringify(co.m.kopf.map(k => k.sortbar)) === JSON.stringify(be.m.kopf.map(k => k.sortbar)));
    if (JSON.stringify(co.m.kopf.map(k => k.sortbar)) !== JSON.stringify(be.m.kopf.map(k => k.sortbar))) {
      bad.push('sortierbar Cockpit   ' + JSON.stringify(co.m.kopf.map(k => k.sortbar))
        + '\n      sortierbar Betreiber ' + JSON.stringify(be.m.kopf.map(k => k.sortbar)));
    }
    const kopfGleich = co.m.kopf.every((k, i) => be.m.kopf[i] && be.m.kopf[i].s === k.s);
    check('KRITISCH Adressenliste: die Spaltenkoepfe sind gleich gestaltet', kopfGleich);
    if (!kopfGleich) {
      co.m.kopf.forEach((k, i) => {
        const g = be.m.kopf[i];
        if (!g || g.s !== k.s) {
          bad.push(`Kopf ${i} (${k.wort})\n      Cockpit   ${k.s}\n      Betreiber ${g ? g.s : '—'}`);
        }
      });
    }

    // Die Zeilen. Die Zaehlspalte traegt hier wie dort dieselbe Zahl (die
    // Testdaten sind so gesetzt) -- sie wird darum MIT verglichen, nicht
    // ausgenommen: Sonst bliebe unbemerkt, wenn eine Seite "1200" und die
    // andere "1'200" schreibt.
    const cz = co.m.zeilen.map(z => z.zellen.map(c => c.wort));
    const bz = be.m.zeilen.map(z => z.zellen.map(c => c.wort));
    check('KRITISCH Adressenliste: dieselben Zeilen mit demselben Inhalt',
      JSON.stringify(cz) === JSON.stringify(bz));
    if (JSON.stringify(cz) !== JSON.stringify(bz)) {
      for (let i = 0; i < Math.max(cz.length, bz.length); i++) {
        if (JSON.stringify(cz[i]) !== JSON.stringify(bz[i])) {
          bad.push(`Zeile ${i}\n      Cockpit   ${JSON.stringify(cz[i])}\n      Betreiber ${JSON.stringify(bz[i])}`);
        }
      }
    }
    const zellenGleich = co.m.zeilen.every((z, i) => be.m.zeilen[i]
      && z.zellen.every((c, j) => be.m.zeilen[i].zellen[j] && be.m.zeilen[i].zellen[j].s === c.s));
    check('KRITISCH Adressenliste: und sie sind gleich gestaltet', zellenGleich);
    if (!zellenGleich) {
      co.m.zeilen.forEach((z, i) => z.zellen.forEach((c, j) => {
        const g = be.m.zeilen[i] && be.m.zeilen[i].zellen[j];
        if (!g || g.s !== c.s) {
          bad.push(`Zelle ${i}/${j} (${c.wort})\n      Cockpit   ${c.s}\n      Betreiber ${g ? g.s : '—'}`);
        }
      }));
    }
    // Die Adresse ohne Telefon und E-Mail zeigt einen Strich, keine Leere.
    check('KRITISCH Adressenliste: fehlende Angaben stehen als Strich da',
      bz[1] && bz[1][4] === '–' && bz[1][5] === '–' && bz[1][6] === '–');
  }
}

// Und dasselbe auf dem Handy: Dort ist die Karte die Liste.
{
  const co = await cockpit(390, 844, 'hell', 'an', 'karten');
  const be = await betreiber(390, 844, 'hell', 'an', 'karten');

  check('Adressenkarten: beide Seiten zeigen sie ohne JS-Fehler',
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push('Cockpit: ' + co.fehler[0]); }
  if (be.fehler.length) { bad.push('Betreiber: ' + be.fehler[0]); }
  check('Adressenkarten: beide wurden ueberhaupt gemessen',
    !!co.m && !!be.m && co.m.length === 2 && be.m.length === 2);

  if (co.m && be.m && co.m.length === be.m.length) {
    // Wieder nur die eine benannte Abweichung: Rapporte gegen Belege.
    const norm = t => t.replace(/Rapporte/g, 'Belege');
    const gestaltAnders = co.m.map((k, i) => k.s === be.m[i].s ? null : i).filter(i => i !== null);
    check('KRITISCH Adressenkarten: die Karte selbst ist gleich gestaltet',
      gestaltAnders.length === 0);
    if (gestaltAnders.length) {
      const i = gestaltAnders[0];
      bad.push(`Karte ${i}\n      Cockpit   ${co.m[i].s}\n      Betreiber ${be.m[i].s}`);
    }
    const textAnders = co.m.map((k, i) => (norm(k.kopf) === be.m[i].kopf
      && norm(k.wer) === be.m[i].wer && norm(k.zeiten) === be.m[i].zeiten) ? null : i)
      .filter(i => i !== null);
    check('KRITISCH Adressenkarten: dieselben drei Zeilen im selben Wortlaut',
      textAnders.length === 0);
    if (textAnders.length) {
      const i = textAnders[0];
      bad.push(`Karte ${i}\n      Cockpit   ${JSON.stringify([co.m[i].kopf, co.m[i].wer, co.m[i].zeiten])}`
        + `\n      Betreiber ${JSON.stringify([be.m[i].kopf, be.m[i].wer, be.m[i].zeiten])}`);
    }
    // Die aufgeklappte Karte: dieselben Beschriftungen, dieselben Werte,
    // dieselbe Spaltenbreite der Beschriftungsliste.
    const offenCo = co.m.find(k => k.offen === 'true');
    const offenBe = be.m.find(k => k.offen === 'true');
    check('Adressenkarten: auf beiden Seiten laesst sich eine Karte aufklappen',
      !!offenCo && !!offenBe && offenCo.dt.length >= 8);
    if (offenCo && offenBe) {
      check('KRITISCH Adressenkarten: dieselben Beschriftungen im aufgeklappten Teil',
        JSON.stringify(offenCo.dt.map(norm)) === JSON.stringify(offenBe.dt));
      if (JSON.stringify(offenCo.dt.map(norm)) !== JSON.stringify(offenBe.dt)) {
        bad.push('Cockpit   ' + JSON.stringify(offenCo.dt)
          + '\n      Betreiber ' + JSON.stringify(offenBe.dt));
      }
      check('KRITISCH Adressenkarten: und dieselben Werte darin',
        JSON.stringify(offenCo.dd.map(norm)) === JSON.stringify(offenBe.dd));
      if (JSON.stringify(offenCo.dd.map(norm)) !== JSON.stringify(offenBe.dd)) {
        bad.push('Cockpit   ' + JSON.stringify(offenCo.dd)
          + '\n      Betreiber ' + JSON.stringify(offenBe.dd));
      }
      check('KRITISCH Adressenkarten: die Beschriftungsspalte ist gleich breit',
        offenCo.dlS === offenBe.dlS && offenCo.dlS !== '');
    }
  }
}

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
