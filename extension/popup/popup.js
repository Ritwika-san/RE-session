const STORAGE_KEYS = {
  session: 're_session_session',
  supabase: 're_session_supabase',
  captureStatus: 're_session_capture_status',
};

const elements = {
  taskName: document.getElementById('taskName'),
  category: document.getElementById('category'),
  toggleSession: document.getElementById('toggleSession'),
  deleteSession: document.getElementById('deleteSession'),
  sessionState: document.getElementById('sessionState'),
  lastCheckpoint: document.getElementById('lastCheckpoint'),
  captureInfo: document.getElementById('captureInfo'),
  errorPanel: document.getElementById('errorPanel'),
  errorText: document.getElementById('errorText'),
  openSettings: document.getElementById('openSettings'),
};

function setError(message) {
  elements.errorPanel.style.display = 'block';
  elements.errorText.textContent = message;
}

function clearError() {
  elements.errorPanel.style.display = 'none';
  elements.errorText.textContent = '';
}

async function loadSupabaseConfig() {
  const config = await chrome.storage.local.get(STORAGE_KEYS.supabase);
  return config[STORAGE_KEYS.supabase] || { url: '', anonKey: '', userId: '' };
}

async function checkSessionState() {
  const { session } = await chrome.storage.local.get(STORAGE_KEYS.session);
  const sessionState = session || null;
  elements.sessionState.textContent = sessionState ? `Active: ${sessionState.taskName}` : 'Signed out';
  elements.sessionState.classList.toggle('ok', Boolean(sessionState));
  elements.toggleSession.textContent = sessionState ? 'End session' : 'Start session';
  elements.captureInfo.textContent = sessionState ? 'Capturing code, form, email, and screenshot updates' : 'No active capture';
}

async function syncUi() {
  await checkSessionState();
  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey) {
    setError('Add the Supabase URL and anon key in Settings before starting a session.');
    return;
  }
  clearError();
}

async function startSession() {
  const taskName = elements.taskName.value.trim();
  const category = elements.category.value;
  if (!taskName) {
    setError('Enter a task name before starting a Critical Session.');
    return;
  }

  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey || !config.userId) {
    setError('Not signed in. Sign in through the recovery client before starting a session.');
    return;
  }

  const session = {
    id: crypto.randomUUID(),
    taskName,
    category,
    startedAt: new Date().toISOString(),
    status: 'active',
    userId: config.userId,
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
  await chrome.storage.local.set({ [STORAGE_KEYS.captureStatus]: { active: true, lastCheckpoint: new Date().toISOString() } });
  elements.lastCheckpoint.textContent = 'Just now';
  await checkSessionState();
  clearError();
}

async function endSession() {
  const session = (await chrome.storage.local.get(STORAGE_KEYS.session))[STORAGE_KEYS.session];
  if (!session) {
    setError('No active session to end.');
    return;
  }

  const endedSession = { ...session, status: 'ended', endedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: null });
  await chrome.storage.local.set({ [STORAGE_KEYS.captureStatus]: { active: false, lastCheckpoint: null } });
  elements.lastCheckpoint.textContent = 'No checkpoint yet';
  elements.sessionState.textContent = 'Session ended';
  clearError();

  try {
    const config = await loadSupabaseConfig();
    const response = await fetch(`${config.url}/rest/v1/critical_sessions?id=eq.${endedSession.id}`, {
      method: 'PATCH',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'ended', ended_at: endedSession.endedAt }),
    });
    if (!response.ok) {
      throw new Error('Unable to update session status in Supabase');
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Connection failed');
  }
}

async function registerEvents() {
  elements.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.toggleSession.addEventListener('click', async () => {
    const sessionData = (await chrome.storage.local.get(STORAGE_KEYS.session))[STORAGE_KEYS.session];
    if (sessionData) {
      await endSession();
    } else {
      await startSession();
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await registerEvents();
  await syncUi();
});
