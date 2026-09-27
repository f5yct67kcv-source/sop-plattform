// Service Worker der Mitarbeiter-App.
//
// Zwei Aufgaben, mehr nicht:
//  1. Installierbarkeit. Android/Chrome erkennt eine Seite nur dann als
//     installierbar, wenn ein Service Worker registriert ist. Kein
//     Offline-Zwischenspeicher: Das Werkzeug braucht ohnehin eine
//     Verbindung zum Server, ein Zwischenspeicher riskierte nur veraltete
//     Daten.
//  2. Push-Benachrichtigungen (ENT-424).
//
// BEWUSST KEIN fetch-Handler. Frueher stand hier ein leerer
// (addEventListener('fetch', () => {})), weil Chrome ihn einmal fuer die
// Installierbarkeit verlangte. Das tut es seit Version 108 (Android) bzw.
// 112 (Desktop) nicht mehr. Ein leerer Handler tut nichts, kostet aber:
// Jede Anfrage der App laeuft erst durch den Service Worker, der dafuer
// geweckt werden muss -- auch jeder API-Abruf.

// ── Push ───────────────────────────────────────────────────────────────
// Es kommt KEINE Nutzlast an (so entschieden, siehe backend/push.php):
// Auf dem Sperrbildschirm steht ein Hinweis, der Inhalt erst in der App.
// Damit laeuft kein Mitteilungstext ueber die Server von Apple und Google.
//
// Der Text steht darum HIER und nicht im Push -- und er verspricht nichts,
// was er nicht weiss: "Neue Mitteilung", nicht "Wichtige Mitteilung".
// Ohne Nutzlast kann dieser Code die Stufe nicht kennen, und eine geratene
// Dringlichkeit waere eine Falschauskunft.
//
// PUSH_TITEL und das Icon tragen die MARKE, nicht die Mandantin (ENT-603):
// Diese Datei geht unveraendert in die geteilten Buendel (Rapport-Adresse,
// Demo) -- dort waere "CUPI 24" der Name einer fremden Firma. Nur das
// cupi24-Buendel bekommt beides im Deploy-Workflow auf CUPI 24 umgehaengt,
// zusammen mit den Icon-Dateien (icons/guardops-* -> icons/cupi24-*,
// dieselbe Ersetzung wie beim Favicon, ENT-589).
const PUSH_TITEL = 'GuardOpS';
const PUSH_TEXT  = 'Neue Mitteilung — zum Lesen öffnen';

self.addEventListener('push', event => {
  // showNotification MUSS aufgerufen werden. Ein Push ohne sichtbare
  // Benachrichtigung gilt bei Chrome als Missbrauch und fuehrt nach
  // mehreren Malen dazu, dass die Erlaubnis entzogen wird.
  event.waitUntil(
    self.registration.showNotification(PUSH_TITEL, {
      body: PUSH_TEXT,
      icon: 'icons/guardops-192.png',
      badge: 'icons/guardops-192.png',
      // Gleiches Kennzeichen fuer alle: Zwei Mitteilungen kurz
      // hintereinander ergeben EINE Benachrichtigung auf dem
      // Sperrbildschirm, nicht zwei gleichlautende. Was es im Einzelnen
      // ist, steht ohnehin erst in der App.
      tag: 'guardops-mitteilung',
      renotify: true,
    })
  );
});

// Ein Tipp auf die Benachrichtigung oeffnet die App -- und zwar ein
// bereits offenes Fenster, statt ein zweites daneben aufzumachen.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const ziel = new URL('app.html', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(fenster => {
      for (const f of fenster) {
        if (f.url.startsWith(self.registration.scope) && 'focus' in f) {
          // Die App laedt beim Sichtbarwerden ohnehin neu (siehe
          // app.html) -- hier genuegt es, sie nach vorn zu holen.
          return f.focus();
        }
      }
      return self.clients.openWindow(ziel);
    })
  );
});

// Das Abo kann vom Push-Dienst erneuert werden (Schluesselwechsel,
// Wiederherstellung). Passiert das unbemerkt, zeigt die App weiterhin
// "eingeschaltet", waehrend der Server an eine tote Adresse schickt.
// Hier laesst sich das nicht selbst beheben -- der Server kennt die neue
// Adresse nicht, und der Sitzungs-Token liegt nicht im Service Worker.
// Die App gleicht darum bei jedem Start ihr tatsaechliches Abo mit dem
// Server ab (pushZustandLaden in app.html); das ist die Stelle, die es
// merkt.
self.addEventListener('pushsubscriptionchange', () => {});
