// Filter im Tagesplan, Sparte in beiden Filtern, Reiterausrichtung (ENT-069).
//
// Der teuerste Fehler waere hier nicht ein Filter, der zu viel zeigt, sondern
// einer, der zu wenig zeigt, ohne es zu sagen: Ein Tag mit fuenf Einsaetzen
// darf nie wie ein leerer Tag aussehen, bloss weil eine Auswahl von gestern
// noch steht. Mehrere Pruefungen zielen genau darauf.
//
// Alle Testdaten sind erfunden.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
// Alle Daten dieser Suite haengen an HEUTE, nicht an einem festen Datum.
//
// Bis zum 22.08.2026 stand hier ueberall der Literalwert '2026-08-21'. Um
// Mitternacht war das nicht mehr der heutige Tag: Die Marke "heute"
// verschwand aus der Kopfkarte, und zwei Pruefungen wurden rot -- ohne dass
// sich am Produkt irgendetwas geaendert hatte. Eine Pruefung, die am
// Kalender haengt, ist keine Pruefung. Sie meldet Fehler, die keine sind,
// und wer das ein paarmal erlebt, glaubt dem Rot nicht mehr.
const isoDat = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const TAG   = isoDat(new Date());                          // heute
const FERN  = isoDat(new Date(Date.now() + 9 * 864e5));    // ein Tag ohne Einsaetze

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Vier Zeilen, die jede Filterachse einzeln aufspannen:
//   1  Objektschicht · Sicherheit · geplant   · unterbesetzt
//   2  freier Einsatz · Sicherheit · bestätigt · voll besetzt
//   3  Objektschicht · Reinigung  · geplant   · unterbesetzt
//   4  freier Einsatz · Reinigung  · abgesagt  · unterbesetzt
const E = (id, von, bis, objekt_id, sparte, status, bedarf, ma) => ({
  id, kunde_id: 1, kunde_name: 'Muster AG', titel: '', ort: 'Musterstadt', strasse: 'Musterweg 1',
  datum: TAG, von, bis, bedarf, mitarbeiter: ma || [], status, objekt_id, sparte });
const EINS = [
  E(1, '05:15', '05:30', 10, 'sicherheit', 'geplant', 1, []),
  E(2, '06:00', '07:00', null, 'sicherheit', 'bestaetigt', 1, [{ id: 1, name: 'a', vorname: 'A', nachname: 'B' }]),
  E(3, '08:00', '09:00', 11, 'reinigung', 'geplant', 2, []),
  E(4, '10:00', '11:00', null, 'reinigung', 'abgesagt', 1, []),
];

const browser = await chromium.launch({ executablePath: EXE });

async function seite(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.setDefaultTimeout(5000);
  await p.route('**/api/**', r => {
    const pf = r.request().url().split('/api/')[1].split('?')[0];
    const send = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (pf.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (pf.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINS });
    if (pf.includes('feiertag')) return send({ status: 'ok', kanton: 'SO', feiertage: [], gepflegt: {} });
    return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
      rapporte: [], objekte: [], masterschichten: [], einsaetze: EINS, kunden: [], mitarbeiter: [], orte: [] });
  });
  await p.goto(URL);
  await p.fill('#gName', 'adrian'); await p.fill('#gPass', 'x'); await p.click('#gBtn');
  await p.waitForSelector('#shell.on'); await p.waitForTimeout(600);
  await p.evaluate(() => go('planung')); await p.waitForTimeout(400);
  return p;
}

// ══════════════════════════════════════════ HANDY
const m = await seite(390, 844);
const jsFehler = [];
m.on('pageerror', e => jsFehler.push(e.message));
await m.evaluate(t => { $('tgD').value = t; goTab('tag'); }, TAG);
await m.waitForTimeout(500);

const karten = () => m.evaluate(() => document.querySelectorAll('#tgBody .ag-karte').length);
const setzen = async (h, s) => {
  await m.selectOption('#tgHerkunft', h);
  await m.selectOption('#tgStatus', s);
  await m.waitForTimeout(250);
};

// ── Das entfernte Kästchen
check('KRITISCH: das Kästchen „nur unbesetzte" ist weg',
  await m.evaluate(() => !document.getElementById('tgNurOffen')));
check('Seine Funktion steckt jetzt im Statusfilter',
  await m.evaluate(() => [...document.getElementById('tgStatus').options]
    .some(o => o.value === 'offen' && /unterbesetzt/i.test(o.textContent))));

