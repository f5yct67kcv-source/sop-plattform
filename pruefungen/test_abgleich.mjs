// Schichten abgleichen (ENT-045, überarbeitet nach dem Vorbild der
// Referenzlösung): eine Zeile ist eine PERSON auf einer Schicht, Zeiten sind
// direkt in der Zeile änderbar, Sammelabgleich über Häkchen.
// Geprüft wird vor allem, dass hier NICHTS gerechnet und nichts ungefragt
// gespeichert wird.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { zeitSetzen } from './zeitfeld.mjs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const tag = d => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const person = (id, vorname, nachname, nr, zusage) => ({
  id, name: `${vorname[0]}.${nachname}`.toLowerCase(), vorname, nachname, personalnummer: nr,
  zusage, ist_status: 'offen', ist_von: null, ist_bis: null,
  ist_pause_von: null, ist_pause_min: null,
  ist_pause_bezahlt_ma: null, ist_pause_bezahlt_kunde: null,
  ist_bemerkung: null, abgeglichen_am: null,
});

let einsaetze = [
  { id: 1, kunde_name: 'Kunde A', titel: 'Nachtrunde', ort: 'Ort A', strasse: 'Weg 1',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(-3), von: '22:00:00', bis: '23:00:00',
    bedarf: 2, status: 'geplant', bemerkung: 'Schlüssel beim Hauswart', ist_status: 'offen',
    ist_von: null, ist_bis: null, ist_bemerkung: null, abgeglichen_am: null,
    mitarbeiter: [person(10, 'Anna', 'Muster', '2518', 'zugesagt'), person(11, 'Bea', 'Beispiel', '2506', 'offen')] },
  // Unbesetzt -- muss trotzdem erscheinen, sonst verschwindet sie lautlos
  { id: 2, kunde_name: 'Kunde B', titel: '', ort: 'Ort B', strasse: '', einsatzart: 'Reinigung',
    sparte: 'reinigung', datum: tag(-1), von: '06:00:00', bis: '09:00:00', bedarf: 1, status: 'geplant',
    bemerkung: null, ist_status: 'offen', ist_von: null, ist_bis: null, ist_bemerkung: null,
    abgeglichen_am: null, mitarbeiter: [] },
  // Zukunft -- gehört nicht in die Rückschau
  { id: 3, kunde_name: 'Kunde C', titel: '', ort: 'Ort C', strasse: '', einsatzart: 'Verkehrsdienst',
    sparte: 'sicherheit', datum: tag(+5), von: '08:00:00', bis: '12:00:00', bedarf: 1, status: 'geplant',
    bemerkung: null, ist_status: 'offen', mitarbeiter: [person(10, 'Anna', 'Muster', '2518', 'offen')] },
  // Abgesagt -- die Absage ist bereits die Feststellung
  { id: 4, kunde_name: 'Kunde D', titel: '', ort: 'Ort D', strasse: '', einsatzart: 'Verkehrsdienst',
    sparte: 'sicherheit', datum: tag(-2), von: '08:00:00', bis: '12:00:00', bedarf: 1, status: 'abgesagt',
    bemerkung: null, ist_status: 'offen', mitarbeiter: [person(11, 'Bea', 'Beispiel', '2506', 'offen')] },
  // Lange Schicht: 07:30-17:30 = 10 h Rohzeit -> Art. 13 Ziff. 1 lit. c, 60 Min.
  { id: 5, kunde_name: 'Kunde E', titel: '', ort: 'Ort E', strasse: '', einsatzart: 'Verkehrsdienst',
    sparte: 'sicherheit', datum: tag(-1), von: '07:30:00', bis: '17:30:00', bedarf: 1, status: 'geplant',
    bemerkung: null, ist_status: 'offen', ist_von: null, ist_bis: null, ist_bemerkung: null,
    abgeglichen_am: null, mitarbeiter: [person(12, 'Cem', 'Colak', '2601', 'offen')] },
];

