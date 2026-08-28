// backend/api/produkt_speichern.php WIRKLICH ausfuehren (ENT-217), gegen eine
// In-Memory-SQLite-Datenbank -- nicht nur die Serverantwort vortaeuschen wie
// test_offerten.mjs. Anlass: "Neues Produkt" scheiterte auf der echten
// Datenbank mit SQLSTATE HY093 "Invalid parameter number" -- sieben "?"-
// Platzhalter fuer sechs gebundene Werte beim Anlegen (aktiv stand als
// Literal dahinter, zaehlte aber versehentlich als eigener Platzhalter mit).
// Kein gemockter Test bekommt diese eine SQL-Zeile je zu Gesicht; diese Suite
// schon.
import { HIER } from './pfade.mjs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

function aufruf(koerper) {
  try {
    const aus = execFileSync('php', [`${HIER}/pruef_produkt_speichern.php`],
      { input: JSON.stringify(koerper), encoding: 'utf8' });
    return { code: 0, antwort: JSON.parse(aus) };
  } catch (e) {
    return { code: e.status || 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

// ── KRITISCH: genau der Fall, der auf der Live-Datenbank scheiterte ────────
const neu = aufruf({ name: 'Objektschutz', beschreibung: 'Naechtliche Kontrolle',
  einzelpreis_rappen: 5500, einheit: 'Std.', mwst_satz_bp: 810, sortierung: 20 });
check('KRITISCH: die Anfrage laeuft ohne PHP-Fehler durch',
  neu.code === 0 && neu.antwort && !neu.stderr);
check('KRITISCH: ein neues Produkt wird wirklich angelegt (status ok, echte neue Id)',
  neu.antwort && neu.antwort.status === 'ok' && Number(neu.antwort.id) > 1);

// ── Bestehendes Produkt aendern (id > 0) -- lief schon vorher korrekt,
// darf es durch die Korrektur nicht verlieren.
const geaendert = aufruf({ id: 1, name: 'Bestehend geaendert', beschreibung: 'neu',
  einzelpreis_rappen: 2000, einheit: 'Tag', mwst_satz_bp: 0, sortierung: 5 });
check('KRITISCH: ein bestehendes Produkt laesst sich weiterhin aendern',
  geaendert.code === 0 && geaendert.antwort
  && geaendert.antwort.status === 'ok' && Number(geaendert.antwort.id) === 1);

// ── Ohne Namen wird abgewiesen, nicht stillschweigend mit leerem Namen
// angelegt.
const ohneName = aufruf({ beschreibung: 'x' });
check('KRITISCH: ohne Namen wird nichts angelegt, sondern klar abgewiesen',
  ohneName.antwort && ohneName.antwort.status === 'error'
  && /Name ist erforderlich/.test(ohneName.antwort.message));

// ── Ein nicht existierendes Produkt aendern wird klar gemeldet, nicht
// stillschweigend ignoriert.
const nichtDa = aufruf({ id: 999, name: 'Geist' });
check('KRITISCH: das Aendern eines nicht vorhandenen Produkts meldet "nicht gefunden"',
  nichtDa.antwort && nichtDa.antwort.status === 'error'
  && /nicht gefunden/i.test(nichtDa.antwort.message));

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
