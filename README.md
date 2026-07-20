# Gym Anvil CRM

Single-file CRM for Gym Anvil outreach to **premium independent UK gyms**.
Vanilla HTML + JS, no build step. localStorage is the local-first store,
Firebase Firestore syncs on top.

- **Live: https://gymanvil-crm.vercel.app**
- App: `gymanvil-crm.html`
- Firebase project: `gymanvil-crm` (Firestore in eur3)
- Leads live in the Firestore `leads` collection, behind owner sign-in.

## Where the leads come from

The lead engine at `~/Desktop/Projects/GymAnvil/leads` scrapes Google Maps,
filters out every chain and council operator, crawls each gym's site to detect
its booking platform and member app, and pulls the registered owner from
Companies House. Its `output/final_callsheet.csv` is the input here.

```bash
node scripts/import-leads.mjs --dry-run   # preview
node scripts/import-leads.mjs             # write to Firestore
node scripts/import-leads.mjs --seed      # also write local leads-seed.json
```

Re-running is safe: doc ids are a hash of name+website, and anything you have
typed (notes, stage, disposition, activity) is preserved on re-import.

## Segments

Each lead is bucketed by its wedge, which drives the WhatsApp and email templates:

| Segment | Meaning |
|---|---|
| `on_platform` | Runs template booking software (Mindbody, Glofox, ClubRight...). The strongest signal. |
| `whitelabel_app` | Their "own" member app is a white label. |
| `dated_site` | Live but dated website. Forge Audit door-opener. |
| `no_app` | Real club, no member app yet. |
| `phone_only` | No usable website. |

## Not in this repo (deliberately)

- `serviceAccountKey.json` — Firebase admin credentials.
- `leads-seed.json` — the call sheet itself. This repo is public (GitHub Pages
  free tier), and the lead list is work product, so it is never committed.

## Deploying

Hosted on **Vercel** (`gymanvil-crm.vercel.app`). GitHub Pages was the intended
home but its build service was failing on this repo (every Pages/Actions run
returned `startup_failure`, including a no-op test workflow), so Vercel serves it.
The Pages config is still in place if it recovers.

```bash
npx vercel deploy --prod --yes     # publish the current local files
```

`.vercelignore` keeps `serviceAccountKey.json`, `leads-seed.json` and `scripts/`
off the public URL. Verify after any deploy:

```bash
curl -o /dev/null -w '%{http_code}\n' https://gymanvil-crm.vercel.app/serviceAccountKey.json  # must be 404
```
