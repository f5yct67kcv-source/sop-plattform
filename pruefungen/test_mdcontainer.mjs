// Personaldossier-Reiter und konfigurierbare Uebersicht (ENT-073).
//
// Worauf diese Pruefungen zielen:
//  1. Das Dossier zeigt IMMER alles. Ein ausgeblendetes Feld waere dort
//     nicht von einem leeren zu unterscheiden.
//  2. Die Uebersicht zeigt wenig -- aber nie zu wenig: Was jemanden von
//     einem Einsatz abhaelt, steht oben und nicht hinter einer Einstellung.
//  3. Die AHV-Nummer gehoert nicht auf die Ansicht, die im Vorbeigehen
//     offen steht.
//  4. Eine Anordnung, die sich nicht speichern liess, darf nicht so
//     aussehen, als waere sie gespeichert.
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

const MA = [{ id: 1, name: 'mitarbeiter-a', vorname: 'Vorname', nachname: 'Testperson',
  personalnummer: 'P-001', ist_admin: false, aktiv: 1, erstellt_am: '2025-03-04',
  strasse: 'Musterweg', hausnummer: '3', plz: '4600', ort: 'Testort',
  telefon: '062 000 00 00', mobil: '079 111 11 11', email: 'a@b.ch',
  funktion_id: 2, abteilung_id: 1, anstellungsort_id: 7,
  fachausweis: 'Bewachung', diensthundefuehrer: 1, waffentragberechtigt: 0 }];
const DOSSIER = { ...MA[0], geburtsdatum: '1990-05-05', land: 'CH', anrede: 'Herr',
  nationalitaet: 'CH', heimatort: 'Testgemeinde', zivilstand: 'ledig',
  ahv_nr: '756.1234.5678.97', kurzzeichen: 'VT', geschlecht: 'maennlich',
  anstellungskategorie: 'C', pensum_stunden: 900, eintritt: '2025-01-01',
  fachausweis_am: '2022-09-01', basisausbildung_am: '', sprache: 'de',
  aufenthaltsbewilligung: 'C', aufenthalt_gueltig_bis: '2020-01-01',
  dienstausweis_nr: 'DA-9', dienstausweis_gueltig_bis: bald(45),
  strafregister_datum: '2024-12-01', notfallkontakt: 'Testin Testin' };
const LISTEN = { funktion: [{ id: 1, bezeichnung: 'Sicherheitsmitarbeiter' },
  { id: 2, bezeichnung: 'Objektleiter' }], abteilung: [{ id: 1, bezeichnung: 'Bewachung' }] };

let gesendet = null, gespeichertesLayout = null, speichernOk = true, layoutRufe = 0, dossierKaputt = false;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(5000);
const jsFehler = [];
page.on('pageerror', e => jsFehler.push(e.message));

await page.route('**/api/**', r => {
  const u = r.request().url();
  const send = (x, st = 200) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(x) });
  if (u.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (u.includes('layout_get')) {
    layoutRufe++;
    return send({ status: 'ok', bereich: 'ma_detail', layout: gespeichertesLayout, eingerichtet: true });
  }
  if (u.includes('layout_save')) {
    gesendet = JSON.parse(r.request().postData() || '{}');
    if (!speichernOk) { return send({ status: 'error', message: 'Die Tabelle für die Anordnung fehlt noch.' }, 409); }
    gespeichertesLayout = gesendet.layout;
    return send({ status: 'ok' });
  }
  if (u.includes('mitarbeiter_dossier')) {
    return dossierKaputt
      ? send({ status: 'error', message: 'Mitarbeitende(r) nicht gefunden' }, 404)
      : send({ status: 'ok', mitarbeiter: DOSSIER, eingerichtet: true });
  }
  if (u.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA, listen: LISTEN, eingerichtet: true });
  if (u.includes('anstellungsorte')) return send({ status: 'ok', orte: [{ id: 7, bezeichnung: 'Standort Testort', rolle: 'hao', aktiv: 1 }] });
  return send({ status: 'ok', kpi: {}, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    mitarbeiter: [], kunden: [], einsaetze: [], objekte: [], rapporte: [], orte: [], feiertage: [], gepflegt: {} });
});
await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'a'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(400);

