// Assistent (ENT-699, nur Testumgebung).
//
// Geprueft wird, was der Assistent AUSSAGT, nicht wie er es formuliert:
//  - er erscheint nur ausserhalb von Produktion und Demo;
//  - die Werkzeuge rechnen mit denselben Regeln wie das Cockpit (abgelehnte
//    Zusage besetzt nicht, abgesagter Einsatz zaehlt nicht, Ueberfaelligkeit
//    aus reFaelligTage, Konflikte aus konflikte());
//  - "kein Recht", "nicht geladen" und "nichts gefunden" kommen beim Modell
//    als drei verschiedene Ergebnisse an;
//  - Einsaetze und offene Plaetze bleiben getrennte Zahlen;
//  - die Figur laesst sich verschieben, stummschalten und schliessen --
//    gemessen am gerenderten Zustand.
//
// Das Modell selbst ist hier ein Drehbuch: Es ruft ein vorgegebenes Werkzeug
// auf und antwortet danach. Geprueft wird, was der Browser daraus macht.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const MA = [
  { id: 1, name: 'hmuster', vorname: 'Hans', nachname: 'Muster', aktiv: 1, ist_admin: 1 },
  { id: 2, name: 'abeispiel', vorname: 'Anna', nachname: 'Beispiel', aktiv: 1 },
  { id: 3, name: 'ptest', vorname: 'Peter', nachname: 'Test', aktiv: 1 },
  { id: 4, name: 'lprobe', vorname: 'Lea', nachname: 'Probe', aktiv: 1 },
  { id: 5, name: 'amuster', vorname: 'Alt', nachname: 'Muster', aktiv: 0 },
];
// Einsatz 11: Bedarf 2, eine Zusage, eine Absage -> 1 Platz offen.
// Einsatz 12: voll. Einsatz 13: abgesagt (zaehlt nicht). Einsatz 14: ausserhalb.
// Einsatz 15: Bedarf 3, niemand -> 3 offen. Zusammen: 2 Einsaetze, 4 Plaetze.
const EI = [
  { id: 11, datum: tag(2), von: '18:00:00', bis: '23:00:00', bedarf: 2, status: 'geplant', kunde_name: 'Beispiel AG', titel: 'Verkehrsdienst',
    mitarbeiter: [{ id: 1, name: 'hmuster', zusage: 'zugesagt' }, { id: 2, name: 'abeispiel', zusage: 'abgelehnt' }] },
  { id: 12, datum: tag(3), von: '07:00:00', bis: '16:00:00', bedarf: 1, status: 'geplant', kunde_name: 'Muster GmbH', titel: 'Objektschutz',
    mitarbeiter: [{ id: 3, name: 'ptest', zusage: 'offen' }] },
  { id: 13, datum: tag(3), von: '07:00:00', bis: '16:00:00', bedarf: 3, status: 'abgesagt', kunde_name: 'Beispiel AG', titel: 'Abgesagt', mitarbeiter: [] },
  { id: 14, datum: tag(40), von: '07:00:00', bis: '16:00:00', bedarf: 5, status: 'geplant', kunde_name: 'Beispiel AG', titel: 'Spaeter', mitarbeiter: [] },
  { id: 15, datum: tag(4), von: '20:00:00', bis: '06:00:00', bedarf: 3, status: 'geplant', kunde_name: 'Muster GmbH', titel: 'Nachtwache', mitarbeiter: [] },
  // Vergangen (offene Enden, ENT-709): 16 noch nicht abgeglichen -- das alte
  // abgeglichen_am stammt von einem aufgehobenen Abgleich, massgeblich ist
  // der Ist-Status wie im Server; 17 abgeglichen; 18 abgelehnt (zaehlt nicht).
  { id: 16, datum: tag(-2), von: '07:00:00', bis: '12:00:00', bedarf: 1, status: 'geplant', kunde_name: 'Beispiel AG', titel: 'Frueh',
    mitarbeiter: [{ id: 3, name: 'ptest', zusage: 'zugesagt', ist_status: 'offen', abgeglichen_am: tag(-1) + ' 09:00:00' }] },
  { id: 17, datum: tag(-3), von: '07:00:00', bis: '12:00:00', bedarf: 1, status: 'geplant', kunde_name: 'Beispiel AG', titel: 'Erledigt',
    mitarbeiter: [{ id: 4, name: 'lprobe', zusage: 'zugesagt', ist_status: 'anwesend', abgeglichen_am: tag(-1) + ' 08:00:00' }] },
  { id: 18, datum: tag(-3), von: '13:00:00', bis: '17:00:00', bedarf: 1, status: 'geplant', kunde_name: 'Muster GmbH', titel: 'Abgelehnt',
    mitarbeiter: [{ id: 2, name: 'abeispiel', zusage: 'abgelehnt', abgeglichen_am: null }] },
];
const OFFERTEN = [
  { id: 21, art: 'offerte', nummer: 'OF-1', kunde_name: 'Beispiel AG', titel: 'Umzug', status: 'bestaetigt', total_rappen: 150000, aktiv: 1,
    entscheidung_am: tag(-1) + ' 10:00:00', entscheidung_gesehen_am: null },
  { id: 22, art: 'offerte', nummer: 'OF-2', kunde_name: 'Muster GmbH', titel: 'Fest', status: 'abgelehnt', total_rappen: 90000, aktiv: 1,
    entscheidung_am: tag(-5) + ' 09:00:00', entscheidung_gesehen_am: tag(-4) + ' 08:00:00' },
  { id: 23, art: 'offerte', nummer: 'OF-3', kunde_name: 'Beispiel AG', titel: 'Intern', status: 'bestaetigt', total_rappen: 50000, aktiv: 1,
    entscheidung_am: null, entscheidung_gesehen_am: null },
  // Offene Enden (ENT-709): ein Entwurf, zwei versendete ohne Entscheid (eine
  // davon abgelaufen), eine archivierte (zaehlt nicht).
  { id: 24, art: 'offerte', nummer: 'OF-4', kunde_name: 'Muster GmbH', status: 'entwurf', total_rappen: 10000, aktiv: 1, datum: tag(-1),
    entscheidung_am: null, entscheidung_gesehen_am: null },
  { id: 25, art: 'offerte', nummer: 'OF-5', kunde_name: 'Beispiel AG', status: 'versendet', total_rappen: 10000, aktiv: 1, datum: tag(-20),
    gueltig_bis: tag(-2), entscheidung_am: null, entscheidung_gesehen_am: null },
  { id: 26, art: 'offerte', nummer: 'OF-6', kunde_name: 'Muster GmbH', status: 'angeschaut', total_rappen: 10000, aktiv: 1, datum: tag(-3),
    gueltig_bis: tag(20), entscheidung_am: null, entscheidung_gesehen_am: null },
  { id: 27, art: 'offerte', nummer: 'OF-7', kunde_name: 'Muster GmbH', status: 'versendet', total_rappen: 10000, aktiv: 0, datum: tag(-9),
    entscheidung_am: null, entscheidung_gesehen_am: null },
];
const RECHNUNGEN = [
  { id: 31, art: 'rechnung', nummer: 'RE-1', kunde_name: 'Beispiel AG', status: 'versendet', bezahlt: 0, faellig_bis: tag(-3), total_rappen: 120000, aktiv: 1 },
  { id: 32, art: 'rechnung', nummer: 'RE-2', kunde_name: 'Muster GmbH', status: 'versendet', bezahlt: 0, faellig_bis: tag(10), total_rappen: 80000, aktiv: 1 },
  { id: 33, art: 'rechnung', nummer: 'RE-3', kunde_name: 'Muster GmbH', status: 'versendet', bezahlt: 1, faellig_bis: tag(-20), total_rappen: 70000, aktiv: 1 },
  { id: 34, art: 'rechnung', nummer: 'RE-4', kunde_name: 'Beispiel AG', status: 'entwurf', bezahlt: 0, faellig_bis: null, total_rappen: 10000, aktiv: 1 },
];

