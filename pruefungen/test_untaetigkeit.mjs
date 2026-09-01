// Automatische Abmeldung bei Untaetigkeit (ENT-293), am laufenden Zustand.
//
// Geprueft wird mit gestellter Uhr (page.clock), NICHT mit verkuerzten
// Konstanten: Ein Test, der die Frist auf drei Sekunden setzt, prueft eine
// Zahl, die es im Betrieb nicht gibt. Hier laeuft die echte 30-Minuten-
// Konstante ab -- nur schneller.
//
// Die SPERRE selbst liegt im Server und wird in pruef_sitzung.php geprueft.
// Diese Suite prueft das Drumherum: dass rechtzeitig gewarnt wird, dass
// Bedienung die Frist zurechnet, dass am Ende wirklich abgemeldet wird und
// dass an der Anmeldemaske steht, warum.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const URL = `file://${WURZEL}/dashboard.html`;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Jeder Fall in seinem eigenen Netz. Ohne das beendet der erste Fehler die
// ganze Suite mit einem Stapelauszug: Man sieht, DASS etwas kaputt ist,
// aber nicht welche Aussage nicht mehr gilt -- und die uebrigen Faelle
// laufen gar nicht erst. Beim Gegenprobieren ist genau das aufgefallen.
async function fall(name, fn) {
  try { await fn(); }
  catch (e) { bad.push(`${name}: abgebrochen -- ${String(e.message || e).split('\n')[0]}`); }
}

let calls = [];
// Rechte der angemeldeten Person -- pro Fall gesetzt, weil genau daran
// haengt, ob die kurze Frist ueberhaupt gilt.
let rechte = ['personal_lesen'];

async function seite(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', async route => {
    const path = route.request().url().split('/api/')[1].split('?')[0];
    calls.push(path);
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true, rechte });
    if (path.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [], rechte });
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
      pro_mitarbeiter: [], letzte_rapporte: [] });
    return send({ status: 'ok' });
  });
  // Die Uhr muss VOR dem Laden stehen, sonst laufen die Zeitgeber der Seite
  // schon auf der echten Uhr.
  await page.clock.install();
  await page.goto(URL);
  await page.fill('#gName', 'adrian');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#shell.on');
  return page;
}

const browser = await chromium.launch({ executablePath: browserPfad() });

// ══════════ Bueroarbeitsplatz: Warnung, Countdown, Abmeldung
await fall("Buero: Warnung und Abmeldung", async () =>{
  rechte = ['personal_lesen'];
  const page = await seite(browser);
  const sichtbar = () => page.evaluate(() => document.getElementById('utWarnung').classList.contains('on'));

  await page.clock.fastForward('20:00');
  check('Nach 20 Minuten Ruhe wird noch nicht gewarnt', !(await sichtbar()));

  await page.clock.fastForward('08:30');
  check('Nach 28:30 wird noch nicht gewarnt', !(await sichtbar()));

  await page.clock.fastForward('01:00');   // 29:30
  check('KRITISCH: kurz vor Ablauf steht die Warnung da', await sichtbar());
  const rest = Number(await page.textContent('#utRest'));
  check(`Der Countdown nennt eine Restzeit unter einer Minute (${rest} s)`, rest > 0 && rest <= 60);
  check('Die Warnung nennt die geltende Frist, nicht irgendeine Zahl',
    (await page.textContent('#utMin')) === '30');

  // Zaehlt der Countdown wirklich herunter?
  await page.clock.fastForward('00:10');
  const rest2 = Number(await page.textContent('#utRest'));
  check(`KRITISCH: der Countdown laeuft (${rest} s -> ${rest2} s)`, rest2 < rest);

  // Und danach: wirklich abgemeldet, nicht nur gewarnt.
  await page.clock.fastForward('01:00');
  await page.waitForSelector('#gate', { state: 'visible', timeout: 5000 }).catch(() => {});
  check('KRITISCH: nach Ablauf ist die Sitzung beendet',
    await page.evaluate(() => !!document.getElementById('gate')
      && getComputedStyle(document.getElementById('gate')).display !== 'none'));
  check('KRITISCH: der Zugangsschluessel ist aus dem Browser entfernt',
    await page.evaluate(() => !localStorage.getItem('rv3_token')));
  check('KRITISCH: der Server wurde abgemeldet, nicht nur der Browser',
    calls.some(p => p.includes('logout')));
  check('Die Anmeldemaske sagt, WARUM abgemeldet wurde -- sonst sieht es nach einem Fehler aus',
    await page.evaluate(() => {
      const e = document.getElementById('gateErr');
      return e && e.style.display !== 'none' && /ohne Bedienung|Minuten/.test(e.textContent);
    }));
  await page.close();
});

