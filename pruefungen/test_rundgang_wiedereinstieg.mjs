// Rueckfrage beim App-Start, wenn noch ein Rundgang offen ist (ENT-628).
//
// WORUM ES GEHT: Der Hinweis-Chip aus ENT-234 haengt an `rundgangAktiv`,
// und das lebt nur im Arbeitsspeicher der Sitzung. App zu, App auf -- und
// eine pausierte Runde ist unsichtbar, obwohl sie weiterlaeuft: Die
// Pausenminuten zaehlen mit, in der Auswertung steht sie als unbeendet, und
// ein zweiter Start am selben Einsatz wird mit 409 abgelehnt. Sichtbar war
// sie nur, wer zufaellig denselben Einsatz wieder oeffnete.
//
// Die wichtigsten Pruefungen hier:
//  1. Der Dialog kommt ueberhaupt -- und zwar auch fuer eine Runde von
//     gestern, deren Schicht laengst vorbei ist. Genau die ist der Anlass.
//  2. Er laesst sich NICHT wegtippen. Drei Wege, kein vierter.
//  3. Er kommt NICHT, wenn die App die Runde ohnehin kennt. Waehrend einer
//     Runde verlaesst man die App dauernd (jedes Foto) -- ein Dialog bei
//     jeder Rueckkehr waere binnen einer Schicht verhasst.
//  4. Nach "Pausieren" sagt der Chip die WAHREN Zahlen. Die App kennt dann
//     nur die Summen, nicht die einzelnen Punkte; "0 von 0" saehe aus wie
//     eine leere Runde ("unbekannt" darf nie wie "keine" aussehen).
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// Die Schicht zur offenen Runde liegt bewusst NICHT im geladenen Fenster:
// So faellt auf, ob die App sie einzeln nachlaedt, statt auf den Knopfdruck
// hin stillschweigend nichts zu tun.
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [] };
const ALTE_SCHICHT = { id: 777, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache',
  strasse: 'Musterweg 4', ort: '9999 Musterdorf', einsatzart: 'Revierdienst', sparte: 'sicherheit',
  datum: tag(-1), von: '20:00:00', bis: '06:00:00', status: 'bestaetigt', bemerkung: null,
  zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
  hat_kontrollpunkte: true, im_team: 1 };

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const punkte = [
  { id: 1, bezeichnung: 'Eingang Nord', typ: 'nfc' },
  { id: 2, bezeichnung: 'Tor 3', typ: 'nfc' },
  { id: 3, bezeichnung: 'Tiefgarage', typ: 'nfc' },
];

// Der Serverzustand. Er wird waehrend des Laufs umgeschaltet -- nach einem
// Abbruch darf die Rueckfrage nicht wiederkommen.
let LAEUFT = { status: 'ok', weitere: 0, rundgang: {
  id: 951, einsatz_id: 777, einsatz_datum: tag(-1), status: 'pausiert',
  vorbereitet_am: tag(-1) + ' 21:14:00', rohzeit_start: tag(-1) + ' 21:20:00',
  pausiert_seit: tag(-1) + ' 23:02:00', pause_minuten: 12,
  objekt_name: 'Musterobjekt Industrie', kunde_name: 'Musterliegenschaften AG',
  vorlage_name: 'Patrouille Nord', punkte_anzahl: 3, erledigt_anzahl: 2 } };

