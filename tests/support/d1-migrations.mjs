import { readdir, readFile } from "node:fs/promises";

const directory = new URL("../../migrations/", import.meta.url);

/** The statements of every migration, in order (#546 5d). Comments are
 * dropped; no statement in them contains a semicolon of its own. */
export async function migrationStatements() {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const statements = [];
  for (const file of files) {
    const sql = (await readFile(new URL(file, directory), "utf8")).replace(/^--.*$/gm, "");
    statements.push(...sql.split(";").map((statement) => statement.trim()).filter(Boolean));
  }
  return statements;
}

/** Bring a fresh test database to the schema production runs. */
export async function applyMigrations(database) {
  const statements = await migrationStatements();
  await database.batch(statements.map((statement) => database.prepare(statement)));
}