// ── Die beiden Filter sind da und tragen dieselben Optionen wie in Einsätze
const optionen = sel => m.evaluate(id => [...document.getElementById(id).options].map(o => o.value), sel);
const tgH = await optionen('tgHerkunft'), pH = await optionen('pHerkunft');
const tgS = await optionen('tgStatus'), pS = await optionen('pStatus');
check('KRITISCH: der Herkunftsfilter im Tagesplan hat genau dieselben Optionen wie in Einsätze',
  JSON.stringify(tgH) === JSON.stringify(pH));
check('KRITISCH: der Statusfilter ebenso', JSON.stringify(tgS) === JSON.stringify(pS));
check('Die Sparte Reinigung ist wählbar', tgH.includes('reinigung'));
check('Sicherheit ebenfalls, sonst wäre Reinigung ein Sonderfall', tgH.includes('sicherheit'));
check('Herkunft bleibt daneben erhalten', tgH.includes('einsatz') && tgH.includes('objekt'));
check('Die zwei Dimensionen sind in der Auswahl sichtbar getrennt',
  await m.evaluate(() => [...document.getElementById('tgHerkunft').querySelectorAll('optgroup')]
    .map(g => g.label).join('|') === 'Herkunft|Sparte'));

// ── Filter wirken wirklich, jede Achse einzeln
check('Ungefiltert stehen alle vier da', (await karten()) === 4);
await setzen('einsatz', '');
check('KRITISCH: „Nur Einsätze" zeigt die zwei freien Einsätze', (await karten()) === 2);
await setzen('objekt', '');
check('KRITISCH: „Nur Objektschichten" zeigt die zwei aus Objekten', (await karten()) === 2);
await setzen('sicherheit', '');
check('KRITISCH: „Nur Sicherheit" zeigt die zwei Sicherheitszeilen', (await karten()) === 2);
await setzen('reinigung', '');
check('KRITISCH: „Nur Reinigung" zeigt die zwei Reinigungszeilen', (await karten()) === 2);
check('... und wirklich nur die Reinigung',
  await m.evaluate(() => [...document.querySelectorAll('#tgBody .ag-karte')]
    .every(k => /08:00|10:00/.test(k.textContent))));
await setzen('', 'offen');
// Zwei, nicht drei: Zeile 4 ist ABGESAGT, und fehlend() gibt fuer abgesagte
// Schichten 0 zurueck. Eine abgesagte Schicht ist nicht unterbesetzt, sie ist
// abgesagt -- das war meine Erwartung, die falsch war, nicht das Verhalten.
check('KRITISCH: „Nur unterbesetzt" ersetzt das alte Kästchen', (await karten()) === 2);
check('KRITISCH: eine abgesagte Schicht gilt nicht als unterbesetzt',
  await m.evaluate(() => !/10:00/.test(document.getElementById('tgBody').textContent)));
await setzen('', 'abgesagt');
check('„Nur abgesagt" greift', (await karten()) === 1);
await setzen('', 'bestaetigt');
check('„Nur bestätigt" greift', (await karten()) === 1);

// Beide Felder gleichzeitig -- Herkunft/Sparte UND Status lassen sich kombinieren
await setzen('reinigung', 'geplant');
check('KRITISCH: die beiden Felder wirken zusammen, nicht gegeneinander', (await karten()) === 1);

// ── Der gefährliche Fall: Filter blendet alles aus
await setzen('reinigung', 'bestaetigt');
const leer = (await m.textContent('#tgBody')).replace(/\s+/g, ' ');
check('KRITISCH: ein Filter, der alles ausblendet, sagt „Kein Treffer"', /Kein Treffer/.test(leer));
check('KRITISCH: er behauptet NICHT, für den Tag sei nichts geplant',
  !/kein Einsatz geplant/.test(leer));
check('Er nennt, wie viele es am Tag tatsächlich gäbe', /4 Einsätze/.test(leer));

// Und der Tageskopf darf die gefilterte Zahl nicht als Tagessumme ausgeben
const kopfGefiltert = (await m.textContent('#tgKopf')).replace(/\s+/g, ' ');
check('KRITISCH: der Tageskopf stellt die gefilterte Zahl der echten gegenüber',
  /von 4/.test(kopfGefiltert));