// Drehbuch des Modells: Auf eine Frage ruft es `aufruf` auf, auf das
// Ergebnis antwortet es mit `antwort`. Was es zurueckbekam, wird gemerkt.
// Der Server fuer das Sprachmodell (ENT-703): erst der Stand, dann die Datei.
// staende: Folge der Antworten auf ?stand=1 (die letzte bleibt stehen).
// Seit dem Nachtrag zu ENT-703 in Teilen (?teil=N); `stoer(n)` darf einen
// Teil scheitern lassen: [status, body] oder 'haengt'.
const MODELL = Buffer.alloc(1200000, 7); MODELL[0] = 0x1f; MODELL[1] = 0x8b;
const TEIL = 300000;
let modellServer = { staende: [{ phase: 'fertig' }], datei: [200, MODELL], posts: 0, teile: [], stoer: null };
// Seit der Zwischenspeicher auch unter file:// greift, beginnt jeder Fall zum
// Server mit leerer Ablage (ablageLeeren).
const ablageLeeren = () => page.evaluate(() => caches.delete('guardops-weckwort'));
const modellNeu = (staende, datei, stoer) => { modellServer = { staende, datei: datei || [200, MODELL], posts: 0, teile: [], stoer: stoer || null }; };
let drehbuch = null, belegeGesperrt = false, abwesenheitGesperrt = true, assistentAntwort = null, routerAntwort = null;
const rufe = [];
// Katalog und Kunden fuer die Formular-Werkzeuge (ENT-700). Die Antwort der
// Spracheingabe kommt aus der echten Auswertung des Servers.
const KU = [{ id: 7, name: 'Beispiel AG', aktiv: 1 }, { id: 9, name: 'Muster GmbH', aktiv: 1 }];
const PR = [
  { id: 3, name: 'Verkehrsdienst', beschreibung: '', einzelpreis_rappen: 8500, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 1, aktiv: 1 },
  { id: 4, name: 'Objektschutz', beschreibung: '', einzelpreis_rappen: 7200, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 2, aktiv: 1 },
];
const routerAus = (key, modell) => JSON.parse(execFileSync('php', ['-r',
  `require '${WURZEL}/backend/ai.php'; [$c, $a] = ki_felder_auswerten($argv[1], json_decode($argv[2], true), json_decode($argv[3], true)); echo json_encode([$c, $a]);`,
  key, JSON.stringify(modell), JSON.stringify({ kunden: KU, produkte: PR.map(p => ({ id: p.id, name: p.name, einheit: p.einheit })), mitarbeiter: MA })]).toString());
const zurueck = [];
const umgebung = { wert: '__APP_ENV__' };

const browser = await chromium.launch({ executablePath: EXE });
async function neueSeite() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(() => {
    // Die Stimme des Browsers wird mitgeschrieben statt abgespielt.
    window.__gesprochen = [];
    const synth = { speak: u => { window.__gesprochen.push(u.text); if (u.onstart) u.onstart(); setTimeout(() => u.onend && u.onend(), 30); },
      cancel: () => {}, getVoices: () => [{ lang: 'de-CH', name: 'Test' }] };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    // Weckwort (ENT-702): Vosk, Mikrofon und Ton als Attrappen. Echte
    // Erkennung laesst sich hier nicht pruefen -- geprueft wird, was die
    // Seite mit einem erkannten Wort macht, und dass ohne Einschalten nichts
    // zuhoert.
    // Jeder Erkenner wird gemerkt: der fuer das Weckwort (mit Wortliste) und
    // der fuer die Frage (ohne, ENT-703).
    window.__vosk = { modelle: 0, grammatik: null, erkenner: [], mikro: 0, gestoppt: 0, modellAdresse: null };
    // Wie vosk-browser: new Model(adresse) meldet 'load' oder 'error' als
    // Ereignis. __voskModus: 'ok', 'haengt' oder 'fehler'. Beim Laden legt die
    // Attrappe wie Vosk einen Eintrag unter /vosk/<Adresse> in IndexedDB ab.
    window.__voskModus = 'ok';
    window.Vosk = { Model: function (adresse) {
      window.__vosk.modelle++; window.__vosk.modellAdresse = adresse;
      const hoerer = {};
      this.on = (ev, fn) => { hoerer[ev] = fn; };
      this.terminate = () => { window.__vosk.beendet = (window.__vosk.beendet || 0) + 1; };
      const modus = window.__voskModus;
      if (modus === 'fehler') { setTimeout(() => hoerer.error && hoerer.error({ event: 'error', error: 'Failed to sync file system' }), 20); }
      else if (modus === 'ok') {
        const pfad = '/vosk/' + adresse.replace(/[\W]/g, '_');
        const r = indexedDB.open('/vosk', 21);
        r.onupgradeneeded = () => { r.result.createObjectStore('FILE_DATA'); };
        r.onsuccess = () => { const db = r.result; const tx = db.transaction('FILE_DATA', 'readwrite');
          tx.objectStore('FILE_DATA').put({}, pfad); tx.objectStore('FILE_DATA').put({}, pfad + '/am');
          tx.oncomplete = () => { db.close(); hoerer.load && hoerer.load({ event: 'load', result: true }); }; };
      }
      this.KaldiRecognizer = function (rate, gram) {
        const e = { gram: gram === undefined ? null : gram, hoerer: {}, weg: false };
        window.__vosk.erkenner.push(e);
        if (window.__vosk.grammatik === null && gram !== undefined) { window.__vosk.grammatik = gram; }
        this.on = (ev, fn) => { e.hoerer[ev] = fn; };
        this.acceptWaveform = () => {}; this.remove = () => { e.weg = true; };
      };
    } };
    // art: 'wort' (Erkenner mit Wortliste) oder 'frage' (ohne); typ: 'result' oder 'partialresult'.
    window.__voskSagt = (text, art = 'wort', typ = 'result') => {
      const e = window.__vosk.erkenner.filter(x => !x.weg && (art === 'wort' ? x.gram !== null : x.gram === null)).pop();
      if (e && e.hoerer[typ]) { e.hoerer[typ]({ result: typ === 'result' ? { text } : { partial: text } }); }
    };
    window.__frageOffen = () => window.__vosk.erkenner.some(x => !x.weg && x.gram === null);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      window.__vosk.mikro++; return { getTracks: () => [{ stop: () => { window.__vosk.gestoppt++; } }] }; } } });
    window.AudioContext = function () {
      this.sampleRate = 48000; this.state = 'running'; this.destination = {};
      this.createScriptProcessor = () => ({ connect() {}, disconnect() {} });
      this.createMediaStreamSource = () => ({ connect() {} });
      this.close = () => {}; this.resume = () => {};
    };
  });
  await page.route('**/testumgebung.js', r => r.fulfill({ contentType: 'text/javascript',
    body: readFileSync(`${WURZEL}/testumgebung.js`, 'utf8').replace(/__APP_ENV__/g, umgebung.wert) }));
  await page.route('**/api/**', route => {
    const req = route.request(), p = req.url().split('/api/')[1];
    rufe.push(p);
    const send = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'hmuster', ist_admin: true });
    if (p.startsWith('ki_assistent')) {
      if (assistentAntwort) return send(assistentAntwort[0], assistentAntwort[1]);
      const body = JSON.parse(req.postData() || '{}');
      const letzte = body.messages[body.messages.length - 1];
      if (typeof letzte.content === 'string') {
        return send({ status: 'ok', stop_reason: 'tool_use', content: [
          { type: 'text', text: 'Ich sehe nach.' },
          { type: 'tool_use', id: 'wz_' + zurueck.length, name: drehbuch.name, input: drehbuch.input }] });
      }
      const r = letzte.content.find(b => b.type === 'tool_result');
      zurueck.push(JSON.parse(r.content));
      return send({ status: 'ok', stop_reason: 'end_turn', content: [{ type: 'text', text: drehbuch.antwort }] });
    }
    if (p.startsWith('assistent_weckwort_modell')) {
      if (req.method() === 'POST') { modellServer.posts++; return send({ status: 'ok' }); }
      if (p.includes('stand=1')) {
        const st = modellServer.staende.length > 1 ? modellServer.staende.shift() : modellServer.staende[0];
        const gr = st.phase === 'fertig' ? { groesse: Buffer.byteLength(modellServer.datei[1]), teil: TEIL } : {};
        return send({ status: 'ok', grund: '', ...gr, ...st });
      }
      const n = Number((p.match(/teil=(\d+)/) || [])[1] ?? -1);
      modellServer.teile.push(n);
      const st = modellServer.stoer && modellServer.stoer(n);
      if (st === 'haengt') return new Promise(() => {});
      if (st) return route.fulfill({ status: st[0], contentType: 'application/json', body: st[1] });
      const [code, body] = modellServer.datei;
      const roh = Buffer.from(body);
      return route.fulfill({ status: code, contentType: 'application/octet-stream', body: roh.subarray(n * TEIL, (n + 1) * TEIL) });
    }
    if (p.startsWith('ki_router_parse')) return routerAntwort ? send(routerAntwort[1], routerAntwort[0]) : send({ status: 'error', message: 'kein Mock' }, 502);
    if (p.startsWith('produkt_list')) return send({ status: 'ok', produkte: PR });
    if (p.startsWith('kunden_list')) return send({ status: 'ok', kunden: KU });
    if (p.startsWith('einsatz_list')) return send({ status: 'ok', einsaetze: EI });
    if (p.startsWith('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA, listen: {} });
    if (p.startsWith('verfuegbarkeit_list')) return send({ status: 'ok', sperren: [{ mitarbeiter_id: 4, datum: tag(2), bemerkung: 'Familienfest' }] });
    if (p.startsWith('abwesenheit_list')) return abwesenheitGesperrt
      ? send({ status: 'error', message: 'Dafür fehlt dir die Berechtigung.' }, 403)
      : send({ status: 'ok', abwesenheiten: [{ id: 1, mitarbeiter_id: 3, typ: 'Ferien', von: tag(1), bis: tag(5), status: 'genehmigt' },
        { id: 2, mitarbeiter_id: 5, typ: 'Ferien', von: tag(20), bis: tag(22), status: 'beantragt' }] });
    if (p.startsWith('beleg_list')) {
      if (belegeGesperrt) return send({ status: 'error', message: 'Dafür fehlt dir die Berechtigung.' }, 403);
      return send({ status: 'ok', belege: p.includes('art=rechnung') ? RECHNUNGEN : OFFERTEN, naechste_nummer: 'X' });
    }
    if (p.startsWith('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0, rapporte_vormonat: 0,
      stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 4, kunden: 2, rapporte_total: 0 },
      verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
    return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {}, sperren: [], kunden: [] });
  });
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'hmuster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);
  return page;
}
const box = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);

