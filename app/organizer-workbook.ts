import readXlsxFile from "read-excel-file/browser";
import { organizerRowsFromWorksheet, parseOrganizerCsv, type OrganizerImportTableRow } from "./organizer-import";

export type OrganizerWorkbookSheet = { name: string; rows: OrganizerImportTableRow[] };

/** Reads private source bytes in the browser. Callers retain them only long
 * enough to hash and map the selected sheet; no API accepts this File. */
export async function readOrganizerWorkbook(file: File): Promise<{
  bytes: Uint8Array;
  sheets: OrganizerWorkbookSheet[];
}> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLocaleLowerCase("en-US").endsWith(".csv")) {
    return { bytes, sheets: [{ name: "CSV", rows: parseOrganizerCsv(new TextDecoder().decode(bytes)) }] };
  }
  const workbook = await readXlsxFile(file);
  return {
    bytes,
    sheets: workbook.map(({ sheet, data }) => ({ name: sheet, rows: organizerRowsFromWorksheet(data) })),
  };
}
