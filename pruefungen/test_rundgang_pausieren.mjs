// Rundgang pausieren als eigene Funktion im Einsatzmodus (ENT-298).
//
// Pausieren gibt es seit ENT-146, aber nur hinter dem roten "Beenden" in der
// Schublade: Wer nur kurz unterbrechen wollte, musste zuerst einen Knopf
// druecken, der nach Abbruch aussieht. Der Projektinhaber hat "Rundgang
// pausieren" ausdruecklich als letzten Punkt im Funktionen-Bereich verlangt,
// samt Rueckfrage (Screenshot: "Warnung / Rundgang pausieren? / Nein / Ja").
//
// Die beiden wichtigsten Pruefungen hier:
//  1. Das Antippen der Funktion pausiert NICHT sofort -- erst "Ja" tut es.
//     Ein pausierter Rundgang sperrt die Kontrollpunkte und laesst
//     pause_minuten mitlaufen; ein Fehlgriff kostet echte Zeit in einer
//     echten Abrechnung.
//  2. Bei bereits laufender Runde fuehrt der Fussknopf NICHT mehr in den
//     Startweg. Der laeuft ueber rundgangSpontanWaehlen() und wuerde bei
//     einer Runde ausserhalb ihres Zeitfensters erneut einen Ausnahmegrund
//     verlangen -- fuer etwas, das laengst laeuft.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
    einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(-1), von: '20:00:00', bis: '06:00:00',
    status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt', objekt_name: 'Musterobjekt Industrie', objekt_id: 7,
    hat_kontrollpunkte: true, im_team: 1 },
  // Der spontan angelegte Einsatz der laufenden Runde. Er MUSS hier stehen:
  // rundgangAnzeigen() sucht den Einsatz im lokalen schichten-Array, das
  // ausschliesslich vom Server kommt (nie lokal erfunden).
  { id: 999, kunde_name: 'Musterliegenschaften AG', titel: 'Spontaner Rundgang', strasse: 'Musterweg 4',
    ort: '9999 Musterdorf', einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(0),
    von: '02:00:00', bis: '03:00:00', status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt Industrie', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 },
]};

const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 }, profil: {
  name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
  vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const VORLAGEN_ALLE = [
  // 601 laeuft noch nicht -- Gegenstueck, damit die Funktion nicht einfach
  // immer da ist.
  { id: 601, name: 'Runde ohne Lauf', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
    kunde_name: 'Musterliegenschaften AG', fenster_von: null, fenster_bis: null },
  // 602 laeuft bereits, und zwar AUSSERHALB ihres Zeitfensters -- so faellt
  // auf, wenn der Fussknopf faelschlich in den Startweg mit Grundabfrage
  // fuehrt.
  { id: 602, name: 'Laufende Runde', objekt_id: 7, objekt_name: 'Musterobjekt Industrie',
    kunde_name: 'Musterliegenschaften AG', fenster_von: '03:00:00', fenster_bis: '03:30:00' },
];

const objekt = { id: 7, name: 'Musterobjekt Industrie', strasse: 'Musterweg 4', ort: '9999 Musterdorf',
  kanton: 'SO', bemerkung: null };
const punkte = [
  { id: 1, bezeichnung: 'Eingang Nord', typ: 'geofence' },
  { id: 2, bezeichnung: 'Tor 3', typ: 'nfc' },
];

// laufend wird waehrend des Laufs umgeschaltet: Nach dem Pausieren laedt die
// Seite nicht neu, aber ein spaeteres Oeffnen muss den echten Serverzustand
// zeigen -- deshalb steht die Vorschau hier als veraenderbares Objekt.
const UEBERSICHT = {
  601: { status: 'ok',
    vorlage: { id: 601, name: 'Runde ohne Lauf', fenster_von: null, fenster_bis: null },
    objekt, kunde_name: 'Musterliegenschaften AG', kontrollpunkte: punkte, ansprechpartner: [],
    laufend: null },
  602: { status: 'ok',
    vorlage: { id: 602, name: 'Laufende Runde', fenster_von: '03:00:00', fenster_bis: '03:30:00' },
    objekt, kunde_name: 'Musterliegenschaften AG', kontrollpunkte: punkte, ansprechpartner: [],
    laufend: { id: 951, einsatz_id: 999, status: 'laeuft',
      vorbereitet_am: tag(-1) + ' 21:14:00', pausiert_seit: null } },
};

let rufe = [];

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
  if (p.includes('meine_schichten')) return send(SCHICHTEN);
  if (p.includes('mein_profil')) return send(PROFIL);
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('mein_rundgang_offen')) {
    return send({ status: 'ok', rundgang: { id: 951, status: 'laeuft', pausiert_seit: null,
      kontrollpunkte: punkte.map(k => ({ ...k, erledigt: null })) } });
  }
  if (p.includes('mein_rundgang_uebersicht')) {
    return send(UEBERSICHT[Number(url.searchParams.get('vorlage_id'))] || { status: 'error', message: 'unbekannt' });
  }
  if (p.includes('mein_rundgang_vorlagen_alle')) return send({ status: 'ok', vorlagen: VORLAGEN_ALLE });
  if (p.includes('mein_rundgang_pausieren')) return send({ status: 'ok' });
  if (p.includes('mein_rundgang_fortsetzen')) return send({ status: 'ok', rundgang_status: 'laeuft' });
  return send({ status: 'ok' });
});

