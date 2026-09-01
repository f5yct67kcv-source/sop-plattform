// Eigene Stunden in der Mitarbeiter-App (ENT-049).
// Kernpunkt: dieselbe Schicht muss in App und Verwaltung dieselbe Zahl
// ergeben -- darum liegen die GAV-Regeln in gav.js und nicht zweimal.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════════ VERTRAG: EINE QUELLE FUER BEIDE OBERFLAECHEN
const DASH = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const WF = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
check('Beide Oberflaechen laden dieselbe Regeldatei',
  DASH.includes('<script src="gav.js">') && APP.includes('<script src="gav.js">'));
check('KRITISCH: gav.js wird deployt -- sonst rechnen beide ins Leere (Falle aus ENT-040)',
  /cp gav\.js dist\/gav\.js/.test(WF));
check('KRITISCH: die Bonusregel steht NICHT zusaetzlich in einer der Oberflaechen',
  !DASH.includes('function gavBonusMin') && !APP.includes('function gavBonusMin'));
check('KRITISCH: auch die Nettoregel steht nur einmal',
  !DASH.includes('function gavNetto') && !APP.includes('function gavNetto'));

const M = '2026-03';
const SO = '2026-03-01', MO = '2026-03-02';   // Sonntag / Montag, nachgerechnet

const S = (id, datum, von, bis, ist) => ({
  id, kunde_name: 'Beispiel AG', titel: 'Revierdienst', strasse: '', ort: '4601 Olten',
  einsatzart: 'Revierdienst', datum, von, bis, status: 'geplant', bemerkung: null,
  zusage: 'zugesagt', objekt_name: 'Muster', im_team: 1, ...ist,
});
const SCHICHTEN = [
  // Sonntag 08:00-12:00 -> 4 h, Bonus 24 Min
  S(1, SO, '08:00:00', '12:00:00', { ist_status: 'anwesend', ist_von: '08:00:00', ist_bis: '12:00:00',
    ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null }),
  // Montag 05:15-05:30 -> 15 Min, Bonus 1.5 Min
  S(2, MO, '05:15:00', '05:30:00', { ist_status: 'anwesend', ist_von: '05:15:00', ist_bis: '05:30:00',
    ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null }),
  // Montag 08:00-18:00 mit 60 Min BEZAHLTER Pause -> Netto 10 h, kein Bonus
  S(3, MO, '08:00:00', '18:00:00', { ist_status: 'anwesend', ist_von: '08:00:00', ist_bis: '18:00:00',
    ist_pause_von: '12:00:00', ist_pause_min: 60, ist_pause_bezahlt_ma: 1 }),
  // NICHT abgeglichen -> darf nicht mitzaehlen
  S(4, MO, '14:00:00', '16:00:00', { ist_status: 'offen', ist_von: null, ist_bis: null,
    ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null }),
  // Sonntag 13:00-17:00, SPARTE REINIGUNG: 4 h Arbeitszeit, aber KEIN Bonus
  // (ENT-061), obwohl die Schicht voll im Sonntagsfenster liegt.
  { ...S(5, SO, '13:00:00', '17:00:00', { ist_status: 'anwesend', ist_von: '13:00:00',
      ist_bis: '17:00:00', ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null }),
    kunde_name: 'Muster Reinigung AG', titel: 'Unterhaltsreinigung',
    einsatzart: 'Reinigung', sparte: 'reinigung' },
];

let rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// Fehlt ein Element, soll die Reihe das in Sekunden melden statt 30 s zu warten.
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const url = route.request().url();
  const p = url.split('/api/')[1].split('?')[0];
  rufe.push({ p, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'd', ist_admin: false });
  if (p.includes('mein_profil')) return send({ status: 'ok', profil: {
    name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel', personalnummer: '2506',
    strasse: 'Weg 1', ort: '4600 Olten', telefon: '', mobil: '', email: 'd@example.ch', ist_admin: false } });
  if (p.includes('meine_schichten')) {
    // Wie der Server: auf den angefragten Zeitraum filtern.
    const von = (url.match(/von=([\d-]+)/) || [])[1] || '0000-00-00';
    const bis = (url.match(/bis=([\d-]+)/) || [])[1] || '9999-99-99';
    return send({ status: 'ok', schichten: SCHICHTEN.filter(x => x.datum >= von && x.datum <= bis) });
  }
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok', schichten: [], rapporte: [], sperren: [] });
});
await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'd'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForTimeout(600);

