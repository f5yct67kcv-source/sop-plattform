<?php
// Ein Ereignis im Feed der Uebersicht als erledigt markieren (ENT-090).
//
// Loest sperr_erledigt.php ab und kann alle abhakbaren Arten. Zwei Endpunkte
// fuer dieselbe Sache waeren zwei Stellen, an denen die Rechtepruefung
// auseinanderlaufen kann -- genau das Muster, das ENT-077 fuer darf()
// abgeschafft hat.
//
// Geloescht wird nichts. Der Rapport, die Sperre, die Zusage bleiben
// unveraendert gueltig; nur der Zeitstempel "gesehen" kommt dazu.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../ereignisse.php';

$user = require_session();
require_recht($user, 'plan');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in  = json_decode(file_get_contents('php://input'), true) ?? [];
$typ = trim((string)($in['typ'] ?? ''));
$id  = (int)($in['id'] ?? 0);

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}
// Der offene Abgleich steht bewusst nicht in der Liste: Er verschwindet,
// wenn abgeglichen wurde, und nur dann. Ihn abhaken zu koennen hiesse, dass
// er aus dem Feed faellt, obwohl die Arbeit noch aussteht.
if (!ereignis_abhakbar($typ)) {
    json_response(['status' => 'error',
        'message' => 'Diese Art laesst sich nicht abhaken: ' . ($typ === '' ? '(leer)' : $typ)], 400);
}

$art = EREIGNIS_ARTEN[$typ];
$pdo = db();

// Die Zuteilung hat keinen eigenen Schluessel -- sie haengt an Einsatz UND
// Person. Ohne beides wuerde ein Abhaken die Rueckmeldungen aller
// Zugeteilten dieser Schicht auf einmal wegwischen.
if ($typ === 'zusage') {
    $maId = (int)($in['mitarbeiter_id'] ?? 0);
    if ($maId <= 0) {
        json_response(['status' => 'error', 'message' => 'mitarbeiter_id erforderlich'], 400);
    }
    $s = $pdo->prepare("UPDATE einsatz_zuteilung SET zusage_gesehen_am = NOW()
                         WHERE einsatz_id = ? AND mitarbeiter_id = ? AND zusage_gesehen_am IS NULL");
    $s->execute([$id, $maId]);
} else {
    $s = $pdo->prepare("UPDATE {$art['tabelle']} SET {$art['spalte']} = NOW()
                         WHERE id = ? AND {$art['spalte']} IS NULL");
    $s->execute([$id]);
}

json_response(['status' => 'ok', 'typ' => $typ, 'id' => $id, 'geaendert' => $s->rowCount()]);
