import mongoose from "mongoose";

/**
 * Stores reviewer keypairs, separate from the User collection per the
 * assignment's "tightly-restricted collection" note. Public keys are
 * duplicated here (and also cached on User for convenience) as plain
 * strings — BigInts can't be stored directly in MongoDB, so every
 * bigint field is serialized with .toString() and parsed back with
 * BigInt() on read (see keyManager.js's serialize/deserialize helpers).
 *
 * Only one document per user should have retiredAt: null (the active key).
 * Rotation retires the old one and inserts a new active one, preserving
 * history so reports encrypted before rotation can still be decrypted.
 */
const reviewerKeysSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    version: { type: Number, required: true },

    rsaPublicKey: {
      e: { type: String, required: true },
      n: { type: String, required: true },
    },
    // Encrypted with atRestCipher — never store raw private key material
    rsaPrivateKeyEncrypted: { type: String, required: true },

    eccPublicKey: {
      x: { type: String, required: true },
      y: { type: String, required: true },
    },
    eccPrivateKeyEncrypted: { type: String, required: true },

    createdAt: { type: Date, default: Date.now },
    retiredAt: { type: Date, default: null }, // null = currently active key
  },
  { timestamps: true }
);

export default mongoose.model("ReviewerKeys", reviewerKeysSchema);
