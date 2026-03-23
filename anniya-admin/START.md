# Anniya Admin Panel — Start Guide

## Requirements
- Node.js 18+ installed
- Git clone of akcaesar/Anniwebsite

## Setup (first time only)
```bash
cd anniya-admin
npm install
```

## Start
```bash
node server.js
```
Then open: http://localhost:3001/admin

## Users
| Username | Password      | Role    | Access |
|----------|---------------|---------|--------|
| anniya   | anniya2024    | Content | Gallery, Texts, Colors, Categories, Pages |
| akshu    | akshu_admin_2024 | Admin | Everything + Logs |

⚠️ Change passwords in .env before going live!

## What happens when Anni saves something
1. File is updated locally (in anniya-site-v2/)
2. Changes are committed and pushed to GitHub
3. Netlify automatically deploys (1-2 minutes)
4. Deploy status shows in sidebar

## .env — important secrets (NEVER commit this file)
- ANNIYA_PASSWORD / AKSHU_PASSWORD — login passwords
- GITHUB_TOKEN — to push changes to GitHub
- NETLIFY_TOKEN — to trigger deploys
- NETLIFY_SITE_ID — which Netlify site to deploy

## Logs
Login as akshu → Logs section → see all actions and errors
