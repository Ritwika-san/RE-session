const STORAGE_KEY = 're_session_supabase';

const supabaseUrl = document.getElementById('supabaseUrl');
const supabaseAnonKey = document.getElementById('supabaseAnonKey');
const settingsStatus = document.getElementById('settingsStatus');

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY] || {};
  supabaseUrl.value = config.url || '';
  supabaseAnonKey.value = config.anonKey || '';
}

async function saveSettings() {
  const url = supabaseUrl.value.trim().replace(/\/$/, '');
  const anonKey = supabaseAnonKey.value.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    settingsStatus.textContent = 'Enter a valid Supabase URL.';
    settingsStatus.className = 'status danger';
    return;
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !anonKey) {
    settingsStatus.textContent = 'Enter both the Supabase URL and anon key.';
    settingsStatus.className = 'status danger';
    return;
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...(stored[STORAGE_KEY] || {}), url, anonKey },
  });
  settingsStatus.textContent = 'Settings saved.';
  settingsStatus.className = 'status ok';
}

document.getElementById('saveSettings').addEventListener('click', saveSettings);
window.addEventListener('DOMContentLoaded', loadSettings);