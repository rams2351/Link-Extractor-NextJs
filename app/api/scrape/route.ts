import axios from "axios";
import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    const urlObj = new URL(url);
    const pathCheck = urlObj.pathname.toLowerCase();

    // =========================================================
    // 🛡️ GATEKEEPER: Block Non-English Inputs
    // =========================================================
    // We now use a Regex to block ANY 2-letter language code at the start.
    // This blocks /fr/, /de/, /pt/, /es/, /it/, /ru/, etc.
    // It will NOT block /category/, /games/, etc. because they are longer than 2 letters.
    const isForeignLanguage = /^\/[a-z]{2}\//.test(pathCheck);

    if (isForeignLanguage) {
      return NextResponse.json({
        success: true,
        isFinalPage: true, // Treat as dead end
        total: 0,
        links: [],
      });
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // =========================================================
    // 🧹 NOISE REMOVAL
    // =========================================================
    // Remove Standard Elements
    $(".header, .navigation-wrapper, .footer-container, #toTop").remove();
    $("#post-widget, .widget, .newpost, .right_col, .left_col").remove();
    $("#related_colorings, #sp-rl").remove();

    // Remove Language Switchers (WPML)
    $(".wpml-ls-statics-footer, .wpml-ls, .wpml-ls-legacy-list-horizontal").remove();

    // =========================================================
    // 🛑 STOP LOGIC: Detect "Final Page"
    // =========================================================
    const isFinalPage = $("#btndownload").length > 0 || $("body").hasClass("single-attachment");

    if (isFinalPage) {
      return NextResponse.json({ success: true, isFinalPage: true, total: 0, links: [] });
    }

    // =========================================================
    // 🟢 EXTRACT LINKS
    // =========================================================
    const uniqueLinks = new Set<string>();
    const targetHostname = urlObj.hostname.replace("www.", "");

    $("body a").each((_, element) => {
      let href = $(element).attr("href");
      if (href) {
        href = href.trim();
        if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href === "#" || href === "") return;

        try {
          const absoluteUrlObj = new URL(href, url);
          const absoluteUrl = absoluteUrlObj.href;
          const linkHostname = absoluteUrlObj.hostname.replace("www.", "");
          const linkPath = absoluteUrlObj.pathname.toLowerCase();

          // 🛡️ FILTER 1: Strict Language Block
          // Checks if the link starts with /fr/, /de/, /pt/, /es/, etc.
          if (/^\/[a-z]{2}\//.test(linkPath)) {
            return;
          }

          // 🛡️ FILTER 2: Block Image Files & Directories
          if (linkPath.includes("/images/") || linkPath.match(/\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i)) {
            return;
          }

          // Strict Domain Check
          if (linkHostname.includes(targetHostname)) {
            uniqueLinks.add(absoluteUrl);
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
