import { JobCreateResponse } from "@/types/job";

// Prefer a real extracted frame; fall back to the YouTube thumbnail for link-based jobs.
export function jobThumbnail(job: JobCreateResponse): string | null {
  const framePoint = job.key_points.find((point) => point.frame_image_url);
  if (framePoint?.frame_image_url) return framePoint.frame_image_url;
  if (job.youtube_video_id) return `https://img.youtube.com/vi/${job.youtube_video_id}/hqdefault.jpg`;
  return null;
}

// Short label for where a job's recording came from. "url" jobs are public links we only
// transcribed (no file of ours, no extracted frames), so they must not read as uploads.
export function jobSourceLabel(job: Pick<JobCreateResponse, "source_type">): string {
  if (job.source_type === "youtube") return "YouTube link";
  if (job.source_type === "url") return "Video link";
  return "Uploaded file";
}

// Material icon name matching jobSourceLabel.
export function jobSourceIcon(job: Pick<JobCreateResponse, "source_type">): string {
  if (job.source_type === "youtube") return "smart_display";
  if (job.source_type === "url") return "link";
  return "movie";
}