let rufe = [];
const schreibt = () => rufe.filter(r => /create|update|delete|abgleich|zuteil|save/.test(r.p));

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
  rufe.push({ p, body });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze });
  if (p.includes('einsatz_abgleich')) {
    // Wie der Server: Ist je Person schreiben, Plan unangetastet lassen.
    (body.zeilen || []).forEach(z => {
      const e = einsaetze.find(x => x.id === z.einsatz_id);
      if (!e) return;
      const ohne = z.ist_status !== 'anwesend';
      const ziel = z.mitarbeiter_id ? (e.mitarbeiter || []).find(m => m.id === z.mitarbeiter_id) : e;
      if (!ziel) return;
      // Spiegelt einsatz_abgleich.php Feld fuer Feld -- ein Mock, der weniger
      // speichert als der Server, laesst echte Fehler durchgehen und meldet
      // dafuer falsche. Beides schon passiert, darum hier bewusst vollstaendig.
      const jaNein = w => (w === null || w === undefined || w === '' ? null : (Number(w) === 1 ? 1 : 0));
      ziel.ist_status = z.ist_status;
      ziel.ist_von = ohne ? null : z.ist_von;
      ziel.ist_bis = ohne ? null : z.ist_bis;
      ziel.ist_pause_von = ohne || !z.ist_pause_von ? null : z.ist_pause_von;
      if ('ist_pause_min' in ziel) ziel.ist_pause_min = ohne || z.ist_pause_min === '' ? null : Number(z.ist_pause_min);
      ziel.ist_pause_bezahlt_ma = ohne ? null : jaNein(z.ist_pause_bezahlt_ma);
      ziel.ist_pause_bezahlt_kunde = ohne ? null : jaNein(z.ist_pause_bezahlt_kunde);
      ziel.ist_bemerkung = z.ist_bemerkung || null;
    });
    return send({ status: 'ok', geschrieben: (body.zeilen || []).length });
  }
  return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [], mitarbeiter: [],
    feiertage: [], gepflegt: {}, sperren: [], kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [] });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');
await page.waitForTimeout(300);

// ══════════════════════════════════════════ PLATZIERUNG
check('Eigener Seitenleisten-Punkt unter Planung', await page.isVisible('#nav-abgleich'));
check('Keine Zahl im Menue -- der Stand steht auf der Seite selbst',
  await page.evaluate(() => !document.getElementById('abgleichZahl')));

await page.click('#nav-abgleich');
await page.waitForTimeout(500);
check('Titel benennt den Arbeitsschritt', (await page.textContent('#pgTitle')) === 'Schichten abgleichen');
check('KRITISCH: Vorgabe ist "Alle" -- Abgeglichenes bleibt sichtbar',
  (await page.inputValue('#agStatusFilter')) === '');

// ══════════════════════════════════════════ EINE ZEILE JE PERSON
const t1 = await page.textContent('#agTable');
check('Eine Zeile je Person: zwei Personen einer Schicht ergeben zwei Zeilen',
  (await page.$$('#agTable tbody tr')).length === 4);
check('Beide Personen namentlich in eigenen Zeilen', t1.includes('Anna Muster') && t1.includes('Bea Beispiel'));
check('Personalnummer steht bei der Person', t1.includes('2518') && t1.includes('2506'));
check('KRITISCH: unbesetzte Schicht verschwindet nicht, sondern wird ausgewiesen',
  t1.includes('niemand eingeteilt'));
check('KRITISCH: Zukuenftige Schichten erscheinen nicht', !t1.includes('Ort C'));
check('KRITISCH: Abgesagte erscheinen nicht', !t1.includes('Ort D'));
check('KRITISCH: das Oeffnen der Liste schreibt nichts', schreibt().length === 0);
check('Chronologisch: aeltestes zuoberst', (await page.textContent('#agTable tbody tr:first-child')).includes('Ort A'));

// ══════════════════════════════════════════ SPALTEN
const kopf = await page.textContent('#agTable thead');
const koepfe = await page.evaluate(() =>
  [...document.querySelectorAll('#agTable thead th')].map(h => h.textContent.trim()));
for (const sp of ['Planung', 'Mitarbeitende', 'Datum', 'von', 'bis', 'Pause / Dauer', 'Netto', 'Status', 'Bearbeiten']) {
  check(`Spalte ${sp} vorhanden`, koepfe.includes(sp));
}
check('KRITISCH: die Nettospalte heisst nicht "Arbeitszeit" -- das waere eine GAV-Behauptung',
  !koepfe.includes('Arbeitszeit'));
check('KRITISCH: keine eigene Kunde-Spalte mehr -- der Kunde steht bereits in der Planung-Zelle mit',
  !kopf.includes('Kunde'));
check('KRITISCH: keine Lohn-, Tarif- oder GAV-Spalte',
  !/Lohn|Tarif|GAV|Verrechn|MWST/i.test(kopf));
check('Bearbeiten steht ganz rechts',
  (await page.evaluate(() => {
    const th = [...document.querySelectorAll('#agTable thead th')];
    return th[th.length - 1].textContent.trim();
  })) === 'Bearbeiten');
