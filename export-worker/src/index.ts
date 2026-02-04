import puppeteer from "@cloudflare/puppeteer";

type Env = { BROWSER: any; EXPORT_KEY?: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const isPng = url.pathname === "/api/newsprint.png";
    const isPdf = url.pathname === "/api/newsprint.pdf";

    if (!isPng && !isPdf) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Optional protection (recommended). If set, client must send x-export-key header.
    if (env.EXPORT_KEY) {
      const key = request.headers.get("x-export-key");
      if (key !== env.EXPORT_KEY) return new Response("Unauthorized", { status: 401 });
    }

    const bodyText = await request.text();
    if (bodyText.length > 600_000) {
      return new Response("Payload too large", { status: 413 });
    }

    let payload: any;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const html = String(payload.html || "");
    if (!html.includes('id="newsprint"')) {
      return new Response('Missing #newsprint in HTML', { status: 400 });
    }

    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    // Wide viewport so the newspaper doesn't wrap unexpectedly.
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

    await page.setContent(html, { waitUntil: "networkidle0" });

    // Ensure fonts/layout settle
    await page.evaluate(async () => {
      // @ts-ignore
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });

    if (isPng) {
      const clip = await page.evaluate(() => {
        const el = document.getElementById("newsprint");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height),
        };
      });

      if (!clip) {
        await page.close();
        await browser.close();
        return new Response("Render failed: #newsprint not found", { status: 500 });
      }

      const png = await page.screenshot({ type: "png", clip });

      await page.close();
      await browser.close();

      return new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": 'attachment; filename="shift_report.png"',
          "Cache-Control": "no-store",
        },
      });
    }

    // PDF path
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      // format: "Letter", // optional
    });

    await page.close();
    await browser.close();

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="shift_report.pdf"',
        "Cache-Control": "no-store",
      },
    });
  },
};
