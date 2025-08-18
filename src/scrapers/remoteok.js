import * as cheerio from 'cheerio';
import got from 'got';

const BASE = 'https://remoteok.com';

export async function scrapeRemoteOK({ query, limit = 20 }) {
    const url = `${BASE}/remote-${encodeURIComponent(query.replace(/\s+/g, '-'))}-jobs`;
    const html = await got(url, { headers: { 'user-agent': 'Mozilla/5.0' } }).text();
    const $ = cheerio.load(html);

    const jobs = [];
    $('tr.job').each((_, el) => {
        if (jobs.length >= limit) return false;

        const title = $(el).find('a.preventLink').text().trim() ||
            $(el).find('td.position h2').text().trim();
        const company = $(el).find('td.company h3').text().trim();
        const linkRel = $(el).attr('data-href') || $(el).find('a.preventLink').attr('href');
        const link = linkRel ? (linkRel.startsWith('http') ? linkRel : `${BASE}${linkRel}`) : null;

        // Tags often include tech keywords
        const tags = $(el).find('.tags a').map((i, t) => $(t).text().trim()).get();

        jobs.push({
            source: 'RemoteOK',
            title,
            company,
            location: 'Remote',
            link,
            tags
        });
    });

    // Fetch description pages to get full text (optional; best effort)
    for (const job of jobs) {
        if (!job.link) continue;
        try {
            const jhtml = await got(job.link, { headers: { 'user-agent': 'Mozilla/5.0' } }).text();
            const $$ = cheerio.load(jhtml);
            const desc = $$('#job-description, .description, article').text().trim();
            if (desc) job.description = desc;
        } catch {
            // ignore
        }
    }

    return jobs;
}
