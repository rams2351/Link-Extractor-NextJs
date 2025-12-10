"use client";

import axios from "axios";
import { Activity, AlertTriangle, Download, Pause, Play, Save, Trash2, Upload } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

// --- Types ---
type LinkStatus = "ok" | "broken" | "soft-404" | "redirect" | "error";

interface BrokenReportItem {
  brokenLink: string;
  redirectedTo: string | null;
  foundOnPage: string;
  status: LinkStatus;
}

interface QueueItem {
  url: string;
  parent: string;
}

interface CrawlerState {
  queue: QueueItem[];
  visited: string[];
  brokenLinks: BrokenReportItem[];
}

interface LiveScanItem {
  url: string;
  foundCount: number;
  status: LinkStatus;
}

// --- HELPER: STRICT NORMALIZATION ---
// This prevents 'page/' and 'page' from being seen as two different links
const normalizeUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    // 1. Force Lowercase (WordPress is usually case-insensitive)
    // 2. Remove Trailing Slash
    let cleanPath = urlObj.pathname.toLowerCase();
    if (cleanPath.endsWith("/") && cleanPath.length > 1) {
      cleanPath = cleanPath.slice(0, -1);
    }
    // 3. Rebuild without Query Params (unless strictly needed)
    // This kills ?orderby=, ?source=, etc.
    return `${urlObj.origin}${cleanPath}`;
  } catch (e) {
    return url;
  }
};

