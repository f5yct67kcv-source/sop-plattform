// Administration > "Kundenzugänge" (ENT-441): die Verwaltungsseite des
// Kundenportals. Sie legt Zugänge für Betriebsfremde an und sperrt sie.
//
// Drei Dinge werden hier gemessen und nicht nachgelesen:
//   1. Der Menüpunkt hängt am Recht 'portal' -- ohne das Recht ist er weg.
//   2. Die drei leeren Zustände sagen drei VERSCHIEDENE Dinge. "Einrichtung
//      fehlt", "noch keiner angelegt" und "kein Treffer" sind nicht dasselbe
//      (Hausregel: „unbekannt darf nie wie keine aussehen").
//   3. Die eigene CSS-Klasse .kz-neben WIRKT tatsächlich -- gemessen an der
//      gerenderten Schriftgrösse. Genau daran scheitert .mut im Bestand:
//      16-mal benutzt, nirgends definiert.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const SEITE = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();
const ok = [], bad = [];
let gemessen = '';
const check = (n, c) => (c ? ok : bad).push(n);

async function klick(sel) {
  try { await page.click(sel, { timeout: 3000 }); return true; }
  catch (e) { bad.push('nicht anklickbar: ' + sel); return false; }
}

// Relative Daten statt fester Werte -- kippt sonst beim Datumswechsel
// (CLAUDE.md, test_datumsfest.mjs).
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const vorTagen = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const KUNDEN = { status: 'ok', kunden: [
  { id: 1, name: 'Muster Liegenschaften AG', aktiv: 1 },
  { id: 2, name: 'Beispiel Immobilien GmbH', aktiv: 1 },
  { id: 3, name: 'Testverwaltung stillgelegt', aktiv: 0 },
]};

// Zwei Zugänge, die zusammen die heiklen Fälle abdecken: einer war noch nie
// da (letzter_zugriff null), einer ist gesperrt und hängt an einem
// stillgelegten Kunden.
const ZUGAENGE = { status: 'ok', eingerichtet: true, zugaenge: [
  { id: 11, kunde_id: 1, kunde_name: 'Muster Liegenschaften AG', kunde_aktiv: true,
    name: 'A. Beispielperson', email: 'a.beispiel@example.invalid', funktion: 'Hauswart',
    aktiv: true, erstellt_am: `${vorTagen(30)} 09:00:00`, erstellt_von: 'Adrian Beispiel',
    gesperrt_am: null, letzter_zugriff: null, sitzungen: 0 },
  { id: 12, kunde_id: 3, kunde_name: 'Testverwaltung stillgelegt', kunde_aktiv: false,
    name: 'B. Musterperson', email: 'b.muster@example.invalid', funktion: '',
    aktiv: false, erstellt_am: `${vorTagen(60)} 09:00:00`, erstellt_von: 'Adrian Beispiel',
    gesperrt_am: `${vorTagen(5)} 14:00:00`, letzter_zugriff: `${vorTagen(20)} 08:00:00`, sitzungen: 0 },
]};

let calls = [];
let zugangAntwort = ZUGAENGE;
let rechte = ['einsaetze_lesen', 'kunden_lesen', 'betrieb_lesen', 'portal_lesen', 'portal_schreiben'];

function setup(page) {
  return page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.split('/api/')[1];
    calls.push({ path, rumpf: req.postData() });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path.includes('login')) {
      return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true,
        rollen: ['verwaltung'], rechte });
    }
    if (path.includes('dashboard_stats')) return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
    if (path.includes('kundenzugang_list')) return send(zugangAntwort);
    if (path.includes('kundenzugang_save')) return send({ status: 'ok', id: 99 });
    if (path.includes('kunden_list')) return send(KUNDEN);
    if (path.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [] });
    return send({ status: 'ok' });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await setup(page);
await page.goto(SEITE);
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');

// Administrations-Gruppe aufklappen
await page.evaluate(() => {
  if (!document.getElementById('navg-admin').classList.contains('offen')) {
    document.getElementById('nav-admin').click();
  }
});
await page.waitForTimeout(150);
check('Der Menüpunkt "Kundenzugänge" ist sichtbar', await page.isVisible('#nav-admin-portal'));

