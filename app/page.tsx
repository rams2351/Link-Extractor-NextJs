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
  source?: string; // Which page found this link?
};

export default function CrawlerPage() {
  // CONFIG
  const [startUrl, setStartUrl] = useState("https://coloringonly.com");
  const [maxPages, setMaxPages] = useState(1000); // Safety limit

  // STATE
  const [results, setResults] = useState<Map<string, CrawlResult>>(new Map());
  const [queue, setQueue] = useState<string[]>([]);
  const [isCrawling, setIsCrawling] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  // REFS (For mutable state in loops)
  const shouldStop = useRef(false);
  const visitedRef = useRef<Set<string>>(new Set());

  // STATS
  const brokenLinks = Array.from(results.values()).filter((r) => r.status === "broken");
  const progress = (processedCount / (processedCount + queue.length || 1)) * 100;

  // ==============================
  // 🕷️ CRAWLER LOGIC
  // ==============================
  const startCrawl = async () => {
    if (!startUrl) return alert("Enter a URL");

    // Reset
    shouldStop.current = false;
    visitedRef.current = new Set();
    visitedRef.current.add(startUrl);

    setQueue([startUrl]);
    setResults(new Map([[startUrl, { url: startUrl, status: "queued", source: "Start" }]]));
    setProcessedCount(0);
    setIsCrawling(true);

    // Initial Kickoff
    processQueue([startUrl]);
  };

  const processQueue = async (initialQueue: string[]) => {
    let currentQueue = [...initialQueue];

    // We run a loop as long as there are items and we haven't stopped
    while (currentQueue.length > 0 && !shouldStop.current) {
      // Safety Break
      if (visitedRef.current.size > maxPages) {
        shouldStop.current = true;
        alert(`Reached limit of ${maxPages} pages. Stopping.`);
        break;
      }

      // 1. Take the next URL
      const currentUrl = currentQueue.shift();
      if (!currentUrl) break;

      // Update UI to show we are working on this one
      updateResult(currentUrl, { status: "crawling" });

      try {
        // ==========================
        // STEP A: CHECK THE LINK (Is it broken?)
        // ==========================
        const checkRes = await fetch("/api/check", {
          method: "POST",
          body: JSON.stringify({ url: currentUrl }),
        });
        const checkData = await checkRes.json();

        if (checkData.isBroken) {
          // If broken (or redirects home), mark it and DO NOT crawl deeper
          updateResult(currentUrl, {
            status: "broken",
            redirectUrl: checkData.finalUrl,
          });
        } else {
          // If valid, mark checked
          updateResult(currentUrl, {
            status: "checked",
            redirectUrl: checkData.finalUrl,
          });

          // ==========================
          // STEP B: SCRAPE FOR MORE LINKS (Recursion)
          //Only crawl if it's the same domain to prevent leaving the site
          // ==========================
          const scrapeRes = await fetch("/api/scrape", {
            method: "POST",
            body: JSON.stringify({ url: currentUrl }),
          });
          const scrapeData = await scrapeRes.json();

          if (scrapeData.success && scrapeData.links.length > 0) {
            const newLinks: string[] = [];

            scrapeData.links.forEach((link: string) => {
              // Only add if we haven't seen it yet
              if (!visitedRef.current.has(link)) {
                visitedRef.current.add(link);
                newLinks.push(link);

                // Add to results map so it shows in UI
                setResults((prev) => {
                  const next = new Map(prev);
                  next.set(link, { url: link, status: "queued", source: currentUrl });
                  return next;
                });
              }
            });

            // Add new links to the END of the queue (BFS - Breadth First Search)
            currentQueue.push(...newLinks);
            setQueue([...currentQueue]); // Update UI counter
          }
        }
      } catch (e) {
        updateResult(currentUrl, { status: "broken", redirectUrl: "Network Error" });
      }

      setProcessedCount((prev) => prev + 1);

      // 🛑 SPEED CONTROL: Wait 500ms between requests to be nice to the server
      await new Promise((r) => setTimeout(r, 500));
    }

    setIsCrawling(false);
  };

  const updateResult = (url: string, updates: Partial<CrawlResult>) => {
    setResults((prev) => {
      const next = new Map(prev);
      const existing = next.get(url) || { url, status: "queued" };
      next.set(url, { ...existing, ...updates });
      return next;
    });
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
                setResults(new Map());
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

      {/* BROKEN LINKS SECTION (Main Focus) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Live Log (Optional, shows what is happening) */}
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
                {/* Show last 50 processed items first */}
                {Array.from(results.values())
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
