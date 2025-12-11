import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const TIMEOUT_MS = 12000;

export async function POST(request: Request) {
  let { url } = await request.json();

  if (!url) return NextResponse.json({ status: "error" });

  const targetDomain = "https://coloringonly.com";

  // Skip languages
  const excludedLangsRegex = /\/(es|pt|fr|de|it|ru|nl)(\/|$)/;

  try {
    // 1. HEAD REQUEST (Optimization)
    try {
      const headResponse = await axios.head(url, {
        timeout: 4000,
        httpsAgent,
        validateStatus: (status) => status < 400 || status === 301 || status === 302,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ColoringScanner/2.0)" },
      });

      const contentType = headResponse.headers["content-type"] || "";

      // Optimization: Skip non-html without downloading body
      if (!contentType.includes("text/html")) {
        return NextResponse.json({ url, status: "ok", links: [], isLeaf: true });
      }

      if (headResponse.status === 301 || headResponse.status === 302) {
        return handleRedirect(url, headResponse.headers["location"], targetDomain);
      }
    } catch (headError) {
      // Ignore HEAD errors and try GET
    }

    // 2. GET REQUEST
    const response = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: (status) => status < 400 || status === 301 || status === 302,
      timeout: TIMEOUT_MS,
      httpsAgent,
      responseType: "text", // Get raw text
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (response.status === 301 || response.status === 302) {
      return handleRedirect(url, response.headers["location"], targetDomain);
    }

    // 3. PARSE
    const $ = cheerio.load(response.data);

    // DOM Cleaning (Remove noise)
    $(".header, .navigation, .header-search, .footer-container, #footer, .widget").remove();
    $(".breadcrumb, .top-color, #related_colorings").remove();

    // 4. LEAF NODE DETECTION
    // Only check for the main coloring page download button
    const hasDownloadBtn = $("#btndownload").length > 0 || $(".btn-download.main").length > 0;

    if (hasDownloadBtn) {
      return NextResponse.json({ url, status: "ok", links: [], isLeaf: true });
    }

    // 5. LINK EXTRACTION
    const extractedLinks = new Set<string>();

    $("a[href]").each((_, element) => {
      let href = $(element).attr("href")?.trim();
      if (!href) return;

      try {
        // AUTOMATIC RESOLUTION: Handles relative links
        const absoluteUrl = new URL(href, url);

        // Domain Check
        if (!absoluteUrl.href.includes("coloringonly.com")) return;

        // Skip languages
        if (excludedLangsRegex.test(absoluteUrl.pathname)) return;

        // Skip junk
        if (absoluteUrl.href.includes("/wp-") || absoluteUrl.hash || absoluteUrl.search) return;

        // Normalize
        const cleanHost = absoluteUrl.hostname.replace(/^www\./, "");
        const finalUrl = `${absoluteUrl.protocol}//${cleanHost}${absoluteUrl.pathname}`;

        if (finalUrl === url) return; // Self link

        extractedLinks.add(finalUrl);
      } catch (e) {
        // Invalid URL, skip
      }
    });

    return NextResponse.json({
      url,
      status: "ok",
      redirectLocation: null,
      links: Array.from(extractedLinks),
      isLeaf: false,
    });
  } catch (error: any) {
    const status = error.response?.status === 404 ? "broken" : "error";
    return NextResponse.json({ url, status, redirectLocation: null, links: [], isLeaf: true });
  }
}

function handleRedirect(originalUrl: string, locationHeader: string | undefined, domain: string) {
  if (!locationHeader) {
    return NextResponse.json({ url: originalUrl, status: "broken", redirectLocation: null, isLeaf: true });
  }
  try {
    const absoluteRedirect = new URL(locationHeader, originalUrl).href;
    const cleanTarget = absoluteRedirect.replace(/\/$/, "");
    const cleanHome = domain.replace(/\/$/, "");

    if (cleanTarget === cleanHome || cleanTarget === cleanHome + "/") {
      return NextResponse.json({ url: originalUrl, status: "soft-404", redirectLocation: absoluteRedirect, links: [], isLeaf: true });
    }

    return NextResponse.json({ url: originalUrl, status: "redirect", redirectLocation: absoluteRedirect, links: [absoluteRedirect], isLeaf: false });
  } catch (e) {
    return NextResponse.json({ url: originalUrl, status: "error", redirectLocation: null, isLeaf: true });
  }
}
