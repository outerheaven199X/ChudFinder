/* Chud Finder - shared typed contracts + zod runtime schemas.
 * One evidence model for every capability: Origin X-Ray, VPN Detective, Narrative, Claims, Receipts.
 * Everything stored in chrome.storage.local or exported goes through these schemas.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const ENGINE_VERSION = 'deterministic@2.0.0';

const handle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
const iso = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'must be an ISO date');
const iso2 = z.string().regex(/^[A-Z]{2}$/);
const httpsUrl = z.string().max(2048).refine(s => { try { return new URL(s).protocol === 'https:'; } catch { return false; } }, 'must be an https URL');

/** Where a piece of evidence came from. The extension never claims a server fetched X data. */
export const SourceType = z.enum([
  'x_about_account', // X "About this account" (AboutAccountQuery) read in the user's own logged-in session
  'x_profile',       // self-reported profile fields seen in X's own page traffic
  'x_page_dom',      // text/links/timestamps visible in the page the user is viewing
  'x_graphql',       // posts seen in X's own timeline responses in the user's session
  'derived'          // computed by Chud Finder from other evidence (inputs listed in derivedFrom)
]);
export type SourceType = z.infer<typeof SourceType>;

export const EvidenceKind = z.enum([
  'about_based_in', 'about_location_accuracy', 'about_connected_via', 'about_unavailable',
  'profile_location', 'post', 'activity_pattern', 'post_languages'
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const Evidence = z.object({
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
  derivedFrom: z.array(z.string()).optional()
}).strict();
export type Evidence = z.infer<typeof Evidence>;

export const Basis = z.enum(['reported', 'self-described', 'corroborated', 'inferred', 'unknown']);
export type Basis = z.infer<typeof Basis>;
export const Capability = z.enum(['origin', 'vpn', 'narrative', 'claims']);
export type Capability = z.infer<typeof Capability>;

export const Finding = z.object({
  id: z.string().regex(/^fd_[a-z0-9]+$/),
  capability: Capability,
  title: z.string().max(120),
  statement: z.string().max(600),
  basis: Basis,
  status: z.enum(['consistent', 'conflict', 'undetermined', 'info']),
  confidence: z.enum(['none', 'low', 'medium', 'high']),
  country: iso2.nullable(),
  evidenceIds: z.array(z.string()),
  caveats: z.array(z.string().max(300))
}).strict();
export type Finding = z.infer<typeof Finding>;

export const Post = z.object({
  id: z.string().regex(/^\d{1,25}$/),
  handle,
  url: httpsUrl,
  text: z.string().max(4000),
  createdAt: iso.nullable(),
  lang: z.string().max(12).nullable(),
  links: z.array(httpsUrl).max(20),
  quotedPostId: z.string().regex(/^\d{1,25}$/).nullable(),
  quotedHandle: handle.nullable(),
  replyToHandle: handle.nullable(),
  capturedFrom: z.enum(['x_page_dom', 'x_graphql'])
}).strict();
export type Post = z.infer<typeof Post>;

/** A claim candidate: an observed statement, never auto-verified by the extension. */
export const Claim = z.object({
  id: z.string().regex(/^cl_[a-z0-9]+$/),
  postId: z.string(),
  text: z.string().max(1000),
  status: z.literal('unverified'),
  evidenceIds: z.array(z.string()).min(1)
}).strict();
export type Claim = z.infer<typeof Claim>;

export const RelationshipEdge = z.object({
  id: z.string().regex(/^ed_[a-z0-9]+$/),
  type: z.enum(['quotes', 'replies_to', 'links_to']),
  from: z.string().max(300),
  to: z.string().max(2048),
  evidenceIds: z.array(z.string()).min(1)
}).strict();
export type RelationshipEdge = z.infer<typeof RelationshipEdge>;

export const AboutObservation = z.object({
  basedIn: z.string().max(80).nullable(),
  accurate: z.boolean().nullable(),
  source: z.string().max(80).nullable(),
  notFound: z.boolean(),
  observedAt: iso
}).strict();
export type AboutObservation = z.infer<typeof AboutObservation>;

/** What the content script submits from the user's own X session. */
export const AccountObservation = z.object({
  handle,
  observedAt: iso,
  pageUrl: httpsUrl,
  adapterVersion: z.string().max(40),
  about: AboutObservation.nullable(),
  profileLocation: z.object({ text: z.string().max(120), observedAt: iso }).strict().nullable(),
  posts: z.array(Post).max(100),
  focusPostId: z.string().regex(/^\d{1,25}$/).nullable()
}).strict();
export type AccountObservation = z.infer<typeof AccountObservation>;

export const Account = z.object({
  handle,
  basedIn: z.string().nullable(),
  basedInCountry: iso2.nullable(),
  basedInIsRegion: z.boolean(),
  locationAccurate: z.boolean().nullable(),
  connectedVia: z.string().nullable(),
  profileLocation: z.string().nullable(),
  aboutObservedAt: iso.nullable()
}).strict();
export type Account = z.infer<typeof Account>;

export const InvestigationEvent = z.object({
  at: iso,
  type: z.enum(['created', 'observed', 'evidence_added', 'analyzed', 'validation_failed', 'exported', 'refreshed']),
  version: z.number().int().min(1),
  detail: z.string().max(300)
}).strict();
export type InvestigationEvent = z.infer<typeof InvestigationEvent>;

export const Snapshot = z.object({
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
  headline: z.string().max(200)
}).strict();
export type Snapshot = z.infer<typeof Snapshot>;

export const Investigation = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^inv_[a-z0-9]+$/),
  subject: z.object({ type: z.literal('account'), handle }).strict(),
  createdAt: iso,
  updatedAt: iso,
  currentVersion: z.number().int().min(1),
  evidence: z.array(Evidence),       // append-only across versions (evidence history)
  snapshots: z.array(Snapshot).min(1),
  events: z.array(InvestigationEvent)
}).strict();
export type Investigation = z.infer<typeof Investigation>;

export const Export = z.object({
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
  limitations: z.array(z.string())
}).strict();
export type Export = z.infer<typeof Export>;
