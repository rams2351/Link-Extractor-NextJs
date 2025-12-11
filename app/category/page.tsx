"use client";

import axios from "axios";
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCheck,
  FileWarning,
  Folder,
  FolderOpen,
  Network,
  Pause,
  Play,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// --- TYPES ---
type LinkStatus = "ok" | "broken" | "soft-404" | "redirect" | "error" | "pending";

interface BrokenReportItem {
  brokenLink: string;
  redirectedTo: string | null;
  foundOnPage: string;
  status: LinkStatus;
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
  depth: number;
}

interface CategoryNode {
  name: string;
  fullUrl?: string;
  status?: LinkStatus;
  children: Record<string, CategoryNode>;
  count: number;
}

interface QueueItem {
  url: string;
  parent: string | null;
  depth: number; // NEW: Track depth
}

// --- HELPER: STRICT URL NORMALIZATION ---
const normalizeUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    let cleanPath = urlObj.pathname.toLowerCase();
    if (cleanPath.endsWith("/") && cleanPath.length > 1) {
      cleanPath = cleanPath.slice(0, -1);
    }
    return `${urlObj.origin}${cleanPath}`;
  } catch (e) {
    return url;
  }
};

export default function Crawler() {
  const [isRunning, setIsRunning] = useState(false);
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [liveFeed, setLiveFeed] = useState<LiveScanItem[]>([]);
  const [activeTab, setActiveTab] = useState<"tree" | "issues">("tree");
  const [tick, setTick] = useState(0);

  // --- CONFIGURATION ---
  const MAX_CONCURRENCY = 15;
  const MAX_DEPTH = 5; // THE BREAKER: Stop digging after 5 levels

  // --- REFS ---
  // Initial Queue Item starts at Depth 0
  const queue = useRef<QueueItem[]>([{ url: "https://coloringonly.com", parent: null, depth: 0 }]);
  const visited = useRef<Set<string>>(new Set(["https://coloringonly.com"]));

  // Registry to block duplicates
  const queuedRegistry = useRef<Set<string>>(new Set(["https://coloringonly.com"]));

  const brokenLinks = useRef<BrokenReportItem[]>([]);

  const [stats, setStats] = useState({
    queued: 1,
    scanned: 0,
    broken: 0,
    soft404: 0,
    ok: 0,
    skipped: 0,
  });

  // --- CRAWL ENGINE ---
  const crawlStep = useCallback(async () => {
    if (queue.current.length === 0) {
      setIsRunning(false);
      return;
    }

    // DFS Strategy
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
            depth: currentItem.depth,
          },
          ...prev,
        ].slice(0, 10)
      );

      // 1. REPORT ISSUES
      if (data.status === "broken" || data.status === "soft-404" || data.status === "error") {
        brokenLinks.current.push({
          brokenLink: currentItem.url,
          redirectedTo: data.redirectLocation || null,
          foundOnPage: currentItem.parent ? "Parent in Tree" : "ROOT",
          status: data.status,
        });
      }

      const foundLinks = data.links || [];

      // 2. DISCOVERY & DEDUPLICATION LOGIC
      if ((data.status === "ok" || data.status === "redirect") && !data.isLeaf) {
        const newItems: QueueItem[] = [];
        let skippedCount = 0;

        // ** THE DEPTH BREAKER **
        // Only look for children if we haven't hit the limit
        if (currentItem.depth < MAX_DEPTH) {
          foundLinks.forEach((rawLink: string) => {
            const cleanLink = normalizeUrl(rawLink);

            if (!visited.current.has(cleanLink) && !queuedRegistry.current.has(cleanLink)) {
              queuedRegistry.current.add(cleanLink);
              newItems.push({
                url: rawLink,
                parent: currentItem.url,
                depth: currentItem.depth + 1, // INCREMENT DEPTH
              });
            } else {
              skippedCount++;
            }
          });

          // Add valid new items to front (DFS)
          if (newItems.length > 0) {
            queue.current.unshift(...newItems);
          }
        }

        stats.skipped += skippedCount;
      }

      visited.current.add(normalizeUrl(currentItem.url));

      setStats((prev) => ({
        ...prev,
        queued: queue.current.length,
        scanned: visited.current.size,
        ok: prev.ok + (data.status === "ok" ? 1 : 0),
        broken: brokenLinks.current.filter((i) => i.status !== "soft-404").length,
        soft404: brokenLinks.current.filter((i) => i.status === "soft-404").length,
      }));
    } catch (err) {
      // Log error
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
    }, 20);
    const uiTimer = setInterval(() => setTick((t) => t + 1), 2000);
    return () => {
      clearInterval(timer);
      clearInterval(uiTimer);
    };
  }, [isRunning, activeWorkers, crawlStep]);

  // --- TREE BUILDER ---
  const categoryTree = useMemo(() => {
    const root: CategoryNode = { name: "coloringonly.com", children: {}, count: 0 };
    const allPages = Array.from(visited.current);

    allPages.forEach((url) => {
      try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split("/").filter((p) => p.length > 0);
        let currentNode = root;

        parts.forEach((part, index) => {
          if (!currentNode.children[part]) {
            currentNode.children[part] = { name: part, children: {}, count: 0 };
          }
          currentNode = currentNode.children[part];

          if (index === parts.length - 1) {
            currentNode.fullUrl = url;
          } else {
            currentNode.count++;
          }
        });
      } catch (e) {}
    });
    return root;
  }, [tick]);

  // --- EXPORT ---
  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(brokenLinks.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `broken-links-report.json`;
    document.body.appendChild(link);
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="max-w-[1600px] mx-auto space-y-4">
        {/* HEADER */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-bold">CO</div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">ColoringOnly Category Scanner</h1>
              {/* Health Bar */}
              <div className="w-48 h-1.5 bg-slate-100 rounded-full overflow-hidden flex mt-1">
                <div className="bg-emerald-500 h-full" style={{ width: `${(stats.ok / (stats.scanned || 1)) * 100}%` }}></div>
                <div className="bg-red-500 h-full" style={{ width: `${(stats.broken / (stats.scanned || 1)) * 100}%` }}></div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 text-xs font-medium text-slate-500">
            <span className="px-2 py-1 bg-slate-100 rounded">Queue: {stats.queued}</span>
            <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">{stats.scanned} Pages</span>
            {/* Skipped Counter */}
            <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded border border-blue-100 flex items-center gap-1">
              <ShieldCheck size={12} /> {stats.skipped} Skipped
            </span>
            <span className="px-2 py-1 bg-red-50 text-red-700 rounded border border-red-100">{stats.broken} Broken</span>
          </div>

          <div className="flex gap-2">
            <button onClick={downloadReport} className="btn-secondary text-red-600 bg-red-50 border-red-200">
              <FileWarning size={14} /> Defects
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
          {/* LEFT: Live Activity */}
          <div className="lg:col-span-1 bg-slate-900 text-slate-300 rounded-xl overflow-hidden flex flex-col shadow-lg border border-slate-700">
            <div className="p-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Activity size={14} /> Live Feed
              </h3>
              <span className="text-[10px] bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded">{activeWorkers} Active</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {liveFeed.map((item, i) => (
                <div key={i} className="text-xs border-b border-slate-700/50 pb-2 mb-2 last:border-0 animate-in fade-in slide-in-from-left-2">
                  <div className="flex justify-between mb-1">
                    <StatusBadge status={item.status} />
                    <span className="text-[10px] text-slate-500">
                      Links: <b className="text-white">{item.foundCount}</b>
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500 text-[10px]">
                    <span className="truncate font-mono opacity-80 w-2/3" title={item.url}>
                      {item.url.replace("https://coloringonly.com", "")}
                    </span>
                    {/* DEPTH BADGE */}
                    <span className="flex items-center gap-1 bg-slate-800 px-1.5 rounded text-slate-400">
                      <Ruler size={10} /> Lvl {item.depth}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: CATEGORY TREE VIEW */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab("tree")}
                  className={`text-sm font-bold flex items-center gap-2 ${activeTab === "tree" ? "text-indigo-600" : "text-slate-400"}`}
                >
                  <Network size={16} /> Site Structure
                </button>
                <button
                  onClick={() => setActiveTab("issues")}
                  className={`text-sm font-bold flex items-center gap-2 ${activeTab === "issues" ? "text-red-600" : "text-slate-400"}`}
                >
                  <AlertTriangle size={16} /> Broken Links ({brokenLinks.current.length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-white font-sans text-sm">
              {activeTab === "tree" ? (
                <div className="space-y-1">
                  {Object.values(categoryTree.children).map((node) => (
                    <CategoryNodeItem key={node.name} node={node} depth={0} />
                  ))}
                </div>
              ) : (
                <IssuesList issues={brokenLinks.current} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- SUB COMPONENTS ---

const CategoryNodeItem = ({ node, depth }: { node: CategoryNode; depth: number }) => {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = Object.keys(node.children).length > 0;
  const isLeaf = !!node.fullUrl;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-slate-50 transition select-none"
        style={{ marginLeft: `${depth * 20}px` }}
        onClick={() => hasChildren && setIsOpen(!isOpen)}
      >
        <span className="text-slate-400 w-4 flex justify-center">
          {hasChildren ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <div className="w-1 h-1 rounded-full bg-slate-300"></div>}
        </span>

        <span className={isLeaf ? "text-emerald-500" : "text-yellow-500"}>
          {hasChildren ? isOpen ? <FolderOpen size={16} /> : <Folder size={16} /> : <FileCheck size={16} />}
        </span>

        <span className="text-xs text-slate-700 font-medium truncate">{node.name}</span>

        {hasChildren && <span className="ml-auto text-[9px] text-slate-400 bg-slate-100 px-1.5 rounded-full">{node.count}</span>}

        {node.fullUrl && (
          <a href={node.fullUrl} target="_blank" onClick={(e) => e.stopPropagation()} className="ml-2 text-slate-300 hover:text-blue-500">
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {isOpen && hasChildren && (
        <div className="border-l border-slate-100 ml-4">
          {Object.values(node.children).map((child) => (
            <CategoryNodeItem key={child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const IssuesList = ({ issues }: { issues: BrokenReportItem[] }) => {
  if (issues.length === 0) return <div className="text-center text-slate-400 mt-10">No issues found yet.</div>;

  return (
    <div className="space-y-2">
      {issues.map((item, i) => (
        <div
          key={i}
          className="text-xs p-3 bg-red-50 border border-red-100 rounded flex justify-between items-center group hover:shadow-sm transition"
        >
          <div className="flex-1">
            <div className="font-bold text-red-700 flex items-center gap-2 mb-1">
              <Bug size={14} /> {item.brokenLink}
            </div>
            <div className="text-slate-500">
              Status: <span className="uppercase font-bold">{item.status}</span>
            </div>
            {item.redirectedTo && <div className="text-blue-600 mt-1">→ Redirects to: {item.redirectedTo}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <span className="text-emerald-500 font-bold text-[10px]">OK</span>;
  if (status === "redirect") return <span className="text-blue-500 font-bold text-[10px]">REDIRECT</span>;
  if (status === "soft-404") return <span className="text-orange-500 font-bold text-[10px]">SOFT 404</span>;
  return <span className="text-red-500 font-bold text-[10px]">BROKEN</span>;
}

const btnSecondary =
  "flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-700 transition cursor-pointer shadow-sm";
