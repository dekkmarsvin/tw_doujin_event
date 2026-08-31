import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { getMapTemplateShape, getMapTemplateMetadata, listMapTemplateOptions, validateMapTemplateLayout } =
  await environment.runner.import("/app/map-template-registry.ts");
after(async () => { await vite.close(); });

test("a template without a fixed structure reports no shape instead of a made-up one", () => {
  assert.equal(getMapTemplateShape("TAIWAN_GENERIC_V1"), null);
  assert.equal(getMapTemplateShape("WHATEVER"), null);
});

test("every offered template is one the registry can validate", () => {
  for (const option of listMapTemplateOptions()) {
    assert.equal(typeof option.label, "string");
    assert.equal(typeof validateMapTemplateLayout(option.id, {}).ok, "boolean");
  }
});

test("the drawn shape and the published counts agree with what validation enforces", () => {
  const shape = getMapTemplateShape("FF47");
  const metadata = getMapTemplateMetadata("FF47");
  assert.equal(shape.rows.length, metadata.expectedRows);
  assert.equal(shape.rows.reduce((total, row) => total + row.slots, 0), metadata.expectedSlots);

  // A layout built straight from the shape must satisfy the FF47 validator:
  // a preview drawn from it can then only show an acceptable floor.
  const layout = {
    version: 1,
    template: "FF47",
    width: 1600,
    height: 1000,
    floor: { x: 0, y: 0, width: 1600, height: 1000 },
    rows: shape.rows.map((row) => ({
      label: row.label,
      orientation: row.orientation,
      slots: Array.from({ length: row.slots }, (_, index) => ({
        code: `${row.label}${String(index + 1).padStart(2, "0")}`,
        rect: { x: 10, y: 10 + index, width: 8, height: 8 },
      })),
    })),
    pillars: Array.from({ length: shape.pillars }, (_, index) => ({ x: index, y: 0, width: 4, height: 4 })),
    accessPoints: Array.from({ length: shape.accessPoints }, (_, index) => ({
      id: `gate-${index}`, label: `出入口 ${index + 1}`, rect: { x: index, y: 0, width: 6, height: 6 },
    })),
    landmarks: [],
  };
  const validation = validateMapTemplateLayout("FF47", layout);
  // Only the FF47-specific structure is under test here; the generic schema
  // checks (pillar ids, access-point geometry) belong to the shared validator.
  assert.deepEqual(validation.errors.filter((error) => /缺少 .+ 排|排應有|排方向|完整 FF47 layout/u.test(error)), []);
});