const oeffnen = async () => {
  await page.evaluate(() => { go('mitarbeiter'); openMaDetail('mitarbeiter-a'); });
  await page.waitForTimeout(900);
};
await oeffnen();

// ══════════════ DIE REITER (ENT-287)
{
  const t = await page.evaluate(() => [...document.querySelectorAll('#mdTabs .tab')].map(x => x.textContent));
  check('KRITISCH: die Sachbereiche stehen flach in der Reiterleiste, nicht unter einem Sammelreiter',
    t[0] === 'Übersicht' && ['Person', 'Anstellung', 'Einsatz', 'Zugang'].every(x => t.includes(x)));
  check('KRITISCH: der alte Sammelreiter "Personaldossier" ist wirklich weg, nicht nur versteckt',
    !t.includes('Personaldossier')
    && await page.evaluate(() => document.getElementById('mdtab-dossier') === null
      && document.getElementById('md-dossier') === null));
  // KEINE Pruefung auf den Kommentar im Quelltext: Eine Pruefung, die den
  // Quelltext abschreibt, prueft nichts -- sie friert ihn ein. Geprueft wird
  // stattdessen, dass jeder Bereich seine eigene Flaeche hat.
  check('Jeder Bereich hat eine eigene Flaeche, keine geteilte mit der Übersicht',
    await page.evaluate(() => {
      const ids = ['person', 'anstellung', 'einsatz', 'zugang'].map(b => document.getElementById('md-' + b));
      return ids.every(Boolean) && new Set(ids).size === 4
        && !ids.includes(document.getElementById('md-uebersicht'));
    }));
}

// ══════════════ UEBERSICHT: WENIG, ABER NICHT ZU WENIG
{
  const u = await page.evaluate(() => ({
    sichtbar: [...document.querySelectorAll('#mdFlow .dash-item:not(.versteckt)')].map(e => e.dataset.widget),
    person: [...document.querySelectorAll('#mdFlow [data-widget=person] dt')].map(d => d.textContent),
    ahv: document.querySelector('#mdFlow [data-widget=person]').textContent,
    status: document.querySelector('#mdFlow [data-widget=status]').textContent.replace(/\s+/g, ' '),
    karten: document.querySelectorAll('#mdFlow .dash-item:not(.versteckt) .card').length,
  }));
  check('KRITISCH: Personalien, Adresse und Kontakt sind EIN Container',
    u.sichtbar.includes('person')
    && u.person.includes('Vorname') && u.person.includes('PLZ und Ort') && u.person.includes('Mobil'));
  check('Personalien, Adresse und Kontakt stehen NICHT mehr als drei Kacheln da',
    !u.sichtbar.includes('kontakt') && !u.sichtbar.includes('adresse'));
  check('KRITISCH: die AHV-Nummer steht nicht auf der Schulterblick-Ansicht',
    !u.ahv.includes('756.1234.5678.97'));
  check('Auch Kurzzeichen und Geschlecht gehoeren nicht dorthin',
    !u.person.includes('Kurzzeichen') && !u.person.includes('Geschlecht'));
  check('Die Übersicht zeigt wenige Container, nicht alle zehn', u.karten <= 4);
  check('KRITISCH: ein abgelaufener Ausweis steht oben, nicht hinter einer Einstellung',
    u.sichtbar.includes('status') && /abgelaufen/.test(u.status));
  check('KRITISCH: dabei steht, WAS abgelaufen ist -- nicht nur "gültig bis"',
    /Ausweiskategorie/.test(u.status) && /Dienstausweis/.test(u.status));
}