// Ohne Filter steht dort wieder die schlichte Zahl, ohne „von"
await setzen('', '');
const kopfRoh = (await m.textContent('#tgKopf')).replace(/\s+/g, ' ');
check('Ohne Filter bleibt der Kopf schlicht', !/von 4/.test(kopfRoh) && /4/.test(kopfRoh));
check('Ein leerer Tag heisst weiterhin „Nichts geplant"',
  await m.evaluate(async f => {
    $('tgD').value = f; renderTagesplan();
    return /Nichts geplant/.test(document.getElementById('tgBody').textContent);
  }, FERN));
await m.evaluate(t => { $('tgD').value = t; renderTagesplan(); }, TAG);
await m.waitForTimeout(300);

// ── Lage: die zwei Filter direkt oberhalb des Knopfs
const reihe = await m.evaluate(() => [...document.querySelectorAll('#pv-tag .bar-tools > *')]
  .filter(e => e.getClientRects().length)
  .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
                || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  .map(e => e.id || 'btn:' + e.textContent.trim()));
const iH = reihe.indexOf('tgHerkunft'), iS = reihe.indexOf('tgStatus');
const iBtn = reihe.findIndex(x => /Neuer Einsatz/.test(x));
check('KRITISCH: Herkunftsfilter steht oberhalb des Knopfs', iH >= 0 && iH < iBtn);
check('KRITISCH: Statusfilter ebenso', iS >= 0 && iS < iBtn);
check('KRITISCH: die beiden stehen DIREKT davor, nichts dazwischen', iBtn === iS + 1 && iS === iH + 1);
check('Jeder Filter hat eine eigene Zeile', await m.evaluate(() => {
  const a = document.getElementById('tgHerkunft').getBoundingClientRect();
  const b = document.getElementById('tgStatus').getBoundingClientRect();
  return b.top >= a.bottom - 1;
}));

// ── Reiterausrichtung
const tabs = await m.evaluate(() => {
  // Die Leiste traegt mobil links und rechts je 16px Innenabstand (sie ragt
  // dafuer mit negativem Aussenabstand ueber den Inhalt hinaus, damit sie
  // fuer sich scrollen kann). Verglichen wird darum gegen den INHALTS-
  // bereich; gegen den Rahmen gemessen waere jeder Reiter um 16px daneben.
  const el = document.querySelector('#view-planung .tabs');
  const cs = getComputedStyle(el);
  const roh = el.getBoundingClientRect();
  const leiste = { left: roh.left + parseFloat(cs.paddingLeft), right: roh.right - parseFloat(cs.paddingRight) };
  const t = [...document.querySelectorAll('#view-planung .tabs .tab')]
    .filter(x => x.getClientRects().length)
    .map(x => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), l: r.left, r: r.right, w: r.width }; })
    .sort((a, b) => a.l - b.l);
  return { t, leiste: { l: leiste.left, r: leiste.right } };
});
check('KRITISCH: Tagesplan steht links aussen', tabs.t[0].t === 'Tagesplan');
check('KRITISCH: Objektplanung steht rechts aussen', tabs.t[tabs.t.length - 1].t === 'Objektplanung');
check('KRITISCH: Objektplanung reicht bis an den rechten Rand',
  Math.abs(tabs.t[tabs.t.length - 1].r - tabs.leiste.r) <= 2);
check('Tagesplan sitzt am linken Rand', Math.abs(tabs.t[0].l - tabs.leiste.l) <= 2);
const breiten = tabs.t.map(x => x.w);
check('KRITISCH: die Reiter teilen sich die Breite gleichmässig',
  Math.max(...breiten) - Math.min(...breiten) <= 2);
const luecken = tabs.t.slice(1).map((x, i) => x.l - tabs.t[i].r);
check('Die Abstände dazwischen sind gleich',
  Math.max(...luecken) - Math.min(...luecken) <= 2);

// ── Aufbau der Kopfkarte (ENT-070)
//
// Der Projektinhaber: "Sauberes Design ist mir wichtig!" Diese Pruefungen
// messen den gerenderten Zustand -- Groessen, Positionen, Reihenfolge --
// statt im Quelltext nachzulesen, ob eine Regel dasteht.
await m.evaluate(t => { $('tgD').value = t; renderTagesplan(); }, TAG);
await m.waitForTimeout(300);

