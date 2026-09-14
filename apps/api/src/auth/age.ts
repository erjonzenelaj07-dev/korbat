export const MINIMUM_AGE = 16;

/** Whole years between an ISO `YYYY-MM-DD` date of birth and today's date in UTC. */
export function ageOn(dateOfBirth: string, today: Date = new Date()): number {
  const [year, month, day] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const todayYear = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth() + 1;
  const todayDay = today.getUTCDate();
  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1;
  return age;
}

export function meetsMinimumAge(dateOfBirth: string, today: Date = new Date()): boolean {
  return ageOn(dateOfBirth, today) >= MINIMUM_AGE;
}
