"use client";

import axios from "axios";
import { Activity, AlertTriangle, Download, Pause, Play, Save, Trash2, Upload } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

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

  const queue = useRef<QueueItem[]>([{ url: "https://coloringonly.com/", parent: "ROOT" }]);
  const visited = useRef<Set<string>>(new Set(["https://coloringonly.com/"]));
  const brokenLinks = useRef<BrokenReportItem[]>([]);

  const MAX_CONCURRENCY = 10;

  const crawlStep = useCallback(async () => {
    if (queue.current.length === 0) {
      setIsRunning(false);
      return;
    }
    const currentItem = queue.current.shift();
    if (!currentItem) return;

    try {
      setActiveWorkers((prev) => prev + 1);
      const { data } = await axios.post("/api/crawl", { url: currentItem.url });

      setLiveFeed((prev) =>
        [
          {
            url: currentItem.url,
            foundCount: data.links?.length || 0,
            status: data.status,
          },
          ...prev,
        ].slice(0, 10)
      );

      if (data.status === "broken" || data.status === "soft-404" || data.status === "error") {
        brokenLinks.current.push({
          brokenLink: currentItem.url,
          redirectedTo: data.redirectLocation || null,
          foundOnPage: currentItem.parent,
          status: data.status,
        });
      }

      if ((data.status === "ok" || data.status === "redirect") && !data.isLeaf) {
        if (data.links && data.links.length > 0) {
          data.links.forEach((link: string) => {
            if (!visited.current.has(link)) {
              visited.current.add(link);
              queue.current.push({ url: link, parent: currentItem.url });
            }
          });
        }
      }

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

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      if (activeWorkers < MAX_CONCURRENCY && queue.current.length > 0) {
        crawlStep();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [isRunning, activeWorkers, crawlStep]);

  const downloadReport = () => {
    const content = JSON.stringify(brokenLinks.current, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `broken-links.json`;
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
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `crawler-state.json`;
    document.body.appendChild(link);
    link.click();
    setIsRunning(false);
  };

  const loadProgress = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target?.result as string) as CrawlerState;
        queue.current = state.queue;
        visited.current = new Set(state.visited);
        brokenLinks.current = state.brokenLinks;
        setStats({
          queued: state.queue.length,
          visited: state.visited.length,
          broken: state.brokenLinks.filter((l) => l.status !== "soft-404").length,
          soft404: state.brokenLinks.filter((l) => l.status === "soft-404").length,
        });
        alert(`Loaded!`);
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
            <div className="h-10 w-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-bold">CO</div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Crawler Dashboard</h1>
              <div className="flex gap-4 text-xs font-medium text-slate-500">
                <span>
                  Queue: <b>{stats.queued}</b>
                </span>
                <span>
                  Scanned: <b className="text-blue-600">{stats.visited}</b>
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
              <Download size={14} /> Download JSON
            </button>
            <div className="w-px h-8 bg-slate-200 mx-1"></div>
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`px-5 py-2 rounded-lg font-bold text-white flex items-center gap-2 transition ${
                isRunning ? "bg-amber-500" : "bg-emerald-600"
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
          {/* Live Activity (Small Side Column) */}
          <div className="lg:col-span-1 bg-slate-900 text-slate-300 rounded-xl overflow-hidden flex flex-col shadow-lg">
            <div className="p-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Activity size={14} /> Live Feed
              </h3>
              <span className="text-[10px] bg-slate-700 px-2 py-0.5 rounded text-emerald-400">{activeWorkers} Active</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {liveFeed.map((item, i) => (
                <div key={i} className="text-xs border-b border-slate-700/50 pb-2 mb-2 last:border-0">
                  <div className="flex justify-between mb-1">
                    <StatusBadge status={item.status} />
                    <span className="text-slate-500">{item.foundCount} links</span>
                  </div>
                  <div className="whitespace-break-spaces text-slate-400 font-mono" title={item.url}>
                    {item.url}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Broken Links Report (Main Wide Area) */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" /> Broken Links Detected
              </h3>
              <button
                onClick={() => {
                  brokenLinks.current = [];
                  setStats((s) => ({ ...s, broken: 0, soft404: 0 }));
                }}
                className="text-xs text-red-500 flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded"
              >
                <Trash2 size={12} /> Clear List
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-0 max-h-[600px]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 text-slate-500 text-xs uppercase sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-3 font-semibold w-24">Status</th>
                    <th className="p-3 font-semibold w-1/3">Broken Link</th>
                    <th className="p-3 font-semibold w-1/4">Redirected To</th>
                    <th className="p-3 font-semibold">Found On Page</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-100">
                  {brokenLinks.current.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50 group transition-colors">
                      <td className="p-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="p-3 font-mono text-red-600 text-xs break-all pr-4">
                        <a href={item.brokenLink} target="_blank" className="hover:underline flex gap-1 items-center">
                          {item.brokenLink}
                        </a>
                      </td>
                      <td className="p-3 text-xs text-slate-500 break-all pr-4">
                        {item.redirectedTo ? (
                          <a href={item.redirectedTo} target="_blank" className="text-blue-600 hover:underline">
                            {item.redirectedTo}
                          </a>
                        ) : (
                          <span className="opacity-30">-</span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-slate-500 break-all">
                        <a href={item.foundOnPage} target="_blank" className="hover:text-slate-800 hover:underline flex items-center gap-1">
                          {item.foundOnPage}
                        </a>
                      </td>
                    </tr>
                  ))}
                  {brokenLinks.current.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-10 text-center text-slate-400 italic">
                        No broken links found yet.
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

// Helper Components
function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <span className="text-emerald-500 font-bold text-[10px]">OK</span>;
  if (status === "redirect") return <span className="text-blue-500 font-bold text-[10px]">REDIRECT</span>;
  if (status === "soft-404")
    return <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-200">SOFT 404</span>;
  return <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold border border-red-200">BROKEN</span>;
}

const btnSecondary =
  "flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-700 transition cursor-pointer";
