// Drucken des Monatsplans (ENT-447).
//
// Der Projektinhaber will den Dienstplan ausdrucken koennen. Der heikle
// Teil ist nicht der Knopf, sondern eine Falle: A4 ist rund 794 px breit.
// Beim Drucken greift "@media (min-width: 1080px)" also NICHT -- alles,
// was nur dort steht, fehlt auf dem Papier. Beim ersten Versuch stand die
// Tabelle darum ohne Regelwerk auf dem Blatt und die Handy-Reiterleiste
// kam zurueck.
//
// Geprueft wird am gerenderten Zustand mit emulateMedia('print'), nicht am
// Quelltext: Ob eine Regel greift, sieht man nur am Ergebnis.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const browser = await chromium.launch({ executablePath: browserPfad() });
const jsFehler = [];

async function seite(breite, hoehe) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.on('pageerror', e => jsFehler.push(e.message));
  await page.route('**/api/**', r => {
    const u = new URL(r.request().url(), 'http://x');
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.pathname.includes('login'))       return s({ status: 'ok', token: 't', name: 'muster.person', rechte: [] });
    if (u.pathname.includes('me.php'))      return s({ status: 'ok', name: 'muster.person', rechte: [] });
    if (u.pathname.includes('mein_profil')) return s({ status: 'ok', profil:
      { name: 'muster.person', vorname: 'Eine', nachname: 'Person', revierdienst_berechtigt: 1 } });
    if (u.pathname.includes('meine_schichten')) {
      const von = u.searchParams.get('von'); const d = new Date();
      const ym = von ? von.slice(0, 7) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return s({ status: 'ok', schichten: [
        { id: 1, datum: `${ym}-05`, von: '06:00', bis: '14:00', titel: 'Einsatz Nord',
          ort: 'Ort A', treffpunkt: 'Haupteingang', status: 'bestaetigt', zusage: 'zugesagt' }] });
    }
    return s({ status: 'ok', schichten: [], rapporte: [], abwesenheiten: [], sperren: [],
      mitteilungen: [], eintraege: [], vorlagen: [], fahrzeuge: [], ereignisarten: [], saldo: {} });
  });
  await page.goto(`file://${WURZEL}/app.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'muster.person');
  await page.fill('#gPass', 'x');
  await page.click('#gBtn');
  await page.waitForSelector('#app.on', { timeout: 8000 });
  await page.evaluate(() => zeigeTisch('plan'));
  await page.waitForTimeout(600);
  return page;
}

const papier = page => page.evaluate(() => {
  const gross = s => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; };
  const t = document.querySelector('table.mt');
  const zelle = document.querySelector('table.mt tbody td');
  const we = document.querySelector('tr.mt-wochenende td');
  return {
    leisten: [...document.querySelectorAll('.tabs')].filter(n => n.getBoundingClientRect().height > 0).length,
    kopfzeile: gross('.kopf'),
    monatswechsel: gross('.mt-kopf'),
    druckknopf: gross('.mt-drucken'),
    papierkopf: (document.querySelector('.mt-papierkopf') || {}).textContent || '',
    papierkopfHoehe: gross('.mt-papierkopf'),
    tabelle: !!t,
    // GREIFT das Regelwerk der Tabelle? Ohne die Regeln haette eine Zelle
    // keinen Rahmen und keine eigene Polsterung -- genau das passiert,
    // wenn die Regeln in der Breitenabfrage stecken.
    zellePolster: zelle ? getComputedStyle(zelle).paddingTop : null,
    zelleRahmen: zelle ? getComputedStyle(zelle).borderBottomStyle : null,
    // Rahmen und Polsterung setzt der Druckblock SELBST -- daran laesst
    // sich nicht ablesen, ob die Grundregeln greifen (bei der Gegenprobe
    // genau so herausgekommen: gruen trotz eingebautem Fehler). Diese drei
    // stehen ausschliesslich in der Grundregel der Tabelle und sind darum
    // das richtige Mass.
    randVerschmolzen: t ? getComputedStyle(t).borderCollapse : null,
    tabelleBreit: t ? Math.round(t.getBoundingClientRect().width) : 0,
    nebenZeileEigen: document.querySelector('.mt-neben')
      ? getComputedStyle(document.querySelector('.mt-neben')).display : null,
    kopfWiederholt: t ? getComputedStyle(t.querySelector('thead')).display : null,
    zeileUmbruch: zelle ? getComputedStyle(zelle.parentElement).breakInside : null,
    wochenendFlaeche: we ? getComputedStyle(we).backgroundColor : null,
  };
});

// ══════════════ AUF PAPIER
try {
  const page = await seite(1680, 1000);
  const schirm = await papier(page);
  check('Am Bildschirm gibt es einen Druckknopf', !!schirm.druckknopf && schirm.druckknopf.h > 0);
  check('Und der Papierkopf ist am Bildschirm NICHT zu sehen',
    !schirm.papierkopfHoehe || schirm.papierkopfHoehe.h === 0);

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(200);
  const p = await papier(page);
  check('KRITISCH: auf dem Papier steht keine Reiterleiste', p.leisten === 0);
  check('KRITISCH: und keine Kopfzeile der Anwendung', !p.kopfzeile || p.kopfzeile.h === 0);
  check('KRITISCH: Monatswechsel und Druckknopf sind weg -- man kann Papier nicht klicken',
    (!p.monatswechsel || p.monatswechsel.h === 0) && (!p.druckknopf || p.druckknopf.h === 0));
  check('KRITISCH: die Tabelle ist da', p.tabelle);
  check('KRITISCH: das Regelwerk der Tabelle greift auch auf A4-Breite',
    p.randVerschmolzen === 'collapse' && p.tabelleBreit > 400);
  check('KRITISCH: der Tabellenkopf wiederholt sich auf jeder Seite',
    p.kopfWiederholt === 'table-header-group');
  check('Eine Zeile wird nicht mitten durchgeschnitten', p.zeileUmbruch === 'avoid');
  // Ein Blatt Papier mit Zahlen darauf, ohne Namen und Monat, ist wertlos.
  check('KRITISCH: auf dem Papier stehen Monat, Jahr und Name',
    /\d{4}/.test(p.papierkopf) && /Person/.test(p.papierkopf) &&
    p.papierkopfHoehe && p.papierkopfHoehe.h > 0);
  // Auf Papier traegt Farbe nicht -- die Wochenendflaeche wuerde nur den
  // Text schwaechen. Der Wochentag steht ohnehin im Datum.
  check('Die Wochenendflaeche faellt auf Papier weg',
    !p.wochenendFlaeche || /rgba\(0, 0, 0, 0\)|transparent/.test(p.wochenendFlaeche));
  await page.emulateMedia({ media: 'screen' });
  await page.close();
} catch (e) { check('Abschnitt Papier ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE FALLE SELBST: A4-BREITE
// Auch wenn das Fenster schmal ist wie ein Blatt, muss die Tabelle ihr
// Regelwerk haben. Genau hier ist es beim ersten Versuch gescheitert.
try {
  const page = await seite(1680, 1000);
  // Beim echten Drucken aendert sich das FENSTER nicht -- nur das Papier
  // ist schmal. Die Auszeichnung bleibt also die vom Schreibtisch, und
  // nur das Regelwerk wird auf Papierbreite ausgewertet. Ein blosses
  // setViewportSize wuerde stattdessen das Neuzeichnen ausloesen und die
  // Handy-Liste hinstellen -- damit waere etwas anderes geprueft als das,
  // was beim Drucken passiert. Das Neuzeichnen wird darum stillgelegt.
  await page.evaluate(() => { window.zeichnePlan = () => {}; });
  await page.setViewportSize({ width: 794, height: 1123 });   // A4 bei 96 dpi
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  const p = await papier(page);
  check('KRITISCH: auf A4-Breite steht die Tabelle noch und ist gestaltet',
    p.tabelle && p.randVerschmolzen === 'collapse' && p.tabelleBreit > 400
    && p.nebenZeileEigen === 'block');
  check('KRITISCH: und auch dort keine Reiterleiste', p.leisten === 0);
  await page.close();
} catch (e) { check('Abschnitt A4-Breite ohne Abbruch: ' + e.message, false); }

check('Keine Skriptfehler', jsFehler.length === 0);
jsFehler.forEach(f => bad.push('JS-Fehler: ' + f));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(b => console.log('  ✗ ' + b));
process.exit(bad.length ? 1 : 0);
