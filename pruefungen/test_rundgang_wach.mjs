// Rundgang-Bildschirm: Fokus im Kopf, Bildschirm wach halten, Ortungsmarke
// (ENT-355).
//
// Drei Dinge, die der Projektinhaber am Echtbetrieb beanstandet hat, und
// eine, die dabei aufgefallen ist:
//
//  1. Im Kopf stand der Firmenname gross und die beiden Zahlen klein. Wer
//     auf der Runde aufs Handy schaut, will wissen, wie weit er ist und wie
//     lange er dran ist -- welchen Kunden er abgeht, weiss er.
//  2. Sperrt sich der Bildschirm, haelt das Geraet die Ortung an. Die Runde
//     bekommt eine Luecke, ohne dass ein Fehler auftaucht. Dagegen gibt es
//     jetzt einen Schalter -- AUS als Vorgabe, weil eine Runde im
//     Echtbetrieb ueber neun Stunden lief und ein leeres Geraet gar nicht
//     mehr ortet.
//  3. Die Zeile "Standort wird waehrend der Runde verfolgt" unter der Karte
//     nahm Hoehe weg. Sie ist keine Kosmetik (ENT-317), also verschwindet
//     sie nicht -- sie zieht als Marke auf die Karte.
//  4. Dabei aufgefallen: Steht die Ortung still, sah das bis hierher aus wie
//     eine laufende Ortung mit alter Position. "Unbekannt" darf nie wie
//     "bekannt" aussehen (CLAUDE.md) -- die Marke sagt es jetzt.
//
// Die Anbieterleiste von Google (Kartendaten-Hinweis und Nutzungsbedingungen)
// wird hier ausdruecklich MITGEPRUEFT: Sie darf nach den Nutzungsbedingungen
// von Google Maps Platform weder entfernt noch verdeckt werden. Die beiden
// Kartenknoepfe muessen darum Abstand zur Unterkante halten.
import { WURZEL, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ QUELLTEXT: was nicht wegoptimiert werden darf ═════════════
check('KRITISCH: die Anbieterleiste wird nirgends ausgeblendet',
  !/\.gm-style-cc[^}]*display\s*:\s*none/.test(APP)
  && !/gmnoprint[^}]*display\s*:\s*none/.test(APP)
  && !/a\[href\*=["']maps\.google[^}]*display\s*:\s*none/.test(APP));
check('KRITISCH: die Wachsperre wird nur waehrend einer laufenden Runde angefordert',
  /function rgWachAnfordern[\s\S]{0,600}?rgsModus !== 'lauf'[\s\S]{0,80}?return;/.test(APP));
check('KRITISCH: die Wachsperre wird beim Beenden der Ortung wieder freigegeben',
  /rgsOrtWache = null;[\s\S]{0,400}?rgWachFreigeben\(\);/.test(APP));
check('Die Vorgabe ist AUS -- gespeichert wird nur ein ausdrueckliches "an"',
  /function rgWachAn\(\)[\s\S]{0,200}?getItem\(RG_WACH_SCHLUESSEL\) === 'an'/.test(APP)
  && /catch \(e\) \{ return false; \}/.test(APP));
check('Beim Zurueckkommen aus dem Hintergrund wird die Sperre neu angefordert',
  /visibilitychange[\s\S]{0,200}?visibilityState === 'visible'[\s\S]{0,80}?rgWachAnfordern\(\)/.test(APP));

const RUNDE = { status: 'laeuft', einsatz_id: 71, rundgang_id: 5, name: 'Musterrunde',
  vorbereitet_am: tag(0) + ' 20:00:00', kontrollpunkte: [
  { id: 1, name: 'Tor Nord', reihenfolge: 1, erledigt: false, lat: 47.35, lng: 7.9, radius_m: 30, aufgaben: [] },
  { id: 2, name: 'Halle Ost', reihenfolge: 2, erledigt: false, lat: 47.351, lng: 7.901, radius_m: 30, aufgaben: [] },
  { id: 3, name: 'Rampe', reihenfolge: 3, erledigt: false, lat: 47.352, lng: 7.902, radius_m: 30, aufgaben: [] },
  { id: 4, name: 'Keller', reihenfolge: 4, erledigt: false, lat: 47.353, lng: 7.903, radius_m: 30, aufgaben: [] }] };
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4',
    ort: '9999 Musterdorf', einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(0),
    von: '20:00:00', bis: '06:00:00', status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(hoehe) {
  const page = await browser.newPage({ viewport: { width: 390, height: hoehe }, deviceScaleFactor: 2,
    permissions: ['geolocation'], geolocation: { latitude: 47.35, longitude: 7.9, accuracy: 8 } });
  // Eigene Wachsperre statt der echten: So laesst sich zaehlen, ob
  // angefordert und freigegeben wird -- unabhaengig davon, ob der
  // Pruefbrowser die Schnittstelle ueberhaupt mitbringt.
  await page.addInitScript(() => {
    window.__wach = { anfragen: 0, freigaben: 0, offen: 0 };
    // defineProperty und nicht einfach zuweisen: Chromium bringt
    // navigator.wakeLock selbst mit, als Nur-Lese-Eigenschaft am Prototyp.
    // Eine schlichte Zuweisung geht dort lautlos ins Leere -- die Pruefung
    // haette dann die ECHTE Sperre benutzt und nichts gezaehlt.
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__wach.anfragen++; window.__wach.offen++;
      return { release: async () => { window.__wach.freigaben++; window.__wach.offen--; },
               addEventListener: () => {} };
    } } });
  });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname.split('/api/')[1];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
    if (p.includes('meine_schichten')) return send(SCHICHTEN);
    if (p.includes('mein_profil')) return send(PROFIL);
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: JSON.parse(JSON.stringify(RUNDE)) });
    if (p.includes('mein_rundgang_uebersicht')) return send({ status: 'ok',
      objekt: { id: 7, name: 'Musterobjekt', strasse: 'Musterweg 4', ort: '9999 Musterdorf' },
      vorlage: { id: 3, name: 'Musterrunde Quartier' },
      kontrollpunkte: RUNDE.kontrollpunkte, laufend: null });
    return send({ status: 'ok' });
  });
  await page.route('**maps.googleapis.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('.app.on'); await page.waitForTimeout(400);
  return page;
}

