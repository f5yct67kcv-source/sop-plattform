// Monatstabelle im Reiter "Plan" am Schreibtisch.
//
// Der Projektinhaber will den Dienstplan am grossen Bildschirm so sehen wie
// im heutigen System: eine Zeile pro TAG, auch fuer Tage ohne Schicht, mit
// Monatswechsel und Stundensumme. Am Handy bleibt es die Liste des
// Kommenden -- was am Schreibtisch entsteht, wird nicht automatisch auch
// fuers Handy gebaut (CLAUDE.md, so schon ENT-235).
//
// KEIN festes Datum in dieser Datei (test_datumsfest): Die Nachbildung
// antwortet auf den ANGEFRAGTEN Zeitraum und legt die Schichten auf den
// 5. und 10. des jeweils abgefragten Monats. Damit ist die Pruefung
// unabhaengig davon, welcher Monat gerade laeuft.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const PROFIL = { name: 'muster.person', vorname: 'Eine', nachname: 'Person',
  revierdienst_berechtigt: 1 };

const browser = await chromium.launch({ executablePath: EXE });
const jsFehler = [];
const gefragt = [];   // alle Zeitraeume, die die App angefordert hat

// art: 'normal' | 'leerermonat' | 'fehler'
async function seite(breite, hoehe, art = 'normal') {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  page.on('pageerror', e => jsFehler.push(e.message));
  await page.route('**/api/**', r => {
    const u = new URL(r.request().url(), 'http://x');
    const s = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.pathname.includes('login'))       return s({ status: 'ok', token: 't', name: 'muster.person', rechte: [] });
    if (u.pathname.includes('me.php'))      return s({ status: 'ok', name: 'muster.person', rechte: [] });
    if (u.pathname.includes('mein_profil')) return s({ status: 'ok', profil: PROFIL });
    if (u.pathname.includes('meine_schichten')) {
      const von = u.searchParams.get('von');
      if (von) gefragt.push({ von, bis: u.searchParams.get('bis') });
      if (art === 'fehler' && von) return r.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ status: 'fehler' }) });
      if (art === 'leerermonat' && von) return s({ status: 'ok', schichten: [] });
      // Ohne "von" fragt die App den Vorgabezeitraum ab -- das tut
      // ladeSchichten() beim Start, und daraus lebt die Handy-Liste.
      // Aus dem LAUFENDEN Monat berechnet, nicht fest eingetragen.
      const jetzt = new Date();
      const ym = von ? von.slice(0, 7)
        : `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}`;
      return s({ status: 'ok', schichten: [
        // Zwei Schichten am selben Tag -- die Tabelle muss beide zeigen.
        { id: 1, datum: `${ym}-05`, von: '06:00', bis: '14:00', titel: 'Einsatz Nord',
          ort: 'Ort A', treffpunkt: 'Haupteingang', status: 'bestaetigt', zusage: 'zugesagt' },
        { id: 2, datum: `${ym}-05`, von: '18:00', bis: '22:00', titel: 'Einsatz West',
          ort: 'Ort B', status: 'geplant', zusage: 'offen' },
        // Ueber Mitternacht: 22:00 bis 06:00 sind acht Stunden, nicht minus 16.
        { id: 3, datum: `${ym}-10`, von: '22:00', bis: '06:00', titel: 'Einsatz Sued',
          ort: 'Ort C', status: 'geplant', zusage: 'offen' },
      ] });
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
  await page.evaluate(() => zeige('plan'));
  await page.waitForTimeout(600);
  return page;
}

const tabelle = page => page.evaluate(() => {
  const t = document.querySelector('#plan-inhalt-plan table.mt');
  if (!t) return { da: false, text: document.getElementById('plan-inhalt-plan').innerText };
  const zeilen = [...t.querySelectorAll('tbody tr')];
  const kopf = document.querySelector('.mt-kopf b');
  return {
    da: true,
    titel: kopf ? kopf.textContent.trim() : '',
    zeilen: zeilen.length,
    ohne: zeilen.filter(z => z.classList.contains('mt-ohne')).length,
    mit: zeilen.filter(z => z.classList.contains('mt-zeile')).length,
    // Steht bei einem Tag ohne Schicht wirklich ein Satz, oder ist die
    // Zelle bloss leer? Eine leere Zelle sagt nichts.
    ohneText: (zeilen.find(z => z.classList.contains('mt-ohne')) || {}).innerText || '',
    spalten: [...t.querySelectorAll('thead th')].map(h => h.textContent.trim()),
    summe: (document.querySelector('.mt-summe') || {}).innerText || '',
    // Scrollt die TABELLE in ihrem Kasten statt die ganze Seite?
    rahmenScrollt: getComputedStyle(document.querySelector('.mt-rahmen')).overflowX,
    quer: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    breite: Math.round(t.getBoundingClientRect().width),
    fenster: window.innerWidth,
  };
});

