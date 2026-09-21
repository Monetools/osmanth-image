/** Types for the parts of the recording script that the tests exercise. */
export interface SourceHit {
  file: string;
  id: string;
  kind: "source" | "constraints_source" | "marketplace";
  source: { source_url: string; [k: string]: unknown };
}

/** Every place in the profile data that cites this URL. */
export function findSources(groups: Record<string, unknown>, url: string): SourceHit[];
