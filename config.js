// ⚠️ Die Version bleibt auf 1.0 stehen. Was sich ändert, kommt als eigener Block
// in APP_CHANGELOG dazu — die Nummer selbst wird nicht hochgezählt.
const APP_VERSION = "1.0";

// Basis für den Link ohne Login. Muss auf die LIVE-Adresse zeigen, nicht auf
// localhost — der Link wird weitergeschickt und dort geöffnet.
const LINK_BASIS = "https://sc1911heiligenstadt.github.io/ablaufplan/plan.html";

// Die offene Seite lädt sich in diesem Takt selbst nach. Damit sieht jemand, der
// am Medientag den Link offen hat, eine verschobene Zeit von allein.
// ⚠️ Muss zum Text in plan.html passen ("etwa jede Minute").
const AUTO_REFRESH_MS = 60000;

// Angebotene Sprünge im Verschiebe-Dialog. Frei eintippen geht zusätzlich.
const VERSCHIEBE_SCHRITTE = [-30, -15, -10, -5, 5, 10, 15, 30, 45, 60];

// Obergrenze je Anhang. ⚠️ Muss zum Cap im Worker (dav-file-put) passen —
// steht der Client höher, bricht der Upload erst nach dem Übertragen ab.
const MAX_DATEI_BYTES = 10 * 1024 * 1024;

