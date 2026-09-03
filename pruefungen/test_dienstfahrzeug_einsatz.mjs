// Dienstfahrzeug und Fahrer am Einsatz (ENT-325, Schritt 2 aus ENT-313).
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. AM FAHRER HAENGT GELD. Wer das Geschaeftsfahrzeug fuehrt, bekommt
//    Fahrzeitersatz, aber KEINEN Fahrkostenersatz (Art. 18 Ziff. 4/5,
//    auslagen.php). Stuende am Einsatz ein Fahrer und an seiner Zuteilung ein
//    anderes Verkehrsmittel, rechnete der Abgleich einen Fahrkostenersatz
//    fuer ein Auto, das dem Betrieb selbst gehoert. Diese Kopplung wird hier
//    WIRKLICH AUSGEFUEHRT (pruef_dienstfahrzeug.php), nicht nachgebaut.
//
// 2. DIE UEBRIGEN EINGETEILTEN BLEIBEN UNBERUEHRT. Dass sie mitfahren, waere
//    eine Annahme -- sie koennen mit dem eigenen Auto oder dem Zug direkt zum
//    Einsatzort kommen. Eine Automatik, die ihnen 'Mitfahrer' setzt, waere
//    eine erfundene Tatsache mit Geldfolge.
//
// 3. "NICHT EINGERICHTET" IST NICHT "KEIN FAHRZEUG". Vor dem naechsten
//    Einrichtungslauf gibt es die Spalten nicht; einsatz_list.php laesst den
//    Schluessel dann GANZ weg, und die Oberflaeche sagt das auch so.
//
// 4. DIE ERWARTETE FAHRSTRECKE IST EINE ANZEIGE, KEIN GESPEICHERTER WERT --
//    und sie gilt nur, wenn das Fahrzeug am Hauptanstellungsort steht. Sonst
//    heisst sie "nicht bestimmbar", niemals "0 km" (OP-316).
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const HEUTE = iso(new Date());

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Die Regeln laufen wirklich (PHP, SQLite im Arbeitsspeicher)
// ══════════════════════════════════════════════════════════════════════════
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_dienstfahrzeug.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpBeanstandet = phpAus.split('\n').filter(z => z.trim().startsWith('X '));
check('KRITISCH: die Fahrzeug- und Fahrerregeln laufen fehlerfrei durch',
  phpCode === 0 && phpBeanstandet.length === 0);
check('Sie werden in mindestens 12 Faellen geprueft',
  Number((phpAus.match(/^(\d+) Pruefungen bestanden/m) || [0, 0])[1]) >= 12);
phpBeanstandet.forEach(z => bad.push('PHP: ' + z.trim()));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Was sich nur am Quelltext zeigt
// ══════════════════════════════════════════════════════════════════════════
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');
const SAVE = readFileSync(`${WURZEL}/backend/api/einsatz_save.php`, 'utf8');
const FZEP = readFileSync(`${WURZEL}/backend/api/einsatz_fahrzeug.php`, 'utf8');
const VM   = readFileSync(`${WURZEL}/backend/api/einsatz_verkehrsmittel.php`, 'utf8');
const FZ   = readFileSync(`${WURZEL}/backend/api/fahrzeuge.php`, 'utf8');
const LIST = readFileSync(`${WURZEL}/backend/api/einsatz_list.php`, 'utf8');

check('KRITISCH: die Spalten fahrzeug_id und fahrer_id werden nachgetragen',
  /ADD COLUMN fahrzeug_id INT NULL/.test(EINR) && /ADD COLUMN fahrer_id INT NULL/.test(EINR));

