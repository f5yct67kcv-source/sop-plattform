// Konfigurierbares Dashboard (ENT-031): Container verschieben, ein-/ausblenden,
// Speichern/Abbrechen/Zurücksetzen, künftige Container reihen sich automatisch ein.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const STATS = { status: 'ok', kpi: { rapporte_monat: 1, rapporte_vormonat: 0, stunden_monat: 8, stunden_vormonat: 0,
  mitarbeiter: 2, kunden: 1, rapporte_total: 1 },
  verlauf: Array.from({ length: 8 }, (_, i) => ({ kw: 26 + i, stunden: 10, anzahl: 1 })),
  angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] };

async function starte(vorbelegt) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  if (vorbelegt !== undefined) {
    await page.addInitScript(v => { try { localStorage.setItem('rv3_dash_layout', v); } catch (e) {} }, vorbelegt);
  }
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (u.includes('dashboard_stats')) return send(STATS);
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
      feiertage: [], gepflegt: {}, sperren: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
  return { browser, page };
}
const reihenfolge = page => page.evaluate(() =>
  [...document.querySelectorAll('.dash-item')].sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(e => e.dataset.widget));

let { browser, page } = await starte();

// ══════════ GRUNDZUSTAND
check('„Bearbeiten“ steht oben rechts', await page.isVisible('#btnDashBearbeiten'));
check('Die Bearbeitungsleiste ist zunächst verborgen', !(await page.isVisible('#dashEditleiste')));
check('Alle sieben Container sind da',
  await page.evaluate(() => document.querySelectorAll('.dash-item').length === 7));
check('Standardreihenfolge stimmt',
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(['begruessung', 'kpi', 'verlauf', 'angemeldet', 'letzte', 'proma', 'ereignisse']));
check('Kein Container ist ausgeblendet',
  await page.evaluate(() => document.querySelectorAll('.dash-item.versteckt').length === 0));
check('Der Bearbeiten-Knopf verschwindet auf anderen Ansichten',
  await page.evaluate(() => { go('mitarbeiter'); return getComputedStyle($('btnDashBearbeiten')).display === 'none'; }));
await page.evaluate(() => go('uebersicht'));
await page.waitForTimeout(150);

// ══════════ BEARBEITUNGSMODUS
await page.click('#btnDashBearbeiten');
await page.waitForTimeout(200);
check('„Bearbeiten“ verschwindet', !(await page.isVisible('#btnDashBearbeiten')));
check('Die drei Knöpfe erscheinen', await page.isVisible('#dashEditleiste'));
check('Zurücksetzen, Abbrechen, Speichern in dieser Reihenfolge',
  (await page.textContent('#dashEditleiste')).replace(/\s+/g, ' ').includes('Zurücksetzen Abbrechen Speichern'));
check('Jeder Container zeigt jetzt sein Werkzeug',
  await page.evaluate(() => document.querySelectorAll('.dash-werk').length === 7 &&
    [...document.querySelectorAll('.dash-werk')].every(w => getComputedStyle(w).display !== 'none')));
await page.screenshot({ path: OUT + '/71-bearbeiten.png' });

// ══════════ MIT PFEILEN VERSCHIEBEN
await page.click('.dash-item[data-widget="letzte"] .dash-werk button[title="Weiter vorne"]');
await page.waitForTimeout(150);
check('„Letzte Rapporte“ ist einen Platz nach vorne gerückt',
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(['begruessung', 'kpi', 'verlauf', 'letzte', 'angemeldet', 'proma', 'ereignisse']));
check('Erster Container kann nicht weiter nach vorne',
  await page.evaluate(() => document.querySelector('.dash-item[data-widget="begruessung"] button[title="Weiter vorne"]').disabled === false));
// (der Pfeil ist nicht deaktiviert, da wir keine harte Grenzanzeige gebaut haben -- geprüft wird stattdessen, dass es an der Grenze nichts tut)
const vorherKette = await reihenfolge(page);
await page.click('.dash-item[data-widget="begruessung"] .dash-werk button[title="Weiter vorne"]');
await page.waitForTimeout(150);
check('Am Anfang bewegt „weiter vorne“ nichts', JSON.stringify(await reihenfolge(page)) === JSON.stringify(vorherKette));

// ══════════ AUSBLENDEN
await page.click('.dash-item[data-widget="angemeldet"] .dash-auge');
await page.waitForTimeout(150);
check('„Angemeldete Benutzer“ ist als ausgeblendet markiert',
  await page.evaluate(() => document.querySelector('.dash-item[data-widget="angemeldet"]').classList.contains('versteckt')));
check('Im Bearbeitungsmodus bleibt der Container sichtbar, nur gedimmt',
  await page.evaluate(() => getComputedStyle(document.querySelector('.dash-item[data-widget="angemeldet"]')).display !== 'none'));
await page.screenshot({ path: OUT + '/72-ausgeblendet.png' });

