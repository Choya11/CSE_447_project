/**
 * One-time bootstrap for the very first admin account. There is no public
 * signup route for staff roles (by design — see docs/ENGINEERING_PLAN.md
 * R-02), so the first admin has to be created out-of-band, directly against
 * the database, exactly once.
 *
 * Usage (from server/):
 *   node scripts/createAdmin.js <username> <password> <email>
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { authenticator } from "otplib";
import User from "../src/models/User.js";
import { hashPassword } from "../src/crypto/hash.js";
import { encryptPlatformField } from "../src/crypto/keyManager.js";

dotenv.config();

async function main() {
  const [username, password, email] = process.argv.slice(2);
  if (!username || !password || !email) {
    console.error("Usage: node scripts/createAdmin.js <username> <password> <email>");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const existing = await User.findOne({ username });
  if (existing) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }

  const { hash, salt } = hashPassword(password);
  const emailEncrypted = await encryptPlatformField(email);
  const totpSecret = authenticator.generateSecret();

  const user = await User.create({
    username,
    passwordHash: hash,
    passwordSalt: salt,
    emailEncrypted,
    role: "admin",
    status: "active",
    totpSecret,
    is2FAEnabled: true,
  });

  const otpauthUrl = authenticator.keyuri(username, "WhistleblowerTool", totpSecret);

  console.log(`\nAdmin account created: ${user.username} (${user._id})`);
  console.log(`\nAdd this to your authenticator app now — it will not be shown again:`);
  console.log(`  otpauth URL: ${otpauthUrl}`);
  console.log(`  raw secret:  ${totpSecret}\n`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