const tageImMonat = ym => {
  const [j, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(j, m, 0)).getUTCDate();
};

// ══════════════ SCHREIBTISCH: die Tabelle
try {
  const page = await seite(1680, 1000);
  const t = await tabelle(page);
  check('KRITISCH: am Schreibtisch steht im Plan eine Tabelle', t.da);
  const ym = gefragt.length ? gefragt[gefragt.length - 1].von.slice(0, 7) : '';
  const tage = ym ? tageImMonat(ym) : 0;
  // Drei Schichten, davon zwei am selben Tag -> eine Zeile mehr als Tage.
  check('KRITISCH: jeder Tag des Monats hat eine Zeile, auch die ohne Schicht',
    t.zeilen === tage + 1);
  check('KRITISCH: Tage ohne Schicht sagen das ausdruecklich, statt leer zu bleiben',
    t.ohne === tage - 2 && /keine schicht/i.test(t.ohneText));
  check('Die drei Schichten stehen als eigene Zeilen da', t.mit === 3);
  check('Der Monatskopf nennt Monat und Jahr', /\d{4}/.test(t.titel) && t.titel.length > 5);
  check('KRITISCH: die Tabelle scrollt in ihrem Kasten, nicht die Seite',
    t.rahmenScrollt === 'auto' && t.quer);
  check('KRITISCH: die Tabelle nutzt die Breite, fuer die der Umbau gemacht wurde',
    t.breite > 1400);
  // Die Tabelle darf die Breite nehmen, die Unterreiter darueber nicht:
  // drei Knoepfe zu je 536 px sind keine Reiter mehr, sondern Banner.
  const ur = await page.evaluate(() =>
    [...document.querySelectorAll('.unterreiter button')].map(b => Math.round(b.getBoundingClientRect().width)));
  check('KRITISCH: die Unterreiter werden nicht ueber die ganze Breite gestreckt',
    ur.length === 3 && Math.max(...ur) <= 200);
  await page.screenshot({ path: `${OUT}/monatstabelle-01-schreibtisch.png` });
  await page.close();
} catch (e) { check('Abschnitt Tabelle ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE SUMME -- und was sie NICHT behauptet
try {
  const page = await seite(1680, 1000);
  const t = await tabelle(page);
  // 8 h + 4 h + 8 h (ueber Mitternacht) = 20:00
  check('KRITISCH: die Stundensumme rechnet die Schicht ueber Mitternacht richtig',
    /\b20 h\b/.test(t.summe));
  // Eine Dauer darf nicht aussehen wie eine Uhrzeit -- daneben steht in
  // derselben Zeile "06:00-14:00". Geprueft wird die Aussage (keine
  // Uhrzeit-Schreibweise in der Dauerspalte), nicht ein bestimmter Text.
  const dauern = await page.evaluate(() =>
    [...document.querySelectorAll('table.mt .mt-dauer')].map(z => z.textContent.trim()));
  check('KRITISCH: die Dauer steht nicht in Uhrzeit-Schreibweise',
    dauern.length === 3 && dauern.every(d => !/^\d{1,2}:\d{2}$/.test(d)) &&
    dauern.every(d => /h/.test(d)));
  check('KRITISCH: die Summe ist als PLANWERT bezeichnet, nicht als Lohn',
    /geplant/i.test(t.summe) && /keine lohngrundlage/i.test(t.summe));
  check('KRITISCH: kein Frankenbetrag in der Tabelle (GAV -- eigener Entscheid noetig)',
    !/CHF|Fr\./i.test(t.summe));
  await page.close();
} catch (e) { check('Abschnitt Summe ohne Abbruch: ' + e.message, false); }

// ══════════════ MONATSWECHSEL
try {
  const page = await seite(1680, 1000);
  const vorher = gefragt[gefragt.length - 1].von;
  await page.click('.mt-kopf > button:first-child');
  await page.waitForTimeout(500);
  const nachher = gefragt[gefragt.length - 1].von;
  check('KRITISCH: der Pfeil zurueck fordert tatsaechlich den Vormonat an',
    nachher < vorher && nachher.slice(8) === '01');
  const t = await tabelle(page);
  check('Und die Tabelle zeigt danach so viele Zeilen wie der neue Monat Tage hat',
    t.zeilen === tageImMonat(nachher.slice(0, 7)) + 1);
  // Der letzte angeforderte Tag muss der letzte Tag des Monats sein --
  // sonst fehlt am Monatsende stillschweigend eine Schicht.
  const bis = gefragt[gefragt.length - 1].bis;
  check('KRITISCH: der angeforderte Zeitraum endet am letzten Tag des Monats',
    Number(bis.slice(8)) === tageImMonat(bis.slice(0, 7)));
  await page.close();
} catch (e) { check('Abschnitt Monatswechsel ohne Abbruch: ' + e.message, false); }

// ══════════════ "UNBEKANNT" DARF NIE WIE "KEINE" AUSSEHEN
// Die wichtigste Regel auf der Liste in CLAUDE.md. Ein Serverfehler darf
// nicht als "in diesem Monat ist nichts geplant" erscheinen -- das waere
// eine Falschaussage, und zwar eine, nach der jemand seine Woche plant.
try {
  const page = await seite(1680, 1000, 'fehler');
  const t = await tabelle(page);
  const txt = t.da ? t.summe : t.text;
  check('KRITISCH: bei einem Serverfehler erscheint KEINE Monatstabelle', !t.da);
  check('KRITISCH: der Fehlertext sagt, dass es UNBEKANNT ist -- nicht "keine"',
    /nicht geladen/i.test(txt) && /unbekannt/i.test(txt));
  check('KRITISCH: und er sagt NICHT "keine Schicht geplant"',
    !/keine schicht geplant/i.test(txt));
  check('Es gibt einen Weg, es nochmal zu versuchen', /nochmal/i.test(txt));
  await page.screenshot({ path: `${OUT}/monatstabelle-02-fehler.png` });
  await page.close();
} catch (e) { check('Abschnitt Fehlerzustand ohne Abbruch: ' + e.message, false); }

// Ein wirklich leerer Monat sieht anders aus als ein Fehler.
try {
  const page = await seite(1680, 1000, 'leerermonat');
  const t = await tabelle(page);
  check('KRITISCH: ein wirklich freier Monat zeigt die Tabelle mit lauter freien Tagen',
    t.da && t.mit === 0 && t.ohne === t.zeilen && t.zeilen > 27);
  check('KRITISCH: und seine Summe steht auf null Stunden, ohne Fehlermeldung',
    /\b0 h\b/.test(t.summe) && !/nicht geladen/i.test(t.summe));
  await page.close();
} catch (e) { check('Abschnitt leerer Monat ohne Abbruch: ' + e.message, false); }

// ══════════════ DAS HANDY BLEIBT, WIE ES WAR
try {
  const page = await seite(390, 844);
  const t = await tabelle(page);
  check('KRITISCH: am Handy gibt es KEINE Monatstabelle', !t.da);
  check('KRITISCH: am Handy stehen weiterhin die Schichtkarten',
    await page.evaluate(() => !!document.querySelector('#plan-inhalt-plan .karte .schicht')));
  await page.screenshot({ path: `${OUT}/monatstabelle-03-handy.png` });
  await page.close();
} catch (e) { check('Abschnitt Handy ohne Abbruch: ' + e.message, false); }

// ══════════════ REGELWERK UND SKRIPT MUESSEN GEMEINSAM KIPPEN
// Die Grenze steht nur an EINER Stelle: in der Media Query, die den
// Schalter --schreibtisch-an umlegt. Das Skript liest diesen Schalter,
// statt die Zahl 1080 ein zweites Mal zu fuehren.
//
// Geprueft wird darum bewusst NICHT "bei 1080 passiert X" -- das waere
// die Zahl abgeschrieben. Geprueft wird die Aussage: Schalter, Regelwerk
// und tatsaechlich gezeichneter Inhalt sagen an JEDER Breite dasselbe.
// Verschiebt jemand die Grenze, bleibt das zu Recht gruen; laufen die
// drei auseinander, wird es rot.
try {
  const uneins = [];
  for (const b of [390, 1000, 1079, 1080, 1600]) {
    const page = await seite(b, 900);
    const d = await page.evaluate(() => ({
      schalter: getComputedStyle(document.documentElement)
        .getPropertyValue('--schreibtisch-an').trim() === '1',
      regelwerk: getComputedStyle(document.querySelector('.tabs')).position === 'static',
      tabelle: !!document.querySelector('#plan-inhalt-plan table.mt'),
    }));
    if (!(d.schalter === d.regelwerk && d.regelwerk === d.tabelle))
      uneins.push(`${b} px: ${JSON.stringify(d)}`);
    await page.close();
  }
  check('KRITISCH: Schalter, Regelwerk und Inhalt sagen an jeder Breite dasselbe',
    uneins.length === 0);
  uneins.forEach(u => bad.push('uneins bei ' + u));
} catch (e) { check('Abschnitt Grenze ohne Abbruch: ' + e.message, false); }

check('Keine Skriptfehler', jsFehler.length === 0);
jsFehler.forEach(f => bad.push('JS-Fehler: ' + f));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(b => console.log('  ✗ ' + b));
process.exit(bad.length ? 1 : 0);
