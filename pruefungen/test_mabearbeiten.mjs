// Volle Bearbeitungsflaeche fuer Mitarbeitende (ENT-072).
//
// Worauf diese Pruefungen zielen -- in dieser Reihenfolge, weil so auch der
// Schaden waere:
//  1. Die Sammelabfrage darf keine Personalakte sein. Wer die Liste laedt,
//     bekommt AHV-Nummer und Registerdaten NICHT.
//  2. Was leer aussieht, muss leer erfasst sein -- nicht "Spalte fehlt".
//  3. Ein "gültig bis" steht neben SEINEM Ausweis, nicht irgendwo.
//  4. Ein Feld, das die Flaeche nicht kennt, geht beim Speichern nicht
//     verloren -- der Server behaelt den Bestand.
import { WURZEL, HIER, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const HTML = readFileSync(`${WURZEL}/dashboard.html`, 'utf8');
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Aus HEUTE berechnet statt fest hingeschrieben (test_datumsfest.mjs): ein
// "bald ablaufender" Ausweis muss auch in einem Monat noch bald ablaufend
// sein, nicht ploetzlich abgelaufen oder ploetzlich weit in der Zukunft.
const bald = d => new Date(Date.now() + d * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const dmy = d => d.split('-').reverse().join('.');
const DIENSTAUSWEIS_GUELTIG_BIS = bald(45);

const MA = [{ id: 1, name: 'mitarbeiter-a', vorname: 'Vorname', nachname: 'Testperson',
  personalnummer: 'P-001', ist_admin: false, aktiv: 1, erstellt_am: '2025-03-04',
  funktion_id: 2, abteilung_id: 1, anstellungsort_id: 7,
  strasse: 'Musterweg', hausnummer: '3', plz: '4600', ort: 'Testort',
  telefon: '062 000 00 00', mobil: '', email: 'a@b.ch',
  fachausweis: 'Bewachung', diensthundefuehrer: 1, waffentragberechtigt: 0 }];
const DOSSIER = {
  id: 1, name: 'mitarbeiter-a', ist_admin: false, aktiv: true, erstellt_am: '2025-03-04',
  personalnummer: 'P-001', vorname: 'Vorname', nachname: 'Testperson',
  geburtsdatum: '1990-05-05', strasse: 'Musterweg', hausnummer: '3',
  plz: '4600', ort: 'Testort', land: 'CH', telefon: '062 000 00 00', email: 'a@b.ch',
  funktion_id: 2, abteilung_id: 1, anstellungsort_id: 7,
  anstellungskategorie: 'C', pensum_stunden: 900, eintritt: '2025-01-01',
  fachausweis: 'Bewachung', fachausweis_am: '2022-09-01', basisausbildung_am: '',
  diensthundefuehrer: 1, waffentragberechtigt: 0, sprache: 'de',
  ahv_nr: '756.1234.5678.97', aufenthaltsbewilligung: 'C', zemis_nr: '',
  // Ein abgelaufener und ein bald ablaufender Ausweis: beides muss die
  // Leseansicht benennen, sonst plant jemand eine Person ein, die nicht darf.
  aufenthalt_gueltig_bis: '2020-01-01',
  dienstausweis_nr: 'DA-9', dienstausweis_gueltig_bis: DIENSTAUSWEIS_GUELTIG_BIS,
  strafregister_datum: '2024-12-01', heimatort: 'Testgemeinde', nationalitaet: 'CH',
  // So liefert MySQL ein Feld zurueck, in das einmal ein leerer Text geriet.
  // Es ist NICHT der 0.0.0000 und schon gar nicht "abgelaufen" -- es ist
  // nicht erfasst.
  heiratsdatum: '0000-00-00', austritt: '0000-00-00', arbeit_gueltig_bis: '0000-00-00',
};
const LISTEN = { funktion: [{ id: 1, bezeichnung: 'Sicherheitsmitarbeiter' },
  { id: 2, bezeichnung: 'Objektleiter' }], abteilung: [{ id: 1, bezeichnung: 'Bewachung' }] };
const ORTE = [{ id: 7, bezeichnung: 'Standort Testort', rolle: 'hao', aktiv: 1 }];

let gesendet = null, dossierRuf = 0, eingerichtet = true, listenLeer = false, speichernOk = true;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(5000);
const jsFehler = [];
page.on('pageerror', e => jsFehler.push(e.message));

await page.route('**/api/**', async r => {
  const u = r.request().url();
  const send = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('mitarbeiter_dossier')) {
    dossierRuf++;
    // Der Mock antwortet auf den angefragten Namen -- sonst laesst sich nicht
    // pruefen, dass nach dem Anlegen die NEUE Person offen steht.
    const n = decodeURIComponent((u.split('name=')[1] || '').split('&')[0]);
    return send({ status: 'ok', eingerichtet,
      mitarbeiter: Object.assign({}, DOSSIER, { name: n }) });
  }
  if (u.includes('mitarbeiter_create')) {
    gesendet = JSON.parse(r.request().postData() || '{}');
    return speichernOk ? send({ status: 'ok' })
      : send({ status: 'error', message: 'Login-Name bereits vergeben.' });
  }
  if (u.includes('mitarbeiter_update')) {
    gesendet = JSON.parse(r.request().postData() || '{}');
    return speichernOk ? send({ status: 'ok' })
      : send({ status: 'error', message: 'AHV-Nummer stimmt nicht (Pruefziffer).' });
  }
  if (u.includes('mitarbeiter_list')) {
    return send({ status: 'ok', mitarbeiter: MA,
      listen: listenLeer ? { funktion: [], abteilung: [] } : LISTEN, eingerichtet });
  }
  if (u.includes('anstellungsorte')) return send({ status: 'ok', orte: ORTE });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [],
    letzte_rapporte: [], mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [],
    orte: [], feiertage: [], gepflegt: {} });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

const oeffnen = async () => {
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('mitarbeiter-a'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => mdBearbeiten());
  await page.waitForTimeout(500);
};

// ══════════════ SPARSAMKEIT: die Liste ist keine Personalakte
{
  const q = await page.evaluate(() => mitarbeiter[0]);
  check('Die Sammelabfrage traegt keine AHV-Nummer in den Browser', !('ahv_nr' in q));
  check('Die Sammelabfrage traegt keine Registerdaten in den Browser',
    !('strafregister_datum' in q) && !('betreibung_datum' in q));
  check('Die Berechtigungen stehen dagegen in der Liste -- die Planung braucht sie',
    'fachausweis' in q && 'diensthundefuehrer' in q && 'waffentragberechtigt' in q);
  check('Das Dossier wird erst geholt, wenn jemand eine Person oeffnet', dossierRuf === 0);
}

await oeffnen();
check('Ein Klick auf Bearbeiten oeffnet die volle Flaeche, keine Schublade',
  await page.evaluate(() => document.getElementById('mv-bearbeiten').classList.contains('on')
    && !document.getElementById('drawer').classList.contains('on')));
check('Die Schublade fuer Mitarbeitende gibt es nicht mehr',
  !/function openMa\(/.test(HTML) && !/function saveMa\(\)/.test(HTML));
check('Die Brotkrume benennt den Reiter',
  (await page.textContent('#pgCrumb')).includes('bearbeiten'));
check('Das Dossier wurde genau einmal geholt', dossierRuf === 1);

// ══════════════ VOLLSTAENDIGKEIT
{
  const d = await page.evaluate(() => {
    const felder = mbAlleFelder();
    const fehlend = felder.filter(f => !document.getElementById('mb_' + f));
    return { anzahl: felder.length, fehlend, doppelt: felder.length !== new Set(felder).size,
      bloecke: [...document.querySelectorAll('#mbKarten .ma-block > h3')].map(h => h.textContent),
      spalten: document.querySelectorAll('#mbKarten > .ma-spalte').length };
  });
  check(`Alle ${d.anzahl} Felder stehen auch wirklich auf der Flaeche`, d.fehlend.length === 0);
  check('Kein Feld steht zweimal', !d.doppelt);
  check('Die Flaeche fuehrt mindestens 50 Felder', d.anzahl >= 50);
  check('KRITISCH: die Flaeche steht in drei Spalten, nicht als Kachelfeld (ENT-074)',
    d.spalten === 3);
  check('Person und Adresse sind ein Abschnitt, wie in der Referenz',
    d.bloecke.includes('Person und Adresse'));
  check('Herkunft, Ausweise und Nachweise sind ein Block "Personendaten und Bewilligungen"',
    d.bloecke.includes('Personendaten und Bewilligungen')
    && !d.bloecke.some(t => /^Herkunft/.test(t)) && !d.bloecke.some(t => /^Nachweise/.test(t)));
}

// ══════════════ WERTE KOMMEN AN
check('Ein Auswahlfeld zeigt den NAMEN, nicht die Id',
  await page.evaluate(() => document.getElementById('mb_funktion_id').selectedOptions[0].text === 'Objektleiter'));
check('Der Standort kommt aus den Anstellungsorten',
  await page.evaluate(() => document.getElementById('mb_anstellungsort_id').selectedOptions[0].text === 'Standort Testort'));
check('Ja/Nein steht als Haken, nicht als 1',
  await page.evaluate(() => document.getElementById('mb_diensthundefuehrer').checked === true
    && document.getElementById('mb_waffentragberechtigt').checked === false));
check('Die AHV-Nummer steht nur hier, nicht in der Liste',
  await page.inputValue('#mb_ahv_nr') === '756.1234.5678.97');

// ══════════════ GAV-HINWEISE SAGEN, SIE SETZEN NICHT
{
  const h = await page.textContent('#mbHinweise');
  check('Art. 10 Ziff. 4: mit Fachausweis ist die Basisausbildung nicht noetig',
    /Art\. 10 Ziff\. 4/.test(h) && /nicht absolvieren/.test(h));
  check('KRITISCH: das Ausbildungsdatum wird NICHT still gefuellt',
    (await page.inputValue('#mb_basisausbildung_am')) === '');
  check('Art. 19: der Zuschlag entsteht am Einsatz, nicht an der Person',
    /Art\. 19/.test(h) && /angeordnete/.test(h));
}

// ══════════════ AUSRICHTUNG: jedes "gueltig bis" neben SEINEM Ausweis
{
  const paare = await page.evaluate(() => {
    const kasten = id => { const e = document.getElementById(id);
      const r = e.closest('.f').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; };
    return {
      auf: [kasten('mb_aufenthaltsbewilligung'), kasten('mb_aufenthalt_gueltig_bis')],
      arb: [kasten('mb_arbeitsbewilligung'), kasten('mb_arbeit_gueltig_bis')],
      die: [kasten('mb_dienstausweis_nr'), kasten('mb_dienstausweis_gueltig_bis')],
      zemisY: kasten('mb_zemis_nr').y,
    };
  });
  const nebenan = ([a, b]) => a.y === b.y && b.x > a.x;
  check('KRITISCH: "gueltig bis" steht neben der Ausweiskategorie', nebenan(paare.auf));
  check('KRITISCH: "gueltig bis" steht neben der Arbeitsbewilligung', nebenan(paare.arb));
  check('KRITISCH: "gueltig bis" steht neben der Dienstausweis-Nummer', nebenan(paare.die));
  check('Die ZEMIS-Nummer draengt sich nicht zwischen ein Paar',
    paare.zemisY !== paare.die[0].y && paare.zemisY !== paare.arb[0].y);
}

// ══════════════ AUSRICHTUNG: umbrechende Etiketten verschieben kein Feld
{
  const n = await page.evaluate(() => {
    const y = id => Math.round(document.getElementById(id).getBoundingClientRect().y);
    return { a: y('mb_strafregister_datum'), b: y('mb_betreibung_datum') };
  });
  check('KRITISCH: zwei Datumsfelder fluchten, obwohl ein Etikett zweizeilig ist', n.a === n.b);
}

// ══════════════ LAYOUT: keine Loecher, kein Ueberlauf
{
  const l = await page.evaluate(() => {
    const sp = [...document.querySelectorAll('#mbKarten > .ma-spalte')];
    const bloecke = sp.map(c => [...c.querySelectorAll('.ma-block')]
      .map(b => ({ id: b.dataset.abschnitt, x: Math.round(b.getBoundingClientRect().x),
                   y: Math.round(b.getBoundingClientRect().y) })));
    // In einer Spalte muessen alle Bloecke denselben linken Rand haben und
    // streng untereinander stehen -- das ist die Ordnung, die vorher fehlte.
    const buendig = bloecke.every(b => new Set(b.map(x => x.x)).size === 1);
    const untereinander = bloecke.every(b => b.every((x, i) => i === 0 || x.y > b[i - 1].y));
    return { spalten: sp.length, buendig, untereinander,
      erste: bloecke.map(b => b[0] && b[0].id),
      ueberbreit: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  check('Auf 1600 px stehen drei Spalten nebeneinander', l.spalten === 3);
  check('KRITISCH: in jeder Spalte fluchten alle Abschnitte am linken Rand', l.buendig);
  check('KRITISCH: die Abschnitte stehen streng untereinander, nicht versetzt', l.untereinander);
  check('Person und Adresse steht oben links -- der wichtigste Abschnitt zuerst',
    l.erste[0] === 'person');
  check('Nichts laeuft seitlich ueber', !l.ueberbreit);
}

// ══════════════ SPEICHERN
{
  await page.fill('#mb_nachname', 'Neuername');
  await page.uncheck('#mb_diensthundefuehrer');
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  check('Gespeichert wird gegen den Login-Namen', gesendet && gesendet.name === 'mitarbeiter-a');
  check('Der geaenderte Wert geht mit', gesendet && gesendet.nachname === 'Neuername');
  check('Ein abgehakter Haken geht als leer, nicht als "0"-Text verloren',
    gesendet && gesendet.diensthundefuehrer === '');
  check('Ein gesetzter Haken geht als 1', gesendet && gesendet.waffentragberechtigt === '');
  check('KRITISCH: es gehen alle Felder mit, damit der Server nichts raten muss',
    gesendet && Object.keys(gesendet).length >= 50);
  check('Nach dem Speichern steht wieder die Detailseite offen',
    await page.evaluate(() => document.getElementById('mv-detail').classList.contains('on')));
}

// ══════════════ FEHLER BLEIBT STEHEN
{
  speichernOk = false;
  await oeffnen();
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  const e = await page.evaluate(() => {
    const b = document.getElementById('mbErr');
    return { sichtbar: getComputedStyle(b).display !== 'none', text: b.textContent };
  });
  check('KRITISCH: eine abgelehnte Pruefziffer erscheint als stehendes Band, nicht als Toast',
    e.sichtbar && /Pruefziffer/.test(e.text));
  check('Die Flaeche bleibt offen, damit man das Feld suchen kann',
    await page.evaluate(() => document.getElementById('mv-bearbeiten').classList.contains('on')));
  check('Der Speichern-Knopf ist wieder bedienbar',
    await page.evaluate(() => !document.getElementById('mbSpeichern').disabled));
  speichernOk = true;
}

// ══════════════ LEERE LISTE IST NICHT "KEINE AUSWAHL"
{
  listenLeer = true;
  await page.evaluate(() => loadMitarbeiter());
  await page.waitForTimeout(200);
  await oeffnen();
  const t = await page.evaluate(() => document.getElementById('mb_funktion_id').options[0].text);
  check('KRITISCH: "noch keine erfasst" sieht nicht aus wie "keine ausgewaehlt"',
    /noch keine erfasst/.test(t));
  listenLeer = false;
  await page.evaluate(() => loadMitarbeiter());
  await page.waitForTimeout(200);
}

// ══════════════ NICHT EINGERICHTET IST NICHT "LEER ERFASST"
{
  eingerichtet = false;
  await oeffnen();
  const h = await page.textContent('#mbHinweise');
  check('KRITISCH: fehlende Spalten werden benannt statt als leere Felder gezeigt',
    /noch nicht angelegt/.test(h) && /Einrichtung/.test(h));
  eingerichtet = true;
  await oeffnen();
  check('Ist eingerichtet, verschwindet der Hinweis wieder',
    !/noch nicht angelegt/.test(await page.textContent('#mbHinweise')));
}

// ══════════════ DIKTAT LANDET AUF DERSELBEN FLAECHE
{
  await page.evaluate(() => rtDialogOeffnen({ bereich: 'mitarbeiter', aktion: 'aendern',
    mitarbeiter_login_name: 'mitarbeiter-a', aenderungen: { mobil: '079 111 11 11', nachname: 'Diktiert' } }));
  await page.waitForTimeout(600);
  const d = await page.evaluate(() => ({
    offen: document.getElementById('mv-bearbeiten').classList.contains('on'),
    mobil: document.getElementById('mb_mobil').value,
    markiert: document.getElementById('mb_mobil').classList.contains('ki')
      && document.getElementById('mb_nachname').classList.contains('ki'),
    unmarkiert: document.getElementById('mb_vorname').classList.contains('ki'),
    band: document.getElementById('mbKi').textContent.replace(/\s+/g, ' '),
  }));
  check('Das Diktat oeffnet dieselbe Flaeche, nicht eine zweite', d.offen);
  check('Der diktierte Wert liegt vor', d.mobil === '079 111 11 11');
  check('Diktierte Felder sind markiert, andere nicht', d.markiert && !d.unmarkiert);
  check('KRITISCH: es steht dabei, dass noch nichts gespeichert ist',
    /noch nichts gespeichert/.test(d.band));
  check('Die markierten Felder werden benannt, nicht nur eingefaerbt',
    /Mobil privat/.test(d.band) && /Nachname/.test(d.band));
}

// ══════════════ PASSWORT UND ENTFERNEN SIND MITGEZOGEN
{
  await oeffnen();
  const z = await page.evaluate(() => {
    const block = document.querySelector('#mbKarten .ma-block[data-abschnitt=zugang]');
    return { pw: !!block.querySelector('#maPw'), weg: !!block.querySelector('.btn-danger'),
      sprache: !!block.querySelector('#mb_sprache') };
  });
  check('Passwort, Abmeldung und Sprache stehen in EINEM Abschnitt "Zugang"', z.pw && z.weg && z.sprache);
}

// ══════════════ SICH SELBST KANN MAN NICHT ENTFERNEN
{
  DOSSIER.name = 'adrian';
  await page.evaluate(() => mbOeffnen('adrian'));
  await page.waitForTimeout(400);
  check('KRITISCH: der eigene Zugang traegt keinen Entfernen-Knopf',
    await page.evaluate(() => document.querySelectorAll('#mbKarten .btn-danger').length === 0));
  DOSSIER.name = 'mitarbeiter-a';
}

// ══════════════ LESEANSICHT DER AKTE
{
  // Seit ENT-073 ist die vollstaendige Leseansicht der Reiter
  // "Personaldossier"; die Uebersicht zeigt nur noch wenige Container.
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('mitarbeiter-a'); });
  await page.waitForTimeout(700);
  await page.click('#mdtab-dossier');
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => {
    const zeile = t => { const dt = [...document.querySelectorAll('#mdDossier dt')].find(x => x.textContent === t);
      return dt ? dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : null; };
    return {
      karten: [...document.querySelectorAll('#mdDossier .ma-block > h3')].map(h => h.textContent),
      geburt: zeile('Geburtsdatum'), ahv: zeile('AHV-Nummer'),
      strasse: zeile('Strasse'), ort: zeile('PLZ und Ort'),
      funktion: zeile('Funktion'), standort: zeile('Standort'),
      fa: zeile('Eidg. Fachausweis'), berechtigt: zeile('Berechtigt für'),
      ausweis: zeile('Ausweiskategorie'), dienst: zeile('Dienstausweis'),
      leerzeilen: [...document.querySelectorAll('#mdDossier dd')].filter(x => x.textContent.trim() === '–').length,
      abgelaufen: [...document.querySelectorAll('#mdDossier .chip-x')].map(c => c.textContent),
      bald: [...document.querySelectorAll('#mdDossier .chip-w')].map(c => c.textContent),
      spalten: document.querySelectorAll('#mdDossier > .ma-spalten > .ma-spalte').length,
    };
  });
  check('KRITISCH: die Detailseite zeigt das Geburtsdatum, statt "–" wie vor ENT-072',
    d.geburt === '05.05.1990');
  check('KRITISCH: die AHV-Nummer steht auf der Detailseite, nicht nur im Formular',
    d.ahv === '756.1234.5678.97');
  check('Eine Adresse liest sich als Adresse, nicht als fuenf Zeilen',
    d.strasse === 'Musterweg 3' && d.ort === '4600 Testort');
  check('Auswahlfelder zeigen den Namen, nicht die Id',
    d.funktion === 'Objektleiter' && d.standort === 'Standort Testort');
  check('Ausweis und Gueltigkeit stehen in EINER Zeile',
    /C · gültig bis 01\.01\.2020/.test(d.ausweis) && d.dienst.includes(`DA-9 · gültig bis ${dmy(DIENSTAUSWEIS_GUELTIG_BIS)}`));
  check('KRITISCH: ein abgelaufener Ausweis wird als abgelaufen benannt',
    d.abgelaufen.length === 1 && /abgelaufen/.test(d.abgelaufen[0]));
  check('Ein bald ablaufender Ausweis wird vorgewarnt',
    d.bald.length === 1 && /läuft bald ab/.test(d.bald[0]));
  check('Berechtigungen stehen als Marken, nicht als "…eingesetzt werden: ja"',
    d.berechtigt === 'Diensthund');
  check('KRITISCH: leere Felder stehen gar nicht da statt als Reihe von Strichen',
    d.leerzeilen === 0);
  check('Die Leseansicht folgt denselben Abschnitten wie die Bearbeitung',
    d.karten.length >= 6 && d.karten[0] === 'Person und Adresse');
  check('Auch die Leseansicht steht in drei Spalten', d.spalten === 3);
}

// ══════════════ LISTE AUF DEN NEUEN FELDERN
{
  await page.evaluate(() => maGoTab('liste'));
  await page.waitForTimeout(300);
  const z = await page.evaluate(() => ({
    kopf: [...document.querySelectorAll('#maTable thead th')].map(t => t.textContent),
    zellen: [...document.querySelectorAll('#maTable tbody tr td')].map(t => t.textContent.trim()),
    marken: [...document.querySelectorAll('#maTable tbody .chip')].map(c => c.textContent),
  }));
  check('Die Liste zeigt die Funktion im Klartext', z.zellen.includes('Objektleiter'));
  check('KRITISCH: Anschrift traegt die Hausnummer, seit sie ein eigenes Feld ist',
    z.zellen.includes('Musterweg 3'));
  check('KRITISCH: die Ortsspalte traegt die PLZ, seit sie ein eigenes Feld ist',
    z.zellen.includes('4600 Testort'));
  check('Wer Hund oder Waffe fuehren darf, sieht man beim Planen in der Liste',
    z.marken.some(t => /Bewachung/.test(t)) && z.marken.includes('Diensthund'));
  check('Die Liste hat eine Spalte fuer die Berechtigungen', z.kopf.includes('Berechtigt'));
}

// ══════════════ SUCHE
{
  await page.fill('#mQ', 'objektleiter');
  await page.waitForTimeout(200);
  check('Die Suche findet ueber die Funktion', (await page.$$('#maTable tbody tr')).length === 1);
  await page.fill('#mQ', '4600');
  await page.waitForTimeout(200);
  check('Die Suche findet ueber die PLZ', (await page.$$('#maTable tbody tr')).length === 1);
  await page.fill('#mQ', '');
  await page.waitForTimeout(200);
}

// ══════════════ ANLEGEN AUF DERSELBEN FLAECHE
{
  await page.evaluate(() => { go('mitarbeiter'); maGoTab('liste'); });
  await page.waitForTimeout(200);
  gesendet = null;
  await page.click('button:has-text("Neuer Mitarbeitender")');
  await page.waitForSelector('#mv-bearbeiten.on');
  await page.waitForTimeout(500);

  const a = await page.evaluate(() => ({
    flaeche: document.getElementById('mv-bearbeiten').classList.contains('on'),
    titel: document.getElementById('mbName').textContent,
    knopf: document.getElementById('mbSpeichern').textContent,
    crumb: document.getElementById('pgCrumb').textContent,
    karten: document.querySelectorAll('#mbKarten .ma-block').length,
    felder: document.querySelectorAll('#mbKarten .inp').length,
    leer: [...document.querySelectorAll('#mbKarten .inp')].every(e => e.value === ''),
    band: !!document.getElementById('mbNeuName') && !!document.getElementById('mbNeuPass'),
    bandOben: document.getElementById('mbNeuKonto').getBoundingClientRect().y
            < document.querySelector('#mbKarten .ma-block').getBoundingClientRect().y,
    bandBreit: Math.round(document.getElementById('mbNeuKonto').querySelector('.card').getBoundingClientRect().width)
             > Math.round(document.querySelector('#mbKarten .ma-block').getBoundingClientRect().width) * 2,
    fokus: document.activeElement.id,
    pw: !!document.getElementById('maPw'),
    weg: document.querySelectorAll('#mbKarten .btn-danger').length,
    hinweise: document.getElementById('mbHinweise').textContent.trim(),
    // Ueberschrift des Bands muss dieselbe Form haben wie die der Karten.
    gleicheUeberschrift: (() => {
      const b = getComputedStyle(document.querySelector('#mbNeuKonto h3'));
      const k = getComputedStyle(document.querySelector('#mbKarten .ma-block > h3'));
      return b.fontSize === k.fontSize && b.textTransform === k.textTransform
          && b.fontWeight === k.fontWeight && b.color === k.color;
    })(),
  }));
  check('KRITISCH: "Neuer Mitarbeitender" oeffnet dieselbe volle Flaeche', a.flaeche);
  check('Den kurzen Anlege-Dialog gibt es nicht mehr',
    !/id="dlgMaNeu"/.test(HTML) && !/function openMaNeu/.test(HTML));
  check('Der Kopf sagt, dass eine Person angelegt wird', a.titel === 'Neuer Mitarbeitender');
  check('Der Knopf sagt "anlegen", nicht "speichern"', /anlegen/.test(a.knopf));
  check('Die Brotkrume sagt es auch', a.crumb === 'Neuer Mitarbeitender');
  check('KRITISCH: es sind dieselben Abschnitte und Felder wie beim Bearbeiten',
    a.karten === 8 && a.felder >= 49);
  check('Beim Anlegen ist nichts vorbelegt', a.leer);
  check('Login-Name und Passwort stehen als Pflichtfelder da', a.band);
  check('Sie stehen OBEN, nicht in einer Karte zwischen neun anderen', a.bandOben);
  check('Und ueber die ganze Breite, damit man sie nicht uebersieht', a.bandBreit);
  check('Der Schreibfokus liegt im ersten Pflichtfeld', a.fokus === 'mbNeuName');
  check('Kein Passwort-Zuruecksetzen bei jemandem, den es noch nicht gibt', !a.pw);
  check('Kein Entfernen-Knopf bei jemandem, den es noch nicht gibt', a.weg === 0);
  check('KRITISCH: kein Befund "Basisausbildung offen" auf einem leeren Formular',
    !/Basisausbildung offen/.test(a.hinweise));
  check('Das Pflichtband traegt dieselbe Ueberschriftform wie die Abschnitte', a.gleicheUeberschrift);

  // Der Login-Name wird vorgeschlagen -- und hoert damit auf, sobald jemand
  // selbst tippt. Ein Feld, das sich unter der Hand aendert, ist schlimmer
  // als gar kein Vorschlag.
  await page.fill('#mb_vorname', 'Hans');
  await page.fill('#mb_nachname', 'Meier');
  await page.waitForTimeout(150);
  check('Der Login-Name wird aus Vor- und Nachname vorgeschlagen',
    (await page.inputValue('#mbNeuName')) === 'hans.meier');
  await page.fill('#mbNeuName', 'h.meier');
  await page.fill('#mb_nachname', 'Mueller');
  await page.waitForTimeout(150);
  check('KRITISCH: ein selbst gesetzter Login-Name wird nicht mehr ueberschrieben',
    (await page.inputValue('#mbNeuName')) === 'h.meier');

  // Pflichtangaben
  await page.fill('#mbNeuName', '');
  await page.click('#mbSpeichern');
  await page.waitForTimeout(300);
  check('KRITISCH: ohne Login-Name wird nichts angelegt',
    gesendet === null && /Login-Name erforderlich/.test(await page.textContent('#mbErr')));
  await page.fill('#mbNeuName', 'hans.mueller');
  await page.fill('#mbNeuPass', 'kurz');
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  // Defensiv gelesen: Faellt die Pruefung weg, legt der Klick tatsaechlich an
  // und die Flaeche ist weg. Diese Pruefung muss dann ROT werden und nicht
  // mit einem Fehler abbrechen -- ein abstuerzender Test sagt nichts.
  const kurz = await page.evaluate(() => ({
    err: (document.getElementById('mbErr') || {}).textContent || '',
    offen: document.getElementById('mv-bearbeiten').classList.contains('on'),
  }));
  check('KRITISCH: ein zu kurzes Passwort legt nichts an',
    gesendet === null && /mindestens 12 Zeichen/.test(kurz.err) && kurz.offen);

  // Anlegen
  if (kurz.offen) {
    await page.fill('#mbNeuPass', 'blauerstuhlamsee');
    // Seit ENT-077 Rollen statt Admin-Haekchen.
    await page.check('#mbNeuRolle_verwaltung');
    await page.fill('#mb_ahv_nr', '756.1234.5678.97');
    await page.selectOption('#mb_fachausweis', 'Bewachung');
    await page.click('#mbSpeichern');
    await page.waitForTimeout(800);
  }
  check('Angelegt wird ueber mitarbeiter_create, nicht ueber _update',
    gesendet && gesendet.password === 'blauerstuhlamsee');
  check('Die gewählte Rolle geht mit (ENT-077)',
    gesendet && Array.isArray(gesendet.rollen) && gesendet.rollen.includes('verwaltung'));
  check('KRITISCH: die neuen Felder gehen beim ANLEGEN genauso mit wie beim Aendern',
    gesendet && gesendet.ahv_nr === '756.1234.5678.97' && gesendet.fachausweis === 'Bewachung'
    && Object.keys(gesendet).length >= 50);
  check('Nach dem Anlegen steht die neue Person offen, nicht die leere Liste',
    await page.evaluate(() => document.getElementById('mv-detail').classList.contains('on')));
}

// ══════════════ ANLEGEN: ABBRECHEN UND FEHLER
{
  await page.evaluate(() => { go('mitarbeiter'); maGoTab('liste'); mbNeu(); });
  await page.waitForTimeout(500);
  await page.click('#mv-bearbeiten .btn-plain');
  await page.waitForTimeout(300);
  check('Abbrechen beim Anlegen fuehrt in die Liste, nicht auf eine leere Detailseite',
    await page.evaluate(() => document.getElementById('mv-liste').classList.contains('on')));

  speichernOk = false;
  gesendet = null;
  await page.evaluate(() => mbNeu());
  await page.waitForTimeout(500);
  await page.fill('#mbNeuName', 'schon.da');
  await page.fill('#mbNeuPass', 'blauerstuhlamsee');
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  check('KRITISCH: ein vergebener Login-Name erscheint als stehendes Band',
    /bereits vergeben/.test(await page.textContent('#mbErr')));
  check('Die Eingaben bleiben stehen, statt verloren zu gehen',
    (await page.inputValue('#mbNeuName')) === 'schon.da'
    && await page.evaluate(() => document.getElementById('mv-bearbeiten').classList.contains('on')));
  speichernOk = true;
  await page.evaluate(() => mbAbbrechen());
  await page.waitForTimeout(200);
}

// ══════════════ ANLEGEN AUS DEM DIKTAT
{
  gesendet = null;
  await page.evaluate(() => rtDialogOeffnen({ bereich: 'mitarbeiter', aktion: 'neu',
    felder: { vorname: 'Erika', nachname: 'Muster', ort: '3000 Bern', mobil: '079 000 00 00' } }));
  await page.waitForTimeout(700);
  const d = await page.evaluate(() => ({
    offen: document.getElementById('mv-bearbeiten').classList.contains('on'),
    name: document.getElementById('mbNeuName').value,
    pass: document.getElementById('mbNeuPass').value,
    plz: document.getElementById('mb_plz').value,
    ort: document.getElementById('mb_ort').value,
    markiert: document.getElementById('mb_vorname').classList.contains('ki'),
    band: document.getElementById('mbKi').textContent.replace(/\s+/g, ' '),
  }));
  check('Das Diktat legt auf derselben Flaeche an', d.offen);
  check('Der Login-Name ist aus dem Diktat vorgeschlagen', d.name === 'erika.muster');
  check('KRITISCH: das Passwort wird NIE vorbelegt', d.pass === '');
  check('KRITISCH: "3000 Bern" wird auch beim Anlegen getrennt',
    d.plz === '3000' && d.ort === 'Bern');
  check('Diktierte Felder sind markiert', d.markiert);
  check('Der Hinweis sagt, dass das Passwort selbst zu setzen ist',
    /Passwort musst du selbst setzen/.test(d.band));
  check('KRITISCH: das Diktat allein legt nichts an', gesendet === null);
  await page.evaluate(() => mbAbbrechen());
  await page.waitForTimeout(200);
}

// ══════════════ NULLDATUM IST KEIN DATUM
// Ein leeres Datumsfeld ging bis ENT-072 als leerer TEXT an den Server;
// MySQL machte daraus '0000-00-00'. Die Leseansicht zeigte "00.00.0000" und
// stempelte nicht erfasste Bewilligungen als "abgelaufen". Der Unterschied
// entscheidet darueber, ob jemand eingeteilt werden darf.
{
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('mitarbeiter-a'); });
  await page.waitForTimeout(700);
  await page.click('#mdtab-dossier');
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => ({
    text: document.getElementById('mdDossier').textContent,
    abgelaufen: [...document.querySelectorAll('#mdDossier .chip-x')].length,
    zeilen: [...document.querySelectorAll('#mdDossier dt')].map(d => d.textContent),
  }));
  check('KRITISCH: kein "00.00.0000" in der Leseansicht', !/00\.00\.0000/.test(n.text));
  check('KRITISCH: ein Nulldatum steht gar nicht da, statt als leeres Feld',
    !n.zeilen.includes('Heiratsdatum') && !n.zeilen.includes('Austritt'));
  check('KRITISCH: eine nicht erfasste Bewilligung ist nicht "abgelaufen"',
    n.abgelaufen === 1);   // nur der echte, wirklich abgelaufene Aufenthaltsausweis

  await page.evaluate(() => mbOeffnen('mitarbeiter-a'));
  await page.waitForTimeout(600);
  check('KRITISCH: ein Nulldatum steht nicht im Eingabefeld',
    (await page.inputValue('#mb_heiratsdatum')) === ''
    && (await page.inputValue('#mb_austritt')) === '');
  gesendet = null;
  await page.click('#mbSpeichern');
  await page.waitForTimeout(400);
  check('KRITISCH: es wird auch kein Nulldatum zurueckgeschrieben',
    gesendet && gesendet.heiratsdatum === '' && gesendet.austritt === '');
  await page.waitForTimeout(300);
}

check('Kein JavaScript-Fehler auf dem ganzen Weg', jsFehler.length === 0);

console.log(`\n✓ ${ok.length} bestanden`);
if (bad.length) { console.log(`\n✗ ${bad.length} FEHLGESCHLAGEN:`); bad.forEach(b => console.log('  -', b)); }
if (jsFehler.length) { console.log('JS:', jsFehler); }
await browser.close();
process.exit(bad.length ? 1 : 0);