const masse = page => page.evaluate(() => {
  const g = s => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height,
             fs: parseFloat(c.fontSize), fw: parseInt(c.fontWeight, 10) }; };
  return { titel: g('#rgsTitel'), zaehler: g('#rgsZaehler'), timer: g('#rgsTimer'),
           zChip: g('#rgsZaehlerChip'), tChip: g('#rgsTimerChip'), zeilen: g('#rgsZchips'),
           chip: g('#rgsOrtChip'), kopf: g('.rgs-kopf'), reiter: g('.rgs-reiter'),
           zVerankerung: (() => { const e = document.getElementById('rgsZchips');
             return e ? getComputedStyle(e).position : null; })(),
           huelle: g('.rgs-karte-huelle'), zen: g('#rgsZentrieren'), nacht: g('#rgsNachtsicht'),
           zeile: !!document.getElementById('rgsOrtungHinweis') };
});

// ══════════ KOPF: der Fokus liegt auf den Zahlen ══════════════════════
let page = await seite(844);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1500);
await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
let m = await masse(page);

// Zuerst: sind die Bauteile ueberhaupt da? Ohne diese Pruefung wuerde eine
// fehlende Marke die naechste Pruefung in einen Fehler laufen lassen -- und
// eine abgestuerzte Suite meldet gar keine rote Pruefung, sie meldet nichts.
// Genau so ist eine Gegenprobe in dieser Sitzung durchgerutscht.
for (const [nm, el] of [['Titel', m.titel], ['Zaehler', m.zaehler], ['Laufzeit', m.timer],
    ['Zaehler-Chip', m.zChip], ['Laufzeit-Chip', m.tChip], ['Chipzeile', m.zeilen],
    ['Ortungsmarke', m.chip], ['Kartenhuelle', m.huelle], ['Kopf', m.kopf],
    ['Reiterleiste', m.reiter], ['Zentrieren', m.zen], ['Nachtsicht', m.nacht]]) {
  check(`KRITISCH: das Bauteil "${nm}" ist auf dem Bildschirm vorhanden`, !!el);
}

// ══════════ DIE KARTE IST DAS ZENTRALE ELEMENT ════════════════════════
// REVIDIERT durch ENT-361. ENT-355 stellte Zaehler und Laufzeit gross in
// einer eigenen Zeile unter dem Kopf heraus -- und verbrauchte damit rund
// 146 px fuer zwei Zahlen. Der Projektinhaber, woertlich: "Hier hast du
// leider viiiel zu viel Platz verschenkt! Die Karte ist das zentrale
// Element." Die Zahlen liegen jetzt ALS UEBERLAGERUNG auf der Karte; eine
// Ueberlagerung kostet keine Layouthoehe.
//
// Diese Pruefungen sind darum nicht gelockert, sondern umgedreht: Frueher
// wurde geprueft, dass die Zahlen gross sind. Jetzt wird geprueft, dass die
// Karte den Platz hat UND die Zahlen trotzdem lesbar bleiben.
check('KRITISCH: die Karte beginnt direkt unter dem Kopf -- kein Leerraum dazwischen',
  Math.abs(m.huelle?.t - m.kopf?.b) <= 2);
