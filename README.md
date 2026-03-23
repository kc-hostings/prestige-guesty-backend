# Prestige Apartments × Guesty Backend

Dieses Backend ist der sichere Zwischenlayer zwischen eurer Website und der Guesty Open API / Booking Engine API.

## Was es jetzt schon kann
- OAuth 2.0 Access Token sicher serverseitig holen
- Kalenderdaten für einzelne Listings abrufen
- Listing-Suche / Verfügbarkeitsabfrage vorbereiten
- eure Multi-Units und Sub-Units zentral verwalten

## 1. Dateien einrichten
1. Ordner entpacken
2. `npm install`
3. `.env.example` in `.env` umbenennen
4. In `.env` eure echte `GUESTY_CLIENT_SECRET` eintragen
5. Optional `FRONTEND_ORIGIN` anpassen

## 2. Starten
```bash
npm install
npm run dev
```

Dann läuft das Backend auf:
```bash
http://localhost:3000
```

## 3. Testen
### Health Check
```bash
http://localhost:3000/api/health
```

### Listing-IDs prüfen
```bash
http://localhost:3000/api/listing-ids
```

### Kalender für eine Sub-Unit abrufen
Beispiel Deluxe Apartment #2:
```bash
http://localhost:3000/api/calendar/67c496be29d6d000116f735f?from=2026-03-25&to=2026-04-25
```

### Guesty Listings / Verfügbarkeit
```bash
http://localhost:3000/api/listings?available=true&checkin=2026-03-25&checkout=2026-03-28&minOccupancy=4
```

## 4. Nächster Schritt
Wenn das Backend läuft, binden wir als Nächstes eure HTML-Seiten an dieses Backend an:
- unter jedem Apartment wird der echte Guesty-Kalender geladen
- belegte Tage werden automatisch gesperrt dargestellt
- der Buchungsplaner auf der Startseite fragt echte Verfügbarkeit ab

## Wichtige Sicherheit
- `GUESTY_CLIENT_SECRET` niemals in HTML / JS im Browser einbauen
- `.env` niemals öffentlich hochladen
