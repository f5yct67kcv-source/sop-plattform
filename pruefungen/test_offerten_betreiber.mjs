// Offerten im Betreiber-Bereich (ENT-605).
//
// Zwei Sorten Aussage stehen hier:
//
//   1. Was gerechnet und wohin geschrieben wird -- das laeuft wirklich, in
//      pruef_offerten_betreiber.php. Eine Textsuche kann nicht sagen, ob ein
//      Tabellenpraefix an jeder einzelnen Abfrage ankommt.
//   2. Dass die beiden Ebenen einander nicht anfassen. Der Offertenteil ist
//      aus dem Cockpit UEBERNOMMEN -- und genau daran haengt die Gefahr:
//      Ein stehengebliebener Aufruf auf beleg_list.php statt
//      betreiber_beleg_list.php faellt niemandem auf, solange
//      betreiber_db() ohnehin auf dieselbe Datenbank zeigt (OP-518). Die
//      Offerten der Betreiberin stuenden dann in der Liste ihrer Mandantin.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { WURZEL } from './pfade.mjs';

const HIER = new URL('.', import.meta.url).pathname;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg: Ein Wort in einer Begruendung ist kein Aufruf.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, '');

// ── 1. Der Rechenkern und die Trennung, wirklich ausgefuehrt ──────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_offerten_betreiber.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('die PHP-Pruefungen der Belegtrennung laufen durch', phpAnzahl > 0);
// phpAnzahl gehoert MIT in die kritische Bedingung: Stirbt die Datei vor
// ihrer Zusammenfassung, ist der Ende-Code 0 und kein "x " im Auswurf --
// die Pruefung waere gruen, obwohl nichts gelaufen ist (so geschehen bei
// ENT-539).
check('KRITISCH: alle PHP-Faelle bestehen (Trennung, Nummern, Tabellensatz-Wache)',
  phpCode === 0 && phpAnzahl > 0 && !phpAus.includes('\nx '));
phpAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

// ── 2. Kein Betreiber-Endpunkt fasst die Tabellen der Mandantin an ────
const API = join(WURZEL, 'backend/api');
const betreiberEndpunkte = readdirSync(API).filter(f => /^betreiber_.*\.php$/.test(f));
check('es gibt ueberhaupt Betreiber-Endpunkte fuer Offerten',
  betreiberEndpunkte.filter(f => /^betreiber_(beleg|kunden|produkt)_/.test(f)).length >= 10);

// Die Mandantentabellen beim Namen. Die be_-Fassungen sind ausdruecklich
// erlaubt, darum die Wortgrenze davor: "be_belege" darf, "belege" nicht.
const MANDANTENTABELLEN =
  /(?:FROM|INTO|UPDATE|JOIN)\s+(?<!be_)(belege|beleg_positionen|kunden|kunden_person|kunden_kontaktweg|produkte|betrieb)\b/;
const greiftDaneben = betreiberEndpunkte.filter(f => {
  const q = nurCode(lies(`backend/api/${f}`));
  return [...q.matchAll(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)]
    .some(m => ['belege', 'beleg_positionen', 'kunden', 'kunden_person',
                'kunden_kontaktweg', 'produkte', 'betrieb'].includes(m[1]));
});
check('KRITISCH: kein Betreiber-Endpunkt liest oder schreibt eine Tabelle der Mandantin',
  greiftDaneben.length === 0);
if (greiftDaneben.length) { bad.push('greift in Mandantentabellen: ' + greiftDaneben.join(', ')); }

// Und die Kehrseite: Sie muessen die be_-Tabellen tatsaechlich benutzen --
// sonst bestuende die Pruefung oben auch fuer eine leere Datei.
const nutztBeTabellen = betreiberEndpunkte.filter(f =>
  /^betreiber_(beleg|kunden|produkt)_/.test(f)
  && /\bbe_(belege|beleg_positionen|kunden|produkte)\b/.test(nurCode(lies(`backend/api/${f}`))));
check('die Offerten-Endpunkte sprechen die be_-Tabellen wirklich an',
  nutztBeTabellen.length >= 8);

// Jeder von ihnen holt seine Verbindung ueber betreiber_db(), nicht ueber
// db(). Das ist die Stelle, an der die Trennung spaeter tatsaechlich
// greift: Zieht die Betreiber-Ebene auf eine eigene Datenbank, ist es ein
// Deploy-Wert -- aber nur fuer den, der betreiber_db() ruft.
const falscheVerbindung = betreiberEndpunkte
  .filter(f => /^betreiber_(beleg|kunden|produkt|briefkopf|einrichtung)/.test(f))
  .filter(f => {
    const q = nurCode(lies(`backend/api/${f}`));
    return !q.includes('betreiber_db()') || /=\s*db\(\)/.test(q);
  });
check('KRITISCH: jeder Offerten-Endpunkt arbeitet auf betreiber_db()',
  falscheVerbindung.length === 0);
