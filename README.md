# A Coins — Accolade 2026

Full-stack reward system with live leaderboard, volunteer panel, canteen redemption, and admin analytics.

---

## Deploy to Render (step by step)

### Step 1 — Push to GitHub

1. Create a new repository on GitHub (name it `accolade-coins`)
2. Open a terminal in this folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/accolade-coins.git
git push -u origin main
```

---

### Step 2 — Create PostgreSQL database on Render

1. Go to [render.com](https://render.com) and log in
2. Click **New → PostgreSQL**
3. Name it: `accolade-coins-db`
4. Plan: **Free**
5. Click **Create Database**
6. Wait for it to be ready, then copy the **Internal Database URL**

---

### Step 3 — Create the Web Service on Render

1. Click **New → Web Service**
2. Connect your GitHub repo (`accolade-coins`)
3. Fill in:
   - **Name**: `accolade-coins`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
4. Under **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | (paste the Internal Database URL from Step 2) |
| `VOLUNTEER_PIN` | Your chosen 4-digit PIN (e.g. `5678`) |
| `ADMIN_PASSWORD` | A strong password for admin dashboard |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGINS` | Comma-separated list of allowed frontend origins |

5. Click **Create Web Service**

Render will build and deploy. Takes ~2 minutes. Your site will be live at:
`https://accolade-coins.onrender.com`

---

## Deploy to GitHub Pages (frontend only)

GitHub Pages can host the React frontend, but it cannot run the Node/Express API or Postgres. You still need to host the backend separately (Render, Railway, etc.) and allow the frontend to call it.

1. Push this repo to GitHub.
2. In the GitHub repo: Settings â†’ Pages â†’ Source = GitHub Actions.
3. The workflow in `.github/workflows/deploy.yml` will build and deploy on every push to `main`.

If you want the Pages frontend to talk to a hosted backend, set `VITE_API_BASE` to the backend origin.

Steps:
1. Deploy the backend somewhere (Render or similar) and note the base URL.
2. In GitHub repo Settings â†’ Secrets and variables â†’ Actions, add a secret named `VITE_API_BASE` with the backend URL.
3. Push to `main`. The workflow will rebuild with that API base and publish.

---

## Pages

| URL | Who uses it |
|-----|------------|
| `/` | Everyone — event landing page |
| `/#balance` | Participants — check their coin balance |
| `/#leaderboard` | Everyone — live leaderboard (put on projector!) |
| `/#volunteer` | Volunteers — PIN protected |
| `/#admin` | Organizers — password protected |

---

## Volunteer Panel (PIN protected)

- **Add Participant** — register new participants with starting coins
- **Award Coins** — search participant, enter amount and reason
- **Canteen Redeem** — process redemptions (1 per day enforced)
- **Edit Menu** — update canteen items and coin costs

---

## Admin Dashboard (password protected)

- Summary stats (total participants, coins awarded/redeemed)
- Coins by reason breakdown
- Canteen item popularity
- Top 10 earners
- Full participant table with search and CSV export

---

## Changing the PIN or password

Go to your Render web service → **Environment** tab → update `VOLUNTEER_PIN` or `ADMIN_PASSWORD` → Save. Render redeploys automatically.

---

## Local development

```bash
npm install
cp .env.example .env
# Fill in your local PostgreSQL URL in .env
npm run dev
# Vite UI: http://localhost:5173
# API: http://localhost:3000
```

---

## Security Notes

- Set `FRONTEND_ORIGINS` in production to a comma-separated list of allowed frontend origins.
- Use HTTPS for the backend to keep PIN/admin password headers protected in transit.
- Consider adding rate limits at the edge (Render, Cloudflare) in addition to the app limits.

---

## Licensing

This repository is licensed under the MIT License. See `LICENSE`.
