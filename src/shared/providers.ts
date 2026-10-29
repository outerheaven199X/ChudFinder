/* Single acquisition boundary. Network credentials live only in the local adapter service. */
import { z } from 'zod';
import { AccountObservation, Coverage, Post, SourceDocument, MediaInstance } from './schemas.ts';

export interface ProviderCapabilities {
  account: boolean;
  posts: boolean;
  search: boolean;
  historicalSearch: boolean;
  aboutFields: boolean;
  sources: boolean;
  mediaSearch: boolean;
  communityNotes: boolean;
  enrichment: boolean;
  limitations: string[];
}
export interface PostQuery {
  handle?: string;
  text?: string;
  start?: string;
  end?: string;
  cursor?: string;
  limit?: number;
}
export interface ClaimQuery {
  text: string;
  urls?: string[];
}
export const AccountResult = z
  .object({ observation: AccountObservation.nullable(), coverage: Coverage })
  .strict();
export const PostResult = z.object({ posts: z.array(Post).max(100), coverage: Coverage }).strict();
export const SourceResult = z
  .object({ sources: z.array(SourceDocument).max(20), coverage: Coverage })
  .strict();
export type AccountEvidence = z.infer<typeof AccountResult>;
export type PostResult = z.infer<typeof PostResult>;
export type SourceResult = z.infer<typeof SourceResult>;
export const MediaSearchResult = z
  .object({ instances: z.array(MediaInstance).max(30), coverage: Coverage })
  .strict();
