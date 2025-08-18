import { Actor, log } from 'apify';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import got from 'got';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import _ from 'lodash';
const { uniqBy } = _; 

import { scrapeIndeed } from './scrapers/indeed.js';
import { scrapeRemoteOK } from './scrapers/remoteok.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ---------------------- Resume parsing & keywords ----------------------- */

const CANONICAL_SKILLS = [
    // Programming & web
    "c", "c++", "java", "javascript", "typescript", "python", "go", "rust",
    "php", "ruby", "kotlin", "swift", "scala",
    "node", "node.js", "nodejs", "react", "redux", "next.js", "nextjs",
    "vue", "nuxt", "angular", "svelte",
    "html", "css", "sass", "tailwind", "bootstrap",
    "express", "fastapi", "django", "flask", "spring", "laravel",
    "graphql", "rest", "grpc",
    "sql", "mysql", "postgres", "postgresql", "sqlite", "mssql", "mongodb",
    "redis", "elasticsearch", "kafka", "rabbitmq",
    "docker", "kubernetes", "k8s", "terraform", "ansible", "aws", "gcp", "azure",
    "linux", "git", "github", "gitlab", "ci", "cd",
    // Data/ML
    "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch",
    "ml", "machine learning", "nlp", "opencv",
    // Testing & tools
    "jest", "mocha", "chai", "pytest", "playwright", "cypress", "puppeteer",
];

/**
 * Load resume file bytes from various possible shapes:
 * - string path (local bundled path during dev)
 * - public URL
 * - Apify KV record (object with { key } or { url })
 */
async function loadResumeBuffer(resumeFile) {
    if (!resumeFile) return null;

    // In Apify UI, file input often returns an object { key, filename, ... }.
    if (typeof resumeFile === 'object') {
        if (resumeFile.url) {
            const res = await got(resumeFile.url).buffer();
            return res;
        }
        if (resumeFile.key) {
            const value = await Actor.getValue(resumeFile.key);
            if (Buffer.isBuffer(value)) return value;
            if (typeof value === 'string') return Buffer.from(value);
            // Some SDK versions return { body, contentType }
            if (value && value.body) {
                return Buffer.isBuffer(value.body) ? value.body : Buffer.from(value.body);
            }
        }
    }

    if (typeof resumeFile === 'string') {
        // URL
        if (/^https?:\/\//i.test(resumeFile)) {
            const res = await got(resumeFile).buffer();
            return res;
        }
        // Local path (dev)
        const p = path.isAbsolute(resumeFile) ? resumeFile : path.join(__dirname, '..', resumeFile);
        return fs.readFile(p);
    }

    return null;
}

async function extractTextFromBuffer(buf, filename = 'resume') {
    const lower = filename.toLowerCase();
    try {
        if (lower.endsWith('.pdf')) {
            const { text } = await pdfParse(buf);
            return text;
        }
        if (lower.endsWith('.docx')) {
            const { value } = await mammoth.extractRawText({ buffer: buf });
            return value;
        }
        // txt or unknown → try utf-8
        return buf.toString('utf8');
    } catch (e) {
        log.warning(`Failed to parse resume as ${lower}. Falling back to utf-8 text.`);
        return buf.toString('utf8');
    }
}

function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .split(/[^a-z0-9\.\+#\-\+]+/g)
        .filter(Boolean);
}

/**
 * Extract smart keywords:
 * - Keep canonical skills if present
 * - Add top frequent meaningful tokens
 */
function extractKeywordsFromResumeText(text, extraKeywords = [], maxKeywords = 60) {
    const tokens = tokenize(text);
    const freq = new Map();
    for (const t of tokens) {
        if (t.length < 2) continue;
        if (['and', 'the', 'for', 'with', 'to', 'in', 'on', 'of', 'a', 'an', 'as', 'by', 'at', 'from', 'or'].includes(t)) continue;
        freq.set(t, (freq.get(t) || 0) + 1);
    }

    // canonical skills that appear in resume
    const canonical = CANONICAL_SKILLS.filter(s => freq.has(s));

    // top remaining tokens by frequency
    const topTokens = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)
        .filter(t => !canonical.includes(t))
        .slice(0, Math.max(10, maxKeywords - canonical.length));

    const merged = [...new Set([...canonical, ...topTokens, ...extraKeywords.map(k => k.toLowerCase())])];
    return merged.slice(0, maxKeywords);
}

