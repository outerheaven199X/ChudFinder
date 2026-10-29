import type { AccountObservation, Post } from '../src/shared/schemas.ts';

export const T0 = '2026-10-29T15:00:00.000Z';

export function post(id: string, handle: string, text: string, createdAt: string | null = null, extra: Partial<Post> = {}): Post {
  return { id, handle, url: 'https://x.com/' + handle + '/status/' + id, text, createdAt, lang: 'en', links: [], quotedPostId: null,
    quotedHandle: null, replyToHandle: null, capturedFrom: 'x_page_dom', ...extra };
}

export function obs(handle: string, about: Partial<NonNullable<AccountObservation['about']>> | null, extra: Partial<AccountObservation> = {}): AccountObservation {
  return {
    handle, observedAt: T0, pageUrl: 'https://x.com/' + handle, adapterVersion: 'x-dom@test',
    about: about ? { basedIn: null, accurate: null, source: null, notFound: false, observedAt: T0, ...about } : null,
    profileLocation: null, posts: [], focusPostId: null, ...extra
  };
}

/** n posts whose UTC hours avoid [quietStart, quietStart+6). */
export function timedPosts(handle: string, n: number, quietStartUtc: number): Post[] {
  const out: Post[] = [];
  const active = [...Array(24).keys()].filter(h => ((h - quietStartUtc + 24) % 24) >= 6);
  for (let i = 0; i < n; i++) {
    const h = active[i % active.length];
    const d = new Date(Date.UTC(2026, 9, 1 + (i % 20), h, 7));
    out.push(post(String(1000 + i), handle, 'regular update number ' + i + ' about the project', d.toISOString()));
  }
  return out;
}
