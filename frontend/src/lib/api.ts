import {
  BillingCheckoutResponse,
  BillingCycle,
  ContactMessageRequest,
  ContactMessageResponse,
  FeedbackCreateRequest,
  FeedbackCreateResponse,
  FeedbackListResponse,
  FeedbackMetaResponse,
  DetailedKeyMomentsResponse,
  HistoryListResponse,
  HistoryQuery,
  JobCreateRequest,
  JobCreateResponse,
  JobCollaborator,
  JobClip,
  JobClipRequest,
  JobNotesUpdateRequest,
  Project,
  MessageResponse,
  NotificationListResponse,
  PdfGenerateResponse,
  PricingCatalogResponse,
  PublicVideoPreviewResponse,
  PublicVideoUrlRequest,
  SupportMetaResponse,
  UploadPresignRequest,
  UploadPresignResponse,
  UsageSummaryResponse,
  UserProfileResponse,
  UserSettingsResponse,
  UserSettingsUpdateRequest,
  VideoChatAnswerResponse,
  VideoChatContext,
  VideoChatHistoryResponse,
} from "@/types/job";
import { clearSession, getActiveSession } from "@/lib/auth";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
}

export interface AuthResult {
  accessToken: string;
  user: UserProfileResponse;
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error("Invalid email or password");
  }
  const data = await response.json();
  return { accessToken: data.access_token, user: data.user };
}

export async function signup(email: string, password: string, fullName: string): Promise<AuthResult> {
  const response = await fetch(`${apiBaseUrl}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, full_name: fullName }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || "We could not create your account right now. Please try again.");
  }
  const data = await response.json();
  return { accessToken: data.access_token, user: data.user };
}

export async function exchangeSsoCode(code: string): Promise<AuthResult> {
  const response = await fetch(`${apiBaseUrl}/auth/sso/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || "That sign-in link expired or is invalid. Please try again.");
  }
  const data = await response.json();
  return { accessToken: data.access_token, user: data.user };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error("Failed to request a password reset");
  }
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || "Failed to reset password");
  }
}

export async function createJob(payload: JobCreateRequest): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to create job"));
  }

  return (await response.json()) as JobCreateResponse;
}

/** Starts a job from any public video link (YouTube, Vimeo, Loom, a direct video file, ...). */
export async function createJobFromUrl(payload: PublicVideoUrlRequest): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/videos/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to start that video link"));
  }

  return (await response.json()) as JobCreateResponse;
}

/** Checks a pasted link and reads its title/duration without starting a job. */
export async function previewVideoUrl(payload: PublicVideoUrlRequest): Promise<PublicVideoPreviewResponse> {
  const response = await authFetch(`${apiBaseUrl}/videos/from-url/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await errorDetail(response, "That link could not be read as a public video"));
  }

  return (await response.json()) as PublicVideoPreviewResponse;
}

export async function getJob(jobId: string): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch job status");
  }

  return (await response.json()) as JobCreateResponse;
}

export async function updateJobNotes(jobId: string, payload: JobNotesUpdateRequest): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not save notes"));
  return (await response.json()) as JobCreateResponse;
}

export async function listJobClips(jobId: string): Promise<JobClip[]> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/clips`, { method: "GET" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not load clips"));
  return (await response.json()) as JobClip[];
}

export async function createJobClip(jobId: string, payload: JobClipRequest): Promise<JobClip> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/clips`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not save clip"));
  return (await response.json()) as JobClip;
}

export async function deleteJobClip(jobId: string, clipId: string): Promise<void> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/clips/${clipId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not remove clip"));
}

export async function retryJob(jobId: string): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/retry`, { method: "POST" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not retry this job"));
  return (await response.json()) as JobCreateResponse;
}

export async function getDetailedKeyMoments(jobId: string): Promise<DetailedKeyMomentsResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/detailed-key-moments`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to load detailed key moments"));
  }

  return (await response.json()) as DetailedKeyMomentsResponse;
}

export async function getVideoChat(jobId: string): Promise<VideoChatHistoryResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/chat`, { method: "GET" });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to load this video's conversation"));
  }
  return (await response.json()) as VideoChatHistoryResponse;
}

