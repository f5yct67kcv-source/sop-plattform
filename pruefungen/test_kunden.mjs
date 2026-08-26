// Kunden-Übersicht überarbeitet (ENT-040): Kundennummer, Kontaktperson und
// Notiz als neue Felder, erweiterte Suche, sortierbare Spalten, Alle/
// Archiviert-Reiter, Zeilen-Aktionsmenü und eine eigene Detailseite mit
// Reitern Übersicht/Rapporte/Offerten statt der bisherigen Bearbeiten-
// Schublade als einzigem Einstieg.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';


const URL = `file://${WURZEL}/dashboard.html`;
const EXE = browserPfad();

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

let kunden = [
  { id: 1, kundennummer: 'K0001', art: 'unternehmen', name: 'Studer Immobilien AG', strasse: 'Gerolagstrasse',
    hausnummer: '12', plz: '4632', ort: 'Trimbach', uid: 'CHE-100.200.300',
    telefon: '062 111 22 33', kontaktperson: 'Herr Studer', email: 'info@studer.ch', notiz: 'Zahlt immer pünktlich', aktiv: 1,
    kontaktwege: [{ art: 'telefon', wert: '062 111 22 33' }, { art: 'email', wert: 'info@studer.ch' }],
    personen: [{ anrede: 'Herr', vorname: 'Rolf', nachname: 'Studer',
      kontaktwege: [{ art: 'mobil', wert: '079 500 40 30' }] }] },
  { id: 2, kundennummer: 'K0002', art: 'unternehmen', name: 'Borner AG', strasse: 'Bahnhofstrasse',
    hausnummer: '1', plz: '4600', ort: 'Olten',
    telefon: '062 999 00 11', kontaktperson: '', email: '', notiz: 'Ansprechpartnerin mag keine Anrufe vor 9 Uhr', aktiv: 1,
    kontaktwege: [{ art: 'telefon', wert: '062 999 00 11' }], personen: [] },
  { id: 3, kundennummer: 'K0003', art: 'unternehmen', name: 'Alte Firma GmbH', strasse: 'Ruinenweg',
    hausnummer: '3', plz: '4500', ort: 'Solothurn',
    telefon: '032 111 22 33', kontaktperson: '', email: '', notiz: '', aktiv: 0,
    kontaktwege: [], personen: [] },
];
const RAPPORTE = { status: 'ok', rapporte: [
  // Zwei Zeilen desselben Einsatzes (ENT-173) -- gehoeren zusammengeklammert,
  // die dritte Zeile eines anderen Einsatzes bleibt fuer sich allein.
  { id: 50, datum: '2026-08-01', mitarbeiter: 'Hans Meier', kunde: 'Studer Immobilien AG', einsatz_id: 90, von: '07:00:00', bis: '16:00:00', netto_h: 8, auftrag_nr: 'A-123' },
  { id: 51, datum: '2026-08-01', mitarbeiter: 'Anna Muster', kunde: 'Studer Immobilien AG', einsatz_id: 90, von: '07:00:00', bis: '15:30:00', netto_h: 7.5, auftrag_nr: 'A-123' },
  { id: 52, datum: '2026-07-20', mitarbeiter: 'Hans Meier', kunde: 'Studer Immobilien AG', einsatz_id: 70, von: '08:00:00', bis: '12:00:00', netto_h: 4, auftrag_nr: null },
]};

let calls = [];
let berichtRufe = [];
const writes = () => calls.filter(c => /create|update|delete|deactivate|reset|archivieren/.test(c.p));

