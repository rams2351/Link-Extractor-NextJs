import axios from "axios";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { url } = await request.json();
  try {
    // 1. FETCH WITH USER-AGENT (Crucial for avoiding blocks)
    const response = await axios.get(url, {
      maxRedirects: 5,
      validateStatus: () => true, // Resolve all statuses
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const finalUrl = response.request?.res?.responseUrl || url;

    // 2. NORMALIZE (Ignore trailing slashes for comparison)
    const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, "");

    const originalNorm = normalize(url);
    const finalNorm = normalize(finalUrl);

    // Dynamic Home Detection (e.g. https://coloringonly.com)
    const homeNorm = normalize(new URL(url).origin);

    let status = "OK";
    let isBroken = false;
    let reason = "";

    // 3. BROKEN LOGIC
    if (response.status === 404) {
      status = "404 Not Found";
      isBroken = true;
      reason = "Page Not Found";
    }
    // If it redirects to Home, AND it wasn't the home page originally
    else if (finalNorm === homeNorm && originalNorm !== homeNorm) {
      status = "Redirected to Home";
      isBroken = true;
      reason = "Redirected to Homepage";
    }
    // Handle 403 Forbidden (often firewalls) or 500 Errors
    else if (response.status !== 200) {
      status = `Status ${response.status}`;
      isBroken = true;
      reason = `Server Error (${response.status})`;
    }

    return NextResponse.json({
      originalUrl: url,
      finalUrl: finalUrl,
      status: status,
      isBroken: isBroken,
      reason: reason,
    });
  } catch (error: any) {
    return NextResponse.json({
      originalUrl: url,
      finalUrl: null,
      status: "Network Error",
      isBroken: true,
      reason: error.message || "Failed to connect",
    });
  }
}
