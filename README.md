# OUTPOST — Disaster Response Command Center

```
outpost/
├── frontend/
│   └── index.html          ← standalone dashboard demo (drone intro, live map, sim engine)
├── backend/
│   ├── server.js            ← Express + Socket.io API, drone ingest endpoint
│   ├── models/               ← Mongoose schemas (Drone, Victim, RescueTeam, Shelter, Resource, Zone)
│   ├── simulators/seed.js    ← DB seed script + a fake drone that POSTs telemetry
│   ├── package.json
│   └── .env.example
├── .github/workflows/deploy-pages.yml   ← auto-deploys frontend/ to GitHub Pages on push
├── netlify.toml              ← tells Netlify to publish the frontend/ folder
├── vercel.json                ← tells Vercel to publish the frontend/ folder
├── render.yaml                 ← one-click backend deploy blueprint for Render
├── .gitignore
└── README.md
```

## Push this to GitHub

```bash
cd outpost                 # this folder
git init
git add .
git commit -m "Initial commit — OUTPOST disaster response command center"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

(Create the empty repo on GitHub first — github.com/new — without a README/license so there's no merge conflict on first push.)

## Making it live — pick one for the frontend

**Option A — GitHub Pages (free, zero extra accounts, already wired up)**
1. On GitHub: repo → Settings → Pages → Source → select **GitHub Actions**.
2. Push to `main` (the workflow in `.github/workflows/deploy-pages.yml` runs automatically).
3. Your site appears at `https://<your-username>.github.io/<your-repo-name>/` within a minute or two — check the Actions tab for progress.

**Option B — Netlify**
1. netlify.com → Add new site → Import an existing project → pick your GitHub repo.
2. Netlify reads `netlify.toml` automatically — no settings to fill in, just click Deploy.

**Option C — Vercel**
1. vercel.com → Add New → Project → import your GitHub repo.
2. Vercel reads `vercel.json` automatically — click Deploy.

All three are equivalent; GitHub Pages is the simplest if you just want a link to share with zero third-party sign-ups.

## Making the backend live (optional — only needed once you build a real frontend that talks to Socket.io/MongoDB instead of the built-in simulation)

1. **Database**: create a free cluster at mongodb.com/atlas, grab the connection string.
2. **Backend host — Render (one-click)**:
   - render.com → New → Blueprint → connect your repo. Render reads `render.yaml` automatically.
   - When prompted, paste your Atlas connection string into the `MONGO_URI` environment variable (it's marked `sync: false` so Render asks for it rather than storing it in the repo).
3. Once deployed, Render gives you a URL like `https://outpost-backend.onrender.com` — that's what your ESP32 posts to (`/api/ingest/drone`) and what a real frontend would open its Socket.io connection to.

## Run it locally instead

**Frontend (no build step needed):**
```bash
cd frontend
npx serve .
```

**Backend:**
```bash
cd backend
npm install
cp .env.example .env       # edit MONGO_URI if not using local Mongo
npm run seed
npm start
```

Full details on how your physical drone talks to `/api/ingest/drone` are in the comments inside `backend/server.js`.