// ══════════ NUR AUSSERHALB VON PRODUKTION UND DEMO
for (const env of ['production', 'demo']) {
  umgebung.wert = env;
  const p = await neueSeite();
  check(`KRITISCH: in „${env}" erscheint der Assistent nicht`, !(await p.isVisible('#asWidget')) && !(await p.isVisible('#asDock')));
  await p.close();
}
umgebung.wert = 'staging';
const page = await neueSeite();
// ══════════ RUHEPLATZ IN DER KOPFZEILE (ENT-702)
check('Zu Beginn schläft der Assistent: kleine Figur in der Kopfzeile, keine grosse Figur',
  await page.isVisible('#asDock') && !(await page.isVisible('#asWidget')));
const dk = await box(page, '#asDock'), gl = await box(page, '.glocke-wrap');
check(`Der Ruheplatz ist klein und rund, etwa 40 px (${Math.round(dk.w)}×${Math.round(dk.h)})`, Math.abs(dk.w - 40) <= 1 && Math.abs(dk.h - 40) <= 1);
check('Der Ruheplatz steht direkt links neben der Glocke, auf derselben Höhe (gemessen)',
  dk.r <= gl.x + 1 && gl.x - dk.r <= 24 && Math.abs((dk.y + dk.h / 2) - (gl.y + gl.h / 2)) <= 4);
await page.screenshot({ path: OUT + '/assistent-ruheplatz.png', clip: { x: 700, y: 0, width: 800, height: 70 } });
check('Beim Schlafen hört nichts zu und nichts wird geladen', await page.evaluate(() => window.__vosk.modelle === 0 && window.__vosk.mikro === 0));

// In der Kopfleiste (Projektinhaber) wandert die Glocke neben das Logo --
// der Ruheplatz muss mitwandern, links daneben.
await page.evaluate(() => huelleSetzen('aus', false));
await page.waitForTimeout(250);
const dkK = await box(page, '#asDock'), glK = await box(page, '.glocke-wrap');
check('Kopfleiste: der Ruheplatz wandert mit der Glocke und steht links daneben, auf derselben Höhe (gemessen)',
  await page.evaluate(() => document.getElementById('asDock').parentElement === document.querySelector('.glocke-wrap').parentElement
    && document.getElementById('asDock').nextElementSibling === document.querySelector('.glocke-wrap'))
  && dkK.r <= glK.x + 1 && glK.x - dkK.r <= 24 && Math.abs((dkK.y + dkK.h / 2) - (glK.y + glK.h / 2)) <= 4);
await page.screenshot({ path: OUT + '/assistent-ruheplatz-kopfleiste.png', clip: { x: 900, y: 0, width: 600, height: 90 } });
// Schmale Kopfleiste: neben Glocke und Logo ist kein Platz mehr -- dann
// ruht die Figur eine Zeile tiefer, vorne in der Werkzeugleiste.
await page.setViewportSize({ width: 1000, height: 1000 });
await page.waitForTimeout(250);
check('Schmale Kopfleiste (1000 px): der Ruheplatz steht vorne in der Werkzeugleiste, sichtbar und ganz im Bild',
  await page.evaluate(() => document.getElementById('asDock').parentElement === document.querySelector('.tb-rechts'))
  && await page.isVisible('#asDock') && (await box(page, '#asDock')).r <= 1000);
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(250);
check('Wieder breit: zurück neben die Glocke', await page.evaluate(() => document.getElementById('asDock').nextElementSibling === document.querySelector('.glocke-wrap')));
await page.evaluate(() => huelleSetzen('voll', false));
await page.waitForTimeout(250);

await page.click('#asDock');
await page.waitForTimeout(200);
const leer = () => page.evaluate(() => document.getElementById('asDock').classList.contains('leer'));
check('Ein Klick auf den Ruheplatz weckt ihn: grosse Figur da, Fenster offen, Ruheplatz leer',
  await page.isVisible('#asFigur') && await page.isVisible('#asPanel') && await leer());
const dkWach = await box(page, '#asDock'), glWach = await box(page, '.glocke-wrap');
check('Die Leiste springt beim Wecken nicht: Ruheplatz und Glocke bleiben am Ort (gemessen)',
  Math.abs(dkWach.x - dk.x) <= 1 && Math.abs(glWach.x - gl.x) <= 1);
const f = await box(page, '#asFigur');
check(`Die Figur ist rund 76 px gross (${Math.round(f.w)}×${Math.round(f.h)})`, Math.abs(f.w - 76) <= 1 && Math.abs(f.h - 76) <= 1);
check('Die Figur steht rechts unten, ganz im Bild (gemessen)', f.r <= 1500 && f.b <= 1000 && f.x > 1300 && f.y > 850);
const marke = await page.evaluate(() => {
  const el = [...document.body.querySelectorAll('div')].find(d => d.textContent === 'TESTUMGEBUNG' && getComputedStyle(d).position === 'fixed');
  if (!el) { return null; } const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom };
});
check('Die Figur verdeckt den Aufkleber TESTUMGEBUNG nicht (gemessen)',
  marke !== null && (f.b <= marke.y || f.x >= marke.r || f.r <= marke.x || f.y >= marke.b));
const pn = await box(page, '#asPanel');
check('Das Fenster steht ganz im Bild, über der Figur (gemessen)', pn.x >= 0 && pn.y >= 0 && pn.r <= 1500 && pn.b <= f.y + 1);
await page.click('#asFigur');
await page.waitForTimeout(100);
check('Ein Klick auf die wache Figur klappt das Fenster zu', !(await page.isVisible('#asPanel')));
await page.click('#asFigur');
await page.waitForTimeout(100);
check('Das Fenster sagt, dass Speichern bei der Person bleibt', /Speichern tust du selbst/.test(await page.textContent('#asVerlauf')));

