const SUPABASE_AUTH_STORAGE_KEY = 're_session_auth';

const chromeStorageAdapter = {
  async getItem(key) {
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

function createSupabaseClient(config) {
  async function request(path, options = {}) {
    const session = options.skipAuth ? null : await getSession();
    const headers = {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...options.headers,
    };
    const { skipAuth: _skipAuth, ...requestOptions } = options;
    const response = await fetch(`${config.url}${path}`, { ...requestOptions, headers });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      throw new Error(data?.error_description || data?.message || data?.msg || `Supabase request failed with ${response.status}`);
    }
    return { data, response };
  }

  async function getSession() {
    const stored = await chromeStorageAdapter.getItem(SUPABASE_AUTH_STORAGE_KEY);
    return stored || null;
  }

  return {
    auth: {
      async getSession() {
        return { data: { session: await getSession() } };
      },
      async signInWithPassword({ email, password }) {
        const { data } = await request('/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
          skipAuth: true,
        });
        await chromeStorageAdapter.setItem(SUPABASE_AUTH_STORAGE_KEY, data);
        const persistedSession = await getSession();
        if (persistedSession?.access_token !== data.access_token) {
          throw new Error('Supabase session could not be persisted in extension storage.');
        }
        return { data: { session: persistedSession, user: persistedSession.user } };
      },
      async signOut() {
        const session = await getSession();
        if (session?.access_token) {
          try {
            await request('/auth/v1/logout', { method: 'POST' });
          } catch (error) {
            console.warn('RE-session: Supabase sign-out request failed', error);
          }
        }
        await chromeStorageAdapter.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      },
    },
    from(table) {
      return {
        async select(columns = '*', filter = '') {
          const query = new URLSearchParams({ select: columns });
          if (filter) {
            for (const part of filter.split('&')) {
              const [key, value] = part.split('=');
              if (key && value !== undefined) query.set(key, value);
            }
          }
          return request(`/rest/v1/${table}?${query.toString()}`, { method: 'GET' });
        },
        async insert(row) {
          return request(`/rest/v1/${table}`, {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(row),
          });
        },
        async update(row, filter) {
          return request(`/rest/v1/${table}?${filter}`, {
            method: 'PATCH',
            body: JSON.stringify(row),
          });
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, body, contentType) {
            const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
            return request(`/storage/v1/object/${bucket}/${encodedPath}`, {
              method: 'POST',
              headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
              body,
            });
          },
        };
      },
    },
  };
}