// ══════════════ REGELN SIND IN DER APP VERFUEGBAR
check('gav.js ist in der App geladen',
  await page.evaluate(() => typeof gavBonusMin === 'function' && typeof gavNetto === 'function'));
check('KRITISCH: dieselbe Rechnung wie in der Verwaltung -- 15 Min. Nacht = 1.5 Min. Bonus',
  await page.evaluate(m => gavBonusMin(m, '05:15', '05:30') === 1.5, MO));
check('KRITISCH: bezahlte Pause bleibt auch hier in der Nettozeit',
  await page.evaluate(() => gavNetto('08:00', '18:00', 60, 1) === '10:00'));

// ══════════════ MENÜ (ENT-234, vormals PROFIL)
await page.click('#t-menu');
await page.waitForTimeout(600);
// Seit ENT-234 stehen zwei Kacheln nebeneinander (Meine Daten/Meine Stunden),
// beide Unterseiten liegen dahinter -- weiterhin bewusst OHNE Zahl auf der
// Kachel selbst (ENT-051-Grundsatz unveraendert).
check('Das Menü zeigt die Personalnummer nicht direkt, erst hinter der Kachel',
  await page.evaluate(() => !document.getElementById('pr-haupt').textContent.includes('Personalnummer')));
check('Die Stunden liegen zunaechst nicht offen im Menü',
  await page.evaluate(() => getComputedStyle(document.getElementById('pr-stunden')).display === 'none'));
check('Die Personalien liegen zunaechst nicht offen im Menü',
  await page.evaluate(() => getComputedStyle(document.getElementById('pr-daten')).display === 'none'));
check('Es gibt eine Kachel, die zu den Stunden fuehrt', await page.isVisible('#mk-stunden'));
check('KRITISCH: keine Stundenzahl auf der Kachel ohne den Abrechnungs-Hinweis',
  await page.evaluate(() => !/\d+:\d\d|\d+[.,]\d+\s*h/.test(
    document.getElementById('mk-stunden').textContent)));
await page.click('#mk-stunden');
await page.waitForTimeout(600);
check('Der Bereich "Meine Stunden" steht auf der Unterseite', await page.isVisible('#stdBereich'));
check('Die Kacheln treten dabei zurueck', !(await page.isVisible('#pr-haupt')));
check('Ueberschrift vorhanden', (await page.textContent('#v-menu')).includes('Meine Stunden'));
await page.evaluate(m => { stdMonat = m; stdSchichten = null; zeichneStunden(); }, M);
await page.waitForTimeout(500);

// ══════════════ ZAHLEN
const zahlen = await page.textContent('#stdZahlen');
// Netto: 4:00 + 0:15 + 10:00 = 14:15
check('KRITISCH: geleistete Zeit stimmt und rechnet die bezahlte Pause nicht heraus',
  zahlen.includes('18:15'));
// Bonus: 24 + 1.5 = 25.5 -> 0:26 (gerundet) oder 0:25
check('KRITISCH: Zeitbonus wird SEPARAT ausgewiesen', zahlen.includes('0:26') || zahlen.includes('0:25'));
check('Drei getrennte Zahlen, nicht eine', (await page.$$('#stdZahlen .zahl')).length === 3);
check('Das Total steht als eigene Zahl daneben', zahlen.includes('18:41') || zahlen.includes('18:40'));

// ══════════════ LISTE
const liste = await page.textContent('#stdListe');
check('Vier abgeglichene Schichten in der Liste', (await page.$$('#stdListe > div > div')).length === 4);
check('KRITISCH: nicht abgeglichene Schichten fehlen', !liste.includes('14:00'));
check('Chronologisch: der Sonntag zuoberst',
  (await page.textContent('#stdListe > div > div:first-child')).includes('01.03.2026'));
check('Bezahlte Pause ist als solche gekennzeichnet', liste.includes('bezahlte Pause'));
check('Die Reinigungsschicht ist in der Liste als solche gekennzeichnet',
  liste.includes('Reinigung'));