export async function askVideoQuestion(
  jobId: string,
  question: string,
  contexts: VideoChatContext[] = []
): Promise<VideoChatAnswerResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, contexts }),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "The AI assistant could not answer right now"));
  }
  return (await response.json()) as VideoChatAnswerResponse;
}

export async function presignUpload(payload: UploadPresignRequest): Promise<UploadPresignResponse> {
  const response = await authFetch(`${apiBaseUrl}/uploads/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to prepare upload"));
  }

  return (await response.json()) as UploadPresignResponse;
}

export async function uploadFileToSignedUrl(
  signedUrl: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
  method: "PUT" | "POST" = "PUT",
  fields: Record<string, string> = {},
): Promise<void> {
  // Use XHR instead of fetch so we can report real upload progress.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, signedUrl, true);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error("File upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("File upload failed"));
    if (method === "POST") {
      const form = new FormData();
      Object.entries(fields).forEach(([key, value]) => form.append(key, value));
      form.append("file", file);
      xhr.send(form);
    } else {
      xhr.send(file);
    }
  });
}

export async function listJobs(limit = 30): Promise<JobCreateResponse[]> {
  const response = await authFetch(`${apiBaseUrl}/jobs?limit=${limit}`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load job history");
  }
  return (await response.json()) as JobCreateResponse[];
}

export async function listProjects(): Promise<Project[]> {
  const response = await authFetch(`${apiBaseUrl}/projects`, { method: "GET" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not load projects"));
  return (await response.json()) as Project[];
}

export async function createProject(name: string): Promise<Project> {
  const response = await authFetch(`${apiBaseUrl}/projects`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not create project"));
  return (await response.json()) as Project;
}

export async function renameProject(projectId: string, name: string): Promise<Project> {
  const response = await authFetch(`${apiBaseUrl}/projects/${projectId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not rename project"));
  return (await response.json()) as Project;
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await authFetch(`${apiBaseUrl}/projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not delete project"));
}

export async function assignJobProject(jobId: string, projectId: string | null): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/project`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }),
  });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not assign project"));
  return (await response.json()) as JobCreateResponse;
}

export async function listJobShares(jobId: string): Promise<JobCollaborator[]> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/shares`, { method: "GET" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not load sharing"));
  return (await response.json()) as JobCollaborator[];
}

export async function addJobShare(jobId: string, email: string): Promise<JobCollaborator> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/shares`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not share this note"));
  return (await response.json()) as JobCollaborator;
}

export async function removeJobShare(jobId: string, userId: string): Promise<void> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/shares/${userId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorDetail(response, "Could not remove access"));
}

export async function getUserProfile(): Promise<UserProfileResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load profile");
  }
  return (await response.json()) as UserProfileResponse;
}

export async function generatePdf(jobId: string): Promise<PdfGenerateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/pdf`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to generate PDF");
  }
  return (await response.json()) as PdfGenerateResponse;
}

export async function addJobActionItem(jobId: string, text: string): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/action-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error("Failed to add action item");
  }
  return (await response.json()) as JobCreateResponse;
}

export async function setJobActionItemCompleted(
  jobId: string,
  index: number,
  completed: boolean
): Promise<JobCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/jobs/${jobId}/action-items/${index}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed }),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to update action item"));
  }
  return (await response.json()) as JobCreateResponse;
}

export async function createCheckoutSession(
  plan = "pro",
  billingCycle: BillingCycle = "monthly"
): Promise<BillingCheckoutResponse> {
  const response = await authFetch(`${apiBaseUrl}/billing/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billing_cycle: billingCycle }),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to open checkout"));
  }
  return (await response.json()) as BillingCheckoutResponse;
}

// --- Analysis History -------------------------------------------------------

export async function listHistory(query: HistoryQuery = {}): Promise<HistoryListResponse> {
  const params = new URLSearchParams();
  if (query.projectId) params.set("project_id", query.projectId);
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.sources) {
    // Preserve an explicit empty selection; omitting the parameter means no source filter.
    if (query.sources.length === 0) params.append("sources", "none");
    else query.sources.forEach((source) => params.append("sources", source));
  }
  (query.tags ?? []).forEach((tag) => params.append("tags", tag));
  if (query.dateRange) params.set("date_range", query.dateRange);
  if (query.dateFrom) params.set("date_from", query.dateFrom);
  if (query.dateTo) params.set("date_to", query.dateTo);
  if (query.sort) params.set("sort", query.sort);
  params.set("limit", String(query.limit ?? 10));
  params.set("offset", String(query.offset ?? 0));

  const response = await authFetch(`${apiBaseUrl}/history?${params.toString()}`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load analysis history");
  }
  return (await response.json()) as HistoryListResponse;
}

