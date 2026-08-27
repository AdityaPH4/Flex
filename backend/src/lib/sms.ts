import { env } from "../env";

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

// Dev-only provider: prints the code to the server console instead of sending
// a real SMS. Fine for building/testing the app without an SMS bill.
class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`\n[dev-sms] OTP for ${phone}: ${code}\n`);
  }
}

// TODO before production: implement a real provider, e.g.:
//
// class TwilioSmsProvider implements SmsProvider {
//   async sendOtp(phone: string, code: string): Promise<void> {
//     await twilioClient.messages.create({
//       to: phone,
//       from: process.env.TWILIO_FROM_NUMBER,
//       body: `Your TOIT verification code is ${code}. It expires in 5 minutes.`,
//     });
//   }
// }
//
// then switch on env.smsProvider below.

function buildProvider(): SmsProvider {
  switch (env.smsProvider) {
    case "console":
    default:
      return new ConsoleSmsProvider();
  }
}

export const smsProvider = buildProvider();
