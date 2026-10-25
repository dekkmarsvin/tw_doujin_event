import calendar2026 from "../data/office-calendar/2026.csv?raw";
import calendar2027 from "../data/office-calendar/2027.csv?raw";

// Official CSV snapshots: 0 = working day, 2 = day off. Read the actual
// flag rather than inferring holidays (or make-up workdays) from weekdays.
const dates = new Map([calendar2026, calendar2027].flatMap((csv) =>
  csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, , flag, note] = line.split(",");
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    return [iso, { holiday: flag === "2", note }] as const;
  }),
));

/** Unknown years carry no official holiday claim. */
export function officeCalendarDate(date: string) {
  return dates.get(date);
}
