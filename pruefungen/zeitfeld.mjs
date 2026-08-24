// Eine Uhrzeit in ein Zeitfeld setzen (ENT-110).
//
// `page.fill()` greift dort nicht mehr: Seit die Uhrzeit gewählt statt
// getippt wird, ist das ursprüngliche Feld unsichtbar, und bedient wird über
// zwei Auswahlfelder. Diese Hilfe geht denselben Weg wie ein Mensch.
//
// Sie ist bewusst streng: Steht die gewünschte Minute gar nicht zur Wahl --
// etwa 07:07 in einem Planungsfeld mit Viertelstunden --, bricht sie ab,
// statt stillschweigend nichts oder etwas anderes zu setzen. Eine Prüfung,
// die auf einem nicht gesetzten Wert weiterläuft, prüft das Falsche.
export async function zeitSetzen(page, selektor, wert) {
  const fehler = await page.evaluate(([sel, w]) => {
    const el = document.querySelector(sel);
    if (!el) return `Zeitfeld nicht gefunden: ${sel}`;
    // Noch nicht umgestellt (oder eine Oberfläche ohne die Komponente):
    // dann wie bisher direkt setzen.
    if (!el.__zw) {
      el.value = w;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return null;
    }
    if (!w) {
      el.__zw.std.value = '';
      el.__zw.min.value = '';
      el.__zw.min.dispatchEvent(new Event('change', { bubbles: true }));
      return null;
    }
    const [h, m] = String(w).split(':');
    el.__zw.std.value = h;
    el.__zw.min.value = m;
    if (el.__zw.std.value !== h) return `Stunde ${h} steht bei ${sel} nicht zur Wahl`;
    if (el.__zw.min.value !== m) return `Minute ${m} steht bei ${sel} nicht zur Wahl`;
    el.__zw.min.dispatchEvent(new Event('change', { bubbles: true }));
    return null;
  }, [selektor, wert]);
  if (fehler) throw new Error(fehler);
}
