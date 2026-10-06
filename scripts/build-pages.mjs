// Generates the static SEO and legal pages into public/. Run: npm run pages
import { writeFileSync } from 'node:fs';
import { THEMES } from '../public/js/themes.js';

const SITE = 'https://logic.holuvantage.com';
const UPDATED = '6 October 2026';
const tile = (t, w) => `<span style="background:${THEMES[t][w].bg};color:${THEMES[t][w].fg}"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${THEMES[t][w].svg}</svg></span>`;
const example = (t) => `<div class="example-grid" role="img" aria-label="Example ${THEMES[t].name} grid">${[0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0].map((v) => tile(t, v ? 'b' : 'a')).join('')}</div>`;

function page({ slug, title, description, body, ld }) {
  const url = `${SITE}/${slug}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HoluVantage Daily Logic">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/icons/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${SITE}/icons/og.png">
<meta name="theme-color" content="#0E1726">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;700;800&display=swap">
<link rel="stylesheet" href="/css/app.css">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <a class="logo" href="/" aria-label="HoluVantage Daily Logic home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="logo-text">HoluVantage <b>Daily Logic</b></span></a>
  <nav class="site-nav" aria-label="Main"><a href="/#/leaderboard">Leaderboard</a><a href="/#/account">Account</a></nav>
</header>
<main id="main"><article class="card prose">
${body}
<p><a class="btn primary" href="/">Play Today’s Puzzle</a></p>
</article></main>
<footer class="site-foot">
  <nav aria-label="Footer"><a href="/how-to-play">How to Play</a><a href="/themes">Themes</a><a href="/endless">Endless Logic</a><a href="/pricing">Pricing</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cookies">Cookies</a></nav>
  <p>© HoluVantage. Daily puzzles reset at midnight UTC.</p>
</footer>
</body>
</html>
`;
}

const themePage = (key, intro, fans) => ({
  slug: `${key}-logic`,
  title: `${THEMES[key].name} Logic — a daily ${key === 'classic' ? 'colour grid' : key} puzzle | HoluVantage`,
  description: `Play ${THEMES[key].name} Logic: a free daily ${key === 'classic' ? 'colour grid logic' : `${key} logic`} puzzle with ${THEMES[key].a.label.toLowerCase()} and ${THEMES[key].b.label.toLowerCase()} tiles. Build your streak and climb the leaderboard.`,
  body: `<h1>${THEMES[key].name} Logic</h1>
<p class="lead">${intro}</p>
${example(key)}
<p>In ${THEMES[key].name} Logic you fill the grid with <strong>${THEMES[key].a.label.toLowerCase()}</strong> and <strong>${THEMES[key].b.label.toLowerCase()}</strong> tiles. Each row and column must hold the same number of each, no more than two matching tiles can sit side by side, and no two rows or columns can be the same.</p>
<h2>Who it’s for</h2><p>${fans}</p>
<h2>How the daily puzzle works</h2>
<ul><li>One new puzzle every day at midnight UTC, in Easy (6 × 6), Medium (8 × 8) and Hard (10 × 10).</li>
<li>Everyone gets the same grid, so you can compare times with friends.</li>
<li>Keep a ${THEMES[key].name} streak going by solving every day.</li>
<li>Share your result as a spoiler-free grid of coloured squares.</li></ul>
${key === 'classic' ? '' : '<p class="small muted">We use generic icons only. HoluVantage Daily Logic is not affiliated with any club, league, team or governing body.</p>'}`,
});

