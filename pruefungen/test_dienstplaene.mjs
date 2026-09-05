// Mitarbeiter-Detailseite mit Dienstplänen (ENT-048).
// Schwerpunkt: der GAV-Zeitbonus ist die ERSTE bewertete Zeit im System.
// Geprüft wird darum vor allem, was NICHT gerechnet wird und ob die Grenzen
// des Gerechneten sichtbar sind.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Fester Monat im Gültigkeitszeitraum des Regelwerks (2026).
// 2026-03-01 ist ein Sonntag, 2026-03-02 ein Montag — nachgerechnet, nicht geraten.
const M = '2026-03';
const SO = '2026-03-01', MO = '2026-03-02', SA = '2026-03-07';

const P = (ist) => ({ id: 2, name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel',
  personalnummer: '2506', zusage: 'zugesagt', ist_pause_bezahlt_kunde: null, ...ist });

const einsaetze = [
  // Montag 22:00–23:30 -> 30 Min. im Nachtfenster (ab 23:00) -> 3.0 Min. Bonus
  { id: 1, kunde_name: 'Beispiel AG', titel: 'Schliessrunde', ort: '4601 Olten', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: MO, von: '22:00:00', bis: '23:30:00', bedarf: 1, status: 'geplant',
    ist_status: 'offen', mitarbeiter: [P({ ist_status: 'anwesend', ist_von: '22:00:00', ist_bis: '23:30:00',
      ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null })] },
  // Montag 05:15–05:30 -> 15 Min. voll in der Nacht -> 1.5 Min. Bonus (anteilig!)
  { id: 2, kunde_name: 'Beispiel AG', titel: 'Öffnungsrunde', ort: '4601 Olten', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: MO, von: '05:15:00', bis: '05:30:00', bedarf: 1, status: 'geplant',
    ist_status: 'offen', mitarbeiter: [P({ ist_status: 'anwesend', ist_von: '05:15:00', ist_bis: '05:30:00',
      ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null })] },
  // Sonntag 08:00–12:00 -> 4 h voll im Sonntagsfenster -> 24 Min. Bonus
  { id: 3, kunde_name: 'Grossbau AG', titel: 'Verkehrsdienst', ort: '4622 Egerkingen', einsatzart: 'Verkehrsdienst',
    sparte: 'sicherheit', datum: SO, von: '08:00:00', bis: '12:00:00', bedarf: 1, status: 'geplant',
    ist_status: 'offen', mitarbeiter: [P({ ist_status: 'anwesend', ist_von: '08:00:00', ist_bis: '12:00:00',
      ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null })] },
  // Samstag 08:00–18:00 mit 60 Min. BEZAHLTER Pause -> kein Bonus, Netto 10 h
  { id: 4, kunde_name: 'Cupi24', titel: 'Verkehrsdienst', ort: '4632 Trimbach', einsatzart: 'Verkehrsdienst',
    sparte: 'sicherheit', datum: SA, von: '08:00:00', bis: '18:00:00', bedarf: 1, status: 'geplant',
    ist_status: 'offen', mitarbeiter: [P({ ist_status: 'anwesend', ist_von: '08:00:00', ist_bis: '18:00:00',
      ist_pause_von: '12:00:00', ist_pause_min: 60, ist_pause_bezahlt_ma: 1 })] },
  // Sonntag 13:00-17:00, aber SPARTE REINIGUNG. Waere es Sicherheit, gaebe es
  // 24 Min. Bonus -- so gibt es null (ENT-061). Scharfer Pruefstein.
  { id: 6, kunde_name: 'Muster Reinigung AG', titel: 'Unterhaltsreinigung', ort: '4600 Olten',
    einsatzart: 'Reinigung', sparte: 'reinigung', datum: SO, von: '13:00:00', bis: '17:00:00',
    bedarf: 1, status: 'geplant', ist_status: 'offen',
    mitarbeiter: [P({ ist_status: 'anwesend', ist_von: '13:00:00', ist_bis: '17:00:00',
      ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null })] },
  // NICHT abgeglichen -> darf nirgends auftauchen
  { id: 5, kunde_name: 'Beispiel AG', titel: 'Nicht geprüft', ort: '4601 Olten', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: MO, von: '14:00:00', bis: '18:00:00', bedarf: 1, status: 'geplant',
    ist_status: 'offen', mitarbeiter: [P({ ist_status: 'offen', ist_von: null, ist_bis: null,
      ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null })] },
  // Anderer Monat -> darf nicht mitzaehlen
  { id: 6, kunde_name: 'Beispiel AG', titel: 'Vormonat', ort: '4601 Olten', einsatzart: 'Revierdienst',
    sparte: 'sicherheit', datum: '2026-02-10', von: '08:00:00', bis: '16:00:00', bedarf: 1, status: 'geplant',
    ist_status: 'offen', mitarbeiter: [P({ ist_status: 'anwesend', ist_von: '08:00:00', ist_bis: '16:00:00',
      ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null })] },
];