async function setup(page) {
  await page.route('**/api/**', async route => {
    const req = route.request();
    const p = req.url().split('/api/')[1].split('?')[0];
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
    calls.push({ p, body });
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
    if (p.includes('me.php')) return send({ status: 'ok', name: 'adrian', ist_admin: true, rollen: [], rechte: ['kunden', 'abgleich'] });
    if (p.includes('einsatz_bericht')) {
      berichtRufe.push((req.url().split('einsatz_id=')[1] || '').split('&')[0]);
      return send({ status: 'ok', bericht: { einsatz: { id: 90, kunde_name: 'Studer Immobilien AG', datum: '2026-08-01' },
        kunde: {}, unterschrift: {}, personen: [{ name: 'Hans Meier', von: '07:00', bis: '16:00', pause_min: 0, netto_h: 8 }] } });
    }
    if (p.includes('kunden_list')) {
      const naechste = 'K' + String(Math.max(...kunden.map(k => k.id)) + 1).padStart(4, '0');
      return send({ status: 'ok', kunden, naechste_kundennummer: naechste });
    }
    if (p.includes('kunden_create')) {
      const id = Math.max(...kunden.map(k => k.id)) + 1;
      const nr = 'K' + String(id).padStart(4, '0');
      // Wie der Server: die Einzelspalten leiten sich aus den Zeilen ab.
      const erst = a => (body.kontaktwege || []).find(w => w.art === a);
      const p0 = (body.personen || [])[0];
      kunden.push(Object.assign({}, body, { id, kundennummer: nr, aktiv: 1,
        telefon: (erst('telefon') || erst('mobil') || {}).wert || '',
        email: (erst('email') || {}).wert || '',
        kontaktperson: p0 ? `${p0.vorname} ${p0.nachname}`.trim() : '' }));
      return send({ status: 'ok', id, kundennummer: nr });
    }
    if (p.includes('kunden_update')) {
      const k = kunden.find(x => x.id === body.id);
      if (k) Object.assign(k, body);
      return send({ status: 'ok' });
    }
    if (p.includes('kunden_archivieren')) {
      const k = kunden.find(x => x.id === body.id);
      if (k) k.aktiv = body.aktiv;
      return send({ status: 'ok', aktiv: body.aktiv });
    }
    if (p.includes('rapport_list')) return send(RAPPORTE);
    return send({ status: 'ok', einsaetze: [], objekte: [], mitarbeiter: [], feiertage: [], gepflegt: {},
      sperren: [], kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [] });
  });
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
await setup(page);

await page.goto(URL);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on');

// ══════════════════════════════════════════ LISTE
await page.click('#nav-kunden');
await page.waitForSelector('#kuTable table');
check('Sidebar-Unterpunkt heisst Adressen statt Übersicht',
  (await page.textContent('#nav-kunden-uebersicht')).trim() === 'Adressen');
check('Kein eigener Übersicht/Objekte-Reiter mehr oben -- die Seitenleiste navigiert allein',
  (await page.$$('#kuHauptTabs')).length === 0);
check('"Neuer Kunde" ist etwas grösser als die übrigen Kopfzeilen-Knöpfe (kein btn-sm)',
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Neuer Kunde');
    return !!b && !b.className.includes('btn-sm');
  }));
check('Kein eigener Diktat-Knopf mehr -- die Recherche steckt seit ENT-042 im Anlegen-Dialog selbst',
  (await page.$$('button:has-text("Diktat: anlegen")')).length === 0);
check('Alle-Reiter zeigt nur aktive Kunden', (await page.$$('#kuTable tbody tr')).length === 2);
check('Kundennummer als eigene Spalte', (await page.textContent('#kuTable')).includes('K0001'));
const kopf = await page.$$eval('#kuTable thead th', ts => ts.map(t => t.textContent.trim()));
check('Kopfzeile mit Nr./Kunde/Strasse/Ort/Telefon/E-Mail/Rapporte/Aktion',
  ['Kunde', 'Strasse', 'Ort', 'Rapporte', 'Aktion'].every(w => kopf.some(k => k.startsWith(w))));
await page.screenshot({ path: `${OUT}/k-01-liste.png` });

// ══════════════════════════════════════════ SORTIERUNG
await page.click('#kuTable thead th:nth-child(2)'); // Kunde, aufsteigend
await page.waitForTimeout(150);
check('Sortiert aufsteigend nach Kunde', (await page.textContent('#kuTable tbody tr:first-child')).includes('Borner AG'));
await page.click('#kuTable thead th:nth-child(2)'); // Kunde, absteigend
await page.waitForTimeout(150);
check('Zweiter Klick kehrt die Richtung um', (await page.textContent('#kuTable tbody tr:first-child')).includes('Studer'));
await page.click('#kuTable thead th:nth-child(1)'); // zurueck auf Nr., Standard
await page.waitForTimeout(150);
check('Andere Spalte klicken setzt wieder aufsteigend', (await page.textContent('#kuTable tbody tr:first-child')).includes('K0001'));

