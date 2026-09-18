// Die Kontoseite des Betreiber-Bereichs gegen die Mitarbeitendenakte des
// Cockpits — GEMESSEN, nicht nachgelesen (ENT-615).
//
// WARUM SO: "1:1 uebernommen" laesst sich nicht behaupten, nur nachweisen.
// Eine Pruefung auf feste Zahlen waere gruen und falsch an dem Tag, an dem
// das Cockpit seine Detailseite aendert -- gemessen wird darum gegen das
// Cockpit selbst, nicht gegen eine abgeschriebene Liste von Werten.
//
// VERGLICHEN WIRD DIE BAUART, NICHT DER INHALT. Die Akte im Cockpit traegt
// acht Reiter und Dutzende Felder, das Konto drei Reiter und vier Felder --
// das ist die Entscheidung aus ENT-615 und kein Befund. Gleich sein muessen
// die Bauteile: Kopfzeile, Zurueck-Knopf, Reiter, Karten und die
// Beschriftungsliste darin.
import { chromium } from 'playwright';
import { WURZEL, browserPfad } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Je Bauteil die Eigenschaften, die es ausmachen. EINE flache Liste ueber
// alle Elemente erzeugt Rauschen: Schriftgroesse an einem Knopf ohne Text,
// Rahmenfarbe an einer Seite ohne Rahmen. Darum je Gruppe nur das, was dort
// etwas aussagt (dieselbe Bauart wie in test_kopf_gleich.mjs).
const GRUPPEN = {
  titel:   ['fontSize', 'fontWeight', 'margin', 'color', 'letterSpacing'],
  unter:   ['fontSize', 'color', 'marginTop'],
  flaeche: ['display', 'alignItems', 'gap', 'marginBottom'],
  knopf:   ['width', 'height', 'borderRadius', 'backgroundColor', 'color', 'display',
            'alignItems', 'justifyContent', 'padding', 'flex'],
  reiter:  ['fontSize', 'fontWeight', 'padding', 'borderRadius', 'backgroundColor', 'color'],
  karte:   ['backgroundColor', 'borderRadius', 'padding'],
  kartekopf: ['fontSize', 'fontWeight', 'color', 'padding'],
  dt:      ['fontSize', 'fontWeight', 'textTransform', 'letterSpacing', 'color', 'marginTop'],
  dd:      ['fontSize', 'fontWeight', 'margin', 'color'],
};

// Rahmen je Seite, und nur die Seiten, die es wirklich gibt: Ein
// `border-bottom-color` an einer Seite ohne Rahmen ist eine Angabe ohne
// Wirkung -- sie zu vergleichen erzeugt Abweichungen, die niemand sieht.
const ABZUG = (aufbau) => {
  const stil = (el, felder) => {
    if (!el) { return null; }
    const c = getComputedStyle(el);
    const w = {};
    felder.forEach(f => { w[f] = c[f]; });
    ['Top', 'Right', 'Bottom', 'Left'].forEach(s => {
      const breite = parseFloat(c['border' + s + 'Width']) || 0;
      const art = c['border' + s + 'Style'];
      if (breite > 0 && art !== 'none') {
        w['border' + s] = [c['border' + s + 'Width'], art, c['border' + s + 'Color']].join(' ');
      }
    });
    return w;
  };
  const erg = {};
  Object.entries(aufbau).forEach(([name, [wahl, gruppe]]) => {
    erg[name] = stil(document.querySelector(wahl), gruppe);
  });
  return erg;
};

const browser = await chromium.launch({ executablePath: browserPfad() });

const PERSON = {
  id: 1, name: 'muster.anna', vorname: 'Anna', nachname: 'Muster', anrede: 'Frau',
  personalnummer: '4711', kurzzeichen: 'AMU', ort: 'Musterhausen', plz: '9999',
  strasse: 'Musterweg 1', land: 'CH', email: 'anna@example.invalid',
  aktiv: 1, rollen: [], funktion: '', mobil: '', telefon: '',
};
const KONTO = {
  id: 1, name: 'Anna Muster', anrede: 'Frau', vorname: 'Anna', nachname: 'Muster',
  email: 'anna@example.invalid', aktiv: true, ich: false, nie_angemeldet: false,
  letzte_anmeldung: '2026-01-02 10:00:00', angelegt_am: '2026-01-01 08:00:00',
  zwei_faktor: true,
};

async function seiteOeffnen(thema) {
  const seite = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await seite.addInitScript(t => {
    try { localStorage.setItem('rv3_thema', t); localStorage.setItem('rv3_glas', 'aus'); } catch (e) { /* egal */ }
  }, thema);
  return seite;
}

