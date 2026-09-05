/**
 * Generates a random, unguessable tracking ID for anonymous status lookup.
 * Not "encryption," so Node's crypto.randomBytes is a reasonable fit here —
 * confirm with your TA if randomness utilities fall under the "no built-in
 * crypto" rule; if they say yes, swap in a from-scratch CSPRNG.
 */
import crypto from "crypto";

export function generateTrackingId() {
  return crypto.randomBytes(16).toString("hex"); // e.g. "a3f9c2..."
}
