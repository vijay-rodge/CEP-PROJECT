## HealthMate

Medical-only search with a modern UI and server API.

### Run API (Node 18+)

```bash
npm install
npm start
```

This starts the API at `http://localhost:3000`.

Endpoints:
- `GET /api/health` – health check
- `GET /api/search?q=Diabetes` – medical-only summary JSON

### Frontend

Open `medical_search.html` directly in the browser for the modern search UI.
It will call `/api/search` if the API is running, else it falls back to client-side Wikipedia filtering.

`index.html` now includes an "Advanced Medical Search" button linking to `medical_search.html`.