// ══════════════ DIE VIER BEREICHE ZEIGEN ZUSAMMEN ALLES (ENT-287)
//
// Die teuerste Art, eine Akte aufzuteilen, ist die, bei der ein Abschnitt
// zwischen zwei Bereiche faellt: Er ist dann nirgends mehr zu sehen, und
// niemandem faellt auf, WELCHER fehlt. Darum wird hier nicht "es steht viel
// da" geprueft, sondern die Bilanz: jeder Abschnitt genau einmal.
{
  const je = {};
  for (const b of ['person', 'anstellung', 'einsatz', 'zugang']) {
    await page.click('#mdtab-' + b);
    await page.waitForTimeout(300);
    je[b] = await page.evaluate((id) => {
      const wurzel = document.getElementById('mdBereich_' + id);
      return {
        karten: [...wurzel.querySelectorAll('.ma-block > h3')].map(h => h.textContent),
        abschnitte: [...wurzel.querySelectorAll('.ma-block')].map(b => b.dataset.abschnitt),
        text: wurzel.textContent,
        werkzeuge: wurzel.querySelectorAll('.dash-werk').length,
        anpassen: getComputedStyle(document.getElementById('btnMdBearbeiten')).display,
        spalten: wurzel.querySelectorAll(':scope > .ma-spalten > .ma-spalte').length,
        buendig: [...wurzel.querySelectorAll(':scope > .ma-spalten > .ma-spalte')]
          .every(sp => new Set([...sp.querySelectorAll('.ma-block')]
            .map(x => Math.round(x.getBoundingClientRect().x))).size <= 1),
      };
    }, b);
  }
  const alle = Object.values(je).flatMap(x => x.abschnitte);
  // Nicht "es sind genug" -- das bliebe gruen, wenn ein Abschnitt still
  // verschwindet (genau das ist beim Bauen passiert, die erste Fassung
  // dieser Pruefung zaehlte nur >= 6 und merkte nichts). Geprueft wird die
  // Zuordnung selbst: JEDER Abschnitt gehoert zu einem der vier Bereiche.
  const zuordnung = await page.evaluate(() => ({
    bereiche: MB_BEREICHE.map(b => b[0]),
    ohneBereich: MB_ABSCHNITTE.filter(a => !MB_BEREICHE.some(b => b[0] === a.bereich)).map(a => a.id),
  }));
  check('KRITISCH: jeder Abschnitt der Akte ist einem der vier Bereiche zugeordnet -- keiner faellt zwischen zwei Reiter',
    zuordnung.ohneBereich.length === 0);
  if (zuordnung.ohneBereich.length) { bad.push('ohne Bereich: ' + zuordnung.ohneBereich.join(', ')); }
  check('Die vier Bereiche sind die erwarteten',
    JSON.stringify(zuordnung.bereiche) === JSON.stringify(['person', 'anstellung', 'einsatz', 'zugang']));
  check('Zusammen zeigen die Bereiche die erfassten Abschnitte', alle.length >= 6);
  check('KRITISCH: kein Abschnitt steht in zwei Bereichen gleichzeitig',
    new Set(alle).size === alle.length);
  check('KRITISCH: jeder Bereich steht in buendigen Spalten, nicht als Kachelfeld (ENT-074)',
    Object.values(je).every(x => x.spalten >= 1 && x.buendig));
  check('Person und Adresse steht oben links im Bereich "Person"',
    je.person.karten[0] === 'Person und Adresse');
  check('KRITISCH: die AHV-Nummer steht bei der Person -- dort gehoert sie hin, nicht auf der Übersicht',
    je.person.text.includes('756.1234.5678.97'));
  check('KRITISCH: was nichts mit Personalien zu tun hat, steht NICHT mehr bei der Person (ENT-287)',
    !/Rollen/.test(je.person.text) && !/Login-Name/.test(je.person.text)
    && !je.person.abschnitte.includes('einsatzbereich'));
  check('Zivilstand steht bei der Person, Kurzzeichen bei der Anstellung',
    /Zivilstand/.test(je.person.text) && /Kurzzeichen/.test(je.anstellung.text));
  check('Rollen und Sprache stehen im Bereich "Zugang"',
    /Rollen/.test(je.zugang.text) && /Sprache/.test(je.zugang.text));
  check('KRITISCH: in keinem Bereich laesst sich etwas ausblenden',
    Object.values(je).every(x => x.werkzeuge === 0));
  check('Der Anpassen-Knopf verschwindet auf allen vier Bereichen',
    Object.values(je).every(x => x.anpassen === 'none'));
}

