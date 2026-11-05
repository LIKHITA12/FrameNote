// "url" is any other public video link (Vimeo, Loom, a direct .mp4, ...) ingested via
// POST /videos/from-url; YouTube links keep "youtube" so the embedded player still works.
export type SourceType = "upload" | "youtube" | "url";
export type SentimentLabel = "Positive" | "Neutral" | "Negative";

export interface JobCreateRequest {
  source_type: SourceType;
  source_url?: string;
  file_name?: string;
  upload_object_key?: string;
  transcript_object_key?: string;
  transcript_file_name?: string;
}

export interface PublicVideoUrlRequest {
  url: string;
  detailed?: boolean;
}

export interface PublicVideoPreviewResponse {
  url: string;
  provider: string;
  title?: string | null;
  duration_seconds?: number | null;
  is_youtube: boolean;
  youtube_video_id?: string | null;
}

export interface UploadPresignRequest {
  file_name: string;
  content_type: string;
  file_size: number;
}

export interface UploadPresignResponse {
  object_key: string;
  upload_url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  fields: Record<string, string>;
  expires_in_seconds: number;
}

export interface KeyPoint {
  title: string;
  description: string;
  timestamp_seconds: number;
  frame_image_url?: string | null;
}

export interface DetailedKeyMoment {
  title: string;
  start_seconds: number;
  end_seconds: number;
  frame_timestamp_seconds: number;
  bullets: string[];
  frame_image_url?: string | null;
}

export interface DetailedKeyMomentsResponse {
  job_id: string;
  total: number;
  items: DetailedKeyMoment[];
}

export interface VideoChatCitation {
  timestamp_seconds: number;
  label: string;
  excerpt: string;
}

export interface VideoChatContext {
  context_id: string;
  label: string;
  selected_text?: string | null;
}

export interface VideoChatMessage {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  citations: VideoChatCitation[];
  contexts: VideoChatContext[];
  created_at: string;
}

export interface VideoChatUsage {
  used_this_month: number;
  monthly_limit: number;
  remaining_this_month: number;
  used_for_video: number;
  per_video_limit?: number | null;
}

export interface VideoChatHistoryResponse {
  job_id: string;
  messages: VideoChatMessage[];
  usage: VideoChatUsage;
  ai_configured: boolean;
}

export interface VideoChatAnswerResponse {
  user_message: VideoChatMessage;
  assistant_message: VideoChatMessage;
  usage: VideoChatUsage;
}

export interface TimelineSection {
  title: string;
  start_seconds: number;
  end_seconds: number;
  bullets: string[];
}

export interface QAItem {
  time_seconds: number;
  asked_by: string;
  question: string;
  answer: string;
}

export interface GlossaryTerm {
  term: string;
  meaning: string;
}

export interface ParticipantsInfo {
  names: string[];
  count: number;
  source: string;
}

