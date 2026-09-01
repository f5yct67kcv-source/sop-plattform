<?php
// Teilt Leute auf eine Schicht eines Objekts an einem Tag ein (ENT-024).
//
// Der Unterschied zu einsatz_save.php: Der Einsatz muss noch nicht existieren.
// Gibt es ihn zu dieser Masterschicht an diesem Tag noch nicht, wird er aus
// der Vorlage erzeugt -- Zeiten, Bedarf und Status kommen aus der Vorlage,
// nicht aus dem Browser. So laesst sich direkt in der Monatsuebersicht planen,
// ohne vorher "Schichten erzeugen" zu druecken.
//
// Die Doppelbelegungssperre aus ENT-022 gilt hier unveraendert.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'plan');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$objektId = (int)($in['objekt_id'] ?? 0);
$msId     = (int)($in['masterschicht_id'] ?? 0);
$datum    = trim((string)($in['datum'] ?? ''));

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
    json_response(['status' => 'error', 'message' => 'Datum im Format JJJJ-MM-TT erforderlich'], 400);
}

$o = db()->prepare('SELECT * FROM objekte WHERE id = ?');
$o->execute([$objektId]);
$objekt = $o->fetch();
if (!$objekt) {
    json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
}

$m = db()->prepare('SELECT * FROM masterschichten WHERE id = ? AND objekt_id = ?');
$m->execute([$msId, $objektId]);
$vorlage = $m->fetch();
if (!$vorlage) {
    json_response(['status' => 'error', 'message' => 'Schichtvorlage nicht gefunden'], 404);
}
// Eine Vorlage gilt nur in ihrem Zeitraum. Ausserhalb wird nichts angelegt --
// sonst entstuenden Einsaetze, die die Vorschau nie vorschlagen wuerde.
if ((string)$vorlage['gueltig_ab'] > $datum
    || ($vorlage['gueltig_bis'] !== null && (string)$vorlage['gueltig_bis'] < $datum)) {
    json_response([
        'status' => 'error',
        'message' => 'Diese Schichtvorlage gilt an diesem Tag nicht',
    ], 400);
}

