/* Chud Finder - shared typed contracts + zod runtime schemas.
 * One evidence model for every capability: Origin X-Ray, VPN Detective, Narrative, Claims, Receipts.
 * Everything stored in chrome.storage.local or exported goes through these schemas.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const ENGINE_VERSION = 'deterministic@3.1.1';

const handle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
const iso = z.iso.datetime({ offset: true });
const iso2 = z.string().regex(/^[A-Z]{2}$/);
const httpsUrl = z
  .string()
  .max(2048)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'must be an https URL without credentials');

export const Coverage = z
  .object({
    provider: z.string().max(80),
    retrievedAt: iso,
    query: z.string().max(1000),
    start: iso.nullable(),
    end: iso.nullable(),
    recordsExamined: z.number().int().min(0),
    complete: z.boolean(),
    nextCursor: z.string().nullable(),
    fields: z.array(z.string()),
    limitations: z.array(z.string().max(600)),
    status: z.enum(['ok', 'unavailable', 'partial', 'cancelled', 'budget']),
  })
  .strict();
export type Coverage = z.infer<typeof Coverage>;
export const SourceDocument = z
  .object({
    url: httpsUrl,
    provider: z.string().max(80),
    retrievedAt: iso,
    publishedAt: iso.nullable(),
    title: z.string().max(300),
    text: z.string().max(100000),
    citations: z.array(httpsUrl).max(100),
    provenance: z.enum(['external_source', 'user_captured']),
    independenceReview: z
      .object({
        group: z.string().min(2).max(100),
        rationale: z.string().min(20).max(600),
        reviewedAt: iso,
        provenance: z.literal('user_captured'),
      })
      .strict()
      .optional(),
    // Explicit passage comparisons are scoped to the submitted claim, never inferred from nationality.
    comparisons: z
      .array(
        z
          .object({
            claim: z.string().max(1000),
            passage: z.string().max(4000),
            kind: z.enum(['factual', 'quote', 'organizational']),
            attribution: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    factChecks: z
      .array(
        z
          .object({
            claim: z.string().max(1000),
            rating: z.string().max(200),
            url: httpsUrl,
            date: iso.nullable(),
            publisher: z.string().max(200),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type SourceDocument = z.infer<typeof SourceDocument>;
export const MediaVerification = z
  .object({
    provider: z.enum(['LocalC2PA', 'UserEvidenceProvider']),
    checkedAt: iso,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.enum(['validated', 'invalid', 'absent', 'unverified']),
    binding: z.enum(['matched', 'mismatch', 'unverified']),
    trust: z.enum(['trusted', 'untrusted', 'unverified']),
    sdkState: z.string().max(80),
    codes: z.array(z.string().max(150)).max(100),
    issuer: z.string().max(200).nullable(),
    signedAt: iso.nullable(),
    limitations: z.array(z.string().max(600)).max(15),
  })
  .strict();
export type MediaVerification = z.infer<typeof MediaVerification>;
export const MediaInstance = z
  .object({
    sourceUrl: httpsUrl,
    imageUrl: httpsUrl.nullable(),
    title: z.string().max(300),
    publishedAt: iso.nullable(),
    dateBasis: z.enum(['repository_upload', 'unavailable', 'user_supplied']),
    match: z.enum([
      'exact_sha1',
      'full_image',
      'partial_image',
      'visually_similar',
      'user_supplied',
    ]),
    provider: z.string().max(80),
    retrievedAt: iso,
  })
  .strict();
export type MediaInstance = z.infer<typeof MediaInstance>;
export const MediaObservation = z
  .object({
    url: httpsUrl,
    observedAt: iso,
    publishedAt: iso.nullable(),
    claimedEventDate: iso.nullable(),
    hash: z.string().regex(/^[0-9a-f]{16}$/),
    frameSeconds: z.number().min(0).nullable(),
    metadata: z.record(z.string(), z.string().max(500)),
    provenance: z.literal('user_captured'),
    sha1: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    verification: MediaVerification.optional(),
    instances: z.array(MediaInstance).max(30).optional(),
  })
  .strict();
export type MediaObservation = z.infer<typeof MediaObservation>;
export const Strength = z
  .object({ bars: z.number().int().min(1).max(3), reasons: z.array(z.string()) })
  .strict();

/** Where a piece of evidence came from. The extension never claims a server fetched X data. */
export const SourceType = z.enum([
  'x_about_account', // X "About this account" (legacy display payload) read in the user's own logged-in session
  'x_profile', // self-reported profile fields seen in X's own page traffic
  'x_page_dom', // text/links/timestamps visible in the page the user is viewing
  'x_graphql', // posts seen in X's own timeline responses in the user's session
  'derived',
  'x_official',
  'user_evidence',
  'public_evidence',
]);
export type SourceType = z.infer<typeof SourceType>;

