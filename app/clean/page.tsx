"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, AlertOctagon, Copy, FileDown, GlobeLock, LayoutList, Loader2, Play, Search, StopCircle } from "lucide-react";
import { useRef, useState } from "react";

// Data Structure
type CrawlResult = {
  url: string;
  status: "queued" | "crawling" | "active" | "final" | "broken";
  redirectUrl?: string;
  source?: string;
};

export default function CleanCrawlerPage() {
  // CONFIG
  const [startUrl, setStartUrl] = useState("https://coloringonly.com");
  const [maxPages, setMaxPages] = useState(10000);

  // STATE & REFS
  const resultsRef = useRef<Map<string, CrawlResult>>(new Map());
  const queueRef = useRef<string[]>([]);
  const visitedRef = useRef<Set<string>>(new Set());
  const shouldStop = useRef(false);

  // UI STATE
  const [resultsMap, setResultsMap] = useState<Map<string, CrawlResult>>(new Map());
  const [queueCount, setQueueCount] = useState(0);
  const [isCrawling, setIsCrawling] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  // STATS
  const finalPages = Array.from(resultsMap.values()).filter((r) => r.status === "final");
  const brokenLinks = Array.from(resultsMap.values()).filter((r) => r.status === "broken");
  const activePages = Array.from(resultsMap.values()).filter((r) => r.status === "active");

  const normalizeUrl = (urlStr: string) => {
    try {
      const u = new URL(urlStr);
      return (u.origin + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
    } catch (e) {
      return urlStr.toLowerCase();
    }
  };

  const startCrawl = async () => {
    if (!startUrl) return alert("Enter a URL");

    shouldStop.current = false;
    visitedRef.current = new Set();
    resultsRef.current = new Map();
    queueRef.current = [];

    const normStart = normalizeUrl(startUrl);
    visitedRef.current.add(normStart);

    resultsRef.current.set(normStart, { url: startUrl, status: "queued", source: "Start" });
    queueRef.current.push(startUrl);

    setResultsMap(new Map(resultsRef.current));
    setQueueCount(1);
    setProcessedCount(0);
    setIsCrawling(true);

    processQueue();
  };

  const processQueue = async () => {
    const BATCH_SIZE = 10;
    let rootHostname = "";
    try {
      rootHostname = new URL(startUrl).hostname.replace("www.", "");
    } catch (e) {}

    while (queueRef.current.length > 0 && !shouldStop.current) {
      if (visitedRef.current.size > maxPages) {
        shouldStop.current = true;
        alert(`Limit reached (${maxPages}). Stopping.`);
        break;
      }

      const batch = queueRef.current.splice(0, BATCH_SIZE);

      batch.forEach((url) => updateResultRef(normalizeUrl(url), { status: "crawling" }));
      syncUI();

      const newLinksFound: string[] = [];

      await Promise.all(
        batch.map(async (currentUrl) => {
          const normCurrent = normalizeUrl(currentUrl);

          try {
            // 1. CHECK STATUS
            const checkRes = await fetch("/api/check", {
              method: "POST",
              body: JSON.stringify({ url: currentUrl }),
            });
            const checkData = await checkRes.json();

            if (checkData.isBroken) {
              updateResultRef(normCurrent, { status: "broken", redirectUrl: checkData.finalUrl });
              return;
            }
            updateResultRef(normCurrent, { redirectUrl: checkData.finalUrl });

            // 2. CLEAN SCRAPE
            const scrapeRes = await fetch("/api/scrape-clean", {
              method: "POST",
              body: JSON.stringify({ url: currentUrl }),
            });
            const scrapeData = await scrapeRes.json();

            if (scrapeData.isFinalPage) {
              updateResultRef(normCurrent, { status: "final" });
            } else {
              updateResultRef(normCurrent, { status: "active" });

              if (scrapeData.success && scrapeData.links.length > 0) {
                scrapeData.links.forEach((rawLink: string) => {
                  const normLink = normalizeUrl(rawLink);
                  // Strict Domain Guard
                  try {
                    const linkHost = new URL(rawLink).hostname.replace("www.", "");
                    if (linkHost !== rootHostname) return;
                  } catch (e) {
                    return;
                  }

                  if (!visitedRef.current.has(normLink)) {
                    visitedRef.current.add(normLink);
                    newLinksFound.push(rawLink);
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
            updateResultRef(normCurrent, { status: "broken" });
          }
        })
      );

      if (newLinksFound.length > 0) {
        queueRef.current.push(...newLinksFound);
      }

      setProcessedCount((prev) => prev + batch.length);
      syncUI();
      await new Promise((r) => setTimeout(r, 50));
    }
    setIsCrawling(false);
  };

  const updateResultRef = (normUrl: string, updates: Partial<CrawlResult>) => {
    const existing = resultsRef.current.get(normUrl);
    if (existing) resultsRef.current.set(normUrl, { ...existing, ...updates });
  };

  const syncUI = () => {
    setResultsMap(new Map(resultsRef.current));
    setQueueCount(queueRef.current.length);
  };

  const handleCopy = (type: "final" | "broken" | "all") => {
    let list;
    if (type === "final") list = finalPages;
    else if (type === "broken") list = brokenLinks;
    else list = activePages;

    const text = list.map((l) => l.url).join("\n");
    navigator.clipboard.writeText(text);
    alert(`Copied ${list.length} URLs!`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-slate-900">
      {/* 1. HEADER */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-800">
            <GlobeLock className="text-blue-600 h-6 w-6" />
            Ultimate Site Crawler
          </h1>
          <p className="text-sm text-slate-500">Auto-detects leaf nodes. Strips noise. High concurrency.</p>
        </div>

        <div className="flex gap-3 items-end w-full md:w-auto">
          <div className="grid gap-1 flex-1 md:w-80">
            <label className="text-[10px] font-bold text-slate-400 uppercase">Start URL</label>
            <Input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} disabled={isCrawling} className="h-9 font-mono text-xs" />
          </div>
          <div className="grid gap-1 w-24">
            <label className="text-[10px] font-bold text-slate-400 uppercase">Max Pages</label>
            <Input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              disabled={isCrawling}
              className="h-9 text-xs"
            />
          </div>
          <Button onClick={startCrawl} disabled={isCrawling} className="h-9 bg-blue-600 hover:bg-blue-700 w-28">
            {isCrawling ? <Loader2 className="animate-spin w-4 h-4" /> : <Play className="w-4 h-4 mr-1" />} Start
          </Button>
          {isCrawling && (
            <Button onClick={() => (shouldStop.current = true)} variant="destructive" className="h-9">
              <StopCircle className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 2. METRICS */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard label="Processed" value={processedCount} icon={Activity} color="blue" />
        <MetricCard label="Queue Pending" value={queueCount} icon={Search} color="slate" />
        <MetricCard label="Final Pages" value={finalPages.length} icon={FileDown} color="green" />
        <MetricCard label="Broken Links" value={brokenLinks.length} icon={AlertOctagon} color="red" />
      </div>

      {isCrawling && <Progress value={undefined} className="h-1 animate-pulse mb-6" />}

      {/* 3. MAIN DASHBOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
        {/* LEFT: Live Log */}
        <Card className="lg:col-span-2 flex flex-col h-full border-slate-200 shadow-md">
          <CardHeader className="py-3 px-5 border-b bg-slate-50 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutList size={16} /> Live Crawl Log
            </CardTitle>
            <Badge variant="outline" className="bg-white">
              {processedCount} items
            </Badge>
          </CardHeader>
          <div className="flex-1 overflow-auto bg-white">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-50 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[70%] h-8 text-xs">URL</TableHead>
                  <TableHead className="h-8 text-xs text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(resultsMap.values())
                  .slice(-50)
                  .reverse()
                  .map((row) => (
                    <TableRow key={row.url} className="h-9 border-b-slate-50">
                      <TableCell className="py-2 font-mono text-[11px] text-slate-600">
                        <div className="" title={row.url}>
                          {row.url}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <StatusBadge status={row.status} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* RIGHT: Results Tabs */}
        <Card className="flex flex-col h-full border-slate-200 shadow-md overflow-hidden">
          <Tabs defaultValue="final" className="flex flex-col h-full">
            <div className="px-4 pt-4 bg-slate-50 border-b">
              <TabsList className="w-full">
                <TabsTrigger value="final" className="flex-1 text-xs">
                  Final ({finalPages.length})
                </TabsTrigger>
                <TabsTrigger value="broken" className="flex-1 text-xs text-red-600">
                  Broken ({brokenLinks.length})
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Final Pages Tab */}
            <TabsContent value="final" className="flex-1 flex flex-col overflow-hidden p-0 m-0">
              <div className="p-2 border-b flex justify-end bg-white">
                <Button size="sm" variant="ghost" className="h-6 text-xs text-green-700" onClick={() => handleCopy("final")}>
                  <Copy size={12} className="mr-1" /> Copy URLs
                </Button>
              </div>
              <div className="flex-1 overflow-auto bg-white p-0">
                <div className="divide-y divide-slate-100">
                  {finalPages.map((l) => (
                    <div key={l.url} className="px-4 py-2 text-[11px] hover:bg-green-50 flex justify-between group">
                      <span className=" text-green-800">{l.url}</span>
                      <a href={l.url} target="_blank" className="opacity-0 group-hover:opacity-100 text-blue-600 underline">
                        View
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Broken Links Tab */}
            <TabsContent value="broken" className="flex-1 flex flex-col overflow-hidden p-0 m-0">
              <div className="p-2 border-b flex justify-end bg-white">
                <Button size="sm" variant="ghost" className="h-6 text-xs text-red-700" onClick={() => handleCopy("broken")}>
                  <Copy size={12} className="mr-1" /> Copy URLs
                </Button>
              </div>
              <div className="flex-1 overflow-auto bg-white p-0">
                <div className="divide-y divide-slate-100">
                  {brokenLinks.map((l) => (
                    <div key={l.url} className="px-4 py-3 text-[11px] hover:bg-red-50">
                      <div className="text-red-600 font-bold">{l.url}</div>
                      <div className="text-slate-400 text-[10px]">Found on: {l.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

// Sub-components for cleaner code
function MetricCard({ label, value, icon: Icon, color }: any) {
  const colorClasses: any = {
    blue: "text-blue-600 bg-blue-50 border-blue-100",
    slate: "text-slate-600 bg-slate-50 border-slate-200",
    green: "text-green-600 bg-green-50 border-green-100",
    red: "text-red-600 bg-red-50 border-red-100",
  };
  return (
    <Card className={`shadow-sm border ${colorClasses[color]}`}>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold opacity-70 uppercase">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className={`h-8 w-8 opacity-20`} />
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "queued")
    return (
      <Badge variant="secondary" className="text-[10px] h-5 px-1 bg-slate-100 text-slate-500">
        Queue
      </Badge>
    );
  if (status === "crawling") return <Badge className="text-[10px] h-5 px-1 bg-blue-100 text-blue-700 hover:bg-blue-200 border-none">Scanning</Badge>;
  if (status === "final") return <Badge className="text-[10px] h-5 px-1 bg-green-100 text-green-700 hover:bg-green-200 border-none">Final</Badge>;
  if (status === "broken")
    return (
      <Badge variant="destructive" className="text-[10px] h-5 px-1 bg-red-100 text-red-700 hover:bg-red-200 border-none">
        Broken
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] h-5 px-1 text-slate-500">
      Active
    </Badge>
  );
}