const APP_CHANGELOG = [
  {
    version: "1.1",
    groups: [
      {
        title: "Liste einfügen: Datumszeilen werden wieder erkannt",
        items: [
          "Eine Zeile, die nur ein Datum enthält (etwa „16.08.2026“ oder „17.08.“), schaltet die folgenden Punkte jetzt zuverlässig auf diesen Tag um. Vorher las die App bei zweistelligem Tag und Monat eine Uhrzeit daraus („16:08“), legte daraus einen sinnlosen Punkt an und ließ alle folgenden Punkte am Vortag stehen — ohne Hinweis.",
          "Betroffen war der übliche Weg für mehrtägige Listen aus Trainingslager und Feriencamp."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Ablaufplan",
        items: [
          "Getaktete Tage des Vereins an einer Stelle: Medientag, Turniertag, Trainingslager, Feriencamp.",
          "Ein Ablauf hat einen Kopf (Titel, Zeitraum, Ort, Infotext) und darunter beliebig viele Punkte.",
          "Jeder Punkt trägt Uhrzeit, optionale Endzeit, die beteiligten Mannschaften, was ansteht, den Ort und eine Notiz zum Mitbringen.",
          "Ein Ablauf darf über mehrere Tage gehen; die Punkte sind dann nach Tagen gruppiert."
        ]
      },
      {
        title: "Der Tag als Kalender und als Liste",
        items: [
          "Über der Liste liegt ein Zeitraster: links die Uhrzeiten, rechts je Tag eine Spalte. Jeder Punkt ist ein Kästchen, dessen Höhe seiner Dauer entspricht — ein Blick genügt, um zu sehen, wo Luft ist und wo es eng wird.",
          "Punkte, die gleichzeitig laufen, stehen nebeneinander statt hintereinander. Am Medientag sieht man so auf einen Blick, dass Einzel- und Mannschaftsfotos parallel gehen.",
          "Eine rote Linie zeigt am laufenden Tag, wo gerade „jetzt“ ist. Was gelaufen ist, tritt zurück; was gerade läuft, ist umrandet.",
          "Darunter steht die gewohnte Liste mit allen Angaben, Trainernamen und Knöpfen. Ein Tipp auf ein Kästchen springt zur passenden Zeile.",
          "Bei einem Ablauf über mehrere Tage stehen die Tage am Rechner nebeneinander. Am Handy wählt man den Tag über die Knöpfe darüber.",
          "Ein Punkt ohne Uhrzeit hat keine Stelle im Raster — er steht als Kästchen darüber, statt zu verschwinden."
        ]
      },
      {
        title: "Betrifft mich das?",
        items: [
          "Die eigenen Mannschaften kommen aus dem eigenen Profil in den Trainerdaten. Punkte, die eine davon betreffen, sind farbig markiert.",
          "Ein Schalter blendet alles andere aus. Die volle Liste ist immer einen Klick entfernt.",
          "Wer über den Link ohne Anmeldung kommt, wählt seine Mannschaft oben selbst — das Gerät merkt sich die Wahl."
        ]
      },
      {
        title: "Trainer und Mannschaften",
        items: [
          "Unter den Mannschaften eines Punktes stehen die Namen der Trainer, die diese Mannschaft betreuen. Wer zwei der beteiligten Mannschaften führt, steht trotzdem nur einmal da.",
          "Die Namen kommen aus den Trainerdaten und werden hier nicht gespeichert. Über den Link ohne Anmeldung sind sie nicht sichtbar.",
          "Die Ankreuzliste der Mannschaften kommt aus der zentralen Liste, die in der Tools-Übersicht unter Einstellungen → Mannschaften gepflegt wird. Jede Mannschaft steht dort genau einmal.",
          "Die Reihenfolge ist die sinnvolle: Herren zuerst, dann A- bis G-Junioren, dann die Nummer.",
          "Schreibweisen aus früher erfassten Punkten bleiben stehen und sind als „alte Schreibweise“ gekennzeichnet; bei einem neuen Punkt lassen sie sich nicht mehr auswählen."
        ]
      },
      {
        title: "Erinnerung eine Viertelstunde vorher",
        items: [
          "Wer eine der beteiligten Mannschaften im Profil hat, bekommt 15 Minuten vor seinem Punkt eine Nachricht aufs Handy — mit Uhrzeit, Mannschaft, was ansteht und dem Ort.",
          "Die Nachricht geht nur an Vereinskonten mit angemeldetem Gerät. Ein- und ausschalten lässt sie sich in der Tools-Übersicht unter „Mein Konto“.",
          "Ein Punkt wird höchstens einmal gemeldet. Wird er verschoben, kommt zur neuen Zeit eine neue Erinnerung.",
          "Punkte ohne Mannschaft (etwa „Fotograf“) lösen nichts aus — dahinter steht kein Konto."
        ]
      },
      {
        title: "Liste einfügen statt tippen",
        items: [
          "Eine fertige Liste („09:00 B1 Einzelfotos“ je Zeile) lässt sich einfügen; die App macht daraus Punkte.",
          "Erkannt werden 09:00, 9.00, „9 Uhr“ und Zeitspannen wie 09:00-09:30, dazu Mannschaftskürzel wie B1, C oder D1/D2/D3.",
          "Eine Zeile, die nur ein Datum enthält, schaltet die folgenden Punkte auf diesen Tag um.",
          "Was die App nicht sicher erkennt, bleibt unverändert im Textfeld des Punktes stehen und wird nie geraten. Zeilen ohne Uhrzeit meldet sie, statt sie stillschweigend wegzulassen."
        ]
      },
      {
        title: "Wenn es am Tag verrutscht",
        items: [
          "Ein Knopf am Punkt schiebt diesen und alle folgenden um die gewählte Zahl an Minuten — vorwärts wie rückwärts.",
          "Endzeiten wandern mit, die Dauer bleibt. Rutscht ein Punkt über Mitternacht, wandert er auf den nächsten Tag.",
          "Geschoben wird nach der Uhrzeit, nicht nach der Reihenfolge des Anlegens."
        ]
      },
      {
        title: "Weitergeben",
        items: [
          "Zu jedem Ablauf lässt sich ein Link erzeugen, der ohne Anmeldung funktioniert — zum Weiterschicken an Eltern und Spieler.",
          "Beim Kopieren kann eine Mannschaft gewählt werden; der Link zeigt dann gleich deren Punkte.",
          "Die geöffnete Seite lädt sich etwa jede Minute selbst nach und zeigt Verschiebungen von allein.",
          "Der Link lässt sich jederzeit zurückziehen, ohne den Ablauf zu löschen. Danach läuft er ins Leere.",
          "Über den Link sind keine Namen sichtbar und keine Anhänge abrufbar."
        ]
      },
      {
        title: "Ausdruck und Anhänge",
        items: [
          "Der Knopf „Drucken“ legt den Ablauf als Tabelle aufs Blatt — ohne Menü und Knöpfe, zum Aushängen an der Kabine.",
          "Ist der Schalter „nur meine“ aktiv, druckt die App genau diese Auswahl.",
          "An einen Ablauf lassen sich Dateien hängen, etwa ein Lageplan oder ein Infoblatt.",
          "Anhänge sind nur für angemeldete Nutzer sichtbar — über den Link ohne Anmeldung nicht."
        ]
      },
      {
        title: "Danach",
        items: [
          "Ist der letzte Tag vorbei, wandert ein Ablauf in den Reiter „Früher“. Gelöscht wird nichts von allein.",
          "Ein Knopf kopiert einen Ablauf samt allen Punkten — der Medientag im nächsten Jahr braucht dann nur neue Daten.",
          "Die Kopie bekommt weder den Link noch die Anhänge des Originals."
        ]
      },
      {
        title: "Wer darf was",
        items: [
          "Sehen: alle Abläufe mit allen Punkten, den eigenen Filter und den Ausdruck.",
          "Bearbeiten: Abläufe und Punkte anlegen, ändern, verschieben, löschen, Links erzeugen und zurückziehen, Anhänge pflegen.",
          "Der Reiter „Info“ ist für alle sichtbar.",
          "Fällt die Anmeldung weg, während die App offen ist, räumt sie den Bildschirm: Seite, Dialoge und Druckansicht verschwinden, statt im Hintergrund lesbar zu bleiben."
        ]
      },
      {
        title: "Daten und Speicherung",
        items: [
          "Gespeichert wird in der Vereins-Nextcloud über die zentrale Anmeldung der Tools-Übersicht — ein eigenes Passwort braucht es nicht.",
          "Ändern zwei Geräte gleichzeitig denselben Stand, erkennt die App das, lädt den fremden Stand nach und sagt Bescheid."
        ]
      }
    ]
  }
];
