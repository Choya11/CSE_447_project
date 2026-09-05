import mongoose from "mongoose";

/**
 * The identity-custodian key is a single system-held ECC keypair — not
 * personally held by any custodian user. Custodians are a human role that
 * gates *invocation* of this key (via k-of-n approval on a RevealRequest);
 * they never receive the private key material itself. This collection is
 * intentionally separate from ReviewerKeys (its own model, its own access
 * path via crypto/custodianKeyManager.js) so a bug in reviewer-key handling
 * can't reach this collection and vice versa (see TDD §7).
 */
const custodianKeysSchema = new mongoose.Schema(
  {
    keyId: { type: String, required: true, unique: true, index: true },
    version: { type: Number, required: true },

    eccPublicKey: {
      x: { type: String, required: true },
      y: { type: String, required: true },
    },
    eccPrivateKeyEncrypted: { type: String, required: true },

    createdAt: { type: Date, default: Date.now },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("CustodianKeys", custodianKeysSchema);
