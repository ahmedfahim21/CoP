import type {
  CreatedProfileResponse, LeaderboardResponse, OwnProfileResponse, ProfileResponse, ProfileUpdate,
} from '@cop/shared';
import { SERVER_URL } from './config.js';

/** An HTTP error from the game server; `status` 0 means it couldn't be reached at all. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; credential?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.credential) headers.Authorization = `Bearer ${init.credential}`;
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api${path}`, {
      method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new ApiError(0, `Can't reach the game server (${err instanceof Error ? err.message : String(err)})`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Server answered ${res.status}`);
  return data as T;
}

export const api = {
  createProfile: (name: string) => request<CreatedProfileResponse>('/profiles', { method: 'POST', body: { name } }),
  me: (credential: string) => request<OwnProfileResponse>('/profiles/me', { credential }),
  updateMe: (credential: string, update: ProfileUpdate) => request<OwnProfileResponse>('/profiles/me', { method: 'PATCH', body: update, credential }),
  profile: (id: string) => request<ProfileResponse>(`/profiles/${encodeURIComponent(id)}`),
  leaderboard: (limit = 50, offset = 0) => request<LeaderboardResponse>(`/leaderboard?limit=${limit}&offset=${offset}`),
};
