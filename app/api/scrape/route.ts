import axios from "axios";
import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const uniqueLinks = new Set<string>();

    // Hostname Logic (to exclude external sites)
    const targetUrlObj = new URL(url);
    const targetHostname = targetUrlObj.hostname.replace("www.", "");

    // Select ALL anchors in body
    const selector = "body a";

    $(selector).each((_, element) => {
      let href = $(element).attr("href");
      if (href) {
        href = href.trim();
        if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href === "#" || href === "") return;

        try {
          // Normalize to Absolute URL
          const absoluteUrlObj = new URL(href, url);
          const absoluteUrl = absoluteUrlObj.href;
          const linkHostname = absoluteUrlObj.hostname.replace("www.", "");

          // Only keep links belonging to the target domain
          if (linkHostname.includes(targetHostname)) {
            uniqueLinks.add(absoluteUrl);
          }
        } catch (e) {
          // Ignore invalid URLs
        }
      }
    });

    const extractedLinks = Array.from(uniqueLinks);
    return NextResponse.json({ success: true, total: extractedLinks.length, links: extractedLinks });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
