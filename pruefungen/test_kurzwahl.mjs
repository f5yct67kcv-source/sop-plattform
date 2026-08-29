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

  // Seit ENT-235 Kacheln statt Zeilen, darum vier Spalten statt zwei --
  // gemessen an den Positionen, nicht am CSS.
  const spalten = await p.evaluate(() => {
    const l = [...document.querySelectorAll('#kwGrid .kw')].map(e => Math.round(e.getBoundingClientRect().left));
    return new Set(l).size;
  });
  check('KRITISCH: die Wege stehen in vier Spalten', spalten === 4);
  // Die Regel dahinter ist aelter als die Kachelform und gilt weiter: Acht
  // Wege gehen durch zwei und durch vier glatt auf, durch drei nicht. Bei
  // drei Spalten bliebe in der letzten Zeile eine Luecke neben zwei Kacheln
  // -- dieselbe Familie wie die vierte Kennzahl allein in ihrer Zeile.
  // Das Mockup zeigt drei Spalten, hat dort aber sechs Kacheln.
  const zeilen = await p.evaluate(() => new Set([...document.querySelectorAll('#kwGrid .kw')]
    .map(e => Math.round(e.getBoundingClientRect().top))).size);
  check('KRITISCH: und füllen ihre Zeilen ganz aus — zwei mal vier', zeilen === 2);

  // Trefferflaeche: Auf dem Handy gilt 44 px. Ein Weg, den man nicht trifft,
  // ist kein Schnellzugriff.
  const hoehen = await p.$$eval('#kwGrid .kw', els => els.map(e => e.getBoundingClientRect().height));
  check('KRITISCH: jeder Weg ist mindestens 44 px hoch', hoehen.every(h => h >= 44));
  // Auch am Desktop: Eine Kachel, deren Beschriftung abgeschnitten ist, sagt
  // nicht mehr, wohin sie fuehrt. Bei nowrap waren hier 5 von 8 gekuerzt.
  const gekuerztDesktop = await p.evaluate(() => [...document.querySelectorAll('#kwGrid .kw b')]
    .filter(b => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).length);
  check('KRITISCH: am Desktop ist keine Beschriftung abgeschnitten', gekuerztDesktop === 0);
  // Der eigentliche Fehler bei nowrap ist NICHT die Kuerzung -- gemessen wird
  // gar nicht gekuerzt. Stattdessen blaeht der lange Text seine Spalte auf
  // (1fr ist minmax(AUTO,1fr)), und die Kacheln werden 129, 162 und 179px
  // breit statt gleich. Das Raster franst aus, ohne dass Text verschwindet:
  // schwerer zu bemerken als eine Kuerzung, darum eine eigene Pruefung.
  const breiten = await p.evaluate(() => [...new Set([...document.querySelectorAll('#kwGrid .kw')]
    .map(e => Math.round(e.getBoundingClientRect().width)))]);
  check('KRITISCH: alle Kacheln sind gleich breit -- das Raster bestimmt die Breite, nicht der Text',
    breiten.length === 1);
  await p.screenshot({ path: `${OUT}/kurzwahl.png` });
  await p.close();
} catch (e) { bad.push('Grundzustand: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ JEDER WEG FUEHRT WIRKLICH HIN
//
// Ein Eintrag, der dasteht und nichts tut, ist schlimmer als keiner: Er
// verspricht einen Weg. Darum wird jeder einzeln geklickt.
const ZIELE = [
  // Seit ENT-114 ist das Anlegen eine eigene Ansicht, kein Dialog über der
  // Planung -- der Seitentitel heisst darum jetzt "Neuer Einsatz".
  ['Einsatz erstellen',       'Neuer Einsatz',        '#view-einsatzneu'],
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
    const kw = [...document.querySelectorAll('#kwGrid .kw')];
    const l = kw.map(e => Math.round(e.getBoundingClientRect().left));
    return {
      spalten: new Set(l).size,
      quer: document.documentElement.scrollWidth > window.innerWidth + 1,
      // Kuerzung in BEIDE Richtungen pruefen. Erster Anlauf sah nur
      // scrollHeight -- der faengt die geklammerten Zeilen, aber nicht
      // text-overflow:ellipsis, das waagrecht kuerzt. Die Gegenprobe blieb
      // dadurch gruen, obwohl die Beschriftung sichtbar abgeschnitten war.
      gekuerzt: kw.filter(e => {
        const b = e.querySelector('b');
        return b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1;
      }).length,
      hoehen: [...new Set(kw.map(e => Math.round(e.getBoundingClientRect().height)))],
    };
  });
  // Seit ENT-235 sind es Kacheln, nicht mehr Zeilen. Frueher stand hier
  // "eine Spalte" -- richtig fuer die alte Zeilenform, falsch fuer Kacheln:
  // Eine Kachel ueber die volle Handybreite ist keine Kachel mehr.
  check('KRITISCH: auf dem Handy stehen zwei Kacheln nebeneinander (ENT-235)', m.spalten === 2);
  check('KRITISCH: kein Querscrollen auf dem Handy', m.quer === false);
  // Gemessen statt angenommen: Mit nowrap waren auf 390px alle acht
  // Beschriftungen gekuerzt, mit drei Spalten noch eine. Eine Kachel, deren
  // Beschriftung abgeschnitten ist, sagt nicht mehr, wohin sie fuehrt.
  check('KRITISCH: keine Beschriftung ist abgeschnitten', m.gekuerzt === 0);
  check('Alle Kacheln sind gleich hoch -- sonst franst das Raster aus', m.hoehen.length === 1);
  check('Die Kachel erfuellt die 44px-Mindesttrefferflaeche', m.hoehen[0] >= 44);
  await p.close();
} catch (e) { bad.push('Schmal: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════════════════════════ KACHEL-GESTALTUNG UND THEMA
//
// Der Fehler, den das hier verhindert, war live: Die Schnellzugriff-Knoepfe
// trugen feste Hexwerte (#1e293b, #2d3a4f). Die galten in BEIDEN Themen --
// im hellen ergab das einen Block dunkler Knoepfe auf weissem Grund
// (gemessen: Seitengrund rgb(247,248,250), Knopfgrund rgb(30,41,59)).
// Nichts ging kaputt, nichts meldete sich; es sah nur falsch aus.
//
// Geprueft wird darum die Aussage, nicht der Wert: Wechselt das Thema, muss
// sich der Kachelgrund mitaendern. Welche Farbe es genau ist, entscheidet
// die Token-Schicht und darf sich aendern.
try {
  const p = await seite(ALLE_RECHTE, 1500);
  const farbe = async () => p.evaluate(() => ({
    kachel: getComputedStyle(document.querySelector('#kwGrid .kw')).backgroundColor,
    seite: getComputedStyle(document.body).backgroundColor,
  }));
  await p.evaluate(() => themaSetzen('hell'));
  await p.waitForTimeout(250);
  const hell = await farbe();
  await p.evaluate(() => themaSetzen('dunkel'));
  await p.waitForTimeout(250);
  const dunkel = await farbe();

  check('KRITISCH: der Kachelgrund folgt dem Thema, statt fest verdrahtet zu sein (ENT-235)',
    hell.kachel !== dunkel.kachel);
  // Zweite, unabhaengige Sicht auf dieselbe Sache: Im hellen Thema darf die
  // Kachel nicht dunkler sein als die Seite -- genau das war der Fehler.
  const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  check('KRITISCH: im hellen Thema ist die Kachel nicht dunkler als die Seite',
    lum(hell.kachel) >= lum(hell.seite) - 0.05);
  check('Im dunklen Thema hebt sie sich vom Grund ab', lum(dunkel.kachel) > lum(dunkel.seite));

  // Kachel heisst: Symbol oben, Beschriftung darunter. Eine Zeile mit Symbol
  // links waere wieder die alte Form -- und faellt sonst niemandem auf.
  const aufbau = await p.evaluate(() => {
    const kw = document.querySelector('#kwGrid .kw');
    const s = kw.querySelector('svg').getBoundingClientRect();
    const b = kw.querySelector('b').getBoundingClientRect();
    return { richtung: getComputedStyle(kw).flexDirection, symbolOben: s.bottom <= b.top + 1 };
  });
  check('KRITISCH: die Kachel steht als Spalte, nicht als Zeile', aufbau.richtung === 'column');
  check('KRITISCH: das Symbol steht ueber der Beschriftung, nicht daneben', aufbau.symbolOben);
  await p.close();
} catch (e) { bad.push('Kachel: ' + String(e).split('\n')[0].slice(0, 120)); }

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