await page.goto(`file://${WURZEL}/app.html`);
await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('.app.on');
await page.waitForTimeout(400);

const oeffne = async name => {
  await page.evaluate(() => { blattZu(); rgSeiteZu(); });
  await page.evaluate(() => rundgangUebersichtOeffnen());
  await page.waitForTimeout(300);
  await page.click(`#blBody button:has-text("${name}")`);
  await page.waitForTimeout(400);
};

// ══════════ OHNE LAUFENDE RUNDE GIBT ES NICHTS ZU PAUSIEREN ═══════════
await oeffne('Runde ohne Lauf');
// Ueber die ID, nicht ueber die Klasse: Seit ENT-299 traegt auch die
// Beschriftung von "Zentrale und Notruf" die Klasse .rgs-mod-lb und steht
// davor -- ein Zugriff ueber die Klasse griff die falsche und machte diese
// Suite rot. Genau dafuer ist die volle Regression da.
check('Der Bereich heisst "Funktionen" -- so nennt ihn der Projektinhaber',
  (await page.textContent('#rgsFunktionenLb')) === 'Funktionen');
check('KRITISCH: ohne laufende Runde gibt es die Funktion "Rundgang pausieren" nicht',
  !(await page.isVisible('#rgsModPause')));
check('Ohne laufende Runde gibt es auch keinen Zustandsstreifen',
  !(await page.isVisible('#rgsStatus')));
check('Der Fussknopf heisst dann "Rundgang starten"',
  (await page.textContent('#rgsStartBtn')).includes('Rundgang starten'));

// ══════════ MIT LAUFENDER RUNDE ═══════════════════════════════════════
await oeffne('Laufende Runde');
check('KRITISCH: bei laufender Runde zeigt die Seite das auch an',
  await page.isVisible('#rgsStatus') && (await page.textContent('#rgsStatus')).includes('Rundgang läuft'));
check('Der Zustandsstreifen nennt die Startzeit, nicht nur den Zustand',
  (await page.textContent('#rgsStatus')).includes('21:14'));
check('Er steht zuoberst, über der Objektkarte (gemessen)',
  await page.evaluate(() => document.getElementById('rgsStatus').getBoundingClientRect().top
    < document.querySelector('.rgs-obj-name').getBoundingClientRect().top));
check('KRITISCH: "Rundgang pausieren" steht als Funktion da',
  await page.isVisible('#rgsModPause')
  && (await page.textContent('#rgsModPause')).includes('Rundgang pausieren'));
check('Es ist der LETZTE der drei Punkte -- so vom Projektinhaber vorgegeben (gemessen)',
  await page.evaluate(() => {
    const y = s => document.querySelector(s).getBoundingClientRect().top;
    return y('#rgsModKp') < y('#rgsModEreignis') && y('#rgsModEreignis') < y('#rgsModPause');
  }));
