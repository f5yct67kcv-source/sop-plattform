// Prueft die Wege zwischen den drei Seiten -- genau der Punkt, an dem der
// Mitarbeiter-Login gestrandet ist.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const b = await chromium.launch({ executablePath: EXE });

const mock = (page, admin) => page.route('**/api/**', r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: admin ? 'adrianvonarb' : 'dario.beispiel', ist_admin: admin });
  if (u.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
  if (u.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: { name: 'dario.beispiel', ist_admin: admin } });
  if (u.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok', mitarbeiter: [], kunden: [], einsaetze: [], objekte: [],
    kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
});

// ── Mitarbeiter landet auf dem Dashboard
const p1 = await b.newPage({ viewport: { width: 390, height: 844 } });
await mock(p1, false);
await p1.goto(`file://${WURZEL}/dashboard.html`);
await p1.fill('#gName', 'dario.beispiel'); await p1.fill('#gPass', 'x'); await p1.click('#gBtn');
await p1.waitForTimeout(900);
check('Mitarbeiter wird vom Dashboard in die App geleitet', p1.url().endsWith('/app.html'));
check('Mitarbeiter muss sich nicht neu anmelden', await p1.isVisible('#v-heute'));
check('Kein Cockpit-Verweis fuer Mitarbeitende',
  await p1.evaluate(() => { zeige('menu'); return !document.querySelector('#v-menu a[href="dashboard.html"]'); }));
await p1.close();

// ── Admin kommt weiterhin ins Dashboard
const p2 = await b.newPage({ viewport: { width: 1280, height: 800 } });
await mock(p2, true);
await p2.goto(`file://${WURZEL}/dashboard.html`);
await p2.fill('#gName', 'adrianvonarb'); await p2.fill('#gPass', 'x'); await p2.click('#gBtn');
await p2.waitForTimeout(700);
check('Admin bleibt im Dashboard', p2.url().endsWith('/dashboard.html'));
check('Admin sieht die Verwaltung', await p2.isVisible('#shell.on'));
await p2.close();

// ── Weg von der Erfassung in die App
const p3 = await b.newPage({ viewport: { width: 390, height: 844 } });
await mock(p3, false);
await p3.goto(`file://${WURZEL}/index.html`);
await p3.waitForTimeout(500);
const link = await p3.getAttribute('#btn-zurueck', 'href');
check('Erfassung verweist auf die App', link === 'app.html');
check('Der Zurück-Knopf ist sichtbar', await p3.isVisible('#btn-zurueck'));
const scroll = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Der Zurück-Knopf schiebt die Kopfzeile nicht', scroll <= 1);
check('Kein Sprachumschalter mehr in der Erfassung',
  await p3.evaluate(() => document.querySelectorAll('.lang-btn').length === 0));
// Die Erfassung selbst muss unveraendert funktionieren
check('Erfassungsformular ist unveraendert da', await p3.isVisible('#tab-erfassen'));
await p3.close();

// ── Weg von der App zurueck in die Erfassung
const p4 = await b.newPage({ viewport: { width: 390, height: 844 } });
await mock(p4, false);
await p4.goto(`file://${WURZEL}/app.html`);
await p4.fill('#gName', 'dario.beispiel'); await p4.fill('#gPass', 'x'); await p4.click('#gBtn');
await p4.waitForSelector('#app.on'); await p4.waitForTimeout(400);
await p4.click('#t-rapport'); await p4.waitForTimeout(250);
check('App verweist zurueck auf die Erfassung',
  (await p4.getAttribute('#v-rapport a', 'href')) === 'index.html');
await p4.close();

// ── Der Rueckweg aus dem Cockpit (ENT-050)
// Bis hierher war der Weg eine Einbahnstrasse: Die App fuehrte ins Cockpit,
// das Cockpit fuehrte nirgendwohin zurueck. Der Administrator sass auf dem
// Handy fest. Diese Pruefungen sind der Regressionsschutz dagegen.
const p5 = await b.newPage({ viewport: { width: 390, height: 844 } });
p5.setDefaultTimeout(4000);
await mock(p5, true);
await p5.goto(`file://${WURZEL}/dashboard.html`);
await p5.fill('#gName', 'adrianvonarb'); await p5.fill('#gPass', 'x'); await p5.click('#gBtn');
await p5.waitForSelector('#shell.on'); await p5.waitForTimeout(500);

