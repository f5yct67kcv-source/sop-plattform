// Neuerungen in der Mitarbeiter-App (ENT-698).
//
// Ein Blatt von unten, etwa zwei Drittel hoch, nur mit den Eintraegen fuer
// die App. Eingespielt wird hier nie. "Verstanden" merkt es sich am Konto,
// das Kreuz schliesst ohne. Andere Fenster (Mitteilung, offene Runde) haben
// Vorrang. Gemessen, nicht nachgelesen.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const browser = await chromium.launch({ executablePath: browserPfad() });

const NEU = [
  { nr: 5, datum: '2028-06-10', art: 'fehlerbehebung', titel: 'Eine Korrektur', text: 'Etwas geht jetzt wieder.' },
  { nr: 4, datum: '2028-06-10', art: 'neu', titel: 'Eine Neuerung', text: 'Etwas ist dazugekommen.' },
];

async function seite(stand) {
  const rufe = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const req = route.request();
    const u = new URL(req.url()), p = u.pathname.split('/api/')[1];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
    rufe.push({ p, suche: u.search, methode: req.method(), body });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
    if (p.includes('mein_profil')) return send({ status: 'ok', profil: { name: 'm.muster', vorname: 'Max',
      nachname: 'Muster', personalnummer: 'P-001', ist_admin: false } });
    if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    if (p === 'neuerungen_stand.php') {
      if (req.method() === 'POST') return send({ status: 'ok', gesehen_bis: body.bis });
      return send({ status: 'ok', ziel: 'app', neueste: 5, gesehen_bis: 3, neuerungen: stand.neu });
    }
    if (p.includes('meine_mitteilungen') && stand.mitteilung) {
      return send({ status: 'ok', mitteilungen: [{ id: 9, titel: 'Wichtig', text: 'Bitte lesen.',
        erstellt_am: '2026-01-10 08:00:00' }], unterbrechen: [9], offen: 1 });
    }
    return send({ status: 'ok' });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForTimeout(900);
  return { page, rufe };
}
const blattOffen = page => page.evaluate(() => $('blatt').classList.contains('on'));

// ── Es gibt Neuerungen fuer die App
let { page, rufe } = await seite({ neu: NEU });
check('Die App fragt nach den Neuerungen FUER DIE APP',
  rufe.some(r => r.p === 'neuerungen_stand.php' && r.methode === 'GET' && r.suche.includes('ziel=app')));
check('KRITISCH: gibt es Neuerungen, oeffnet sich das Blatt von selbst', await blattOffen(page));
check('Es heisst „Neu in GuardOpS“', (await page.textContent('#blTitel')).includes('Neu in GuardOpS'));
const inhalt = await page.textContent('#blBody');
check('Die Eintraege stehen darin, nach Art gruppiert',
  inhalt.includes('Eine Neuerung') && inhalt.includes('Eine Korrektur')
  && inhalt.indexOf('Neu') < inhalt.indexOf('Fehlerbehebungen'));
check('KRITISCH: in der App gibt es nichts einzuspielen', !(await page.textContent('#blatt')).includes('einspielen'));
await page.waitForTimeout(350);   // Einfahren abwarten
await page.screenshot({ path: `${OUT}/app-neuerungen.png` });
const m = await page.evaluate(() => {
  const r = $('blatt').getBoundingClientRect(), k = $('neuVerstanden').getBoundingClientRect();
  return { oben: r.top, unten: r.bottom, knopfH: k.height, knopfB: k.width,
           radius: getComputedStyle($('blatt')).borderTopLeftRadius };
});
check('KRITISCH: das Blatt ist kein Vollbild, sondern sitzt unten', m.oben > 150);
check('Es reicht bis an den unteren Rand', m.unten >= 844 - 1);
check('Oben abgerundet', m.radius === '18px');
check('Der Knopf ist mindestens 44 px hoch', m.knopfH >= 44);
check('Der Knopf ist nicht ueber die volle Breite gezogen', m.knopfB < 250);
const deckung = await page.evaluate(() => {
  const schild = [...document.querySelectorAll('body > div[role=status]')]
    .find(e => /TESTUMGEBUNG|DEMO/.test(e.textContent));
  if (!schild) { return null; }
  const a = schild.getBoundingClientRect(), b = $('neuVerstanden').getBoundingClientRect();
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
});
check('Das Umgebungsschild ist in der Pruefung wirklich da', deckung !== null);
check('KRITISCH: das Umgebungsschild verdeckt den Knopf nicht', deckung === false);

// Das Kreuz schliesst OHNE gelesen
let vorher = rufe.length;
await page.evaluate(() => blattZu());
await page.waitForTimeout(200);
check('Schliessen ohne „Verstanden“ merkt sich nichts',
  !rufe.slice(vorher).some(r => r.p === 'neuerungen_stand.php' && r.methode === 'POST'));
check('Nach dem Schliessen ist die kurze Variante wieder weg -- das naechste Blatt ist wieder Vollbild',
  !(await page.evaluate(() => $('blatt').classList.contains('kurz'))));
await page.close();

// ── „Verstanden“ merkt es sich
({ page, rufe } = await seite({ neu: NEU }));
vorher = rufe.length;
await page.click('#neuVerstanden');
await page.waitForTimeout(250);
check('KRITISCH: „Verstanden“ merkt sich die neueste Nummer am Konto',
  rufe.slice(vorher).some(r => r.p === 'neuerungen_stand.php' && r.methode === 'POST' && r.body.bis === 5));
check('und schliesst das Blatt', !(await blattOffen(page)));
await page.close();

// ── Keine Neuerungen: nichts
({ page, rufe } = await seite({ neu: [] }));
check('Ohne Neuerungen oeffnet sich nichts', !(await blattOffen(page)));
await page.close();

// ── Eine Mitteilung, die bestaetigt werden muss, hat Vorrang
({ page, rufe } = await seite({ neu: NEU, mitteilung: true }));
const mitOffen = await page.evaluate(() => $('mitDlg').classList.contains('on'));
check('Die Pruefung stellt die Mitteilung wirklich dar', mitOffen);
check('KRITISCH: steht eine Mitteilung offen, legt sich das Blatt nicht darueber',
  !mitOffen || !(await blattOffen(page)));
await page.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
