// Eigener Mikrofonknopf im Diktat (ENT-027). Geprueft wird gegen eine
// nachgebaute Spracherkennung -- ein echtes Mikrofon gibt es hier nicht,
// das Verhalten drumherum laesst sich aber vollstaendig pruefen.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const STUB = (pegel) => `
window.__ereignisse = [];
window.SpeechRecognition = function () {
  const self = this;
  window.__sr = this;
  this.lang = ''; this.continuous = false; this.interimResults = false;
  this.start = function () { window.__ereignisse.push('start'); };
  this.stop  = function () { window.__ereignisse.push('stop'); };
};
// Ergebnisse und Fehler von aussen ausloesen
window.__sage = function (text, endgueltig) {
  window.__sr.onresult({ resultIndex: 0, results: Object.assign(
    [[{ transcript: text }]].map(r => Object.assign(r, { isFinal: !!endgueltig })),
    { length: 1 }) });
};
window.__fehler = function (art) { window.__sr.onerror({ error: art }); };
window.__ende = function () { if (window.__sr.onend) window.__sr.onend(); };

// Tonquelle nachbauen, damit die Pegelanzeige pruefbar wird
const PEGEL = ${pegel};
navigator.mediaDevices = navigator.mediaDevices || {};
navigator.mediaDevices.getUserMedia = () => Promise.resolve({
  getTracks: () => [{ stop() { window.__ereignisse.push('spur-aus'); } }],
});
window.AudioContext = function () {
  this.createAnalyser = () => ({
    fftSize: 64, smoothingTimeConstant: 0, frequencyBinCount: 32,
    getByteFrequencyData: a => { for (let i = 0; i < a.length; i++) a[i] = PEGEL; },
    connect() {},
  });
  this.createMediaStreamSource = () => ({ connect() {} });
  this.close = () => { window.__ereignisse.push('ctx-zu'); };
};
`;

async function sitzung(pegel, ohneSprache) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(ohneSprache
    ? 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition;'
    : STUB(pegel));
  await page.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'a', ist_admin: true });
    if (u.includes('objektplan')) return send({ status: 'ok',
      objekt: { id: 1, name: 'Muster Center', kunde_name: 'Beispiel AG', ort: '4601 Olten', kanton: 'SO', einsatzart: 'Revierdienst' },
      vorlagen: [{ id: 1, name: 'Schliessrunde', kuerzel: 'SR', art: 'arbeit', von: '22:00', bis: '22:30',
        arbeitszeit_h: 0.5, auf_abruf: 0, farbe: null, gueltig_ab: '2026-01-01', gueltig_bis: null }],
      bedarf: [], einsaetze: [], feiertage: {} });
    if (u.includes('objekt_list')) return send({ status: 'ok', objekte: [
      { id: 1, name: 'Muster Center', kunde_name: 'Beispiel AG', ort: '4601 Olten', kanton: 'SO', aktiv: 1 }] });
    if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: [
      { id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'Muster', aktiv: 1, ist_admin: 1 }] });
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], feiertage: [], gepflegt: {},
      kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(350);
  return { browser, page };
}

// ══════════════ MIT SPRACHERKENNUNG
let { browser, page } = await sitzung(160, false);
await page.evaluate(() => go('planung')); await page.waitForTimeout(200);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(600);
await page.evaluate(() => planDiktat('masterplan'));
await page.waitForTimeout(300);

check('Der Sprechen-Knopf ist da', await page.isVisible('#pdMik'));
check('Der Knopf heisst „Sprechen"', (await page.textContent('#pdMik')).includes('Sprechen'));
check('Die Pegelanzeige hat Balken',
  await page.evaluate(() => document.querySelectorAll('#pdViz i').length === 22));
check('Die Balken sind vor der Aufnahme unsichtbar',
  await page.evaluate(() => !$('pdViz').classList.contains('an')));
check('Es steht ein Hinweis da', (await page.textContent('#pdSprachHint')).length > 20);
check('Es wird gesagt, wo die Erkennung stattfindet',
  (await page.textContent('#pdSprachHint')).includes('übernimmt der Browser'));
check('Das Feld erwähnt Sprechen',
  (await page.getAttribute('#pdText2', 'placeholder')).includes('Sprechen'));

// ── Aufnahme starten
await page.click('#pdMik');
await page.waitForTimeout(400);
check('Die Erkennung wird gestartet',
  await page.evaluate(() => window.__ereignisse.includes('start')));
check('Der Knopf zeigt die laufende Aufnahme',
  await page.evaluate(() => $('pdMik').classList.contains('laeuft')));
check('Der Knopf bietet das Beenden an', (await page.textContent('#pdMik')).includes('beenden'));
check('Die Pegelanzeige ist sichtbar',
  await page.evaluate(() => $('pdViz').classList.contains('an')));
check('Der Hinweis sagt, dass es läuft', (await page.textContent('#pdSprachHint')).includes('läuft'));
check('Die Sprache ist Schweizerdeutsch eingestellt',
  await page.evaluate(() => window.__sr.lang === 'de-CH'));
check('Es wird fortlaufend erkannt',
  await page.evaluate(() => window.__sr.continuous === true && window.__sr.interimResults === true));

// ── Pegel schlägt aus
await page.waitForTimeout(500);
const hoehen = await page.evaluate(() =>
  [...document.querySelectorAll('#pdViz i')].map(i => parseInt(i.style.height, 10) || 0));
check('Die Balken schlagen beim Pegel aus', Math.max(...hoehen) > 6);
check('Die Balken sind in der Mitte höher',
  hoehen[Math.floor(hoehen.length / 2)] > hoehen[0]);
check('Kein „still"-Zustand bei Pegel',
  await page.evaluate(() => !$('pdViz').classList.contains('still')));
await page.screenshot({ path: OUT + '/60-aufnahme.png' });

// ── Text kommt an
await page.evaluate(() => window.__sage('Setze die Schliessrunde', false));
await page.waitForTimeout(150);
check('Vorläufiger Text erscheint sofort',
  (await page.inputValue('#pdText2')) === 'Setze die Schliessrunde');
await page.evaluate(() => window.__sage('Setze die Schliessrunde jeden Tag', true));
await page.waitForTimeout(150);
check('Endgültiger Text bleibt stehen',
  (await page.inputValue('#pdText2')) === 'Setze die Schliessrunde jeden Tag');
await page.evaluate(() => window.__sage(' auf den ganzen Monat', true));
await page.waitForTimeout(150);
check('Weiterer Satz wird angehängt',
  (await page.inputValue('#pdText2')).includes('jeden Tag') &&
  (await page.inputValue('#pdText2')).includes('ganzen Monat'));

// ── Safari beendet von selbst: es muss weiterlaufen
const vorher = await page.evaluate(() => window.__ereignisse.filter(x => x === 'start').length);
await page.evaluate(() => window.__ende());
await page.waitForTimeout(200);
check('Ein Abbruch von selbst startet neu',
  await page.evaluate(v => window.__ereignisse.filter(x => x === 'start').length > v, vorher));
check('Der Knopf bleibt dabei rot',
  await page.evaluate(() => $('pdMik').classList.contains('laeuft')));

// ── Beenden
await page.click('#pdMik');
await page.waitForTimeout(300);
check('Die Erkennung wird beendet',
  await page.evaluate(() => window.__ereignisse.includes('stop')));
check('Der Knopf ist wieder normal',
  await page.evaluate(() => !$('pdMik').classList.contains('laeuft')));
check('Der Knopf heisst wieder „Sprechen"', (await page.textContent('#pdMik')).includes('Sprechen'));
check('Das Mikrofon wird freigegeben',
  await page.evaluate(() => window.__ereignisse.includes('spur-aus')));
check('Der Tonkanal wird geschlossen',
  await page.evaluate(() => window.__ereignisse.includes('ctx-zu')));
check('Der Hinweis nennt den nächsten Schritt',
  (await page.textContent('#pdSprachHint')).includes('Erkennen'));
check('Der Text bleibt erhalten', (await page.inputValue('#pdText2')).includes('jeden Tag'));

// ── Vorhandener Text geht nicht verloren
await page.fill('#pdText2', 'Bereits getippt.');
await page.click('#pdMik');
await page.waitForTimeout(300);
await page.evaluate(() => window.__sage('Und diktiert.', true));
await page.waitForTimeout(150);
check('Getippter Text bleibt beim Diktieren stehen',
  (await page.inputValue('#pdText2')) === 'Bereits getippt. Und diktiert.');
await page.click('#pdMik');
await page.waitForTimeout(200);

// ── Fehler werden benannt
await page.click('#pdMik');
await page.waitForTimeout(300);
await page.evaluate(() => window.__fehler('not-allowed'));
await page.waitForTimeout(250);
const fehlerTxt = await page.textContent('#pdSprachHint');
check('Verweigerter Zugriff wird erklärt', fehlerTxt.includes('verweigert'));
check('Der Weg zur Behebung steht dabei', fehlerTxt.includes('erlauben'));
check('Die Aufnahme wird dabei beendet',
  await page.evaluate(() => !$('pdMik').classList.contains('laeuft')));
await page.click('#pdMik');
await page.waitForTimeout(300);
await page.evaluate(() => window.__fehler('no-speech'));
await page.waitForTimeout(250);
check('„Nichts gehört" wird eigens gemeldet',
  (await page.textContent('#pdSprachHint')).includes('Nichts gehört'));

// ── Fenster schliessen beendet die Aufnahme
await page.click('#pdMik');
await page.waitForTimeout(300);
const stopsVorher = await page.evaluate(() => window.__ereignisse.filter(x => x === 'stop').length);
await page.evaluate(() => closeDlg('dlgPlanDiktat'));
await page.waitForTimeout(300);
check('Das Schliessen beendet die Aufnahme',
  await page.evaluate(v => window.__ereignisse.filter(x => x === 'stop').length > v, stopsVorher));
check('Das Mikrofon wird beim Schliessen freigegeben',
  await page.evaluate(() => window.__ereignisse.filter(x => x === 'spur-aus').length > 1));

// ── Auch im globalen Sprechen-Dialog (ersetzt seit ENT-042 die frueheren
// einzelnen Diktat-Dialoge für Personal und Kunden)
await page.evaluate(() => go('mitarbeiter')); await page.waitForTimeout(300);
await page.click('#btnSprechen'); await page.waitForTimeout(300);
check('Auch der globale Sprechen-Dialog hat den Knopf', await page.isVisible('#gsMik'));
check('Auch dort gibt es die Pegelanzeige',
  await page.evaluate(() => document.querySelectorAll('#gsViz i').length === 22));
await page.click('#gsMik');
await page.waitForTimeout(300);
await page.evaluate(() => window.__sage('Neuer Mitarbeiter Hans Muster', true));
await page.waitForTimeout(150);
check('Der Text landet im richtigen Feld',
  (await page.inputValue('#gsText')) === 'Neuer Mitarbeiter Hans Muster');
check('Das Planungsfeld bleibt unberührt', (await page.inputValue('#pdText2')).includes('Bereits getippt'));
await page.evaluate(() => closeDlg('dlgSprechen'));
await page.waitForTimeout(200);

// ── Mobil
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => go('planung')); await page.waitForTimeout(200);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(500);
await page.evaluate(() => planDiktat('masterplan'));
await page.waitForTimeout(400);
const mob = await page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  hoehe: Math.round($('pdMik').getBoundingClientRect().height),
}));
check('Das Diktatfenster schiebt die Seite nicht @390', mob.scroll <= 1);
check('Der Knopf ist mit dem Daumen bedienbar', mob.hoehe >= 42);
await page.screenshot({ path: OUT + '/61-aufnahme-mobil.png' });
await browser.close();

// ══════════════ STILLES MIKROFON
({ browser, page } = await sitzung(0, false));
await page.evaluate(() => go('planung')); await page.waitForTimeout(200);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(600);
await page.evaluate(() => planDiktat('masterplan'));
await page.waitForTimeout(250);
await page.click('#pdMik');
await page.waitForTimeout(2200);
check('Ein stilles Mikrofon wird als still gezeigt',
  await page.evaluate(() => $('pdViz').classList.contains('still')));
check('Ein stilles Mikrofon wird auch benannt',
  (await page.textContent('#pdSprachHint')).includes('kein Signal'));
check('Die Balken bleiben dabei flach',
  await page.evaluate(() => [...document.querySelectorAll('#pdViz i')]
    .every(i => (parseInt(i.style.height, 10) || 0) <= 4)));
await browser.close();

// ══════════════ OHNE SPRACHERKENNUNG IM BROWSER
({ browser, page } = await sitzung(0, true));
await page.evaluate(() => go('planung')); await page.waitForTimeout(200);
await page.evaluate(() => goTab('objektplan')); await page.waitForTimeout(600);
await page.evaluate(() => planDiktat('masterplan'));
await page.waitForTimeout(250);
check('Ohne Unterstützung ist kein Knopf da', !(await page.isVisible('#pdMik')));
const ohne = await page.textContent('#pdSprachHint');
check('Es wird gesagt, dass der Browser es nicht kann', ohne.includes('kann nicht direkt aufnehmen'));
check('Der alte Weg wird genannt', ohne.includes('Mikrofon der Tastatur'));
check('Tippen und Erkennen geht trotzdem',
  await page.evaluate(() => !!$('pdText2') && !$('pdBtn').disabled));
await browser.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
