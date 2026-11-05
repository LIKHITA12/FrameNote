import { JobCreateResponse } from "@/types/job";

function line(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bullets(values: string[]): string[] {
  return values.map((value) => `- ${line(value)}`).filter((value) => value !== "- ");
}

function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function reportMarkdown(job: JobCreateResponse): string {
  const title = line(job.file_name || job.source_url || "Video notes");
  const analysis = job.analysis;
  const sections: string[] = [
    `# ${title}`,
    `Created: ${new Date(job.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    job.source_url ? `Source: ${job.source_url}` : "",
    job.transcription_model ? `Transcription: ${job.transcription_model}` : "",
    job.summary_model ? `Summary model: ${job.summary_model}` : "",
    `\n## Summary\n${analysis?.overview || job.summary}`,
  ];

  if (analysis?.headlines?.length) sections.push(`## Key takeaways\n${bullets(analysis.headlines).join("\n")}`);
  else if (job.key_points.length) sections.push(`## Key takeaways\n${bullets(job.key_points.map((point) => `${point.title}: ${point.description}`)).join("\n")}`);

  if (analysis?.timeline?.length) {
    sections.push(`## Timeline\n${analysis.timeline.map((part) =>
      `### ${clock(part.start_seconds)}–${clock(part.end_seconds)} ${line(part.title)}\n${bullets(part.bullets).join("\n")}`
    ).join("\n\n")}`);
  }
  if (analysis?.decisions?.length) sections.push(`## Decisions\n${bullets(analysis.decisions).join("\n")}`);

  const actionItems = [...(analysis?.action_items ?? []), ...(job.custom_action_items ?? [])];
  if (actionItems.length) {
    const completed = new Set(job.completed_action_items ?? []);
    sections.push(`## Action items\n${actionItems.map((item, index) => {
      const detail = analysis?.action_item_details?.find((entry) => entry.title === item);
      const meta = [detail?.owner ? `owner: ${detail.owner}` : null, detail?.due ? `due: ${detail.due}` : null, detail?.priority ? `priority: ${detail.priority}` : null].filter(Boolean);
      return `- [${completed.has(index) ? "x" : " "}] ${line(item)}${meta.length ? ` (${meta.join(", ")})` : ""}`;
    }).join("\n")}`);
  }
  if (analysis?.questions_and_answers?.length) {
    sections.push(`## Questions and answers\n${analysis.questions_and_answers.map((item) =>
      `### ${clock(item.time_seconds)} ${line(item.question)}\n${line(item.answer)}`
    ).join("\n\n")}`);
  }
  if (analysis?.terms?.length) sections.push(`## Glossary\n${bullets(analysis.terms.map((term) => `${term.term}: ${term.meaning}`)).join("\n")}`);
  if (job.transcript_text?.trim()) sections.push(`## Transcript\n${job.transcript_text.trim()}`);

  return `${sections.filter(Boolean).join("\n\n").trim()}\n`;
}

export function downloadReportMarkdown(job: JobCreateResponse): void {
  const content = reportMarkdown(job);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(job.file_name || "framenote-notes").replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 80) || "framenote-notes"}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