const daKnopf = await p5.evaluate(() => !!document.getElementById('nav-zurapp'));
check('Das Cockpit hat einen Wechsel-Knopf', daKnopf);
if (!daKnopf) { bad.push('Ohne Wechsel-Knopf sind die folgenden Pruefungen hinfaellig'); }
else {
check('Das Cockpit hat einen Wechsel-Knopf (erneut)', await p5.evaluate(() => !!document.getElementById('nav-zurapp')));
check('Der Wechsel-Knopf zeigt auf die App',
  (await p5.getAttribute('#nav-zurapp', 'href')) === 'app.html');
check('Der Wechsel-Knopf steht im Fuss der Seitenleiste, nicht in der Kopfzeile',
  await p5.evaluate(() => !!document.querySelector('.side-foot #nav-zurapp')));
check('Der Wechsel-Knopf steht beim Benutzerblock, oberhalb von Abmelden',
  await p5.evaluate(() => {
    const f = [...document.querySelectorAll('.side-foot > *')];
    const iUser = f.findIndex(e => e.classList.contains('side-user'));
    const iApp  = f.findIndex(e => e.id === 'nav-zurapp');
    const iAus  = f.findIndex(e => e.textContent.trim() === 'Abmelden');
    return iUser >= 0 && iApp === iUser + 1 && iAus === iApp + 1;
  }));

// Auf dem Handy ist die Seitenleiste eine Schublade. Der Knopf muss sofort
// sichtbar sein, sobald sie aufgeht -- ohne Scrollen. Genau das war die
// Sorge bei dieser Platzierung.
// Seit ENT-059 klappt die Leiste als Menue unter der Kopfzeile auf, statt
// von links hereinzufahren -- "zu" heisst darum unsichtbar, nicht "links
// ausserhalb des Bildes".
check('Auf dem Handy ist der Knopf zunaechst verborgen (Menue zu)',
  await p5.evaluate(() => getComputedStyle(document.getElementById('side')).visibility === 'hidden'));
await p5.click('.btn-burger'); await p5.waitForTimeout(400);
check('Nach dem Burger-Symbol ist der Knopf sichtbar', await p5.isVisible('#nav-zurapp'));
check('Der Knopf liegt vollstaendig im Bild, ohne Scrollen',
  await p5.evaluate(() => {
    const r = document.getElementById('nav-zurapp').getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  }));
check('Der Knopf ist gross genug zum Antippen',
  await p5.evaluate(() => document.getElementById('nav-zurapp').getBoundingClientRect().height >= 34));

// Der Wechsel selbst: eine Seite weiter, ohne neue Anmeldung.
await p5.click('#nav-zurapp');
await p5.waitForTimeout(900);
check('Der Wechsel fuehrt in die App', p5.url().endsWith('/app.html'));
check('Nach dem Wechsel keine neue Anmeldung noetig', await p5.isVisible('#app.on'));
await p5.evaluate(() => zeige('menu'));
await p5.waitForTimeout(300);
check('Und von dort geht es wieder zurueck ins Cockpit',
  await p5.evaluate(() => !!document.querySelector('#v-menu a[href="dashboard.html"]')));
}
await p5.close();

// ── Eingeklappte Seitenleiste: der Knopf bleibt, nur die Beschriftung geht
const p6 = await b.newPage({ viewport: { width: 1280, height: 800 } });
p6.setDefaultTimeout(4000);
await mock(p6, true);
await p6.goto(`file://${WURZEL}/dashboard.html`);
await p6.fill('#gName', 'adrianvonarb'); await p6.fill('#gPass', 'x'); await p6.click('#gBtn');
await p6.waitForSelector('#shell.on'); await p6.waitForTimeout(500);
const daKnopf6 = await p6.evaluate(() => !!document.getElementById('nav-zurapp'));
if (!daKnopf6) { bad.push('Wechsel-Knopf fehlt auch auf dem Desktop'); }
else {
check('Breite Seitenleiste: Beschriftung sichtbar',
  (await p6.textContent('#nav-zurapp')).includes('Zur App'));
await p6.click('#btnSchmal'); await p6.waitForTimeout(350);
check('Schmale Seitenleiste: Knopf bleibt sichtbar', await p6.isVisible('#nav-zurapp'));
check('Schmale Seitenleiste: Beschriftung ist ausgeblendet, das Symbol bleibt',
  await p6.evaluate(() => {
    const l = document.querySelector('#nav-zurapp .lbl');
    const s = document.querySelector('#nav-zurapp svg');
    return getComputedStyle(l).display === 'none' && !!s.getClientRects().length;
  }));
check('Der Knopf sieht nicht wie ein blauer Rohlink aus',
  await p6.evaluate(() => getComputedStyle(document.getElementById('nav-zurapp')).textDecorationLine === 'none'));
}
await p6.close();

await b.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