if (falscheVerbindung.length) { bad.push('falsche Verbindung: ' + falscheVerbindung.join(', ')); }

// Der Absender einer Offerte der Betreiberin kommt aus ihrem eigenen
// Briefkopf. `betrieb` gehoert einer Mandantin -- ihr Name haette auf einer
// Offerte der Betreiberin nichts verloren.
const versand = nurCode(lies('backend/api/betreiber_beleg_versenden.php'));
check('KRITISCH: der Versand nimmt den Absender aus be_briefkopf, nicht aus betrieb',
  versand.includes('be_briefkopf') && !/FROM\s+betrieb\b/.test(versand));
// Ohne Firma wird nicht verschickt: Eine Offerte ohne Absender ist keine.
check('ohne Firma im Briefkopf wird nicht verschickt',
  /\$firma\s*===\s*''/.test(versand) && /json_response/.test(versand));
// Der Link kommt aus dem Deploy, nie aus der Anfrage (ENT-501).
check('KRITISCH: der Versandlink kommt aus basis_url(), nicht aus dem Host-Kopf',
  versand.includes('basis_url()') && !versand.includes('HTTP_HOST'));

// ── 3. Die Oberflaeche ruft nur ihre eigenen Endpunkte ────────────────
//
// DER Kopierfehler, auf den diese Suite vor allem achtet.
const seite = lies('betreiber.html');
const aufrufe = [...new Set([...nurCode(seite).matchAll(/ruf\(\s*'([a-z_0-9]+\.php)/g)]
  .map(m => m[1]))];
check('es wurden ueberhaupt Endpunktaufrufe gefunden', aufrufe.length >= 15);
const fremdeAufrufe = aufrufe.filter(a => !a.startsWith('betreiber_') && !a.startsWith('demo_'));
check('KRITISCH: der Betreiber-Bereich ruft ausschliesslich betreiber_*-Endpunkte',
  fremdeAufrufe.length === 0);
if (fremdeAufrufe.length) { bad.push('fremder Aufruf: ' + fremdeAufrufe.join(', ')); }

// Die Gegenprobe dazu, als eigene Aussage: Die uebernommenen Namen aus dem
// Cockpit duerfen nirgends stehengeblieben sein.
const COCKPIT_NAMEN = ['beleg_list.php', 'beleg_lesen.php', 'beleg_speichern.php',
  'beleg_versenden.php', 'beleg_status.php', 'beleg_archivieren.php',
  'beleg_duplizieren.php', 'kunden_list.php', 'kunden_create.php',
  'kunden_update.php', 'produkt_list.php', 'produkt_speichern.php'];
const stehengeblieben = COCKPIT_NAMEN.filter(n =>
  new RegExp(`(?<!betreiber_)${n.replace('.', '\\.')}`).test(nurCode(seite)));
check('KRITISCH: kein Endpunktname aus dem Cockpit ist stehengeblieben',
  stehengeblieben.length === 0);
if (stehengeblieben.length) { bad.push('stehengeblieben: ' + stehengeblieben.join(', ')); }

// ── 4. Was die Seite nachlaedt, liegt auch im Buendel ─────────────────
//
// Aus der Seite abgeleitet, nicht hier aufgezaehlt: Ein spaeter
// hinzukommendes Skript faellt sonst durch. Fehlt es im Buendel, bleibt der
// Knopf ohne Wirkung -- und lokal faellt das NICHT auf.
const werk = lies('.github/workflows/deploy-hostpoint.yml');
const buendel = (werk.match(/Betreiber-Buendel[\s\S]*?(?=\n      - name:)/) || [''])[0];
check('der Buendel-Abschnitt wurde gefunden', buendel.length > 400);
const nachgeladen = [...new Set([...nurCode(seite).matchAll(/\.src\s*=\s*'([a-z0-9_.-]+\.js)'/g)]
  .map(m => m[1]))];
check('die Seite laedt ueberhaupt etwas nach', nachgeladen.length >= 1);
const fehlend = nachgeladen.filter(d => !buendel.includes(d));
check('KRITISCH: jede Datei, die betreiber.html nachlaedt, liegt im betreiber-Buendel',
  fehlend.length === 0);
if (fehlend.length) { bad.push('fehlt im Buendel: ' + fehlend.join(', ')); }

// ── 5. Rechnungen bleiben ein Geruest, und zwar sichtbar ──────────────
//
// Die Freigabe traegt den definierten Umfang. Offerten sind gebaut, die
// wiederkehrende Rechnung nicht -- sie braucht die Antwort auf "wonach wird
// abgerechnet" (OP-536). Steht das nicht mehr da, behauptet die Oberflaeche
// eine Funktion, die es nicht gibt.
check('KRITISCH: der Rechnungsbereich sagt weiterhin, dass er nicht gebaut ist',
  /geruestZeigen\('re-inhalt', 'Noch nicht gebaut'/.test(seite));
check('und nennt den Grund, nicht nur den Zustand',
  /wonach abgerechnet wird/.test(seite));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