const fragen = async (text, d) => {
  drehbuch = d;
  // Nach einem vorbereiteten Formular ist das Fenster zu -- wie ein Mensch
  // oeffnet der Test es mit einem Klick auf die Figur wieder.
  if (!(await page.isVisible('#asPanel'))) { await page.click('#asFigur'); await page.waitForTimeout(100); }
  await page.fill('#asText', text);
  await page.click('#asBtn');
  await page.waitForFunction(() => !document.getElementById('asBtn').disabled, null, { timeout: 5000 });
  await page.waitForTimeout(80);
  return zurueck[zurueck.length - 1];
};
// Nur der Antworttext, ohne die Trefferliste darunter.
const letzteAntwort = () => page.evaluate(() => { const m = [...document.querySelectorAll('#asVerlauf .as-msg.er')].pop(); return m ? m.firstChild.textContent : ''; });

// ══════════ OFFENE PLAETZE
let r = await fragen('Wo fehlen diese Woche noch Leute?', { name: 'offene_plaetze', input: { von: tag(0), bis: tag(6) }, antwort: 'Zwei Einsätze haben noch vier offene Plätze.' });
check('Offene Plätze: nur Einsätze mit Lücke (11 und 15), nicht der volle, nicht der abgesagte, nicht der spätere',
  r.einsaetze_mit_offenen_plaetzen === 2 && r.posten.length === 2);
check('KRITISCH: eine abgelehnte Zusage besetzt keinen Platz (Einsatz 11: 1 von 2)',
  r.posten.some(x => x.besetzt === 1 && x.offen === 1 && x.bedarf === 2));
check('KRITISCH: Einsätze und offene Plätze sind getrennte Zahlen (2 Einsätze, 4 Plätze)',
  r.einsaetze_mit_offenen_plaetzen === 2 && r.offene_plaetze_gesamt === 4 && r.einsaetze_im_zeitraum === 3);
const treffer = await page.$$eval('#asVerlauf .as-msg.er:last-child .as-treffer button', b => b.map(x => x.textContent));
check('Die Treffer darunter nennen dieselben Einsätze', treffer.length === 2 && treffer.every(t => /(Platz|Plätze) offen/.test(t)));
check('Die Antwort wird vorgelesen', (await page.evaluate(() => window.__gesprochen)).includes('Zwei Einsätze haben noch vier offene Plätze.'));
await page.evaluate(() => { window.__epAuf = null; window.epAuf = id => { window.__epAuf = id; }; });
await page.click('#asVerlauf .as-msg.er:last-child .as-treffer button');
check('Ein Klick auf einen Treffer öffnet den Einsatz', await page.evaluate(() => window.__epAuf === 11));

// ══════════ WER IST VERFUEGBAR
r = await fragen('Wer kann übermorgen von 18 bis 23 Uhr?', { name: 'verfuegbare_mitarbeitende', input: { datum: tag(2), von: '18:00', bis: '23:00' }, antwort: 'Einer ist frei.' });
const inGruppe = (g, n) => (r[g] || []).some(x => x.name.includes(n));
check('KRITISCH: wer zur selben Zeit eingeteilt ist, ist nicht verfügbar (konflikte())', inGruppe('nicht_verfuegbar', 'Muster') && inGruppe('nicht_verfuegbar', 'Hans'));
// Anna hat den Einsatz zur selben Zeit abgelehnt. konflikte() im Cockpit
// zaehlt auch eine abgelehnte Zuteilung als "bereits eingeteilt" -- der
// Assistent sagt dasselbe wie der Zuteil-Dialog, nicht etwas anderes. Ob
// das so bleiben soll, ist eine eigene Frage (als Befund gemeldet).
check('Dieselbe Regel wie der Zuteil-Dialog: auch eine abgelehnte Zuteilung zählt als eingeteilt (Anna)', inGruppe('nicht_verfuegbar', 'Anna'));
check('Ein selbst gesperrter Tag ist eine Einschränkung, keine Absage (Lea)', inGruppe('mit_einschraenkung', 'Lea'));
check('Inaktive Mitarbeitende zählen nicht', !JSON.stringify(r).includes('Alt Muster'));
check('KRITISCH: ohne Recht auf Abwesenheiten steht im Ergebnis, dass sie fehlen -- nicht stillschweigend „verfügbar"',
  /Abwesenheiten.*nicht beruecksichtigt/.test(r.hinweis) && !inGruppe('nicht_verfuegbar', 'Peter'));
check('Ruhezeit-Hinweis: Peter arbeitet am Folgetag um 7 Uhr -- mit Einschränkung, nicht verfügbar',
  inGruppe('mit_einschraenkung', 'Peter') && r.mit_einschraenkung.find(x => x.name.includes('Peter')).gruende.some(g => /Ruhezeit/.test(g)));
abwesenheitGesperrt = false;
r = await fragen('Und jetzt?', { name: 'verfuegbare_mitarbeitende', input: { datum: tag(2), von: '18:00', bis: '23:00' }, antwort: 'Niemand ist ganz frei.' });
check('Mit Recht: bewilligte Ferien machen nicht verfügbar (Peter)', inGruppe('nicht_verfuegbar', 'Peter') && !/nicht beruecksichtigt/.test(r.hinweis));

// ══════════ OFFERTENENTSCHEIDE
r = await fragen('Was haben Kunden entschieden?', { name: 'offerten_entscheide', input: {}, antwort: 'Eine angenommen, eine abgelehnt.' });
check('Entscheide: nur Offerten mit Kundenentscheid am Link (OF-3 ohne Entscheid fehlt)', r.anzahl === 2 && !JSON.stringify(r).includes('OF-3'));
check('Angenommen und abgelehnt getrennt', r.angenommen === 1 && r.abgelehnt === 1);
check('Der Hinweis, dass interne Statuswechsel nicht enthalten sind, geht mit', /Interne Statuswechsel/.test(r.hinweis));
r = await fragen('Was ist neu und ungesehen?', { name: 'offerten_entscheide', input: { nur_ungesehen: true }, antwort: 'Eine.' });
check('Nur ungesehene: OF-1', r.anzahl === 1 && r.posten[0].nummer === 'OF-1');
r = await fragen('Seit vorgestern?', { name: 'offerten_entscheide', input: { seit: tag(-2) }, antwort: 'Eine.' });
check('Seit einem Tag: OF-2 von vor fünf Tagen fällt weg', r.anzahl === 1 && r.posten[0].nummer === 'OF-1');

// ══════════ OFFENE RECHNUNGEN
r = await fragen('Welche Rechnungen sind offen?', { name: 'offene_rechnungen', input: {}, antwort: 'Zwei offen.' });
check('Offen sind versendete, unbezahlte (RE-1, RE-2) -- nicht die bezahlte, nicht der Entwurf', r.anzahl === 2 && !JSON.stringify(r.posten).includes('RE-3') && !JSON.stringify(r.posten).includes('RE-4'));
check('Entwürfe werden gezählt, aber nicht als offen', r.entwuerfe_nicht_versendet === 1);
check('KRITISCH: überfällig nach derselben Regel wie die Rechnungsliste (RE-1, 3 Tage)', r.ueberfaellig === 1 && r.posten[0].stand === '3 Tage überfällig');
r = await fragen('Nur überfällige?', { name: 'offene_rechnungen', input: { nur_ueberfaellig: true }, antwort: 'Eine.' });
check('Nur überfällige: RE-1', r.anzahl === 1 && r.posten[0].nummer === 'RE-1');

// ══════════ FORMULARE VORBEREITEN UND ERGAENZEN (ENT-700)
r = await fragen('Ergänze die Offerte', { name: 'formular_ergaenzen', input: { titel: 'X' }, antwort: 'Es ist nichts offen.' });
check('Ergänzen ohne offenes Formular ergibt einen Fehler, keine erfundene Änderung', !!r.fehler && !r.geaendert);

routerAntwort = routerAus('beleg_neu', { art: 'offerte', kunde_name: 'beispiel ag', positionen: [{ produkt_id: 3, leistung: 'Verkehrsdienst', menge: 16 }] });
r = await fragen('Mach mir eine Offerte für die Beispiel AG über 16 Stunden Verkehrsdienst',
  { name: 'formular_vorbereiten', input: { auftrag: 'Offerte für die Beispiel AG über 16 Stunden Verkehrsdienst' }, antwort: 'Die Offerte ist vorbereitet.' });