// ── Getrennte Summen (ENT-063)
const spTxt = await page.evaluate(() => {
  const e = document.getElementById('stdSparten');
  return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
});
if (!spTxt) { bad.push('Die Aufteilung nach Sparte fehlt in "Meine Stunden"'); }
else {
  check('KRITISCH: Sicherheit und Reinigung stehen getrennt',
    /Sicherheit \(GAV\)/.test(spTxt) && /Reinigung/.test(spTxt));
  check('Die Sicherheitsstunden sind richtig ausgewiesen (14:15)', /14:15/.test(spTxt));
  check('Die Reinigungsstunden sind richtig ausgewiesen (4:00)', /4:00/.test(spTxt));
  check('Es steht da, dass der GAV nur auf den Sicherheitsstunden rechnet',
    /nur auf den Sicherheitsstunden/.test(spTxt));
}
check('KRITISCH: die Reinigungsschicht am Sonntag erzeugt keinen Zeitbonus (ENT-061)',
  !zahlen.includes('0:50') && !zahlen.includes('0:49'));

// ══════════════ WAS FEHLT, WIRD BENANNT (ENT-053)
// Der Filter wirft nicht abgeglichene Schichten weg. Frueher stillschweigend --
// die Person sah eine zu tiefe Zahl ohne jeden Anhaltspunkt, woran das liegt.
const daOffen = await page.evaluate(() => !!document.getElementById('stdOffen'));
check('KRITISCH: die nicht abgeglichenen Schichten werden benannt, nicht verschwiegen', daOffen);
if (!daOffen) { bad.push('Ohne den Hinweis sind die folgenden Pruefungen hinfaellig'); }
else {
const offenTxt = await page.textContent('#stdOffen');
check('Der Hinweis sagt, dass sie nicht enthalten sind', /nicht enthalten/.test(offenTxt));
check('Der Hinweis nennt den Grund: noch nicht abgeglichen', /nicht abgeglichen/.test(offenTxt));
check('Bei genau einer offenen Schicht steht Einzahl, keine "1 Schichten"',
  /^Eine Schicht/.test(offenTxt.trim()) && !/^1 /.test(offenTxt.trim()));
check('Der Hinweis steht ueber der Schichtliste, nicht darunter',
  await page.evaluate(() => {
    const o = document.getElementById('stdOffen'), l = document.getElementById('stdListe');
    return o.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING;
  }));
check('Der Hinweis ist ruhig gehalten, keine Warnfarbe',
  await page.evaluate(() => {
    const f = getComputedStyle(document.getElementById('stdOffen')).color;
    const w = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim();
    return !w || !f.includes(w);
  }));

// Mehrzahl: derselbe Monat mit zwei offenen Schichten
await page.evaluate(() => {
  stdSchichten = stdSchichten.concat([{
    id: 99, datum: stdSchichten[0].datum, titel: 'Zusatz', kunde_name: 'X',
    von: '20:00:00', bis: '22:00:00', ist_status: 'offen',
  }]);
  zeichneStunden();
});
await page.waitForTimeout(300);
const offen2 = await page.textContent('#stdOffen');
check('Bei mehreren offenen Schichten steht die Anzahl', /^2 Schichten/.test(offen2.trim()));

// Ist alles abgeglichen, verschwindet der Hinweis restlos.
await page.evaluate(() => {
  stdSchichten = stdSchichten.filter(e => (e.ist_status || 'offen') !== 'offen');
  zeichneStunden();
});
await page.waitForTimeout(300);
check('Ist nichts mehr offen, steht der Hinweis auch nicht da',
  await page.evaluate(() => !document.getElementById('stdOffen')));

// Der wichtigste Fall: gar nichts abgeglichen, aber Schichten vorhanden. Ohne
// den Hinweis liest sich "Nichts abgeglichen" wie "nicht gearbeitet".
await page.evaluate(m => { stdMonat = m; stdSchichten = null; zeichneStunden(); }, M);
await page.waitForTimeout(500);
await page.evaluate(() => {
  stdSchichten = stdSchichten.map(e => ({ ...e, ist_status: 'offen' }));
  zeichneStunden();
});
await page.waitForTimeout(300);
check('Auch im Leerzustand wird gesagt, wie viele Schichten offen sind',
  await page.evaluate(() => !!document.getElementById('stdOffen')));
check('Der Leerzustand erklaert sich weiterhin',
  (await page.textContent('#stdBereich')).includes('abgeglichen'));
}
await page.evaluate(m => { stdMonat = m; stdSchichten = null; zeichneStunden(); }, M);
await page.waitForTimeout(500);

