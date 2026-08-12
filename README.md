# ⏱️ Ablaufplan

Getaktete Tage des Vereins an einer Stelle: Medientag, Turniertag, Trainingslager, Feriencamp. Ein Ablauf besteht aus Punkten mit Uhrzeit, beteiligten Mannschaften, Ort und einer Notiz zum Mitbringen; angezeigt wird er als Zeitstrahl mit einer Marke, wo gerade „jetzt" ist. Wer angemeldet ist, sieht seine eigenen Punkte farbig und kann alles andere ausblenden. Zum Weitergeben an Eltern und Spieler gibt es einen Link, der ohne Anmeldung funktioniert.

**➡️ [Ablaufplan öffnen](https://sc1911heiligenstadt.github.io/ablaufplan/)**

## Wie es gedacht ist

1. Ein **Ablauf** wird angelegt: Titel, Zeitraum, Ort und ein Infotext („Bei Regen in die Halle").
2. Die **Punkte** kommen hinein — entweder einzeln über das Formular oder als fertige Liste zum Einfügen: eine Zeile je Punkt, `09:00 B1 Einzelfotos`. Uhrzeit und Mannschaft erkennt die App selbst.
3. Der **Link zum Weitergeben** wird erzeugt und in die Eltern-Gruppe geschickt — wahlweise gleich auf eine Mannschaft eingestellt, dann sehen die Eltern sofort ihre Zeiten.
4. Am Tag selbst verrutscht so ein Plan fast immer. Ein Knopf am Punkt schiebt diesen **und alle folgenden** um die gewählte Zahl an Minuten; die offene Seite lädt sich etwa jede Minute selbst nach und zeigt es von allein.
5. Ist der Tag vorbei, wandert der Ablauf in den Reiter **„Früher"**. Mit „Kopieren" wird daraus im nächsten Jahr die Vorlage.

## Betrifft mich das?

Die eigenen Mannschaften kommen aus dem Profil in den Trainerdaten. Punkte, die eine davon betreffen, sind farbig markiert; ein Schalter blendet alles andere aus. Wer über den Link ohne Anmeldung kommt, wählt seine Mannschaft oben einmal selbst — das Gerät merkt sich die Wahl.

„D1" und „D1-Jugend" gelten dabei als dieselbe Mannschaft.

## Die Liste zum Einfügen

Erkannt werden `09:00`, `9.00`, `9 Uhr` und Zeitspannen wie `09:00-09:30`, dazu Mannschaftskürzel wie `B1`, `C` oder `D1/D2/D3`. Eine Zeile, die nur ein Datum enthält, schaltet die folgenden Punkte auf diesen Tag um — damit lässt sich ein ganzes Trainingslager in einem Rutsch einfügen.

Was die App nicht sicher erkennt, bleibt unverändert im Textfeld des Punktes stehen und wird nie geraten. Zeilen ohne Uhrzeit meldet sie, statt sie stillschweigend wegzulassen.

## Der Link ohne Anmeldung

Zu jedem Ablauf lässt sich ein Link erzeugen, der ohne Vereinskonto funktioniert. Er zeigt Titel, Zeitraum, Ort, Infotext und alle Punkte — **keine Namen von Personen, keine Anhänge**. Der Link lässt sich jederzeit zurückziehen, ohne den Ablauf zu löschen; danach läuft er ins Leere und ein neuer kann erzeugt werden.

Weil alles im Infotext und in den Notizen über den Link lesbar wird, gehören dort keine personenbezogenen Angaben hinein.

## Ausdruck

Der Knopf „Drucken" legt den Ablauf als Tabelle aufs Blatt — ohne Menü und Knöpfe, zum Aushängen an der Kabine. Ist der Schalter „nur meine" aktiv, druckt die App genau diese Auswahl.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in zwei Stufen: **Sehen** (alle Abläufe mit allen Punkten, der eigene Filter und der Ausdruck) und **Bearbeiten** (Abläufe und Punkte anlegen, ändern, verschieben, löschen, Links erzeugen und zurückziehen, Anhänge pflegen). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

```bash
npx serve E:\ablaufplan
```

Die App braucht keinen Build-Schritt — reines HTML, CSS und JavaScript. Anmelden funktioniert auf `localhost` nicht: der Sitzungstoken gehört zur Adresse `sc1911heiligenstadt.github.io`.

## Technik

| Datei | Zweck |
|---|---|
| `index.html` | drei Reiter, fünf Dialoge |
| `config.js` | Version, Link-Basis, Changelog |
| `zeitlogik.js` | Zeiten, Sortierung, Textübernahme, Verschieben — ohne Oberfläche |
| `db.js` | Anbindung an das Gateway der Tools-Übersicht |
| `app.js` | Zustand, Rechte, Speichern, Zeitstrahl |
| `plan.html` / `plan.js` / `plan.css` | die Seite **ohne Anmeldung** |
| `db-plan.js` | Zugriff ohne Sitzungstoken |

Gespeichert wird in der Vereins-Nextcloud über die zentrale Anmeldung der Tools-Übersicht. Ändern zwei Geräte gleichzeitig denselben Stand, erkennt die App das, lädt den fremden Stand nach und sagt Bescheid.