const routerRuf = rufe.filter(x => x.startsWith('ki_router_parse')).length;
check('KRITISCH: Anlegen läuft über dieselbe Erkennung wie der Sprechen-Knopf (ki_router_parse)', routerRuf === 1);
check('Die Offerte geht auf', await page.isVisible('#view-offerte.on'));
check('Der Stand des Formulars geht ans Modell: Empfänger aus der Kundenliste, Position mit Katalogpreis',
  r.geoeffnet === true && r.empfaenger.in_kundenliste === true && r.positionen.length === 1 && r.positionen[0].preis_chf === '85.00');
check('... und dass nichts gespeichert ist', r.gespeichert === false);
check('Das Fenster klappt zu, die Figur bleibt', !(await page.isVisible('#asPanel')) && await page.isVisible('#asFigur'));
check('Die Antwort steht als Sprechblase an der Figur', (await page.isVisible('#asBlase')) && (await page.textContent('#asBlase')) === 'Die Offerte ist vorbereitet.');
const bl = await box(page, '#asBlase'), fg = await box(page, '#asFigur');
await page.screenshot({ path: OUT + '/assistent-formular.png' });
check('Die Sprechblase steht über der Figur, ganz im Bild (gemessen)', bl.b <= fg.y + 1 && bl.x >= 0 && bl.y >= 0 && bl.r <= 1500);

r = await fragen('Und noch 4 Stunden Objektschutz und 10 Funkgeräte dazu, die erste Position auf 20 Stunden',
  { name: 'formular_ergaenzen', input: { positionen_hinzu: [{ leistung: 'objektschutz', menge: 4 }, { leistung: 'Funkgeräte', menge: 10 }],
    positionen_menge: [{ nr: 1, menge: 20 }] }, antwort: 'Ergänzt.' });
const pos = await page.evaluate(() => ofPos.map(z => ({ n: z.produkt_name, m: z.menge, p: z.einzelpreis_rappen, ki: z.ki })));
check('Ergänzen: drei Positionen, die erste mit neuer Menge', pos.length === 3 && pos[0].m === 20);
check('KRITISCH: eine Katalogleistung kommt mit Katalogname und Katalogpreis (blau)', pos[1].n === 'Objektschutz' && pos[1].p === 7200 && pos[1].ki === 'katalog');
check('KRITISCH: eine unbekannte Leistung wird Freitext ohne Preis (orange), und das Modell erfährt es',
  pos[2].n === 'Funkgeräte' && !pos[2].p && pos[2].ki === 'offen' && r.hinweise.some(h => /nicht im Leistungskatalog/.test(h)));
check('Das Modell sieht, dass für die Freitextzeile der Preis fehlt', r.noch_offen.some(x => /Preis für „Funkgeräte“/.test(x)));
check('Die neuen Zeilen sind im Formular sichtbar markiert (Farbe gemessen)', await page.evaluate(() => {
  const a = getComputedStyle(document.getElementById('ofp_name1')).borderTopColor, b = getComputedStyle(document.getElementById('ofp_name2')).borderTopColor;
  return a !== b; }));
r = await fragen('Die dritte Position weg', { name: 'formular_ergaenzen', input: { positionen_entfernen: [3] }, antwort: 'Entfernt.' });
check('Eine Position lässt sich entfernen', r.positionen.length === 2);
check('KRITISCH: gespeichert wurde nichts', !rufe.some(x => /beleg_speichern|einsatz_save|kunde_save/.test(x)));

routerAntwort = routerAus('einsatz_neu', { kunde_name: 'Beispiel AG', datum: tag(5), von: '07:00', bis: '16:00', bedarf: 2 });
r = await fragen('Neuer Einsatz für die Beispiel AG', { name: 'formular_vorbereiten', input: { auftrag: 'Neuer Einsatz für die Beispiel AG' }, antwort: 'Vorbereitet.' });
check('Einsatz: das Formular geht auf', r.geoeffnet === true && await page.isVisible('#view-einsatzneu.on'));
check('Einsatz: nachgefragt wird nur, was von den wichtigen Angaben fehlt (hier der Arbeitsort)',
  JSON.stringify(r.nachfragen) === JSON.stringify(['Arbeitsort']));
r = await fragen('bis 18 Uhr und drei Leute', { name: 'formular_ergaenzen', input: { bis: '18:00', bedarf: 3 }, antwort: 'Angepasst.' });
check('Einsatz ergänzen: Bis und Anzahl stehen im Formular und sind blau markiert',
  (await page.inputValue('#enNBis')) === '18:00' && (await page.inputValue('#enNBedarf')) === '3'
  && await page.evaluate(() => document.getElementById('enNBis').classList.contains('ki')));
check('... und die sichtbare Zeitauswahl zeigt es auch', await page.evaluate(() => {
  const el = document.getElementById('enNBis'); return !el.__zw || (el.__zw.std.value === '18' && el.__zw.min.value === '00'); }));
await page.evaluate(() => enNeuAbbrechen());

// Nachfragen (Projektinhaber 2026-09-24): Kunde, Datum, Von/Bis, Arbeitsort,
// Anzahl -- in dieser Reihenfolge. Vorgaben des Formulars zaehlen nicht.
routerAntwort = routerAus('einsatz_neu', { kunde_name: 'Beispiel AG' });
r = await fragen('Lege einen Einsatz für die Beispiel AG an', { name: 'formular_vorbereiten', input: { auftrag: 'Einsatz für die Beispiel AG' }, antwort: 'Vorbereitet.' });
check('KRITISCH: Datum (heute) und Anzahl (1) als blosse Vorgabe gelten als offen, nicht als Angabe',
  JSON.stringify(r.nachfragen) === JSON.stringify(['Datum', 'Von und Bis', 'Arbeitsort', 'Anzahl Mitarbeitende'])
  && /Vorgabe, nicht gesagt/.test(r.felder.datum) && /Vorgabe, nicht gesagt/.test(r.felder.bedarf));
r = await fragen('am Samstag', { name: 'formular_ergaenzen', input: { datum: tag(3) }, antwort: 'Von wann bis wann?' });
check('Nach jeder Antwort rückt die nächste Frage nach (Von und Bis als ein Punkt)',
  JSON.stringify(r.nachfragen) === JSON.stringify(['Von und Bis', 'Arbeitsort', 'Anzahl Mitarbeitende']) && !/Vorgabe/.test(r.felder.datum));
r = await fragen('7 bis 16 Uhr in Musterdorf, eine Person', { name: 'formular_ergaenzen', input: { von: '07:00', bis: '16:00', ort: 'Musterdorf', bedarf: 1 }, antwort: 'Bereit zum Prüfen.' });
check('Eine gesagte „eine Person“ zählt, obwohl sie der Vorgabe gleicht; danach ist nichts mehr nachzufragen',
  Array.isArray(r.nachfragen) && r.nachfragen.length === 0);
r = await fragen('Der Kunde ist Neukunde AG', { name: 'formular_ergaenzen', input: { kunde_name: 'Neukunde AG' }, antwort: 'Eingetragen.' });
check('Einsatz: der Kunde lässt sich im Gespräch nachtragen; ausserhalb der Kundenliste orange, ohne neue Nachfrage',
  (await page.inputValue('#enNKunde_name')) === 'Neukunde AG' && r.geaendert.includes('Kunde')
  && await page.evaluate(() => document.getElementById('enNKunde_name').classList.contains('ki-offen'))
  && r.kunde_in_kundenliste === false && r.nachfragen.length === 0);
r = await fragen('Doch die muster gmbh', { name: 'formular_ergaenzen', input: { kunde_name: 'muster gmbh' }, antwort: 'Eingetragen.' });
check('Ein Kunde aus der Liste wird in seiner Schreibweise übernommen und blau markiert',
  (await page.inputValue('#enNKunde_name')) === 'Muster GmbH' && r.kunde_in_kundenliste === true
  && await page.evaluate(() => { const c = document.getElementById('enNKunde_name').classList; return c.contains('ki') && !c.contains('ki-offen'); }));
await page.evaluate(() => enNeuAbbrechen());

routerAntwort = [403, { status: 'error', grund: 'kein_recht', recht: 'offerten_schreiben', message: 'Für „Offerten“ fehlt dir die Berechtigung.' }];
r = await fragen('Offerte für die Muster GmbH', { name: 'formular_vorbereiten', input: { auftrag: 'Offerte für die Muster GmbH' }, antwort: 'Keine Berechtigung.' });
check('KRITISCH: ohne Recht öffnet sich nichts, und der Grund der Spracheingabe geht unverändert ans Modell',
  r.geoeffnet === false && r.grund === 'kein_recht' && /Berechtigung/.test(r.meldung));
