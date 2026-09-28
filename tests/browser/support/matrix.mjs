export const matrixMode = process.env.MAP_TEST_MATRIX || (process.env.MAP_TEST_SKIP_MATRIX ? "none" : "full");
if (!["representative", "full", "none"].includes(matrixMode)) {
  throw new Error(`Unknown browser matrix: ${matrixMode}`);
}

// These cases contain interactions as well as geometry. Even `none` retains
// the representative cases; only map-viewport's separate matrix is optional.
export function selectMatrix(full, representative) {
  return matrixMode === "full" ? full : representative;
}
