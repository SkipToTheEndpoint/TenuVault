// Prints a new Ed25519 keypair for the desktop license entitlement tokens.
// The private key goes into the DESKTOP_LICENSE_SIGNING_KEY environment variable of the
// licensing service on tenuvault.com (never into a repository). The public key is built
// into the app through TENUVAULT_LICENSE_PUBLIC_KEY (see electron.vite.config.ts).
// Rotating the pair invalidates every token already issued; apps refresh on their next check.
import { generateKeyPairSync } from "node:crypto"

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" })
const publicPem = publicKey.export({ format: "pem", type: "spki" })

console.log("DESKTOP_LICENSE_SIGNING_KEY (server secret, base64 of the PEM):")
console.log(Buffer.from(privatePem).toString("base64"))
console.log("")
console.log("TENUVAULT_LICENSE_PUBLIC_KEY (desktop build, public):")
console.log(publicPem.trim())