routerAntwort = null;

// ══════════ OFFENE ENDEN (ENT-709)
abwesenheitGesperrt = false;
r = await fragen('Was ist noch offen?', { name: 'offene_enden', input: {}, antwort: 'Einiges.' });
check('Offerten: Entwurf, versendet ohne Entscheid (davon abgelaufen), Entscheid nicht angesehen -- Archiviertes zählt nicht',
  r.offerten.entwuerfe === 1 && r.offerten.versendet_ohne_entscheid === 2 && r.offerten.davon_gueltigkeit_abgelaufen === 1
  && r.offerten.entscheide_nicht_angesehen === 1 && r.offerten.aelteste_ohne_entscheid[0].nummer === 'OF-5');
check('Planung: nächste 14 Tage, offene Plätze und Einsätze getrennt gezählt, Absagen erkannt',
  r.planung.einsaetze_mit_offenen_plaetzen === 2 && r.planung.offene_plaetze === 4 && r.planung.einsaetze_mit_absage === 1
  && r.planung.zeitraum.von === tag(0) && r.planung.zeitraum.bis === tag(13));
check('Rechnungen: Entwurf und überfällige, Bezahltes zählt nicht', r.rechnungen.entwuerfe === 1 && r.rechnungen.ueberfaellig === 1);
check('Personal: offener Abwesenheitsantrag und vergangene Schicht ohne Abgleich (abgeglichene und abgelehnte zählen nicht)',
  r.personal.abwesenheitsantraege.offen === 1 && r.personal.abgleich.schichten_nicht_abgeglichen === 1 && r.personal.abgleich.aelteste === tag(-2));
check('Die Liste nennt den Bereich vorne in jeder Zeile', await page.evaluate(() => {
  const t = document.getElementById('asVerlauf').textContent;
  return ['Offerte · OF-1', 'Offerte · OF-5', 'Planung · ', 'Rechnung · RE-1', 'Abwesenheit · ', 'Abgleich · '].every(x => t.includes(x));
}));
check('Nennt, was es nicht erkennen kann (Offerte ohne Verknüpfung zum Einsatz)', /nicht verknuepft/.test(r.hinweis));
abwesenheitGesperrt = true;
belegeGesperrt = true;
r = await fragen('Was ist noch offen?', { name: 'offene_enden', input: {}, antwort: 'Teilweise.' });
check('KRITISCH: fehlt ein Recht, meldet der Bereich kein_recht statt null offen -- die übrigen Bereiche laufen weiter',
  r.offerten.kein_recht === true && r.offerten.entwuerfe === undefined && r.rechnungen.kein_recht === true
  && r.personal.abwesenheitsantraege.kein_recht === true && r.personal.abgleich.schichten_nicht_abgeglichen === 1
  && r.planung.offene_plaetze === 4);
belegeGesperrt = false;
r = await fragen('Was ist in der Planung offen?', { name: 'offene_enden', input: { bereich: 'planung' }, antwort: 'Vier Plätze.' });
check('Mit bereich nur dieser Bereich', Object.keys(r).filter(k => k !== 'hinweis').join() === 'planung');
abwesenheitGesperrt = false;

// ══════════ KEIN RECHT, FALSCHE EINGABE
belegeGesperrt = true;
r = await fragen('Welche Rechnungen sind offen?', { name: 'offene_rechnungen', input: {}, antwort: 'Dafür fehlt dir die Berechtigung.' });
check('KRITISCH: ohne Recht meldet das Werkzeug kein_recht -- keine leere Liste, die wie „keine" aussähe',
  r.kein_recht === true && r.anzahl === undefined && r.posten === undefined);
belegeGesperrt = false;
r = await fragen('Offen?', { name: 'offene_plaetze', input: { von: 'morgen', bis: tag(3) }, antwort: 'Das Datum fehlte.' });
check('Eine ungültige Eingabe ergibt einen Fehler, keine erfundene Liste', !!r.fehler && r.posten === undefined);

// ══════════ FEHLER DES SERVERS
assistentAntwort = [{ status: 'error', grund: 'nur_testumgebung', message: 'Der Assistent ist erst auf der Testumgebung freigeschaltet.' }, 403];
await page.fill('#asText', 'Hallo?'); await page.click('#asBtn');
await page.waitForTimeout(400);
check('Eine Absage des Servers wird als Meldung gezeigt', /erst auf der Testumgebung/.test(await page.textContent('#asVerlauf')));
assistentAntwort = null;
const vorher = zurueck.length;
await fragen('Wo fehlen Leute?', { name: 'offene_plaetze', input: { von: tag(0), bis: tag(6) }, antwort: 'Wieder da.' });
check('Danach funktioniert die nächste Frage wieder (das Gespräch blieb gültig)', zurueck.length === vorher + 1 && (await letzteAntwort()) === 'Wieder da.');

// ══════════ STUMM, VERSCHIEBEN, SCHLIESSEN
await page.click('#asStumm');
const gesprochenVorher = (await page.evaluate(() => window.__gesprochen)).length;
await fragen('Wo fehlen Leute?', { name: 'offene_plaetze', input: { von: tag(0), bis: tag(6) }, antwort: 'Leise Antwort.' });
check('Stumm: die Antwort steht da, wird aber nicht vorgelesen',
  (await letzteAntwort()) === 'Leise Antwort.' && (await page.evaluate(() => window.__gesprochen)).length === gesprochenVorher);
check('Der Stumm-Knopf zeigt seinen Zustand an (Farbe gemessen)', await page.evaluate(() => {
  const b = document.getElementById('asStumm'); return b.classList.contains('aus') && getComputedStyle(b).color !== getComputedStyle(document.querySelector('.as-kopf button:last-child')).color; }));
await page.screenshot({ path: OUT + '/assistent-desktop.png' });

await page.click('#asPanel .as-kopf button[aria-label="Fenster zuklappen"]');
const vor = await box(page, '#asFigur');
await page.mouse.move(vor.x + 38, vor.y + 38); await page.mouse.down();
await page.mouse.move(vor.x - 200, vor.y - 300, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(100);
const nach = await box(page, '#asFigur');
check(`Die Figur lässt sich verschieben (${Math.round(vor.x - nach.x)} px links, ${Math.round(vor.y - nach.y)} px hoch)`,
  Math.abs(vor.x - nach.x - 238) <= 3 && Math.abs(vor.y - nach.y - 338) <= 3);
check('Verschieben öffnet das Fenster nicht (kein Klick)', !(await page.isVisible('#asPanel')));
await page.mouse.move(nach.x + 38, nach.y + 38); await page.mouse.down();
await page.mouse.move(5000, 5000, { steps: 4 }); await page.mouse.up();
const rand = await box(page, '#asFigur');
check('Die Figur bleibt beim Verschieben im Bild (gemessen)', rand.r <= 1500 && rand.b <= 1000 && rand.x >= 0 && rand.y >= 0);

// Position und Stummschaltung ueberstehen das Neuladen (pro Browser).
await page.mouse.move(rand.x + 38, rand.y + 38); await page.mouse.down();
await page.mouse.move(rand.x - 400, rand.y - 200, { steps: 6 }); await page.mouse.up();
const gemerkt = await box(page, '#asFigur');
await page.reload(); await page.waitForSelector('#shell.on'); await page.waitForTimeout(600);
check('Nach dem Neuladen schläft er wieder in der Kopfzeile', await page.isVisible('#asDock') && !(await leer()) && !(await page.isVisible('#asWidget')));
await page.click('#asDock'); await page.waitForTimeout(150);
const wieder = await box(page, '#asFigur');
check('Geweckt steht die Figur wieder am gemerkten Platz (gemessen)', Math.abs(wieder.x - gemerkt.x) <= 2 && Math.abs(wieder.y - gemerkt.y) <= 2);
check('... und bleibt stumm', await page.evaluate(() => document.getElementById('asStumm').classList.contains('aus')));
const oben = await box(page, '#asPanel');
check('Auch nach dem Verschieben öffnet sich das Fenster ganz im Bild (gemessen)', oben.x >= 0 && oben.y >= 0 && oben.r <= 1500 && oben.b <= 1000);
await page.click('#asPanel .as-kopf button[aria-label="Assistent schliessen"]');
check('Schliessen legt ihn zurück auf den Ruheplatz', !(await page.isVisible('#asWidget')) && !(await leer()));

// Herausziehen weckt ihn und setzt ihn dorthin, wo man loslaesst.
const d2 = await box(page, '#asDock');
await page.mouse.move(d2.x + 20, d2.y + 20); await page.mouse.down();
// Weit genug unten, dass das Fenster darueber Platz hat -- sonst rueckt die
// Figur absichtlich nach unten (asInSicht).
await page.mouse.move(700, 800, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(150);
const gezogen = await box(page, '#asFigur');
check('Herausziehen weckt ihn: die Figur steht dort, wo man loslässt (gemessen)',
  await page.isVisible('#asWidget') && Math.abs(gezogen.x + gezogen.w / 2 - 700) <= 3 && Math.abs(gezogen.y + gezogen.h / 2 - 800) <= 3);
check('... und das Fenster ist offen', await page.isVisible('#asPanel'));
// Zurueck in die Kopfzeile gezogen, schlaeft er wieder.
await page.click('#asPanel .as-kopf button[aria-label="Fenster zuklappen"]');
const vorZurueck = await box(page, '#asFigur');
await page.mouse.move(vorZurueck.x + 38, vorZurueck.y + 38); await page.mouse.down();
await page.mouse.move(d2.x + 20, d2.y + 20, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(150);
check('Zurück in die Kopfzeile gezogen, schläft er wieder', !(await page.isVisible('#asWidget')) && !(await leer()));
await page.click('#asDock'); await page.waitForTimeout(100);
await page.click('#asDock'); await page.waitForTimeout(100);
check('Wach legt ein Klick auf den leeren Platz ihn schlafen', !(await page.isVisible('#asWidget')) && !(await leer()));
check('... ohne dass die Kopfzeile als neuer Platz gemerkt wird', await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('as_pos') || 'null'); return !p || p.unten < window.innerHeight - 120; }));