// ══════════════ ANORDNEN
{
  await page.click('#mdtab-uebersicht');
  await page.waitForTimeout(400);
  await page.click('#btnMdBearbeiten');
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => ({
    leiste: getComputedStyle(document.getElementById('mdEditleiste')).display !== 'none',
    knopf: getComputedStyle(document.getElementById('btnMdBearbeiten')).display === 'none',
    alle: document.querySelectorAll('#mdFlow .dash-item').length,
    ids: [...document.querySelectorAll('#mdFlow .dash-item')].map(e => e.dataset.widget),
    werkzeuge: document.querySelectorAll('#mdFlow .dash-werk').length,
    griffe: document.querySelectorAll('#mdFlow .griff[draggable=true]').length,
    ausgeblendeteSichtbar: document.querySelectorAll('#mdFlow .dash-item.versteckt').length > 0
      && getComputedStyle(document.querySelector('#mdFlow .dash-item.versteckt')).display !== 'none',
  }));
  check('Der Bearbeitungsmodus zeigt seine Werkzeugleiste', b.leiste && b.knopf);
  check('KRITISCH: im Bearbeiten stehen ALLE Container da, auch die ausgeblendeten',
    b.alle === 9 && b.ausgeblendeteSichtbar);
  check('Jeder Container hat Griff, Pfeile und Auge', b.werkzeuge === 9 && b.griffe === 9);
  check('Die Container folgen den Abschnitten von ENT-074',
    b.ids.includes('personendaten') && b.ids.includes('dienstausweis') && !b.ids.includes('ausweise'));

  await page.click('#mdFlow [data-widget=personendaten] .dash-auge');
  await page.waitForTimeout(200);
  await page.evaluate(() => ordBewegen('betrieb', -1));
  await page.waitForTimeout(200);
  gesendet = null;
  await page.click('#mdEditleiste .btn-primary');
  await page.waitForTimeout(600);

  check('Gespeichert wird gegen den richtigen Bereich', gesendet && gesendet.bereich === 'ma_detail');
  check('Die Person steht NICHT im Aufruf -- die Anordnung gilt fuer den Bereich',
    gesendet && !JSON.stringify(gesendet).includes('mitarbeiter-a'));
  check('Ein eingeblendeter Container wird als sichtbar gespeichert',
    gesendet && gesendet.layout.find(x => x.id === 'personendaten').sichtbar === true);
  check('Die neue Reihenfolge wird gespeichert',
    gesendet && gesendet.layout.findIndex(x => x.id === 'betrieb')
              < gesendet.layout.findIndex(x => x.id === 'status'));
  const n = await page.evaluate(() => ({
    sichtbar: [...document.querySelectorAll('#mdFlow .dash-item:not(.versteckt)')].map(e => e.dataset.widget),
    leiste: getComputedStyle(document.getElementById('mdEditleiste')).display === 'none',
    reihenfolge: [...document.querySelectorAll('#mdFlow .dash-item')]
      .map(e => [e.dataset.widget, Number(e.style.order)])
      .sort((a, b2) => a[1] - b2[1]).map(x => x[0]),
  }));
  check('Nach dem Speichern ist der Container tatsaechlich da', n.sichtbar.includes('personendaten'));
  check('Die Werkzeugleiste ist wieder weg', n.leiste);
  check('Die Reihenfolge steht auch auf dem Bildschirm so',
    n.reihenfolge.indexOf('betrieb') < n.reihenfolge.indexOf('status'));
}

// ══════════════ DIE ANORDNUNG UEBERLEBT DEN WECHSEL DER PERSON
{
  const vorher = layoutRufe;
  await page.evaluate(() => maGoTab('liste'));
  await page.waitForTimeout(200);
  await oeffnen();
  const s = await page.evaluate(() =>
    [...document.querySelectorAll('#mdFlow .dash-item:not(.versteckt)')].map(e => e.dataset.widget));
  check('Die Anordnung gilt weiter, wenn man eine Person neu oeffnet', s.includes('personendaten'));
  check('Sie wird dafuer nicht jedes Mal neu geholt', layoutRufe === vorher);
}

