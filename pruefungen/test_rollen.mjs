// Rollenmodell und Logbuch in der Oberflaeche (ENT-077).
//
// Der Rechtekern selbst wird in pruef_rechte.php gegen eine echte Datenbank
// geprueft. Hier geht es um das, was der Bedienende sieht:
//  1. Was die eigene Rolle nicht darf, steht nicht als Knopf da.
//  2. Rollen werden in der Personalakte vergeben -- nicht in einem
//     zweiten Bereich mit einer zweiten Personenliste.
//  3. Der Verlauf sagt, WER etwas geaendert hat, mit Datum und Uhrzeit.
//  4. Bei vertraulichen Feldern steht "geaendert", nie der Wert.
//  5. "Nicht eingerichtet", "kein Zugriff" und "nichts passiert" sind drei
//     verschiedene Aussagen und duerfen nie gleich aussehen.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Die Rechte werden nicht abgeschrieben, sondern aus bereiche_katalog() in
// backend/rechte.php abgeleitet (ENT-440): Eine Liste von Hand hier waere
// eine zweite Wahrheit und liefe beim naechsten neuen Bereich still
// auseinander. Die Ableitung ist dieselbe wie im Server: <bereich>_<stufe>.
const { readFileSync: _lies } = await import('fs');
const RECHTE_PHP = _lies(`${WURZEL}/backend/rechte.php`, 'utf8');
const BEREICHE = [...(RECHTE_PHP.match(/function bereiche_katalog\(\): array\s*\{[\s\S]*?\n\}/) || [''])[0]
  .matchAll(/'([a-z_]+)' => \[\s*\n\s*'gruppe'\s*=> '([^']+)',\s*\n\s*'titel'\s*=> '([^']+)',[\s\S]*?'stufen' => \[([^\]]*)\]/g)]
  .map(m => ({ schluessel: m[1], gruppe: m[2], titel: m[3],
               stufen: (m[4].match(/STUFE_(LESEN|SCHREIBEN)/g) || []).map(x => x.split('_')[1].toLowerCase()) }));
const ALLE_RECHTE = BEREICHE.flatMap(b => b.stufen.map(st => b.schluessel + '_' + st));

// Die Profile, wie rollen_list.php sie liefert: die fuenf Systemrollen plus
// ein eigenes -- ohne ein eigenes liesse sich nicht pruefen, dass die
// Oberflaeche die Sperre nur auf Systemrollen anwendet.
const stufenVon = ist => Object.fromEntries(ist);
let PROFILE = [
  { schluessel: 'mitarbeitend', titel: 'Mitarbeitend', text: 'Nur die eigenen Daten in der App.',
    system: true, stufen: {}, traeger: 1 },
  { schluessel: 'planung', titel: 'Planung', text: 'Einsätze, Objekte, Kunden — nicht AHV-Nummer.',
    system: true, stufen: stufenVon([['einsaetze','schreiben'],['kunden','schreiben'],['personal','lesen']]), traeger: 1 },
  { schluessel: 'personal', titel: 'Personal', text: 'Die vollständige Personalakte.',
    system: true, stufen: stufenVon([['personal','schreiben'],['personal_vertraulich','schreiben']]), traeger: 0 },
  { schluessel: 'verwaltung', titel: 'Verwaltung', text: 'Alles, zusätzlich die Rollenvergabe selbst.',
    system: true, stufen: stufenVon([['einsaetze','schreiben'],['personal','schreiben'],
      ['personal_vertraulich','schreiben'],['betrieb','schreiben'],['rechte','schreiben'],['logbuch','lesen']]), traeger: 1 },
  { schluessel: 'waechter', titel: 'Wächtersystem', text: 'Kontrollpunkte und Rundgänge.',
    system: true, stufen: stufenVon([['kontrollpunkte','schreiben'],['rundgaenge','schreiben']]), traeger: 0 },
  { schluessel: 'dispo_ohne_kunden', titel: 'Disposition ohne Kundenpflege',
    text: 'Plant Einsätze, sieht Kunden nur an.', system: false,
    stufen: stufenVon([['einsaetze','schreiben'],['kunden','lesen']]), traeger: 0 },
];

// Bewilligungsdaten bewusst WEIT weg von heute (CLAUDE.md / test_datumsfest):
// ein Datum nahe am heutigen Tag kippt beim Datumswechsel und macht die
// Suite an einem beliebigen Morgen rot, ohne dass sich etwas geaendert hat.
const MA = [
  // diensthundefuehrer testet den Block "Einsatzmerkmale" auf der zentralen
  // Seite -- eine Person, die sowohl bei einem Profil als auch bei einem
  // Merkmal auftaucht, nicht zwei unabhaengige Fixtures.
  { id: 1, name: 'chefin', vorname: 'Eine', nachname: 'Leitung', personalnummer: 'P-001',
    ist_admin: true, aktiv: 1, erstellt_am: '2025-01-02', rollen: ['verwaltung'],
    diensthundefuehrer: 1, diensthund_bewilligung_bis: '2099-12-31',
    waffentragberechtigt: 0, revierdienst_berechtigt: 0 },
  { id: 2, name: 'planer', vorname: 'Zwei', nachname: 'Planung', personalnummer: 'P-002',
    ist_admin: false, aktiv: 1, erstellt_am: '2025-02-03', rollen: ['planung'],
    // Haekchen gesetzt, Bewilligung laengst abgelaufen -- der Fall, den die
    // Seite beanstanden muss.
    diensthundefuehrer: 0, waffentragberechtigt: 1, waffe_bewilligung_bis: '2019-03-31',
    revierdienst_berechtigt: 0 },
  { id: 3, name: 'hilfe', vorname: 'Drei', nachname: 'Mitarbeit', personalnummer: 'P-003',
    ist_admin: false, aktiv: 1, erstellt_am: '2025-03-04', rollen: ['mitarbeitend'],
    // Haekchen gesetzt, ueberhaupt keine Bewilligung erfasst -- eine ANDERE
    // Aussage als "abgelaufen" und darum ein eigener Text.
    diensthundefuehrer: 1, waffentragberechtigt: 0, revierdienst_berechtigt: 1 },
];
const LISTEN = { funktion: [{ id: 1, bezeichnung: 'Sicherheitsmitarbeiter' }], abteilung: [] };

const LOG = [
  { id: 9, zeitpunkt: '2026-08-21 14:35:00', akteur_id: 1, akteur_name: 'chefin',
    bereich: 'mitarbeiter', objekt_id: 2, feld: 'ahv_nr',
    wert_alt: null, wert_neu: null, werte_verborgen: true },
  { id: 8, zeitpunkt: '2026-08-20 09:05:00', akteur_id: 1, akteur_name: 'chefin',
    bereich: 'mitarbeiter', objekt_id: 2, feld: 'telefon',
    wert_alt: '', wert_neu: '079 000 00 00', werte_verborgen: false },
  { id: 7, zeitpunkt: '2026-08-19 08:00:00', akteur_id: 1, akteur_name: 'chefin',
    bereich: 'mitarbeiter', objekt_id: 2, feld: 'rollen',
    wert_alt: 'mitarbeitend', wert_neu: 'planung', werte_verborgen: false },
];

