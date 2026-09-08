<?php
// Lohnlauf, Bruttoseite (ENT-451, Etappe 3).
//
// GET                     -> Liste der Laeufe
// GET ?lauf=<id>          -> ein gespeicherter Lauf mit Personen und Zeilen
// GET ?von=&bis=          -> VORSCHAU: rechnet, speichert nichts
// POST {aktion:'erzeugen', von, bis}      -> Lauf als Entwurf anlegen
// POST {aktion:'freigeben', lauf}         -> festschreiben
// POST {aktion:'ausbezahlt', lauf}        -> Auszahlung vermerken
// POST {aktion:'stornieren', lauf, grund} -> stornieren (nur vor der Auszahlung)
//
// DER SERVER RECHNET SELBST. Aus der Anfrage kommen ausschliesslich
// Zeitraum und Aktion -- keine Stunden, keine Betraege, keine Saetze. Ein
// Lohnlauf ist ein Dokument mit Rechtswirkung; seine Zahlen duerfen keine
// Behauptung des Browsers sein.
//
// EIN FREIGEGEBENER LAUF WIRD NIE NEU GERECHNET. Die Vorschau rechnet, der
// gespeicherte Lauf wird gelesen. Waeren beide derselbe Weg, veraenderte
// eine spaetere Ansatz- oder Regelaenderung rueckwirkend abgeschlossene
// Monate -- genau das schliessen Art. 12 Ziff. 5 und CLAUDE.md Teil B aus.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';
require_once __DIR__ . '/../lohn.php';
require_once __DIR__ . '/../gavzeit.php';
require_once __DIR__ . '/../lohnlauf.php';

$user = require_session();
require_recht($user, 'lohn_lesen');
$pdo = db();

function lauf_datum(?string $d): ?string
{
    return $d && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : null;
}

// Alle aktiven Personen, die im Zeitraum ueberhaupt in Frage kommen.
// Ausgetretene bleiben dabei, solange ihr Austritt im Zeitraum oder danach
// liegt -- der letzte Lohn faellt sonst unter den Tisch.
function lauf_personen(PDO $pdo, string $von, string $bis): array
{
    $st = $pdo->prepare(
        'SELECT id, vorname, nachname, name, personalnummer, anstellungskategorie,
                pensum_stunden, eintritt, austritt, geburtsdatum
         FROM mitarbeiter
         WHERE (aktiv = 1 OR austritt IS NULL OR austritt >= ?)
           AND (eintritt IS NULL OR eintritt <= ?)
         ORDER BY nachname, vorname, name'
    );
    $st->execute([$von, $bis]);
    return $st->fetchAll();
}

// Vorschau: rechnet den Zeitraum durch, ohne etwas zu speichern.
function lauf_vorschau(PDO $pdo, string $von, string $bis): array
{
    $ergebnis = [];
    foreach (lauf_personen($pdo, $von, $bis) as $ma) {
        $p = lohnlauf_person($pdo, $ma, $von, $bis);
        // Personen ohne jede Zeit und ohne Sperrgrund gehoeren nicht in
        // den Lauf -- eine Zeile mit lauter Nullen sieht aus wie ein
        // Ergebnis und ist keines.
        if ($p['roh_min'] === 0 && !$p['gesperrt_grund'] && !$p['gesperrt']
            && $p['nicht_abgeglichen'] === 0) { continue; }
        $p['name'] = trim(($ma['vorname'] ?? '') . ' ' . ($ma['nachname'] ?? '')) ?: $ma['name'];
        $p['personalnummer'] = $ma['personalnummer'];

        // Die Abzugsseite. Sie entsteht NUR, wenn die Bruttoseite ueberhaupt
        // gerechnet wurde -- Abzuege auf einen nicht gerechneten Lohn waeren
        // Zahlen ohne Grundlage.
        if (!$p['gesperrt_grund']) {
            $p['nbu'] = lohnlauf_nbu($pdo, (int)$ma['id'], $bis);
            $ab = lohnlauf_abzuege($pdo, $p, $bis, $p['nbu']);
            $p['zeilen'] = array_merge($p['zeilen'], $ab['zeilen']);
            $p['netto_rappen']      = $ab['netto_rappen'];
            $p['auszahlung_rappen'] = $ab['auszahlung_rappen'];
            $p['abzug_sperren']     = $ab['sperren'];
            $p['grundlagen']        = $ab['grundlagen'];
            $p['vollstaendig']      = $ab['vollstaendig'];
        } else {
            $p['nbu'] = null;
            $p['netto_rappen'] = null; $p['auszahlung_rappen'] = null;
            $p['abzug_sperren'] = []; $p['vollstaendig'] = false;
        }
        $ergebnis[] = $p;
    }
    return $ergebnis;
}

