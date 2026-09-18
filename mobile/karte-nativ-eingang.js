// Eingang fuer esbuild (ENT-609).
//
// Das Kartenplugin wird als ES-Modul ausgeliefert; app.html ist eine
// einzelne Datei ohne Buendler und spricht Plugins sonst ueber
// window.Capacitor.Plugins an. Fuer die Karte genuegt das NICHT: Zwischen
// dem nativen Plugin und dem Aufrufer liegt eine eigene JavaScript-Schicht,
// die das eigene HTML-Element anlegt, die Groesse und Lage der Karte an die
// native Seite meldet und beim Verschieben nachfuehrt. Die von Hand
// nachzubauen waere mehr Eigenbau fuer weniger Verlaesslichkeit.
//
// Darum wird genau diese Schicht mit esbuild zu EINER Datei
// zusammengefasst (mobile/www/karte-nativ.js, erzeugt in aufs-handy.sh)
// und in der App unter window.KarteNativ bereitgestellt.
//
// Nur fuer die App. Die Web-Fassung laedt diese Datei nicht und benutzt
// weiterhin die Maps-JavaScript-API.
export { GoogleMap, LatLngBounds, MapType } from '@capacitor/google-maps';
