/**
 * Build-time scraping of Forest-dept pages / trek blogs for the few fields the
 * APIs don't give us — difficulty, permits, fees (spec 02). It is deliberately
 * conservative: a layout it doesn't recognise yields an EMPTY partial (never a
 * throw), so a site redesign degrades gracefully instead of breaking the build.
 * Only allowlisted hosts are fetched; arbitrary blogs are not.
 */
import * as cheerio from "cheerio";
import type { Difficulty, Trek } from "../../src/lib/trek";
import { fetchText, isAllowedHost } from "./http";

const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Hard"];

/**
 * Resolve whether a page says a permit is required. Returns undefined when the
 * page makes no clear statement. A "label: value" form (e.g. "Permit: required",
 * "Permit required: no") is read first; otherwise prose is scanned with
 * negations taking precedence over affirmatives.
 */
function parsePermit(lower: string): boolean | undefined {
  const labelled = lower.match(
    /permits?\b[^:\n]{0,20}:\s*(yes|no|required|not\s+required|not\s+needed|mandatory|none)/,
  );
  if (labelled) {
    const value = labelled[1].replace(/\s+/g, " ");
    return value === "yes" || value === "required" || value === "mandatory";
  }
  if (
    /\bno permits?\b/.test(lower) ||
    /\bpermits?\b[^.]{0,15}\bnot\s+(?:required|needed)\b/.test(lower)
  ) {
    return false;
  }
  if (/\bpermits?\b[^.]{0,15}\b(?:required|needed|mandatory|compulsory)\b/.test(lower)) {
    return true;
  }
  return undefined;
}

/** Pure parser: page HTML → partial Trek (difficulty / permit / fee if found). */
export function parseDetails(html: string): Partial<Trek> {
  const out: Partial<Trek> = {};
  let text: string;
  try {
    const $ = cheerio.load(html);
    text = $("body").text() || $.root().text() || "";
  } catch {
    return {};
  }
  if (!text) return {};
  const lower = text.toLowerCase();

  // Difficulty: first explicit "difficulty: <level>" mention.
  const diffMatch = lower.match(/difficulty[:\s-]+(easy|moderate|hard)/);
  if (diffMatch) {
    const found = DIFFICULTIES.find((d) => d.toLowerCase() === diffMatch[1]);
    if (found) out.difficulty = found;
  }

  // Permit: read a yes/no near the word "permit". Negations are checked before
  // affirmatives so "no permit required" is not misread as "permit required"
  // (the phrase "permit required" contains the word "required").
  const permit = parsePermit(lower);
  if (permit !== undefined) out.permitRequired = permit;

  // Entry fee: a rupee amount or an explicit "free". \bfees?\b keeps "fee" from
  // matching inside unrelated words like "coffee"/"toffee".
  const feeMatch = text.match(/\bfees?\b[:\s-]*(₹\s?\d[\d,]*\s*(?:\/\s*\w+)?|free)/i);
  if (feeMatch) out.entryFee = feeMatch[1].replace(/\s+/g, " ").trim();

  return out;
}

/** Fetch + parse a details page. Returns {} for disallowed hosts or any error. */
export async function scrapeDetails(url: string): Promise<Partial<Trek>> {
  if (!isAllowedHost(url)) return {};
  try {
    return parseDetails(await fetchText(url));
  } catch {
    return {};
  }
}