export const EvidenceKind = z.enum([
  'about_based_in',
  'about_location_accuracy',
  'about_connected_via',
  'about_unavailable',
  'profile_location',
  'post',
  'activity_pattern',
  'post_languages',
  'source_document',
  'media',
  'writing_pattern',
  'narrative_distribution',
  'propagation',
  'claim_verification',
  'source_dependency',
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const Evidence = z
  .object({
    id: z.string().regex(/^ev_[a-z0-9]+$/),
    kind: EvidenceKind,
    source: SourceType,
    subject: handle,
    summary: z.string().max(600),
    value: z.record(z.string(), z.unknown()),
    url: httpsUrl.optional(),
    observedAt: iso,
    firstSeenAt: iso,
    lastSeenAt: iso,
    derivedFrom: z.array(z.string()).optional(),
    provider: z.string().optional(),
    provenance: z
      .enum(['platform_reported', 'self_described', 'external_source', 'user_captured', 'derived'])
      .optional(),
    publishedAt: iso.optional(),
    coverage: z.array(Coverage).optional(),
    displayRole: z.string().optional(),
  })
  .strict();
export type Evidence = z.infer<typeof Evidence>;

export const Basis = z.enum(['reported', 'self-described', 'corroborated', 'inferred', 'unknown']);
export type Basis = z.infer<typeof Basis>;
export const Capability = z.enum(['origin', 'vpn', 'narrative', 'claims']);
export type Capability = z.infer<typeof Capability>;

export const Finding = z
  .object({
    id: z.string().regex(/^fd_[a-z0-9]+$/),
    capability: Capability,
    title: z.string().max(120),
    statement: z.string().max(600),
    basis: Basis,
    status: z.enum(['consistent', 'conflict', 'undetermined', 'info']),
    confidence: z.enum(['none', 'low', 'medium', 'high']),
    country: iso2.nullable(),
    evidenceIds: z.array(z.string()),
    caveats: z.array(z.string().max(300)),
    strength: Strength.optional(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

export const Post = z
  .object({
    id: z.string().regex(/^\d{1,25}$/),
    handle,
    url: httpsUrl,
    text: z.string().max(4000),
    createdAt: iso.nullable(),
    lang: z.string().max(12).nullable(),
    links: z.array(httpsUrl).max(20),
    quotedPostId: z
      .string()
      .regex(/^\d{1,25}$/)
      .nullable(),
    quotedHandle: handle.nullable(),
    replyToHandle: handle.nullable(),
    capturedFrom: z.enum([
      'x_page_dom',
      'x_graphql',
      'x_official',
      'user_evidence',
      'public_evidence',
    ]),
    repostOfId: z
      .string()
      .regex(/^\d{1,25}$/)
      .optional(),
    authorCreatedAt: iso.optional(),
    followers: z.number().int().min(0).optional(),
    repostCount: z.number().int().min(0).optional(),
  })
  .strict();
export type Post = z.infer<typeof Post>;

/** A claim candidate: an observed statement, never auto-verified by the extension. */
export const Claim = z
  .object({
    id: z.string().regex(/^cl_[a-z0-9]+$/),
    postId: z.string(),
    text: z.string().max(1000),
    status: z.enum([
      'supported',
      'contradicted',
      'misleading_context',
      'mixed_evidence',
      'unverified',
      'not_factual',
    ]),
    evidenceIds: z.array(z.string()).min(1),
    explanation: z.string().optional(),
  })
  .strict();
export type Claim = z.infer<typeof Claim>;

export const RelationshipEdge = z
  .object({
    id: z.string().regex(/^ed_[a-z0-9]+$/),
    type: z.enum([
      'quotes',
      'replies_to',
      'links_to',
      'reposts',
      'exact_duplicate',
      'near_duplicate',
      'shares_url',
      'references_claim',
      'authored',
      'cites',
    ]),
    from: z.string().max(300),
    to: z.string().max(2048),
    evidenceIds: z.array(z.string()).min(1),
  })
  .strict();
export type RelationshipEdge = z.infer<typeof RelationshipEdge>;

export const AboutObservation = z
  .object({
    basedIn: z.string().max(80).nullable(),
    accurate: z.boolean().nullable(),
    source: z.string().max(80).nullable(),
    notFound: z.boolean(),
    observedAt: iso,
    sourceUrl: httpsUrl.optional(),
    displayText: z.string().max(600).optional(),
    provenance: z.enum(['platform_reported', 'user_captured']).optional(),
  })
  .strict();
export type AboutObservation = z.infer<typeof AboutObservation>;

/** What the content script submits from the user's own X session. */
export const AccountObservation = z
  .object({
    handle,
    observedAt: iso,
    pageUrl: httpsUrl,
    adapterVersion: z.string().max(40),
    about: AboutObservation.nullable(),
    profileLocation: z
      .object({ text: z.string().max(120), observedAt: iso })
      .strict()
      .nullable(),
    posts: z.array(Post).max(100),
    focusPostId: z
      .string()
      .regex(/^\d{1,25}$/)
      .nullable(),
    provider: z.string().optional(),
    coverage: z.array(Coverage).max(30).optional(),
    sources: z.array(SourceDocument).max(20).optional(),
    media: z.array(MediaObservation).max(50).optional(),
    searchText: z.string().max(1000).optional(),
    correction: z.string().max(600).optional(),
    telemetry: z
      .object({
        requests: z.number(),
        posts: z.number(),
        profiles: z.number(),
        tokens: z.number().nullable(),
        cost: z.number().nullable(),
        cacheHits: z.number(),
        failures: z.number(),
        status: z.string(),
      })
      .optional(),
  })
  .strict();
export type AccountObservation = z.infer<typeof AccountObservation>;

export const Account = z
  .object({
    handle,
    basedIn: z.string().nullable(),
    basedInCountry: iso2.nullable(),
    basedInIsRegion: z.boolean(),
    locationAccurate: z.boolean().nullable(),
    connectedVia: z.string().nullable(),
    profileLocation: z.string().nullable(),
    aboutObservedAt: iso.nullable(),
  })
  .strict();
export type Account = z.infer<typeof Account>;

export const InvestigationEvent = z
  .object({
    at: iso,
    type: z.enum([
      'created',
      'observed',
      'evidence_added',
      'analyzed',
      'validation_failed',
      'exported',
      'refreshed',
    ]),
    version: z.number().int().min(1),
    detail: z.string().max(300),
  })
  .strict();
export type InvestigationEvent = z.infer<typeof InvestigationEvent>;

export const Snapshot = z
  .object({
    version: z.number().int().min(1),
    createdAt: iso,
    engine: z.string(),
    adapterVersion: z.string(),
    account: Account,
    evidenceIds: z.array(z.string()),
    findings: z.array(Finding),
    claims: z.array(Claim),
    edges: z.array(RelationshipEdge),
    posts: z.array(Post),
    focusPostId: z.string().nullable(),
    headline: z.string().max(200),
    coverage: z.array(Coverage).optional(),
    story: z
      .array(
        z
          .object({
            title: z.string(),
            text: z.string(),
            evidenceIds: z.array(z.string()),
            findingIds: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    displayRoles: z.record(z.string(), z.array(z.string())).optional(),
    telemetry: AccountObservation.shape.telemetry,
    correction: z
      .object({ previousVersion: z.number().int().nullable(), reason: z.string() })
      .optional(),
  })
  .strict();
export type Snapshot = z.infer<typeof Snapshot>;

export const Investigation = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().regex(/^inv_[a-z0-9]+$/),
    subject: z.object({ type: z.literal('account'), handle }).strict(),
    createdAt: iso,
    updatedAt: iso,
    currentVersion: z.number().int().min(1),
    evidence: z.array(Evidence), // append-only across versions (evidence history)
    snapshots: z.array(Snapshot).min(1),
    events: z.array(InvestigationEvent),
  })
  .strict();
export type Investigation = z.infer<typeof Investigation>;

export const Export = z
  .object({
    exportVersion: z.literal(1),
    generatedAt: iso,
    generator: z.string(),
    investigationId: z.string(),
    version: z.number().int(),
    subject: z.object({ type: z.literal('account'), handle }).strict(),
    account: Account,
    headline: z.string(),
    findings: z.array(Finding),
    evidence: z.array(Evidence),
    limitations: z.array(z.string()),
    snapshot: Snapshot.optional(),
    correction: Snapshot.shape.correction,
    previousVersions: z.array(z.number().int()).optional(),
  })
  .strict();
export type Export = z.infer<typeof Export>;