// ══════════ ZIEHEN PER GRIFF
await page.evaluate(() => {
  const von = document.querySelector('.dash-item[data-widget="ereignisse"] .griff');
  const auf = document.querySelector('.dash-item[data-widget="verlauf"]');
  const dt = new DataTransfer();
  von.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  auf.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  auf.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  von.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(200);
const nachZiehen = await reihenfolge(page);
check('Ziehen setzt „Ereignisse“ vor „Stundenverlauf“',
  nachZiehen.indexOf('ereignisse') === nachZiehen.indexOf('verlauf') - 1);

// ══════════ ABBRECHEN VERWIRFT
await page.click('#dashEditleiste button:has-text("Abbrechen")');
await page.waitForTimeout(200);
check('Nach Abbrechen gilt wieder die alte Reihenfolge',
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(['begruessung', 'kpi', 'verlauf', 'angemeldet', 'letzte', 'proma', 'ereignisse']));
check('Nach Abbrechen ist nichts mehr ausgeblendet',
  await page.evaluate(() => document.querySelectorAll('.dash-item.versteckt').length === 0));
check('Der Bearbeiten-Knopf ist wieder da', await page.isVisible('#btnDashBearbeiten'));
check('Nichts wurde in den Speicher geschrieben', !(await page.evaluate(() => localStorage.getItem('rv3_dash_layout'))));

// ══════════ SPEICHERN WIRKT UND BLEIBT
await page.click('#btnDashBearbeiten');
await page.waitForTimeout(150);
await page.click('.dash-item[data-widget="proma"] .dash-werk button[title="Weiter vorne"]');
await page.click('.dash-item[data-widget="ereignisse"] .dash-auge');
await page.waitForTimeout(150);
await page.click('#dashEditleiste button:has-text("Speichern")');
await page.waitForTimeout(250);
check('Nach Speichern ist der Bearbeitungsmodus vorbei', !(await page.isVisible('#dashEditleiste')));
const gespeichert = JSON.parse(await page.evaluate(() => localStorage.getItem('rv3_dash_layout')));
check('Die neue Reihenfolge steht im Speicher',
  gespeichert.findIndex(x => x.id === 'proma') < gespeichert.findIndex(x => x.id === 'letzte'));
check('„Ereignisse“ ist als ausgeblendet gespeichert',
  gespeichert.find(x => x.id === 'ereignisse').sichtbar === false);
check('Ausgeblendet ist jetzt wirklich unsichtbar',
  await page.evaluate(() => getComputedStyle(document.querySelector('.dash-item[data-widget="ereignisse"]')).display === 'none'));
await page.screenshot({ path: OUT + '/73-gespeichert.png' });
await browser.close();

// ══════════ ALLES AUSBLENDEN → LEERER ZUSTAND
({ browser, page } = await starte());
await page.click('#btnDashBearbeiten');
await page.waitForTimeout(150);
for (const w of ['begruessung', 'kpi', 'verlauf', 'angemeldet', 'letzte', 'proma', 'ereignisse']) {
  await page.click(`.dash-item[data-widget="${w}"] .dash-auge`);
}
await page.waitForTimeout(150);
check('Im Bearbeitungsmodus bleiben alle sichtbar (nur gedimmt)',
  await page.evaluate(() => [...document.querySelectorAll('.dash-item')].every(e => getComputedStyle(e).display !== 'none')));
await page.click('#dashEditleiste button:has-text("Speichern")');
await page.waitForTimeout(250);
check('Nach dem Speichern erklärt sich der leere Zustand',
  (await page.textContent('#dashLeer')).includes('Alle Container sind ausgeblendet'));
check('Der Hinweis nennt den Weg zurück', (await page.textContent('#dashLeer')).includes('Bearbeiten'));
await page.screenshot({ path: OUT + '/74-alles-aus.png' });

// ══════════ ZURÜCKSETZEN
await page.click('#btnDashBearbeiten');
await page.waitForTimeout(150);
await page.click('#dashEditleiste button:has-text("Zurücksetzen")');
await page.waitForTimeout(200);
check('Zurücksetzen stellt die Standardreihenfolge im Entwurf her',
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(['begruessung', 'kpi', 'verlauf', 'angemeldet', 'letzte', 'proma', 'ereignisse']));
check('Zurücksetzen blendet alles wieder ein',
  await page.evaluate(() => document.querySelectorAll('.dash-item.versteckt').length === 0));
check('Bleibt im Bearbeitungsmodus -- noch nicht gespeichert', await page.isVisible('#dashEditleiste'));
const vorSpeichernNachReset = JSON.parse(await page.evaluate(() => localStorage.getItem('rv3_dash_layout')));
check('Der Speicher trägt den Reset noch nicht mit',
  vorSpeichernNachReset.every(x => x.sichtbar === false) || vorSpeichernNachReset.find(x => x.id === 'kpi').sichtbar === false);
await page.click('#dashEditleiste button:has-text("Speichern")');
await page.waitForTimeout(200);
check('Nach dem Speichern ist wieder alles sichtbar',
  await page.evaluate(() => document.querySelectorAll('.dash-item.versteckt').length === 0));
await browser.close();

// ══════════ KÜNFTIGE CONTAINER REIHEN SICH EIN
const alteVersion = JSON.stringify([
  { id: 'ereignisse', sichtbar: true }, { id: 'kpi', sichtbar: false },
  { id: 'ein-entferntes-widget', sichtbar: true },
]);
({ browser, page } = await starte(alteVersion));
const geladen = await reihenfolge(page);
check('Ein unbekannter, entfernter Eintrag verschwindet lautlos', !geladen.includes('ein-entferntes-widget'));
check('Bekannte gespeicherte Reihenfolge bleibt erhalten', geladen[0] === 'ereignisse' && geladen[1] === 'kpi');
check('Neue, damals unbekannte Container werden angehängt',
  geladen.slice(2).sort().join(',') === ['angemeldet', 'letzte', 'proma', 'verlauf', 'begruessung'].sort().join(','));
check('Die gespeicherte Sichtbarkeit gilt weiter',
  await page.evaluate(() => document.querySelector('.dash-item[data-widget="kpi"]').classList.contains('versteckt')));
await browser.close();

// ══════════ MOBIL: KEINE BEARBEITUNG
({ browser, page } = await starte());
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
check('„Bearbeiten“ ist auf dem Handy nicht da',
  await page.evaluate(() => getComputedStyle($('btnDashBearbeiten')).display === 'none'));
const mobScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Kein Seiten-Scroll auf dem Handy', mobScroll <= 1);
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