check('Der Stift sitzt in der letzten Spalte',
  await page.evaluate(() => {
    const td = [...document.querySelectorAll('#agTable tbody tr:first-child td')];
    return !!td[td.length - 1].querySelector('.stift');
  }));
check('KRITISCH: ALLE Koepfe sind linksbuendig -- auch von, bis, Pause und Dauer',
  await page.evaluate(() => [...document.querySelectorAll('#agTable thead th')]
    .every(h => getComputedStyle(h).textAlign === 'left')));
check('KRITISCH: alle Inhaltszellen ebenfalls linksbuendig -- durchgehende Kante',
  await page.evaluate(() => [...document.querySelectorAll('#agTable tbody tr:first-child td')]
    .every(d => getComputedStyle(d).textAlign === 'left')));
check('Gleiche seitliche Abstaende in Kopf und Inhalt',
  await page.evaluate(() => {
    const mitte = [...document.querySelectorAll('#agTable thead th')].slice(1, -1);
    const mitteTd = [...document.querySelectorAll('#agTable tbody tr:first-child td')].slice(1, -1);
    const p = el => getComputedStyle(el).paddingLeft + '|' + getComputedStyle(el).paddingRight;
    const soll = p(mitte[0]);
    return mitte.every(el => p(el) === soll) && mitteTd.every(el => p(el) === soll);
  }));
check('Haken- und Bearbeiten-Spalte saugen keinen Platz auf',
  await page.evaluate(() => {
    const th = [...document.querySelectorAll('#agTable thead th')];
    const breit = el => el.getBoundingClientRect().width;
    return breit(th[0]) < 90 && breit(th[th.length - 1]) < 130;
  }));

// ══════════════════════════════════════════ ZEITEN IN DER ZEILE
check('Zeiten sind in der Zeile aenderbar und mit dem Plan vorbelegt',
  (await page.inputValue('#agTable tbody tr:first-child [data-ag="von"]')) === '22:00'
  && (await page.inputValue('#agTable tbody tr:first-child [data-ag="bis"]')) === '23:00');
check('Dauer wird angezeigt', (await page.textContent('#agTable tbody tr:first-child td:nth-child(8)')).trim() === '01:00');
await page.fill('#agTable tbody tr:first-child [data-ag="pause"]', '15');
await page.waitForTimeout(150);
check('Dauer zieht die Pause ab und rechnet live nach',
  (await page.textContent('#agTable tbody tr:first-child td:nth-child(8)')).trim() === '00:45');
check('KRITISCH: Tippen in der Zeile speichert nichts', schreibt().length === 0);

// ══════════════════════════════════════════ PAUSENREGEL (ENT-046, Art. 13 GAV)
// Die Schwellen stehen wörtlich im GAV und sind unstrittig. Geprüft wird hier
// vor allem, dass daraus NICHTS gerechnet und nichts ungefragt gespeichert wird.
const pauseFeld = n => `#agTable tbody tr:nth-child(${n}) [data-ag="pause"]`;
const langZ = 4;   // Kunde E, 07:30–17:30 = 10 h
check('KRITISCH: Sollpause folgt dem Wortlaut -- 10 h Rohzeit ergibt 60 Minuten',
  (await page.inputValue(pauseFeld(langZ))) === '60');
// Zeile 2 ist unberuehrt -- in Zeile 1 hat eine fruehere Pruefung schon getippt.
check('Kurze Schicht loest keine Pausenpflicht aus -- 1 h bleibt leer',
  (await page.inputValue(pauseFeld(2))) === '');
check('KRITISCH: die Schwelle ist 5.5 h, nicht 6 h',
  await page.evaluate(() => agPauseSoll('08:00', '13:31').min === 15 && agPauseSoll('08:00', '13:30').min === 0));
check('Die drei Stufen des Artikels stimmen',
  await page.evaluate(() => agPauseSoll('08:00', '15:01').min === 30
    && agPauseSoll('08:00', '17:01').min === 60
    && agPauseSoll('22:00', '04:00').min === 15));
check('KRITISCH: die Sollpause ist als Vorschlag markiert, nicht als Feststellung',
  await page.evaluate(n => {
    const el = document.querySelector(`#agTable tbody tr:nth-child(${n}) [data-ag="pause"]`);
    return el.classList.contains('vorschlag');
  }, langZ));
