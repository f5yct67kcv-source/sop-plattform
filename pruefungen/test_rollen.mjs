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

const ALLE_RECHTE = ['plan', 'kunden', 'abgleich', 'personal_lesen',
  'personal_schreiben', 'personal_vertraulich', 'betrieb', 'rechte'];

const MA = [
  { id: 1, name: 'chefin', vorname: 'Eine', nachname: 'Leitung', personalnummer: 'P-001',
    ist_admin: true, aktiv: 1, erstellt_am: '2025-01-02', rollen: ['verwaltung'] },
  { id: 2, name: 'planer', vorname: 'Zwei', nachname: 'Planung', personalnummer: 'P-002',
    ist_admin: false, aktiv: 1, erstellt_am: '2025-02-03', rollen: ['planung'] },
  { id: 3, name: 'hilfe', vorname: 'Drei', nachname: 'Mitarbeit', personalnummer: 'P-003',
    ist_admin: false, aktiv: 1, erstellt_am: '2025-03-04', rollen: ['mitarbeitend'] },
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
    return send({ status: 'ok', eingerichtet: true, vertraulich: kann('personal_vertraulich'),
      darf_aendern: kann('personal_schreiben'),
      darf_rollen: kann('rechte'),
      mitarbeiter: { ...MA[1], rollen: dossierRollen, sprache: 'de' } });
  }
  if (u.includes('mitarbeiter_update') || u.includes('mitarbeiter_create')) {
    gesendet = koerper();
    return send({ status: 'ok', geaendert: 1 });
  }
  if (u.includes('mitarbeiter_list')) {
    return send({ status: 'ok', mitarbeiter: MA, listen: LISTEN, eingerichtet: true,
      darf_aendern: kann('personal_schreiben'),
      darf_rollen: kann('rechte'),
      rollen_eingerichtet: rollenEingerichtet });
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
try {
  const { readFileSync } = await import('fs');
  const php = readFileSync(`${WURZEL}/backend/rechte.php`, 'utf8');
  const html = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
  // Die Oberflaeche spiegelt den Katalog aus rechte.php. Laufen die beiden
  // auseinander, verspricht ein Kaestchen etwas anderes, als der Server tut.
  const phpRollen = [...php.matchAll(/^const ROLLE_\w+\s*=\s*'([a-z]+)';/gm)].map(m => m[1]);
  const jsRollen  = [...html.matchAll(/^  \['([a-z]+)', '[^']+',$/gm)].map(m => m[1]);
  check('KRITISCH: die Oberflaeche kennt genau die Rollen des Servers',
    phpRollen.length === 4 && JSON.stringify(phpRollen) === JSON.stringify(jsRollen));
  // Nur aus dem Rumpf von rechte_katalog() lesen -- sonst zaehlen die
  // Meldungstexte weiter unten mit, die genauso aussehen. Genau das ist der
  // ersten Fassung dieser Pruefung passiert.
  const rumpf = (php.match(/function rechte_katalog\(\): array\s*\{[\s\S]*?\n\}/) || [''])[0];
  const phpRechte = [...rumpf.matchAll(/'(\w+)' *=> '[^']+',/g)].map(m => m[1]);
  // Neun seit ENT-181 ('offerten' kam dazu). Die feste Zahl ist Absicht und
  // keine Bequemlichkeit: Sie zwingt jeden, der ein Recht ergaenzt, hier
  // vorbeizukommen und es bewusst zu tun -- die Regel aus ENT-077 lautet
  // "grob geschnitten, nicht sechzig", und ein stillschweigend wachsender
  // Katalog waere genau der Weg dorthin.
  check('Der Server kennt genau die neun entschiedenen Rechte',
    phpRechte.length === 9 && phpRechte.includes('personal_vertraulich')
    && phpRechte.includes('offerten'));
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
  meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen'];
  meineRollen = ['planung'];
  check('Die Planung kommt ebenfalls ins Dashboard, nicht nur Admins', await anmelden());
  check('Die Kopfzeile nennt "Planung"', /Planung/.test(await page.textContent('#uRole')));
  check('Planung sieht die Einsatzplanung', await sichtbar('nav-planung'));
  check('Planung sieht die Mitarbeitendenliste', await sichtbar('nav-admin-mitarbeiter'));
  check('KRITISCH: Planung sieht den Betrieb nicht', !(await sichtbar('nav-admin-betrieb')));
  check('KRITISCH: Planung sieht die Einrichtung nicht', !(await sichtbar('nav-einrichtung')));
  check('KRITISCH: Planung sieht den Verlaufs-Reiter nicht',
    !(await sichtbar('mdtab-verlauf')));

  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(600);
  check('KRITISCH: ohne Recht zur Rollenvergabe gibt es keine Rollenkästchen',
    await page.evaluate(() => !document.getElementById('maRolle_verwaltung')));
  check('Aber die Rollen stehen trotzdem da — "darf ich nicht sehen" wäre etwas anderes als "keine"',
    /Planung/.test(await page.textContent('#mv-bearbeiten')));
} catch (e) { check('Abschnitt Planung ohne Abbruch: ' + e.message, false); }

// ══════════════ ROLLEN VERGEBEN
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(800);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(600);

  check('KRITISCH: die Rollen werden in der Personalakte vergeben, nicht in einem eigenen Bereich',
    await page.evaluate(() => !!document.getElementById('maRolle_verwaltung')
      && !!document.getElementById('mv-bearbeiten').contains(document.getElementById('maRolle_verwaltung'))));
  check('Alle vier Rollen stehen zur Wahl',
    await page.evaluate(() => ['mitarbeitend', 'planung', 'personal', 'verwaltung']
      .every(r => !!document.getElementById('maRolle_' + r))));
  check('Die bestehende Rolle ist angehakt, die anderen nicht',
    await page.evaluate(() => document.getElementById('maRolle_planung').checked
      && !document.getElementById('maRolle_verwaltung').checked));
  check('Zu jeder Rolle steht, was sie darf',
    /AHV-Nummer/.test(await page.textContent('#mv-bearbeiten')));

  // Mehrfachauswahl -- der Grund fuer das Datenmodell
  gesendet = null;
  await page.check('#maRolle_personal');
  await page.evaluate(() => mbSpeichern());
  await page.waitForTimeout(600);
  check('KRITISCH: zwei Rollen lassen sich gleichzeitig setzen',
    gesendet && Array.isArray(gesendet.rollen)
    && gesendet.rollen.includes('planung') && gesendet.rollen.includes('personal'));

  // Keine Rolle -> Hinweis statt stiller Rechteverlust
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('planer'); });
  await page.waitForTimeout(700);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(500);
  gesendet = null;
  await page.evaluate(() => {
    ['mitarbeitend', 'planung', 'personal', 'verwaltung'].forEach(r => {
      const k = document.getElementById('maRolle_' + r);
      if (k) { k.checked = false; }
    });
    mbSpeichern();
  });
  await page.waitForTimeout(500);
  check('KRITISCH: gar keine Rolle wird nicht gespeichert, sondern beanstandet',
    gesendet === null);
} catch (e) { check('Abschnitt Rollenvergabe ohne Abbruch: ' + e.message, false); }

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

// ══════════════ ROLLENUEBERSICHT UNTER BETRIEB
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  const r = (await page.textContent('#rvInhalt')).replace(/\s+/g, ' ');
  check('Die Übersicht zeigt alle vier Rollen',
    /Mitarbeitend/.test(r) && /Planung/.test(r) && /Personal/.test(r) && /Verwaltung/.test(r));
  check('Und wer sie hat', /Eine Leitung/.test(r) && /Zwei Planung/.test(r));
  check('KRITISCH: eine Rolle ohne Personen sagt "niemand" statt leer zu bleiben',
    /niemand/.test(r));
  check('Sie verweist auf die Personalakte zum Vergeben — nicht auf einen zweiten Bereich',
    /Personalakte/.test(r) && /Zugang/.test(r));
} catch (e) { check('Abschnitt Rollenübersicht ohne Abbruch: ' + e.message, false); }

