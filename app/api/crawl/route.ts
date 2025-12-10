import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { NextResponse } from "next/server";

// Prevent Vercel from caching the response
export const dynamic = "force-dynamic";

// Custom HTTPS Agent to handle SSL and KeepAlive for speed
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

// CONFIGURATION
const TIMEOUT_MS = 15000; // Increased to 15s to allow full large pages to load

export async function POST(request: Request) {
  let { url } = await request.json();
  const domain = "https://coloringonly.com";

  // Regex to ignore specific languages immediately
  const excludedLangsRegex = /\/(es|pt|fr|de|it|ru|nl)(\/|$)/;

  try {
    // -----------------------------------------------------------------------
    // OPTIMIZATION 1: HEAD CHECK (Keep this - it is safe)
    // We check if the file is HTML before downloading the body.
    // This safely skips PDFs/Images without risking content loss.
    // -----------------------------------------------------------------------
    try {
      const headResponse = await axios.head(url, {
        timeout: 5000,
        httpsAgent,
        validateStatus: (status) => status < 400 || status === 301 || status === 302,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ColoringScanner/2.0)" },
      });

      const contentType = headResponse.headers["content-type"] || "";

      // If it's not HTML, stop immediately.
      if (!contentType.includes("text/html")) {
        return NextResponse.json({ url, status: "ok", links: [], isLeaf: true });
      }

      // Handle Redirects found during HEAD
      if (headResponse.status === 301 || headResponse.status === 302) {
        return handleRedirect(url, headResponse.headers["location"], domain);
      }
    } catch (headError) {
      // Continue to GET if HEAD fails
    }

    // -----------------------------------------------------------------------
    // MAIN FETCH (GET)
    // -----------------------------------------------------------------------
    const response = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: (status) => status < 400 || status === 301 || status === 302,
      timeout: TIMEOUT_MS,
      httpsAgent,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (response.status === 301 || response.status === 302) {
      return handleRedirect(url, response.headers["location"], domain);
    }

    // -----------------------------------------------------------------------
    // PARSING (The Safe Way)
    // -----------------------------------------------------------------------
    // We load the FULL response data to ensure we don't cut off bottom links.
    const $ = cheerio.load(response.data);

    // --- SAFELY REMOVE NOISE ---
    // Instead of cutting the string, we remove the elements from the DOM.
    // This ensures we keep the main content even if the page is huge.
    $(".header, .navigation, .header-search").remove(); // Top
    $(".footer-container, .footer-addapex-adds, #footer").remove(); // Bottom
    $('.sideadds, .widget, [id^="ad-"]').remove(); // Sidebars & Ads
    $(".breadcrumb").remove();

    // Remove "Related" sections which cause loops
    $(".top-color").next(".row").remove();
    $(".top-color").remove();
    $("#related_colorings").remove();

    // Check for "Download" button (Leaf Node Logic)
    const hasDownloadBtn = $("#btndownload").length > 0 || $(".btn-download").length > 0;
    if (hasDownloadBtn) {
      return NextResponse.json({ url, status: "ok", links: [], isLeaf: true });
    }

    // Extract Links from what remains (The Main Content)
    const extractedLinks = new Set<string>();

    $("a[href]").each((_, element) => {
      let href = $(element).attr("href")?.trim();
      if (!href) return;

      if (href.startsWith("/")) href = domain + href;
      if (!href.startsWith(domain)) return;

      try {
        const urlObj = new URL(href);
        if (excludedLangsRegex.test(urlObj.pathname)) return;
      } catch (e) {
        return;
      }

      // Filter junk
      if (href.includes("/wp-admin") || href.includes("/wp-content") || href.includes("#") || href.includes("?")) return;
      if (href === url) return;

      extractedLinks.add(href);
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

// Helper for Redirects
function handleRedirect(originalUrl: string, locationHeader: string | undefined, domain: string) {
  if (!locationHeader) {
    return NextResponse.json({ url: originalUrl, status: "broken", redirectLocation: null, isLeaf: true });
  }
  try {
    const absoluteRedirect = new URL(locationHeader, domain).href;
    const cleanTarget = absoluteRedirect
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .split("#")[0];
    const cleanHome = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (cleanTarget === cleanHome) {
      return NextResponse.json({ url: originalUrl, status: "soft-404", redirectLocation: absoluteRedirect, links: [], isLeaf: true });
    }
    return NextResponse.json({ url: originalUrl, status: "redirect", redirectLocation: absoluteRedirect, links: [absoluteRedirect], isLeaf: false });
  } catch (e) {
    return NextResponse.json({ url: originalUrl, status: "error", redirectLocation: null, isLeaf: true });
  }
}