export interface SpeakerAirtime {
  speaker: string;
  seconds: number;
  percent: number;
  turns?: number;
  turn_start_seconds?: number[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface JobAnalysis {
  overview: string;
  headlines: string[];
  timeline: TimelineSection[];
  questions_and_answers: QAItem[];
  decisions: string[];
  action_items: string[];
  action_item_details?: Array<{ title: string; owner?: string | null; due?: string | null; priority?: "high" | "medium" | "low" | null }>;
  terms: GlossaryTerm[];
  participants: ParticipantsInfo;
  duration_seconds?: number | null;
}

export interface StageEvent {
  stage?: number | null;
  message: string;
  at: string;
}

export interface JobCreateResponse {
  job_id: string;
  project_id?: string | null;
  project_name?: string | null;
  is_owner?: boolean;
  status: "queued" | "processing" | "completed" | "failed";
  processing_stage: number;
  source_type: SourceType;
  source_url?: string | null;
  file_name?: string | null;
  summary: string;
  key_points: KeyPoint[];
  tags?: string[];
  sentiment?: SentimentLabel;
  analysis?: JobAnalysis | null;
  custom_action_items?: string[];
  completed_action_items?: number[];
  stage_events?: StageEvent[];
  created_at: string;
  youtube_video_id?: string | null;
  youtube_embed_url?: string | null;
  video_url?: string | null;
  transcript_text?: string | null;
  transcription_model?: string | null;
  summary_model?: string | null;
  transcript_source?: "generated" | "user_provided";
  speaker_airtime?: SpeakerAirtime[];
  transcript_segments?: TranscriptSegment[];
  error_message?: string | null;
  pdf_url?: string | null;
  duration_seconds?: number | null;
  insights_count?: number;
}

export interface UserProfileResponse {
  user_id: string;
  email: string;
  full_name?: string | null;
  tier: string;
  subscription_status: string;
}

export interface BillingCheckoutResponse {
  checkout_url: string;
}

export interface PdfGenerateResponse {
  pdf_url: string;
}

// ---------------------------------------------------------------------------
// Analysis History (/workspace/history)
// ---------------------------------------------------------------------------

export type HistorySort = "newest" | "oldest" | "title" | "longest";
export type HistoryDateRange = "all" | "7d" | "30d" | "custom";
export type HistorySource = "youtube" | "url" | "upload" | "zoom";

export interface TagCount {
  tag: string;
  count: number;
}

export interface HistoryFacets {
  popular_tags: TagCount[];
  source_counts: Record<string, number>;
  total_library: number;
}

export interface HistoryListResponse {
  items: JobCreateResponse[];
  total: number;
  has_more: boolean;
  facets: HistoryFacets;
}

export interface HistoryQuery {
  projectId?: string;
  search?: string;
  sources?: HistorySource[];
  tags?: string[];
  dateRange?: HistoryDateRange;
  dateFrom?: string;
  dateTo?: string;
  sort?: HistorySort;
  limit?: number;
  offset?: number;
}

export interface Project {
  project_id: string;
  name: string;
  job_count: number;
}

export interface JobCollaborator {
  user_id: string;
  email: string;
  role: "viewer";
}

export interface JobNotesUpdateRequest {
  summary?: string;
  decisions?: string[];
  action_items?: string[];
}

export interface JobClip {
  clip_id: string;
  job_id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  created_at: string;
}

export interface JobClipRequest {
  title: string;
  start_seconds: number;
  end_seconds: number;
}

// ---------------------------------------------------------------------------
// Settings (/workspace/settings)
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  description?: string | null;
  badge?: string | null;
}

export interface IntegrationState {
  id: string;
  name: string;
  icon: string;
  description: string;
  badge?: string | null;
  kind: string;
  enabled: boolean;
}

export interface UserSettingsResponse {
  user_id: string;
  email: string;
  full_name?: string | null;
  role_title?: string | null;
  timezone: string;
  avatar_url?: string | null;
  email_verified: boolean;
  password_changed_at?: string | null;
  transcription_language: string;
  transcription_backend: string;
  reasoning_llm: string;
  summary_format: string;
  smart_diarization: boolean;
  glossary_terms: string[];
  notify_on_ready: boolean;
  weekly_digest: boolean;
  integrations: IntegrationState[];
  language_options: SelectOption[];
  timezone_options: SelectOption[];
  transcription_backend_options: SelectOption[];
  reasoning_llm_options: SelectOption[];
  summary_format_options: SelectOption[];
}

export interface UserSettingsUpdateRequest {
  full_name?: string | null;
  role_title?: string | null;
  timezone?: string;
  avatar_url?: string | null;
  transcription_language?: string;
  transcription_backend?: string;
  reasoning_llm?: string;
  summary_format?: string;
  smart_diarization?: boolean;
  glossary_terms?: string[];
  notify_on_ready?: boolean;
  weekly_digest?: boolean;
  integrations?: Record<string, boolean>;
}

export interface UsageMeter {
  used: number;
  limit?: number | null;
  unit: string;
  percent: number;
}

export interface UsageSummaryResponse {
  tier: string;
  plan_label: string;
  plan_price_monthly?: number | null;
  subscription_status: string;
  transcription_hours: UsageMeter;
  storage_gb: UsageMeter;
  videos_processed: number;
  insights_extracted: number;
  avg_turn_ratio: number;
  resets_in_days: number;
  renews_on?: string | null;
}

// ---------------------------------------------------------------------------
// Pricing & Plans (/upgrade)
// ---------------------------------------------------------------------------

export type BillingCycle = "monthly" | "annual";
export type PlanCtaAction = "current" | "checkout" | "contact" | "downgrade";

export interface PlanFeature {
  emphasis?: string | null;
  text: string;
}

export interface PricingPlan {
  id: string;
  tier: string;
  name: string;
  icon: string;
  tagline: string;
  price_monthly?: number | null;
  price_annual_monthly?: number | null;
  price_annual_total?: number | null;
  custom_price_label?: string | null;
  price_note?: string | null;
  features_heading: string;
  features: PlanFeature[];
  cta_label: string;
  cta_action: PlanCtaAction;
  most_popular: boolean;
  is_current: boolean;
}

export interface ComparisonCell {
  kind: "text" | "check" | "none";
  value?: string | null;
  highlight: boolean;
}

export interface ComparisonRow {
  label: string;
  cells: ComparisonCell[];
}

export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

export interface SecurityBadge {
  icon: string;
  title: string;
  subtitle: string;
}

export interface TrustPanel {
  eyebrow: string;
  headline: string;
  detail: string;
  badges: SecurityBadge[];
  social_proof: string;
  rating: string;
  speed: string;
}

export interface PlanFaq {
  question: string;
  answer: string;
}

export interface PricingCatalogResponse {
  current_tier: string;
  annual_discount_percent: number;
  plans: PricingPlan[];
  comparison_columns: string[];
  comparison: ComparisonGroup[];
  trust: TrustPanel;
  faqs: PlanFaq[];
}

// ---------------------------------------------------------------------------
// Contact / support (/workspace/contact)
// ---------------------------------------------------------------------------

export interface SupportTopic {
  value: string;
  label: string;
}

export interface SupportChannel {
  id: string;
  name: string;
  icon: string;
  description: string;
  email?: string | null;
  badge?: string | null;
  meta?: string | null;
  links: { label: string; icon: string; url: string }[];
}

export interface SupportFaq {
  question: string;
  answer: string;
}

export interface SystemStatus {
  operational: boolean;
  headline: string;
  detail: string;
  uptime_percent: number;
  status_page_url: string;
}

export interface SupportMetaResponse {
  topics: SupportTopic[];
  channels: SupportChannel[];
  faqs: SupportFaq[];
  status: SystemStatus;
  typical_reply: string;
  response_window: string;
  prefill_name?: string | null;
  prefill_email?: string | null;
}

export interface ContactMessageRequest {
  name: string;
  email: string;
  topic: string;
  message: string;
}

export interface ContactMessageResponse {
  message_id: string;
  email: string;
  message: string;
}

/* --- Settings > Feedback ---------------------------------------------------- */

/** Aggregate across every public entry, for the "what others think" strip. */
export interface FeedbackSummary {
  average_rating: number;
  total: number;
  /** Count per star, all five keys present: { "5": 12, "4": 3, ... }. */
  distribution: Record<string, number>;
}

/** One entry in the shared list. Carries a display name only, never an email. */
export interface FeedbackItem {
  feedback_id: string;
  author: string;
  rating: number;
  comment: string;
  created_at: string;
  is_mine: boolean;
  /** Only set on your own entries. */
  status?: string | null;
}

export interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  has_more: boolean;
  summary: FeedbackSummary;
}

export interface FeedbackMetaResponse {
  rating_labels: Record<string, string>;
  my_submitted_count: number;
  community: FeedbackListResponse;
}

export interface FeedbackCreateRequest {
  rating: number;
  comment: string;
}

export interface FeedbackCreateResponse {
  feedback_id: string;
  message: string;
}

export interface MessageResponse {
  message: string;
}

export interface NotificationItem {
  job_id: string;
  title: string;
  kind: "completed" | "failed";
  message: string;
  occurred_at: string;
  unread: boolean;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unread_count: number;
}
