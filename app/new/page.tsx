"use client";

import axios from "axios";
import {
  Activity,
  Ban,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  File,
  FileCheck,
  FileText,
  FileWarning,
  FolderCheck,
  FolderOpen,
  Image as ImageIcon,
  Network,
  Pause,
  Play,
  RotateCw,
  Ruler,
  Save,
  Upload,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

// --- DATA TYPES ---
type LinkStatus = "ok" | "broken" | "soft-404" | "redirect" | "error" | "pending";

interface BrokenReportItem {
  brokenLink: string;
  redirectedTo: string | null;
  foundOnPage: string;
  status: LinkStatus;
}

interface PageNode {
  url: string;
  status: LinkStatus;
  children: string[];
  parent: string | null;
}

type SiteMap = Record<string, PageNode>;

interface QueueItem {
  url: string;
  parent: string | null;
  depth: number;
}

interface CrawlerState {
  queue: QueueItem[];
  visited: string[];
  siteMap: SiteMap;
  brokenLinks: BrokenReportItem[];
}

interface LiveScanItem {
  url: string;
  foundCount: number;
  status: LinkStatus;
  depth: number;
}

// --- STYLES ---
const btnSecondary =
  "flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-700 transition cursor-pointer shadow-sm";

// --- HELPER: STRICT URL NORMALIZATION ---
const normalizeUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    // Force lowercase and remove 'www.'
    let host = urlObj.hostname.toLowerCase().replace(/^www\./, "");
    let cleanPath = urlObj.pathname.toLowerCase();

    // Remove trailing slash
    if (cleanPath.endsWith("/") && cleanPath.length > 1) {
      cleanPath = cleanPath.slice(0, -1);
    }
    return `${urlObj.protocol}//${host}${cleanPath}`;
  } catch (e) {
    return url;
  }
};