check('KRITISCH: die Karte reicht bis an die Reiterleiste -- kein Leerraum darunter',
  Math.abs(m.reiter?.t - m.huelle?.b) <= 2);
check('KRITISCH: die Chips liegen innerhalb der Kartenflaeche',
  m.zChip?.t >= m.huelle?.t && m.zChip?.b <= m.huelle?.b
  && m.tChip?.t >= m.huelle?.t && m.tChip?.b <= m.huelle?.b);
// Getrennte Pruefung, und zwar an der gemessenen Verankerung: Dass die Chips
// im Kartenbereich LIEGEN, sagt noch nicht, dass sie dort ueberlagern -- im
// Fluss stuenden sie an fast derselben Stelle und saehen beinahe gleich aus.
// Genau das hat eine Gegenprobe aufgedeckt: Sie stellte die Chips von
// "absolute" auf "static", und die Lage-Pruefung blieb gruen.
check('KRITISCH: die Chips ueberlagern die Karte, statt im Fluss zu stehen',
  m.zVerankerung === 'absolute');
check('KRITISCH: die Karte nimmt den groessten Teil des Bildschirms ein',
  m.huelle?.h > (m.reiter?.b || 0) * 0.7);

// Lesbar heisst nicht gross: Die Werte sind bewusst kleiner als in ENT-355
// (16 statt 25 px), duerfen aber nicht wieder auf Chipgroesse zurueckfallen.
check('Zaehler und Laufzeit bleiben gut lesbar',
  m.zaehler?.fs >= 15 && m.timer?.fs >= 15);
check('KRITISCH: sie spielen sich aber nicht mehr auf -- hoechstens 18 px',
  m.zaehler?.fs <= 18 && m.timer?.fs <= 18);
check('Beide Zahlen sind gleich gross -- keine ist wichtiger als die andere',
  Math.abs(m.zaehler?.fs - m.timer?.fs) < 0.5);
check('Beide stehen auf derselben Hoehe',
  Math.abs(m.zaehler?.t - m.timer?.t) < 1);
check('KRITISCH: der Firmenname tritt hinter die Zahlen zurueck',
  m.titel?.fs < m.zaehler?.fs);
check('Er bleibt trotzdem lesbar -- zurueckgenommen ist nicht dasselbe wie weg',
  m.titel?.fs >= 12 && m.titel?.h > 10 && m.titel?.w > 100);
check('Der Kopf beansprucht nicht mehr als eine Zeile plus Trefferflaeche',
  m.kopf?.h <= 64);

// ══════════ KARTE: Knoepfe tiefer, Anbieterleiste frei ════════════════
check('KRITISCH: die Zeile unter der Karte ist weg -- die Karte hat die Hoehe',
  m.zeile === false);
check('KRITISCH: die Ortungsmarke steht auf der Karte',
  !!m.chip && m.chip.h > 16 && m.chip.t >= m.huelle?.t && m.chip.b <= m.huelle?.b);
check('KRITISCH: die Ortungsmarke verdeckt die beiden Zahlen nicht',
  m.chip?.t >= m.zChip?.b && m.chip?.t >= m.tChip?.b);
check('KRITISCH: beide Kartenknoepfe halten Abstand zur Anbieterleiste am unteren Rand',
  m.huelle?.b - m.zen?.b >= 24 && m.huelle?.b - m.nacht?.b >= 24);
check('Die Knoepfe sitzen trotzdem tief -- weiter unten als die halbe Karte',
  m.zen?.t > m.huelle?.t + m.huelle?.h / 2 && m.nacht?.t > m.huelle?.t + m.huelle?.h / 2);
check('Beide Kartenknoepfe behalten 44 px Trefferflaeche (CLAUDE.md)',
  m.zen?.h >= 44 && m.nacht?.h >= 44);
check('Marke und Knoepfe ueberlappen sich nicht',
  m.chip?.b < m.zen?.t && m.chip?.b < m.nacht?.t);
check('Die Zahlen und die Knoepfe ueberlappen sich nicht',
  m.zChip?.b < m.zen?.t && m.tChip?.b < m.nacht?.t);