let rufe = [];
// Künstliche Verzögerung der Antwort, in Millisekunden. 0 = sofort.
let bremse = 0;
// Antwort auf einen Startversuch. null = der Start gelingt.
let STARTFEHLER = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.split('/api/')[1];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
  rufe.push({ p, body, query: Object.fromEntries(url.searchParams) });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('meine_schichten')) {
    // Einzeln nachgefragt: nur dann kommt die alte Schicht heraus.
    if (url.searchParams.get('von') === tag(-1) && url.searchParams.get('bis') === tag(-1)) {
      return send({ status: 'ok', von: tag(-1), bis: tag(-1), schichten: [ALTE_SCHICHT] });
    }
    return send(SCHICHTEN);
  }
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_laeuft')) {
    // Mit Verzögerung, um den Wettlauf unten nachstellen zu können.
    if (bremse) { return setTimeout(() => send(LAEUFT), bremse); }
    return send(LAEUFT);
  }
  if (p.includes('mein_rundgang_offen')) {
    return send({ status: 'ok', rundgang: { id: 951, status: 'laeuft', pausiert_seit: null,
      vorbereitet_am: tag(-1) + ' 21:14:00', pause_minuten: 12, objekt: { id: 7, name: 'Musterobjekt Industrie' },
      vorlage_name: 'Patrouille Nord', ansprechpartner: [], zentrale: null,
      kontrollpunkte: punkte.map((k, i) => ({ ...k, erledigt: i < 2 ? { status: 'bestaetigt' } : null })) } });
  }
  if (p.includes('mein_rundgang_pausieren')) return send({ status: 'ok' });
  if (p.includes('mein_rundgang_fortsetzen')) return send({ status: 'ok', rundgang_status: 'laeuft' });
  if (p.includes('mein_rundgang_abbrechen')) return send({ status: 'ok' });
  if (p.includes('mein_rundgang_spontan_starten') || p.includes('mein_rundgang_starten')) {
    if (STARTFEHLER) {
      return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify(STARTFEHLER) });
    }
    return send({ status: 'ok', rundgang_id: 960, einsatz_id: 778, kontrollpunkte: punkte });
  }
  return send({ status: 'ok' });
});

// Ein App-Neustart, nicht eine neue Anmeldung: Die Sitzung liegt im
// localStorage und ueberlebt das Schliessen -- genau darum ist die offene
// Runde der einzige Zustand, der verlorengeht.
const anmelden = async () => {
  await page.goto(`file://${WURZEL}/app.html`);
  await page.waitForTimeout(150);
  if (await page.isVisible('#gName')) {
    await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  }
  await page.waitForSelector('.app.on');
  await page.waitForTimeout(600);
};

await anmelden();

// ══════════ DIE RUECKFRAGE KOMMT ══════════════════════════════════════
check('KRITISCH: nach dem App-Start steht die Rückfrage da',
  await page.isVisible('#roDlg'));
check('KRITISCH: sie wurde beim Server erfragt, nicht aus dem Speicher geraten',
  rufe.some(r => r.p.includes('mein_rundgang_laeuft')));
check('Sie nennt den Ort der Runde, nicht nur eine Nummer',
  (await page.textContent('#roName')) === 'Musterobjekt Industrie');
check('Sie sagt, worum es geht, bevor sie den Namen nennt',
  (await page.textContent('#roFrage')).includes('Bearbeitung'));
{
  const meta = await page.textContent('#roMeta');
  check('KRITISCH: sie nennt den Anfangszeitpunkt -- auch den von gestern',
    meta.includes(tag(-1).split('-').reverse().join('.')) && meta.includes('21:14'));
  check('Sie nennt die gewählte Kontrollrunde', meta.includes('Patrouille Nord'));
  check('KRITISCH: sie nennt den Fortschritt mit BEIDEN Zahlen, nicht nur der erledigten',
    meta.includes('2') && meta.includes('3') && meta.includes('erledigt'));
  check('Bei pausierter Runde steht auch dabei, seit wann', meta.includes('23:02'));
}
check('Beschriftung steht ÜBER dem Wert, nicht darunter (CLAUDE.md, gemessen)',
  await page.evaluate(() => {
    const z = document.querySelector('#roMeta .ro-z');
    return z.querySelector('b').getBoundingClientRect().top
      < z.querySelector('span').getBoundingClientRect().top;
  }));

// ══════════ DREI WEGE, KEIN VIERTER ═══════════════════════════════════
check('KRITISCH: es gibt genau drei Knöpfe', await page.evaluate(() =>
  document.querySelectorAll('#roDlg button').length === 3));
check('KRITISCH: kein Schliesskreuz im Dialog', await page.evaluate(() =>
  !document.querySelector('#roDlg [aria-label="Schliessen"]')));