// --- Notifications ----------------------------------------------------------

export async function getNotifications(): Promise<NotificationListResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me/notifications`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load notifications");
  }
  return (await response.json()) as NotificationListResponse;
}

export async function markNotificationsRead(): Promise<NotificationListResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me/notifications/read`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to update notifications");
  }
  return (await response.json()) as NotificationListResponse;
}

// --- Settings ---------------------------------------------------------------

export async function getUserSettings(): Promise<UserSettingsResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me/settings`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load settings");
  }
  return (await response.json()) as UserSettingsResponse;
}

export async function updateUserSettings(payload: UserSettingsUpdateRequest): Promise<UserSettingsResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to save your preferences"));
  }
  return (await response.json()) as UserSettingsResponse;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<MessageResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to change your password"));
  }
  return (await response.json()) as MessageResponse;
}

export async function deleteAccount(confirmation: string): Promise<MessageResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "Failed to delete your account"));
  }
  return (await response.json()) as MessageResponse;
}

export async function getUsageSummary(): Promise<UsageSummaryResponse> {
  const response = await authFetch(`${apiBaseUrl}/users/me/usage`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load usage");
  }
  return (await response.json()) as UsageSummaryResponse;
}

// --- Pricing & plans --------------------------------------------------------

export async function getPricingCatalog(): Promise<PricingCatalogResponse> {
  const response = await authFetch(`${apiBaseUrl}/billing/plans`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load plans");
  }
  return (await response.json()) as PricingCatalogResponse;
}

// --- Support / contact ------------------------------------------------------

export async function getSupportMeta(): Promise<SupportMetaResponse> {
  const response = await authFetch(`${apiBaseUrl}/support/meta`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load support details");
  }
  return (await response.json()) as SupportMetaResponse;
}

export async function sendContactMessage(payload: ContactMessageRequest): Promise<ContactMessageResponse> {
  const response = await authFetch(`${apiBaseUrl}/support/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await errorDetail(response, "We could not send your message. Please try again."));
  }
  return (await response.json()) as ContactMessageResponse;
}

/** Star wording plus the first page of everyone's ratings, for the Settings feedback tab. */
export async function getFeedbackMeta(): Promise<FeedbackMetaResponse> {
  const response = await authFetch(`${apiBaseUrl}/feedback/meta`, { method: "GET" });

  if (!response.ok) {
    throw new Error("Failed to load feedback");
  }

  return (await response.json()) as FeedbackMetaResponse;
}

/** Ratings and comments from all users, newest first. Backs the tab's "Show more". */
export async function listCommunityFeedback(limit = 5, offset = 0): Promise<FeedbackListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await authFetch(`${apiBaseUrl}/feedback/community?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("Failed to load what other users said");
  }

  return (await response.json()) as FeedbackListResponse;
}

export async function submitFeedback(payload: FeedbackCreateRequest): Promise<FeedbackCreateResponse> {
  const response = await authFetch(`${apiBaseUrl}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await errorDetail(response, "We could not send your feedback. Please try again."));
  }

  return (await response.json()) as FeedbackCreateResponse;
}

/** Pulls FastAPI's `detail` out of an error response, falling back to a friendly default. */
async function errorDetail(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
    return String(detail[0].msg).replace(/^Value error,\s*/, "");
  }
  return fallback;
}

function authHeaders(): Record<string, string> {
  const session = getActiveSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  const auth = authHeaders();
  for (const [key, value] of Object.entries(auth)) {
    headers.set(key, value);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  // Stored token is stale/invalid (e.g. backend restarted or user removed) - force a fresh login
  // instead of letting every subsequent call fail silently with a confusing "operation failed" error.
  if (response.status === 401 && typeof window !== "undefined") {
    clearSession();
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  return response;
}
