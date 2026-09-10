<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import CodeEditor from './components/CodeEditor.vue';
import { supabase, getSupabaseSession, getActiveRecoverySession, signInWithEmail, signOutUser, fetchRecoveryForSession, runPistonCode, formatRelativeTime, pushPendingEdit, type RecoveryPayload, type RecoveryCategory, type RecoverySession } from './lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { clampWithBand, getReadinessColor } from './lib/utils';

const authEmail = ref('');
const authPassword = ref('');
const isAuthReady = ref(false);
const isLoading = ref(false);
const isAuthLoading = ref(false);
const authError = ref('');
const recoveryError = ref('');
const session = ref<RecoverySession | null>(null);
const recovery = ref<RecoveryPayload | null>(null);
const user = ref<any>(null);
const activeCategory = ref<RecoveryCategory>('code');
const codeSource = ref('');
const codeEditorDirty = ref(false);
const formFields = ref([
  { name: 'Full name', value: 'Jordan Rivers' },
  { name: 'Email', value: 'jordan.rivers@example.com' },
  { name: 'Reason for application', value: 'Critical restart and continuity test' },
]);
const formFieldsDirty = ref(false);
const codeSyncing = ref(false);
const formSyncing = ref(false);
const formSyncLoading = ref(false);
const formSyncMessage = ref('');
const runOutput = ref('');
const runLoading = ref(false);
const emailDraft = ref('Hi team,\n\nI am finalizing the handoff for the prototype and wanted to confirm that the latest update is ready.');
const attachmentUrl = ref('https://example.com/download-file.pdf');
const sessionSignal = ref('');
const checkpointAt = ref<string | null>(null);
const clock = ref(Date.now());
const actionMessage = ref('');
const currentRoute = ref(window.location.hash || '#/dashboard');
let authSubscription: { unsubscribe: () => void } | undefined;
let recoveryChannel: RealtimeChannel | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let ageRefreshTimer: ReturnType<typeof setInterval> | undefined;
let codeSyncTimer: ReturnType<typeof setTimeout> | undefined;
let formSyncTimer: ReturnType<typeof setTimeout> | undefined;
let formSyncTimeout: ReturnType<typeof setTimeout> | undefined;
let hasSetInitialCategory = false;

const readinessBand = computed(() => clampWithBand(recovery.value?.readiness_score ?? 0));
const readinessColor = computed(() => getReadinessColor(recovery.value?.readiness_score ?? 0));
const sessionSignalDisplay = computed(() => {
  clock.value;
  return checkpointAt.value ? formatRelativeTime(checkpointAt.value) : sessionSignal.value || 'No checkpoint yet';
});
const checkpointBadge = computed(() => {
  clock.value;
  return `Updated in ${recovery.value?.source || 'this device'} · ${formatRelativeTime(checkpointAt.value)}`;
});

async function handleSignIn() {
  isAuthLoading.value = true;
  authError.value = '';
  try {
    const signedInUser = await signInWithEmail(authEmail.value, authPassword.value);
    user.value = signedInUser;
    await loadSessionAndRecovery();
  } catch (error) {
    authError.value = error instanceof Error ? error.message : 'Unable to sign in';
  } finally {
    isAuthLoading.value = false;
  }
}

async function handleSignOut() {
  try {
    await signOutUser();
    user.value = null;
    session.value = null;
    recovery.value = null;
    stopRecoveryRefresh();
    await stopRecoveryRealtime();
  } catch (error) {
    authError.value = error instanceof Error ? error.message : 'Unable to sign out';
  }
}