check('Der erste Weg heisst "Fortsetzen"',
  (await page.textContent('#roBtnWeiter')).includes('Fortsetzen'));
check('KRITISCH: bei pausierter Runde heisst der mittlere Weg nicht "Pausieren"',
  (await page.textContent('#roBtnPause')).includes('Pausiert lassen'));
check('Der dritte Weg heisst "Abbrechen" und sagt, dass er endgültig ist',
  (await page.textContent('#roBtnAb')).includes('Abbrechen')
  && (await page.textContent('#roBtnAb')).includes('Endgültig'));
check('KRITISCH: "Fortsetzen" steht über "Abbrechen" -- der harmlose Weg zuerst (gemessen)',
  await page.evaluate(() => document.getElementById('roBtnWeiter').getBoundingClientRect().top
    < document.getElementById('roBtnAb').getBoundingClientRect().top));
check('Alle drei Knöpfe sind mindestens 44px hoch (CLAUDE.md, gemessen)',
  await page.evaluate(() => ['roBtnWeiter', 'roBtnPause', 'roBtnAb']
    .every(i => document.getElementById(i).getBoundingClientRect().height >= 44)));
check('Der Dialog liegt wirklich über dem Seiteninhalt (gemessen)',
  await page.evaluate(() => {
    const r = document.getElementById('roBtnWeiter').getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      === document.getElementById('roBtnWeiter');
  }));
await page.screenshot({ path: `${OUT}/rgwieder-01-frage.png` });