// ══════════════ WAS SICH NICHT SPEICHERN LIESS, DARF NICHT GESPEICHERT AUSSEHEN
{
  speichernOk = false;
  await page.click('#btnMdBearbeiten');
  await page.waitForTimeout(400);
  await page.click('#mdFlow [data-widget=dienstausweis] .dash-auge');
  await page.waitForTimeout(200);
  await page.click('#mdEditleiste .btn-primary');
  await page.waitForTimeout(600);
  const f = await page.evaluate(() => ({
    leiste: getComputedStyle(document.getElementById('mdEditleiste')).display !== 'none',
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }));
  check('KRITISCH: schlaegt das Speichern fehl, bleibt der Bearbeitungsmodus offen', f.leiste);
  check('Und es wird gesagt, warum', /Tabelle/.test(f.toast) || /nicht speichern/.test(f.toast));
  check('KRITISCH: die Anordnung wird dann auch nicht uebernommen',
    await page.evaluate(() => !ordStand('ma_detail').find(x => x.id === 'dienstausweis').sichtbar));
  speichernOk = true;
  // Defensiv: Faellt die Pruefung oben weg, ist der Bearbeitungsmodus zu und
  // der Abbrechen-Knopf nicht da. Diese Pruefungen muessen dann ROT werden
  // und nicht mit einer Zeitueberschreitung abbrechen.
  await page.evaluate(() => { if (ordAktiv) { ordBearbeitenAbbrechen(); } });
  await page.waitForTimeout(300);
}

// ══════════════ EIN REITERWECHSEL BEENDET DAS ANPASSEN
{
  await page.click('#btnMdBearbeiten');
  await page.waitForTimeout(300);
  await page.click('#mdtab-person');
  await page.waitForTimeout(400);
  check('KRITISCH: der Reiterwechsel beendet den Bearbeitungsmodus',
    await page.evaluate(() => ordAktiv === null
      && getComputedStyle(document.getElementById('mdEditleiste')).display === 'none'));
  await page.click('#mdtab-uebersicht');
  await page.waitForTimeout(400);
}

// ══════════════ DIE UEBERSICHT DES DASHBOARDS LEBT WEITER
{
  await page.evaluate(() => go('uebersicht'));
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => ({
    knopf: !!document.getElementById('btnDashBearbeiten'),
    items: document.querySelectorAll('#dashFlow .dash-item').length,
    werkzeuge: document.querySelectorAll('#dashFlow .dash-werk').length,
    registriert: DASH_WIDGETS.length,
  }));
  check('Die Uebersicht hat weiterhin ihren Bearbeiten-Knopf', d.knopf);
  // Nicht gegen eine feste Zahl: Die Aussage ist "JEDER Container bekommt
  // seine Werkzeugleiste nachgeruestet", nicht "es sind genau sieben". Eine
  // feste Zahl wird beim naechsten neuen Container rot, ohne dass etwas
  // kaputt ist -- und wer das ein paarmal erlebt, glaubt dem Rot nicht mehr.
  check('KRITISCH: ihre Container haben die Werkzeugleiste, obwohl sie nicht mehr im HTML steht',
    d.items === d.registriert && d.werkzeuge === d.items && d.items > 0);
}

// ══════════════ EIN FEHLGESCHLAGENER ABRUF WIRD BENANNT
// Der Fehlerfall schrieb in ein Element, das es nach dem Umbau nicht mehr
// gab -- und ging damit selbst als JavaScript-Fehler hoch, statt die
// Meldung zu zeigen.
{
  dossierKaputt = true;
  await page.evaluate(() => { go('mitarbeiter'); maGoTab('liste'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => openMaDetail('mitarbeiter-a'));
  await page.waitForTimeout(700);
  const f = await page.evaluate(() => ({
    meldung: (document.querySelector('#mdHinweis .msg-err') || {}).textContent || '',
    flowLeer: document.getElementById('mdFlow').innerHTML.trim() === '',
  }));
  check('KRITISCH: ein fehlgeschlagener Abruf wird als Meldung gezeigt',
    /nicht gefunden/.test(f.meldung));
  check('Und die Container der vorigen Person bleiben nicht stehen', f.flowLeer);
  dossierKaputt = false;
}

check('Kein JavaScript-Fehler auf dem ganzen Weg', jsFehler.length === 0);

console.log(`\n✓ ${ok.length} bestanden`);
if (bad.length) { console.log(`\n✗ ${bad.length} FEHLGESCHLAGEN:`); bad.forEach(b => console.log('  -', b)); }
if (jsFehler.length) { console.log('JS:', jsFehler); }
await browser.close();
process.exit(bad.length ? 1 : 0);