// ══════════════ DIE GRENZEN -- HIER WICHTIGER ALS IN DER VERWALTUNG
const hinweis = await page.textContent('#stdHinweis');
check('KRITISCH: es steht ausdruecklich da, dass dies KEINE Lohnabrechnung ist',
  hinweis.includes('keine Lohnabrechnung'));
check('Der fehlende Feiertagsbonus wird benannt', hinweis.includes('Feiertage'));
check('Der fehlende Zuschlag ueber 210 Stunden wird benannt', hinweis.includes('210'));
check('Ferien und Absenzen werden als fehlend benannt',
  hinweis.includes('Ferien') && hinweis.includes('Absenzen'));
check('KRITISCH: der Weg bei Abweichungen wird genannt -- nicht nur ein Vorbehalt',
  hinweis.includes('Einsatzleitung'));

// ══════════════ KEINE ZWEITE STUNDENZAHL MEHR
check('KRITISCH: die alte Rapport-Stundenzahl ist aus dem Menü verschwunden',
  !(await page.textContent('#v-menu')).includes('Diesen Monat'));
await page.click('#t-rapport');
await page.waitForTimeout(400);
check('KRITISCH: auch im Rapport-Reiter steht keine konkurrierende Stundensumme',
  (await page.$$('#v-rapport .zahlen')).length === 0);

// ══════════════ BLAETTERN
await page.click('#t-menu');
await page.waitForTimeout(400);
await page.click('#mk-stunden');
await page.waitForTimeout(400);
await page.evaluate(m => { stdMonat = m; stdSchichten = null; zeichneStunden(); }, M);
await page.waitForTimeout(500);
rufe = [];
await page.click('#stdZurueck');
await page.waitForTimeout(500);
check('Zurueckblaettern laedt den Vormonat vom Server',
  rufe.some(r => r.url.includes('von=2026-02-01') && r.url.includes('bis=2026-02-28')));
check('Leerer Monat erklaert sich', (await page.textContent('#stdBereich')).includes('abgeglichen'));
await page.click('#stdVor');
await page.waitForTimeout(500);
check('Vorblaettern kehrt zurueck', (await page.textContent('#stdBereich')).includes('März'));

// ══════════════ NICHTS GESPEICHERT, NICHTS FREMDES
check('KRITISCH: die Ansicht schreibt nichts',
  !rufe.some(r => /save|create|update|delete|abgleich/.test(r.p)));
check('KRITISCH: gelesen wird nur der eigene Endpunkt',
  rufe.every(r => /meine_schichten|mein_profil|rapport_list|meine_/.test(r.p)));

// ══════════════ MOBIL
const m2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
check('Kein Seiten-Scroll bei 390px', m2.s <= m2.i + 1);
await page.screenshot({ path: `${OUT}/ms-01-stunden.png`, fullPage: true });

// ══════════════ UNTERSEITE: HIN, ZURUECK, UND NICHTS BLEIBT HAENGEN (ENT-051)
check('Der Abrechnungs-Hinweis steht auf der Unterseite, nicht im Profil',
  (await page.textContent('#pr-stunden')).includes('keine Lohnabrechnung'));
check('Es gibt einen Weg zurueck ins Profil',
  await page.evaluate(() => !!document.querySelector('#pr-stunden [onclick="stdSeiteZu()"]')));
await page.click('#pr-stunden [onclick="stdSeiteZu()"]');
await page.waitForTimeout(350);
check('Der Zurueck-Weg fuehrt zu den Personalien', await page.isVisible('#pr-haupt'));
check('Die Stunden sind danach wieder zugeklappt',
  await page.evaluate(() => getComputedStyle(document.getElementById('pr-stunden')).display === 'none'));

// Kein Zustand, der beim Verlassen haengen bleibt: wer die Unterseite offen
// laesst und den Reiter wechselt, kommt aufs Profil zurueck, nicht mitten in
// die Stunden.
await page.click('#mk-stunden');
await page.waitForTimeout(350);
check('Unterseite laesst sich erneut oeffnen', await page.isVisible('#stdBereich'));
await page.click('#t-heute');
await page.waitForTimeout(300);
await page.click('#t-menu');
await page.waitForTimeout(500);
check('Nach dem Reiterwechsel stehen wieder die Kacheln vorn', await page.isVisible('#pr-haupt'));
check('Die Unterseite bleibt nicht offen haengen',
  await page.evaluate(() => getComputedStyle(document.getElementById('pr-stunden')).display === 'none'));

