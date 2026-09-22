import path from "node:path";

export function observeRequests(page) {
  const requests = [];
  // Authentication URLs can carry one-time tokens. Retain paths and status,
  // never query strings, headers or request bodies.
  const remember = record => { requests.push(record); if (requests.length > 20) requests.shift(); };
  page.on("response", response => {
    remember({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on("requestfailed", request => remember({ method: request.method(), path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
  return requests;
}

export async function captureFailurePages(browser, output, name, observations) {
  const diagnostics = [];
  for (const page of browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed()).slice(0, 5)) {
    const screenshot = `failure-${name}-${diagnostics.length + 1}.png`;
    const results = await Promise.allSettled([
      page.screenshot({ path: path.join(output, screenshot), timeout: 2500 }),
      page.locator("body").innerText({ timeout: 2500 }),
    ]);
    diagnostics.push({ path: new URL(page.url()).pathname, requests: observations.get(page) ?? [],
      ...(results[0].status === "fulfilled" ? { screenshot } : { screenshotError: "capture failed" }),
      ...(results[1].status === "fulfilled" ? { visibleText: results[1].value.slice(0, 12000) } : { textError: "capture failed" }),
    });
  }
  return diagnostics;
}
