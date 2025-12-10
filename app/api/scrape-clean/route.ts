import axios from "axios";
import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    const urlObj = new URL(url);

    // 1. GATEKEEPER: Block Foreign Languages & Files Immediately
    const path = urlObj.pathname.toLowerCase();
    if (/^\/[a-z]{2}\//.test(path) || path.match(/\.(jpg|jpeg|png|gif|webp|pdf|css|js)$/i)) {
      return NextResponse.json({ success: true, isFinalPage: true, total: 0, links: [] });
    }

    // 2. FAST FETCH (Timeout set to 10s to keep queue moving)
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // =========================================================
    // 🛑 STOP LOGIC: Leaf Node Detection
    // =========================================================
    // Based on Page 3, 5, 6: These elements indicate a final coloring page
    const isLeafNode =
      $("#btndownload").length > 0 || $("#printButton").length > 0 || $("#canvasDiv").length > 0 || $("body").hasClass("single-attachment");

    if (isLeafNode) {
      return NextResponse.json({ success: true, isFinalPage: true, total: 0, links: [] });
    }

    // =========================================================
    // 🧹 SURGICAL REMOVAL (Based on your provided HTML)
    // =========================================================

    // 1. Remove Navigation & Header (Page 1, 2, 4)
    $(".header").remove();
    $(".navigation-wrapper").remove();
    $(".navbar").remove();
    $(".breadcrumb").remove(); // Breadcrumbs create duplicate back-links

    // 2. Remove Sidebars (Page 2, 5)
    // The "Recently Added" and "Categories" lists are inside #post-widget and .widget
    $("#post-widget").remove();
    $(".widget").remove();

    // 3. Remove Ads (Page 1, 4)
    $(".sideadds").remove();
    $(".ads-min-1366").remove();
    $(".ads-min-768").remove();
    $(".search_ads").remove();
    $(".footer-addapex-adds").remove();
    $(".inbetween-mobile").remove();
    $(".inbetween_desktop_full_page").remove();

    // 4. Remove Related Content (Page 2, 3, 5)
    // We don't want to crawl "Related" because it creates circular loops.
    // We only want the main list of the current category.
    $("#related_colorings").remove();
    $("#sp-rl").remove();

    // 5. Remove Footer & Popups (All Pages)
    $(".footer-container").remove();
    $(".wpml-ls-statics-footer").remove(); // Language flags
    $("#toTop").remove();
    $("#NewsletterModal").remove();
    $("#exitpopup-modal").remove();

    // 6. Remove Scripts/Iframes (Technical noise)
    $("script").remove();
    $("iframe").remove();
    $("noscript").remove();
    $("style").remove();

    // =========================================================
    // 🟢 TARGETED EXTRACTION
    // =========================================================
    const uniqueLinks = new Set<string>();
    const targetHostname = urlObj.hostname.replace("www.", "");

    // Strategy:
    // 1. If we see a specific Gallery Grid (.gallery-post-grid), prefer that.
    // 2. If we see the Main Content Column (.column-main-blog), prefer that.
    // 3. Fallback to body.
    let selector = "body a";

    if ($(".gallery-post-grid").length > 0) {
      selector = ".gallery-post-grid a"; // Precision Mode for Categories
    } else if ($(".column-main-blog").length > 0) {
      selector = ".column-main-blog a"; // Precision Mode for Home
    }

    $(selector).each((_, element) => {
      let href = $(element).attr("href");
      if (href) {
        href = href.trim();
        if (href.startsWith("javascript:") || href.startsWith("#") || href === "") return;

        try {
          const absoluteUrlObj = new URL(href, url);
          const linkHostname = absoluteUrlObj.hostname.replace("www.", "");
          const linkPath = absoluteUrlObj.pathname.toLowerCase();

          // Double Check Filters
          if (linkPath.match(/\.(jpg|jpeg|png|gif|webp|pdf)$/i)) return;
          if (/^\/[a-z]{2}\//.test(linkPath)) return;

          // Strict Domain Check
          if (linkHostname.includes(targetHostname)) {
            uniqueLinks.add(absoluteUrlObj.href);
          }
        } catch (e) {}
      }
    });

    const extractedLinks = Array.from(uniqueLinks);

    return NextResponse.json({
      success: true,
      isFinalPage: false,
      total: extractedLinks.length,
      links: extractedLinks,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
