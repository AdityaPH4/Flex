import { OAuth2Client } from "google-auth-library";
import { env } from "../env";

const client = new OAuth2Client(env.googleClientId);

// Verifies a Google ID token from the mobile app and returns the verified
// email to look up the employee by. Throws if the token is invalid/expired,
// wasn't issued for our client, or the email isn't verified by Google.
export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string }> {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error("google_email_not_verified");
  }
  return { email: payload.email.toLowerCase() };
}
