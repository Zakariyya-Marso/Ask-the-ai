const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

loadEnv(path.join(__dirname, '.env'));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const DISCORD_BOT_INVITE_URL = process.env.DISCORD_BOT_INVITE_URL || 'https://discord.com/oauth2/authorize?client_id=YOUR_BOT_ID&scope=bot%20applications.commands&permissions=274877991936';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

const sessions = new Map();
const states = new Map();
const configFile = path.join(__dirname, 'data', 'configs.json');

ensureFile(configFile, '{}');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);

    if (url.pathname === '/') {
      return serveFile(res, path.join(__dirname, 'public', 'index.html'));
    }

    if (url.pathname === '/dashboard') {
      return serveFile(res, path.join(__dirname, 'public', 'dashboard.html'));
    }

    if (url.pathname === '/styles.css') {
      return serveFile(res, path.join(__dirname, 'public', 'styles.css'), 'text/css');
    }

    if (url.pathname === '/app.js') {
      return serveFile(res, path.join(__dirname, 'public', 'app.js'), 'application/javascript');
    }

    if (url.pathname === '/auth/discord') {
      if (!DISCORD_CLIENT_ID) {
        return json(res, 500, { error: 'DISCORD_CLIENT_ID is missing in .env' });
      }
      const state = crypto.randomBytes(16).toString('hex');
      states.set(state, Date.now());
      const authUrl = new URL('https://discord.com/oauth2/authorize');
      authUrl.searchParams.set('client_id', DISCORD_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'identify guilds');
      authUrl.searchParams.set('state', state);
      res.writeHead(302, { Location: authUrl.toString() });
      return res.end();
    }

    if (url.pathname === '/auth/discord/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state || !states.has(state)) {
        return json(res, 400, { error: 'Invalid OAuth callback.' });
      }
      states.delete(state);

      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return json(res, 500, { error: 'Discord OAuth environment variables are missing.' });
      }

      const token = await exchangeCodeForToken(code);
      const user = await discordGet('/users/@me', token.access_token);

      const sid = signSession({
        user,
        accessToken: token.access_token,
        expiresAt: Date.now() + (token.expires_in * 1000),
      });

      res.writeHead(302, {
        'Set-Cookie': `ask_ai_session=${sid}; HttpOnly; Path=/; SameSite=Lax`,
        Location: '/dashboard',
      });
      return res.end();
    }

    if (url.pathname === '/auth/logout') {
      const sid = readSessionId(req);
      if (sid) sessions.delete(sid);
      res.writeHead(302, {
        'Set-Cookie': 'ask_ai_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax',
        Location: '/',
      });
      return res.end();
    }

    if (url.pathname === '/api/meta' && req.method === 'GET') {
      return json(res, 200, { inviteUrl: DISCORD_BOT_INVITE_URL });
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, { user: session.user });
    }

    if (url.pathname === '/api/guilds' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return json(res, 401, { error: 'Unauthorized' });
      const guilds = await discordGet('/users/@me/guilds', session.accessToken);
      const manageable = guilds.filter((g) => (BigInt(g.permissions) & 0x20n) === 0x20n || g.owner);
      return json(res, 200, { guilds: manageable });
    }

    if (url.pathname.startsWith('/api/guilds/') && url.pathname.endsWith('/channels') && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return json(res, 401, { error: 'Unauthorized' });
      const guildId = url.pathname.split('/')[3];
      const channels = await discordGet(`/guilds/${guildId}/channels`, session.accessToken);
      const textChannels = channels.filter((ch) => ch.type === 0 || ch.type === 5);
      return json(res, 200, { channels: textChannels });
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return json(res, 401, { error: 'Unauthorized' });
      const allConfigs = readJson(configFile, {});
      return json(res, 200, { config: allConfigs[session.user.id] || null });
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const session = getSession(req);
      if (!session) return json(res, 401, { error: 'Unauthorized' });
      const body = await parseJsonBody(req);

      if (!body.guildId || !body.channelId) {
        return json(res, 400, { error: 'guildId and channelId are required.' });
      }

      const allConfigs = readJson(configFile, {});
      allConfigs[session.user.id] = {
        guildId: body.guildId,
        channelId: body.channelId,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(configFile, JSON.stringify(allConfigs, null, 2));
      return json(res, 200, { ok: true, config: allConfigs[session.user.id] });
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Internal server error', detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Ask The AI dashboard running on ${BASE_URL}`);
});

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: DISCORD_REDIRECT_URI,
  });

  const resp = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed: ${resp.status} ${text}`);
  }

  return resp.json();
}

async function discordGet(endpoint, accessToken) {
  const resp = await fetch(`https://discord.com/api${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord API failed (${resp.status}) on ${endpoint}: ${text}`);
  }
  return resp.json();
}

function getSession(req) {
  const sid = readSessionId(req);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return session;
}

function signSession(sessionData) {
  const raw = `${crypto.randomBytes(16).toString('hex')}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('hex');
  const sid = `${raw}.${sig}`;
  sessions.set(sid, sessionData);
  return sid;
}

function readSessionId(req) {
  const cookie = req.headers.cookie || '';
  const target = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ask_ai_session='));
  return target ? target.split('=').slice(1).join('=') : null;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 1_000_000) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath, contentType = 'text/html') {
  if (!fs.existsSync(filePath)) {
    return json(res, 404, { error: 'File not found' });
  }
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureFile(filePath, initialContent) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, initialContent);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
