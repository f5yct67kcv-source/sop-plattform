// Die Ablauf-Logik des Prueflaeufers, getrennt von der Ausfuehrung (ENT-310).
//
// Wozu die Trennung: Der Laeufer selbst startet Browser und braucht 16
// Minuten -- er laesst sich nicht sinnvoll pruefen. Diese Datei enthaelt nur
// die Entscheidungen (wie viele gleichzeitig, was bei einem Fehlschlag
// geschieht) und kommt ohne Browser aus. Genau dort koennen die Fehler
// sitzen, die ein paralleler Lauf mit sich bringt.

/* Fuehrt `namen` mit hoechstens `gleichzeitig` gleichzeitigen Laeufen aus.
   `starte(name)` liefert ein Versprechen auf { gruen, ... }.

   Zwei Eigenschaften, auf die es ankommt und die geprueft werden:
   - Es laufen NIE mehr als `gleichzeitig` auf einmal. Wer das nicht begrenzt,
     startet 95 Browser gleichzeitig und misst danach den Arbeitsspeicher,
     nicht die Software.
   - Das Ergebnis kommt in der Reihenfolge der Eingabe zurueck, nicht in der
     des Fertigwerdens. Sonst sieht ein Lauf jedes Mal anders aus und laesst
     sich mit dem vorherigen nicht vergleichen.

   `beiFertig(name, ergebnis)` wird aufgerufen, sobald einer fertig ist --
   fuer die Fortschrittsanzeige, die naturgemaess in der Reihenfolge des
   Fertigwerdens erscheint. */
export async function poolLauf(namen, starte, gleichzeitig, beiFertig) {
  const ergebnisse = new Array(namen.length);
  let naechster = 0;
  let laufend = 0;
  let hoechststand = 0;   // fuer die Pruefung: wie viele liefen tatsaechlich gleichzeitig

  async function bahn() {
    for (;;) {
      const i = naechster++;
      if (i >= namen.length) { return; }
      laufend++;
      if (laufend > hoechststand) { hoechststand = laufend; }
      try {
        ergebnisse[i] = await starte(namen[i]);
      } finally {
        laufend--;
      }
      if (beiFertig) { beiFertig(namen[i], ergebnisse[i]); }
    }
  }

  const bahnen = [];
  for (let b = 0; b < Math.max(1, Math.min(gleichzeitig, namen.length)); b++) {
    bahnen.push(bahn());
  }
  await Promise.all(bahnen);
  return { ergebnisse, hoechststand };
}

/* Ein roter Lauf wird EINZELN wiederholt, bevor er als rot gilt (ENT-310).
   Das ist der Kern dieses Umbaus, nicht eine Zutat: Parallelbetrieb kann
   Fehlschlaege erzeugen, die es bei alleinigem Lauf nicht gibt -- ein
   langsamerer Rechner, ein Zeitablauf, der knapp wird, zwei Suiten, die
   sich zufaellig ins Gehege kommen. Ein Netz, dem man nicht traut, ist
   wertlos: Man gewoehnt sich an rote Laeufe und uebersieht den echten.

   Der Preis ist ein zusaetzlicher Lauf je roter Suite -- und nur dann.
   Bei gruenem Durchgang kostet es nichts.

   Bleibt sie auch allein rot, ist sie wirklich rot. Wird sie allein gruen,
   ist der Fehlschlag dem Parallelbetrieb zuzuschreiben; das wird gemeldet
   und NICHT verschwiegen, sonst verdeckt die Wiederholung eine echte
   Unzuverlaessigkeit. */
export async function mitWiederholung(rote, starte) {
  const echt = [], wackelig = [];
  for (const name of rote) {
    const zweiter = await starte(name);
    (zweiter.gruen ? wackelig : echt).push({ name, ergebnis: zweiter });
  }
  return { echt, wackelig };
}