/* Die Bauteile, die es auf BEIDEN Seiten gibt. Der Weg dorthin ist je Seite
   ein anderer, das Bauteil ist dasselbe. */
const bauteile = (wurzel) => ({
  kopfzeile: [`${wurzel} .ku-detail-hd`, GRUPPEN.flaeche],
  titel:     [`${wurzel} .ku-detail-hd h2`, GRUPPEN.titel],
  unter:     [`${wurzel} .ku-detail-hd .sub`, GRUPPEN.unter],
  zurueck:   [`${wurzel} .ku-zurueck`, GRUPPEN.knopf],
  reiterAn:  [`${wurzel} .md-tabs .tab.on`, GRUPPEN.reiter],
  reiterAus: [`${wurzel} .md-tabs .tab:not(.on)`, GRUPPEN.reiter],
  karte:     [`${wurzel} .card`, GRUPPEN.karte],
  kartekopf: [`${wurzel} .card-hd h3`, GRUPPEN.kartekopf],
  kartebd:   [`${wurzel} .card-bd`, GRUPPEN.karte],
  dt:        [`${wurzel} .ku-detail-info dt`, GRUPPEN.dt],
  dd:        [`${wurzel} .ku-detail-info dd`, GRUPPEN.dd],
});

async function cockpit(thema) {
  const seite = await seiteOeffnen(thema);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await seite.route('**/api/**', route => {
    const url = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('login.php')) { return send({ status: 'ok', token: 't', name: 'pruef', ist_admin: true }); }
    if (url.includes('me.php')) {
      return send({ status: 'ok', name: 'pruef', ist_admin: true, rollen: [],
        rechte: ['personal_lesen', 'personal_schreiben'] });
    }
    if (url.includes('mitarbeiter')) { return send({ status: 'ok', mitarbeiter: [PERSON] }); }
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
  // Ueber die Wege der Seite selbst. Die Akte wird eingesetzt statt geholt:
  // Der Ladeweg braucht einen Server, das Bauteil nicht.
  await seite.evaluate(p => {
    go('mitarbeiter');
    mitarbeiter = [p];
    maAkte = p;
    mdName = p.name;
    maGoTab('detail');
    mdGoTab('uebersicht');
    renderMaDetail();
  }, PERSON);
  await seite.waitForTimeout(350);
  const m = await seite.evaluate(ABZUG, bauteile('#mv-detail'));
  await seite.close();
  return { m, fehler };
}

async function betreiber(thema) {
  const seite = await seiteOeffnen(thema);
  const fehler = [];
  seite.on('pageerror', e => fehler.push(e.message));
  await seite.route('**/api/**', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
  await seite.goto(`file://${WURZEL}/betreiber.html`);
  await seite.evaluate(k => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
    bereichZeigen('konten');
    konten = [k];
    kontenAktive = 1;
    kZeichnen();
    kOeffnen(k.id);
  }, KONTO);
  await seite.waitForTimeout(300);
  const m = await seite.evaluate(ABZUG, bauteile('#kv-detail'));
  await seite.close();
  return { m, fehler };
}

const FAELLE = [['hell', 'hell'], ['dunkel', 'dunkel']];
for (const [name, thema] of FAELLE) {
  const co = await cockpit(thema);
  const be = await betreiber(thema);

  check(`${name}: beide Seiten zeigen die Detailansicht ohne JS-Fehler`,
    co.fehler.length === 0 && be.fehler.length === 0);
  if (co.fehler.length) { bad.push(`${name}: Cockpit meldet ${co.fehler[0]}`); }
  if (be.fehler.length) { bad.push(`${name}: Betreiber meldet ${be.fehler[0]}`); }

  Object.keys(bauteile('')).forEach(teil => {
    const a = co.m[teil], b = be.m[teil];
    // Fehlt das Bauteil auf einer Seite, ist das der Befund -- nicht ein
    // stillschweigend uebersprungener Vergleich.
    if (!a || !b) {
      check(`${name}: ${teil} gibt es auf beiden Seiten`, false);
      bad.push(`${name}: ${teil} fehlt ${!a ? 'im Cockpit' : 'im Betreiber-Bereich'}`);
      return;
    }
    const felder = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    const anders = felder.filter(f => a[f] !== b[f]);
    check(`${name}: ${teil} ist gebaut wie im Cockpit`, anders.length === 0);
    if (anders.length) {
      bad.push(`${name}: ${teil} — ` + anders.map(f => `${f}: ${a[f]} statt ${b[f]}`).join(', '));
    }
  });
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