let meineRechte = ALLE_RECHTE, meineRollen = ['verwaltung'];
let gesendet = null, logAntwort = null, dossierRollen = ['planung'];
let rollenEingerichtet = true;
// Login-Namen-Umstellung (ENT-381): der Mock antwortet mit demselben Plan
// auf GET (Vorschau) wie auf POST (Ausfuehrung), genau wie der echte
// Endpunkt -- lmMigAntwort wird je Testfall gesetzt.
let lmMigAntwort = null, lmMigAufruf = null;
// Zentrale Rollenseite (ENT-440): was der Versuchsaufbau zurueckmeldet und
// was die Oberflaeche an ihn geschickt hat.
let profilGesendet = null, zuteilGesendet = null, loeschGesendet = null;
let rollenAntwortFehler = null;
// Antwort mit status:'ok', aber ohne die drei Listen -- so sieht es aus,
// wenn ein Zwischenspeicher oder ein halb ausgerollter Deploy antwortet.
let rollenAntwortUnvollstaendig = false;
// Personalnummern-Nachtrag (ENT-387): gleiches Mock-Muster.
let pnMigAntwort = null, pnMigAufruf = null;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(5000);
const jsFehler = [];
page.on('pageerror', e => jsFehler.push(e.message));

await page.route('**/api/**', r => {
  const u = r.request().url();
  const koerper = () => JSON.parse(r.request().postData() || '{}');
  // Ohne gesetzte Rechte verhaelt sich der Versuchsaufbau wie eine aeltere
  // Serverfassung: alles erlaubt, nichts mitgeteilt.
  const kann = x => !meineRechte || meineRechte.includes(x);
  const send = (x, st = 200) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(x) });
  // Fehlen die Rollen im Versuchsaufbau, schickt der Server sie auch nicht
  // mit -- so verhaelt sich eine aeltere Fassung, und genau das wird
  // geprueft.
  const ich = () => {
    const a = { status: 'ok', name: 'chefin',
      ist_admin: meineRollen ? meineRollen.includes('verwaltung') : true };
    if (meineRollen) { a.rollen = meineRollen; }
    if (meineRechte) { a.rechte = meineRechte; }
    return a;
  };
  if (u.includes('login'))  { return send({ ...ich(), token: 't' }); }
  if (u.includes('me.php')) { return send(ich()); }
  if (u.includes('logbuch_list')) {
    return send(logAntwort || { status: 'ok', eingerichtet: true, eintraege: LOG, grenze: 200, gekuerzt: false });
  }
  if (u.includes('mitarbeiter_dossier')) {
    return send({ status: 'ok', eingerichtet: true, vertraulich: kann('personal_vertraulich_lesen'),
      darf_aendern: kann('personal_schreiben'),
      darf_rollen: kann('rechte_schreiben'),
      profile: PROFILE.map(({ schluessel, titel, text, system }) => ({ schluessel, titel, text, system })),
      mitarbeiter: { ...MA[1], rollen: dossierRollen, sprache: 'de' } });
  }
  // ── Die zentrale Rollenseite (ENT-440) ──
  if (u.includes('rollen_list')) {
    if (!kann('rechte_lesen')) return send({ status: 'error', message: 'Dafür fehlt dir die Berechtigung.' }, 403);
    if (rollenAntwortUnvollstaendig) { return send({ status: 'ok', eingerichtet: true }); }
    return send({ status: 'ok', eingerichtet: rollenEingerichtet,
      bereiche: BEREICHE.map(b => ({ ...b, text: 'Was ' + b.titel + ' umfasst.' })),
      profile: PROFILE,
      personen: MA,
      darf_aendern: kann('rechte_schreiben'),
      darf_merkmale: kann('personal_schreiben') });
  }
  if (u.includes('rolle_speichern')) {
    profilGesendet = koerper();
    if (rollenAntwortFehler) return send({ status: 'error', message: rollenAntwortFehler }, 400);
    return send({ status: 'ok', schluessel: profilGesendet.schluessel || 'neues_profil' });
  }
  if (u.includes('rolle_loeschen')) {
    loeschGesendet = koerper();
    if (rollenAntwortFehler) return send({ status: 'error', message: rollenAntwortFehler }, 400);
    return send({ status: 'ok' });
  }
  if (u.includes('rollen_zuteilen')) {
    zuteilGesendet = koerper();
    if (rollenAntwortFehler) return send({ status: 'error', message: rollenAntwortFehler }, 400);
    return send({ status: 'ok' });
  }
  if (u.includes('mitarbeiter_update') || u.includes('mitarbeiter_create')) {
    gesendet = koerper();
    return send({ status: 'ok', geaendert: 1 });
  }
  if (u.includes('mitarbeiter_list')) {
    return send({ status: 'ok', mitarbeiter: MA, listen: LISTEN, eingerichtet: true,
      darf_aendern: kann('personal_schreiben'),
      darf_rollen: kann('rechte_schreiben'),
      profile: PROFILE.map(({ schluessel, titel, text, system }) => ({ schluessel, titel, text, system })),
      rollen_eingerichtet: rollenEingerichtet });
  }
  if (u.includes('mitarbeiter_zugang_migrieren')) {
    if (!kann('rechte_schreiben')) return send({ status: 'error', message: 'Dafür fehlt dir die Berechtigung.' }, 403);
    const methode = r.request().method();
    lmMigAufruf = { methode, body: methode === 'POST' ? koerper() : null };
    if (methode === 'POST' && (!lmMigAufruf.body || lmMigAufruf.body.bestaetigt !== true)) {
      return send({ status: 'error', message: 'Bestätigung erforderlich' }, 400);
    }
    return send({ status: 'ok', plan: lmMigAntwort || [] });
  }
  if (u.includes('mitarbeiter_personalnummer_migrieren')) {
    if (!kann('personal_schreiben')) return send({ status: 'error', message: 'Dafür fehlt dir die Berechtigung.' }, 403);
    const methode = r.request().method();
    pnMigAufruf = { methode, body: methode === 'POST' ? koerper() : null };
    if (methode === 'POST' && (!pnMigAufruf.body || pnMigAufruf.body.bestaetigt !== true)) {
      return send({ status: 'error', message: 'Bestätigung erforderlich' }, 400);
    }
    return send({ status: 'ok', plan: pnMigAntwort || [] });
  }
  if (u.includes('zweifaktor_status')) return send({ status: 'ok', moeglich: true, an: false, geraete: [] });
  if (u.includes('anstellungsorte')) return send({ status: 'ok', orte: [] });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} });
});