// Nur aktive Mitarbeitende lassen sich zuteilen.
$gewuenscht = array_values(array_unique(array_map('intval', (array)($in['mitarbeiter'] ?? []))));
$zuteilung = [];
if ($gewuenscht) {
    $marken = implode(',', array_fill(0, count($gewuenscht), '?'));
    $st = db()->prepare("SELECT id FROM mitarbeiter WHERE aktiv = 1 AND id IN ($marken)");
    $st->execute($gewuenscht);
    $zuteilung = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

// Gibt es den Einsatz schon?
$vh = db()->prepare('SELECT * FROM einsaetze WHERE objekt_id = ? AND masterschicht_id = ? AND datum = ?');
$vh->execute([$objektId, $msId, $datum]);
$einsatz = $vh->fetch();
$id = $einsatz ? (int)$einsatz['id'] : 0;

// Eine abgeglichene Schicht ist festgeschrieben -- auch die Zuteilung wird
// nicht mehr veraendert (ENT-045). Sonst verloere der Ist-Stand seinen Bezug.
einsatz_sperre_pruefen(db(), $id);

$von = substr((string)$vorlage['von'], 0, 5);
$bis = substr((string)$vorlage['bis'], 0, 5);
if ($einsatz) {
    // Bei einem bestehenden Einsatz gelten dessen Zeiten -- er kann von Hand
    // verschoben worden sein. Die Vorlage ueberschreibt das nicht.
    $von = substr((string)$einsatz['von'], 0, 5);
    $bis = substr((string)$einsatz['bis'], 0, 5);
}

// Umplanung (ENT-060) -- dieselbe Regel wie in einsatz_save.php.
$umplanen = array_values(array_unique(array_map('intval', (array)($in['umplanen'] ?? []))));
// Warnung, keine Sperre (ENT-284) -- der Planer bestaetigt einmal, dann
// gilt das fuer diese Anfrage.
$trotzFehlenderBerechtigung = !empty($in['trotz_fehlender_berechtigung']);

if ($zuteilung) {
    $einsatzartFuerPruefung = $einsatz ? (string)$einsatz['einsatzart'] : (string)$objekt['einsatzart'];
    if (!$trotzFehlenderBerechtigung) {
        $unberechtigt = ohneRevierdienstBerechtigung($einsatzartFuerPruefung, $zuteilung);
        if ($unberechtigt) {
            json_response([
                'status' => 'error',
                'unberechtigt' => true,
                'message' => 'Ohne Revierdienst-Berechtigung: '
                    . implode(', ', array_column($unberechtigt, 'name')),
                'personen' => $unberechtigt,
            ], 409);
        }
    }
    $doppelt = doppelbelegungen($id, $datum, $von, $bis, $zuteilung);
    if ($doppelt && $umplanen) {
        $pdoU = db();
        $pdoU->beginTransaction();
        try {
            $blockiert = umplanen($pdoU, $doppelt, $umplanen);
            $pdoU->commit();
        } catch (Throwable $e) {
            $pdoU->rollBack();
            throw $e;
        }
        if ($blockiert) {
            $namen = [];
            foreach ($blockiert as $d) {
                $namen[$d['name']] = $d['name'] . ': ' . $d['was'] . ' ist bereits abgeglichen';
            }
            json_response([
                'status' => 'error',
                'gesperrt' => true,
                'message' => 'Umplanen nicht moeglich — ' . implode(' — ', $namen)
                    . '. Dort steht bereits geleistete Zeit; zuerst unter Abgleich die Sperre aufheben.',
                'doppelbelegung' => array_values($blockiert),
            ], 409);
        }
        $doppelt = doppelbelegungen($id, $datum, $von, $bis, $zuteilung);
    }
    if ($doppelt) {
        $namen = [];
        foreach ($doppelt as $d) {
            $namen[$d['name']] = $d['name'] . ' ist am ' . date('d.m.Y', strtotime($d['datum']))
                . ' bereits eingeteilt: ' . $d['was'];
        }
        json_response([
            'status' => 'error',
            'message' => 'Doppelbelegung: ' . implode(' — ', $namen),
            'doppelbelegung' => array_values($doppelt),
        ], 409);
    }
}

// Der Bedarf des Tages kommt aus derselben Regel wie die Vorschau -- nicht
// aus dem Browser und nicht aus einer zweiten Rechnung.
$bedarfTag = 0;
$b = planung_bedarf($objektId, $datum, $datum);
if (!isset($b['fehler'])) {
    foreach ($b['bedarf'] as $s) {
        if ($s['masterschicht_id'] === $msId) {
            $bedarfTag = (int)$s['bedarf'];
        }
    }
}

$pdo = db();
$pdo->beginTransaction();
try {
    if ($id > 0) {
        $pdo->prepare('DELETE FROM einsatz_zuteilung WHERE einsatz_id = ?')->execute([$id]);
    } else {
        if (!$zuteilung) {
            // Ohne Zuteilung und ohne bestehenden Einsatz gibt es nichts zu tun.
            // Ein leerer Einsatz waere nur Ballast -- der Bedarf steht bereits
            // in der Vorlage.
            $pdo->rollBack();
            json_response(['status' => 'ok', 'id' => null, 'zugeteilt' => 0, 'angelegt' => false]);
        }
        $titel = trim((string)($vorlage['kuerzel'] ? $vorlage['kuerzel'] . ' · ' : '') . $vorlage['name']);
        $st = $pdo->prepare(
            'INSERT INTO einsaetze (kunde_id, kunde_name, objekt_id, masterschicht_id, titel,
                                    strasse, ort, einsatzart, sparte, datum, von, bis, bedarf, status, erstellt_von)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $objekt['kunde_id'], $objekt['kunde_name'], $objektId, $msId, $titel,
            $objekt['strasse'], $objekt['ort'], $objekt['einsatzart'],
            // Vorlage schlaegt Objekt (ENT-037).
            sparte_pruefen($vorlage['sparte'] ?? null, sparte_pruefen($objekt['sparte'] ?? null)),
            $datum, $von, $bis,
            max($bedarfTag, count($zuteilung)),
            (int)$vorlage['auf_abruf'] ? 'provisorisch' : 'geplant',
            (int)$user['id'],
        ]);
        $id = (int)$pdo->lastInsertId();
    }

    if ($zuteilung) {
        $ins = $pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id) VALUES (?, ?)');
        foreach ($zuteilung as $mid) {
            $ins->execute([$id, $mid]);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response([
    'status' => 'ok',
    'id' => $id,
    'zugeteilt' => count($zuteilung),
    'angelegt' => !$einsatz,
    'bedarf' => $einsatz ? (int)$einsatz['bedarf'] : max($bedarfTag, count($zuteilung)),
]);