const MA = [
  { id: 1, name: 'hansmuster', vorname: 'Adrian', nachname: 'Muster', personalnummer: '1', ist_admin: 1 },
  { id: 2, name: 'dario.beispiel', vorname: 'Dario', nachname: 'Beispiel', personalnummer: '2506',
    ist_admin: 0, strasse: 'Weg 1', ort: '4600 Olten', telefon: '062 000 00 00', email: 'd@example.ch' },
];

let rufe = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const p = route.request().url().split('/api/')[1].split('?')[0];
  rufe.push(p);
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze });
  // Seit ENT-072 kommt das volle Dossier einzeln, nicht mehr in der Liste.
  if (p.includes('mitarbeiter_dossier')) {
    const n = decodeURIComponent((route.request().url().split('name=')[1] || '').split('&')[0]);
    const m = MA.find(x => x.name === n);
    return send(m ? { status: 'ok', mitarbeiter: m, eingerichtet: true }
                  : { status: 'error', message: 'nicht gefunden' });
  }
  if (p.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA,
    listen: { funktion: [], abteilung: [] }, eingerichtet: true });
  if (p.includes('feiertage_list')) return send({ status: 'ok', feiertage: [] });
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: MA,
    feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(400);
// Volle Leiste ausdruecklich erzwingen: Diese Suite prueft Dienstplaene,
// nicht die Huelle (ENT-407) -- der Klick auf Unterkategorien weiter unten
// setzt die ausgeklappte Leiste voraus.
await page.evaluate(() => huelleSetzen('voll'));

// ══════════════════════════ ZEITBONUS: REINE RECHNUNG
check('KRITISCH: 15 Min. voll in der Nacht ergeben anteilig 1.5 Min. Bonus, nicht 0',
  await page.evaluate(m => gavBonusMin(m, '05:15', '05:30') === 1.5, MO));
check('KRITISCH: nur der Teil AB 23:00 zaehlt -- 22:00-23:30 ergibt 3 Min.',
  await page.evaluate(m => gavBonusMin(m, '22:00', '23:30') === 3, MO));
check('KRITISCH: Werktag tagsueber gibt keinen Bonus',
  await page.evaluate(m => gavBonusMin(m, '08:00', '12:00') === 0, MO));
check('KRITISCH: Sonntag tagsueber gibt Bonus -- 4 h ergeben 24 Min.',
  await page.evaluate(d => gavBonusMin(d, '08:00', '12:00') === 24, SO));
check('KRITISCH: Samstag ist kein Bonustag',
  await page.evaluate(d => gavBonusMin(d, '08:00', '18:00') === 0, SA));
check('KRITISCH: ein ganzer Sonntag ist durchgehend Bonuszeit -- Nacht- und Tagfenster grenzen luecklos an',
  await page.evaluate(d => gavBonusMin(d, '00:00', '23:59') === 143.9, SO));
check('KRITISCH: Schicht ueber Mitternacht in den Sonntag wird tagesgenau bewertet',
  // Sa 22:00 -> So 02:00: Sa 22-23 kein Bonus, Sa 23:00-So 02:00 Nacht = 180 Min -> 18
  await page.evaluate(d => gavBonusMin(d, '22:00', '02:00') === 18, SA));
check('KRITISCH: derselbe Zeitraum wird nie doppelt bewertet (Nacht UND Sonntag)',
  // So 00:00-06:00 ist Nacht, nicht zusaetzlich Sonntag: 360 Min -> 36, nicht 72
  await page.evaluate(d => gavBonusMin(d, '00:00', '06:00') === 36, SO));
