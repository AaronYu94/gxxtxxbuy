// Saved-link normalization for the core flow. The comprehensive V2-03-02 logic
// (short-link flagging, tracking-parameter stripping, illegal-protocol rejection,
// over-long guarding, canonical dedupe) lives in src/parsing/link-normalizer.js;
// this thin wrapper preserves the field shape the core service and its tests use.
import { toSavedLinkFields, identifyPlatform } from "../parsing/link-normalizer.js";

export function normalizeProductUrl(rawUrl) {
  return toSavedLinkFields(rawUrl);
}

export { identifyPlatform };