check('Der Tooltip nennt Artikel und Grund',
  await page.evaluate(n => {
    const el = document.querySelector(`#agTable tbody tr:nth-child(${n}) [data-ag="pause"]`);
    return el.title.includes('Art. 13') && el.title.includes('9 Std.') && el.title.includes('noch nicht gespeichert');
  }, langZ));
check('KRITISCH: der Vorschlag allein speichert nichts', schreibt().length === 0);
check('Netto zieht die vorgeschlagene Pause ab',
  (await page.textContent(`#agTable tbody tr:nth-child(${langZ}) td:nth-child(8)`)).trim() === '09:00');
// Seit ENT-110 steht dort die Zeitwahl; sichtbar ist ihre Huelle, nicht das
// wertfuehrende Feld.
check('Pausenbeginn ist ein eigenes Feld',
  await page.evaluate(z => {
    const el = document.querySelector(`#agTable tbody tr:nth-child(${z}) [data-ag="pausevon"]`);
    const h = el && el.closest('.zeitwahl');
    return !!h && h.getBoundingClientRect().height > 0;
  }, langZ));
// Zu kurze Pause wird markiert, aber nicht verhindert
await page.fill(pauseFeld(langZ), '20');
await page.waitForTimeout(150);
check('Zu kurze Pause wird sichtbar angemahnt',
  (await page.textContent(`#agTable tbody tr:nth-child(${langZ}) [data-soll]`)).includes('60'));
check('Wer die Pause anfasst, hat sie geprueft -- Vorschlagsmarkierung faellt weg',
  await page.evaluate(n => !document.querySelector(`#agTable tbody tr:nth-child(${n}) [data-ag="pause"]`)
    .classList.contains('vorschlag'), langZ));
check('KRITISCH: eine zu kurze Pause wird NICHT verhindert -- der Abgleich haelt fest, was war',
  await page.evaluate(n => !document.querySelector(`#agTable tbody tr:nth-child(${n}) [data-ag="pause"]`).disabled, langZ));
await page.fill(pauseFeld(langZ), '60');
await page.waitForTimeout(150);
check('Ausreichende Pause: Mahnung verschwindet',
  (await page.textContent(`#agTable tbody tr:nth-child(${langZ}) [data-soll]`)).trim() === '');
check('KRITISCH: nach allem Tippen ist noch immer nichts gespeichert', schreibt().length === 0);

// ── Bezahlte Pause wird nicht von Netto abgezogen (ENT-047) ─────────────
check('KRITISCH: unbezahlte Pause wird abgezogen',
  await page.evaluate(() => agDauer('07:30', '17:30', 60, 0) === '09:00'));
check('KRITISCH: bezahlte MA-Pause bleibt in der Nettozeit -- Art. 13 Ziff. 2',
  await page.evaluate(() => agDauer('07:30', '17:30', 60, 1) === '10:00'));
check('KRITISCH: noch nicht festgestellt (null) wird abgezogen, nicht geschenkt',
  await page.evaluate(() => agDauer('07:30', '17:30', 60, null) === '09:00'));
check('KRITISCH: die Kunden-Kennzeichnung fasst Netto NICHT an -- sie betrifft die Verrechnung',
  await page.evaluate(() => {
    // agDauer kennt nur die MA-Kennzeichnung; ein Kundenwert darf nirgends
    // durchschlagen. Geprueft ueber die Signatur: ein vierter Parameter, mehr nicht.
    return agDauer.length === 4 && agDauer('07:30', '17:30', 60, 0) === '09:00';
  }));

// ══════════════════════════════════════════ SAMMELAUSWAHL
check('Sammelleiste ist versteckt, solange nichts gewaehlt ist', !(await page.isVisible('#agSammel')));
await page.check('#agTable tbody tr:first-child .haken');
await page.waitForTimeout(150);
check('Eine Auswahl blendet die Sammelleiste ein', await page.isVisible('#agSammel'));
check('Die Leiste nennt die Anzahl', (await page.textContent('#agSammelZahl')).startsWith('1 Zeile'));
await page.check('#agAlle');
await page.waitForTimeout(150);
check('Kopf-Haken waehlt alle', (await page.textContent('#agSammelZahl')).startsWith('4 Zeilen'));