// ══════════════════════════════════════════ ERWEITERTE SUCHE
await page.fill('#kQ', 'Anrufe vor 9');
await page.waitForTimeout(150);
check('Suche findet Treffer in der Notiz, nicht nur in sichtbaren Spalten', (await page.$$('#kuTable tbody tr')).length === 1);
check('Richtiger Treffer bei Notiz-Suche', (await page.textContent('#kuTable')).includes('Borner AG'));
await page.fill('#kQ', 'Herr Studer');
await page.waitForTimeout(150);
check('Suche findet Treffer in der Kontaktperson', (await page.textContent('#kuTable')).includes('Studer Immobilien AG'));
await page.fill('#kQ', 'K0002');
await page.waitForTimeout(150);
check('Suche findet Treffer über die Kundennummer', (await page.textContent('#kuTable')).includes('Borner AG'));
await page.fill('#kQ', 'nichts-passt-hier');
await page.waitForTimeout(150);
check('Ohne Treffer erscheint der Leerzustand', (await page.textContent('#kuTable')).includes('Keine Treffer'));
await page.fill('#kQ', '');
await page.waitForTimeout(150);

// ══════════════════════════════════════════ ARCHIVIERT-REITER
await page.click('#kuatab-archiv');
await page.waitForTimeout(150);
check('Archiviert-Reiter zeigt nur archivierte Kunden', (await page.$$('#kuTable tbody tr')).length === 1);
check('Archivierte Firma sichtbar', (await page.textContent('#kuTable')).includes('Alte Firma GmbH'));
check('Aktive Kunden nicht im Archiv-Reiter', !(await page.textContent('#kuTable')).includes('Studer Immobilien AG'));
await page.click('#kuatab-alle');
await page.waitForTimeout(150);
check('Zurück auf Alle sind wieder die aktiven da', (await page.$$('#kuTable tbody tr')).length === 2);