const kopf = await m.evaluate(() => {
  const k = document.querySelector('.tg-kopfkarte').getBoundingClientRect();
  const r = s => { const e = document.querySelector(s); if (!e) { return null; }
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, mitte: (b.left + b.right) / 2 }; };
  const stil = s => { const c = getComputedStyle(document.querySelector(s));
    return c.fontSize + '/' + c.fontWeight + '/' + c.textTransform + '/' + c.letterSpacing; };
  const el = document.querySelector('.tg-kopfkarte');
  return {
    karteMitte: (k.left + k.right) / 2, karteRechts: k.right,
    chip: r('.tg-marken .chip'), wd: r('.tg-wd'), datum: r('.tg-datum'),
    lbl: r('.tg-zahl-lbl'), zahl: r('.tg-zahl'), offen: r('.tg-offen'),
    wdStil: stil('.tg-wd'), lblStil: stil('.tg-zahl-lbl'),
    lblText: document.querySelector('.tg-zahl-lbl').textContent.trim(),
    offenText: document.querySelector('.tg-offen') ? document.querySelector('.tg-offen').textContent.trim() : null,
    ueberlauf: el.scrollWidth > el.clientWidth + 1,
  };
});

check('KRITISCH: die Marke „heute" steht mittig zur Karte',
  kopf.chip && Math.abs(kopf.chip.mitte - kopf.karteMitte) <= 2);
check('KRITISCH: sie steht oben, auf einer Linie mit den Überschriften',
  kopf.chip && Math.abs(kopf.chip.t - kopf.wd.t) <= 2);
check('KRITISCH: rechts steht die Überschrift ÜBER der Zahl, nicht darunter',
  kopf.lbl.b <= kopf.zahl.t + 1);
check('Links ebenso — beide Seiten nach demselben Muster',
  kopf.wd.b <= kopf.datum.t + 1);
check('KRITISCH: beide Überschriften auf gleicher Höhe',
  Math.abs(kopf.lbl.t - kopf.wd.t) <= 2);
check('KRITISCH: beide Überschriften tragen exakt denselben Stil',
  kopf.wdStil === kopf.lblStil);
check('Die rechte Spalte schliesst bündig mit dem rechten Kartenrand ab',
  Math.abs(kopf.zahl.r - kopf.lbl.r) <= 2);
check('KRITISCH: nichts läuft aus der Karte heraus', !kopf.ueberlauf);
check('KRITISCH: die Überschrift bricht nicht um',
  kopf.lbl.b - kopf.lbl.t < 22);

// Die Einheiten
check('KRITISCH: die Überschrift zählt Einsätze und nichts anderes',
  kopf.lblText === 'Einsätze' || kopf.lblText === 'Einsatz');
check('KRITISCH: die offenen Plätze stehen als eigene Zeile, nicht in der Überschrift',
  kopf.offen !== null && /offen/.test(kopf.offenText) && !/offen/i.test(kopf.lblText));
// Ab hier ohne Zugriff auf ein moeglicherweise fehlendes Element: Faellt die
// Zeile weg, sollen die Pruefungen FEHLSCHLAGEN und sagen warum -- nicht die
// Suite abreissen und alles dahinter verschlucken.
check('Sie stehen unter der Zahl', !!kopf.offen && kopf.offen.t >= kopf.zahl.b - 1);
check('KRITISCH: die beiden Zahlen sind verschiedene Grössen und werden getrennt gezeigt',
  await m.evaluate(() => {
    const zeile = document.querySelector('.tg-offen');
    if (!zeile) { return false; }
    const einsaetze = document.querySelectorAll('#tgBody .ag-karte').length;
    const offen = parseInt(zeile.textContent, 10);
    const gross = parseInt(document.querySelector('.tg-zahl').textContent, 10);
    return gross === einsaetze && offen !== gross;   // 4 Einsätze, 5 offene Plätze
  }));

// Ohne offene Plätze verschwindet die Zeile, statt „0 offen" zu behaupten
check('Ohne offene Plätze steht dort gar nichts',
  await m.evaluate(async () => {
    const merk = einsaetze.map(e => e.mitarbeiter);
    einsaetze.forEach(e => { e.mitarbeiter = Array.from({ length: e.bedarf }, (_, i) => ({ id: i, name: 'x' })); });
    renderTagesplan();
    const weg = !document.querySelector('.tg-offen');
    einsaetze.forEach((e, i) => { e.mitarbeiter = merk[i]; });
    renderTagesplan();
    return weg;
  }));

await m.screenshot({ path: `${OUT}/tgf-01-handy.png` });
check('KRITISCH: keine JavaScript-Fehler', jsFehler.length === 0);
await m.close();

// ══════════════════════════════════════════ DESKTOP
const d = await seite(1440, 900);
await d.evaluate(t => { $('tgD').value = t; goTab('tag'); }, TAG);
await d.waitForTimeout(500);