// ══════════════════════════════════════════ MASTERZEITEN
await zeitSetzen(page, '#agMzVon', '22:15');
await zeitSetzen(page, '#agMzBis', '23:45');
await page.click('#agMzZeitBtn');
await page.waitForTimeout(200);
check('Schichtzeiten anpassen setzt alle ausgewaehlten Zeilen',
  (await page.inputValue('#agTable tbody tr:nth-child(2) [data-ag="von"]')) === '22:15'
  && (await page.inputValue('#agTable tbody tr:nth-child(2) [data-ag="bis"]')) === '23:45');
await page.fill('#agMzPause', '30');
await page.click('#agMzPauseBtn');
await page.waitForTimeout(200);
check('Pausen anpassen setzt alle ausgewaehlten Zeilen',
  (await page.inputValue('#agTable tbody tr:nth-child(2) [data-ag="pause"]')) === '30');
check('Dauer nach Masterzeiten nachgefuehrt',
  (await page.textContent('#agTable tbody tr:nth-child(2) td:nth-child(8)')).trim() === '01:00');
check('KRITISCH: Masterzeiten setzen nur die Felder, sie speichern nicht', schreibt().length === 0);
await page.screenshot({ path: `${OUT}/ag-01-liste.png` });

// ══════════════════════════════════════════ SAMMELABGLEICH
rufe = [];
await page.click('#agSammel button:has-text("Abgleichen")');
await page.waitForTimeout(500);
const s = rufe.find(r => r.p.includes('einsatz_abgleich'));
check('Sammelabgleich schickt einen Aufruf fuer alle Zeilen', s && s.body.zeilen.length === 4);
check('Jede Zeile traegt ihre Person', s && s.body.zeilen.filter(z => z.mitarbeiter_id).length === 3);
check('Die unbesetzte Schicht geht ohne Person mit', s && s.body.zeilen.some(z => !z.mitarbeiter_id));
check('Status wird uebergeben', s && s.body.zeilen.every(z => z.ist_status === 'anwesend'));
check('Zeiten je Zeile uebergeben', s && s.body.zeilen[0].ist_von === '22:15' && s.body.zeilen[0].ist_bis === '23:45');
check('Pausenbeginn wird mitgeschickt', s && 'ist_pause_von' in s.body.zeilen[0]);
check('KRITISCH: der Sammelabgleich setzt die Bezahlt-Kennzeichnung NICHT -- sie ist eine Einzelfallfeststellung',
  s && s.body.zeilen.every(z => z.ist_pause_bezahlt_ma === '' && z.ist_pause_bezahlt_kunde === ''));
check('KRITISCH: der Plan wird nicht angefasst -- kein einsatz_save',
  !rufe.some(r => r.p.includes('einsatz_save')));
check('Nach dem Abgleich ist die Auswahl leer', !(await page.isVisible('#agSammel')));

// ══════════════════════════════════════════ FESTGESCHRIEBEN, ABER SICHTBAR
check('KRITISCH: Abgeglichenes verschwindet NICHT aus der Tabelle',
  (await page.$$('#agTable tbody tr')).length === 4);
check('KRITISCH: Chip zeigt "Abgeglichen" statt "Anwesend" -- das Schloss sagt bereits, dass es erledigt ist',
  (await page.textContent('#agTable')).includes('Abgeglichen') && !(await page.textContent('#agTable')).includes('Anwesend'));
check('Jede abgeglichene Zeile ist als gesperrt markiert',
  (await page.$$('#agTable tbody tr.zu')).length === 4);
check('KRITISCH: geschlossenes Vorhaengeschloss beim Status',
  await page.evaluate(() => [...document.querySelectorAll('#agTable tbody tr')]
    .every(tr => !!tr.querySelector('.chip .i-schloss'))));
check('KRITISCH: erst der Text, dann das Schloss -- nicht umgekehrt',
  await page.evaluate(() => {
    const chip = document.querySelector('#agTable tbody tr.zu .chip');
    if (!chip) return false;
    const kinder = [...chip.childNodes];
    const textPos = kinder.findIndex(n => n.nodeType === 3 && n.textContent.trim());
    const schlossPos = kinder.findIndex(n => n.nodeType === 1 && n.classList.contains('i-schloss'));
    return textPos > -1 && schlossPos > -1 && textPos < schlossPos;
  }));
check('Das Schloss im Chip ist groesser als das kleine im Raster',
  await page.evaluate(() => {
    const el = document.querySelector('#agTable tbody tr.zu .chip .i-schloss');
    return !!el && el.getBoundingClientRect().width >= 14;
  }));