// ══════════ WECKWORT „HALLO WAECHTER" (ENT-702)
await page.click('#asDock'); await page.waitForTimeout(150);
check('Das Weckwort ist standardmässig aus', await page.evaluate(() => window.__vosk.mikro === 0 && document.getElementById('asHorch').getAttribute('aria-pressed') === 'false'));
await page.click('#asHorch');
await page.waitForFunction(() => document.getElementById('asHorch').classList.contains('an'), null, { timeout: 5000 });
const weck = await page.evaluate(() => window.__vosk);
check('Eingeschaltet: Modell vom eigenen Server geladen, Mikrofon offen', weck.modelle === 1 && weck.mikro === 1 && /^blob:/.test(weck.modellAdresse));
check('KRITISCH: die Erkennung kennt nur das Weckwort (Wortliste), sonst nichts', typeof weck.grammatik === 'string' && JSON.stringify(JSON.parse(weck.grammatik)) === JSON.stringify(['hallo wächter', '[unk]']));
check('Der Ruheplatz bzw. die Figur zeigen, dass zugehört wird', await page.evaluate(() => document.getElementById('asWidget').classList.contains('horcht')));
await page.click('#asPanel .as-kopf button[aria-label="Assistent schliessen"]');
check('Auch schlafend zeigt der Ruheplatz das Zuhören an', await page.evaluate(() => document.getElementById('asDock').classList.contains('horcht')));
await page.evaluate(() => { window.__mik = 0; window.sprachUm = () => { window.__mik++; }; });
await page.evaluate(() => window.__voskSagt('guten morgen'));
await page.waitForTimeout(100);
check('Ein anderes Wort weckt ihn nicht', !(await page.isVisible('#asWidget')) && await page.evaluate(() => window.__mik === 0));
drehbuch = { name: 'offene_plaetze', input: { von: tag(0), bis: tag(6) }, antwort: 'Zwei Einsätze haben noch Lücken.' };
const vorFrage = zurueck.length;
await page.evaluate(() => window.__voskSagt('hallo wächter'));
await page.waitForTimeout(200);
check('KRITISCH: „Hallo Wächter“ weckt ihn und öffnet das Fenster', await page.isVisible('#asWidget') && await page.isVisible('#asPanel'));
check('KRITISCH: die Frage nimmt Vosk auf, nicht die Spracherkennung des Browsers (kein zweiter Mikrofonzugriff, kein Ton an Apple)',
  await page.evaluate(() => window.__mik === 0 && window.__frageOffen() && window.__vosk.mikro === 1));
check('Für die Frage versteht Vosk freie Sätze (Erkenner ohne Wortliste)', await page.evaluate(() => window.__vosk.erkenner.some(x => !x.weg && x.gram === null)));
check('Die Figur zeigt, dass sie zuhört', await page.evaluate(() => document.getElementById('asWidget').classList.contains('hoert')));
await page.evaluate(() => window.__voskSagt('hallo wächter'));
check('Ein Echo des Weckworts startet keine zweite Frage', await page.evaluate(() => window.__vosk.erkenner.filter(x => !x.weg && x.gram === null).length === 1));
await page.evaluate(() => window.__voskSagt('wo fehlen', 'frage', 'partialresult'));
check('Was schon verstanden ist, steht sofort im Feld', (await page.inputValue('#asText')) === 'wo fehlen');
// Eine kurze Pause mitten in der Frage: Vosk schliesst den ersten Teil ab,
// gestellt wird aber erst nach der Luft -- und der zweite Teil gehoert dazu.
await page.evaluate(() => { asFragePause = 600; });
await page.evaluate(() => window.__voskSagt('wo fehlen', 'frage', 'result'));
await page.waitForTimeout(300);
check('KRITISCH: nach einer kurzen Sprechpause wird die Frage noch nicht gestellt',
  zurueck.length === vorFrage && await page.evaluate(() => window.__frageOffen()));
await page.evaluate(() => window.__voskSagt('diese woche', 'frage', 'partialresult'));
await page.waitForTimeout(450);
check('Spricht die Person weiter, wartet die Frage weiter (auch über die Luft hinaus)',
  zurueck.length === vorFrage && await page.evaluate(() => window.__frageOffen()));
await page.evaluate(() => window.__voskSagt('diese woche noch leute', 'frage', 'result'));
await page.waitForTimeout(300);
check('Auch der zweite Teil stellt die Frage nicht sofort', zurueck.length === vorFrage);
await page.waitForFunction(() => !document.getElementById('asBtn').disabled && !window.__frageOffen(), null, { timeout: 5000 });
await page.waitForTimeout(150);
check('KRITISCH: nach der Sprechpause wird die Frage gestellt und beantwortet',
  zurueck.length === vorFrage + 1 && (await letzteAntwort()) === 'Zwei Einsätze haben noch Lücken.'
  && await page.evaluate(() => [...document.querySelectorAll('#asVerlauf .as-msg.du')].pop().textContent === 'wo fehlen diese woche noch leute'));
check('Danach hört er wieder nur auf das Weckwort (Frage-Erkenner weg, Anzeige aus)',
  await page.evaluate(() => !window.__frageOffen() && !document.getElementById('asWidget').classList.contains('hoert')));

// Nichts gesagt: nach der Stille zurueck zum Weckwort, nichts gestellt.
await page.evaluate(() => { asFrageStille = 200; asWeckLetzt = 0; });
const vorStille = zurueck.length;
await page.evaluate(() => window.__voskSagt('hallo wächter'));
await page.waitForTimeout(500);
check('Kommt nach dem Weckwort nichts, hört er wieder auf „Hallo Wächter“ und stellt nichts',
  await page.evaluate(() => !window.__frageOffen()) && zurueck.length === vorStille && /Nichts gehört/.test(await page.textContent('#asSprachHint')));
// Auch der Mikrofon-Knopf nimmt ueber Vosk auf, solange das Weckwort zuhoert.
await page.evaluate(() => { asFrageStille = 8000; });
await page.click('#asMik'); await page.waitForTimeout(100);
check('Mikrofon-Knopf bei eingeschaltetem Weckwort: Aufnahme über Vosk, ohne Browser-Erkennung',
  await page.evaluate(() => window.__frageOffen() && window.__mik === 0));
