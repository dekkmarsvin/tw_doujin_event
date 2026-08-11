const VOLATILE_FORMULA = /\b(?:NOW|TODAY|RAND|RANDBETWEEN)\s*\(/i;

function referencedCells(formula) {
  return [...formula.matchAll(/(?:^|[^\w!])\$?([A-Z]{1,3})\$?(\d+)/g)]
    .map((match) => `${match[1]}${match[2]}`);
}

function volatileFormulaCells(sheet) {
  const formulas = new Map(
    sheet.cells.flatMap((cell) => cell.formula === undefined ? [] : [[cell.reference, cell.formula]]),
  );
  const volatile = new Set(
    [...formulas].flatMap(([reference, formula]) => VOLATILE_FORMULA.test(formula) ? [reference] : []),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const [reference, formula] of formulas) {
      if (volatile.has(reference)) continue;
      if (referencedCells(formula).some((dependency) => volatile.has(dependency))) {
        volatile.add(reference);
        changed = true;
      }
    }
  }
  return volatile;
}

function comparableCell(cell, ignoreCachedFormulaValue) {
  return JSON.stringify({
    value: ignoreCachedFormulaValue && cell.formula !== undefined ? null : cell.value,
    formula: cell.formula ?? null,
  });
}

export function compareWorkbookData(current, incoming, { maxSamples = 20 } = {}) {
  const currentSheets = new Map(current.sheets.map((sheet) => [sheet.name, sheet]));
  const incomingSheets = new Map(incoming.sheets.map((sheet) => [sheet.name, sheet]));
  const sheetNames = [...new Set([...currentSheets.keys(), ...incomingSheets.keys()])];
  const sheets = [];
  const samples = [];
  const totals = { added: 0, removed: 0, changed: 0 };

  for (const name of sheetNames) {
    const before = currentSheets.get(name);
    const after = incomingSheets.get(name);
    const volatileCells = new Set([
      ...volatileFormulaCells(before ?? { cells: [] }),
      ...volatileFormulaCells(after ?? { cells: [] }),
    ]);
    const beforeCells = new Map((before?.cells ?? []).map((cell) => [cell.reference, cell]));
    const afterCells = new Map((after?.cells ?? []).map((cell) => [cell.reference, cell]));
    const references = [...new Set([...beforeCells.keys(), ...afterCells.keys()])];
    const counts = { added: 0, removed: 0, changed: 0 };

    for (const reference of references) {
      const oldCell = beforeCells.get(reference);
      const newCell = afterCells.get(reference);
      let kind;
      if (!oldCell) kind = "added";
      else if (!newCell) kind = "removed";
      else if (comparableCell(oldCell, volatileCells.has(reference)) !== comparableCell(newCell, volatileCells.has(reference))) kind = "changed";
      else continue;

      counts[kind] += 1;
      totals[kind] += 1;
      if (samples.length < maxSamples) {
        samples.push({ sheet: name, reference, kind, before: oldCell, after: newCell });
      }
    }

    if (!before || !after || counts.added || counts.removed || counts.changed) {
      sheets.push({
        name,
        status: !before ? "added" : !after ? "removed" : "changed",
        ...counts,
      });
    }
  }

  return {
    changed: totals.added + totals.removed + totals.changed > 0,
    totals,
    sheets,
    samples,
  };
}