check('KRITISCH: gesperrte Zeile ist optisch abgesetzt -- eigener Hintergrund, kein transparenter',
  await page.evaluate(() => {
    const zu = document.querySelector('#agTable tbody tr.zu td');
    return !!zu && getComputedStyle(zu).backgroundColor !== 'rgba(0, 0, 0, 0)';
  }));
check('KRITISCH: die Felder einer gesperrten Zeile sind nicht mehr bedienbar',
  await page.evaluate(() => [...document.querySelectorAll('#agTable [data-ag]')].every(i => i.disabled)));
check('Die erfassten Ist-Zeiten bleiben lesbar stehen',
  (await page.inputValue('#agTable tbody tr:first-child [data-ag="von"]')) === '22:15');
check('Der Stift bleibt erreichbar -- er ist der Weg zurueck',
  await page.isEnabled('#agTable tbody tr:first-child .stift'));

// Sammelaktionen duerfen eine gesperrte Zeile nicht nebenbei ueberschreiben.
rufe = [];
await page.check('#agAlle');
await zeitSetzen(page, '#agMzVon', '05:00');
await page.click('#agMzZeitBtn');
await page.waitForTimeout(200);
check('KRITISCH: Masterzeiten fassen gesperrte Zeilen nicht an',
  (await page.inputValue('#agTable tbody tr:first-child [data-ag="von"]')) === '22:15');
await page.click('#agSammel button:has-text("Abgleichen")');
await page.waitForTimeout(400);
check('KRITISCH: erneutes Abgleichen gesperrter Zeilen schickt nichts',
  !rufe.some(r => r.p.includes('einsatz_abgleich')));

// ══════════════════════════════════════════ ZURUECKNEHMEN MIT DOPPELBESTAETIGUNG
await page.selectOption('#agStatusFilter', 'offen');
await page.waitForTimeout(300);
check('Filter "Nur offene" blendet das Abgeglichene aus, wenn man das will',
  (await page.$$('#agTable tbody tr')).length === 0);
await page.selectOption('#agStatusFilter', '');
await page.waitForTimeout(300);
await page.check('#agAlle');
rufe = [];
await page.click('#agSammel button:has-text("Abgleich aufheben")');
await page.waitForTimeout(300);
check('KRITISCH: Aufheben fragt zuerst nach', await page.isVisible('#dlgConfirm.on'));
check('KRITISCH: vor der Bestaetigung wird nichts geschickt',
  !rufe.some(r => r.p.includes('einsatz_abgleich')));
check('Die Rueckfrage sagt, was verloren geht',
  (await page.textContent('#cfText')).toLowerCase().includes('gehen dabei verloren'));
await page.click('#cfBtn');
await page.waitForTimeout(500);
const z = rufe.find(r => r.p.includes('einsatz_abgleich'));
check('Abgleich aufheben setzt alle auf offen', z && z.body.zeilen.every(x => x.ist_status === 'offen'));
check('Danach sind sie wieder offen', (await page.textContent('#agTable')).includes('Offen'));
check('Und wieder bedienbar',
  await page.evaluate(() => [...document.querySelectorAll('#agTable [data-ag]')].every(i => !i.disabled)));

// ══════════════════════════════════════════ SCHUBLADE PER STIFT
await page.selectOption('#agStatusFilter', 'offen');
await page.waitForTimeout(300);
await page.click('#agTable tbody tr:first-child .stift');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(300);
check('Der Stift oeffnet die Schublade', await page.isVisible('#drawer.on'));
const plan = await page.textContent('#drBody .zone');
check('Der Plan steht zum Vergleich daneben', plan.includes('22:00–23:00') && plan.includes('Bedarf 2'));
check('Bemerkung aus der Planung wird gezeigt', plan.includes('Hauswart'));
check('Die Zusage steht dabei, ohne die Anwesenheit zu bestimmen', plan.includes('zugesagt'));
check('KRITISCH: Der Hinweis sagt, dass nichts gerechnet wird',
  (await page.textContent('#drBody')).toLowerCase().includes('auslegungsregister'));
check('Vorwahl anwesend -- ein Klick genuegt im Normalfall',
  (await page.inputValue('#agdStatus')) === 'anwesend');
check('Schublade hat ein eigenes Feld fuer den Pausenbeginn',
  await page.isVisible('[data-zeitwahl-fuer="agdPauseVon"]'));
check('Beide Bezahlt-Kennzeichnungen stehen zur Wahl',
  await page.isVisible('#agdBezMa') && await page.isVisible('#agdBezKunde'));