const anmelden = async () => {
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.fill('#gName', 'chefin'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  try { await page.waitForSelector('#shell.on', { timeout: 4000 }); } catch { return false; }
  await page.waitForTimeout(500);
  return true;
};

const sichtbar = sel => page.evaluate(s => {
  const el = document.getElementById(s);
  return !!el && getComputedStyle(el).display !== 'none';
}, sel);

// ══════════════ DER KATALOG STIMMT MIT DEM SERVER UEBEREIN
// Seit ENT-440 kommen die Bereiche der Matrix vom SERVER (rollen_list.php)
// und stehen nicht mehr in einer Liste im Browser -- die frueher hier
// geprueften zwei Fassungen gibt es nicht mehr. Geblieben ist EINE
// Spiegelung: die fuenf Systemrollen in `const ROLLEN` als Rueckfall fuer
// den Zustand VOR der Einrichtung. Laeuft die auseinander, zeigt die
// Oberflaeche vor der Einrichtung andere Rollen an, als der Server kennt.
try {
  const html = _lies(`${WURZEL}/dashboard.html`, 'utf8');
  check('Die Bereiche lassen sich aus rechte.php ueberhaupt ablesen', BEREICHE.length > 0);
  check('KRITISCH: es sind die 20 Bereiche aus ENT-440 -- die feste Zahl zwingt jeden, der einen ergaenzt, hier vorbeizukommen',
    BEREICHE.length === 20);
  check('KRITISCH: jeder Bereich kennt mindestens die Stufe "lesen"',
    BEREICHE.every(b => b.stufen.includes('lesen')));
  check('KRITISCH: das Logbuch hat keine Schreibstufe (ENT-077: es ist nur lesend)',
    !(BEREICHE.find(b => b.schluessel === 'logbuch') || { stufen: ['schreiben'] }).stufen.includes('schreiben'));
  check('Daraus ergeben sich 36 Rechte', ALLE_RECHTE.length === 36);

  // Die fuenf Systemrollen: Server gegen Rueckfallliste der Oberflaeche.
  const phpRollen = [...RECHTE_PHP.matchAll(/^const ROLLE_\w+\s*=\s*'([a-z]+)';/gm)].map(m => m[1]);
  const rollenBlock = (html.match(/^const ROLLEN = \[$([\s\S]*?)^\];$/m) || [, ''])[1];
  const jsRollen = [...rollenBlock.matchAll(/^  \['([a-z]+)', '[^']+',$/gm)].map(m => m[1]);
  check('Der Rueckfall-Katalog der Oberflaeche ist ueberhaupt auffindbar', jsRollen.length > 0);
  check('KRITISCH: die Oberflaeche kennt als Rueckfall genau die Systemrollen des Servers',
    JSON.stringify(phpRollen) === JSON.stringify(jsRollen));
  // Und der Rueckfall darf nicht die WAHRHEIT werden: Sobald der Server
  // Profile mitschickt, muss die Oberflaeche diese benutzen -- sonst
  // erschiene ein eigenes Profil nie.
  check('KRITISCH: die Oberflaeche uebernimmt die Profile des Servers, statt bei der Rueckfallliste zu bleiben',
    /function profileUebernehmen\(/.test(html) && (html.match(/profileUebernehmen\(/g) || []).length >= 4);
} catch (e) { check('Katalogvergleich lief durch: ' + e.message, false); }

// ══════════════ VOLLE RECHTE: ALLES DA
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  check('Die Verwaltung kommt ins Dashboard', await anmelden());
  check('Die Kopfzeile nennt die Rolle statt immer "Administration"',
    /Verwaltung/.test(await page.textContent('#uRole')));
  for (const [id, was] of [['nav-planung', 'Planung'], ['nav-abgleich', 'Abgleich'],
                           ['navg-kunden', 'Kunden'], ['nav-admin-mitarbeiter', 'Mitarbeitende'],
                           ['nav-admin-betrieb', 'Betrieb'], ['nav-einrichtung', 'Einrichtung']]) {
    check('Verwaltung sieht ' + was, await sichtbar(id));
  }
} catch (e) { check('Abschnitt volle Rechte ohne Abbruch: ' + e.message, false); }

// ══════════════ EIN SERVER OHNE RECHTELISTE SPERRT NIEMANDEN AUS
// Genau das ist beim Bauen passiert: `data.rechte || []` machte aus einer
// FEHLENDEN Liste eine LEERE -- und warf damit jeden Verwaltungszugang in
// die Mitarbeiter-App. Waehrend eines Deploys oder aus einem
// Zwischenspeicher kann eine Antwort ohne Rechte kommen; dann gilt der
// alte Stand, nicht "darf nichts".
try {
  meineRechte = undefined; meineRollen = undefined;
  check('KRITISCH: eine Antwort OHNE Rechteliste sperrt einen Admin nicht aus',
    await anmelden());
  check('Und die Navigation bleibt vollständig, statt leer zu werden',
    await sichtbar('nav-planung') && await sichtbar('nav-admin-betrieb'));
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
} catch (e) { check('Abschnitt ohne Rechteliste ohne Abbruch: ' + e.message, false); }

// ══════════════ ROLLE PLANUNG: WENIGER KNOEPFE
try {
  meineRechte = ['einsaetze_lesen', 'einsaetze_schreiben', 'kunden_lesen', 'kunden_schreiben',
                 'abgleich_lesen', 'abgleich_schreiben', 'personal_lesen', 'abwesenheiten_lesen',
                 'verfuegbarkeit_lesen', 'auslagen_lesen'];
  meineRollen = ['planung'];
  check('Die Planung kommt ebenfalls ins Dashboard, nicht nur Admins', await anmelden());
  check('Die Kopfzeile nennt "Planung"', /Planung/.test(await page.textContent('#uRole')));
  check('Planung sieht die Einsatzplanung', await sichtbar('nav-planung'));
  check('Planung sieht die Mitarbeitendenliste', await sichtbar('nav-admin-mitarbeiter'));
  check('KRITISCH: Planung sieht die Einstellungen nicht', !(await sichtbar('nav-admin-betrieb')));
  check('KRITISCH: Planung sieht die Einrichtung nicht', !(await sichtbar('nav-einrichtung')));
  check('KRITISCH: Planung sieht den Verlaufs-Reiter nicht',
    !(await sichtbar('mdtab-verlauf')));
  check('Planung sieht Pensen, Auslagen und Abwesenheiten',
    await sichtbar('nav-kontrolle-pensen') && await sichtbar('nav-kontrolle-auslagen')
    && await sichtbar('nav-kontrolle-abwesenheiten'));
} catch (e) { check('Abschnitt Planung ohne Abbruch: ' + e.message, false); }

// ══════════════ JEDES KIND DER RUBRIK "AUSWERTUNG" AN SEINER EIGENEN ZEILE
// Bis ENT-440 hing die ganze Rubrik an einem einzigen Recht. Mit Stufen je
// Bereich waere das eine Rubrik, die aufgeht und dahinter alles gesperrt
// zeigt -- und ein Menuepunkt, der auf ein 403 fuehrt (genau so stand
// "Auslagenersatz" bis dahin schon mit dem Planungsrecht da, obwohl der
// Endpunkt dahinter das Abgleichsrecht verlangte).
try {
  meineRechte = ['abwesenheiten_lesen'];
  meineRollen = ['personal'];
  await anmelden();
  check('KRITISCH: die Rubrik erscheint, sobald EIN Kind sichtbar ist',
    await sichtbar('navg-kontrolle'));
  check('KRITISCH: und zwar nur dieses eine — die anderen drei bleiben weg',
    await sichtbar('nav-kontrolle-abwesenheiten')
    && !(await sichtbar('nav-kontrolle-pensen'))
    && !(await sichtbar('nav-kontrolle-auslagen'))
    && !(await sichtbar('nav-kontrolle-arbeitsergebnisse')));

  // Ohne ein einziges Kind darf die Rubrik gar nicht dastehen -- eine
  // aufklappbare Rubrik ohne Inhalt ist schlimmer als keine.
  meineRechte = ['kunden_lesen'];
  await anmelden();
  check('KRITISCH: ohne jedes Kind verschwindet die ganze Rubrik',
    !(await sichtbar('navg-kontrolle')));

  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(600);
  check('KRITISCH: ohne Recht zur Profilvergabe gibt es keine Profilkästchen in der Akte',
    await page.evaluate(() => !document.getElementById('maRolle_verwaltung')));
  check('Aber die Profile stehen trotzdem da — "darf ich nicht sehen" wäre etwas anderes als "keine"',
    /Planung/.test(await page.textContent('#mv-bearbeiten')));
} catch (e) { check('Abschnitt Planung ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE AKTE ZEIGT PROFILE, VERGIBT SIE ABER NICHT MEHR (ENT-440)
// Der Kern der Umstellung: Bis ENT-440 wurden die Rollen hier vergeben
// (ENT-077: "dort, wo man ohnehin ist"). Jetzt gibt es dafuer genau EINEN
// Ort -- die zentrale Seite. Zwei Bedienwege fuer dieselbe Sache waeren
// zwei Stellen zum Pflegen und zwei zum Pruefen.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(600);
  await page.click('#mbtab-zugang');
  await page.waitForTimeout(300);

  check('KRITISCH: in der Akte gibt es keine Profilkästchen mehr, auch nicht für die Verwaltung',
    await page.evaluate(() => ['mitarbeitend', 'planung', 'personal', 'verwaltung', 'waechter']
      .every(r => !document.getElementById('maRolle_' + r))));
  const zugang = (await page.textContent('#mv-bearbeiten')).replace(/\s+/g, ' ');
  check('KRITISCH: die zugeteilten Profile stehen trotzdem da — sonst sähe "kein Zugriff" wie "keine Rolle" aus',
    /Planung/.test(zugang));
  check('Und die Akte sagt, WO zugeteilt wird, statt es nur wegzulassen',
    /zentral/i.test(zugang) && /Berechtigungen/.test(zugang));

  // Speichern der Akte darf keine Profile mehr mitschicken -- sonst
  // ueberschriebe ein Speichern still das, was zentral gesetzt wurde.
  gesendet = null;
  await page.evaluate(() => mbSpeichern());
  await page.waitForTimeout(600);
  check('KRITISCH: ein Speichern aus der Akte schickt keine Profile mit',
    gesendet !== null && !('rollen' in gesendet));
} catch (e) { check('Abschnitt Akte zeigt nur ohne Abbruch: ' + e.message, false); }

// ══════════════ ANLEGEN: DIE PROFILWAHL BLEIBT IN DER MASKE
// Bewusste Ausnahme (ENT-440): Ein neues Konto haette sonst bis zum ersten
// Besuch der Zuteilungsseite einen unbestimmten Zustand.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); mbNeu(); });
  await page.waitForTimeout(700);
  check('KRITISCH: beim Anlegen stehen die Profile weiterhin zur Wahl',
    await page.evaluate(() => !!document.getElementById('mbNeuRolle_mitarbeitend')
      && !!document.getElementById('mbNeuRolle_verwaltung')));
  check('KRITISCH: auch die EIGENEN Profile stehen zur Wahl, nicht nur die fünf Systemrollen',
    await page.evaluate(() => !!document.getElementById('mbNeuRolle_dispo_ohne_kunden')));
  check('Das kleinste Profil ist vorausgewählt — Rechte entstehen nie aus Versehen',
    await page.isChecked('#mbNeuRolle_mitarbeitend')
    && !(await page.isChecked('#mbNeuRolle_verwaltung')));
} catch (e) { check('Abschnitt Anlegen ohne Abbruch: ' + e.message, false); }

// ══════════════ LOGIN-NAME UND PERSONALNUMMER VON HAND AENDERN (ENT-393)
// Beide sind fuer alle anderen gesperrt (ENT-376/381/387) -- diese Karte
// prueft die eine Ausnahme: dieselbe Rechteschwelle wie Rollenvergabe
// ('rechte_schreiben', exklusiv Verwaltung), und dass eine falsche Eingabe gar nicht
// erst zum Server geht.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(600);
  await page.click('#mbtab-zugang');
  await page.waitForTimeout(300);

  check('KRITISCH: mit dem Recht "rechte" ist der Login-Name ein Eingabefeld, vorbefuellt mit dem bisherigen Namen',
    (await page.inputValue('#mbLoginNeu')) === 'planer');
  await page.click('#mbtab-anstellung');
  await page.waitForTimeout(300);
  check('KRITISCH: mit dem Recht "rechte" ist die Personalnummer nicht mehr gesperrt',
    !(await page.isDisabled('#mb_personalnummer')));

  // Falsches Muster: Grossschreibung/Leerzeichen -- darf gar nicht erst
  // gesendet werden (Sperre gehoert in den Server, aber die Oberflaeche
  // erspart den unnoetigen Umweg).
  gesendet = null;
  await page.click('#mbtab-zugang');
  await page.waitForTimeout(200);
  await page.fill('#mbLoginNeu', 'Zwei Planung');
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  check('KRITISCH: ein falsches Muster wird abgelehnt, bevor ueberhaupt gesendet wird',
    gesendet === null && /Muster/.test(await page.textContent('#mbErr')));

  // Richtiges Muster: wird als eigenes Feld mitgeschickt, der bisherige
  // Name bleibt der Bezugspunkt (WHERE-Schluessel im Server).
  gesendet = null;
  await page.fill('#mbLoginNeu', 'zwei.planung');
  await page.click('#mbtab-anstellung');
  await page.waitForTimeout(200);
  await page.fill('#mb_personalnummer', '4711');
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  check('KRITISCH: eine gueltige Aenderung wird als eigenes Feld "name_neu" mitgeschickt, der bisherige Name bleibt der Bezug',
    gesendet && gesendet.name === 'planer' && gesendet.name_neu === 'zwei.planung');
  check('Die von Hand geaenderte Personalnummer geht mit',
    gesendet && gesendet.personalnummer === '4711');

  // Unveraendert gelassen: kein "name_neu" im Kartenkoerper, obwohl das
  // Feld existiert -- sonst muesste jede Aenderung an einer Person mit
  // einem (noch) nicht musterkonformen Bestandsnamen daran scheitern.
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(700);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(500);
  gesendet = null;
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  check('Unveraendert gelassen wird kein "name_neu" mitgeschickt',
    gesendet && !('name_neu' in gesendet));

  // Ohne das Recht "rechte_schreiben" bleibt beides gesperrt wie bisher.
  meineRechte = ['personal_lesen', 'personal_schreiben']; meineRollen = ['personal'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(600);
  await page.click('#mbtab-zugang');
  await page.waitForTimeout(300);
  check('KRITISCH: ohne das Recht "rechte_schreiben" bleibt der Login-Name reiner Text, kein Eingabefeld',
    (await page.$('#mbLoginNeu')) === null
    && (await page.textContent('#mbKarten')).includes('planer'));
  await page.click('#mbtab-anstellung');
  await page.waitForTimeout(300);
  check('KRITISCH: ohne das Recht "rechte_schreiben" bleibt die Personalnummer gesperrt',
    await page.isDisabled('#mb_personalnummer'));
} catch (e) { check('Abschnitt Login-Name/Personalnummer von Hand ohne Abbruch: ' + e.message, false); }

// ══════════════ WAECHTERSYSTEM: KEIN EIGENER REITER (ENT-285/ENT-440)
// Bis ENT-285 hatte diese Rolle einen eigenen Reiter (ENT-169/ENT-186).
// Hier wird geprueft, dass vom alten Reiter nichts liegen blieb -- vergeben
// wird sie seit ENT-440 auf der zentralen Seite wie jedes andere Profil.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung']; dossierRollen = ['planung'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);

  check('KRITISCH: der eigene Waechtersystem-Reiter ist wirklich weg, nicht nur versteckt',
    await page.evaluate(() => document.getElementById('mdtab-waechter') === null
      && document.getElementById('md-waechter') === null));
  check('KRITISCH: die alten Funktionen dafuer sind nicht mehr da (kein still liegen gebliebener Pfad)',
    await page.evaluate(() => typeof window.mdWaechter === 'undefined'
      && typeof window.mdWaechterSpeichern === 'undefined'));
} catch (e) { check('Abschnitt Waechtersystem ohne Abbruch: ' + e.message, false); }

// ══════════════ DER VERLAUF
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  check('Die Verwaltung sieht den Verlaufs-Reiter', await sichtbar('mdtab-verlauf'));
  await page.evaluate(() => mdGoTab('verlauf'));
  await page.waitForTimeout(700);
  const v = (await page.textContent('#mdVerlauf')).replace(/\s+/g, ' ');

  check('KRITISCH: im Verlauf steht, WER die Änderung gemacht hat', /chefin/.test(v));
  check('KRITISCH: mit Datum UND Uhrzeit, wie verlangt', /20\.08\.2026, 09:05/.test(v));
  check('Ein offenes Feld steht mit altem und neuem Wert da',
    /Telefon/.test(v) && /079 000 00 00/.test(v) && /leer/.test(v));
  check('Die Feldnamen stehen lesbar da, nicht als Spaltennamen',
    !/telefon/.test(v) && /Telefon/.test(v));
  check('KRITISCH: bei der AHV-Nummer steht NUR, dass geändert wurde',
    /AHV-Nummer/.test(v) && /geändert/.test(v) && /vertraulich/.test(v));
  check('Auch eine Rollenänderung steht im Verlauf',
    /Rollen/.test(v) && /planung/.test(v));

  // Gekuerzte Liste darf nicht wie eine vollstaendige aussehen
  logAntwort = { status: 'ok', eingerichtet: true, eintraege: LOG, grenze: 3, gekuerzt: true };
  await page.evaluate(() => { mdVerlaufFuer = ''; mdVerlauf(); });
  await page.waitForTimeout(500);
  check('KRITISCH: eine abgeschnittene Liste sagt, dass es ältere gibt',
    /es gibt ältere/.test(await page.textContent('#mdVerlauf')));

  // Die drei Leerzustaende muessen sich unterscheiden
  logAntwort = { status: 'ok', eingerichtet: false, eintraege: [], grenze: 200, gekuerzt: false };
  await page.evaluate(() => { mdVerlaufFuer = ''; mdVerlauf(); });
  await page.waitForTimeout(500);
  const nichtEingerichtet = await page.textContent('#mdVerlauf');
  check('KRITISCH: "noch nicht eingerichtet" sagt genau das',
    /nicht eingerichtet/i.test(nichtEingerichtet) && /Einrichtung/.test(nichtEingerichtet));

  logAntwort = { status: 'ok', eingerichtet: true, eintraege: [], grenze: 200, gekuerzt: false };
  await page.evaluate(() => { mdVerlaufFuer = ''; mdVerlauf(); });
  await page.waitForTimeout(500);
  const nichtsPassiert = await page.textContent('#mdVerlauf');
  check('KRITISCH: "nichts geändert" sieht anders aus als "nicht eingerichtet"',
    /nichts geändert/.test(nichtsPassiert) && !/nicht eingerichtet/i.test(nichtsPassiert));
  logAntwort = null;
} catch (e) { check('Abschnitt Verlauf ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE ZENTRALE SEITE: PROFILE (ENT-440)
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  const r = (await page.textContent('#rvInhalt')).replace(/\s+/g, ' ');
  check('Die Profilliste zeigt alle fünf Systemrollen, Wächtersystem eingeschlossen',
    /Mitarbeitend/.test(r) && /Planung/.test(r) && /Personal/.test(r) && /Verwaltung/.test(r)
    && /Wächtersystem/.test(r));
  check('KRITISCH: und das eigene Profil daneben — sonst wäre "eigene Profile" nur eine Behauptung',
    /Disposition ohne Kundenpflege/.test(r));
  check('KRITISCH: Systemrollen sind als solche gekennzeichnet, nicht nur nicht änderbar',
    (r.match(/Systemrolle/g) || []).length >= 5);
  check('Zu jedem Profil steht, was es darf', /Personalakte/.test(r) || /AHV/.test(r) || /Einsätze/.test(r));
  check('Die Trägerzahl steht am Profil — die Frage "wer kommt an die Personalakte" ohne Suchen',
    await page.evaluate(() => document.querySelectorAll('#rvInhalt .chip').length >= 6));
  await page.screenshot({ path: `${OUT}/rollen-01-profile.png` });

  // ── Die Matrix
  await page.evaluate(() => rvProfilOeffnen('dispo_ohne_kunden'));
  await page.waitForTimeout(500);
  check('Ein eigenes Profil lässt sich öffnen', await sichtbar('rvEditKarte'));
  const m = (await page.textContent('#rvEditInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: die Matrix zeigt alle 20 Bereiche',
    await page.evaluate(() => document.querySelectorAll('#rvEditInhalt .rm-zeile').length) === 20);
  check('Sie sind in die sechs Gruppen geteilt',
    await page.evaluate(() => document.querySelectorAll('#rvEditInhalt .rm-gruppe-hd').length) === 6);
  check('KRITISCH: Bereiche ohne Schreibweg zeigen zwei Schalter statt drei — ein Schreibschalter ohne Schreibweg wäre eine Behauptung',
    await page.evaluate(() => {
      const zeilen = [...document.querySelectorAll('#rvEditInhalt .rm-zeile')];
      const logbuch = zeilen.find(z => /Logbuch/.test(z.textContent));
      const kunden  = zeilen.find(z => /^Kunden/.test(z.querySelector('b').textContent));
      return logbuch.querySelectorAll('.rm-stufe').length === 2
          && kunden.querySelectorAll('.rm-stufe').length === 3;
    }));
  check('KRITISCH: die gesetzte Stufe ist erkennbar, nicht nur gespeichert',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#rvEditInhalt .rm-stufe[data-bereich="kunden"]')];
      return k.find(x => x.dataset.stufe === 'lesen').classList.contains('aktiv')
          && !k.find(x => x.dataset.stufe === 'schreiben').classList.contains('aktiv');
    }));
  check('Die Stufen stehen ausgeschrieben da, nicht als zu erratendes Symbol',
    /verborgen/.test(m) && /lesen/.test(m) && /schreiben/.test(m));

  // GEMESSEN, nicht im Quelltext nachgelesen (CLAUDE.md). Beide Befunde hier
  // waren in der ersten Fassung falsch und fielen erst am gerenderten Bild
  // auf: (1) "verborgen" und "lesen" trugen im aktiven Zustand DIESELBE
  // Farbe -- die Spalte liess sich nicht ueberfliegen; (2) zweistufige
  // Zeilen dehnten ihre zwei Segmente auf die Breite von dreien, sodass
  // "verborgen" je nach Zeile an einer anderen Stelle begann.
  const gemessen = await page.evaluate(() => {
    const zeilen = [...document.querySelectorAll('#rvEditInhalt .rm-zeile')];
    const farbe = st => {
      const k = document.querySelector(`.rm-stufe.aktiv.stufe-${st}`);
      return k ? getComputedStyle(k).backgroundColor : null;
    };
    const spalte = st => new Set(zeilen
      .map(z => z.querySelector(`.rm-stufe[data-stufe="${st}"]`))
      .filter(Boolean)
      .map(k => Math.round(k.getBoundingClientRect().left))).size;
    return {
      farben: [farbe('verborgen'), farbe('lesen'), farbe('schreiben')],
      verborgenX: spalte('verborgen'), lesenX: spalte('lesen'),
      hoehe: Math.round(zeilen[0].querySelector('.rm-stufe').getBoundingClientRect().height),
    };
  });
  check('KRITISCH: die drei Stufen sehen im aktiven Zustand VERSCHIEDEN aus — sonst muss man jedes Wort lesen',
    gemessen.farben.every(f => f) && new Set(gemessen.farben).size === 3);
  check('KRITISCH: "verborgen" steht in jeder Zeile an derselben Stelle',
    gemessen.verborgenX === 1);
  check('KRITISCH: "lesen" ebenso — auch in Zeilen, die keine Schreibstufe haben',
    gemessen.lesenX === 1);
  check('Die Schalter sind hoch genug zum Treffen', gemessen.hoehe >= 30);
  await page.screenshot({ path: `${OUT}/rollen-02-matrix.png` });

  // Umschalten und speichern
  profilGesendet = null;
  await page.evaluate(() => rvStufeSetzen('kunden', 'schreiben'));
  await page.waitForTimeout(200);
  check('Ein Klick färbt die neue Stufe und nimmt die alte weg',
    await page.evaluate(() => {
      const k = [...document.querySelectorAll('#rvEditInhalt .rm-stufe[data-bereich="kunden"]')];
      return k.find(x => x.dataset.stufe === 'schreiben').classList.contains('aktiv')
          && !k.find(x => x.dataset.stufe === 'lesen').classList.contains('aktiv');
    }));
  await page.evaluate(() => rvProfilSpeichern());
  await page.waitForTimeout(600);
  check('KRITISCH: gespeichert wird der ganze Stufensatz, nicht nur die letzte Änderung',
    profilGesendet && profilGesendet.stufen
    && profilGesendet.stufen.kunden === 'schreiben' && profilGesendet.stufen.einsaetze === 'schreiben');
  check('Der Schlüssel des bestehenden Profils geht mit — sonst entstünde ein zweites',
    profilGesendet.schluessel === 'dispo_ohne_kunden');
  check('KRITISCH: "verborgen" wird als FEHLENDE Zeile gesendet, nicht als Wert',
    !Object.values(profilGesendet.stufen).includes('verborgen'));

  // ── Systemrollen sind gesperrt
  await page.evaluate(() => rvProfilOeffnen('verwaltung'));
  await page.waitForTimeout(400);
  check('KRITISCH: bei einer Systemrolle sind alle Schalter gesperrt',
    await page.evaluate(() => [...document.querySelectorAll('#rvEditInhalt .rm-stufe')].every(b => b.disabled)));
  check('KRITISCH: und es gibt keinen Speichern-Knopf',
    await page.evaluate(() => !/Profil speichern/.test(document.getElementById('rvEditInhalt').textContent)));
  check('Die Seite sagt WARUM, statt den Knopf nur wegzulassen',
    /nicht änderbar/.test(await page.textContent('#rvEditInhalt')));
  check('Und sie sagt, was man stattdessen tun kann',
    /eigenes Profil/.test(await page.textContent('#rvEditInhalt')));
} catch (e) { check('Abschnitt Profile ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE ZENTRALE SEITE: ZUTEILUNG (ENT-440)
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  const z = (await page.textContent('#rzInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: zugeteilt wird auf DIESER Seite, für alle Personen in einer Liste',
    /Eine Leitung/.test(z) && /Zwei Planung/.test(z) && /Drei Mitarbeit/.test(z));
  check('Jede Person zeigt alle Profile zur Wahl, nicht nur die gesetzten',
    await page.evaluate(() => document.querySelectorAll('#rzInhalt tbody tr:first-child .rz-marke').length) === 6);
  check('KRITISCH: die gesetzten Profile sind von den nicht gesetzten unterscheidbar',
    await page.evaluate(() => {
      const zeile = document.querySelectorAll('#rzInhalt tbody tr')[1];
      const an = [...zeile.querySelectorAll('.rz-marke.an')].map(b => b.textContent.trim());
      return an.length === 1 && an[0] === 'Planung';
    }));
  check('KRITISCH: die Folge der Zuteilung steht daneben — Cockpit oder nur App',
    /Cockpit/.test(z) && /nur App/.test(z));
  check('KRITISCH: die Zahl der Aktiven steht mit Bezug da, nicht nackt',
    /3 von 3/.test(z));
  await page.screenshot({ path: `${OUT}/rollen-03-zuteilung.png` });

  // Umschalten speichert sofort
  zuteilGesendet = null;
  await page.evaluate(() => rzUmschalten(2, 'waechter'));
  await page.waitForTimeout(600);
  check('KRITISCH: ein Klick teilt zu und sendet die BISHERIGEN Profile plus das neue',
    zuteilGesendet && zuteilGesendet.mitarbeiter_id === 2
    && zuteilGesendet.rollen.includes('planung') && zuteilGesendet.rollen.includes('waechter'));

  // Fehlschlag: der alte Stand kommt zurueck, statt auf dem Schirm zu luegen
  rollenAntwortFehler = 'Das ist die letzte Person, die Rollen vergeben darf.';
  await page.evaluate(() => rzUmschalten(1, 'verwaltung'));
  await page.waitForTimeout(700);
  check('KRITISCH: lehnt der Server ab, steht die Meldung da',
    /letzte Person/.test(await page.textContent('#rzErr')));
  check('KRITISCH: und die Marke springt zurück — eine Marke, die anbleibt, wäre eine Lüge auf dem Schirm',
    await page.evaluate(() => {
      const zeile = document.querySelectorAll('#rzInhalt tbody tr')[0];
      return [...zeile.querySelectorAll('.rz-marke.an')].some(b => b.textContent.trim() === 'Verwaltung');
    }));
  rollenAntwortFehler = null;
} catch (e) { check('Abschnitt Zuteilung ohne Abbruch: ' + e.message, false); }

// ══════════════ DIE ZENTRALE SEITE: EINSATZMERKMALE (ENT-440)
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  const e = (await page.textContent('#rmkInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: die drei Einsatzmerkmale stehen auf derselben Seite, nicht in zwei anderen Reitern',
    /Diensthund/.test(e) && /Schusswaffe/.test(e) && /Revierdienst/.test(e));
  check('Sie sind als Eigenschaft der Person ausgewiesen, nicht als Profil',
    /keine Profile/.test(e));
  check('Die Seite sagt, wo das Bewilligungsdatum gepflegt wird', /Personalakte/.test(e));
  check('KRITISCH: ein Häkchen mit abgelaufener Bewilligung wird beanstandet',
    /abgelaufen am 31\.03\.2019/.test(e));
  check('KRITISCH: "gar keine Bewilligung erfasst" ist eine ANDERE Aussage als "abgelaufen"',
    /keine Bewilligung erfasst/.test(e));
  check('KRITISCH: eine gültige Bewilligung wird NICHT beanstandet',
    await page.evaluate(() => {
      const zeile = document.querySelectorAll('#rmkInhalt tbody tr')[0];
      return zeile.querySelectorAll('.rz-warn').length === 0;
    }));
  await page.screenshot({ path: `${OUT}/rollen-04-merkmale.png` });

  gesendet = null;
  await page.evaluate(() => rmkUmschalten(3, 'revierdienst_berechtigt'));
  await page.waitForTimeout(600);
  check('KRITISCH: ein Merkmal geht über den bestehenden Weg der Personalakte, nicht über einen zweiten',
    gesendet && gesendet.name === 'hilfe' && gesendet.revierdienst_berechtigt === 0);
  check('KRITISCH: und nur das eine Feld — sonst überschriebe ein Klick den Rest der Akte',
    gesendet && Object.keys(gesendet).length === 2);
} catch (e) { check('Abschnitt Einsatzmerkmale ohne Abbruch: ' + e.message, false); }

// ══════════════ NICHT EINGERICHTET SIEHT NICHT WIE EINGERICHTET AUS
// Genau das ist im Betrieb passiert: Die Zwei-Faktor-Karte meldete fehlende
// Tabellen, die Rollenkarte daneben zeigte eine saubere Verteilung -- weil
// sie den Rueckfallwert aus ist_admin anzeigte, als waere er eine vergebene
// Rolle. Man sucht den Fehler dann an der falschen Stelle.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  rollenEingerichtet = false;
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  const r = (await page.textContent('#rvInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: ohne Einrichtung sagt die Profilliste genau das',
    /[Nn]och nicht eingerichtet/.test(r));
  check('Und sie sagt, was zu tun ist', /Einrichtung/.test(r));
  check('KRITISCH: sie sagt ausdrücklich, dass unten ein Notstand steht und kein gespeichertes Profil',
    /kein gespeichertes Profil/.test(r));
  check('KRITISCH: ohne Einrichtung lässt sich kein Profil anlegen, statt still zu scheitern',
    !(await sichtbar('rvNeuKnopf')));
  check('KRITISCH: und die Zuteilung ist gesperrt, nicht scheinbar bedienbar',
    await page.evaluate(() => [...document.querySelectorAll('#rzInhalt .rz-marke')].every(b => b.disabled)));
  rollenEingerichtet = true;
} catch (e) { check('Abschnitt ohne Einrichtung ohne Abbruch: ' + e.message, false); }

// ══════════════ NUR ZUSEHEN IST ETWAS ANDERES ALS KEIN ZUGRIFF
try {
  meineRechte = ['rechte_lesen', 'betrieb_lesen'];
  meineRollen = ['planung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  check('Wer nur lesen darf, sieht die Seite', await sichtbar('rvKarte'));
  check('KRITISCH: aber es gibt keinen Knopf zum Anlegen', !(await sichtbar('rvNeuKnopf')));
  check('KRITISCH: und die Seite sagt WARUM, statt den Knopf nur wegzulassen',
    /nicht ändern/.test(await page.textContent('#rvInhalt')));
  check('KRITISCH: auch die Zuteilung ist gesperrt',
    await page.evaluate(() => [...document.querySelectorAll('#rzInhalt .rz-marke')].every(b => b.disabled)));
  check('KRITISCH: die Einsatzmerkmale ebenfalls — sie hängen an "Mitarbeitende: schreiben"',
    await page.evaluate(() => [...document.querySelectorAll('#rmkInhalt .rz-marke')].every(b => b.disabled)));
} catch (e) { check('Abschnitt nur lesen ohne Abbruch: ' + e.message, false); }

// ══════════════ EINE UNVOLLSTAENDIGE ANTWORT IST NICHT "NICHTS VORHANDEN"
// Genau dieser Fall hat beim Bauen von ENT-440 eine fremde Suite zum
// Absturz gebracht: Der Versuchsaufbau antwortete mit status:'ok', aber
// ohne die Listen -- und die Seite lief in `undefined.filter`. Ein
// `data.profile || []` waere die falsche Behebung: Es machte aus einer
// FEHLENDEN Liste eine LEERE, und die Seite behauptete "es gibt keine
// Profile", wo in Wahrheit nichts geladen wurde. Dieselbe Regel wie bei
// `data.rechte || []` in ENT-077.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  rollenAntwortUnvollstaendig = true;
  await anmelden();
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  const r = (await page.textContent('#rvInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: eine Antwort ohne die Listen wirft keinen Skriptfehler',
    fehler.length === 0);
  check('KRITISCH: sie sagt "nicht geladen" — nicht "es gibt keine Profile"',
    /[Nn]icht geladen/.test(r) && !/Systemrolle/.test(r));
  check('KRITISCH: auch Zuteilung und Einsatzmerkmale sagen es, statt leer zu bleiben',
    /[Nn]icht geladen/.test(await page.textContent('#rzInhalt'))
    && /[Nn]icht geladen/.test(await page.textContent('#rmkInhalt')));
  rollenAntwortUnvollstaendig = false;
} catch (e) { check('Abschnitt unvollstaendige Antwort ohne Abbruch: ' + e.message, false); }

// Ohne das Recht darf die Kachel gar nicht dastehen
try {
  meineRechte = ['einsaetze_lesen', 'kunden_lesen', 'abgleich_lesen', 'personal_lesen', 'betrieb_lesen'];
  meineRollen = ['planung'];
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  check('KRITISCH: ohne Recht auf die Rollenseite fehlt schon die Kachel dafuer (ENT-210)',
    !(await sichtbar('bkKachelRv')));
  await page.evaluate(() => bkAbschnittZeigen('rv'));
  await page.waitForTimeout(300);
  check('KRITISCH: ohne Recht fehlt die Profilliste', !(await sichtbar('rvKarte')));
  check('KRITISCH: und die Zuteilung ebenso', !(await sichtbar('rzKarte')));
  check('KRITISCH: und die Einsatzmerkmale ebenso', !(await sichtbar('rmkKarte')));
} catch (e) { check('Abschnitt ohne Recht ohne Abbruch: ' + e.message, false); }

// ══════════════ LOGIN-NAMEN UMSTELLEN (ENT-381)
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  check('KRITISCH: mit dem Recht zur Rollenvergabe steht die Karte da',
    await sichtbar('lmKarte'));

  lmMigAntwort = [
    { id: 1, alt: 'chefin', neu: 'eine.leitung', status: 'umbenannt', grund: null,
      personalnummer: 'P-001', aktiv: true, erstellt_am: '2025-01-02 08:00:00' },
    // Zwei Zeilen mit demselben Namen -- eine davon inaktiv (Karteileiche,
    // in der normalen Mitarbeiterliste unsichtbar). Genau dieser Fall
    // wurde beim ersten echten Einsatz entdeckt: ohne Status/Datum liess
    // sich nicht erkennen, dass es zwei verschiedene Konten sind.
    { id: 2, alt: 'planer', neu: 'zwei.planung', status: 'umbenannt', grund: null,
      personalnummer: 'P-002', aktiv: false, erstellt_am: '2024-03-01 09:00:00' },
    { id: 6, alt: 'planer-alt', neu: 'zwei.planung2', status: 'umbenannt', grund: null,
      personalnummer: null, aktiv: true, erstellt_am: '2025-06-01 09:00:00' },
    { id: 3, alt: 'hilfe', neu: 'hilfe', status: 'unveraendert', grund: null,
      personalnummer: 'P-003', aktiv: true, erstellt_am: '2025-03-04 08:00:00' },
    { id: 4, alt: 'systemkonto', neu: null, status: 'uebersprungen', grund: 'Vorname oder Nachname fehlt',
      personalnummer: null, aktiv: true, erstellt_am: '2024-01-01 00:00:00' },
  ];
  await page.click('button:has-text("Vorschau laden")');
  await page.waitForTimeout(400);
  const vorschau = (await page.textContent('#lmInhalt')).replace(/\s+/g, ' ');
  check('Die Vorschau nennt die Anzahl der umzustellenden Login-Namen', /\b3\b/.test(vorschau));
  check('KRITISCH: die Tabelle zeigt alten UND neuen Namen nebeneinander',
    /chefin/.test(vorschau) && /eine\.leitung/.test(vorschau)
    && /planer/.test(vorschau) && /zwei\.planung/.test(vorschau));
  check('KRITISCH: unveraenderte und uebersprungene Kontos stehen NICHT in der Umstellungstabelle -- nur die tatsaechlich betroffenen',
    !vorschau.includes('hilfe') && !vorschau.includes('systemkonto'));
  check('Uebersprungene und unveraenderte Kontos werden als Anzahl genannt, nicht verschwiegen',
    /1 ohne Vor- oder Nachname übersprungen/.test(vorschau) && /1 entsprechen bereits dem Muster/.test(vorschau));
  check('Der Knopf zum Ausfuehren nennt dieselbe Anzahl',
    /3 Login-Namen umstellen/.test(await page.textContent('#lmInhalt')));
  // Personalnummer, Status und Anlegedatum (ENT-383): der eigentliche
  // Grund fuer diese Spalten -- zwei gleich benannte Zeilen unterscheidbar
  // machen, statt wie ein Fehler auszusehen.
  check('KRITISCH: Personalnummer, Status und Anlegedatum stehen in der Tabelle',
    /P-001/.test(vorschau) && /P-002/.test(vorschau)
    && /01\.03\.2024/.test(vorschau) && /01\.06\.2025/.test(vorschau));
  check('KRITISCH: eine fehlende Personalnummer zeigt "–", nicht "null" oder "undefined"',
    !/null|undefined/.test(vorschau));
  check('KRITISCH: das inaktive der beiden gleichnamigen Konten ist als "inaktiv" erkennbar',
    /inaktiv/.test(vorschau));

  // Ausfuehren: erst die Rueckfrage, kein Schreiben davor
  gesendet = null; lmMigAufruf = null;
  await page.click('button:has-text("Login-Namen umstellen")');
  await page.waitForSelector('#dlgConfirm.on');
  check('KRITISCH: vor dem Ausfuehren steht eine Rueckfrage', lmMigAufruf === null);
  await page.click('#cfBtn');
  await page.waitForTimeout(500);
  check('KRITISCH: die Ausfuehrung ist ein POST mit ausdruecklicher Bestaetigung',
    lmMigAufruf && lmMigAufruf.methode === 'POST' && lmMigAufruf.body.bestaetigt === true);
  const ergebnis = (await page.textContent('#lmInhalt')).replace(/\s+/g, ' ');
  check('Die Meldung nennt, dass umgestellt wurde, und mahnt zur Mitteilung',
    /umgestellt/.test(ergebnis) && /mitteilen/.test(ergebnis));
  check('KRITISCH: die eigene Anmeldung war mit dabei -- eigener Hinweis mit dem neuen Namen',
    /eigene Anmeldung/.test(ergebnis) && /eine\.leitung/.test(ergebnis));
  check('Ein Knopf zum Abmelden steht bereit, statt automatisch mitten im Lesen abzumelden',
    await sichtbar('lmInhalt') && /Jetzt abmelden/.test(ergebnis));
} catch (e) { check('Abschnitt Login-Namen umstellen ohne Abbruch: ' + e.message, false); }

// Nichts zu tun: kein Umstellen-Knopf, klare Aussage statt leerer Tabelle
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('rv'); });
  await page.waitForTimeout(900);
  lmMigAntwort = [{ id: 1, alt: 'chefin', neu: 'chefin', status: 'unveraendert', grund: null,
    personalnummer: 'P-001', aktiv: true, erstellt_am: '2025-01-02 08:00:00' }];
  await page.click('button:has-text("Vorschau laden")');
  await page.waitForTimeout(400);
  const leer = (await page.textContent('#lmInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: "nichts zu tun" sagt das ausdruecklich, statt eine leere Tabelle zu zeigen',
    /Nichts zu tun/.test(leer));
  check('KRITISCH: ohne etwas umzustellen gibt es auch keinen Umstellen-Knopf',
    !(await page.$('button:has-text("Login-Namen umstellen")')));
} catch (e) { check('Abschnitt "nichts zu tun" ohne Abbruch: ' + e.message, false); }

// Ohne das Recht zur Rollenvergabe fehlt auch diese Karte
try {
  meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen', 'betrieb'];
  meineRollen = ['planung'];
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  check('KRITISCH: ohne Recht zur Rollenvergabe fehlt auch die Karte "Login-Namen umstellen"',
    !(await sichtbar('lmKarte')));
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
} catch (e) { check('Abschnitt Login-Namen ohne Recht ohne Abbruch: ' + e.message, false); }

// ══════════════ PERSONALNUMMERN NACHTRAGEN (ENT-387)
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('pn'); });
  await page.waitForTimeout(900);
  check('KRITISCH: mit dem Recht "personal_schreiben" steht die Karte da',
    await sichtbar('pnKarte'));

  pnMigAntwort = [
    { id: 2, name: 'daniel.muccio', alt: null, neu: '4821', status: 'zugewiesen',
      aktiv: true, erstellt_am: '2025-02-01 09:00:00' },
    { id: 3, name: 'test.hans', alt: null, neu: '7093', status: 'zugewiesen',
      aktiv: false, erstellt_am: '2025-03-01 09:00:00' },
    { id: 1, name: 'adrian.vonarb', alt: '1', neu: '1', status: 'unveraendert',
      aktiv: true, erstellt_am: '2025-01-05 10:00:00' },
  ];
  await page.click('#pnKarte button:has-text("Vorschau laden")');
  await page.waitForTimeout(400);
  const vorschau = (await page.textContent('#pnInhalt')).replace(/\s+/g, ' ');
  check('Die Vorschau nennt die Anzahl der zuzuweisenden Personalnummern', /\b2\b/.test(vorschau));
  check('KRITISCH: die Tabelle zeigt Login-Name und neue Personalnummer',
    /daniel\.muccio/.test(vorschau) && /4821/.test(vorschau)
    && /test\.hans/.test(vorschau) && /7093/.test(vorschau));
  check('KRITISCH: bereits vergebene Personalnummern stehen NICHT in der Zuweisungstabelle',
    !vorschau.includes('adrian.vonarb'));
  check('KRITISCH: der Status unterscheidet aktiv/inaktiv, auch hier',
    /inaktiv/.test(vorschau));
  check('Der Knopf zum Ausfuehren nennt dieselbe Anzahl',
    /2 Personalnummern vergeben/.test(await page.textContent('#pnInhalt')));

  // Ausfuehren: erst die Rueckfrage, kein Schreiben davor
  gesendet = null; pnMigAufruf = null;
  await page.click('button:has-text("Personalnummern vergeben")');
  await page.waitForSelector('#dlgConfirm.on');
  check('KRITISCH: vor dem Ausfuehren steht eine Rueckfrage', pnMigAufruf === null);
  await page.click('#cfBtn');
  await page.waitForTimeout(500);
  check('KRITISCH: die Ausfuehrung ist ein POST mit ausdruecklicher Bestaetigung',
    pnMigAufruf && pnMigAufruf.methode === 'POST' && pnMigAufruf.body.bestaetigt === true);
  const ergebnis = (await page.textContent('#pnInhalt')).replace(/\s+/g, ' ');
  check('Die Meldung nennt, dass Personalnummern vergeben wurden',
    /vergeben/.test(ergebnis));
  check('KRITISCH: kein Abmelde-Hinweis -- die Personalnummer ist kein Anmeldemerkmal',
    !/abgemeldet|abmelden/i.test(ergebnis));
} catch (e) { check('Abschnitt Personalnummern nachtragen ohne Abbruch: ' + e.message, false); }

