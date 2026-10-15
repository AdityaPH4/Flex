// The cashier's "today" is the calendar day in India, not the server's day.
// The EC2 box runs on UTC, so a plain "start of today" would roll over at
// 5:30 am IST - in the middle of the morning shift. IST is a fixed UTC+05:30
// (India has no daylight saving), so plain arithmetic is exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant the IST calendar day containing `at` began (00:00 IST). */
export function startOfDayIST(at: Date = new Date()): Date {
  const istClock = at.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(istClock / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}