check('KRITISCH: keine davon ist vorbelegt -- GAV-AUS-004 ist offen',
  await page.evaluate(() => !document.getElementById('agdBezMa').checked
    && !document.getElementById('agdBezKunde').checked));
check('Ungeklaerter Zustand wird benannt, statt als "nein" zu erscheinen',
  (await page.textContent('#drBody')).includes('noch nicht festgestellt'));
await page.selectOption('#agdStatus', 'abwesend');
await page.waitForTimeout(200);
check('Abwesend: keine Ist-Zeiten', !(await page.isVisible('#agdVon')));
await page.selectOption('#agdStatus', 'anwesend');
await page.waitForTimeout(200);
rufe = [];
await page.fill('#agdBemerkung', 'kam eine Viertelstunde spaeter');
await zeitSetzen(page, '#agdVon', '22:15');
await page.click('#drFoot .btn-primary');
await page.waitForTimeout(500);
const e = rufe.find(r => r.p.includes('einsatz_abgleich'));
check('Einzelabgleich schickt genau eine Zeile', e && e.body.zeilen.length === 1);
check('Bemerkung wird uebergeben', e && e.body.zeilen[0].ist_bemerkung.includes('Viertelstunde'));
check('Schublade schliesst', !(await page.evaluate(() => document.getElementById('drawer').classList.contains('on'))));
await page.screenshot({ path: `${OUT}/ag-02-schublade.png` });

// ══════════════════════════════════════════ SCHUBLADE EINER GESPERRTEN ZEILE
await page.selectOption('#agStatusFilter', '');
await page.waitForTimeout(300);
await page.click('#agTable tbody tr.zu:first-child .stift');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(300);
const gz = await page.textContent('#drBody');
check('Die Schublade sagt, dass die Zeile festgeschrieben ist', gz.includes('festgeschrieben'));
check('KRITISCH: Kein Speichern-Knopf, solange die Sperre steht',
  !(await page.isVisible('#drFoot .btn-primary')));
check('KRITISCH: Die Felder der Schublade sind gesperrt',
  await page.evaluate(() => ['agdStatus', 'agdVon', 'agdBis', 'agdPause', 'agdBemerkung']
    .every(id => document.getElementById(id).disabled)));
check('Die Schublade nennt auch die Planungssperre', gz.includes('auch in der Planung nicht'));
rufe = [];
await page.click('.zu-zone button');
await page.waitForTimeout(300);
check('KRITISCH: Aufheben in der Schublade fragt zurueck', await page.isVisible('#dlgConfirm.on'));
await page.click('#cfBtn');
await page.waitForTimeout(400);
check('Nach der Bestaetigung ist die Zeile bearbeitbar',
  await page.isVisible('#drFoot .btn-primary')
  && !(await page.evaluate(() => document.getElementById('agdVon').disabled)));
check('KRITISCH: das Aufheben allein speichert nichts',
  !rufe.some(r => r.p.includes('einsatz_abgleich')));
await page.click('#drFoot .btn-plain');
await page.waitForTimeout(200);

// ══════════════════════════════════════════ PAUSENHINWEIS IN DER SCHUBLADE
await page.selectOption('#agStatusFilter', '');
await page.waitForTimeout(250);
await page.fill('#agQ', 'Colak');
await page.waitForTimeout(250);
await page.click('#agTable tbody tr:first-child .stift');
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(300);
// ── Rueckfall-Pruefung zum gemeldeten Fehler ────────────────────────────
// Gemeldet: "wenn ich die Schicht anpasse und der MA die Pause bezahlt ist,
// darf die Pausendauer nicht verschwinden auf der Hauptseite". Ursache war,
// dass die Schublade nur den GESPEICHERTEN Wert las -- weder den Vorschlag
// noch das in der Zeile Getippte. Speichern schrieb diese Leere zurueck.
check('KRITISCH: die Schublade uebernimmt die vorgeschlagene Pause aus der Zeile',
  (await page.inputValue('#agdPause')) === '60');
check('Auch die Zeiten kommen aus der Zeile, nicht aus dem Nichts',
  (await page.inputValue('#agdVon')) === '07:30' && (await page.inputValue('#agdBis')) === '17:30');
const gav = await page.textContent('#agdPauseGav');
check('KRITISCH: die Schublade nennt Artikel und Sollwert woertlich',
  gav.includes('Art. 13 Ziff. 1') && gav.includes('60'));
check('Sie benennt die offene Auslegungsfrage statt Einhaltung zu behaupten',
  gav.includes('GAV-AUS-007') && gav.includes('kein'));