// Die Sparte muss auch in der Einsatzliste greifen -- sonst haette der
// Tagesplan Optionen, die woanders nichts tun.
await d.evaluate(() => goTab('einsaetze'));
await d.waitForTimeout(400);
await d.evaluate(t => { $('pVon').value = t; $('pBis').value = t; renderPlanung(); }, TAG);
await d.waitForTimeout(400);
const zeilen = () => d.evaluate(() => document.querySelectorAll('#plTable tbody tr:not(.gruppe)').length);
// Baseline explizit auf "beides" setzen statt den Vorgabewert zu nehmen --
// die Vorgabe ist seit ENT-106 "Nur Einsätze", nicht mehr "beides".
await d.selectOption('#pHerkunft', '');
await d.waitForTimeout(300);
const alleZeilen = await zeilen();
await d.selectOption('#pHerkunft', 'reinigung');
await d.waitForTimeout(400);
check('KRITISCH: die Sparte filtert auch in der Einsatzliste', (await zeilen()) < alleZeilen);
check('Und zwar auf die Reinigungszeilen',
  await d.evaluate(() => /08:00|10:00/.test(document.getElementById('plTable').textContent)));
await d.selectOption('#pHerkunft', 'objekt');
await d.waitForTimeout(400);
check('Die Herkunft funktioniert dort weiterhin',
  await d.evaluate(() => /05:15|08:00/.test(document.getElementById('plTable').textContent)));
await d.selectOption('#pHerkunft', '');
await d.waitForTimeout(300);

const tabsD = await d.evaluate(() => [...document.querySelectorAll('#view-planung .tabs .tab')]
  .filter(x => x.getClientRects().length)
  .map(x => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), l: r.left, w: r.width }; })
  .sort((a, b) => a.l - b.l));
check('Desktop: Reiterreihenfolge unverändert', tabsD[0].t === 'Übersicht' && tabsD[3].t === 'Tagesplan');
check('KRITISCH: Desktop-Reiter werden NICHT über die Breite gestreckt',
  tabsD.reduce((s, x) => s + x.w, 0) < 700);
check('Desktop: das Kästchen ist auch dort ersetzt, nicht nur mobil versteckt',
  await d.evaluate(() => !document.getElementById('tgNurOffen')));
// Zurueck auf den Tagesplan: zuletzt stand die Einsatzliste offen, und ein
// Feld in einem verborgenen Reiter ist nie "sichtbar".
await d.evaluate(() => goTab('tag'));
await d.waitForTimeout(400);
check('Desktop: beide Filter im Tagesplan sichtbar',
  await d.isVisible('#tgHerkunft') && await d.isVisible('#tgStatus'));

await d.screenshot({ path: `${OUT}/tgf-02-desktop.png` });
await d.close();

// ══════════════════════════════════════════ EINE REGEL, NICHT ZWEI
const dash = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
check('KRITISCH: die Filterregel steht genau einmal',
  (dash.match(/function planHerkunftPasst/g) || []).length === 1
  && (dash.match(/function planStatusPasst/g) || []).length === 1);
check('KRITISCH: der Tagesplan baut sie nicht nach, sondern ruft sie auf',
  /renderTagesplan[\s\S]{0,900}planHerkunftPasst\(e, herkunft\) && planStatusPasst\(e, status\)/.test(dash));
// Nicht ueber einen Zeichenabstand pruefen, sondern im Rumpf der Funktion:
// Ein Abstandsmass wird rot, sobald jemand einen Kommentar davorsetzt --
// genau das ist bei ENT-119 passiert, obwohl der Aufruf unveraendert dastand.
// Eine Pruefung, die auf Formatierung reagiert statt auf Verhalten, wird
// irgendwann weggeklickt statt gelesen.
const rumpf = name => {
  const i = dash.indexOf(`function ${name}(`);
  if (i < 0) { return ''; }
  const j = dash.indexOf('\n}', i);
  return j < 0 ? dash.slice(i) : dash.slice(i, j);
};
check('Die Einsatzliste ebenso', rumpf('pFiltered').includes('planHerkunftPasst(e, herkunft)'));
check('KRITISCH: die Herkunftsprüfung kennt objekt_id als Merkmal, nicht die Einsatzart',
  /planHerkunftPasst[\s\S]{0,400}e\.objekt_id/.test(dash));
check('KRITISCH: die Spartenprüfung nutzt sparteVon, nicht einen eigenen Vergleich',
  /planHerkunftPasst[\s\S]{0,500}sparteVon\(e\) === herkunft/.test(dash));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
