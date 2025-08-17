const Apify = require('apify');
const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');
const fs = require('fs');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { searchQuery, platforms, uploadResume } = input;

    const results = [];

    if (platforms.includes('indeed')) {
        const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(searchQuery)}`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        $('a.jcs-JobTitle').each((i, el) => {
            results.push({
                title: $(el).text(),
                link: 'https://www.indeed.com' + $(el).attr('href')
            });
        });
    }

    if (platforms.includes('linkedin')) {
        results.push({ note: 'LinkedIn scraping requires API or session cookie. Add logic here.' });
    }

    if (uploadResume) {
        const resumePath = '/tmp/resume.pdf';
        fs.writeFileSync(resumePath, Buffer.from(uploadResume, 'base64'));

        results.push({ resume: 'Uploaded successfully to /tmp/resume.pdf' });
    }

    await Apify.pushData(results);
});
