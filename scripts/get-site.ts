import { fetchSite } from "../src/utils/page-reader";

const url = process.argv[2];
const selector = process.argv[3];
const format = process.argv[4] ?? "markdown";

if (!url) {
  console.error("Usage: bun scripts/get-site.ts <url> [selector] [markdown|html]");
  process.exit(1);
}

const page = await fetchSite({ url, selector });

if (format === "html") {
  console.log(page.html);
} else {
  console.log(page.markdown);
}