function lauf_lesen(PDO $pdo, int $id): array
{
    $st = $pdo->prepare('SELECT * FROM lohnlauf WHERE id = ?');
    $st->execute([$id]);
    $lauf = $st->fetch();
    if (!$lauf) { return ['status' => 'error', 'message' => 'Lauf nicht gefunden']; }

    $pst = $pdo->prepare(
        'SELECT lp.*, m.vorname, m.nachname, m.name, m.personalnummer
         FROM lohnlauf_person lp JOIN mitarbeiter m ON m.id = lp.mitarbeiter_id
         WHERE lp.lauf_id = ? ORDER BY m.nachname, m.vorname'
    );
    $pst->execute([$id]);
    $zst = $pdo->prepare('SELECT * FROM lohnlauf_zeile WHERE lauf_id = ? ORDER BY mitarbeiter_id, sortierung');
    $zst->execute([$id]);
    $zeilen = [];
    foreach ($zst->fetchAll() as $z) { $zeilen[(int)$z['mitarbeiter_id']][] = $z; }

    $personen = [];
    foreach ($pst->fetchAll() as $p) {
        $p['name'] = trim(($p['vorname'] ?? '') . ' ' . ($p['nachname'] ?? '')) ?: $p['name'];
        $p['zeilen'] = $zeilen[(int)$p['mitarbeiter_id']] ?? [];
        $p['gesperrt'] = $p['gesperrt_zaehler'] ? json_decode($p['gesperrt_zaehler'], true) : [];
        $p['warnung'] = $p['warnung'] ? json_decode($p['warnung'], true) : null;
        $personen[] = $p;
    }
    return ['status' => 'ok', 'lauf' => $lauf, 'personen' => $personen,
            'sperrgruende' => lohnlauf_sperrgruende()];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $laufId = (int)($_GET['lauf'] ?? 0);
    if ($laufId > 0) { json_response(lauf_lesen($pdo, $laufId)); }

    $von = lauf_datum($_GET['von'] ?? null);
    $bis = lauf_datum($_GET['bis'] ?? null);
    if ($von && $bis) {
        if ($bis < $von) { json_response(['status' => 'error', 'message' => 'Ende liegt vor dem Beginn'], 400); }
        // Gibt es fuer diesen Zeitraum schon einen Lauf? Das muss die
        // Oberflaeche wissen, bevor jemand einen zweiten anlegt.
        $vorh = $pdo->prepare(
            "SELECT id, status FROM lohnlauf
             WHERE periode_von = ? AND periode_bis = ? AND status <> 'storniert'"
        );
        $vorh->execute([$von, $bis]);
        json_response(['status' => 'ok', 'vorschau' => lauf_vorschau($pdo, $von, $bis),
            'von' => $von, 'bis' => $bis, 'bestehend' => $vorh->fetchAll(),
            'sperrgruende' => lohnlauf_sperrgruende()]);
    }

    $liste = $pdo->query(
        'SELECT l.*, (SELECT COUNT(*) FROM lohnlauf_person p WHERE p.lauf_id = l.id) AS personen,
                (SELECT COALESCE(SUM(p.brutto_rappen),0) FROM lohnlauf_person p WHERE p.lauf_id = l.id) AS brutto_rappen
         FROM lohnlauf l ORDER BY l.periode_von DESC, l.id DESC'
    )->fetchAll();
    json_response(['status' => 'ok', 'laeufe' => $liste]);
}