// EINE Pruefstelle fuer beide Schreibwege -- zwei eigene Regeln waeren zwei
// Wahrheiten darueber, welche Kombination zulaessig ist.
check('KRITISCH: beide Schreibwege benutzen dieselbe Pruefung aus planung.php',
  /einsatz_fahrzeug_pruefen\(/.test(SAVE) && /einsatz_fahrzeug_pruefen\(/.test(FZEP));
check('KRITISCH: beide setzen die Verkehrsmittel-Folge des Fahrers',
  /einsatz_fahrer_verkehrsmittel_setzen\(/.test(SAVE)
  && /einsatz_fahrer_verkehrsmittel_setzen\(/.test(FZEP));

// Eine abgeglichene Schicht ist festgeschrieben (ENT-045). Am Fahrer haengt
// der Fahrkostenersatz, und der ist beim Abgleich bereits erfasst.
check('KRITISCH: der neue Endpunkt ruft die Sperre fuer abgeglichene Schichten',
  /einsatz_sperre_pruefen\(/.test(FZEP));

// ENT-115-Muster: Die Bearbeiten-Schublade kennt die Felder nicht. Wuerden
// sie unbesehen gelesen, leerte jedes Speichern von dort die Zuteilung.
check('KRITISCH: fahrzeug_id wird nur angefasst, wenn die Anfrage es wirklich schickt',
  /array_key_exists\('fahrzeug_id', \$input\)/.test(SAVE));
check('KRITISCH: geschrieben wird in einer EIGENEN Anweisung, nicht in der festen Spaltenliste',
  /UPDATE einsaetze SET fahrzeug_id = \?, fahrer_id = \? WHERE id = \?/.test(SAVE));

check('KRITISCH: ein abweichendes Verkehrsmittel des Fahrers wird serverseitig abgewiesen',
  /fahrer_id/.test(VM) && /Geschaeftsfahrzeug/.test(VM) && /409/.test(VM));
check('KRITISCH: ein eingeteiltes Fahrzeug laesst sich nicht loeschen',
  /SELECT COUNT\(\*\) FROM einsaetze WHERE fahrzeug_id = \?/.test(FZ));
check('KRITISCH: die Liste faellt ohne die Spalten nicht aus, sondern laesst sie weg',
  /hat_spalte\(db\(\), 'einsaetze', 'fahrzeug_id'\)/.test(LIST));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Die Oberflaeche
// ══════════════════════════════════════════════════════════════════════════
const ORTE = [{ id: 1, bezeichnung: 'Hauptsitz', rolle: 'hao', strasse: 'Musterweg 1',
  plz: '4600', ort: 'Olten', km_zum_anderen: null, aktiv: 1, bemerkung: null }];
const FAHRZEUGE = [
  { id: 1, kennzeichen: 'SO 999001', bezeichnung: 'Patrouille 1', marke: 'Muster', modell: 'Kombi',
    art: 'kombi', status: 'aktiv', standort_id: 1, standort_name: 'Hauptsitz',
    besitzart: 'eigentum', besitz_bis: null, treibstoff: null, farbe: null, stammnummer: null,
    fahrgestellnummer: null, erstzulassung: null, ausser_betrieb_grund: null, mfk_naechste: null,
    vignette_jahr: null, versicherung: null, police_nr: null, service_naechster: null,
    service_naechste_km: null, tacho_km: null, tacho_am: null, bemerkung: null },
  // Ohne Standort: der Erwartungswert ist damit nicht bestimmbar.
  { id: 2, kennzeichen: 'SO 999002', bezeichnung: 'Ersatzwagen', marke: null, modell: null,
    art: 'personenwagen', status: 'aktiv', standort_id: null, standort_name: null,
    besitzart: 'eigentum', besitz_bis: null, treibstoff: null, farbe: null, stammnummer: null,
    fahrgestellnummer: null, erstzulassung: null, ausser_betrieb_grund: null, mfk_naechste: null,
    vignette_jahr: null, versicherung: null, police_nr: null, service_naechster: null,
    service_naechste_km: null, tacho_km: null, tacho_am: null, bemerkung: null },
  // Ausser Betrieb: darf gar nicht erst zur Wahl stehen.
  { id: 3, kennzeichen: 'SO 999003', bezeichnung: 'In der Werkstatt', marke: null, modell: null,
    art: 'personenwagen', status: 'ausser_betrieb', standort_id: 1, standort_name: 'Hauptsitz',
    besitzart: 'eigentum', besitz_bis: null, treibstoff: null, farbe: null, stammnummer: null,
    fahrgestellnummer: null, erstzulassung: null, ausser_betrieb_grund: 'Service', mfk_naechste: null,
    vignette_jahr: null, versicherung: null, police_nr: null, service_naechster: null,
    service_naechste_km: null, tacho_km: null, tacho_am: null, bemerkung: null },
];
const MA = [
  { id: 11, name: 'ab', vorname: 'Anna', nachname: 'Muster', aktiv: 1, verkehrsmittel: 'Privatfahrzeug' },
  { id: 12, name: 'cd', vorname: 'Beat', nachname: 'Beispiel', aktiv: 1, verkehrsmittel: 'Privatfahrzeug' },
];
const zut = ids => ids.map(i => {
  const m = MA.find(x => x.id === i);
  return { id: m.id, name: m.name, vorname: m.vorname, nachname: m.nachname, zusage: 'offen',
    gesehen_am: null, personalnummer: null, ist_status: 'offen', ist_von: null, ist_bis: null,
    ist_pause_von: null, ist_pause_min: null, ist_pause_bezahlt_ma: null,
    ist_pause_bezahlt_kunde: null, ist_bemerkung: null, abgeglichen_am: null };
});
const grund = {
  kunde_id: null, objekt_id: null, masterschicht_id: null, serie_id: null, titel: null,
  strasse: 'Baustelle 5', ort: '4600 Olten', kanton: 'SO', einsatzart: 'Verkehrsdienst',
  sparte: 'sicherheit', datum: HEUTE, von: '08:00:00', bis: '12:00:00', bedarf: 2,
  status: 'geplant', bemerkung: null, erstellt_am: null, spontan_erzeugt: false,
  veranstaltung: null, treffpunkt: null, taetigkeit: null, qualifikation: null,
  kontakt_vorname: null, kontakt_nachname: null, kontakt_telefon: null,
  weg_minuten: 30, weg_adresse: 'Baustelle 5, 4600 Olten',
  ist_status: 'offen', ist_von: null, ist_bis: null, ist_pause_von: null, ist_pause_min: null,
  ist_pause_bezahlt_ma: null, ist_pause_bezahlt_kunde: null, ist_bemerkung: null,
  abgeglichen_am: null, hat_unterschrift: 0, unterzeichner: null, unterschrift_am: null,
};
const EINSAETZE = [
  // 71: Fahrzeug am Hauptanstellungsort -> Erwartungswert bestimmbar (2 x 24)
  { ...grund, id: 71, kunde_name: 'Muster AG', weg_km: 24, fahrzeug_id: 1, fahrer_id: 11,
    mitarbeiter: zut([11, 12]) },
  // 72: noch kein Fahrzeug eingeteilt
  { ...grund, id: 72, kunde_name: 'Muster AG', weg_km: 24, fahrzeug_id: null, fahrer_id: null,
    mitarbeiter: zut([11, 12]) },
  // 73: Fahrzeug ohne Standort -> nicht bestimmbar, ausdruecklich nicht "0 km"
  { ...grund, id: 73, kunde_name: 'Muster AG', weg_km: 24, fahrzeug_id: 2, fahrer_id: 12,
    mitarbeiter: zut([11, 12]) },
  // 74: die Einrichtung ist noch nicht gelaufen -- die Schluessel FEHLEN ganz
  { ...grund, id: 74, kunde_name: 'Muster AG', weg_km: 24, mitarbeiter: zut([11, 12]) },
];
delete EINSAETZE[3].fahrzeug_id; delete EINSAETZE[3].fahrer_id;

const POS = {};
let posSeq = 500;
const gesendet = [];
const einsatzVon = id => EINSAETZE.find(e => Number(e.id) === Number(id));
function positionen(e) {
  if (POS[e.id]) { return POS[e.id]; }
  POS[e.id] = (e.mitarbeiter || []).map((m, i) => ({
    id: ++posSeq, nr: i + 1, funktion: e.einsatzart, position: null, von: e.von, bis: e.bis,
    std_verrechnung: null, pauschal: null, qualifikation: null, gesperrt: 0, bemerkung: null,
    mitarbeiter_id: Number(m.id), mitarbeiter: m.name, vorname: m.vorname, nachname: m.nachname,
    zusage: 'offen', gesehen_am: null,
    verkehrsmittel: Number(m.id) === Number(e.fahrer_id) ? 'Geschaeftsfahrzeug' : null,
    oev_rappen: null,
  }));
  return POS[e.id];
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), p = req.url().split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  if (body) { gesendet.push({ p, body }); }
  const s = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (p.includes('login')) return s({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('me.php')) return s({ status: 'ok', name: 'adrian', ist_admin: true,
    rollen: ['verwaltung'], rechte: ['betrieb', 'plan', 'kunden', 'abgleich', 'personal_lesen'] });
  if (p.includes('mitarbeiter_list')) return s({ status: 'ok', mitarbeiter: MA });
  if (p.includes('anstellungsorte')) return s({ status: 'ok', orte: ORTE });
  if (p.includes('fahrzeuge.php')) return s({ status: 'ok', eingerichtet: true, fahrzeuge: FAHRZEUGE });
  if (p.includes('einsatz_list')) return s({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_position')) {
    const e = einsatzVon(body ? body.einsatz_id : 0);
    return s({ status: 'ok', positionen: e ? positionen(e) : [] });
  }
  if (p.includes('einsatz_fahrzeug')) {
    const e = einsatzVon(body.einsatz_id);
    const fz = body.fahrzeug_id === '' ? null : Number(body.fahrzeug_id);
    const fa = body.fahrer_id === '' ? null : Number(body.fahrer_id);
    if (e) { e.fahrzeug_id = fz; e.fahrer_id = fa; }
    return s({ status: 'ok', fahrzeug_id: fz, fahrer_id: fa });
  }
  if (p.includes('einsatz_save')) return s({ status: 'ok', id: 99, zugeteilt: 1, serie_id: null });
  if (p.includes('dashboard_stats')) return s({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [],
    pro_mitarbeiter: [], letzte_rapporte: [], sperr_ereignisse: [] });
  return s({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [], gepflegt: {},
    sperren: [], adressen: [], wege: [], fahrzeuge: [], dokumente: [], positionen: [], orte: [],
    kunden: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(700);

// ── Anlegen-Ansicht: das Feld, das ENT-115 zurueckgestellt hatte ──────────
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(600);

check('KRITISCH: die Anlegen-Ansicht hat ein Feld fuer das Dienstfahrzeug',
  await page.isVisible('#enNFahrzeug_id'));
check('KRITISCH: ohne Fahrzeug laesst sich kein Fahrer bestimmen',
  await page.evaluate(() => document.getElementById('enNFahrer_id').disabled));
check('Und es steht dabei, warum',
  /Ohne Dienstfahrzeug wird kein Fahrer bestimmt/.test(await page.textContent('#enNFahrerHinweis')));
check('KRITISCH: ein Fahrzeug ausser Betrieb steht gar nicht erst zur Wahl',
  !/999003/.test(await page.textContent('#enNFahrzeug_id')));
check('Die Fahrzeuge im Betrieb stehen zur Wahl',
  /999001/.test(await page.textContent('#enNFahrzeug_id'))
  && /999002/.test(await page.textContent('#enNFahrzeug_id')));

// Erst zuteilen, dann Fahrzeug waehlen.
await page.evaluate(() => pickRender('enN', [11, 12], null));
await page.waitForTimeout(200);
await page.selectOption('#enNFahrzeug_id', '1');
await page.waitForTimeout(250);
check('KRITISCH: mit Fahrzeug laesst sich ein Fahrer bestimmen',
  !(await page.evaluate(() => document.getElementById('enNFahrer_id').disabled)));
check('KRITISCH: zur Wahl stehen nur die zugeteilten Personen',
  /Anna Muster/.test(await page.textContent('#enNFahrer_id'))
  && /Beat Beispiel/.test(await page.textContent('#enNFahrer_id')));
check('KRITISCH: die Geldfolge steht dabei — Fahrzeitersatz ja, Fahrkostenersatz nein',
  /Fahrkostenersatz nein/.test(await page.textContent('#enNFahrerHinweis')));
check('Und dass die uebrigen Eingeteilten unberuehrt bleiben',
  /übrigen Eingeteilten bleiben unberührt/.test(await page.textContent('#enNFahrerHinweis')));

await page.selectOption('#enNFahrer_id', '12');
await page.waitForTimeout(150);
// Wer aus der Zuteilung faellt, darf nicht als Fahrer stehenbleiben.
await page.evaluate(() => pickRender('enN', [11], null));
await page.waitForTimeout(250);
check('KRITISCH: wer aus der Zuteilung faellt, bleibt nicht als Fahrer stehen',
  (await page.inputValue('#enNFahrer_id')) !== '12');
check('Die verbliebene Person steht weiter zur Wahl',
  /Anna Muster/.test(await page.textContent('#enNFahrer_id')));

await page.selectOption('#enNFahrer_id', '11');
await page.fill('#enNKunde_name', 'Muster AG');
await page.fill('#enNStrasse', 'Baustelle 5');
await page.fill('#enNOrt', '4600 Olten');
await page.selectOption('#enNKanton', 'SO');
// enNVon/enNBis sind versteckte Felder hinter der Zeitwahl (zeitwahl.js) --
// sie werden gesetzt wie von der Zeitwahl selbst, nicht getippt.
await page.evaluate(() => {
  const setz = (id, wert) => {
    const el = document.getElementById(id);
    el.value = wert;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setz('enNVon', '08:00');
  setz('enNBis', '12:00');
});
await page.waitForTimeout(200);
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(500);
const gespeichert = gesendet.filter(g => g.p.includes('einsatz_save')).pop();
check('KRITISCH: Fahrzeug und Fahrer gehen mit dem Einsatz an den Server',
  !!gespeichert && String(gespeichert.body.fahrzeug_id) === '1'
  && String(gespeichert.body.fahrer_id) === '11');

// ── Einsatzplan: Block, Erwartungswert, gesperrtes Verkehrsmittel ────────
async function oeffne(id) {
  await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
  await page.waitForTimeout(400);
  await page.evaluate(i => epAuf(i), id);
  await page.waitForTimeout(800);
}

await oeffne(71);
const kopf71 = (await page.textContent('#epKopf')).replace(/\s+/g, ' ');
check('KRITISCH: der Einsatzplan zeigt Dienstfahrzeug und Fahrer',
  /Dienstfahrzeug und Fahrer/.test(kopf71));
check('KRITISCH: die erwartete Fahrstrecke ist Hin- und Rueckweg — 2 × 24 km',
  /Erwartete Fahrstrecke: 48[.,]0 km/.test(kopf71));
check('Sie sagt dazu, dass sie kein gespeicherter Wert ist',
  /kein gespeicherter Wert/.test(kopf71));
check('KRITISCH: das Verkehrsmittel des Fahrers steht fest und ist nicht bedienbar',
  await page.evaluate(() => {
    const sel = document.querySelector('[data-vm-ma="11"]');
    return !!sel && sel.disabled;
  }));
check('KRITISCH: das Verkehrsmittel der uebrigen bleibt bedienbar',
  await page.evaluate(() => {
    const sel = document.querySelector('[data-vm-ma="12"]');
    return !!sel && !sel.disabled;
  }));
check('Beim Fahrer steht, warum das Feld feststeht',
  /fährt das Dienstfahrzeug/.test(kopf71));

// Zuteilen im Einsatzplan geht an den eigenen Endpunkt, nicht ueber den
// ganzen Einsatz -- sonst ueberschriebe es jedes dort fehlende Feld.
await page.selectOption('#epFahrzeug', '2');
await page.waitForTimeout(500);
const fzRuf = gesendet.filter(g => g.p.includes('einsatz_fahrzeug')).pop();
check('KRITISCH: die Aenderung geht an einsatz_fahrzeug.php, nicht an einsatz_save.php',
  !!fzRuf && String(fzRuf.body.fahrzeug_id) === '2');

await oeffne(73);
const kopf73 = (await page.textContent('#epKopf')).replace(/\s+/g, ' ');
check('KRITISCH: ohne Standort am Fahrzeug heisst die Strecke "nicht bestimmbar" — nicht "0 km"',
  /Erwartete Fahrstrecke: nicht bestimmbar/.test(kopf73) && !/0[.,]0 km/.test(kopf73));
check('Und der Grund steht dabei',
  /kein Standort hinterlegt/.test(kopf73));

await oeffne(72);
const kopf72 = (await page.textContent('#epKopf')).replace(/\s+/g, ' ');
check('Ohne eingeteiltes Fahrzeug wird keine Strecke behauptet',
  /Dienstfahrzeug und Fahrer/.test(kopf72) && !/Erwartete Fahrstrecke/.test(kopf72));

await oeffne(74);
const kopf74 = (await page.textContent('#epKopf')).replace(/\s+/g, ' ');
check('KRITISCH: fehlt die Einrichtung, sagt die Ansicht das — statt "kein Fahrzeug"',
  /noch nicht gelaufen/.test(kopf74));
check('KRITISCH: sie behauptet dann auch keine Auswahl',
  !(await page.isVisible('#epFahrzeug')));

// ── Gestaltung, am gerenderten Zustand GEMESSEN ──────────────────────────
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(300);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(600);
const masse = await page.evaluate(() => {
  const fz = document.getElementById('enNFahrzeug_id');
  return { hoehe: fz.getBoundingClientRect().height,
           schrift: parseFloat(getComputedStyle(fz).fontSize),
           breiter: document.body.scrollWidth > document.documentElement.clientWidth + 1 };
});
check('Handy: das Fahrzeugfeld ist mindestens 44 px hoch', masse.hoehe >= 44);
check('KRITISCH: Handy: es hat mindestens 16 px Schrift — darunter zoomt iOS hinein',
  masse.schrift >= 16);
check('KRITISCH: Handy: die Ansicht laeuft nicht ueber den Bildschirmrand hinaus', !masse.breiter);

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
