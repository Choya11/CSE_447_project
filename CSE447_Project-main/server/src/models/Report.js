import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    trackingId: { type: String, required: true, unique: true, index: true },

    // All encrypted with the assigned reviewer's RSA public key
    titleEncrypted: { type: String, required: true },
    descriptionEncrypted: { type: String, required: true },
    categoryEncrypted: { type: String },
    evidenceEncrypted: { type: String },

    // Encrypted separately with ECC so a compromised reviewer account alone
    // can't unmask the reporter without the ECC private key too
    reporterIdentityEncrypted: { type: String, default: null }, // null => fully anonymous

    // Integrity
    mac: { type: String, required: true },

    assignedReviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedReviewerKeyVersion: { type: Number, default: null },
    status: { type: String, enum: ["Open", "Investigating", "Resolved"], default: "Open" },

    // Append-only, MAC-chained. `type` distinguishes a plain status change from
    // an assignment or identity-reveal event, all sharing one tamper-evident chain.
    statusLog: [
      {
        type: {
          type: String,
          enum: [
            "status_change",
            "assigned",
            "identity_reveal_requested",
            "identity_reveal_approved",
            "identity_reveal_denied",
          ],
          default: "status_change",
        },
        status: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        timestamp: { type: Date, default: Date.now },
        mac: String,
      },
    ],

    readReceipts: [
      {
        reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        openedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);