// ══════════ REITER OHNE KARTE ════════════════════════════════════════
// Dort gibt es nichts zu ueberlagern -- die Chips stehen im Fluss, und der
// Vollflaechen-Modus der Karte muss wieder abgeraeumt sein. Eine Gegenprobe
// hat gezeigt, dass genau das vorher ungeprueft war: Blieb die Klasse
// stehen, klebte die Liste ohne Luft am Kopf, und keine Pruefung merkte es.
await page.click('#rgsRt-punkte'); await page.waitForTimeout(600);
const liste = await page.evaluate(() => {
  const z = document.getElementById('rgsZchips');
  const k = document.querySelector('.rgs-kopf');
  const bd = document.getElementById('rgsBody');
  const erstes = bd && bd.firstElementChild;
  return { chips: !!z, verankerung: z ? getComputedStyle(z).position : null,
           luft: (erstes && k) ? erstes.getBoundingClientRect().top - k.getBoundingClientRect().bottom : -1,
           vollNoch: !!bd && bd.classList.contains('voll'),
           links: erstes ? erstes.getBoundingClientRect().left : -1 };
});
check('KRITISCH: auf dem Punkte-Reiter stehen dieselben Zahlen als Zeile',
  liste.chips === true);
check('Dort stehen sie im Fluss, nicht als Ueberlagerung',
  liste.verankerung !== 'absolute');
check('KRITISCH: der Vollflaechen-Modus der Karte ist dort wieder abgeraeumt',
  liste.vollNoch === false);
check('KRITISCH: zwischen Kopf und Inhalt bleibt Luft -- die Liste klebt nicht am Kopf',
  liste.luft >= 10);
check('Und sie klebt auch nicht am linken Rand',
  liste.links >= 12);

// ══════════ WACH HALTEN ═══════════════════════════════════════════════
await page.click('#rgsRt-funktionen'); await page.waitForTimeout(500);
check('KRITISCH: der Schalter "Bildschirm wach halten" steht unter Funktionen',
  await page.isVisible('#rgsLaufWach'));
check('Er steht auf AUS, ohne dass jemand etwas eingestellt hat',
  (await page.textContent('#rgsLaufWachZust')).trim() === 'Aus'
  && await page.getAttribute('#rgsLaufWach', 'aria-pressed') === 'false');
check('KRITISCH: solange er aus ist, wird keine Sperre angefordert',
  await page.evaluate(() => window.__wach.anfragen) === 0);
check('Daneben steht, was die Einstellung bringt und was sie kostet',
  (await page.textContent('#rgsLaufWachTxt')).includes('Akku'));
const wachBtn = await page.evaluate(() => {
  const r = document.getElementById('rgsLaufWach').getBoundingClientRect(); return r.height; });
check('Der Schalter hat 44 px Trefferflaeche', wachBtn >= 44);

await page.click('#rgsLaufWach'); await page.waitForTimeout(500);
check('KRITISCH: Einschalten fordert die Sperre tatsaechlich an',
  await page.evaluate(() => window.__wach.anfragen) >= 1
  && await page.evaluate(() => window.__wach.offen) === 1);
check('Der Schalter zeigt danach EIN -- mit Wort, nicht nur mit Farbe',
  (await page.textContent('#rgsLaufWachZust')).trim() === 'Ein'
  && await page.getAttribute('#rgsLaufWach', 'aria-pressed') === 'true');
check('Die Wahl bleibt auf dem Geraet',
  await page.evaluate(() => localStorage.getItem('sop_rundgang_wachhalten')) === 'an');

await page.click('#rgsLaufWach'); await page.waitForTimeout(500);
check('KRITISCH: Ausschalten gibt die Sperre wieder frei',
  await page.evaluate(() => window.__wach.freigaben) >= 1
  && await page.evaluate(() => window.__wach.offen) === 0);

// Wieder ein, dann Runde verlassen: die Sperre darf die Runde nicht ueberdauern.
await page.click('#rgsLaufWach'); await page.waitForTimeout(400);
check('Vor dem Verlassen ist die Sperre offen',
  await page.evaluate(() => window.__wach.offen) === 1);
await page.evaluate(() => rgSeiteZu()); await page.waitForTimeout(600);
check('KRITISCH: die Wachsperre ueberdauert die Runde nicht',
  await page.evaluate(() => window.__wach.offen) === 0);
await page.close();