rufe = [];
await page.fill('#agdPause', '10');
await page.waitForTimeout(200);
check('Zu kurze Pause wird in der Schublade angemahnt',
  (await page.textContent('#agdPauseGav')).includes('liegt darunter'));
check('Die Schublade zeigt die Nettofolge, bevor gespeichert wird',
  (await page.textContent('#agdPauseGav')).includes('Netto daraus'));
await page.check('#agdBezMa');
await page.waitForTimeout(200);
check('KRITISCH: das Haken "bezahlt" veraendert die angezeigte Nettozeit sofort',
  (await page.textContent('#agdPauseGav')).includes('bleiben drin'));
await page.uncheck('#agdBezMa');
await page.waitForTimeout(200);
check('Wieder abgehakt: die Pause wird wieder abgezogen',
  (await page.textContent('#agdPauseGav')).includes('abgezogen'));
check('KRITISCH: die Mahnung speichert nichts', !rufe.some(r => r.p.includes('einsatz_abgleich')));
check('Speichern bleibt trotz zu kurzer Pause moeglich -- der Abgleich beschoenigt nicht',
  await page.isEnabled('#drFoot .btn-primary'));
await page.check('#agdBezMa');
await zeitSetzen(page, '#agdPauseVon', '12:00');
rufe = [];
await page.click('#drFoot .btn-primary');
await page.waitForTimeout(500);
const bez = rufe.find(r => r.p.includes('einsatz_abgleich'));
check('Bezahlte MA-Pause wird als bewusste Feststellung uebergeben',
  bez && bez.body.zeilen[0].ist_pause_bezahlt_ma === 1);
check('Nicht angehakte Kunden-Pause geht als ausdrueckliches Nein mit, nicht als Leerwert',
  bez && bez.body.zeilen[0].ist_pause_bezahlt_kunde === 0);
check('Pausenbeginn wird gespeichert', bez && bez.body.zeilen[0].ist_pause_von === '12:00');
check('KRITISCH: die Pausendauer wird mitgespeichert und geht nicht verloren',
  bez && String(bez.body.zeilen[0].ist_pause_min) === '10');
await page.waitForTimeout(400);
check('KRITISCH: nach dem Speichern steht die Pausendauer weiterhin in der Hauptseite',
  (await page.inputValue('#agTable tbody tr:first-child [data-ag="pause"]')) === '10');
check('Und der Pausenbeginn ebenfalls',
  (await page.inputValue('#agTable tbody tr:first-child [data-ag="pausevon"]')) === '12:00');
// Die Zeile wurde mit angehakter MA-Pause gespeichert -> 10 Min. bleiben drin.
check('KRITISCH: bezahlte Pause schlaegt in der Hauptseite auf Netto durch',
  (await page.textContent('#agTable tbody tr:first-child td:nth-child(8)')).trim() === '10:00');
check('Und die Zelle zeigt, dass hier bewusst nichts abgezogen wurde',
  await page.evaluate(() => {
    const td = document.querySelector('#agTable tbody tr:first-child td:nth-child(8)');
    return td.classList.contains('netto-voll') && td.title.includes('Art. 13 Ziff. 2');
  }));
await page.fill('#agQ', '');
await page.waitForTimeout(250);

// ══════════════════════════════════════════ FILTER UND SUCHE
await page.selectOption('#agStatusFilter', '');
await page.waitForTimeout(250);
await page.fill('#agQ', 'bea');
await page.waitForTimeout(250);
check('Suche findet ueber den Namen', (await page.$$('#agTable tbody tr')).length === 1);
await page.fill('#agQ', '2518');
await page.waitForTimeout(250);
check('Suche findet ueber die Personalnummer', (await page.$$('#agTable tbody tr')).length === 1);
await page.fill('#agQ', '');
await page.selectOption('#agSparte', 'reinigung');
await page.waitForTimeout(250);
check('Sparten-Filter greift', (await page.textContent('#agTable')).includes('Ort B')
  && !(await page.textContent('#agTable')).includes('Anna'));
await page.selectOption('#agSparte', '');
await page.waitForTimeout(250);

// ══════════════════════════════════════════ MOBIL
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => go('abgleich'));
await page.waitForTimeout(300);
const m = await page.evaluate(() => ({
  s: document.documentElement.scrollWidth, i: document.documentElement.clientWidth }));
check('Kein Seiten-Scroll bei 390px', m.s <= m.i + 1);
await page.screenshot({ path: `${OUT}/ag-03-mobil.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
