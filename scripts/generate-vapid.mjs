import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }),
  pub = publicKey.export({ format: "jwk" }),
  priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]).toString("base64url");
writeFileSync(
  ".dev.vars.generated",
  `VAPID_PUBLIC_KEY=${raw}\nVAPID_PRIVATE_KEY=${priv.d}\nGUEST_SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`,
  { mode: 0o600 },
);
console.log("Push and guest keys generated in the ignored local secrets file.");
