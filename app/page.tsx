"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Bug, CheckCircle2, Copy, Globe, Loader2, Play, StopCircle, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

// Data Structure
type CrawlResult = {
  url: string;
  status: "queued" | "crawling" | "checked" | "broken";
  redirectUrl?: string;
  source?: string;
};

export default function CrawlerPage() {
  // CONFIG
  const [startUrl, setStartUrl] = useState("https://coloringonly.com");
  const [maxPages, setMaxPages] = useState(1000);

  // STATE
  const resultsRef = useRef<Map<string, CrawlResult>>(new Map());
  const [resultsMap, setResultsMap] = useState<Map<string, CrawlResult>>(new Map());

  const [queue, setQueue] = useState<string[]>([]);
  const [isCrawling, setIsCrawling] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  const shouldStop = useRef(false);

  // 🛡️ THE SAFETY GUARD: Tracks every URL we have ever queued
  const visitedRef = useRef<Set<string>>(new Set());

  // STATS
  const brokenLinks = Array.from(resultsMap.values()).filter((r) => r.status === "broken");

  // ==============================
  // 🛠️ HELPER: NORMALIZE URL
  // ==============================
  // This prevents duplicates like "site.com/a" and "site.com/a/"
  const normalizeUrl = (urlStr: string) => {
    try {
      const u = new URL(urlStr);
      // Remove trailing slash and lower case for comparison
      const cleanPath = u.pathname.replace(/\/+$/, "");
      return (u.origin + cleanPath + u.search).toLowerCase();
    } catch (e) {
      return urlStr.toLowerCase();
    }
  };

  // ==============================
  // 🕷️ CRAWLER LOGIC
  // ==============================
  const startCrawl = async () => {
    if (!startUrl) return alert("Enter a URL");

    // Reset
    shouldStop.current = false;
    visitedRef.current = new Set();
    resultsRef.current = new Map();

    // Normalize Start URL
    const normStart = normalizeUrl(startUrl);

    // Add Start URL to Guards
    visitedRef.current.add(normStart);
    resultsRef.current.set(normStart, { url: startUrl, status: "queued", source: "Start" });

    setQueue([startUrl]);
    setResultsMap(new Map(resultsRef.current));
    setProcessedCount(0);
    setIsCrawling(true);

    processQueue([startUrl]);
  };

  const processQueue = async (initialQueue: string[]) => {
    let currentQueue = [...initialQueue];
    const BATCH_SIZE = 5;

    while (currentQueue.length > 0 && !shouldStop.current) {
      // Safety Break
      if (visitedRef.current.size > maxPages) {
        shouldStop.current = true;
        alert(`Reached limit of ${maxPages} pages. Stopping.`);
        break;
      }

      // 1. Take a Batch
      const batch = currentQueue.splice(0, BATCH_SIZE);

      // Update UI Status
      batch.forEach((url) => {
        const norm = normalizeUrl(url);
        updateResultRef(norm, { status: "crawling" });
      });
      syncState();

      // 2. Process Batch in Parallel
      const newLinksFound: string[] = [];

      await Promise.all(
        batch.map(async (currentUrl) => {
          const normCurrent = normalizeUrl(currentUrl);

          try {
            // A. CHECK LINK
            const checkRes = await fetch("/api/check", {
              method: "POST",
              body: JSON.stringify({ url: currentUrl }),
            });
            const checkData = await checkRes.json();

            if (checkData.isBroken) {
              updateResultRef(normCurrent, { status: "broken", redirectUrl: checkData.finalUrl });
              // 🛑 If broken, we do NOT scrape it for more links
            } else {
              updateResultRef(normCurrent, { status: "checked", redirectUrl: checkData.finalUrl });

              // B. SCRAPE (Only if valid)
              const scrapeRes = await fetch("/api/scrape", {
                method: "POST",
                body: JSON.stringify({ url: currentUrl }),
              });
              const scrapeData = await scrapeRes.json();

              if (scrapeData.success && scrapeData.links.length > 0) {
                // 🛡️ CRITICAL LOOP PREVENTION HERE 🛡️
                scrapeData.links.forEach((rawLink: string) => {
                  const normLink = normalizeUrl(rawLink);

                  // 1. CHECK IF VISITED
                  if (!visitedRef.current.has(normLink)) {
                    // 2. MARK AS VISITED IMMEDIATELY
                    visitedRef.current.add(normLink);

                    // 3. ADD TO NEXT QUEUE
                    newLinksFound.push(rawLink);

                    // 4. ADD TO UI MAP
                    resultsRef.current.set(normLink, {
                      url: rawLink,
                      status: "queued",
                      source: currentUrl,
                    });
                  }
                });
              }
            }
          } catch (e) {
            updateResultRef(normCurrent, { status: "broken", redirectUrl: "Network Error" });
          }
        })
      );

      // 3. Add new unique links to queue
      if (newLinksFound.length > 0) {
        currentQueue.push(...newLinksFound);
      }

      // 4. Update UI
      setQueue([...currentQueue]);
      setProcessedCount((prev) => prev + batch.length);
      syncState();

      // Tiny delay
      await new Promise((r) => setTimeout(r, 100));
    }

    setIsCrawling(false);
  };

  const updateResultRef = (normUrl: string, updates: Partial<CrawlResult>) => {
    // We use the normalized URL as the Key to prevent duplicates in the Map
    const existing = resultsRef.current.get(normUrl);
    if (existing) {
      resultsRef.current.set(normUrl, { ...existing, ...updates });
    }
  };

  const syncState = () => {
    setResultsMap(new Map(resultsRef.current));
  };

  const stopCrawl = () => {
    shouldStop.current = true;
    setIsCrawling(false);
  };

  return (
    <div className="container mx-auto py-8 max-w-7xl space-y-6">
      {/* HEADER */}
      <div className="flex justify-between items-center border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Full Site Crawler</h1>
          <p className="text-muted-foreground">Recursively finds all pages and checks for redirects.</p>
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <Badge variant="outline" className="text-slate-600 gap-2">
            <Globe size={14} /> Visited: {processedCount}
          </Badge>
          <Badge variant="outline" className="text-blue-600 gap-2">
            <Loader2 size={14} className={isCrawling ? "animate-spin" : ""} /> Queue: {queue.length}
          </Badge>
          <Badge variant="destructive" className="gap-2">
            <Bug size={14} /> Broken: {brokenLinks.length}
          </Badge>
        </div>
      </div>

      {/* CONTROLS */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4 items-end">
          <div className="grid w-full gap-1.5">
            <label className="text-sm font-medium">Start URL</label>
            <Input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} disabled={isCrawling} />
          </div>
          <div className="grid w-40 gap-1.5">
            <label className="text-sm font-medium">Max Pages</label>
            <Input type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} disabled={isCrawling} />
          </div>
          <div className="flex gap-2">
            {!isCrawling ? (
              <Button onClick={startCrawl} className="w-32 bg-blue-600 hover:bg-blue-700">
                <Play className="w-4 h-4 mr-2" /> Start
              </Button>
            ) : (
              <Button onClick={stopCrawl} variant="destructive" className="w-32">
                <StopCircle className="w-4 h-4 mr-2" /> Stop
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                resultsRef.current = new Map();
                setResultsMap(new Map());
                setQueue([]);
                setProcessedCount(0);
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* PROGRESS */}
      {isCrawling && (
        <Card className="bg-blue-50/50 border-blue-100">
          <CardContent className="pt-6">
            <div className="flex justify-between text-xs font-medium text-slate-500 mb-2">
              <span>Crawling Queue...</span>
              <span>{queue.length} remaining</span>
            </div>
            <Progress value={isCrawling ? undefined : 100} className="h-2 animate-pulse" />
          </CardContent>
        </Card>
      )}

      {/* BROKEN LINKS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Live Log */}
        <Card className="lg:col-span-2 h-[600px] flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle>Live Crawl Log</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            <Table>
              <TableHeader className="sticky top-0 bg-white z-10">
                <TableRow>
                  <TableHead className="w-[70%]">URL</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Show last 50 processed items from STATE MAP */}
                {Array.from(resultsMap.values())
                  .slice(-50)
                  .reverse()
                  .map((row) => (
                    <TableRow key={row.url}>
                      <TableCell className="font-mono text-xs">
                        <div className="truncate max-w-[400px]" title={row.url}>
                          {row.url}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.status === "queued" && (
                          <Badge variant="secondary" className="text-[10px]">
                            Queue
                          </Badge>
                        )}
                        {row.status === "crawling" && <Badge className="bg-blue-500 text-[10px]">Scanning</Badge>}
                        {row.status === "checked" && <Badge className="bg-green-600 text-[10px]">OK</Badge>}
                        {row.status === "broken" && (
                          <Badge variant="destructive" className="text-[10px]">
                            Broken
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* RIGHT: Broken Links List */}
        <Card className="h-[600px] flex flex-col border-red-200 shadow-md">
          <CardHeader className="bg-red-50 border-b border-red-100 pb-3">
            <CardTitle className="text-red-800 text-lg flex justify-between items-center">
              <span>Issues ({brokenLinks.length})</span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 bg-white text-red-700 border-red-200"
                onClick={() => navigator.clipboard.writeText(brokenLinks.map((l) => l.url).join("\n"))}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
            {brokenLinks.length === 0 && (
              <div className="text-center text-slate-400 text-sm mt-20">
                <CheckCircle2 size={48} className="mx-auto mb-2 opacity-20" />
                <p>No broken links found yet.</p>
              </div>
            )}
            {brokenLinks.map((link) => (
              <div key={link.url} className="bg-red-50 p-3 rounded border border-red-100 text-xs break-all">
                <div className="font-bold text-red-700 mb-1 flex items-center gap-1">
                  <AlertTriangle size={12} /> Broken / Redirect
                </div>
                <div className="text-slate-600 mb-2">{link.url}</div>
                <div className="text-[10px] text-slate-400">
                  Found on: <span className="underline">{link.source}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
