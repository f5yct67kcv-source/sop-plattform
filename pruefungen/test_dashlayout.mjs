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
// Die Standardreihenfolge steht EINMAL hier. Sie wird zusaetzlich gegen die
// Registrierung im Dashboard geprueft -- so muss ein neuer Container nur an
// einer Stelle nachgetragen werden, und die Pruefung sagt trotzdem noch
// etwas aus: Sie haelt fest, in welcher Reihenfolge die Uebersicht startet.
const STANDARD = ['begruessung', 'kpi', 'kurzwahl', 'verlauf', 'angemeldet', 'letzte', 'proma', 'ereignisse'];

const reihenfolge = page => page.evaluate(() =>
  [...document.querySelectorAll('.dash-item')].sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(e => e.dataset.widget));

let { browser, page } = await starte();

// ══════════ GRUNDZUSTAND
check('„Bearbeiten“ steht oben rechts', await page.isVisible('#btnDashBearbeiten'));
check('Die Bearbeitungsleiste ist zunächst verborgen', !(await page.isVisible('#dashEditleiste')));
check('Alle acht Container sind da',
  await page.evaluate(n => document.querySelectorAll('.dash-item').length === n, STANDARD.length));
check('KRITISCH: die Pruefung kennt dieselben Container wie das Dashboard',
  JSON.stringify(await page.evaluate(() => DASH_WIDGETS.map(w => w.id))) === JSON.stringify(STANDARD));
check('Standardreihenfolge stimmt',
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(STANDARD));
check('Kein Container ist ausgeblendet',
  await page.evaluate(() => document.querySelectorAll('.dash-item.versteckt').length === 0));
check('Der Bearbeiten-Knopf verschwindet auf anderen Ansichten',
  await page.evaluate(() => { go('mitarbeiter'); return getComputedStyle($('btnDashBearbeiten')).display === 'none'; }));
await page.evaluate(() => go('uebersicht'));
await page.waitForTimeout(150);

// ══════════ BREITEN: ZWEI CONTAINER NEBENEINANDER
//
// Vom Projektinhaber am 2026-08-23 verlangt: "halbseitgrosse, das zwei
// nebeneinander platz haben ... das erste widget, willkommen zurück würde
// nämlich eine halbe seite reichen. Das neue ereigniss widget, darf auch auf
// der vollen breite dargestellt werden."
//
// Gemessen am gerenderten Zustand, nicht im Quelltext nachgelesen: Eine
// CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht.
try {
  const m = await page.evaluate(() => {
    const r = id => document.querySelector(`[data-widget="${id}"]`).getBoundingClientRect();
    const flow = document.getElementById('dashFlow').getBoundingClientRect();
    return { flow: flow.width, begr: r('begruessung'), kpi: r('kpi'), erg: r('ereignisse'),
             wachsen: getComputedStyle(document.querySelector('[data-widget="begruessung"]')).flexGrow };
  });
  const halb = (m.flow - 16) / 2;
  check('KRITISCH: die Begrüssung nimmt die halbe Seite', Math.abs(m.begr.width - halb) < 1.5);
  check('KRITISCH: die Kennzahlen stehen DANEBEN, nicht darunter',
    Math.abs(m.begr.top - m.kpi.top) < 1 && m.kpi.left >= m.begr.right - 1);
  check('Und die beiden füllen die Zeile zusammen aus',
    Math.abs((m.begr.width + m.kpi.width + 16) - m.flow) < 1.5);
  check('KRITISCH: die Ereignisse bleiben auf voller Breite',
    Math.abs(m.erg.width - m.flow) < 1.5);
  // Ein halber Container, der allein in seiner Zeile steht, soll halb bleiben
  // -- "eine halbe Seite reicht" ist eine Aussage ueber den Inhalt, nicht
  // ueber die Nachbarn. Mit flex-grow 1 zoege er sich auf die volle Breite.
  check('KRITISCH: ein halber Container wächst nicht auf die volle Breite', m.wachsen === '0');

  // Vier Kennzahlen in halber Breite gehoeren zwei mal zwei, nicht drei plus
  // eine: Eine Kachel allein in der zweiten Zeile sieht aus wie ein Rest.
  const kpiZeilen = await page.evaluate(() => {
    const o = [...document.querySelectorAll('#kpiGrid > *')].map(e => Math.round(e.getBoundingClientRect().top));
    return { zeilen: new Set(o).size, kacheln: o.length };
  });
  check('KRITISCH: vier Kennzahlen stehen zwei mal zwei',
    kpiZeilen.kacheln !== 4 || kpiZeilen.zeilen === 2);
} catch (e) { bad.push('Breiten: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════ VOLLE BREITE
//
// Vom Projektinhaber am 2026-08-23: "im vollbild modus die gesamte breite
// ausnützen". Der Deckel von 1440 px schuetzt lange Textzeilen -- die
// Uebersicht traegt keine.
try {
  const m = await page.evaluate(() => {
    const c = document.querySelector('.content');
    return { weit: c.classList.contains('weit'), deckel: getComputedStyle(c).maxWidth,
             breite: Math.round(c.getBoundingClientRect().width),
             flow: Math.round(document.getElementById('dashFlow').getBoundingClientRect().width) };
  });
  check('KRITISCH: die Übersicht hat keinen Breitendeckel mehr', m.weit && m.deckel === 'none');
  check('KRITISCH: der Inhalt füllt die Fläche wirklich aus', m.flow > 900);
} catch (e) { bad.push('Breite: ' + String(e).split('\n')[0].slice(0, 120)); }

// ══════════ BEARBEITUNGSMODUS
await page.click('#btnDashBearbeiten');
await page.waitForTimeout(200);
check('„Bearbeiten“ verschwindet', !(await page.isVisible('#btnDashBearbeiten')));
check('Die drei Knöpfe erscheinen', await page.isVisible('#dashEditleiste'));
check('Zurücksetzen, Abbrechen, Speichern in dieser Reihenfolge',
  (await page.textContent('#dashEditleiste')).replace(/\s+/g, ' ').includes('Zurücksetzen Abbrechen Speichern'));
check('Jeder Container zeigt jetzt sein Werkzeug',
  await page.evaluate(n => document.querySelectorAll('.dash-werk').length === n &&
    [...document.querySelectorAll('.dash-werk')].every(w => getComputedStyle(w).display !== 'none'), STANDARD.length));
await page.screenshot({ path: OUT + '/71-bearbeiten.png' });

// ══════════ MIT PFEILEN VERSCHIEBEN
await page.click('.dash-item[data-widget="letzte"] .dash-werk button[title="Weiter vorne"]');
await page.waitForTimeout(150);
const umEinsNachVorne = (liste, id) => {
  const k = [...liste], i = k.indexOf(id);
  k.splice(i - 1, 0, k.splice(i, 1)[0]);
  return k;
};
check('„Letzte Rapporte“ ist einen Platz nach vorne gerückt',
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(umEinsNachVorne(STANDARD, 'letzte')));
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
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(STANDARD));
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
for (const w of STANDARD) {
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
  JSON.stringify(await reihenfolge(page)) === JSON.stringify(STANDARD));
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
  geladen.slice(2).sort().join(',') === STANDARD.filter(x => x !== 'ereignisse' && x !== 'kpi').sort().join(','));