async function loadRecovery() {
  if (!session.value) return;
  isLoading.value = true;
  recoveryError.value = '';
  actionMessage.value = '';
  sessionSignal.value = '';
  try {
    const currentSession = session.value;
    const result = await fetchRecoveryForSession(currentSession.id);
    recovery.value = result;
    if (!hasSetInitialCategory) {
      activeCategory.value = result.category || 'code';
      hasSetInitialCategory = true;
    }
    sessionSignal.value = result.last_checkpoint_ago || 'No checkpoint yet';
    checkpointAt.value = result.last_checkpoint_at || null;
    const recoveredDraft = result.checkpoint_data?.draft ?? result.checkpoint_data?.content;
    if (!codeEditorDirty.value) codeSource.value = recoveredDraft ? String(recoveredDraft) : '';
    const recoveredFields = result.checkpoint_data?.fields;
    if (Array.isArray(recoveredFields) && recoveredFields.length > 0) {
      formFields.value = recoveredFields.map((field: { name?: string; value?: string }) => ({
        name: field.name || 'Field',
        value: field.value || '',
      }));
      formFieldsDirty.value = false;
    }
    actionMessage.value = result.last_checkpoint_at || result.last_checkpoint_ago
      ? 'Task recovered from the latest checkpoint.'
      : 'Task loaded, but no checkpoint has been captured yet.';
  } catch (error) {
    recovery.value = null;
    codeSource.value = '';
    recoveryError.value = error instanceof Error ? error.message : 'Unable to fetch recovery data';
  } finally {
    isLoading.value = false;
  }
}

async function loadSessionAndRecovery() {
  try {
    await stopRecoveryRealtime();
    hasSetInitialCategory = false;
    session.value = await getActiveRecoverySession();
    if (session.value) {
      await loadRecovery();
      startRecoveryRefresh();
      startRecoveryRealtime(session.value.id);
    } else {
      recovery.value = null;
      codeEditorDirty.value = false;
      sessionSignal.value = '';
      checkpointAt.value = null;
      recoveryError.value = '';
      stopRecoveryRefresh();
      stopRecoveryRealtime();
    }
  } catch (error) {
    recoveryError.value = error instanceof Error ? error.message : 'Unable to load recovery data';
  }
}

function startRecoveryRefresh() {
  stopRecoveryRefresh();
  refreshTimer = setInterval(() => {
    if (user.value && session.value) void loadRecovery();
  }, 5000);
}

function stopRecoveryRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

