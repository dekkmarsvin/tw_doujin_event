import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";
import { collectEventGeneratorInput, generateEventWorkspace } from "./event-workspace-generator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const workspaceIndex = args.indexOf("--workspace");
if (workspaceIndex === -1 || !args[workspaceIndex + 1] || args.length !== 2) {
  throw new Error("Usage: npm run event:generate -- --workspace <data-repo-checkout>");
}
const workspace = path.resolve(args[workspaceIndex + 1]);
const readline = createInterface({ input: process.stdin, output: process.stdout });
const vite = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
try {
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("The current event validator is unavailable.");
  const { parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
  const candidate = await collectEventGeneratorInput({
    workspace,
    ask: (question) => readline.question(`${question}: `),
  });
  const result = await generateEventWorkspace({
    workspace,
    ...candidate,
    validateEventDefinition: parseEventDefinition,
  });
  if (result.changed) {
    console.log(`Created ${path.relative(workspace, result.eventDirectory)} with ${result.createdReferences.length} new reference record(s).`);
  } else {
    console.log(`No changes: ${path.relative(workspace, result.eventDirectory)} already matches the wizard input.`);
  }
} finally {
  readline.close();
  await vite.close();
}