/** ---------------------- Job scoring ----------------------- */

function scoreJobAgainstKeywords(job, keywords) {
    const title = (job.title || '').toLowerCase();
    const company = (job.company || '').toLowerCase();
    const desc = (job.description || '').toLowerCase();

    let score = 0;

    for (const kw of keywords) {
        if (!kw) continue;
        const k = kw.toLowerCase();

        // Weighted: title > description > company
        if (title.includes(k)) score += 3;
        if (desc.includes(k)) score += 1;
        if (company.includes(k)) score += 0.5;
    }

    // Small bonuses
    if ((job.location || '').toLowerCase().includes('remote')) score += 0.5;

    return Number(score.toFixed(2));
}

/** ---------------------- Main ----------------------- */

await Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const {
        query = 'Software Engineer',
        location = 'Remote',
        limit = 20,
        sources = ['indeed', 'remoteok'],
        resumeFile,
        extraKeywords = [],
        notifyEmail
    } = input;

    log.info(`Query: "${query}", location: "${location}", sources: ${sources.join(', ')}`);

    // ===== Parse resume to keywords =====
    let resumeKeywords = [];
    try {
        if (resumeFile) {
            log.info('Loading and parsing uploaded resume…');
            const buf = await loadResumeBuffer(resumeFile);
            if (buf) {
                const filename =
                    (typeof resumeFile === 'object' && (resumeFile.filename || resumeFile.fileName)) ||
                    (typeof resumeFile === 'string' ? resumeFile : 'resume');
                const text = await extractTextFromBuffer(buf, filename);
                resumeKeywords = extractKeywordsFromResumeText(text, extraKeywords, 60);
                log.info(`Extracted ${resumeKeywords.length} keywords from resume.`);
            } else {
                log.warning('Could not read resume file; continuing with extraKeywords only.');
                resumeKeywords = extraKeywords.map(k => k.toLowerCase());
            }
        } else {
            resumeKeywords = extraKeywords.map(k => k.toLowerCase());
        }
        if (resumeKeywords.length === 0) {
            // sensible defaults
            resumeKeywords = ['javascript', 'react', 'node', 'sql', 'api'];
        }
    } catch (err) {
        log.exception(err, 'Resume parsing failed; falling back to basic keywords.');
        resumeKeywords = extraKeywords.length ? extraKeywords.map(k => k.toLowerCase()) : ['javascript', 'react', 'node', 'sql', 'api'];
    }

    // Save keywords used to KV for transparency
    await Actor.setValue('RESUME_KEYWORDS.json', resumeKeywords);

    // ===== Run scrapers =====
    let jobs = [];

    if (sources.includes('indeed')) {
        try {
            const indeedJobs = await scrapeIndeed({ query, location, limit });
            jobs = jobs.concat(indeedJobs);
        } catch (e) {
            log.exception(e, 'Indeed scraper failed.');
        }
    }

    if (sources.includes('remoteok')) {
        try {
            const rokJobs = await scrapeRemoteOK({ query, limit });
            jobs = jobs.concat(rokJobs);
        } catch (e) {
            log.exception(e, 'RemoteOK scraper failed.');
        }
    }

    // Deduplicate by link
    jobs = uniqBy(jobs, j => j.link);

    // Score & sort
    const scored = jobs.map(j => ({ ...j, score: scoreJobAgainstKeywords(j, resumeKeywords) }))
        .sort((a, b) => b.score - a.score);

    log.info(`Pushing ${scored.length} jobs to dataset (sorted by score desc)…`);
    await Actor.pushData(scored);

    // Optional summary
    const top = scored.slice(0, 10).map(j => ({
        title: j.title, company: j.company, source: j.source, score: j.score, link: j.link
    }));
    await Actor.setValue('SUMMARY.json', {
        query, location, sources, total: scored.length, top
    });

    // Optional: notify via email (requires Apify notification config on the platform)
    if (notifyEmail) {
        log.info(`Would notify ${notifyEmail} — configure Apify notifications to receive emails with run results.`);
    }

    log.info('Done ✅');
});