check('KRITISCH: ausserhalb des Regelwerks wird NICHT gerechnet, sondern null zurueckgegeben',
  await page.evaluate(() => gavBonusMin('2027-03-02', '05:15', '05:30') === null
    && gavBonusMin('2025-12-31', '05:15', '05:30') === null));
check('Das Regelwerk traegt Quelle und Gueltigkeitszeitraum',
  await page.evaluate(() => GAV_REGELWERK[0].ab === '2026-01-01' && GAV_REGELWERK[0].bis === '2026-12-31'
    && GAV_REGELWERK[0].quelle.includes('2026')));

// ══════════════════════════ DETAILSEITE
await page.evaluate(() => { if (!document.getElementById('navg-admin').classList.contains('offen')) { document.getElementById('nav-admin').click(); } });
await page.waitForTimeout(250);
await page.click('#nav-admin-mitarbeiter');
await page.waitForTimeout(400);
check('Die Liste ist der Einstieg', await page.isVisible('#mv-liste'));
check('Detailseite ist zu', !(await page.isVisible('#mv-detail')));
await page.click('#maTable tbody tr:nth-child(2)');
await page.waitForTimeout(400);
check('Klick auf die Zeile oeffnet die Detailseite', await page.isVisible('#mv-detail'));
check('Der Name steht im Kopf', (await page.textContent('#mdName')) === 'Dario Beispiel');
check('Personalnummer im Untertitel', (await page.textContent('#mdSub')).includes('2506'));
check('KRITISCH: der Klick oeffnet NICHT mehr die Bearbeiten-Schublade',
  !(await page.evaluate(() => document.getElementById('drawer').classList.contains('on'))));
check('Bearbeiten ist weiterhin erreichbar', await page.isVisible('#mv-detail .btn-primary'));
check('Die Listensuche verschwindet mit der Liste -- sie gehoert nicht auf eine Detailseite',
  !(await page.isVisible('#mQ')));
// Seit ENT-072 fuehrt "Bearbeiten" auf die volle Flaeche, nicht in eine
// Schublade. Hier interessiert nur, dass der Weg hin und zurueck funktioniert.
await page.click('#mv-detail .btn-primary');
await page.waitForSelector('#mv-bearbeiten.on');
await page.waitForTimeout(300);
check('Bearbeiten oeffnet die volle Flaeche', await page.isVisible('#mv-bearbeiten.on'));
await page.click('#mv-bearbeiten .btn-plain');   // Abbrechen
await page.waitForSelector('#mv-detail.on');
await page.waitForTimeout(200);

// ══════════════════════════ DIENSTPLAENE
await page.click('#mdtab-dienstplaene');
await page.waitForTimeout(300);
await page.evaluate(m => { document.getElementById('mdMonat').value = m; renderMaDetail(); }, M);
await page.waitForTimeout(300);
check('Fuenf abgeglichene Schichten im Monat -- vier Sicherheit, eine Reinigung', (await page.$$('#mdTable tbody tr')).length === 5);
const t = await page.textContent('#mdTable');
check('KRITISCH: nicht abgeglichene Schichten erscheinen nicht', !t.includes('Nicht geprüft'));
check('KRITISCH: andere Monate zaehlen nicht mit', !t.includes('Vormonat'));
check('Chronologisch: der Sonntag (01.03.) steht zuoberst',
  (await page.textContent('#mdTable tbody tr:first-child')).includes('01.03.2026'));
check('Bezahlte Pause ist als solche gekennzeichnet', t.includes('bezahlt'));

// Summen: Netto 4h + 0.25h + 1.5h + 10h (bezahlte Pause bleibt drin) + 4h
// Reinigung = 19:45. Die Reinigung zaehlt als Arbeitszeit mit -- nur bewertet
// wird sie nicht.
const summen = await page.textContent('#mdSummen');
check('KRITISCH: geleistete Zeit rechnet die bezahlte Pause nicht heraus (ENT-047)',
  summen.includes('19:45'));
// Bonus: 24 + 1.5 + 3 + 0 = 28.5 Min. Die Reinigungsschicht liegt voll im
// Sonntagsfenster und traegt trotzdem NICHTS bei (ENT-061).
check('KRITISCH: Zeitbonus wird SEPARAT ausgewiesen, nicht eingerechnet',
  summen.includes('0:29') || summen.includes('0:28'));