check('Die Funktion ist mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => document.getElementById('rgsModPause').getBoundingClientRect().height >= 44));
check('KRITISCH: der Fussknopf heisst nicht mehr "starten", sondern führt in die laufende Runde',
  (await page.textContent('#rgsStartBtn')).includes('Zum Rundgang'));

// ══════════ ANTIPPEN FRAGT, ES PAUSIERT NICHT ═════════════════════════
rufe = [];
await page.click('#rgsModPause');
await page.waitForTimeout(250);
check('KRITISCH: das Antippen pausiert NICHT sofort -- kein Aufruf von mein_rundgang_pausieren',
  !rufe.some(r => r.p.includes('mein_rundgang_pausieren')));
check('KRITISCH: stattdessen erscheint die Rückfrage',
  await page.isVisible('#rgsDlg'));
check('Sie ist als Warnung überschrieben und fragt nach dem Pausieren',
  (await page.textContent('#rgsDlgLb')) === 'Warnung'
  && (await page.textContent('#rgsDlgFrage')) === 'Rundgang pausieren?');
check('Sie sagt auch, was die Pause bedeutet -- nicht nur "bist du sicher"',
  (await page.textContent('#rgsDlgTxt')).includes('Kontrollpunkte'));
check('Die Antworten heissen "Nein" und "Ja"',
  (await page.textContent('#rgsDlgNein')) === 'Nein' && (await page.textContent('#rgsDlgJa')) === 'Ja');
check('KRITISCH: "Nein" steht links von "Ja" -- der harmlose Ausgang zuerst (gemessen)',
  await page.evaluate(() => document.getElementById('rgsDlgNein').getBoundingClientRect().left
    < document.getElementById('rgsDlgJa').getBoundingClientRect().left));
check('"Nein" hat den Fokus, nicht "Ja"',
  await page.evaluate(() => document.activeElement === document.getElementById('rgsDlgNein')));
check('Beide Knöpfe sind mindestens 44px hoch (CLAUDE.md)',
  await page.evaluate(() => ['rgsDlgNein', 'rgsDlgJa']
    .every(i => document.getElementById(i).getBoundingClientRect().height >= 44)));
check('Beschriftung steht ÜBER der Frage, nicht darunter (CLAUDE.md)',
  await page.evaluate(() => document.getElementById('rgsDlgLb').getBoundingClientRect().top
    < document.getElementById('rgsDlgFrage').getBoundingClientRect().top));
check('Die Rückfrage liegt über dem Seiteninhalt, nicht dahinter (gemessen)',
  await page.evaluate(() => {
    const d = document.getElementById('rgsDlgNein').getBoundingClientRect();
    const oben = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2);
    return oben === document.getElementById('rgsDlgNein');
  }));
await page.screenshot({ path: `${OUT}/rgpause-01-frage.png` });

// ══════════ "NEIN" UND ESCAPE TUN NICHTS ══════════════════════════════
rufe = [];
await page.click('#rgsDlgNein');
await page.waitForTimeout(200);
check('KRITISCH: "Nein" schliesst die Rückfrage, ohne zu pausieren',
  !(await page.isVisible('#rgsDlg')) && !rufe.some(r => r.p.includes('mein_rundgang_pausieren')));
check('Die Seite selbst bleibt dabei offen', await page.isVisible('#rgSeite'));
check('Der Zustand ist unverändert "läuft",',
  (await page.textContent('#rgsStatus')).includes('Rundgang läuft'));

await page.click('#rgsModPause');
await page.waitForTimeout(200);
rufe = [];
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('KRITISCH: Escape heisst ebenfalls "Nein" -- und schliesst nicht gleich die ganze Seite',
  !(await page.isVisible('#rgsDlg')) && await page.isVisible('#rgSeite')
  && !rufe.some(r => r.p.includes('mein_rundgang_pausieren')));

// ══════════ "JA" PAUSIERT WIRKLICH ════════════════════════════════════
await page.click('#rgsModPause');
await page.waitForTimeout(200);
rufe = [];
await page.click('#rgsDlgJa');
await page.waitForTimeout(400);
check('KRITISCH: erst "Ja" pausiert, mit der richtigen rundgang_id',
  rufe.some(r => r.p.includes('mein_rundgang_pausieren') && r.body && r.body.rundgang_id === 951));
check('Die Rückfrage ist danach zu', !(await page.isVisible('#rgsDlg')));
check('KRITISCH: die Seite zeigt den neuen Zustand "pausiert"',
  (await page.textContent('#rgsStatus')).includes('Rundgang pausiert'));
check('Der pausierte Zustand ist auch ohne Farbe erkennbar (hohler statt gefüllter Punkt)',
  await page.evaluate(() => {
    const el = document.querySelector('#rgsStatus .rgs-status-pkt');
    const s = getComputedStyle(el);
    return document.getElementById('rgsStatus').classList.contains('pause')
      && parseFloat(s.borderTopWidth) >= 1.5;
  }));
check('KRITISCH: aus der Funktion wird "Rundgang fortsetzen" -- pausieren geht nicht zweimal',
  (await page.textContent('#rgsModPause')).includes('Rundgang fortsetzen'));
await page.screenshot({ path: `${OUT}/rgpause-02-pausiert.png` });

// ══════════ FORTSETZEN: OHNE RÜCKFRAGE ════════════════════════════════
rufe = [];
await page.click('#rgsModPause');
await page.waitForTimeout(400);
check('KRITISCH: Fortsetzen braucht keine Rückfrage -- es macht die Sperre auf, statt sie zu setzen',
  !(await page.isVisible('#rgsDlg'))
  && rufe.some(r => r.p.includes('mein_rundgang_fortsetzen') && r.body && r.body.rundgang_id === 951));