// Die Kachel muss auf dem Handy zuverlaessig zu treffen sein.
const zl = await page.evaluate(() => {
  const r = document.getElementById('mk-stunden').getBoundingClientRect();
  return { h: r.height, l: r.left, w: r.right, iw: innerWidth };
});
check('Die Kachel ist gross genug zum Antippen', zl.h >= 44);
check('Die Kachel liegt vollstaendig im Bild', zl.l >= 0 && zl.w <= zl.iw + 1);
check('Die Kachel ist ein Knopf, nicht ein angeklicktes Kaestchen',
  await page.evaluate(() => document.getElementById('mk-stunden').tagName === 'BUTTON'));
await page.screenshot({ path: `${OUT}/ms-02-menu.png`, fullPage: true });

// ══════════════ ZEITBONUS ERKLAERT (ENT-052)
await page.click('#mk-stunden');
await page.waitForTimeout(400);
const daInfo = await page.evaluate(() => !!document.getElementById('bonusInfo'));
check('Die Zeitbonus-Kachel hat ein Info-Zeichen', daInfo);
if (!daInfo) { bad.push('Ohne Info-Zeichen sind die folgenden Pruefungen hinfaellig'); }
else {
const inf = await page.evaluate(() => {
  const b = document.getElementById('bonusInfo');
  const k = b.closest('.zahl');
  const rb = b.getBoundingClientRect(), rk = k.getBoundingClientRect();
  return {
    h: rb.height, w: rb.width,
    kachel: k.textContent,
    obenRechts: rb.top - rk.top < 12 && rk.right - rb.right < 12,
    imBild: rb.left >= 0 && rb.right <= innerWidth + 1,
    knopf: b.tagName === 'BUTTON',
    aria: !!b.getAttribute('aria-label'),
  };
});
check('Das Info-Zeichen sitzt oben rechts in der Kachel', inf.obenRechts);
check('Es haengt an der Zeitbonus-Kachel, nicht an einer anderen', inf.kachel.includes('ZEITBONUS') || /Zeitbonus/i.test(inf.kachel));
check('Es ist gross genug zum Antippen', inf.h >= 40 && inf.w >= 40);
check('Es liegt vollstaendig im Bild', inf.imBild);
check('Es ist ein Knopf mit Beschriftung fuer Vorlesehilfen', inf.knopf && inf.aria);

await page.click('#bonusInfo');
await page.waitForTimeout(400);
const txt = await page.textContent('#blBody');
check('Der Erklaertext geht auf', await page.isVisible('#blatt.on'));
check('Er nennt das Nachtfenster', txt.includes('23:00') && txt.includes('06:00'));
check('Er nennt die Hoehe des Bonus', txt.includes('6 Minuten') && txt.includes('10 %'));
check('Er sagt, dass die Pause mitzaehlt', /Pause inbegriffen/i.test(txt));
check('Er sagt, dass es Zeit ist und nicht Geld', /Arbeitszeit/.test(txt) && /Zeit, nicht Geld|gutgeschrieben/i.test(txt));
check('Er sagt, dass der Bonus nur einmal zaehlt', /nie doppelt|genau einmal/i.test(txt));
check('Er benennt die noch fehlenden Feiertage', /Feiertage sind hier noch nicht gerechnet/.test(txt));
check('Er nennt die Rechtsquelle', /Art\. 12 Ziff\. 2 GAV/.test(txt));
// CLAUDE.md verbietet, eine ungeklaerte Auslegung als Regel darzustellen.
// GAV-AUS-008 (anteiliger Bonus bei angebrochenen Stunden) ist offen.
check('KRITISCH: keine ungeklaerte Auslegung im Erklaertext',
  !/anteilig|angebrochen/i.test(txt));
check('Der Text bleibt kurz', txt.replace(/\s+/g, ' ').trim().length < 700);
check('Er laesst sich schliessen',
  await page.evaluate(() => !!document.querySelector('#blFuss [onclick="blattZu()"]')));
await page.click('#blFuss [onclick="blattZu()"]');
await page.waitForTimeout(350);
check('Nach dem Schliessen ist das Blatt zu', !(await page.isVisible('#blatt.on')));
await page.screenshot({ path: `${OUT}/ms-03-bonus.png`, fullPage: true });
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