check('Die gespeicherte Sichtbarkeit gilt weiter',
  await page.evaluate(() => document.querySelector('.dash-item[data-widget="kpi"]').classList.contains('versteckt')));
await browser.close();

// ══════════ MOBIL: KEINE BEARBEITUNG
({ browser, page } = await starte());
// Auf dem Desktop (Startgroesse von starte(), 1500px) stehen alle vier
// KPI-Kacheln und beide Auswertungswidgets -- erst der Wechsel auf mobil
// weiter unten veraendert etwas (ENT-166).
const kachelnDesktop = await page.$$eval('#kpiGrid .kpi', els => els.map(e => e.querySelector('.kpi-top span').textContent));
check('KRITISCH: auf dem Desktop stehen alle vier KPI-Kacheln, inklusive Mitarbeitende und Kunden',
  kachelnDesktop.join(',') === 'Rapporte,Nettostunden,Mitarbeitende,Kunden');
check('Stundenverlauf und Angemeldete Benutzer stehen auf dem Desktop',
  await page.isVisible('.dash-item[data-widget="verlauf"]') && await page.isVisible('.dash-item[data-widget="angemeldet"]'));

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
check('„Bearbeiten“ ist auf dem Handy nicht da',
  await page.evaluate(() => getComputedStyle($('btnDashBearbeiten')).display === 'none'));
const mobScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Kein Seiten-Scroll auf dem Handy', mobScroll <= 1);

// ── Mobil schlanker (ENT-166): Bestandszahlen und Buero-Auswertungen weg,
// Tagesgeschaeft bleibt. Existenz im DOM statt blossem isVisible() geprueft
// (dieselbe Faustregel wie in test_planung.mjs, ENT-165) -- sonst besteht
// die Pruefung auch, wenn das Element versehentlich ganz entfernt wird statt
// nur per CSS versteckt zu sein.
check('KRITISCH: "Stundenverlauf" existiert weiterhin im DOM, ist auf dem Handy aber unsichtbar',
  (await page.locator('.dash-item[data-widget="verlauf"]').count()) === 1 && !(await page.isVisible('.dash-item[data-widget="verlauf"]')));
check('KRITISCH: "Angemeldete Benutzer" existiert weiterhin im DOM, ist auf dem Handy aber unsichtbar',
  (await page.locator('.dash-item[data-widget="angemeldet"]').count()) === 1 && !(await page.isVisible('.dash-item[data-widget="angemeldet"]')));
const kachelnMobil = await page.$$eval('#kpiGrid .kpi',
  els => els.map(e => ({ label: e.querySelector('.kpi-top span').textContent, sichtbar: e.getClientRects().length > 0 })));
check('KRITISCH: "Rapporte" und "Nettostunden" bleiben auf dem Handy sichtbar -- Tagesgeschaeft',
  kachelnMobil[0].label === 'Rapporte' && kachelnMobil[0].sichtbar
    && kachelnMobil[1].label === 'Nettostunden' && kachelnMobil[1].sichtbar);
check('KRITISCH: "Mitarbeitende" und "Kunden" verschwinden auf dem Handy -- Bestand, kein Tagesgeschaeft',
  kachelnMobil[2].label === 'Mitarbeitende' && !kachelnMobil[2].sichtbar
    && kachelnMobil[3].label === 'Kunden' && !kachelnMobil[3].sichtbar);
check('Alle vier Kacheln bleiben trotzdem im DOM', kachelnMobil.length === 4);

await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