// Nichts zu tun: kein Vergeben-Knopf, klare Aussage statt leerer Tabelle
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('betrieb'); bkAbschnittZeigen('pn'); });
  await page.waitForTimeout(900);
  pnMigAntwort = [{ id: 1, name: 'adrian.vonarb', alt: '1', neu: '1', status: 'unveraendert',
    aktiv: true, erstellt_am: '2025-01-05 10:00:00' }];
  await page.click('#pnKarte button:has-text("Vorschau laden")');
  await page.waitForTimeout(400);
  const leer = (await page.textContent('#pnInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: "nichts zu tun" sagt das ausdruecklich, statt eine leere Tabelle zu zeigen',
    /Nichts zu tun/.test(leer));
  check('KRITISCH: ohne etwas zuzuweisen gibt es auch keinen Vergeben-Knopf',
    !(await page.$('button:has-text("Personalnummern vergeben")')));
} catch (e) { check('Abschnitt "nichts zu tun" (Personalnummern) ohne Abbruch: ' + e.message, false); }

// Personal_schreiben genuegt -- unabhaengig vom Recht "rechte" (Verwaltung),
// das die Login-Namen-Karte verlangt. Zwei verschiedene Gates fuer zwei
// verschieden riskante Aktionen.
try {
  meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen', 'personal_schreiben', 'personal_vertraulich'];
  meineRollen = ['personal'];
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  check('KRITISCH: "personal_schreiben" allein reicht fuer die Personalnummern-Karte',
    await sichtbar('bkKachelPn'));
  check('Ohne das Recht "rechte_schreiben" bleibt die Login-Namen-Karte trotzdem verborgen',
    !(await sichtbar('bkKachelRv')));
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
} catch (e) { check('Abschnitt Personalnummern-Recht ohne Abbruch: ' + e.message, false); }

// Ohne "personal_schreiben" fehlt die Karte
try {
  meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen', 'betrieb'];
  meineRollen = ['planung'];
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  check('KRITISCH: ohne "personal_schreiben" fehlt die Karte "Personalnummern"',
    !(await sichtbar('bkKachelPn')));
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
} catch (e) { check('Abschnitt Personalnummern ohne Recht ohne Abbruch: ' + e.message, false); }

check('Keine JavaScript-Fehler', jsFehler.length === 0);
if (jsFehler.length) { bad.push('JS: ' + jsFehler.slice(0, 3).join(' | ')); }

await browser.close();
console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