await klick('#nav-admin-portal');
try { await page.waitForSelector('#view-portal.on', { timeout: 3000 }); }
catch (e) { bad.push('Die Ansicht öffnet sich nicht'); }
check('Der Seitentitel lautet "Kundenzugänge"',
  await page.textContent('#pgTitle') === 'Kundenzugänge');
check('Der Menüpunkt ist als aktiv markiert',
  await page.evaluate(() => document.getElementById('nav-admin-portal').classList.contains('on')));
check('Die Liste wurde vom Server geholt', calls.some(c => c.path.includes('kundenzugang_list')));

// ── Die Zeilen ────────────────────────────────────────────────────────
const tabelle = () => page.textContent('#kzTable');
check('Beide Zugänge stehen in der Liste',
  (await tabelle()).includes('A. Beispielperson') && (await tabelle()).includes('B. Musterperson'));

// KRITISCH: "noch nie angemeldet" ist etwas anderes als ein Strich. Ein
// Zugang, den niemand je benutzt hat, darf nicht aussehen wie einer, dessen
// Datum nur gerade fehlt.
check('KRITISCH: "noch nie angemeldet" steht ausgeschrieben da, nicht als Strich',
  (await tabelle()).includes('noch nie angemeldet'));

check('Ein gesperrter Zugang ist als gesperrt erkennbar', (await tabelle()).includes('Gesperrt'));
check('Ein offener Zugang ist als offen erkennbar', (await tabelle()).includes('Offen'));
check('Ein stillgelegter Kunde wird am Zugang vermerkt',
  (await tabelle()).includes('Kunde stillgelegt'));

// ── GEMESSEN: wirkt die eigene CSS-Klasse ueberhaupt? ─────────────────
// Der Nebensatz muss KLEINER sein als der Normaltext daneben. Waere die
// Regel wirkungslos (wie .mut im Bestand), stuende hier unauffaellig
// normaler Text -- es saehe nicht kaputt aus, waere aber falsch.
const groessen = await page.evaluate(() => {
  const neben = document.querySelector('#view-portal .kz-neben');
  const zelle = neben && neben.closest('td');
  if (!neben || !zelle) { return null; }
  return {
    neben: parseFloat(getComputedStyle(neben).fontSize),
    zelle: parseFloat(getComputedStyle(zelle).fontSize),
  };
});
check('KRITISCH: die Nebentext-Regel greift wirklich (gemessen, nicht nachgelesen)',
  groessen !== null && groessen.neben < groessen.zelle);
if (groessen) { gemessen = `Nebentext ${groessen.neben}px gegen Zellentext ${groessen.zelle}px`; }

await page.screenshot({ path: `${OUT}/kz-01-liste.png` });

// ── Drei leere Zustaende, drei verschiedene Aussagen ──────────────────
// Kein Treffer der Suche -- und die Zahl bekommt einen Bezug, weil ein
// Filter greift.
await page.fill('#kzQ', 'gibtesnicht');
await page.waitForTimeout(120);
const textFilter = await tabelle();
check('KRITISCH: "kein Treffer" nennt, wie viele Zugänge es insgesamt gibt',
  textFilter.includes('Kein Treffer') && /2 Zugänge vorhanden/.test(textFilter));
await page.fill('#kzQ', '');
await page.waitForTimeout(120);

// Noch gar keiner angelegt
zugangAntwort = { status: 'ok', eingerichtet: true, zugaenge: [] };
await page.evaluate(() => kzLaden());
await page.waitForTimeout(200);
const textLeer = await tabelle();
check('KRITISCH: "noch keiner angelegt" ist eine eigene Aussage',
  textLeer.includes('Noch kein Kundenzugang angelegt'));

// Einrichtung ist gar nicht gelaufen
zugangAntwort = { status: 'ok', eingerichtet: false, zugaenge: [] };
await page.evaluate(() => kzLaden());
await page.waitForTimeout(200);
const textUneingerichtet = await tabelle();
check('KRITISCH: "Einrichtung fehlt" ist eine eigene Aussage und nennt den Weg',
  /Einrichtung ist noch nicht gelaufen/.test(textUneingerichtet)
  && /Einrichtung/.test(textUneingerichtet));
