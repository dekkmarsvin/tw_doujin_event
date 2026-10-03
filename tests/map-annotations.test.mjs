import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { parseFragment } from "parse5";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { annotationBoothConflicts, MapNoteDrawing, MapPathDrawing, pathArrowhead, pathBounds, transformPath, validNoteText } = await vite.environments.ssr.runner.import("/app/map-annotations.tsx");
after(() => vite.close());
const booth = { code: "A01", rect: { x: 40, y: 40, width: 20, height: 20 } };

test("notes accept short plain static times while refusing empty, excessive or control text", () => {
  for (const text of ["社團入場 9:30–10:30", "入口\n逆時針參觀\n依現場指示", "<script>plain text</script>", "a".repeat(120)]) assert.equal(validNoteText(text), true);
  for (const text of ["", "  \n", "a".repeat(121), "一\n二\n三\n四", "wrong\u0000text", "wrong\u0001text", null, 123]) assert.equal(validNoteText(text), false);
});

test("moving and resizing a bent or straight arrow preserves its ordered direction and finite points", () => {
  const path = { id: "turn", points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 80 }] };
  assert.deepEqual(pathBounds(path), { x: 10, y: 20, width: 40, height: 60 });
  transformPath(path, { x: 20, y: 30, width: 80, height: 30 });
  assert.deepEqual(path.points, [{ x: 20, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 60 }]);
  const head = pathArrowhead(path);
  assert.deepEqual(head[1], path.points.at(-1));
  assert.ok(head[0].y < head[1].y && head[2].y < head[1].y, "the arrowhead points along the last segment");
  for (const points of [[{ x: 10, y: 20 }, { x: 70, y: 20 }], [{ x: 20, y: 10 }, { x: 20, y: 70 }]]) {
    const straight = { id: "straight", points };
    transformPath(straight, { x: 5, y: 7, width: 40, height: 50 });
    assert.ok(straight.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.deepEqual(straight.points[0], { x: 5, y: 7 });
    assert.ok(straight.points[1].x > 5 || straight.points[1].y > 7, "a straight arrow keeps a nonzero final segment");
  }
});

test("authors see note and arrow collisions, including a diagonal whose endpoints are outside the booth", () => {
  const note = { id: "time", text: "社團入場 9:30–10:30", rect: { x: 39, y: 39, width: 20, height: 20 } };
  const crossing = { id: "cross", points: [{ x: 10, y: 10 }, { x: 90, y: 90 }] };
  assert.equal(annotationBoothConflicts([note], [crossing], [booth]).length, 2);
  assert.ok(annotationBoothConflicts([note], [crossing], [booth]).every(text => text.includes("A01")));
  const touching = { ...note, rect: { x: 60, y: 40, width: 20, height: 20 } };
  const clear = { id: "around", points: [{ x: 10, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 80 }] };
  assert.deepEqual(annotationBoothConflicts([touching], [clear], [booth]), []);
  assert.deepEqual(annotationBoothConflicts([], [{ id: "edge", points: [{ x: 10, y: 40 }, { x: 80, y: 40 }] }], [booth]), []);
});

test("notes render every line as escaped passive text, fitted inside the selected box at different map scales", () => {
  const text = '<img src=x onerror="alert(1)">\n社團入場 9:30–10:30\n一般入場 10:30–15:30';
  const note = { id: "time", text, rect: { x: 10, y: 20, width: 320, height: 90 } };
  for (const screenScale of [.25, 1, 6]) for (const fontScale of [1, 1.24]) {
    const html = renderToStaticMarkup(React.createElement("svg", {}, React.createElement(MapNoteDrawing, { note, presentation: { screenScale, fontScale } })));
    const group = parseFragment(html).childNodes[0].childNodes[0];
    const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
    assert.equal(attr(group, "aria-label"), text);
    assert.equal(attr(group, "pointer-events"), "none");
    assert.equal(attr(group, "tabindex"), undefined);
    const lines = group.childNodes.filter(node => node.nodeName === "text");
    assert.deepEqual(lines.map(node => node.childNodes[0].value), text.split("\n"));
    assert.equal(group.childNodes.some(node => node.nodeName === "img" || node.nodeName === "script"), false);
    const font = Number(/font-size:([\d.]+)/.exec(attr(lines[0], "style"))[1]);
    const centres = lines.map(node => Number(attr(node, "y")));
    assert.ok(centres[0] - font * .6 >= note.rect.y);
    assert.ok(centres.at(-1) + font * .6 <= note.rect.y + note.rect.height);
  }
  const arrow = renderToStaticMarkup(React.createElement(MapPathDrawing, { path: { id: "turn", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 70 }] } }));
  assert.match(arrow, /aria-label="動線箭頭"/);
  assert.match(arrow, /pointer-events="none"/);
});