require_recht($user, 'lohn_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}
$input = json_decode(file_get_contents('php://input'), true) ?? [];
$aktion = (string)($input['aktion'] ?? '');

// ── Erzeugen ─────────────────────────────────────────────────────────────
if ($aktion === 'erzeugen') {
    $von = lauf_datum($input['von'] ?? null);
    $bis = lauf_datum($input['bis'] ?? null);
    if (!$von || !$bis) { json_response(['status' => 'error', 'message' => 'Zeitraum fehlt'], 400); }
    if ($bis < $von) { json_response(['status' => 'error', 'message' => 'Ende liegt vor dem Beginn'], 400); }

    // Ein zweiter Lauf fuer denselben Zeitraum waere zwei Wahrheiten ueber
    // denselben Monat. Ein stornierter zaehlt nicht -- der ist bewusst
    // ersetzt worden.
    $vorh = $pdo->prepare(
        "SELECT id FROM lohnlauf WHERE periode_von = ? AND periode_bis = ? AND status <> 'storniert'"
    );
    $vorh->execute([$von, $bis]);
    if ($vorh->fetchColumn()) {
        json_response(['status' => 'error',
            'message' => 'Für diesen Zeitraum besteht bereits ein Lauf. '
                       . 'Er muss storniert werden, bevor ein neuer entsteht.'], 400);
    }

    // Welchen Lauf dieser ersetzt, ermittelt der SERVER -- nicht der Browser.
    // Gibt es fuer denselben Zeitraum einen stornierten Lauf, ist der neue
    // dessen Nachfolger. Ohne die Verkettung waere spaeter nicht mehr zu
    // sehen, dass der eine aus dem anderen entstanden ist; mit einem Wert
    // aus der Anfrage stuende dort, was jemand behauptet.
    $vorgaenger = $pdo->prepare(
        "SELECT id FROM lohnlauf
         WHERE periode_von = ? AND periode_bis = ? AND status = 'storniert'
         ORDER BY id DESC LIMIT 1"
    );
    $vorgaenger->execute([$von, $bis]);
    $ersetzt = (int)($vorgaenger->fetchColumn() ?: 0);
    $pdo->beginTransaction();
    try {
        $ein = $pdo->prepare(
            'INSERT INTO lohnlauf (periode_von, periode_bis, status, erstellt_von, ersetzt_lauf_id, bemerkung)
             VALUES (?,?,?,?,?,?)'
        );
        $ein->execute([$von, $bis, 'entwurf', (int)$user['id'], $ersetzt ?: null,
            trim((string)($input['bemerkung'] ?? '')) ?: null]);
        $laufId = (int)$pdo->lastInsertId();

        $pIn = $pdo->prepare(
            'INSERT INTO lohnlauf_person
               (lauf_id, mitarbeiter_id, kategorie, lohnform, roh_min, netto_min, bonus_min,
                bewertet_min, brutto_rappen, gesperrt_grund, gesperrt_zaehler,
                nicht_abgeglichen, warnung, netto_rappen, auszahlung_rappen,
                nbu_stand, nbu_herleitung)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        $zIn = $pdo->prepare(
            'INSERT INTO lohnlauf_zeile
               (lauf_id, mitarbeiter_id, schluessel, bezeichnung, sortierung,
                basis_rappen, satz_bp, menge, betrag_rappen, gesperrt_grund, annahme, hinweis)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        foreach (lauf_vorschau($pdo, $von, $bis) as $p) {
            $pIn->execute([$laufId, $p['mitarbeiter_id'], $p['kategorie'], $p['lohnform'],
                $p['roh_min'], $p['netto_min'], $p['bonus_min'], $p['bewertet_min'],
                $p['brutto_rappen'], $p['gesperrt_grund'],
                $p['gesperrt'] ? json_encode($p['gesperrt']) : null,
                $p['nicht_abgeglichen'],
                isset($p['warnung']) ? json_encode($p['warnung']) : null,
                // SCHNAPPSCHUSS, nicht Verweis: Die Herleitung der
                // NBU-Unterstellung wird mitgespeichert -- Beobachtungs-
                // zeitraum, gezaehlte Wochen, Durchschnitt und, falls von
                // Hand gesetzt, Grund und Person. Wer in zwei Jahren fragt,
                // warum abgezogen wurde, findet die Antwort in der
                // Abrechnung und nicht in neu gerechneten Zahlen.
                $p['netto_rappen'], $p['auszahlung_rappen'],
                $p['nbu']['stand'] ?? null,
                isset($p['nbu']) ? json_encode($p['nbu']) : null]);
            foreach ($p['zeilen'] as $z) {
                $zIn->execute([$laufId, $p['mitarbeiter_id'], $z['schluessel'], $z['bezeichnung'],
                    $z['sortierung'], $z['basis_rappen'], $z['satz_bp'], $z['menge'],
                    $z['betrag_rappen'], $z['gesperrt_grund'] ?? null,
                    $z['annahme'] ?? 0, $z['hinweis'] ?? null]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_response(['status' => 'error', 'message' => 'Lauf konnte nicht angelegt werden: '
            . $e->getMessage()], 500);
    }
    json_response(lauf_lesen($pdo, $laufId));
}

$laufId = (int)($input['lauf'] ?? 0);
if ($laufId <= 0) { json_response(['status' => 'error', 'message' => 'lauf fehlt'], 400); }
$st = $pdo->prepare('SELECT * FROM lohnlauf WHERE id = ?');
$st->execute([$laufId]);
$lauf = $st->fetch();
if (!$lauf) { json_response(['status' => 'error', 'message' => 'Lauf nicht gefunden'], 404); }

// ── Freigeben ────────────────────────────────────────────────────────────
if ($aktion === 'freigeben') {
    if ($lauf['status'] !== 'entwurf') {
        json_response(['status' => 'error',
            'message' => 'Nur ein Entwurf lässt sich freigeben.'], 400);
    }
    $pdo->prepare('UPDATE lohnlauf SET status = ?, freigegeben_am = NOW(), freigegeben_von = ? WHERE id = ?')
        ->execute(['freigegeben', (int)$user['id'], $laufId]);
    json_response(lauf_lesen($pdo, $laufId));
}

// ── Auszahlung vermerken ─────────────────────────────────────────────────
// Ab hier ist der Lauf endgueltig: Danach wird nicht mehr storniert,
// sondern im naechsten Lauf nachgetragen (ENT-451).
if ($aktion === 'ausbezahlt') {
    if ($lauf['status'] !== 'freigegeben') {
        json_response(['status' => 'error',
            'message' => 'Nur ein freigegebener Lauf lässt sich als ausbezahlt vermerken.'], 400);
    }
    $pdo->prepare('UPDATE lohnlauf SET status = ?, ausbezahlt_am = NOW(), ausbezahlt_von = ? WHERE id = ?')
        ->execute(['ausbezahlt', (int)$user['id'], $laufId]);
    json_response(lauf_lesen($pdo, $laufId));
}

// ── Stornieren ───────────────────────────────────────────────────────────
if ($aktion === 'stornieren') {
    // Die Grenze ist die AUSZAHLUNG, nicht die Freigabe (ENT-451). Ein
    // bereits ueberwiesener Betrag laesst sich nicht wegstornieren -- die
    // Korrektur gehoert dann in den naechsten Lauf.
    if ($lauf['status'] === 'ausbezahlt') {
        json_response(['status' => 'error',
            'message' => 'Dieser Lauf ist bereits ausbezahlt. Eine Korrektur gehört als Zeile '
                       . 'in den nächsten Lauf, mit Verweis auf diese Periode — '
                       . 'die ausbezahlte Abrechnung bleibt unverändert.'], 400);
    }
    if ($lauf['status'] === 'storniert') {
        json_response(['status' => 'error', 'message' => 'Der Lauf ist bereits storniert.'], 400);
    }
    $grund = trim((string)($input['grund'] ?? ''));
    if ($grund === '') {
        json_response(['status' => 'error',
            'message' => 'Grund erforderlich — warum wird dieser Lauf storniert?'], 400);
    }
    // Der stornierte Lauf bleibt vollstaendig stehen, mitsamt Personen und
    // Zeilen. Nur so laesst sich spaeter nachvollziehen, was ersetzt wurde.
    $pdo->prepare(
        'UPDATE lohnlauf SET status = ?, storniert_am = NOW(), storniert_von = ?, storno_grund = ?
         WHERE id = ?'
    )->execute(['storniert', (int)$user['id'], $grund, $laufId]);
    json_response(lauf_lesen($pdo, $laufId));
}

json_response(['status' => 'error',
    'message' => 'aktion: erzeugen, freigeben, ausbezahlt oder stornieren'], 400);
