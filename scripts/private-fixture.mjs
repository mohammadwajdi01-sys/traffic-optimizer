// Disposable local/CI credentials; never used for the live website.
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";
const salt = randomBytes(16),
  credentials = {
    username: "browser fixture",
    salt: salt.toString("hex"),
    hash: pbkdf2Sync(
      "browser-fixture-password",
      salt,
      100000,
      32,
      "sha256",
    ).toString("hex"),
    signingKey: randomBytes(32).toString("hex"),
  };
const guestSalt = randomBytes(16);
const guest = {username:"browser guest", salt:guestSalt.toString("hex"), hash:pbkdf2Sync("browser-guest-password",guestSalt,100000,32,"sha256").toString("hex")};
writeFileSync(".dev.vars.privatecheck", `PRIVATE_ACCESS_CREDENTIALS='${JSON.stringify(credentials)}'\nPRIVATE_GUEST_ACCESS_CREDENTIALS='${JSON.stringify(guest)}'\n`, {mode:0o600});
