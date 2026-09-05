import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // e.g. "REVIEWER_CREATED", "KEY_ROTATED"
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: mongoose.Schema.Types.Mixed },
    mac: { type: String, required: true }, // MAC-chained, same pattern as Report.statusLog
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export default mongoose.model("AuditLog", auditLogSchema);