// ══════════════ NICHT EINGERICHTET SIEHT NICHT WIE EINGERICHTET AUS
// Genau das ist im Betrieb passiert: Die Zwei-Faktor-Karte meldete fehlende
// Tabellen, die Rollenkarte daneben zeigte eine saubere Verteilung -- weil
// sie den Rueckfallwert aus ist_admin anzeigte, als waere er eine vergebene
// Rolle. Man sucht den Fehler dann an der falschen Stelle.
try {
  meineRechte = ALLE_RECHTE; meineRollen = ['verwaltung'];
  rollenEingerichtet = false;
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  const r = (await page.textContent('#rvInhalt')).replace(/\s+/g, ' ');
  check('KRITISCH: ohne Einrichtung sagt die Rollenkarte genau das',
    /[Nn]och nicht eingerichtet/.test(r));
  check('Und sie sagt, was zu tun ist', /Einrichtung/.test(r));
  check('KRITISCH: sie zeigt KEINE Verteilung, die nach echten Rollen aussieht',
    !/Eine Leitung/.test(r) && !/Zwei Planung/.test(r));
  rollenEingerichtet = true;
} catch (e) { check('Abschnitt ohne Einrichtung ohne Abbruch: ' + e.message, false); }

// Ohne das Recht darf die Karte gar nicht dastehen
try {
  meineRechte = ['plan', 'kunden', 'abgleich', 'personal_lesen', 'betrieb'];
  meineRollen = ['planung'];
  await anmelden();
  await page.evaluate(() => go('betrieb'));
  await page.waitForTimeout(900);
  check('KRITISCH: ohne Recht zur Rollenvergabe fehlt die Rollenübersicht',
    !(await sichtbar('rvKarte')));
} catch (e) { check('Abschnitt ohne Recht ohne Abbruch: ' + e.message, false); }

check('Keine JavaScript-Fehler', jsFehler.length === 0);
if (jsFehler.length) { bad.push('JS: ' + jsFehler.slice(0, 3).join(' | ')); }

await browser.close();
console.log(bad.length ? `\n✓ ${ok.length} bestanden\n\n✗ ${bad.length} FEHLGESCHLAGEN:\n  - ${bad.join('\n  - ')}`
                       : `\n✓ ${ok.length} bestanden`);
process.exit(bad.length ? 1 : 0);
