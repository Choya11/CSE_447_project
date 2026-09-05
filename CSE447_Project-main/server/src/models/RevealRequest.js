import mongoose from "mongoose";

/**
 * A pending or resolved request to unmask a report's optional identity
 * field. Approval is k-of-n across distinct custodian users (PRD FR-08);
 * a single deny closes the request outright, no override path exists.
 */
const revealRequestSchema = new mongoose.Schema(
  {
    report: { type: mongoose.Schema.Types.ObjectId, ref: "Report", required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true },

    threshold: { type: Number, required: true },
    approvals: [
      {
        custodian: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        decision: { type: String, enum: ["approve", "deny"], required: true },
        reason: String,
        decidedAt: { type: Date, default: Date.now },
      },
    ],

    status: { type: String, enum: ["pending", "approved", "denied"], default: "pending" },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("RevealRequest", revealRequestSchema);