// ══════════════════════════════════════════ ZEILEN-AKTIONSMENÜ
await page.click('#kuTable tbody tr:first-child .rowmenu-btn');
await page.waitForTimeout(150);
check('Menü öffnet sich', await page.isVisible('#rowmenuPop.on'));
check('Bearbeiten ist da', await page.isVisible('#rowmenuPop button:has-text("Bearbeiten")'));
check('Offerte erstellen ist ausgegraut (noch nicht definiert)', await page.isDisabled('#rowmenuPop button:has-text("Offerte erstellen")'));
check('Rechnung erstellen ist ausgegraut (noch nicht definiert)', await page.isDisabled('#rowmenuPop button:has-text("Rechnung erstellen")'));
check('Archivieren ist da', await page.isVisible('#rowmenuPop button:has-text("Archivieren")'));
await page.screenshot({ path: `${OUT}/k-02-menue.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape schliesst das Menü', !(await page.isVisible('#rowmenuPop.on')));
await page.click('#kuTable tbody tr:first-child .rowmenu-btn');
await page.waitForTimeout(150);
await page.click('body', { position: { x: 5, y: 5 } });
await page.waitForTimeout(150);
check('Klick ausserhalb schliesst das Menü', !(await page.isVisible('#rowmenuPop.on')));

// Archivieren direkt aus dem Menü
await page.click('#kuTable tbody tr:nth-child(2) .rowmenu-btn'); // Borner AG
await page.waitForTimeout(150);
calls = [];
await page.click('#rowmenuPop button:has-text("Archivieren")');
await page.waitForTimeout(300);
const arch1 = calls.find(c => c.p.includes('kunden_archivieren'));
check('Archivieren aus dem Menü ruft den Endpunkt mit aktiv=0', arch1 && arch1.body.aktiv === 0);
check('Borner AG danach nicht mehr in Alle', !(await page.textContent('#kuTable')).includes('Borner AG'));

// ══════════════════════════════════════════ DETAILSEITE
await page.click('#kuTable tbody tr:first-child'); // Studer
await page.waitForTimeout(200);
check('Klick auf eine Zeile öffnet die Detailseite', await page.evaluate(() => document.getElementById('kv-detail').classList.contains('on')));
check('Kopf zeigt den Namen', (await page.textContent('#kdName')) === 'Studer Immobilien AG');
check('Kopf zeigt die Kundennummer', (await page.textContent('#kdSub')).includes('K0001'));
check('Sidebar markiert weiterhin Übersicht (kein eigener Menüpunkt für die Detailseite)',
  await page.evaluate(() => document.getElementById('nav-kunden-uebersicht').classList.contains('on')));
const info = await page.textContent('#kdInfo');
check('Detail-Übersicht zeigt Adresse, Ansprechperson und Notiz',
  info.includes('Gerolagstrasse 12') && info.includes('4632 Trimbach')
  && info.includes('Herr Rolf Studer') && info.includes('pünktlich'));
check('Detail-Übersicht zeigt die Kommunikationswege', info.includes('062 111 22 33') && info.includes('info@studer.ch'));
check('Detail-Übersicht zeigt den Kommunikationsweg der Ansprechperson', info.includes('079 500 40 30'));
check('Detail-Übersicht nennt die Art und die UID', info.includes('Unternehmen') && info.includes('CHE-100.200.300'));
await page.screenshot({ path: `${OUT}/k-03-detail.png` });

await page.click('#kdtab-rapporte');
await page.waitForTimeout(150);
check('Rapporte-Reiter zeigt den passenden Rapport (Namensabgleich)', (await page.textContent('#kdRapporte')).includes('A-123'));

// ── Klammer fuer zusammengehoerige Rapporte am selben Einsatz (ENT-173,
// seit ENT-178 mit sichtbarer Beschriftung statt nur Symbol und Flaeche
// ueber der ganzen Gruppe statt nur der Randlinie)
const kdZeilen = await page.evaluate(() => [...document.querySelectorAll('#kdRapporte tbody tr')].map(r => ({
  klasse: r.className, zellen: r.children.length,
  hatKlammer: !!r.querySelector('.rapp-klammer'), hatKnopf: !!r.querySelector('.rapp-klammer button'),
  knopfText: r.querySelector('.rapp-klammer button span')?.textContent.trim() || null,
  // Letzte Spalte (Auftrag-Nr.) ist in jeder Zeile vorhanden, mit oder ohne
  // eigene Klammer-Zelle -- ein verlaesslicher Vergleichspunkt ueber alle drei.
  hintergrund: getComputedStyle(r.children[r.children.length - 1]).backgroundColor,
})));
check('KRITISCH: drei Zeilen, zwei davon am selben Einsatz', kdZeilen.length === 3);
check('KRITISCH: die erste Zeile der Gruppe traegt die Klammer mit Knopf',
  kdZeilen[0].hatKlammer && kdZeilen[0].hatKnopf && kdZeilen[0].klasse.includes('rapp-gruppe-offen'));
check('Der Knopf traegt eine sichtbare Beschriftung, nicht nur ein Symbol (ENT-178)',
  kdZeilen[0].knopfText === 'Kundenrapport');
check('KRITISCH: die zweite Zeile der Gruppe hat keine eigene Klammer-Zelle mehr -- rowspan uebernimmt das',
  kdZeilen[1].zellen === 5 && !kdZeilen[1].hatKlammer && !kdZeilen[1].klasse.includes('rapp-gruppe-offen'));
check('KRITISCH: die dritte, alleinstehende Zeile hat eine leere Klammer-Zelle, aber keinen Knopf',
  kdZeilen[2].hatKlammer && !kdZeilen[2].hatKnopf);
check('Alle Zeilen haben gleich viele sichtbare Spalten (die Klammer zaehlt nur einmal je Gruppe)',
  kdZeilen[0].zellen === 6 && kdZeilen[2].zellen === 6);
check('Gruppierte Zeilen tragen eine Hintergrundflaeche, die alleinstehende Zeile nicht (ENT-178)',
  kdZeilen[0].hintergrund === kdZeilen[1].hintergrund && kdZeilen[0].hintergrund !== kdZeilen[2].hintergrund);

// ── Der Knopf ruft tatsaechlich den Kundenrapport DES EINSATZES ab, nicht
// nur irgendeinen -- und druckt ihn.
// Gezielt in #kdRapporte geklickt, nicht ".rapp-klammer button" pauschal --
// dieselbe Klasse traegt seit ENT-178 auch die globale, kundenuebergreifende
// Rapporte-Liste (#rapporteTable), die im Hintergrund immer mitgeladen wird
// (loadRapporte() laeuft unabhaengig vom aktiven Reiter) und mit derselben
// Fixture ebenfalls eine (unsichtbare) Klammer samt Knopf traegt.
await page.evaluate(() => { window.__gedruckt = 0; window.print = () => window.__gedruckt++; });
await page.click('#kdRapporte .rapp-klammer button');
await page.waitForTimeout(400);
check('KRITISCH: der Klammer-Knopf ruft denselben Endpunkt wie im Einsatzplan (ENT-160) mit der richtigen einsatz_id auf',
  berichtRufe.includes('90'));
check('KRITISCH: und loest das Drucken aus', await page.evaluate(() => window.__gedruckt > 0));

// Gegenprobe fuer die Rechtegrenze: ohne "abgleich" gibt es weder Knopf noch
// einen Aufruf des Endpunkts -- nur die leere Klammer-Zelle bleibt.
await page.evaluate(() => { me.rechte = ['kunden']; renderKundeDetail(); });
await page.waitForTimeout(150);
check('KRITISCH: ohne das Recht "abgleich" gibt es keinen Knopf, nur die stumme Klammer',
  await page.evaluate(() => !document.querySelector('#kdRapporte .rapp-klammer button')
    && !!document.querySelector('#kdRapporte .rapp-klammer')));
await page.evaluate(() => { me.rechte = ['kunden', 'abgleich']; renderKundeDetail(); });

await page.click('#kdtab-offerten');
await page.waitForTimeout(150);
check('Offerten-Reiter ist ein Platzhalter -- die Funktion existiert noch nicht',
  (await page.textContent('#kdOfferten')).toLowerCase().includes('noch nicht verfügbar'));
await page.screenshot({ path: `${OUT}/k-04-offerten.png` });

// Bearbeiten von der Detailseite aus
await page.click('#kdtab-uebersicht');
await page.waitForTimeout(150);
await page.click('#kv-detail button:has-text("Bearbeiten")');
await page.waitForSelector('#dlgKunde.on');
check('Bearbeiten nutzt denselben Dialog wie das Anlegen (ENT-044)',
  await page.evaluate(() => document.getElementById('dlgKunde').classList.contains('on')));
check('Dialog zeigt die aktuellen Werte', (await page.inputValue('#ku_name')) === 'Studer Immobilien AG');
await page.click('#kudtab-personen');
await page.waitForTimeout(150);
check('Bestehende Ansprechperson geladen', (await page.inputValue('#kup_nachname_0')) === 'Studer');
check('Ihr Kommunikationsweg geladen',
  (await page.inputValue('#kuPersonenListe .ku-person .kw-reihe:nth-child(2) [data-kpw="wert"]')) === '079 500 40 30');
await page.click('#kudtab-kommunikation');
await page.fill('#ku_notiz', 'Notiz nach dem Bearbeiten');
calls = [];
await page.click('#kuBtn');
await page.waitForTimeout(300);
const upd = calls.find(c => c.p.includes('kunden_update'));
check('Speichern sendet Notiz mit', upd && upd.body.notiz === 'Notiz nach dem Bearbeiten');
check('Speichern sendet die Ansprechperson unverändert mit', upd && upd.body.personen.length === 1
  && upd.body.personen[0].nachname === 'Studer'
  && upd.body.personen[0].kontaktwege.some(w => w.wert === '079 500 40 30'));
check('Kundennummer ist kein Bestandteil des Speicherns (unveränderlich)', upd && !('kundennummer' in upd.body));
check('Detailseite zeigt die neue Notiz sofort', (await page.textContent('#kdInfo')).includes('Notiz nach dem Bearbeiten'));

// Archivieren direkt im Kopf der Detailseite
calls = [];
await page.click('#kdArchivBtn');
await page.waitForTimeout(300);
const arch2 = calls.find(c => c.p.includes('kunden_archivieren'));
check('Archivieren im Detailkopf ruft den Endpunkt auf', arch2 && arch2.body.aktiv === 0);
check('Bleibt nach dem Archivieren auf der Detailseite (kein Rücksprung)',
  await page.evaluate(() => document.getElementById('kv-detail').classList.contains('on')));
check('Status wechselt sichtbar auf archiviert', (await page.textContent('#kdSub')).includes('archiviert'));
check('Knopf bietet jetzt Wiederherstellen an', (await page.textContent('#kdArchivBtn')) === 'Wiederherstellen');
await page.click('#kdArchivBtn');
await page.waitForTimeout(300);
check('Wiederherstellen setzt aktiv zurück', (await page.textContent('#kdArchivBtn')) === 'Archivieren');

await page.click('#kv-detail .ku-zurueck');   // seit ENT-048 gibt es die Klasse auch im Mitarbeiterbereich
await page.waitForTimeout(200);
check('Zurück-Pfeil führt auf die Liste', await page.evaluate(() => document.getElementById('kv-uebersicht').classList.contains('on')));

// ══════════════════════════════════════════ NEUER KUNDE (ENT-044)
calls = [];
await page.click('button:has-text("Neuer Kunde")');
await page.waitForSelector('#dlgKunde.on');
check('Kundennummer steht als Vorschau im Dialog', (await page.inputValue('#ku_kundennummer')) === 'K0004');
check('Kundennummer ist ausgegraut und nicht eingebbar',
  (await page.getAttribute('#ku_kundennummer', 'readonly')) !== null);
check('Auswahl Unternehmen/Privatperson vorhanden',
  await page.isVisible('#kuArtUnternehmen') && await page.isVisible('#kuArtPrivat'));
check('Unternehmen ist die Vorgabe', await page.isChecked('#kuArtUnternehmen'));
check('Reiter Kommunikation und Kontaktpersonen vorhanden',
  await page.isVisible('#kudtab-kommunikation') && await page.isVisible('#kudtab-personen'));
check('Adressfelder getrennt: Strasse, Nr., PLZ, Ort, Zusatz',
  await page.isVisible('#ku_strasse') && await page.isVisible('#ku_hausnummer')
  && await page.isVisible('#ku_plz') && await page.isVisible('#ku_ort')
  && await page.isVisible('#ku_zusatzfeld') && await page.isVisible('#ku_adresszusatz'));
check('UID und MWST-Nr. vorhanden', await page.isVisible('#ku_uid') && await page.isVisible('#ku_mwst_nr'));
check('Dialog hat ein Notiz-Feld', await page.isVisible('#ku_notiz'));

// Privatperson blendet die Firmenfelder aus und die Namensfelder ein
await page.click('#kuArtPrivat');
await page.waitForTimeout(150);
check('Privatperson: Unternehmensname weg', !(await page.isVisible('#ku_name')));
check('Privatperson: Anrede, Vor- und Nachname da',
  await page.isVisible('#ku_anrede') && await page.isVisible('#ku_vorname') && await page.isVisible('#ku_nachname'));
check('Privatperson: keine UID -- die hat nur ein Unternehmen', !(await page.isVisible('#ku_uid')));
check('Privatperson: auch keine Web-Recherche', !(await page.isVisible('#kuRechercheBtn')));
await page.screenshot({ path: `${OUT}/k-06-privatperson.png` });
await page.fill('#ku_vorname', 'Anna');
await page.fill('#ku_nachname', 'Beispiel');
await page.fill('#ku_plz', '4600');
await page.fill('#ku_ort', 'Olten');
calls = [];
await page.click('#kuBtn');
await page.waitForTimeout(300);
const privat = calls.find(c => c.p.includes('kunden_create'));
check('Privatperson wird mit art=privat angelegt', privat && privat.body.art === 'privat'
  && privat.body.vorname === 'Anna' && privat.body.nachname === 'Beispiel');

// Unternehmen mit Kommunikationszeilen und Ansprechperson
calls = [];
await page.click('button:has-text("Neuer Kunde")');
await page.waitForSelector('#dlgKunde.on');
check('Drei leere Kommunikationszeilen als Startpunkt', (await page.$$('#kuWegeListe .kw-reihe')).length === 3);
await page.fill('#ku_name', 'Test GmbH');
await page.fill('#ku_strasse', 'Teststrasse');
await page.fill('#ku_hausnummer', '1');
await page.fill('#ku_plz', '4600');
await page.fill('#ku_ort', 'Olten');
await page.fill('#ku_notiz', 'Testnotiz');
await page.fill('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]', '062 000 00 00');
await page.click('button:has-text("Weitere Kontaktmöglichkeit hinzufügen")');
await page.waitForTimeout(150);
check('Zeile hinzufügen erhöht die Anzahl', (await page.$$('#kuWegeListe .kw-reihe')).length === 4);
check('Bereits Getipptes überlebt das Hinzufügen',
  (await page.inputValue('#kuWegeListe .kw-reihe:nth-child(2) [data-kw="wert"]')) === '062 000 00 00');
await page.selectOption('#kuWegeListe .kw-reihe:nth-child(4) [data-kw="art"]', 'mobil');
await page.fill('#kuWegeListe .kw-reihe:nth-child(4) [data-kw="wert"]', '079 123 45 67');
await page.click('#kudtab-personen');
await page.waitForTimeout(150);
await page.selectOption('#kup_anrede_0', 'Frau');
await page.fill('#kup_vorname_0', 'Erika');
await page.fill('#kup_nachname_0', 'Test');
await page.fill('#kuPersonenListe .ku-person .kw-reihe:nth-child(2) [data-kpw="wert"]', 'erika@test.ch');
await page.click('button:has-text("Weitere Kontaktperson hinzufügen")');
await page.waitForTimeout(150);
check('Zweite Kontaktperson angelegt', (await page.$$('#kuPersonenListe .ku-person')).length === 2);
check('Erste Person bleibt beim Hinzufügen erhalten', (await page.inputValue('#kup_vorname_0')) === 'Erika');
await page.screenshot({ path: `${OUT}/k-07-kontaktpersonen.png` });
await page.click('#kuPersonenListe .ku-person:nth-child(2) button:has-text("Kontaktperson löschen")');
await page.waitForTimeout(150);
check('Leere zweite Person wieder entfernt', (await page.$$('#kuPersonenListe .ku-person')).length === 1);
await page.click('#kuBtn');
await page.waitForTimeout(300);
const neu = calls.find(c => c.p.includes('kunden_create'));
check('Anlegen sendet Notiz', neu && neu.body.notiz === 'Testnotiz');
check('Anlegen sendet beide Kommunikationszeilen', neu && neu.body.kontaktwege.length === 2
  && neu.body.kontaktwege.some(w => w.art === 'telefon' && w.wert === '062 000 00 00')
  && neu.body.kontaktwege.some(w => w.art === 'mobil' && w.wert === '079 123 45 67'));
check('Anlegen sendet genau eine Ansprechperson', neu && neu.body.personen.length === 1
  && neu.body.personen[0].anrede === 'Frau' && neu.body.personen[0].vorname === 'Erika'
  && neu.body.personen[0].kontaktwege[0].wert === 'erika@test.ch');
check('Neuer Kunde erscheint in der Liste mit vergebener Nummer', (await page.textContent('#kuTable')).includes('Test GmbH'));

// ══════════════════════════════════════════ MOBIL: KEIN SEITEN-SCROLL
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Kein Seiten-Scroll auf 390px trotz zusätzlicher Spalten', scrollX <= 1);
await page.setViewportSize({ width: 1500, height: 950 });

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
