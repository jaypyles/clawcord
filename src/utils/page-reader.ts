import { load } from "cheerio";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type { Browser, BrowserContext } from "playwright";
import { chromium } from "playwright";

export type Webpage = {
  url: string;
  html: string;
  markdown: string;
};

export type GetSiteOptions = {
  url: string;
  selector?: string;
  timeoutMs?: number;
};

/** Trim lines and collapse runs of blank lines / spaces to cut token noise. */
export function compactWhitespace(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  const lines: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line === "" && lines.at(-1) === "") {
      continue;
    }
    lines.push(line);
  }

  return lines.join("\n").trim();
}

function compactHtml(html: string): string {
  return compactWhitespace(html.replace(/>\s+</g, "><"));
}

export class PageReader {
  private browser?: Browser;
  private context?: BrowserContext;

  async init() {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();
  }

  async read(
    pageUrl: string,
    selector?: string,
    timeoutMs = 30_000
  ): Promise<Webpage> {
    if (!this.context) {
      throw new Error("PageReader is not initialized.");
    }

    const page = await this.context.newPage();

    try {
      await page.goto(pageUrl, {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded",
      });

      const pageHtml = await page.content();
      const contentHtml = sanitizeHtml(pageHtml, selector);

      const html = compactHtml(contentHtml);
      const markdown = compactWhitespace(
        NodeHtmlMarkdown.translate(contentHtml)
      );

      return {
        url: pageUrl,
        html,
        markdown,
      };
    } finally {
      await page.close();
    }
  }

  async dispose() {
    if (this.context) {
      await this.context.close();
      this.context = undefined;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }
}

export function sanitizeHtml(html: string, selector?: string): string {
  const $ = load(html);

  if (selector) {
    const selectedHtml = $(selector).html();

    if (!selectedHtml?.trim()) {
      throw new Error(`No content found for selector: ${selector}`);
    }

    return selectedHtml;
  }

  $("script, style, path, footer, header, head").remove();

  return $.html();
}

/** Load a URL in a headless browser and return sanitized HTML + markdown. */
export async function fetchSite(options: GetSiteOptions): Promise<Webpage> {
  const reader = new PageReader();

  try {
    await reader.init();
    return await reader.read(
      options.url,
      options.selector,
      options.timeoutMs ?? 30_000
    );
  } finally {
    await reader.dispose();
  }
}