// ══════════ ORTUNGSMARKE: der Zustand "steht" ═════════════════════════
page = await seite(844);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1500);
await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
check('Solange Positionen kommen, meldet die Marke eine laufende Ortung',
  ((await page.textContent('#rgsOrtChip').catch(() => '')) || '').includes('Ortung läuft'));
// Position kuenstlich altern lassen -- genau der Fall "Bildschirm war gesperrt".
await page.evaluate(() => { rgsMeinOrt.zeit = Date.now() - 4 * 60000; rgLaufKopfZeichnen(); });
await page.waitForTimeout(300);
const steht = await page.evaluate(() => {
  const c = document.getElementById('rgsOrtChip');
  if (!c) { return { text: '', warn: false, titel: '' }; }
  return { text: (c.textContent || '').trim(), warn: c.classList.contains('steht'),
           titel: c.getAttribute('title') || '' };
});
check('KRITISCH: steht die Ortung still, sagt die Marke es -- statt eine alte Position als aktuell auszugeben',
  steht.text.includes('Ortung steht seit') && /\b4\b/.test(steht.text));
check('Sie wechselt dabei in die Warnfarbe -- das ist eine Aussage ueber die Datenqualitaet',
  steht.warn === true);
check('Und sie sagt, was dagegen hilft, statt nur zu diagnostizieren',
  steht.titel.includes('wach halten'));
// Der Punkte-Reiter hat keine Karte -- dort muss dieselbe Aussage als Zeile stehen.
await page.click('#rgsRt-punkte'); await page.waitForTimeout(500);
check('KRITISCH: auch auf dem Punkte-Reiter faellt die stehende Ortung auf',
  (await page.textContent('#rgsOrtungHinweis')).includes('Ortung steht seit'));
await page.close();

// ══════════ VORSCHAU: dort ist der Name die Hauptsache ════════════════
page = await seite(844);
await page.evaluate(() => ladeSchichten());
await page.waitForTimeout(600);
// Die Vorschau muss geoeffnet werden, sonst prueft der Abschnitt einen
// Bildschirm, den es gar nicht gibt. Genau das war hier der Fall: Eine
// Gegenprobe schob der Vorschau Chips unter und nichts wurde rot -- weil
// die Vorschau nie gezeichnet wurde.
await page.evaluate(() => rgSeiteOeffnen(3));
await page.waitForTimeout(900);
check('KRITISCH: die Vorschau ist ueberhaupt geoeffnet -- sonst prueft der Rest nichts',
  await page.evaluate(() => document.getElementById('rgSeite').classList.contains('on')
    && (document.getElementById('rgsTitel').textContent || '').length > 1));
const vorschau = await page.evaluate(() => {
  const t = document.getElementById('rgsTitel');
  return { fs: t ? parseFloat(getComputedStyle(t).fontSize) : 0,
           zahlenWeg: !document.getElementById('rgsZchips'),
           klasseWeg: !document.getElementById('rgSeite')?.classList.contains('zahlen') };
});
check('KRITISCH: ohne laufende Runde bleibt der Titel gross -- dort gibt es keine Zahlen, die vorgehen',
  vorschau.zahlenWeg === true && vorschau.fs >= 16);
check('Und die Seite fuehrt sich auch innerlich nicht als laufende Runde',
  vorschau.klasseWeg === true);
await page.close();

// ══════════ KLEINE BILDSCHIRME ════════════════════════════════════════
for (const h of [720, 660, 600]) {
  page = await seite(h);
  await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
  await page.waitForTimeout(1500);
  await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
  const k = await masse(page);
  check(`${h} px: die Zahlen bleiben lesbar und werden nicht zusammengedrueckt`,
    k.zaehler?.fs >= 15 && k.timer?.fs >= 15 && k.zChip?.h >= 30);
  check(`${h} px: die Karte bekommt weiterhin den ganzen Rumpf`,
    Math.abs(k.huelle?.t - k.kopf?.b) <= 2 && Math.abs(k.reiter?.t - k.huelle?.b) <= 2);
  check(`${h} px: die Knoepfe halten weiterhin Abstand zur Anbieterleiste`,
    k.huelle?.b - k.zen?.b >= 24 && k.huelle?.b - k.nacht?.b >= 24);
  check(`${h} px: Zahlen und Ortungsmarke liegen im Bild und ueberlappen sich nicht`,
    !!k.chip && k.chip.t >= k.huelle?.t && k.chip.b <= k.huelle?.b
    && k.chip.t >= k.zChip?.b && k.zChip?.b < k.zen?.t);
  await page.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
