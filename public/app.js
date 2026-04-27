async function getJSON(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function setupIndex() {
  const inviteBtn = document.getElementById('inviteBtn');
  if (!inviteBtn) return;
  try {
    const meta = await getJSON('/api/meta');
    inviteBtn.href = meta.inviteUrl;
  } catch {
    inviteBtn.href = '#';
  }
}

async function setupDashboard() {
  const guildSelect = document.getElementById('guildSelect');
  const channelSelect = document.getElementById('channelSelect');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const welcomeEl = document.getElementById('welcome');
  if (!guildSelect || !channelSelect || !saveBtn) return;

  try {
    const me = await getJSON('/api/me');
    welcomeEl.textContent = `Logged in as ${me.user.username}#${me.user.discriminator || '0'}`;

    const guildData = await getJSON('/api/guilds');
    guildSelect.innerHTML = guildData.guilds
      .map((g) => `<option value="${g.id}">${g.name}</option>`)
      .join('');

    const saved = await getJSON('/api/config').catch(() => ({ config: null }));

    async function loadChannels(guildId, selected) {
      const channelData = await getJSON(`/api/guilds/${guildId}/channels`);
      channelSelect.innerHTML = channelData.channels
        .map((c) => `<option value="${c.id}">#${c.name}</option>`)
        .join('');
      if (selected) channelSelect.value = selected;
    }

    guildSelect.addEventListener('change', () => {
      loadChannels(guildSelect.value).catch((err) => {
        statusEl.textContent = err.message;
      });
    });

    if (saved.config?.guildId) {
      guildSelect.value = saved.config.guildId;
      await loadChannels(saved.config.guildId, saved.config.channelId);
    } else if (guildSelect.value) {
      await loadChannels(guildSelect.value);
    }

    saveBtn.addEventListener('click', async () => {
      statusEl.textContent = 'Saving...';
      try {
        await getJSON('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId: guildSelect.value, channelId: channelSelect.value }),
        });
        statusEl.textContent = 'Saved! The bot channel is configured.';
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });
  } catch {
    window.location.href = '/';
  }
}

setupIndex();
setupDashboard();