export default function Crawler() {
  const [isRunning, setIsRunning] = useState(false);
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [liveFeed, setLiveFeed] = useState<LiveScanItem[]>([]);

  const [stats, setStats] = useState({
    queued: 1,
    visited: 0,
    broken: 0,
    soft404: 0,
  });

  // --- REFS ---
  const queue = useRef<QueueItem[]>([{ url: "https://coloringonly.com", parent: "ROOT" }]);
  // Track what we have finished scanning
  const visited = useRef<Set<string>>(new Set(["https://coloringonly.com"]));
  // Track what is currently waiting in line (PREVENTS DUPLICATES IN QUEUE)
  const queuedRegistry = useRef<Set<string>>(new Set(["https://coloringonly.com"]));

  const brokenLinks = useRef<BrokenReportItem[]>([]);

  const MAX_CONCURRENCY = 15; // Increased for speed

  // --- CORE CRAWL LOGIC ---
  const crawlStep = useCallback(async () => {
    if (queue.current.length === 0) {
      setIsRunning(false);
      return;
    }

    const currentItem = queue.current.shift();
    if (!currentItem) return;

    // Remove from registry so we can technically re-queue if needed (though usually we won't)
    // But mostly we keep it in 'visited' once done.

    try {
      setActiveWorkers((prev) => prev + 1);

      const { data } = await axios.post("/api/crawl", { url: currentItem.url });

      // Update Live Feed
      setLiveFeed((prev) =>
        [
          {
            url: currentItem.url,
            foundCount: data.links?.length || 0,
            status: data.status,
          },
          ...prev,
        ].slice(0, 8)
      );

      // 1. Handle Errors
      if (data.status === "broken" || data.status === "soft-404" || data.status === "error") {
        brokenLinks.current.push({
          brokenLink: currentItem.url,
          redirectedTo: data.redirectLocation || null,
          foundOnPage: currentItem.parent,
          status: data.status,
        });
      }

      // 2. Handle Discovery (The Deduplication Logic)
      if ((data.status === "ok" || data.status === "redirect") && !data.isLeaf) {
        if (data.links && data.links.length > 0) {
          data.links.forEach((rawLink: string) => {
            const cleanLink = normalizeUrl(rawLink);

            // CHECK 1: Have we visited this already?
            if (visited.current.has(cleanLink)) return;

            // CHECK 2: Is it already waiting in the queue?
            if (queuedRegistry.current.has(cleanLink)) return;

            // If new, add to Queue AND Registry
            queuedRegistry.current.add(cleanLink);
            queue.current.push({
              url: rawLink, // Keep original casing for fetch, but logic uses clean
              parent: currentItem.url,
            });
          });
        }
      }

      // Mark as fully visited
      visited.current.add(normalizeUrl(currentItem.url));

      // UI Updates
      setStats((prev) => ({
        queued: queue.current.length,
        visited: visited.current.size,
        broken: brokenLinks.current.filter((l) => l.status === "broken" || l.status === "error").length,
        soft404: brokenLinks.current.filter((l) => l.status === "soft-404").length,
      }));
    } catch (err) {
      brokenLinks.current.push({
        brokenLink: currentItem.url,
        redirectedTo: null,
        foundOnPage: currentItem.parent,
        status: "error",
      });
    } finally {
      setActiveWorkers((prev) => prev - 1);
    }
  }, []);

  // --- LOOP ---
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      if (activeWorkers < MAX_CONCURRENCY && queue.current.length > 0) {
        crawlStep();
      }
    }, 20); // Very fast check cycle
    return () => clearInterval(timer);
  }, [isRunning, activeWorkers, crawlStep]);

  // --- ACTIONS ---
  const downloadReport = () => {
    const content = JSON.stringify(brokenLinks.current, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `broken-links-report.json`;
    document.body.appendChild(link);
    link.click();
  };

  const saveProgress = () => {
    const state: CrawlerState = {
      queue: queue.current,
      visited: Array.from(visited.current),
      brokenLinks: brokenLinks.current,
    };
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });

    // --- FIX START ---
    const url = URL.createObjectURL(blob); // Create the URL from the blob here
    const link = document.createElement("a");
    link.href = url; // Now 'url' is defined
    // --- FIX END ---

    link.download = `crawler-state-${visited.current.size}.json`;
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setIsRunning(false);
  };
  const loadProgress = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target?.result as string) as CrawlerState;

        // Restore Queue
        queue.current = state.queue;

        // Restore Visited Set
        visited.current = new Set(state.visited);

        // Rebuild Registry from Queue (Critical step)
        queuedRegistry.current = new Set(state.queue.map((i) => normalizeUrl(i.url)));

        brokenLinks.current = state.brokenLinks;

        setStats({
          queued: state.queue.length,
          visited: state.visited.length,
          broken: state.brokenLinks.length,
          soft404: 0,
        });
        alert(`Loaded! Resume from ${state.visited.length} scanned pages.`);
      } catch (err) {
        alert("Invalid File");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6 font-sans text-slate-900">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-bold shadow-md">CO</div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">ColoringOnly Integrity Scanner</h1>
              <div className="flex gap-4 text-xs font-medium text-slate-500 mt-0.5">
                <span>
                  Queue: <b className="text-indigo-600">{stats.queued.toLocaleString()}</b>
                </span>
                <span>
                  Scanned: <b className="text-emerald-600">{stats.visited.toLocaleString()}</b>
                </span>
                <span className="text-orange-600">
                  Soft 404: <b>{stats.soft404}</b>
                </span>
                <span className="text-red-600">
                  Broken: <b>{stats.broken}</b>
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <label className="btn-secondary">
              <Upload size={14} /> Load
              <input type="file" onChange={loadProgress} className="hidden" accept=".json" />
            </label>
            <button onClick={saveProgress} className="btn-secondary">
              <Save size={14} /> Save
            </button>
            <button onClick={downloadReport} className="btn-secondary text-blue-600 bg-blue-50 border-blue-200">
              <Download size={14} /> JSON
            </button>
            <div className="w-px h-8 bg-slate-200 mx-1"></div>
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`px-5 py-2 rounded-lg font-bold text-white flex items-center gap-2 transition shadow-sm ${
                isRunning ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {isRunning ? (
                <>
                  <Pause size={16} /> PAUSE
                </>
              ) : (
                <>
                  <Play size={16} /> START
                </>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[700px]">
          {/* Live Activity */}
          <div className="lg:col-span-1 bg-slate-900 text-slate-300 rounded-xl overflow-hidden flex flex-col shadow-lg border border-slate-700">
            <div className="p-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Activity size={14} /> Real-Time
              </h3>
              <span className="text-[10px] bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded border border-indigo-700">{activeWorkers} Threads</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-700">
              {liveFeed.map((item, i) => (
                <div key={i} className="text-xs border-b border-slate-700/50 pb-2 mb-2 last:border-0 animate-in fade-in slide-in-from-left-2">
                  <div className="flex justify-between mb-1">
                    <StatusBadge status={item.status} />
                    <span className="text-slate-500">{item.foundCount} links</span>
                  </div>
                  <div className="truncate text-slate-400 font-mono opacity-80" title={item.url}>
                    {item.url}
                  </div>
                </div>
              ))}
              {liveFeed.length === 0 && <div className="text-center mt-20 text-slate-600 text-xs italic">System Idle</div>}
            </div>
          </div>

          {/* Report Table */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col max-h-[500ppx] overflow-y-auto">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-xl">
              <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" /> Detected Issues
              </h3>
              <button
                onClick={() => {
                  brokenLinks.current = [];
                  setStats((s) => ({ ...s, broken: 0, soft404: 0 }));
                }}
                className="text-xs text-red-500 flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded border border-transparent hover:border-red-100 transition"
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-200">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 text-slate-500 text-[11px] uppercase font-bold sticky top-0 z-10 shadow-sm tracking-wide">
                  <tr>
                    <th className="p-3 w-20">Status</th>
                    <th className="p-3 w-1/3">Broken Link</th>
                    <th className="p-3 w-1/4">Redirected To</th>
                    <th className="p-3">Found On Page</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-slate-100 font-mono text-slate-600">
                  {brokenLinks.current.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50 group transition-colors">
                      <td className="p-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="p-3 text-red-600 font-medium break-all pr-4 relative">
                        <a href={item.brokenLink} target="_blank" className="hover:underline flex gap-1 items-start">
                          {item.brokenLink}
                        </a>
                      </td>
                      <td className="p-3 text-slate-400 break-all pr-4">
                        {item.redirectedTo ? (
                          <a href={item.redirectedTo} target="_blank" className="text-blue-500 hover:underline">
                            {item.redirectedTo}
                          </a>
                        ) : (
                          <span className="opacity-20">-</span>
                        )}
                      </td>
                      <td className="p-3 break-all">
                        <a href={item.foundOnPage} target="_blank" className="text-slate-500 hover:text-indigo-600 hover:underline">
                          {item.foundOnPage}
                        </a>
                      </td>
                    </tr>
                  ))}
                  {brokenLinks.current.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-20 text-center text-slate-300 italic text-sm">
                        No issues found yet. <br /> Starting crawling to detect broken links...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <span className="text-emerald-500 font-bold text-[10px]">OK</span>;
  if (status === "redirect") return <span className="text-blue-500 font-bold text-[10px]">REDIRECT</span>;
  if (status === "soft-404")
    return (
      <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-200 block text-center">
        SOFT 404
      </span>
    );
  return <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold border border-red-200 block text-center">BROKEN</span>;
}

const btnSecondary =
  "flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-700 transition cursor-pointer shadow-sm";
