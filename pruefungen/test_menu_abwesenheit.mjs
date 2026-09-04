// Kachel "Abwesenheit" im Menü (ENT-370).
//
// Der Projektinhaber hat den Antrag im Menü gesucht -- so liegt er bei
// Coredinate, das dort zwei Kacheln "Eigene Daten" und "Antrag Abwesenheit"
// nebeneinander zeigt. Bei uns gab es den Bereich bereits seit ENT-255,
// aber nur als Unterreiter von Plan; im Menü stand niemand danach.
//
// Bewusst KEIN zweiter Bauteil: Die Kachel fuehrt in denselben Unterreiter
// (planUnterWahl('abwesenheit')), nicht auf eine eigene Kopie der Liste.
// Zwei Wege auf ein Ziel, nicht zwei Ziele.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
// Ein Klick ins Leere oder ein evaluate() gegen ein fehlendes Element darf
// die ganze Suite nicht mitreissen -- eine abgestuerzte Suite meldet gar
// keine rote Pruefung, das ist schlimmer als eine, die rot wird.
const klick = async s => { try { await page.click(s, { timeout: 2000 }); return true; }
                           catch (e) { return false; } };
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('mein_profil')) return send({ status: 'ok', profil: {
    name: 'm.muster', vorname: 'Max', nachname: 'Muster', personalnummer: 'P-001',
    strasse: '', ort: '', telefon: '', mobil: '', email: '', ist_admin: false } });
  if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('meine_abwesenheit')) return send({ status: 'ok', abwesenheiten: [] });
  if (p.includes('abwesenheit_saldo')) return send({ status: 'ok', saldo_tage: 12 });
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForTimeout(600);

// ══════════ DIE KACHEL STEHT IM MENÜ ═══════════════════════════════════
await page.click('#t-menu');
await page.waitForTimeout(400);
check('KRITISCH: die Kachel "Abwesenheit" ist im Menü sichtbar',
  await page.isVisible('#mk-abwesenheit'));
check('Sie steht neben den beiden bestehenden Kacheln, nicht anstelle einer davon',
  await page.isVisible('#mk-daten') && await page.isVisible('#mk-stunden'));
check('Sie traegt eine Beschriftung, keine blosse Flaeche',
  ((await page.textContent('#mk-abwesenheit').catch(() => '')) || '').trim().length > 0);
check('44 px Trefferflaeche (CLAUDE.md)',
  (await ev(() => document.getElementById('mk-abwesenheit')?.getBoundingClientRect().height)) >= 44);

// ══════════ DER WEG FUEHRT INS ECHTE ZIEL ══════════════════════════════
const geklickt = await klick('#mk-abwesenheit');
await page.waitForTimeout(500);
check('Die Kachel liess sich anklicken', geklickt);
check('KRITISCH: ein Klick fuehrt auf den Plan-Reiter',
  await ev(() => document.getElementById('v-plan')?.classList.contains('on')));
check('KRITISCH: dort ist der Unterreiter "Abwesenheit" bereits gewaehlt, kein weiterer Klick noetig',
  await ev(() => document.getElementById('pu-abwesenheit')?.classList.contains('on')));
check('KRITISCH: der Inhalt "Abwesenheit" ist sichtbar',
  await ev(() => { const e = document.getElementById('plan-inhalt-abwesenheit');
    return !!e && getComputedStyle(e).display !== 'none'; }));
check('Der Inhalt "Plan" ist NICHT gleichzeitig sichtbar -- sonst zeigt die Seite zwei Dinge auf einmal',
  await ev(() => { const e = document.getElementById('plan-inhalt-plan');
    return !!e && getComputedStyle(e).display === 'none'; }));
check('KRITISCH: es ist derselbe Bereich wie ueber Plan -- der "Neuer Antrag"-Knopf ist da',
  await page.isVisible('#plan-inhalt-abwesenheit button').catch(() => false));
check('Der Menü-Reiter selbst ist nicht mehr aktiv, nur noch Plan',
  await ev(() => !document.getElementById('v-menu')?.classList.contains('on')));

// ══════════ ZWEITER WEG: DIREKT UEBER PLAN FUEHRT ZUM SELBEN ORT ═══════
// Kein zweites Bauteil -- derselbe Unterreiter, ob man ueber die Kachel oder
// ueber Plan -> Abwesenheit kommt.
await klick('#t-heute'); await page.waitForTimeout(300);   // Ausgangslage zuruecksetzen
await klick('#t-plan'); await page.waitForTimeout(300);
await klick('#pu-abwesenheit'); await page.waitForTimeout(300);
const direkterWeg = await ev(() => document.getElementById('plan-inhalt-abwesenheit')?.innerHTML || '');
await klick('#t-menu'); await page.waitForTimeout(300);
await klick('#mk-abwesenheit'); await page.waitForTimeout(300);
const kachelWeg = await ev(() => document.getElementById('plan-inhalt-abwesenheit')?.innerHTML || '');
check('KRITISCH: beide Wege zeigen denselben Inhalt -- keine zweite, abweichende Kopie',
  !!direkterWeg && direkterWeg === kachelWeg && direkterWeg.length > 0);

// ══════════ DIE KACHEL BLEIBT BEIM WIEDER-OEFFNEN DES MENÜS UNVERAENDERT
// Ein Sprung von der Kachel darf den Menü-Reiter selbst nicht kaputt machen --
// die anderen beiden Kacheln muessen danach weiterhin normal funktionieren.
await klick('#t-menu'); await page.waitForTimeout(300);
await klick('#mk-daten'); await page.waitForTimeout(300);
check('Die Kachel "Meine Daten" funktioniert nach einem Abstecher ueber "Abwesenheit" weiterhin',
  await ev(() => { const e = document.getElementById('pr-daten');
    return !!e && getComputedStyle(e).display !== 'none'; }));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
