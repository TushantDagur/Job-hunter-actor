import * as cheerio from 'cheerio';
import got from 'got';

const BASE = 'https://www.indeed.com';

export async function scrapeIndeed({ query, location, limit = 20 }) {
    const url = `${BASE}/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;
    const html = await got(url, { headers: { 'user-agent': 'Mozilla/5.0' } }).text();
    const $ = cheerio.load(html);

    const results = [];
    $('.job_seen_beacon').each((i, el) => {
        if (results.length >= limit) return false;

        const title = $(el).find('h2.jobTitle span').first().text().trim();
        const company = $(el).find('.companyName').text().trim();
        const loc = $(el).find('.companyLocation').text().trim();
        const rel = $(el).find('h2 a').attr('href');
        const link = rel ? (rel.startsWith('http') ? rel : `${BASE}${rel}`) : null;

        results.push({
            source: 'Indeed',
            title, company,
            location: loc,
            link,
        });
    });

    // Try to fetch descriptions (best effort; keep it lightweight)
    for (const job of results) {
        if (!job.link) continue;
        try {
            const jhtml = await got(job.link, { headers: { 'user-agent': 'Mozilla/5.0' } }).text();
            const $$ = cheerio.load(jhtml);
            const desc = $$('[id^="jobDescriptionText"]').text().trim();
            if (desc) job.description = desc;
        } catch {
            // ignore fetch failures to stay resilient
        }
    }

    return results;
}