function startRecoveryRealtime(sessionId: string) {
  recoveryChannel = supabase
    .channel(`recovery-${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checkpoints', filter: `session_id=eq.${sessionId}` }, () => {
      void loadRecovery();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'screenshots', filter: `session_id=eq.${sessionId}` }, () => {
      void loadRecovery();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_edits', filter: `session_id=eq.${sessionId}` }, (payload) => {
      const edit = payload.new as { category?: string; applied?: boolean; error?: string | null };
      if (edit.category === 'form' && edit.applied === true) {
        if (formSyncTimeout) clearTimeout(formSyncTimeout);
        formSyncLoading.value = false;
        if (edit.error === null) {
          formSyncMessage.value = `Filled in ${recovery.value?.source || 'the form'}`;
        } else if (edit.error === 'no_tab_open') {
          formSyncMessage.value = "That page isn't open in any tab right now. Open it and try again.";
        } else if (edit.error === 'refill_failed') {
          formSyncMessage.value = "Found the page, but couldn't fill it in. Try refreshing that tab first.";
        } else {
          formSyncMessage.value = 'Something went wrong sending your answers. Try again.';
        }
      }
    })
    .subscribe();
}

async function stopRecoveryRealtime() {
  if (recoveryChannel) {
    await supabase.removeChannel(recoveryChannel);
    recoveryChannel = undefined;
  }
}

function navigateTo(route: string) {
  window.location.hash = route;
}

function reviewCategory(category: RecoveryCategory) {
  activeCategory.value = category;
  navigateTo(`/recover/${category}`);
}

async function recoverTask() {
  if (!recovery.value) await loadRecovery();
  if (recovery.value) reviewCategory(recovery.value.category || activeCategory.value);
}

function goToDashboard() {
  navigateTo('/dashboard');
}

function sendEmail() {
  actionMessage.value = 'Email draft is ready to send from the original mail account.';
}

function openOriginalSite() {
  window.open('https://example.com/', '_blank', 'noopener,noreferrer');
}

function exportAutosave() {
  const blob = new Blob(['Recovered autosave reference: ~/Documents/critical-handoff/notes.docx'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'recovered-autosave-reference.txt';
  anchor.click();
  URL.revokeObjectURL(url);
  actionMessage.value = 'Autosave reference exported.';
}

async function executeCode() {
  runLoading.value = true;
  runOutput.value = '';
  try {
    const result = await runPistonCode('javascript', codeSource.value);
    const stdout = result.run?.stdout || '';
    const stderr = result.run?.stderr || '';
    runOutput.value = stdout || stderr || 'No output returned';
  } catch (error) {
    runOutput.value = error instanceof Error ? error.message : 'Unable to run code';
  } finally {
    runLoading.value = false;
  }
}

function copyAnswer(value: string) {
  navigator.clipboard?.writeText(value).catch(() => {
    runOutput.value = 'Clipboard write was blocked by the browser.';
  });
}

function handleCodeChange(value: string) {
  codeEditorDirty.value = true;
  codeSource.value = value;
}

function scheduleCodeSync() {
  if (codeSyncTimer) clearTimeout(codeSyncTimer);
  codeSyncTimer = setTimeout(async () => {
    if (!session.value) return;
    codeSyncing.value = true;
    try {
      await pushPendingEdit(session.value.id, 'code', {
        file_path: recovery.value?.file_path ?? 'recovered.js',
        content: codeSource.value,
      });
    } catch (error) {
      recoveryError.value = error instanceof Error ? error.message : 'Unable to sync code edit';
    } finally {
      codeSyncing.value = false;
    }
  }, 800);
}

function scheduleFormSync() {
  if (formSyncTimer) clearTimeout(formSyncTimer);
  formSyncTimer = setTimeout(async () => {
    if (!session.value) return;
    formSyncing.value = true;
    try {
      await pushPendingEdit(session.value.id, 'form', {
        url: recovery.value?.checkpoint_data?.src,
        fields: formFields.value,
      });
    } catch (error) {
      recoveryError.value = error instanceof Error ? error.message : 'Unable to sync form edit';
    } finally {
      formSyncing.value = false;
    }
  }, 800);
}

async function fillFormNow() {
  if (!session.value) return;
  formSyncLoading.value = true;
  formSyncMessage.value = 'Sending your answers to the form…';
  try {
    await pushPendingEdit(session.value.id, 'form', {
      url: recovery.value?.checkpoint_data?.src,
      fields: formFields.value.map((item) => ({ name: item.name, value: item.value })),
    });
    if (formSyncTimeout) clearTimeout(formSyncTimeout);
    formSyncTimeout = setTimeout(() => {
      formSyncMessage.value = 'No response from the extension. Make sure it\'s installed and a session is active.';
      formSyncLoading.value = false;
    }, 20_000);
  } catch (error) {
    formSyncMessage.value = error instanceof Error ? error.message : 'Unable to send your answers to the form.';
    formSyncLoading.value = false;
  }
}

function downloadAttachment() {
  const anchor = document.createElement('a');
  anchor.href = attachmentUrl.value;
  anchor.download = 'recovered-attachment.pdf';
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.click();
}

function normalizeCategory(category: RecoveryCategory) {
  return {
    code: 'Code',
    email: 'Email',
    form: 'Form',
    doc_notion: 'Doc / Notion',
    terminal: 'Terminal',
    autosave: 'Autosave',
  }[category] ?? 'Unknown';
}

function handleHashChange() {
  currentRoute.value = window.location.hash || '#/dashboard';
  const routeCategory = currentRoute.value.match(/^#\/recover\/(code|form)$/)?.[1] as RecoveryCategory | undefined;
  if (routeCategory) activeCategory.value = routeCategory;
}

watch(codeSource, () => {
  if (codeEditorDirty.value) scheduleCodeSync();
});

watch(formFields, () => {
  if (formFieldsDirty.value && session.value) scheduleFormSync();
}, { deep: true });

onMounted(async () => {
  ageRefreshTimer = setInterval(() => {
    clock.value = Date.now();
  }, 1000);
  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();

  const { data } = supabase.auth.onAuthStateChange((_event, currentSession) => {
    if (!isAuthReady.value) return;
    user.value = currentSession?.user ?? null;
    if (currentSession?.user) {
      void loadSessionAndRecovery();
    } else {
      session.value = null;
      recovery.value = null;
      codeEditorDirty.value = false;
      recoveryError.value = '';
      stopRecoveryRefresh();
      void stopRecoveryRealtime();
    }
  });
  authSubscription = data.subscription;

  try {
    const currentSession = await getSupabaseSession();
    user.value = currentSession?.user ?? null;
    isAuthReady.value = true;
    if (currentSession?.user) {
      void loadSessionAndRecovery();
    }
  } catch (error) {
    authError.value = error instanceof Error ? error.message : 'Unable to restore your session';
    isAuthReady.value = true;
  }
});

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange);
  authSubscription?.unsubscribe();
  stopRecoveryRefresh();
  stopRecoveryRealtime();
  if (codeSyncTimer) clearTimeout(codeSyncTimer);
  if (formSyncTimer) clearTimeout(formSyncTimer);
  if (formSyncTimeout) clearTimeout(formSyncTimeout);
  if (ageRefreshTimer) clearInterval(ageRefreshTimer);
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Critical task recovery</p>
        <h1>RE-session</h1>
      </div>
      <div class="topbar-actions">
        <button v-if="user" class="secondary-button" @click="handleSignOut">Sign out</button>
      </div>
    </header>

    <main v-if="!isAuthReady" class="auth-panel">
      <div class="panel">
        <p>Checking your session...</p>
      </div>
    </main>

    <main v-else-if="!user" class="auth-panel">
      <div class="panel">
        <h2>Sign in to continue</h2>
        <label>
          Email
          <input v-model="authEmail" type="email" autocomplete="email" placeholder="you@example.com" />
        </label>
        <label>
          Password
          <input v-model="authPassword" type="password" autocomplete="current-password" placeholder="Your Supabase password" />
        </label>
        <button class="primary-button" :disabled="isAuthLoading" @click="handleSignIn">
          {{ isAuthLoading ? 'Signing in…' : 'Sign in' }}
        </button>
        <p v-if="authError" class="status-error">{{ authError }}</p>
      </div>
    </main>

    <section v-if="isAuthReady && !user" class="getting-started" aria-labelledby="getting-started-title">
      <p class="eyebrow">New here?</p>
      <h2 id="getting-started-title">Getting Started</h2>
      <ol>
        <li>Install the browser extension.</li>
        <li>Open the extension and sign in with your account.</li>
        <li>Click &quot;Start Critical Session,&quot; name your task, and pick a category.</li>
        <li>Work normally. Checkpoints save automatically in the background.</li>
        <li>If your laptop becomes unavailable, open this website on any other device and sign in to recover your task.</li>
      </ol>
    </section>

    <main v-if="isAuthReady && user" class="dashboard">
      <section class="panel recovery-header">
        <div>
          <p class="eyebrow">Task</p>
          <h2>{{ session?.task_name || 'No active recovery session' }}</h2>
        </div>
        <div class="readiness-card">
          <span class="readiness-label">Readiness</span>
          <strong :style="{ color: readinessColor }">{{ recovery?.readiness_score ?? 0 }}%</strong>
          <span class="readiness-band" :class="readinessBand">{{ readinessBand }}</span>
        </div>
      </section>

      <p v-if="recoveryError" class="status-error">{{ recoveryError }}</p>

      <section v-if="currentRoute === '#/dashboard'" class="panel summary-panel">
        <div class="summary-block">
          <p class="eyebrow">Category</p>
          <h3>{{ normalizeCategory(activeCategory) }}</h3>
        </div>
        <div class="summary-block">
          <p class="eyebrow">Application</p>
          <h3>{{ session?.application === 'vscode' ? 'VS Code / local code' : session?.application === 'other' ? 'Other desktop app' : 'Browser / web app' }}</h3>
        </div>
        <div class="summary-block">
          <p class="eyebrow">Last checkpoint</p>
          <h3>{{ sessionSignalDisplay }}</h3>
        </div>
        <div class="summary-block">
          <p class="eyebrow">Latest briefing</p>
          <h3>{{ recovery?.briefing_text || 'No briefing available yet.' }}</h3>
        </div>
      </section>

      <section v-if="currentRoute === '#/dashboard'" class="panel actions-panel">
        <div class="thumbnail-wrap">
          <img
            v-if="recovery?.latest_screenshot_url"
            :src="recovery.latest_screenshot_url"
            alt="Latest checkpoint screenshot"
          />
          <div v-else class="empty-thumb">No screenshot captured</div>
        </div>
        <div class="action-stack">
          <button class="primary-button" @click="recoverTask" :disabled="isLoading || !session">
            {{ isLoading ? 'Recovering…' : 'Recover this task' }}
          </button>
          <button class="secondary-button" @click="reviewCategory('code')">Review code</button>
          <button class="secondary-button" @click="reviewCategory('form')">Review form</button>
        </div>
      </section>

      <section class="panel view-panel">
        <div v-if="currentRoute !== '#/dashboard'" class="view-heading">
          <button class="secondary-button" @click="goToDashboard">Back to task</button>
        </div>
        <div v-if="activeCategory === 'code'" class="category-view">
          <span class="checkpoint-badge">{{ checkpointBadge }}</span>
          <h3>Code recovery</h3>
          <span class="sync-status" :class="{ syncing: codeSyncing }">{{ codeSyncing ? 'Syncing…' : 'Synced to your device' }}</span>
          <div v-if="codeSource" class="editor-shell">
            <CodeEditor :model-value="codeSource" @update:model-value="handleCodeChange" />
          </div>
          <div v-else class="empty-thumb">No code checkpoint captured yet</div>
          <div class="button-row">
            <button class="primary-button" @click="executeCode" :disabled="runLoading">
              {{ runLoading ? 'Running…' : 'Run' }}
            </button>
          </div>
          <pre class="output-box" v-if="runOutput">{{ runOutput }}</pre>
        </div>

        <div v-else-if="activeCategory === 'email'" class="category-view">
          <h3>Email recovery</h3>
          <div class="field-row">
            <label>To</label>
            <input value="team@criticalproject.example" />
          </div>
          <div class="field-row">
            <label>Subject</label>
            <input value="Prototype handoff update" />
          </div>
          <textarea v-model="emailDraft" rows="10"></textarea>
          <div class="button-row">
            <button class="primary-button" @click="sendEmail">Send</button>
            <button class="secondary-button" @click="downloadAttachment">Download recovered attachment</button>
          </div>
        </div>

        <div v-else-if="activeCategory === 'form'" class="category-view answer-sheet-view">
          <span class="checkpoint-badge">{{ checkpointBadge }}</span>
          <h3>Recovered form answer sheet</h3>
          <span class="sync-status" :class="{ syncing: formSyncing }">{{ formSyncing ? 'Syncing…' : 'Synced to your device' }}</span>
          <div v-for="item in formFields" :key="item.name" class="answer-row">
            <div>
              <span class="answer-label">{{ item.name }}</span>
              <input v-model="item.value" class="answer-value" @input="formFieldsDirty = true" />
            </div>
            <button class="copy-button" @click="copyAnswer(item.value)">Copy</button>
          </div>
          <button class="primary-button" :disabled="formSyncLoading" @click="fillFormNow">Fill form now</button>
          <p v-if="formSyncMessage" class="small-note">{{ formSyncMessage }}</p>
          <div class="button-row">
            <button class="secondary-button" @click="openOriginalSite">Open original site</button>
            <button class="secondary-button" @click="downloadAttachment">Download recovered file</button>
          </div>
        </div>

        <div v-else-if="activeCategory === 'doc_notion'" class="category-view">
          <h3>Document / Notion recovery</h3>
          <a href="https://www.notion.so/" target="_blank" rel="noopener">Open original document</a>
          <p>The source document was captured as a direct link. Only the original file link is restored here.</p>
        </div>

        <div v-else-if="activeCategory === 'terminal'" class="category-view">
          <h3>Terminal replay</h3>
          <ul class="terminal-list">
            <li><strong>12:14</strong> npm install</li>
            <li><strong>12:19</strong> npm run dev -- --host</li>
            <li><strong>12:23</strong> git add . && git commit -m "prototype checkpoint"</li>
          </ul>
          <p class="small-note">This is a read-only historical replay reference and is not a resumable process.</p>
        </div>

        <div v-else-if="activeCategory === 'autosave'" class="category-view">
          <h3>Local autosave</h3>
          <p>Last autosave captured 2 minutes ago. This file is treated as a freshness-limited reference and should be reopened in a generic editor if you choose to continue.</p>
          <div class="autosave-card">
            <strong>Path:</strong> ~/Documents/critical-handoff/notes.docx
          </div>
          <button class="secondary-button" @click="exportAutosave">Export back to original format</button>
        </div>
      </section>
      <p v-if="actionMessage" class="status-message">{{ actionMessage }}</p>
    </main>
  </div>
</template>