const pages = [
  {
    slug: 'how-to-play',
    title: 'How to play HoluVantage Daily Logic — rules and tips',
    description: 'Learn the three rules of HoluVantage Daily Logic, a daily colour grid logic puzzle: balance every row and column, avoid three in a row, and keep every line unique.',
    ld: { '@context': 'https://schema.org', '@type': 'HowTo', name: 'How to play HoluVantage Daily Logic', step: [
      { '@type': 'HowToStep', text: 'Fill every square with one of two tiles.' },
      { '@type': 'HowToStep', text: 'Give every row and column the same number of each tile.' },
      { '@type': 'HowToStep', text: 'Never place more than two identical tiles next to each other in a row or column.' },
      { '@type': 'HowToStep', text: 'Make sure no two rows, and no two columns, are identical.' }] },
    body: `<h1>How to Play</h1>
<p class="lead">A daily logic puzzle you can learn in a minute. No words, no trivia — just reasoning.</p>
${example('classic')}
<h2>The three rules</h2>
<ol><li><strong>Balance.</strong> Every row and every column holds the same number of each tile.</li>
<li><strong>No three in a row.</strong> No more than two identical tiles may sit next to each other, across or down.</li>
<li><strong>All different.</strong> No two rows are identical, and no two columns are identical.</li></ol>
<p>Each puzzle has exactly one solution, and you can always reach it by logic alone — no guessing needed.</p>
<h2>Controls</h2>
<ul><li><strong>Tap</strong> a square to cycle: empty → first tile → second tile → empty. Or pick a tile below the grid and tap to place it.</li>
<li><strong>Keyboard:</strong> arrow keys to move, <kbd>1</kbd> and <kbd>2</kbd> to place, <kbd>0</kbd> or <kbd>Backspace</kbd> to clear, <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo.</li>
<li>Squares that break a rule get a red outline and a “!” badge.</li>
<li>Fixed clues have a small dot in the corner. Hinted squares have a dotted ring.</li></ul>
<h2>Scoring</h2>
<p>You start with 1,000 (Easy), 2,000 (Medium) or 3,000 (Hard) points. Points drop slowly with time, and by 50 for each mistake (placing a tile that isn’t in the final solution) and 150 for each hint. Leaderboards rank by score, then time, then mistakes.</p>
<h2>Tips</h2>
<ul><li>Two matching tiles side by side? The squares on both ends must be the other tile.</li>
<li>A gap between two matching tiles must be filled with the other tile.</li>
<li>Once a row has its full share of one tile, the rest of that row is the other tile.</li></ul>
<h2>Streaks</h2><p>Solve any daily puzzle to keep your streak. Each theme also keeps its own streak. New puzzles arrive at midnight UTC.</p>`,
  },
  {
    slug: 'themes',
    title: 'Themes — Classic, Football, Cricket and Geography | HoluVantage Daily Logic',
    description: 'Choose the look of your daily logic puzzle: Classic, Football, Cricket or Geography. Same rules, same daily grid, different style.',
    body: `<h1>Themes</h1>
<p class="lead">Every theme uses the same rules and the same daily grid. Choose the one that suits you.</p>
${Object.keys(THEMES).map((k) => `<h2><a href="/${k}-logic">${THEMES[k].name}</a></h2><p>${THEMES[k].tagline}</p><div class="example-grid" aria-hidden="true">${tile(k, 'a')}${tile(k, 'b')}</div>`).join('\n')}
<p>Free play includes Classic plus one theme of your choice. <a href="/pricing">HoluVantage All Themes</a> unlocks every theme, including future seasonal themes.</p>`,
  },
  themePage('classic', 'The original daily colour grid puzzle: dots and diamonds, pure logic.', 'Anyone who enjoys a short daily brain game, Sudoku fans looking for something new, and students who like logic.'),
  themePage('football', 'A daily football logic puzzle with balls and corner flags.', 'Football fans in the UK, Nigeria, the US and everywhere the game is loved. No football knowledge needed — just logic.'),
  themePage('cricket', 'A daily cricket logic puzzle with leather balls and willow bats.', 'Cricket fans in India, the UK and beyond who want a quick puzzle with their morning chai or tea.'),
  themePage('geography', 'A daily geography logic puzzle with mountains and oceans.', 'Travellers, map lovers, students and teachers. Great as a classroom warm-up.'),
  {
    slug: 'pricing',
    title: 'Pricing — free daily logic puzzle, or unlock every theme | HoluVantage',
    description: 'HoluVantage Daily Logic is free to play. HoluVantage All Themes unlocks every theme, the full archive, unlimited hints, advanced stats and no ads.',
    body: `<h1>Pricing</h1>
<p class="lead">Start free. Upgrade only if you love it.</p>
<h2>Free</h2>
<ul><li>Classic theme plus one theme of your choice</li><li>Daily puzzle in Easy, Medium and Hard</li><li>Streaks and leaderboards</li><li>One hint per puzzle</li><li>Endless Logic practice</li><li>Supported by ads, only with your consent</li></ul>
<h2>HoluVantage All Themes</h2>
<ul><li>All themes, including future seasonal themes</li><li>Full puzzle archive</li><li>Unlimited hints and archive practice</li><li>No advertising</li><li>Advanced statistics</li></ul>
<div class="table-wrap" tabindex="0" role="region" aria-label="Prices"><table class="board-table"><thead><tr><th scope="col">Region</th><th scope="col">Monthly</th><th scope="col">Yearly</th></tr></thead><tbody>
<tr><td>United Kingdom</td><td>£2.99</td><td>£24.99</td></tr>
<tr><td>United States and elsewhere</td><td>$3.99</td><td>$29.99</td></tr>
<tr><td>Nigeria</td><td>₦1,500</td><td>—</td></tr>
<tr><td>India</td><td>₹149</td><td>—</td></tr></tbody></table></div>
<p>The game shows the price for your region automatically. Cancel any time from your account.</p>
<p><a class="btn" href="/#/pricing">Upgrade in the app</a></p>`,
  },
  {
    slug: 'about',
    title: 'About HoluVantage Daily Logic',
    description: 'HoluVantage Daily Logic is a free daily visual logic puzzle from HoluVantage, built in London for players in the UK, US, Nigeria, India and beyond.',
    ld: { '@context': 'https://schema.org', '@type': 'Organization', name: 'HoluVantage', url: 'https://holuvantage.com' },
    body: `<h1>About</h1>
<p class="lead">One daily logic puzzle. Choose your theme. Build your streak.</p>
<p>HoluVantage Daily Logic is made by <a href="https://holuvantage.com">HoluVantage</a>, an independent software studio based in London. We wanted a daily puzzle that works for everyone — no word lists, no spelling differences, no trivia — so that a student in Lagos, a commuter in London, a cricket fan in Mumbai and a teacher in Ohio can all play the same grid on the same day.</p>
<p>The puzzles are generated and checked by computer before they go live: every one has exactly one solution and can be solved by logic alone.</p>
<h2>Get in touch</h2><p>Found a problem or have an idea? Use <a href="/#/account">Report a problem</a> in your account page.</p>`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy | HoluVantage Daily Logic',
    description: 'How HoluVantage Daily Logic collects, uses and protects your information.',
    body: `<h1>Privacy Policy</h1>
<p class="muted">Last updated ${UPDATED}.</p>
<p>This policy explains what information HoluVantage Daily Logic (“we”) collects and why. We are HoluVantage, based in London, United Kingdom. We aim to collect as little as possible. This policy is written to support the UK GDPR, Nigeria’s Data Protection Act 2023 and India’s Digital Personal Data Protection Act 2023; it has not yet been reviewed by a lawyer and we will update it if that review requires changes.</p>
<h2>What we collect</h2>
<ul><li><strong>Guest play:</strong> a random player ID and a generated nickname, stored on our servers and linked to your device by a token kept in your browser. No name or email.</li>
<li><strong>Accounts (optional):</strong> your email address, used only to sign you in and, if you subscribe, for receipts.</li>
<li><strong>Gameplay:</strong> puzzles started and solved, moves needed to verify your solution, time, mistakes, hints, streaks, achievements, theme choices and groups you join.</li>
<li><strong>Region:</strong> we read your approximate country from your connection to show local prices. We store only the pricing region (UK, US, Nigeria or India). Our hosting provider keeps short-lived request logs, which include IP addresses, for security.</li>
<li><strong>Usage measurement (only with consent):</strong> events such as “puzzle started” or “result shared”, linked to your player ID.</li>
<li><strong>Payments:</strong> handled by Stripe (UK/US), Paystack (Nigeria) or Razorpay (India). We never see or store your card details. We keep a record of your subscription status and payment amounts.</li>
<li><strong>Reports:</strong> anything you write in “Report a problem”.</li></ul>
<h2>Why we use it (lawful bases)</h2>
<ul><li>To run the game, verify scores, keep streaks and show leaderboards — necessary to provide the service you ask for (contract).</li>
<li>To process subscriptions — contract, and legal obligations for financial records.</li>
<li>Usage measurement and advertising — your consent, which you can withdraw at any time in Account → Privacy.</li>
<li>Security and fraud prevention — our legitimate interests.</li>
<li>Product news emails — only if you tick the box in your account.</li></ul>
<h2>Leaderboards</h2><p>Leaderboards show your nickname only — never your email. You can change your nickname at any time.</p>
<h2>Advertising</h2><p>Free play may show ads from Google AdSense, but only after you choose “Accept all” or turn on advertising cookies. Ads never appear while you are solving a puzzle. Subscribers see no ads.</p>
<h2>Who processes your data</h2>
<ul><li>Vercel (hosting) and Supabase (database and sign-in).</li><li>Stripe, Paystack and Razorpay (payments).</li><li>Google (advertising, with consent).</li></ul>
<p>Some of these providers process data outside your country, including in the United States and the EU, under appropriate safeguards such as standard contractual clauses.</p>
<h2>How long we keep it</h2><p>We keep your data while your guest profile or account exists. Payment records may be kept longer where the law requires it. Delete your data at any time and it is removed from our live database straight away.</p>
<h2>Your rights</h2>
<p>You can access, download, correct and delete your data. Use <strong>Account → Download my data</strong> or <strong>Delete my account</strong>. Deleting your account cancels any active subscription. For any other request, use “Report a problem” in your account page. You may also complain to your data protection authority — in the UK, the Information Commissioner’s Office (ico.org.uk); in Nigeria, the Nigeria Data Protection Commission; in India, the Data Protection Board of India.</p>
<h2>Children</h2><p>Guest play collects no contact details. Accounts and payments are for adults, or for younger players with the permission of a parent or guardian where local law requires it (in Nigeria and India, players under 18 need verifiable parental consent). Teachers using groups should not ask pupils to create accounts without that consent.</p>
<h2>Changes</h2><p>We will post any changes here and update the date above.</p>`,
  },
  {
    slug: 'terms',
    title: 'Terms of Use | HoluVantage Daily Logic',
    description: 'The terms for playing HoluVantage Daily Logic and subscribing to HoluVantage All Themes.',
    body: `<h1>Terms of Use</h1>
<p class="muted">Last updated ${UPDATED}.</p>
<p>By playing HoluVantage Daily Logic you agree to these terms. They have not yet been reviewed by a lawyer and may be updated.</p>
<h2>The game</h2><p>The daily puzzle and Endless Logic are free. We may change, add or remove features and themes. We aim for the game to be available every day but cannot guarantee uninterrupted service.</p>
<h2>Fair play</h2><ul><li>Don’t use bots or automated tools, or tamper with scores. Solves that we cannot verify are not ranked.</li><li>Nicknames must not be offensive or impersonate others. We may change or remove nicknames and remove players who break these rules.</li></ul>
<h2>Subscriptions</h2>
<ul><li>HoluVantage All Themes renews automatically each month or year until you cancel.</li>
<li>Cancel any time in Account → Manage or cancel. You keep access until the end of the period you’ve paid for.</li>
<li>Prices are shown before you pay and may change with at least 30 days’ notice for existing subscribers.</li>
<li>If you are a consumer in the UK you have a 14-day right to cancel a new subscription; by starting to use premium features straight away you agree that we may deduct a proportionate amount for the time used. Your statutory rights are not affected.</li></ul>
<h2>Intellectual property</h2><p>The game, puzzles and design belong to HoluVantage. Sharing your result cards is encouraged. HoluVantage Daily Logic is not affiliated with any sports club, league, team or governing body; all icons are generic.</p>
<h2>Liability</h2><p>The game is provided “as is”. Nothing in these terms limits liability that cannot legally be limited.</p>
<h2>Governing law</h2><p>These terms are governed by the laws of England and Wales, without affecting mandatory consumer protections where you live.</p>`,
  },
  {
    slug: 'cookies',
    title: 'Cookie Policy | HoluVantage Daily Logic',
    description: 'How HoluVantage Daily Logic uses browser storage and cookies, and how to change your choices.',
    body: `<h1>Cookie Policy</h1>
<p class="muted">Last updated ${UPDATED}.</p>
<h2>Essential storage (always on)</h2>
<p>We use your browser’s local storage to keep your guest token or sign-in session, your in-progress moves, theme choice, settings and your privacy choices. The game cannot work without these. We set no essential third-party cookies.</p>
<h2>Usage measurement (optional)</h2><p>With your consent we record gameplay events on our own servers to understand what players enjoy. No third-party analytics service is used.</p>
<h2>Advertising (optional)</h2><p>With your consent, Google AdSense may set cookies to show and measure ads to free players. Without consent, no ad code is loaded.</p>
<h2>Changing your choices</h2><p>Go to <a href="/#/account">Account → Privacy</a> at any time, or clear this site’s data in your browser settings.</p>`,
  },
];

for (const p of pages) writeFileSync(new URL(`../public/${p.slug}.html`, import.meta.url), page(p));
const urls = ['', 'endless', ...pages.map((p) => p.slug)];
writeFileSync(new URL('../public/sitemap.xml', import.meta.url), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}/${u}</loc><changefreq>${u === '' ? 'daily' : 'monthly'}</changefreq><priority>${u === '' ? '1.0' : '0.6'}</priority></url>`).join('\n')}
</urlset>
`);
writeFileSync(new URL('../public/robots.txt', import.meta.url), `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Wrote ${pages.length} pages, sitemap.xml and robots.txt`);
