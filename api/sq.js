// POST /api/sq?a=check | offer | contact
// Env: DISCORD_WEBHOOK_URL (required). Availability = app id is in api/_games.json and has no Discord link yet.
const LIST = new Set(require('./_games.json')); // app ids you want to buy placements on
const hits = new Map();
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 6e4); a.push(n); hits.set(ip, a); return a.length > 15; };
const clean = (s, n = 400) => String(s || '').replace(/@/g, '@\u200b').replace(/`/g, "'").trim().slice(0, n);
const appId = s => { const m = String(s || '').match(/store\.steampowered\.com\/app\/(\d+)/i) || String(s || '').trim().match(/^(\d{2,10})$/); return m ? m[1] : null; };
const j = u => fetch(u, { headers: { 'user-agent': 'side-quest.pro' } }).then(r => r.json()).catch(() => null);

async function game(id) {
  const [d, r, p] = await Promise.all([
    j(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=en`),
    j(`https://store.steampowered.com/appreviews/${id}?json=1&num_per_page=0&language=all&purchase_type=all`),
    j(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`)
  ]);
  const x = d && d[id];
  if (!x || !x.success || x.data.type !== 'game') return { ok: false, reason: 'We could not find a game at this link.' };
  const g = x.data, reviews = (r && r.query_summary && r.query_summary.total_reviews) || 0, players = (p && p.response && p.response.player_count) || 0;
  const html = [g.detailed_description, g.about_the_game, g.short_description, g.website].join(' ');
  const hasDiscord = /discord\.gg|discord\.com\/invite|discordapp\.com\/invite/i.test(html);
  const date = g.release_date && g.release_date.date, age = date && Date.parse(date) ? (Date.now() - Date.parse(date)) / 864e5 : null;
  let reason = null;
  if (!LIST.has(String(id))) reason = 'This game is not on our list right now.';
  else if (hasDiscord) reason = 'This page already links to a Discord server.';
  return { ok: true, eligible: !reason, reason, game: { id, name: g.name, dev: (g.developers || []).join(', '), img: g.header_image, reviews, players, date: date || 'Unknown' } };
}

const send = embed => fetch(process.env.DISCORD_WEBHOOK_URL, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'SideQuest', allowed_mentions: { parse: [] }, embeds: [{ color: 0xffffff, timestamp: new Date().toISOString(), ...embed }] })
}).then(r => r.ok);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  if (limited(ip)) return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (b.site) return res.status(200).json({ ok: true }); // honeypot
  const a = req.query.a;
  try {
    if (a === 'check') {
      const id = appId(b.url);
      if (!id) return res.status(400).json({ error: 'Paste a Steam store link, like store.steampowered.com/app/12345.' });
      return res.status(200).json(await game(id));
    }
    if (!process.env.DISCORD_WEBHOOK_URL) return res.status(500).json({ error: 'Form is not configured yet.' });
    const contact = clean(b.contact, 120);
    if (a === 'offer') {
      const id = appId(b.url), amount = Math.round(+b.amount * 100) / 100;
      if (!id || !(amount > 0) || amount > 1e6 || !contact) return res.status(400).json({ error: 'Check the link, the amount and your contact.' });
      const r = await game(id);
      if (!r.ok || !r.eligible) return res.status(400).json({ error: r.reason || 'This game is not available.' });
      const g = r.game, cur = ['EUR', 'USD', 'GBP'].includes(b.currency) ? b.currency : 'EUR';
      const ok = await send({
        title: `Offer · ${clean(g.name, 100)}`, url: `https://store.steampowered.com/app/${id}`, thumbnail: { url: g.img },
        fields: [
          { name: 'Asking price', value: `**${amount} ${cur}**`, inline: true },
          { name: 'Payment', value: clean(b.payment, 40) || 'Any', inline: true },
          { name: 'Contact', value: contact, inline: true },
          { name: 'Developer', value: clean(g.dev, 100) || 'Unknown', inline: true },
          { name: 'Players / Reviews', value: `${g.players} / ${g.reviews}`, inline: true },
          { name: 'Released', value: clean(g.date, 40), inline: true }
        ]
      });
      return ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: 'Could not deliver your offer. Try again.' });
    }
    if (a === 'contact') {
      const msg = clean(b.message, 1500), ch = ['Email', 'Twitter / X', 'Discord', 'Telegram'].includes(b.channel) ? b.channel : 'Other';
      if (!contact || !msg) return res.status(400).json({ error: 'Add your contact and a message.' });
      const ok = await send({ title: 'Contact form', description: msg, fields: [{ name: ch, value: contact }] });
      return ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: 'Could not deliver your message. Try again.' });
    }
    return res.status(404).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