// Danebentippen darf nichts tun. Geprüft wird am Zustand, nicht am Code:
// Der Klick geht auf die abgedunkelte Fläche ganz oben im Fenster.
await page.mouse.click(195, 30);
await page.waitForTimeout(200);
check('KRITISCH: ein Tipp daneben schliesst die Rückfrage NICHT',
  await page.isVisible('#roDlg'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('KRITISCH: auch Escape schliesst sie nicht',
  await page.isVisible('#roDlg'));
// Falls doch: von vorn, damit die Suite hier mit roten Punkten endet und
// nicht mit einer Zeitüberschreitung im nächsten Schritt.
if (!(await page.isVisible('#roDlg'))) { await anmelden(); }

// ══════════ PAUSIERT LASSEN ═══════════════════════════════════════════
rufe = [];
await page.click('#roBtnPause');
await page.waitForTimeout(300);
check('KRITISCH: "Pausiert lassen" pausiert nicht noch einmal -- das wäre eine Pause in der Pause',
  !rufe.some(r => r.p.includes('mein_rundgang_pausieren')));
check('Die Rückfrage ist danach weg', !(await page.isVisible('#roDlg')));
check('KRITISCH: die Runde bleibt sichtbar -- der Chip auf "Heute" tritt an ihre Stelle',
  await page.isVisible('.rd-chip'));
{
  const chip = await page.textContent('.rd-chip');
  check('Der Chip sagt, dass sie pausiert ist', chip.includes('pausiert'));
  check('KRITISCH: der Chip nennt die ECHTEN Zahlen, nicht "0 von 0"',
    chip.includes('2') && chip.includes('3') && !chip.includes('0 von 0'));
}
await page.screenshot({ path: `${OUT}/rgwieder-02-chip.png` });

// ══════════ SIE KOMMT NICHT WIEDER, SOLANGE DIE APP SIE KENNT ═════════
rufe = [];
await page.evaluate(() => {
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(300);
check('Bei Rückkehr in den Vordergrund wird erneut nachgefragt',
  rufe.some(r => r.p.includes('mein_rundgang_laeuft')));
check('KRITISCH: die Rückfrage kommt dabei wieder -- die App kennt nur die Zahlen, nicht die Runde',
  await page.isVisible('#roDlg'));

// ══════════ FORTSETZEN FÜHRT WIRKLICH HINEIN ══════════════════════════
rufe = [];
await page.click('#roBtnWeiter');
await page.waitForTimeout(700);
check('KRITISCH: "Fortsetzen" macht zuerst die Pause am Server zu',
  rufe.some(r => r.p.includes('mein_rundgang_fortsetzen') && r.body && r.body.rundgang_id === 951));
check('KRITISCH: die Schicht von gestern wird einzeln nachgeladen -- sonst passierte gar nichts',
  rufe.some(r => r.p.includes('meine_schichten') && r.query.von === tag(-1)));
check('Danach wird die volle Runde geholt',
  rufe.some(r => r.p.includes('mein_rundgang_offen')));
check('KRITISCH: die laufende Runde steht danach offen',
  await page.isVisible('#rgSeite.on'));
check('Die Rückfrage ist zu', !(await page.isVisible('#roDlg')));
await page.screenshot({ path: `${OUT}/rgwieder-03-drin.png` });

// Gegenprobe zur wichtigsten Nebenbedingung: Wer waehrend der Runde kurz
// die App verlaesst (jedes Foto tut das), darf die Frage NICHT erneut
// sehen.
rufe = [];
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(400);
check('KRITISCH: in der laufenden Runde wird gar nicht erst nachgefragt',
  !rufe.some(r => r.p.includes('mein_rundgang_laeuft')));
check('KRITISCH: und die Rückfrage bleibt weg',
  !(await page.isVisible('#roDlg')));

// ══════════ WETTLAUF: ANTWORT KOMMT ZU SPÄT ═══════════════════════════
// Zwischen Frage und Antwort können Sekunden liegen. Öffnet der Wächter in
// dieser Zeit die Runde selbst -- über den Chip auf "Heute" --, ist die
// Frage beantwortet, bevor sie gestellt wurde. Ohne einen zweiten Blick
// NACH der Antwort schöbe sich der Dialog über die bereits offene Runde.
await page.evaluate(() => { rundgangAktiv = null; rgSeiteZu(); });
bremse = 900;
rufe = [];
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(150);
// Während die Antwort noch unterwegs ist: die Runde von Hand öffnen.
await page.evaluate(() => {
  rundgangAktiv = { id: 951, einsatz_id: 777, status: 'laeuft', kontrollpunkte: [] };
});
await page.waitForTimeout(1200);
bremse = 0;
check('KRITISCH: die verspätete Antwort schiebt sich nicht über die inzwischen geöffnete Runde',
  !(await page.isVisible('#roDlg')));
await page.evaluate(() => { rundgangAktiv = null; });

// ══════════ ABBRECHEN: GRUNDABFRAGE, UND EIN RÜCKWEG ══════════════════
LAEUFT = { status: 'ok', weitere: 0, rundgang: {
  ...LAEUFT.rundgang, status: 'laeuft', pausiert_seit: null } };
await anmelden();
check('Nach einem Neustart steht die Rückfrage wieder da', await page.isVisible('#roDlg'));
check('KRITISCH: bei laufender (nicht pausierter) Runde heisst der mittlere Weg "Pausieren"',
  (await page.textContent('#roBtnPause')).includes('Pausieren')
  && !(await page.textContent('#roBtnPause')).includes('Pausiert lassen'));

rufe = [];
await page.click('#roBtnAb');
await page.waitForTimeout(400);
check('KRITISCH: "Abbrechen" bricht nicht sofort ab -- erst kommt die Grundabfrage',
  !rufe.some(r => r.p.includes('mein_rundgang_abbrechen')));
check('Die Grundabfrage ist da und verlangt einen Grund', await page.isVisible('#raGrund'));
check('Die Rückfrage tritt dafür zur Seite', !(await page.isVisible('#roDlg')));
await page.click('#blFuss .btn-plain');
await page.waitForTimeout(300);
check('KRITISCH: "Zurück" führt aus der Grundabfrage wieder in die Rückfrage, nicht ins Leere',
  await page.isVisible('#roDlg'));

// Von vorn statt vom Rückweg aus: Sonst haengt alles Folgende daran, dass
// genau der Rückweg funktioniert -- und eine gebrochene Stelle liesse die
// Suite mit einer Zeitüberschreitung enden statt mit einem roten Punkt.
await anmelden();
await page.click('#roBtnAb');
await page.waitForTimeout(400);
await page.selectOption('#raGrund', { index: 1 });
rufe = [];
await page.click('#raBtn');
await page.waitForTimeout(500);
check('KRITISCH: der Abbruch geht an den Server -- mit der richtigen Runde',
  rufe.some(r => r.p.includes('mein_rundgang_abbrechen') && r.body && r.body.rundgang_id === 951));
check('KRITISCH: ein Abbruch braucht KEINE geladene Schicht -- gerade die vergessene Runde muss weg können',
  !rufe.some(r => r.p.includes('meine_schichten')));
check('Danach ist die Rückfrage weg', !(await page.isVisible('#roDlg')));
check('Und der Chip auch -- eine abgebrochene Runde ist keine offene',
  !(await page.isVisible('.rd-chip')));
await page.screenshot({ path: `${OUT}/rgwieder-04-abgebrochen.png` });

// ══════════ OHNE OFFENE RUNDE GIBT ES KEINE FRAGE ═════════════════════
LAEUFT = { status: 'ok', rundgang: null, weitere: 0 };
await anmelden();
check('KRITISCH: ohne offene Runde erscheint die Rückfrage nicht',
  !(await page.isVisible('#roDlg')));
check('Und auch kein Chip', !(await page.isVisible('.rd-chip')));

// ══════════ ABGELEHNTER START: DIE SPERRE TRÄGT DEN AUSWEG (ENT-629) ══
// Der Wächter steht vor Objekt B, bei Objekt A läuft noch etwas. Ein roter
// Satz "Es ist noch ein Rundgang offen" liesse ihn dort stehen -- er müsste
// erst suchen gehen, wo die alte Runde liegt. Stattdessen kommt dieselbe
// Rückfrage wie beim App-Start.
LAEUFT = { status: 'ok', rundgang: null, weitere: 0 };
STARTFEHLER = { status: 'error', code: 'runde_offen',
  message: 'Es ist noch ein Rundgang offen. Er muss zuerst beendet oder abgebrochen werden.',
  offen: { id: 951, einsatz_id: 777, einsatz_datum: tag(-1), status: 'laeuft',
    vorbereitet_am: tag(-1) + ' 21:14:00', rohzeit_start: null, pausiert_seit: null,
    pause_minuten: 0, objekt_name: 'Musterobjekt Nord', kunde_name: 'Musterliegenschaften AG',
    vorlage_name: 'Patrouille Nord', punkte_anzahl: 3, erledigt_anzahl: 1 } };
/* Der Start geht ueber das Blatt "Ausserhalb der ueblichen Zeit" und
   dessen Knopf -- nicht ueber einen direkten Aufruf der Startfunktion.
   Der Unterschied ist nicht theoretisch: Der Projektinhaber meldete genau
   aus diesem Blatt heraus, dass nur der Satz kam und nicht die
   Rueckfrage. Der direkte Aufruf haette das nie gezeigt, weil er das
   Blatt gar nicht oeffnet. (Ursache war dort ein alter Bau auf dem
   Geraet; der Weg selbst stimmte. Geprueft wird er trotzdem ab jetzt so,
   wie er benutzt wird.)

   KEIN DATUM in diesem Kommentar: test_datumsfest.mjs ueberspringt nur
   Zeilen, die mit // oder einem Stern beginnen -- eine eingerueckte Zeile
   in einem Blockkommentar wird gelesen wie Testdaten. Diese Falle hat am
   selben Tag schon einmal zugeschlagen (test_deploy.mjs). */
const startVersuch = async () => {
  await page.evaluate(() => { blattZu(); rundgangSpontanAusnahmeGrundWahl(30); });
  await page.waitForTimeout(300);
  await page.selectOption('#rfsGrund', { index: 1 });
  await page.click('#rfsBtn');
  await page.waitForTimeout(700);
};

await anmelden();
check('Vorbedingung: ohne offene Runde steht die Rückfrage NICHT da',
  !(await page.isVisible('#roDlg')));
rufe = [];
await startVersuch();
check('Vorbedingung: der Start lief wirklich über den Knopf im Blatt',
  rufe.some(r => r.p.includes('starten') && r.body && r.body.ausnahme_grund));
check('KRITISCH: der abgelehnte Start öffnet die Rückfrage statt eines roten Satzes',
  await page.isVisible('#roDlg'));
check('Sie nennt die Runde, die im Weg steht -- und zwar deren Objekt',
  (await page.textContent('#roName')) === 'Musterobjekt Nord');
check('KRITISCH: sie bietet den Abbruch mit Grund an -- das ist der Ausweg vor Ort',
  (await page.textContent('#roBtnAb')).includes('Abbrechen'));
rufe = [];
// Nur anklicken, wenn es den Knopf gibt: Fehlt die Rückfrage, soll die
// Suite mit roten Punkten enden statt mit einer Zeitüberschreitung.
if (await page.isVisible('#roBtnAb')) {
  await page.click('#roBtnAb');
  await page.waitForTimeout(400);
}
check('KRITISCH: und der Abbruch führt wirklich in die Grundabfrage',
  await page.isVisible('#raGrund'));

// Gegenstück: Ein Startfehler, der NICHTS mit einer offenen Runde zu tun
// hat, darf die Rückfrage nicht auslösen -- sonst behauptete sie eine
// offene Runde, die es nicht gibt.
await anmelden();
STARTFEHLER = { status: 'error', message: 'Ausserhalb des Zeitfensters dieser Kontrollrunde.' };
await startVersuch();
check('KRITISCH: ein anderer Startfehler öffnet die Rückfrage NICHT',
  !(await page.isVisible('#roDlg')));

// Und der Fall, in dem der Server den Code schickt, die Runde aber nicht:
// lieber eine magere Auskunft als eine erfundene Rückfrage.
STARTFEHLER = { status: 'error', code: 'runde_offen', message: 'Es ist noch ein Rundgang offen.' };
await startVersuch();
check('KRITISCH: ohne mitgelieferte Runde erscheint keine leere Rückfrage',
  !(await page.isVisible('#roDlg')));
STARTFEHLER = null;

// ══════════ AM SCHREIBTISCH ═══════════════════════════════════════════
// Jede Aenderung am Handy-Layout wird zusaetzlich am Desktop geprueft
// (CLAUDE.md). Der Dialog ist dieselbe Huelle wie die wichtige Mitteilung
// -- er darf auf 1280 px nicht zum Balken werden.
LAEUFT = { status: 'ok', weitere: 0, rundgang: {
  id: 951, einsatz_id: 777, einsatz_datum: tag(-1), status: 'laeuft',
  vorbereitet_am: tag(-1) + ' 21:14:00', rohzeit_start: tag(-1) + ' 21:20:00',
  pausiert_seit: null, pause_minuten: 0,
  objekt_name: 'Musterobjekt Industrie', kunde_name: 'Musterliegenschaften AG',
  vorlage_name: null, punkte_anzahl: 3, erledigt_anzahl: 0 } };
await page.setViewportSize({ width: 1280, height: 900 });
await anmelden();
check('KRITISCH: die Rückfrage kommt auch am Schreibtisch',
  await page.isVisible('#roDlg'));
{
  const m = await page.evaluate(() => {
    const b = document.querySelector('#roDlg .mit-dlg-box').getBoundingClientRect();
    return { w: b.width, l: b.left, r: window.innerWidth - b.right };
  });
  check('Der Dialog bleibt am Schreibtisch in Fenstergrösse, statt zum Balken zu werden (gemessen)',
    m.w <= 460);
  check('Und er steht mittig, nicht am Rand (gemessen)', Math.abs(m.l - m.r) <= 2);
}
check('KRITISCH: ohne gewählte Kontrollrunde sagt die Rückfrage das AUS, statt die Zeile leer zu lassen',
  (await page.textContent('#roMeta')).includes('Alle Kontrollpunkte des Objekts'));
check('Bei nicht begonnener Runde steht "0 von 3", nicht eine Zahl allein',
  (await page.textContent('#roMeta')).includes('0 von 3'));
await page.screenshot({ path: `${OUT}/rgwieder-05-schreibtisch.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
bad.forEach(b => console.log('  ✗ ' + b));
process.exit(bad.length ? 1 : 0);