check('KRITISCH: eine Reinigungsschicht am Sonntag erzeugt keinen Zeitbonus (ENT-061)',
  !summen.includes('0:53') && !summen.includes('0:52'));

// ── Die Summen stehen getrennt da (ENT-063)
const sp = await page.evaluate(() => {
  const e = document.getElementById('mdSparten');
  // Sichtbarkeit, nicht blosse Anwesenheit: .ki-hint ist ohne .on
  // display:none, und textContent liest auch unsichtbare Elemente.
  return (e && e.getClientRects().length) ? e.textContent.replace(/\s+/g, ' ').trim() : null;
});
if (!sp) { bad.push('Die Aufteilung nach Sparte fehlt'); }
else {
  check('KRITISCH: Sicherheit und Reinigung stehen getrennt', /Sicherheit \(GAV\)/.test(sp));
  check('Die Sicherheitsstunden sind richtig ausgewiesen (15:45)', /15:45/.test(sp));
  check('Die Reinigungsstunden sind richtig ausgewiesen (4:00)', /4:00/.test(sp));
  check('Es steht da, worauf sich die GAV-Groessen bemessen', /nur auf den Sicherheitsstunden/.test(sp));
  check('Die 210-Stunden-Schwelle wird ausdruecklich genannt', /210/.test(sp));
}
check('Total mit Zeitbonus steht als eigene Zahl daneben',
  (await page.$$('#mdSummen .md-kachel')).length === 3);
check('Die Bonuskachel benennt, was fehlt', summen.includes('ohne Feiertage'));

// ══════════════════════════ DIE GRENZEN DES GERECHNETEN
const vorbehalt = await page.textContent('#mdVorbehalt');
check('KRITISCH: es steht ausdruecklich da, dass dies KEINE Arbeitszeitabrechnung ist',
  vorbehalt.includes('keine Arbeitszeitabrechnung nach Art. 12 Ziff. 5'));
check('Der fehlende Feiertagsbonus wird benannt',
  vorbehalt.includes('Feiertage') && vorbehalt.includes('GAV-AUS-006'));
check('Der fehlende 25-%-Zuschlag wird benannt', vorbehalt.includes('Art. 14 Ziff. 3'));
check('Ferien, Absenzen und Mehrzeit werden als fehlend benannt',
  vorbehalt.includes('Ferienguthaben') && vorbehalt.includes('Absenzen'));
check('Das Regelwerk wird mit Quelle genannt', vorbehalt.includes('Ausgabe 2026'));
check('KRITISCH: die Seite hat nichts gespeichert',
  !rufe.some(r => /save|create|update|delete|abgleich/.test(r)));

// ══════════════════════════ MONATSWECHSEL
await page.click('#mv-detail .tool-gruppe button:first-child');
await page.waitForTimeout(300);
check('Vormonat blaettert zurueck', (await page.inputValue('#mdMonat')) === '2026-02');
check('Im Vormonat steht die eine Schicht von dort',
  (await page.textContent('#mdTable')).includes('Vormonat'));
await page.click('#mv-detail .tool-gruppe button:last-child');
await page.waitForTimeout(300);
check('Folgemonat blaettert vor', (await page.inputValue('#mdMonat')) === M);

// Leerer Monat
await page.evaluate(() => { document.getElementById('mdMonat').value = '2026-07'; renderMaDetail(); });
await page.waitForTimeout(300);
check('Leerer Monat erklaert, warum er leer ist',
  (await page.textContent('#mdTable')).includes('Abgleich'));
check('Ohne Zeilen keine Summen -- keine Null, die nach Ergebnis aussieht',
  (await page.textContent('#mdSummen')).trim() === '');

// ══════════════════════════ ZURUECK
await page.click('#mv-detail .ku-zurueck');
await page.waitForTimeout(300);
check('Zurueck fuehrt auf die Liste', await page.isVisible('#mv-liste') && !(await page.isVisible('#mv-detail')));
await page.screenshot({ path: `${OUT}/dp-01-liste.png` });
await page.evaluate(m => { openMaDetail('dario.beispiel'); mdGoTab('dienstplaene');
  document.getElementById('mdMonat').value = m; renderMaDetail(); }, M);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/dp-02-dienstplaene.png` });

// ══════════════════════════ MOBIL
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const m2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
check('Kein Seiten-Scroll bei 390px', m2.s <= m2.i + 1);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
