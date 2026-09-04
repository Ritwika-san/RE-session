const STORAGE_KEYS = {
  session: 're_session_session',
  supabase: 're_session_supabase',
  auth: 're_session_auth',
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
  authView: document.getElementById('authView'),
  mainView: document.getElementById('mainView'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  signIn: document.getElementById('signIn'),
  signOut: document.getElementById('signOut'),
  openSettingsFromAuth: document.getElementById('openSettingsFromAuth'),
  authErrorPanel: document.getElementById('authErrorPanel'),
  authErrorText: document.getElementById('authErrorText'),
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

async function loadAuthSession() {
  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey) return null;
  const supabase = createSupabaseClient(config);
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

function setAuthError(message) {
  elements.authErrorPanel.style.display = 'block';
  elements.authErrorText.textContent = message;
}

function clearAuthError() {
  elements.authErrorPanel.style.display = 'none';
  elements.authErrorText.textContent = '';
}

async function signInWithPassword(email, password) {
  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error('Add the Supabase URL and anon key in Settings first.');
  }

  const supabase = createSupabaseClient(config);
  const { data } = await supabase.auth.signInWithPassword({ email, password });
  await chrome.storage.local.set({
    [STORAGE_KEYS.supabase]: { ...config, userId: data.user.id },
  });
  const storedSession = await loadAuthSession();
  if (storedSession?.access_token !== data.session.access_token) {
    throw new Error('Signed in, but the session could not be read back from extension storage.');
  }
}

async function syncAuthUi() {
  const authSession = await loadAuthSession();
  const isSignedIn = Boolean(authSession?.access_token && authSession?.user?.id);
  elements.authView.style.display = isSignedIn ? 'none' : 'grid';
  elements.mainView.style.display = isSignedIn ? 'block' : 'none';
  return isSignedIn;
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
  if (!await syncAuthUi()) return;
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
  if (!config.url || !config.anonKey || !config.userId || !await loadAuthSession()) {
    setError('Sign in before starting a Critical Session.');
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

  const supabase = createSupabaseClient(config);
  await supabase.from('critical_sessions').insert({
    id: session.id,
    task_name: session.taskName,
    category: session.category,
    status: session.status,
    started_at: session.startedAt,
    user_id: session.userId,
  });
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
    const supabase = createSupabaseClient(config);
    await supabase.from('critical_sessions').update(
      { status: 'ended', ended_at: endedSession.endedAt },
      `id=eq.${endedSession.id}`,
    );
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Connection failed');
  }
}

async function registerEvents() {
  elements.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.openSettingsFromAuth.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.signIn.addEventListener('click', async () => {
    const email = elements.authEmail.value.trim();
    const password = elements.authPassword.value;
    if (!email || !password) {
      setAuthError('Enter your email and password.');
      return;
    }
    elements.signIn.disabled = true;
    clearAuthError();
    try {
      await signInWithPassword(email, password);
      elements.authPassword.value = '';
      await syncUi();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in');
    } finally {
      elements.signIn.disabled = false;
    }
  });
  elements.signOut.addEventListener('click', async () => {
    const config = await loadSupabaseConfig();
    if (config.url && config.anonKey) {
      await createSupabaseClient(config).auth.signOut();
    }
    await syncUi();
  });
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