// ══════════ Der Dialog selbst: gemessen, nicht nachgelesen
await fall('Gestaltung der Warnung', async () => {
  rechte = ['personal_lesen'];
  const page = await seite(browser);
  await page.clock.fastForward('29:30');
  await page.waitForSelector('#utWarnung.on');

  const mass = async () => page.evaluate(() => {
    const dlg = document.querySelector('#utWarnung .dlg');
    const btn = document.querySelector('#utWarnung .dlg-ft .btn');
    const d = dlg.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { hoehe: b.height, breite: b.width, dlgBreite: d.width,
             imBild: d.top >= 0 && d.bottom <= innerHeight && d.left >= 0 && d.right <= innerWidth,
             scroll: document.documentElement.scrollWidth > innerWidth };
  });

  const desk = await mass();
  check('Die Warnung steht vollstaendig im Bild (1440 px)', desk.imBild);
  check('Kein Seiten-Scroll durch die Warnung (1440 px)', !desk.scroll);
  // CLAUDE.md: "Ein Knopf wird nicht ueber die volle Breite gestreckt, nur
  // weil er allein in seiner Zeile steht."
  check(`Der einzelne Knopf ist nicht ueber die ganze Breite gezogen (${Math.round(desk.breite)} von ${Math.round(desk.dlgBreite)} px)`,
    desk.breite < desk.dlgBreite * 0.8);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const handy = await mass();
  check(`KRITISCH: der Knopf ist auf dem Handy mindestens 44 px hoch (gemessen ${Math.round(handy.hoehe)} px)`,
    handy.hoehe >= 44);
  check('Die Warnung steht auch auf dem Handy vollstaendig im Bild', handy.imBild);
  check('Kein Seiten-Scroll durch die Warnung (390 px)', !handy.scroll);
  await page.close();
});

// ══════════ Bedienung setzt die Frist zurueck
await fall("Bedienung setzt zurueck", async () =>{
  rechte = ['personal_lesen'];
  const page = await seite(browser);
  await page.clock.fastForward('29:30');
  check('Warnung steht', await page.evaluate(() => document.getElementById('utWarnung').classList.contains('on')));
  await page.click('#utWarnung .btn-primary');
  await page.waitForTimeout(100);
  check('KRITISCH: "Angemeldet bleiben" schliesst die Warnung',
    await page.evaluate(() => !document.getElementById('utWarnung').classList.contains('on')));
  await page.clock.fastForward('25:00');
  // Eine abgemeldete Seite laedt neu; dann gibt es den Kontext nicht mehr.
  // Das IST die Aussage "nicht mehr angemeldet" -- hier als Ergebnis
  // gefangen, damit die Pruefung sie benennt, statt abzustuerzen.
  const nochDa = await page.evaluate(
    () => document.getElementById('shell').classList.contains('on')).catch(() => false);
  check('KRITISCH: die Frist beginnt danach von vorn -- 25 Minuten spaeter ist die Sitzung noch da',
    nochDa);
  await page.close();
});

// ══════════ Jede Bedienung zaehlt, nicht nur der Knopf
await fall("Tastendruck zaehlt", async () =>{
  rechte = ['personal_lesen'];
  const page = await seite(browser);
  await page.clock.fastForward('29:30');
  check('Warnung steht', await page.evaluate(() => document.getElementById('utWarnung').classList.contains('on')));
  await page.keyboard.press('a');
  await page.waitForTimeout(100);
  check('Ein Tastendruck irgendwo schliesst die Warnung ebenfalls',
    await page.evaluate(() => !document.getElementById('utWarnung').classList.contains('on')));
  await page.close();
});

// ══════════ Lebenszeichen, solange jemand tippt
await fall("Lebenszeichen beim Tippen", async () =>{
  rechte = ['personal_lesen'];
  const page = await seite(browser);
  calls = [];
  // Zwoelf Minuten arbeiten: alle zwei Minuten ein Tastendruck. Ohne
  // Lebenszeichen wuerde der Server diese Person fuer untaetig halten,
  // weil in der ganzen Zeit keine einzige Anfrage entsteht.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('b');
    await page.clock.fastForward('02:00');
  }
  await page.waitForTimeout(200);
  check('KRITISCH: wer tippt, ohne zu speichern, meldet sich trotzdem beim Server',
    calls.filter(p => p.includes('me.php')).length >= 2);
  check('Aber sparsam -- nicht bei jedem Tastendruck',
    calls.filter(p => p.includes('me.php')).length <= 4);
  await page.close();
});

// ══════════ Ohne Bedienung KEIN Lebenszeichen
await fall("Kein Lebenszeichen ohne Mensch", async () =>{
  rechte = ['personal_lesen'];
  const page = await seite(browser);
  calls = [];
  await page.clock.fastForward('25:00');
  await page.waitForTimeout(200);
  check('KRITISCH: eine unbenutzte Sitzung haelt sich NICHT selbst am Leben',
    calls.filter(p => p.includes('me.php')).length === 0);
  await page.close();
});

// ══════════ Waechter im Feld: die kurze Frist gilt nicht
await fall("Waechter im Feld", async () =>{
  rechte = ['rundgang_einsehen', 'rundgang_verwalten', 'alarmempfaenger'];
  const page = await seite(browser);
  await page.clock.fastForward('45:00');
  const feldDa = await page.evaluate(
    () => document.getElementById('shell').classList.contains('on')).catch(() => false);
  check('KRITISCH: ein Waechter mit reinen Feldrechten wird nicht nach 30 Minuten hinausgeworfen',
    feldDa);
  const feldGewarnt = await page.evaluate(
    () => document.getElementById('utWarnung').classList.contains('on')).catch(() => true);
  check('Und wird auch nicht gewarnt', !feldGewarnt);
  await page.close();
});

// ══════════ Waechter MIT Planungsrolle: die kurze Frist gilt doch
await fall("Waechter mit Buerorecht", async () =>{
  rechte = ['rundgang_einsehen', 'personal_lesen'];
  const page = await seite(browser);
  await page.clock.fastForward('29:30');
  check('KRITISCH: wer neben Feldrechten auch Personendaten sieht, faellt unter die kurze Frist',
    await page.evaluate(() => document.getElementById('utWarnung').classList.contains('on')));
  await page.close();
});

await browser.close();
console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