check('Die Seite steht danach wieder auf "läuft"',
  (await page.textContent('#rgsStatus')).includes('Rundgang läuft'));
check('Und die Funktion heisst wieder "Rundgang pausieren"',
  (await page.textContent('#rgsModPause')).includes('Rundgang pausieren'));

// ══════════ DER FUSSKNOPF STARTET NICHT NEU ═══════════════════════════
// Die Runde 602 liegt ausserhalb ihres Zeitfensters (03:00-03:30). Fuehrte
// der Fussknopf weiterhin in rundgangSpontanWaehlen(), erschiene hier die
// Grundabfrage aus ENT-279 -- fuer eine Runde, die laengst laeuft.
rufe = [];
await page.click('#rgsStartBtn');
await page.waitForTimeout(500);
check('KRITISCH: bei laufender Runde wird kein zweiter Start versucht',
  !rufe.some(r => r.p.includes('mein_rundgang_spontan_starten')));
check('KRITISCH: und es wird kein Ausnahmegrund für etwas verlangt, das schon läuft',
  !(await page.isVisible('#rfsGrund')));
// Seit ENT-306 fuehrt "Zum Rundgang" in die laufende Runde als Vollseite --
// dieselbe Seite, andere Betriebsart: Reiterleiste statt Vorschau-Fuss.
// Seit ENT-331 oeffnet eine laufende Runde auf dem Kartenreiter. Geprueft
// wird hier, dass die Runde als Vollseite offen ist UND die Kontrollpunkte
// darin erreichbar sind -- darum der ausdrueckliche Reiterwechsel.
const vollseiteDa = await page.isVisible('#rgsReiter');
await page.evaluate(() => rgLaufReiter('punkte'));
await page.waitForTimeout(300);
check('Stattdessen öffnet sich die laufende Runde als Vollseite mit erreichbarer Checkliste',
  vollseiteDa && await page.evaluate(() => {
    const l = document.getElementById('rdListe');
    return !!l && l.textContent.includes('Eingang Nord');
  }));
check('Die Vorschau-Module sind dabei weg -- die Runde laeuft, sie wird nicht mehr angekuendigt',
  !(await page.isVisible('#rgsModPause')));

// ══════════ PAUSIEREN AUS DEM FUNKTIONEN-REITER ═══════════════════════
await page.click('#rgsRt-funktionen');
await page.waitForTimeout(200);
await page.click('#rgsLaufPause');
await page.waitForTimeout(200);
check('KRITISCH: auch aus dem Funktionen-Reiter kommt dieselbe Rueckfrage, nicht eine zweite Pause',
  await page.isVisible('#rgsDlg')
  && (await page.textContent('#rgsDlgFrage')) === 'Rundgang pausieren?');
await page.click('#rgsDlgJa');
await page.waitForTimeout(400);
check('KRITISCH: der laufende Rundgang übernimmt den pausierten Zustand',
  await page.evaluate(() => rundgangAktiv && rundgangAktiv.status === 'pausiert'));

// ══════════ KEIN SEITEN-SCROLL, DESKTOP MITGEPRÜFT ════════════════════
check('KRITISCH: kein waagrechter Seiten-Scroll bei 390px', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

await page.click('#rgsLaufPause');           // wieder fortsetzen, Ausgangslage
await page.waitForTimeout(400);
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);
await page.click('#rgsLaufPause');
await page.waitForTimeout(250);
check('Am Desktop erscheint dieselbe Rückfrage', await page.isVisible('#rgsDlg'));
check('KRITISCH: sie bleibt am Desktop innerhalb der App-Breite und wird nicht in die Breite gezogen',
  await page.evaluate(() => {
    const d = document.querySelector('.rgs-dlg-box').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return d.width <= s.width && d.width <= 341;
  }));
check('Sie steht mittig in der Seite, nicht am Rand (CLAUDE.md: mittig heisst mittig)',
  await page.evaluate(() => {
    const d = document.querySelector('.rgs-dlg-box').getBoundingClientRect();
    const s = document.getElementById('rgSeite').getBoundingClientRect();
    return Math.abs((d.left + d.width / 2) - (s.left + s.width / 2)) <= 1;
  }));
check('KRITISCH: am Desktop kein waagrechter Seiten-Scroll', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await page.screenshot({ path: `${OUT}/rgpause-03-desktop.png` });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