export interface EvidenceProvider {
  id: string;
  getAccount(handle: string): Promise<AccountEvidence>;
  getPosts(query: PostQuery): Promise<PostResult>;
  getPost(id: string): Promise<PostResult>;
  searchClaims(query: ClaimQuery): Promise<SourceResult>;
  capabilities(): ProviderCapabilities;
}
export type Transport = (operation: string, payload: unknown) => Promise<unknown>;
export function coverage(
  provider: string,
  query: string,
  count = 0,
  limitations: string[] = [],
  status: Coverage['status'] = 'ok',
): Coverage {
  return {
    provider,
    retrievedAt: new Date().toISOString(),
    query,
    start: null,
    end: null,
    recordsExamined: count,
    complete: false,
    nextCursor: null,
    fields: [],
    limitations,
    status,
  };
}
const NONE: ProviderCapabilities = {
  account: false,
  posts: false,
  search: false,
  historicalSearch: false,
  aboutFields: false,
  sources: false,
  mediaSearch: false,
  communityNotes: false,
  enrichment: false,
  limitations: [],
};
export class XOfficialProvider implements EvidenceProvider {
  id = 'XOfficialProvider';
  private send: Transport;
  private available: boolean;
  constructor(send: Transport, available = true) {
    this.send = send;
    this.available = available;
  }
  capabilities() {
    return {
      ...NONE,
      account: this.available,
      posts: this.available,
      search: this.available,
      limitations: [
        'Recent search is bounded by provider access and retention. About fields and full archive are not exposed by this adapter.',
      ],
    };
  }
  async getAccount(handle: string) {
    return AccountResult.parse(await this.send('account', { handle }));
  }
  async getPosts(query: PostQuery) {
    return PostResult.parse(await this.send('posts', query));
  }
  async getPost(id: string) {
    return PostResult.parse(await this.send('post', { id }));
  }
  async searchClaims(query: ClaimQuery) {
    return SourceResult.parse({
      sources: [],
      coverage: coverage(
        this.id,
        query.text,
        0,
        ['Use PublicEvidenceProvider for external records.'],
        'unavailable',
      ),
    });
  }
}
export class PublicEvidenceProvider implements EvidenceProvider {
  id = 'PublicEvidenceProvider';
  private send: Transport;
  constructor(send: Transport) {
    this.send = send;
  }
  capabilities() {
    return {
      ...NONE,
      sources: true,
      search: true,
      mediaSearch: true,
      limitations: [
        'Public document search uses Wikipedia; media search supports Commons exact files and separately configured Google Vision. Retrieved records are evidence, not automatic truth determinations.',
      ],
    };
  }
  async getAccount(handle: string) {
    return {
      observation: null,
      coverage: coverage(this.id, handle, 0, ['Account metadata unavailable.'], 'unavailable'),
    };
  }
  async getPosts(q: PostQuery) {
    return {
      posts: [],
      coverage: coverage(
        this.id,
        JSON.stringify(q),
        0,
        ['Public-post search requires XOfficialProvider.'],
        'unavailable',
      ),
    };
  }
  async getPost(id: string) {
    return this.getPosts({ text: id });
  }
  async searchClaims(query: ClaimQuery) {
    return SourceResult.parse(await this.send('sources', query));
  }
  async searchMedia(query: { sha1?: string; imageUrl?: string; provider: 'commons' | 'google' }) {
    return MediaSearchResult.parse(await this.send('media-search', query));
  }
}
export class UserEvidenceProvider implements EvidenceProvider {
  id = 'UserEvidenceProvider';
  observation: AccountObservation;
  constructor(raw: unknown) {
    const o = AccountObservation.parse(raw);
    this.observation = AccountObservation.parse({
      ...o,
      provider: this.id,
      about: o.about ? { ...o.about, provenance: 'user_captured' } : null,
      posts: o.posts.map((p) => ({ ...p, capturedFrom: 'user_evidence' })),
      sources: o.sources?.map((s) => ({ ...s, provider: this.id, provenance: 'user_captured' })),
      media: o.media?.map((m) => ({
        ...m,
        verification: m.verification
          ? {
              ...m.verification,
              provider: 'UserEvidenceProvider',
              signature: 'unverified',
              binding: 'unverified',
              trust: 'unverified',
              limitations: ['Imported result; local signature validation has not run.'],
            }
          : undefined,
        instances: m.instances?.map((i) => ({
          ...i,
          provider: 'UserEvidenceProvider',
          match: 'user_supplied',
          dateBasis: 'user_supplied',
        })),
      })),
    });
  }
  capabilities() {
    return {
      ...NONE,
      account: true,
      posts: true,
      aboutFields: true,
      sources: true,
      limitations: ['User-provided observations are not independently API-verified.'],
    };
  }
  async getAccount(handle: string) {
    if (handle.toLowerCase() !== this.observation.handle.toLowerCase())
      throw new Error('User evidence subject mismatch');
    return {
      observation: this.observation,
      coverage: coverage(this.id, handle, this.observation.posts.length, [
        'USER-CAPTURED: explicitly supplied or selected records only.',
      ]),
    };
  }
  async getPosts(query: PostQuery) {
    const posts = this.observation.posts.filter(
      (p) => !query.handle || p.handle.toLowerCase() === query.handle.toLowerCase(),
    );
    return {
      posts,
      coverage: coverage(this.id, JSON.stringify(query), posts.length, [
        'No network search performed.',
      ]),
    };
  }
  async getPost(id: string) {
    const posts = this.observation.posts.filter((p) => p.id === id);
    return { posts, coverage: coverage(this.id, id, posts.length, ['User-supplied sample.']) };
  }
  async searchClaims(query: ClaimQuery) {
    const sources = this.observation.sources || [];
    return {
      sources,
      coverage: coverage(this.id, query.text, sources.length, ['No external search performed.']),
    };
  }
}
export class OptionalGrokProvider extends PublicEvidenceProvider {
  override id = 'OptionalGrokProvider';
  private enrichTransport: Transport;
  constructor(send: Transport) {
    super(send);
    this.enrichTransport = send;
  }
  override capabilities() {
    return {
      ...NONE,
      enrichment: true,
      limitations: [
        'Opt-in questions and source suggestions only. Suggestions never become evidence automatically.',
      ],
    };
  }
  override async searchClaims(query: ClaimQuery) {
    return {
      sources: [],
      coverage: coverage(
        this.id,
        query.text,
        0,
        [
          'Enrichment suggests questions only; use the public source provider to retrieve evidence.',
        ],
        'unavailable',
      ),
    };
  }
  async enrich(evidence: { id: string; summary: string }[]) {
    const result = z
      .object({
        suggestions: z
          .array(
            z.object({ question: z.string().max(500), evidenceIds: z.array(z.string()) }).strict(),
          )
          .max(10),
        tokens: z.number().nullable(),
      })
      .strict()
      .parse(await this.enrichTransport('enrich', { evidence }));
    const ids = new Set(evidence.map((e) => e.id));
    return {
      ...result,
      suggestions: result.suggestions.filter(
        (s) => s.evidenceIds.length > 0 && s.evidenceIds.every((id) => ids.has(id)),
      ),
    };
  }
}
