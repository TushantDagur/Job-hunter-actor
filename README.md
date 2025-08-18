# Job Hunter + Resume Auto-Matcher (Apify Actor)

Hunts jobs from multiple platforms and **ranks** them by how well they match your **resume** (PDF/DOCX/TXT).  
Currently supports **Indeed** and **RemoteOK**. Easy to add more sources.

## Features
- Multi-source scraping (Indeed + RemoteOK)
- Upload your resume → auto-extract keywords
- Extra custom keywords
- Smart scoring (title > description > company)
- Duplicate removal by link
- Dataset output (JSON/CSV/Excel from Apify UI)
- `RESUME_KEYWORDS.json` (keywords used), `SUMMARY.json` (top results)

## Local Run
```bash
npm i -g apify-cli
npm i
apify run