check('KRITISCH: die drei leeren Zustände sagen drei VERSCHIEDENE Dinge',
  textFilter !== textLeer && textLeer !== textUneingerichtet && textFilter !== textUneingerichtet);

// ── Der Dialog ────────────────────────────────────────────────────────
zugangAntwort = ZUGAENGE;
await page.evaluate(() => kzLaden());
await page.waitForTimeout(200);

await page.evaluate(() => kzNeu());
await page.waitForTimeout(150);
check('Beim Anlegen lässt sich der Kunde wählen',
  await page.evaluate(() => !document.getElementById('kz_kunde').disabled));
// Ein stillgelegter Kunde soll bei einer NEUANLAGE nicht zur Wahl stehen --
// ein neuer Zugang zu einem beendeten Auftrag ist fast immer ein Versehen.
check('Ein stillgelegter Kunde steht bei der Neuanlage nicht zur Wahl',
  await page.evaluate(() => ![...document.getElementById('kz_kunde').options]
    .some(o => o.textContent.includes('stillgelegt'))));
// Es gibt kein Passwort -- also darf auch kein Feld danach fragen.
check('KRITISCH: der Dialog fragt kein Passwort ab (es gibt keines)',
  await page.evaluate(() => !document.querySelector('#dlgKundenzugang input[type="password"]')));

await page.evaluate(() => closeDlg('dlgKundenzugang'));
await page.waitForTimeout(100);
await page.evaluate(() => kzBearbeiten(12));
await page.waitForTimeout(150);
// Der Kunde wird nicht umgehaengt: sonst zeigte der Zugang rueckwirkend
// fremde Objekte.
check('KRITISCH: beim Ändern lässt sich der Kunde NICHT umhängen',
  await page.evaluate(() => document.getElementById('kz_kunde').disabled));
check('Der stillgelegte Kunde bleibt bei einem bestehenden Zugang wählbar (sonst liesse er sich nicht speichern)',
  await page.evaluate(() => [...document.getElementById('kz_kunde').options]
    .some(o => o.textContent.includes('stillgelegt'))));
check('Das Sperrdatum wird im Dialog genannt',
  await page.evaluate(() => document.getElementById('kz_hinweis').textContent.includes('Gesperrt am')));

// Speichern schickt die Nummer mit, aber KEINE kunde_id -- der Server nimmt
// eine Umhaengung ohnehin nicht an.
calls = [];
await page.evaluate(() => kzSpeichern());
await page.waitForTimeout(250);
const save = calls.find(c => c.path.includes('kundenzugang_save'));
check('Das Speichern erreicht den Server', !!save);
if (save) {
  const rumpf = JSON.parse(save.rumpf || '{}');
  check('KRITISCH: beim Ändern wird keine kunde_id mitgeschickt', rumpf.kunde_id === undefined);
  check('Die Nummer des Zugangs wird mitgeschickt', rumpf.id === 12);
}

// ── Ohne das Recht 'portal' ist der Menüpunkt weg ─────────────────────
// Der Server entscheidet; das hier erspart nur den Umweg. Trotzdem darf
// jemand ohne das Recht den Punkt nicht sehen -- sonst klickt er auf eine
// Seite, die ihm nichts liefert.
rechte = ['einsaetze_lesen', 'kunden_lesen', 'betrieb_lesen'];
await page.evaluate(() => localStorage.clear());
await page.goto(SEITE);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#kpiGrid .kpi-val');
await page.evaluate(() => {
  if (!document.getElementById('navg-admin').classList.contains('offen')) {
    document.getElementById('nav-admin').click();
  }
});
await page.waitForTimeout(150);
check("KRITISCH: ohne ein Recht aus dem Bereich 'portal' ist der Menüpunkt nicht sichtbar",
  !(await page.isVisible('#nav-admin-portal')));

await browser.close();
if (gemessen) { console.log('  ' + gemessen); }
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
