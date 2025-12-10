import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Create a custom agent to handle SSL/KeepAlive issues robustly
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false, // Helps if there are minor SSL certificate issues
});

export async function POST(request: Request) {
  let { url } = await request.json();
  const domain = "https://coloringonly.com";
  const excludedLangsRegex = /\/(es|pt|fr|de|it|ru|nl)(\/|$)/;

  try {
    const response = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: (status) => status < 400 || status === 301 || status === 302,
      timeout: 25000, // Increased to 25s for slower pages
      httpsAgent,
      headers: {
        // Mims real Chrome browser to avoid being blocked
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    // --- REDIRECT LOGIC ---
    if (response.status === 301 || response.status === 302) {
      const locationHeader = response.headers["location"];
      if (!locationHeader) return NextResponse.json({ url, status: "broken", redirectLocation: null, isLeaf: true });

      const absoluteRedirect = new URL(locationHeader, domain).href;
      const cleanTarget = absoluteRedirect
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .split("#")[0];
      const cleanHome = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

      if (cleanTarget === cleanHome) {
        return NextResponse.json({
          url,
          status: "soft-404",
          redirectLocation: absoluteRedirect,
          links: [],
          isLeaf: true,
        });
      }

      return NextResponse.json({
        url,
        status: "redirect",
        redirectLocation: absoluteRedirect,
        links: [absoluteRedirect],
        isLeaf: false,
      });
    }

    // --- PARSING ---
    const $ = cheerio.load(response.data);

    // Remove Noise
    $('.header, .navigation, .footer-container, .sideadds, .widget, .breadcrumb, [id^="ad-"], .header-search').remove();
    $(".top-color").next(".row").remove();
    $(".top-color").remove();

    // Leaf Check
    const hasDownloadBtn = $("#btndownload").length > 0 || $(".btn-download").length > 0;
    if (hasDownloadBtn) {
      return NextResponse.json({ url, status: "ok", links: [], isLeaf: true });
    }

    // Extract Links
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
      if (href.includes("/wp-admin") || href.includes("/wp-content") || href.includes("#") || href === url) return;
      extractedLinks.add(href);
    });

    return NextResponse.json({ url, status: "ok", links: Array.from(extractedLinks), isLeaf: false });
  } catch (error: any) {
    const status = error.response?.status === 404 ? "broken" : "error";
    return NextResponse.json({ url, status, redirectLocation: null, links: [], isLeaf: true });
  }
}