await page.click('#asMik'); await page.waitForTimeout(100);
check('Nochmals tippen beendet die Aufnahme', await page.evaluate(() => !window.__frageOffen()));
await page.click('#asHorch');
await page.waitForTimeout(100);
check('Ausgeschaltet: Mikrofon zu, Anzeige weg', await page.evaluate(() => window.__vosk.gestoppt >= 1 && !document.getElementById('asWidget').classList.contains('horcht')));
check('Die Einstellung bleibt gemerkt (aus)', await page.evaluate(() => localStorage.getItem('as_horchen') === '0'));

// Der Server scheitert beim Vorbereiten: sein Grund steht da.
await ablageLeeren();
modellNeu([{ phase: 'fehler', grund: 'Das Modell liess sich nicht herunterladen (Zeitlimit)' }]);
await page.evaluate(() => { asTakt = 30; });
await page.click('#asHorch');
await page.waitForTimeout(400);
check('Scheitert der Server, steht sein Grund da, und das Zuhören schaltet sich aus',
  /liess sich nicht herunterladen \(Zeitlimit\)/.test(await page.textContent('#asVerlauf'))
  && await page.evaluate(() => !document.getElementById('asHorch').classList.contains('an') && localStorage.getItem('as_horchen') === '0'));

// Noch nicht vorbereitet: einmal anstossen, Stand abfragen, dann laden.
await ablageLeeren();
modellNeu([{ phase: '' }, { phase: 'laedt' }, { phase: 'packt' }, { phase: 'fertig' }, { phase: 'fertig' }]);
await page.click('#asHorch');
await page.waitForFunction(() => document.getElementById('asHorch').classList.contains('an'), null, { timeout: 5000 });
check('Nicht vorbereitet: die Seite stösst die Vorbereitung genau einmal an und wartet auf den Stand', modellServer.posts === 1);
await page.click('#asHorch'); await page.waitForTimeout(100);

// In Teilen (Nachtrag ENT-703): ein Teil scheitert zweimal, der dritte Versuch kommt an.
await page.evaluate(() => { asTeilPause = 10; }); await ablageLeeren();
let fehlversuche = 0;
modellNeu([{ phase: 'fertig' }], null, n => (n === 2 && fehlversuche++ < 2 ? [503, '{"message":"Zeitlimit"}'] : null));
await page.click('#asHorch');
await page.waitForFunction(() => document.getElementById('asHorch').classList.contains('an'), null, { timeout: 5000 });
check('Das Modell kommt in Teilen, ein gescheiterter Teil wird wiederholt', JSON.stringify(modellServer.teile) === JSON.stringify([0, 1, 2, 2, 2, 3]));
await page.click('#asHorch'); await page.waitForTimeout(100);

// Ein Teil haengt: nach drei Versuchen eine Meldung mit dem Teil, dann beim naechsten Mal dort weiter.
await page.evaluate(() => { asFristTeil = 150; }); await ablageLeeren();
modellNeu([{ phase: 'fertig' }], null, n => (n === 1 ? 'haengt' : null));
await page.click('#asHorch');
await page.waitForTimeout(1500);
check('KRITISCH: Hängt ein Teil, nennt die Seite ihn nach drei Versuchen, statt still zu warten',
  /Teil 2 von 4 kam nach 3 Versuchen nicht an/.test(await page.textContent('#asVerlauf'))
  && JSON.stringify(modellServer.teile) === JSON.stringify([0, 1, 1, 1])
  && await page.evaluate(() => !document.getElementById('asHorch').classList.contains('laedt')));
modellNeu([{ phase: 'fertig' }]);
await page.evaluate(() => { asFristTeil = 60000; });
await page.click('#asHorch');
await page.waitForFunction(() => document.getElementById('asHorch').classList.contains('an'), null, { timeout: 5000 });
check('Beim nächsten Einschalten geht es beim fehlenden Teil weiter, fertige Teile kommen aus dem Zwischenspeicher',
  JSON.stringify(modellServer.teile) === JSON.stringify([1, 2, 3]));
await page.click('#asHorch'); await page.waitForTimeout(100);

// Eine Fehlerseite mit Status 200 ist kein Modell.
await ablageLeeren();
modellNeu([{ phase: 'fertig' }], [200, Buffer.alloc(1200000, 0x3c)]);
await page.click('#asHorch');
await page.waitForTimeout(400);
check('Liefert der Server etwas anderes als ein Modell, sagt die Seite das', /kein Sprachmodell geliefert/.test(await page.textContent('#asVerlauf')));

// Vosk startet nicht (haengt still): nach der Frist ein eigener Grund, kein endloses Blinken.
modellNeu([{ phase: 'fertig' }]);
await page.evaluate(() => { window.__voskModus = 'haengt'; asFristModell = 300; });
await page.click('#asHorch');
await page.waitForTimeout(800);
check('KRITISCH: hängt Vosk im Browser, nennt die Seite nach der Frist Schritt 3 und blinkt nicht endlos',
  /Schritt 3\/4/.test(await page.textContent('#asVerlauf'))
  && await page.evaluate(() => !document.getElementById('asHorch').classList.contains('laedt')));
await page.evaluate(() => { window.__voskModus = 'ok'; asFristModell = 120000; });

// Vosk meldet einen Fehler: sofort, mit seinem Text, nicht erst nach der Frist.
await page.evaluate(() => { window.__voskModus = 'fehler'; });
await page.click('#asHorch');
await page.waitForTimeout(400);
check('KRITISCH: meldet Vosk einen Fehler, steht er sofort da (nicht erst nach zwei Minuten)',
  /Vosk meldet einen Fehler.*Failed to sync file system/.test(await page.textContent('#asVerlauf'))
  && await page.evaluate(() => !document.getElementById('asHorch').classList.contains('laedt')));
await page.evaluate(() => { window.__voskModus = 'ok'; });

// Alte Kopien in der Ablage von Vosk werden entfernt, die benutzte bleibt.
await page.evaluate(() => new Promise(ok => { const r = indexedDB.open('/vosk', 21);
  r.onupgradeneeded = () => { r.result.createObjectStore('FILE_DATA'); };
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('FILE_DATA', 'readwrite');
    tx.objectStore('FILE_DATA').put({}, '/vosk'); tx.objectStore('FILE_DATA').put({}, '/vosk/blob_alt'); tx.objectStore('FILE_DATA').put({}, '/vosk/blob_alt/am');
    tx.oncomplete = () => { db.close(); ok(); }; }; }));
await page.click('#asHorch');
await page.waitForFunction(() => document.getElementById('asHorch').classList.contains('an'), null, { timeout: 5000 });
await page.waitForTimeout(300);
const vorrat = await page.evaluate(() => new Promise(ok => { const r = indexedDB.open('/vosk');
  r.onsuccess = () => { const db = r.result; const k = db.transaction('FILE_DATA').objectStore('FILE_DATA').getAllKeys();
    k.onsuccess = () => { db.close(); ok(k.result.map(String)); }; }; }));
const benutzt = await page.evaluate(() => '/vosk/' + window.__vosk.modellAdresse.replace(/[\W]/g, '_'));
check('Alte Kopien des Modells in der Browser-Datenbank werden entfernt, die benutzte bleibt',
  !vorrat.some(k => k.startsWith('/vosk/blob_alt')) && vorrat.includes(benutzt) && vorrat.includes(benutzt + '/am') && vorrat.includes('/vosk'));
await page.click('#asHorch'); await page.waitForTimeout(100);

// Die Bibliothek laedt nicht: Schritt 1.
await page.evaluate(() => { window.__VoskEcht = window.Vosk; delete window.Vosk; asFristSkript = 300; });
await page.route('**/vosk.js', r => new Promise(() => {}));
await page.click('#asHorch');
await page.waitForTimeout(800);
check('Lädt die Bibliothek nicht, nennt die Seite Schritt 1', /Schritt 1\/4/.test(await page.textContent('#asVerlauf')));
await page.evaluate(() => { window.Vosk = window.__VoskEcht; asFristSkript = 60000; });
modellNeu([{ phase: 'fertig' }]);

// Am Handy nicht (mobiler Zuschnitt nicht entschieden).
await page.reload(); await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
check('Am Handy ist der Assistent ausgeblendet (mobiler Zuschnitt noch nicht entschieden)', !(await page.isVisible('#asFigur')) && !(await page.isVisible('#asDock')));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
await browser.close();