export default function Crawler() {
  const [isRunning, setIsRunning] = useState(false);
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [liveFeed, setLiveFeed] = useState<LiveScanItem[]>([]);
  const [tick, setTick] = useState(0);

  // --- CONFIGURATION ---
  const MAX_CONCURRENCY = 20; // Increased for speed
  const MAX_DEPTH = 6;

  // --- REFS ---
  const queue = useRef<QueueItem[]>([{ url: "https://coloringonly.com", parent: null, depth: 0 }]);
  const visited = useRef<Set<string>>(new Set(["https://coloringonly.com"]));

  // FIX 1: GLOBAL REGISTRY (The Shield)
  // This tracks URLs that are EITHER visited OR currently sitting in the queue.
  // It prevents 15 workers from adding the same "Category" link 15 times simultaneously.
  const globalRegistry = useRef<Set<string>>(new Set(["https://coloringonly.com"]));

  const siteMap = useRef<SiteMap>({
    "https://coloringonly.com": {
      url: "https://coloringonly.com",
      status: "pending",
      children: [],
      parent: null,
    },
  });

  const brokenLinks = useRef<BrokenReportItem[]>([]);

  const [stats, setStats] = useState({
    queued: 1,
    mapped: 0,
    broken: 0,
    soft404: 0,
    ok: 0,
  });

  // --- CRAWL ENGINE ---
  const crawlStep = useCallback(async () => {
    if (queue.current.length === 0) {
      if (activeWorkers === 0) setIsRunning(false);
      return;
    }

    // FIX 2: LAZY CLEANUP ON POP
    // If the queue contains a duplicate that slipped in before (or from a bad file), skip it.
    let currentItem = queue.current.shift();
    while (currentItem && visited.current.has(normalizeUrl(currentItem.url))) {
      currentItem = queue.current.shift();
    }

    if (!currentItem) return;

    const currentKey = normalizeUrl(currentItem.url);

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
        ].slice(0, 8)
      );

      // 1. REPORT ISSUES
      if (data.status === "broken" || data.status === "soft-404" || data.status === "error") {
        brokenLinks.current.push({
          brokenLink: currentItem.url,
          redirectedTo: data.redirectLocation || null,
          foundOnPage: currentItem.parent || "ROOT",
          status: data.status,
        });
      }

      const foundLinks = data.links || [];
      const cleanChildren: string[] = [];
      const newItemsToQueue: QueueItem[] = [];

      // 2. DISCOVERY LOGIC
      if ((data.status === "ok" || data.status === "redirect") && !data.isLeaf) {
        if (currentItem.depth < MAX_DEPTH) {
          foundLinks.forEach((rawLink: string) => {
            const cleanLink = normalizeUrl(rawLink);

            // Always add to visual children list
            cleanChildren.push(rawLink);

            // FIX 3: STRICT CHECK AGAINST REGISTRY
            // We only queue if we have NEVER seen this link (visited OR queued)
            if (!globalRegistry.current.has(cleanLink)) {
              globalRegistry.current.add(cleanLink); // Mark as claimed immediately

              // Add to Sitemap (Visuals)
              if (!siteMap.current[cleanLink]) {
                siteMap.current[cleanLink] = {
                  url: rawLink,
                  status: "pending",
                  children: [],
                  parent: currentItem.url,
                };
              }

              // Add to Queue
              newItemsToQueue.push({
                url: rawLink,
                parent: currentItem.url,
                depth: currentItem.depth + 1,
              });
            }
          });

          // DFS: Add new items to the FRONT of the queue
          if (newItemsToQueue.length > 0) {
            queue.current.unshift(...newItemsToQueue);
          }
        }
      }

      // 3. UPDATE SITEMAP NODE
      siteMap.current[currentKey] = {
        url: currentItem.url,
        status: data.status,
        children: cleanChildren,
        parent: currentItem.parent,
      };

      visited.current.add(currentKey);

      // 4. Update Stats
      setStats((prev) => ({
        queued: queue.current.length,
        mapped: Object.keys(siteMap.current).length,
        ok: prev.ok + (data.status === "ok" ? 1 : 0),
        broken: brokenLinks.current.filter((i) => i.status !== "soft-404").length,
        soft404: brokenLinks.current.filter((i) => i.status === "soft-404").length,
      }));
    } catch (err) {
      siteMap.current[currentKey] = { url: currentItem.url, status: "error", children: [], parent: currentItem.parent };
    } finally {
      setActiveWorkers((prev) => prev - 1);
    }
  }, [activeWorkers]);

  // --- LOOP ---
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      // Only spawn if we have capacity and items in queue
      if (activeWorkers < MAX_CONCURRENCY && queue.current.length > 0) {
        crawlStep();
      }
    }, 20);

    // UI Update Loop
    const uiTimer = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      clearInterval(timer);
      clearInterval(uiTimer);
    };
  }, [isRunning, activeWorkers, crawlStep]);

  // --- EXPORT / SAVE / LOAD ---
  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(brokenLinks.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `broken-links-report.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const saveProgress = () => {
    const state: CrawlerState = {
      queue: queue.current,
      visited: Array.from(visited.current),
      siteMap: siteMap.current,
      brokenLinks: brokenLinks.current,
    };
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `crawler-save.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setIsRunning(false);
  };

  // FIX 4: SMART LOAD (The Cleaner)
  const loadProgress = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target?.result as string) as CrawlerState;

        // --- DEDUPLICATION LOGIC ---
        const uniqueRegistry = new Set<string>();
        const uniqueQueue: QueueItem[] = [];

        // 1. Add all previously visited pages to registry
        state.visited.forEach((url) => uniqueRegistry.add(normalizeUrl(url)));

        // 2. Filter Queue: Only add if NOT in registry
        let duplicateCount = 0;
        state.queue.forEach((item) => {
          const norm = normalizeUrl(item.url);
          // Only if it's NOT visited and NOT already queued
          if (!uniqueRegistry.has(norm)) {
            uniqueRegistry.add(norm);
            uniqueQueue.push(item);
          } else {
            duplicateCount++;
          }
        });

        // 3. Commit State
        queue.current = uniqueQueue;
        visited.current = new Set(state.visited);
        globalRegistry.current = uniqueRegistry; // Set the shield
        siteMap.current = state.siteMap || {};
        brokenLinks.current = state.brokenLinks || [];

        setStats({
          queued: uniqueQueue.length,
          mapped: Object.keys(state.siteMap).length,
          ok: 0,
          broken: state.brokenLinks.length,
          soft404: 0,
        });

        alert(`Loaded! Removed ${duplicateCount} duplicates from queue. Ready to resume.`);
      } catch (err) {
        alert("Invalid JSON File");
      }
    };
    reader.readAsText(file);
  };

  const healthPercent = stats.mapped > 0 ? (stats.ok / stats.mapped) * 100 : 100;

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="max-w-[1600px] mx-auto space-y-4">
        {/* HEADER */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-bold">CO</div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">ColoringOnly Deep Scan</h1>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="w-48 h-2 bg-slate-100 rounded-full overflow-hidden flex">
                  <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${healthPercent}%` }}></div>
                  <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${100 - healthPercent}%` }}></div>
                </div>
                <div className="flex gap-3 text-xs font-medium text-slate-500 ml-2">
                  <span className="text-emerald-600 font-bold">{stats.mapped} Scanned</span>
                  <span className="text-red-600 font-bold">{stats.broken} Broken</span>
                  <span className="text-orange-500 font-bold">{stats.soft404} Soft 404</span>
                  <span className="text-slate-400">Queue: {stats.queued}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <label className={btnSecondary}>
              <Upload size={14} /> Load
              <input type="file" onChange={loadProgress} className="hidden" accept=".json" />
            </label>
            <button onClick={saveProgress} className={btnSecondary}>
              <Save size={14} /> Save
            </button>
            <button onClick={downloadReport} className={`${btnSecondary} text-red-600 bg-red-50 border-red-200`}>
              <FileWarning size={14} /> Report
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
                <div
                  key={`${item.url}-${i}`}
                  className="text-xs border-b border-slate-700/50 pb-2 mb-2 last:border-0 animate-in fade-in slide-in-from-left-2"
                >
                  <div className="flex justify-between mb-1">
                    <StatusBadge status={item.status} />
                    <span className="text-slate-400">
                      Links: <b className="text-white">{item.foundCount}</b>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="truncate text-slate-400 font-mono opacity-80 w-3/4" title={item.url}>
                      {item.url.replace("https://coloringonly.com", "")}
                    </div>
                    <div className="text-[9px] bg-slate-800 text-slate-500 px-1.5 rounded flex items-center gap-1">
                      <Ruler size={10} /> {item.depth}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Visual Tree */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                <Network size={16} className="text-blue-500" /> Site Map Hierarchy
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-white font-sans text-sm">
              <TreeNode
                url="https://coloringonly.com"
                dataMap={siteMap.current}
                depth={0}
                forceUpdate={tick}
                ancestors={[]}
                parentUrl={null} // Root has no parent
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- TREE COMPONENT (VISUAL FIX) ---
const TreeNode = ({
  url,
  dataMap,
  depth,
  forceUpdate,
  ancestors,
  parentUrl,
}: {
  url: string;
  dataMap: SiteMap;
  depth: number;
  forceUpdate: number;
  ancestors: string[];
  parentUrl: string | null;
}) => {
  const nodeKey = normalizeUrl(url);
  const node = dataMap[nodeKey];

  const [isOpen, setIsOpen] = useState(depth < 1);

  if (!node) return null;

  // CANONICAL CHECK: Only show children if THIS parent was the one who found it
  // This collapses the visual tree so you don't see duplicates
  const isCanonical = !parentUrl || normalizeUrl(node.parent || "") === normalizeUrl(parentUrl);

  const isLoop = ancestors.includes(nodeKey);
  const hasChildren = node.children && node.children.length > 0;
  const showAsFolder = hasChildren && !isLoop && isCanonical;

  let IconComponent = File;
  let iconColor = "text-slate-300";
  const lowerUrl = url.toLowerCase();

  const isBroken = node.status === "broken" || node.status === "soft-404" || node.status === "error";
  const isDone = node.status === "ok" || node.status === "redirect";

  if (isBroken) {
    IconComponent = Ban;
    iconColor = "text-red-500";
  } else if (node.status === "pending") {
    IconComponent = Clock;
    iconColor = "text-slate-300";
  } else if (isLoop) {
    IconComponent = RotateCw;
    iconColor = "text-amber-500";
  } else if (isDone) {
    iconColor = "text-emerald-500";
    if (showAsFolder) {
      IconComponent = isOpen ? FolderOpen : FolderCheck;
    } else {
      if (!isCanonical && hasChildren) {
        IconComponent = ExternalLink;
        iconColor = "text-indigo-400";
      } else if (lowerUrl.endsWith(".pdf")) {
        IconComponent = FileText;
      } else if (/\.(jpg|png|gif|webp)$/.test(lowerUrl)) {
        IconComponent = ImageIcon;
      } else {
        IconComponent = FileCheck;
      }
    }
  }

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer transition border border-transparent ${
          isBroken ? "bg-red-50 border-red-100" : isDone ? "hover:bg-emerald-50" : "hover:bg-slate-50"
        }`}
        style={{ marginLeft: `${depth * 20}px` }}
        onClick={() => showAsFolder && setIsOpen(!isOpen)}
      >
        <span className="text-slate-400 w-4 flex justify-center">
          {showAsFolder ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </span>
        <span className={iconColor}>
          <IconComponent size={16} />
        </span>
        <span className={`text-xs truncate ${isBroken ? "text-red-600 font-bold" : "text-slate-600"}`} title={url}>
          {url.replace("https://coloringonly.com", "") || "Home"}
        </span>

        {isBroken && <span className="ml-auto text-[9px] font-bold bg-red-600 text-white px-1.5 rounded">ERR</span>}
        {node.status === "soft-404" && <span className="ml-auto text-[9px] font-bold bg-orange-400 text-white px-1.5 rounded">SOFT</span>}
        {isLoop && <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1.5 rounded">LOOP</span>}
        {!isCanonical && !isLoop && hasChildren && (
          <span className="ml-auto text-[9px] text-indigo-500 bg-indigo-50 px-1.5 rounded border border-indigo-100">REF</span>
        )}
      </div>

      {isOpen && showAsFolder && (
        <div className="border-l border-slate-200 ml-4">
          {node.children.map((childUrl, index) => (
            <TreeNode
              key={`${childUrl}-${index}`}
              url={childUrl}
              dataMap={dataMap}
              depth={depth + 1}
              forceUpdate={forceUpdate}
              ancestors={[...ancestors, nodeKey]}
              parentUrl={url}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <span className="text-emerald-500 font-bold text-[10px]">OK</span>;
  if (status === "redirect") return <span className="text-blue-500 font-bold text-[10px]">REDIR</span>;
  if (status === "soft-404") return <span className="text-orange-500 font-bold text-[10px]">SOFT</span>;
  return <span className="text-red-500 font-bold text-[10px]">ERR</span>;
}
