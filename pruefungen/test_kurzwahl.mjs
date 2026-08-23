// Schnellzugriff auf der Uebersicht (ENT-096).
//
// Nachgebaut nach der "Kurzwahl" von AbaNinja, mit eigenen Wegen. Der
// teuerste Fehler waere hier nicht ein fehlender Eintrag, sondern einer, der
// zwar dasteht, aber nichts tut -- oder einer, den jemand sieht, obwohl seine
// Rolle den Bereich gar nicht oeffnen darf. Beides wird geklickt geprueft,
// nicht im Quelltext nachgelesen.
//
// Alle Testdaten sind erfunden.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const ALLE_RECHTE = ['plan', 'abgleich', 'kunden', 'personal_lesen', 'betrieb'];

const browser = await chromium.launch({ executablePath: EXE });

async function seite(rechte = ALLE_RECHTE, breite = 1500) {
  const p = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  p.setDefaultTimeout(5000);
  p.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true, rechte });
    if (pf.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [], ereignisse: [], ereignisse_gesamt: 0,
      ereignisse_gekuerzt: false, ereignisse_unvollstaendig: [] });
    return send({ status: 'ok', rapporte: [], objekte: [], masterschichten: [], einsaetze: [],
      kunden: [], mitarbeiter: [], orte: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await p.goto(URL);
  await p.evaluate(() => localStorage.removeItem('rv3_dash_layout'));
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(600);
  return p;
}
const beschriftungen = p => p.$$eval('#kwGrid .kw b', els => els.map(e => e.textContent.trim()));

// ══════════════════════════════ DIE KACHEL STEHT DA
try {
  const p = await seite();
  check('Der Container heisst "Schnellzugriff"',
    (await p.textContent('[data-widget="kurzwahl"] .card-hd h2')).trim() === 'Schnellzugriff');
  const b = await beschriftungen(p);
  check('KRITISCH: mit allen Rechten stehen acht Wege da', b.length === 8);
  check('Darunter "Einsatz erstellen"', b.includes('Einsatz erstellen'));
  check('Und "Schichten abgleichen"', b.includes('Schichten abgleichen'));
  check('Und "Mitarbeitenden erfassen"', b.includes('Mitarbeitenden erfassen'));

  // Zwei Spalten wie im Vorbild -- gemessen an den Positionen, nicht am CSS.
  const spalten = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#kwGrid .kw')].map(e => Math.round(e.getBoundingClientRect().left));
    return new Set(l).size;
  });
  check('KRITISCH: die Wege stehen in zwei Spalten', spalten === 2);
  // Acht Wege gehen durch zwei und durch vier glatt auf. Bei fuenf Spalten
  // stuenden in der zweiten Zeile drei und daneben eine Luecke -- dieselbe
  // Familie wie die vierte Kennzahl allein in ihrer Zeile.
  const zeilen = await p.evaluate(() => new Set([...document.querySelectorAll('#kwGrid .kw')]
    .map(e => Math.round(e.getBoundingClientRect().top))).size);
  check('KRITISCH: und füllen ihre Zeilen ganz aus — vier mal zwei', zeilen === 4);

  // Trefferflaeche: Auf dem Handy gilt 44 px. Ein Weg, den man nicht trifft,
  // ist kein Schnellzugriff.
  const hoehen = await p.$$eval('#kwGrid .kw', els => els.map(e => e.getBoundingClientRect().height));
  check('KRITISCH: jeder Weg ist mindestens 44 px hoch', hoehen.every(h => h >= 44));
  await p.screenshot({ path: `${OUT}/kurzwahl.png` });
  await p.close();
} catch (e) { bad.push('Grundzustand: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ JEDER WEG FUEHRT WIRKLICH HIN
//
// Ein Eintrag, der dasteht und nichts tut, ist schlimmer als keiner: Er
// verspricht einen Weg. Darum wird jeder einzeln geklickt.
const ZIELE = [
  ['Einsatz erstellen',       'Planung',              '#dlgEnNeu'],
  ['Schichten abgleichen',    'Schichten abgleichen', null],
  ['Kunde erfassen',          'Kunden',               '#dlgKunde'],
  ['Tagesplan öffnen',        'Planung',              null],
  ['Objekt erfassen',         'Kunden',               '#dlgObNeu'],
  ['Objektplanung öffnen',    'Planung',              null],
  ['Mitarbeitenden erfassen', 'Mitarbeitende',        null],
  ['Rapporte ansehen',        'Kunden',               null],
];
for (const [titel, ziel, dialog] of ZIELE) {
  try {
    const p = await seite();
    await p.click(`#kwGrid .kw:has(b:text-is("${titel}"))`);
    await p.waitForTimeout(450);
    const t = (await p.textContent('#pgTitle')).trim();
    const offen = dialog ? await p.isVisible(dialog).catch(() => false) : true;
    check(`KRITISCH: „${titel}“ führt zu „${ziel}“${dialog ? ' und öffnet das Fenster' : ''}`,
      t === ziel && offen);
    await p.close();
  } catch (e) { bad.push(`Weg „${titel}“: ` + String(e).split('\n')[0].slice(0, 110)); }
}

// ══════════════════════════════ RECHTE
try {
  const p = await seite(['plan']);
  const b = await beschriftungen(p);
  check('KRITISCH: ohne das Recht "kunden" fehlt "Kunde erfassen"', !b.includes('Kunde erfassen'));
  check('KRITISCH: ohne das Recht "abgleich" fehlt "Schichten abgleichen"', !b.includes('Schichten abgleichen'));
  check('KRITISCH: ohne "personal_lesen" fehlt "Mitarbeitenden erfassen"', !b.includes('Mitarbeitenden erfassen'));
  check('Die eigenen Wege bleiben', b.includes('Einsatz erstellen') && b.includes('Tagesplan öffnen'));
  await p.close();

  // Auch der Aufruf von Hand darf nicht durch: Die Oberflaeche ist nicht die
  // Sperre, aber sie soll auch nicht daran vorbeiführen.
  const q = await seite(['plan']);
  const vorher = await q.textContent('#pgTitle');
  await q.evaluate(() => {
    const i = KURZWAHL.findIndex(e => e.recht === 'kunden');
    kwStarten(i);
  });
  await q.waitForTimeout(300);
  check('KRITISCH: der Aufruf von Hand kommt an der Rechteprüfung nicht vorbei',
    (await q.textContent('#pgTitle')) === vorher);
  await q.close();

  // "Nichts erlaubt" darf nie wie "nichts vorhanden" aussehen. Geprueft mit
  // dem Recht "betrieb": Es oeffnet das Dashboard, traegt aber keinen der
  // acht Wege. Ein Konto ganz ohne Rechte kaeme hier gar nicht an -- enter()
  // leitet es in die App weiter.
  const r = await seite(['betrieb']);
  const txt = (await r.textContent('#kwGrid')).replace(/\s+/g, ' ');
  check('KRITISCH: ohne jedes Recht steht da, dass es an der Rolle liegt',
    /Keine Kurzbefehle freigegeben/.test(txt) && /Rolle/.test(txt));
  check('Und kein einziger Weg', (await r.$$('#kwGrid .kw')).length === 0);
  await r.close();
} catch (e) { bad.push('Rechte: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ SCHMAL
try {
  const p = await seite(ALLE_RECHTE, 390);
  const m = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#kwGrid .kw')].map(e => Math.round(e.getBoundingClientRect().left));
    return { spalten: new Set(l).size, quer: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check('KRITISCH: auf dem Handy steht eine Spalte', m.spalten === 1);
  check('KRITISCH: kein Querscrollen auf dem Handy', m.quer === false);
  await p.close();
} catch (e) { bad.push('Schmal: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
