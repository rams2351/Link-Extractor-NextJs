"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, CheckCircle2, Copy, Loader2, Play, Search, StopCircle, Trash2, XCircle } from "lucide-react";
import { useRef, useState } from "react";

type LinkRow = {
  id: number;
  originalUrl: string;
  finalUrl?: string;
  status: "idle" | "loading" | "success" | "error";
  statusCode?: string | number;
  reason?: string;
  isBroken?: boolean;
};

export default function LinkAuditor() {
  // STATES
  const [targetUrl, setTargetUrl] = useState("");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(50);
  const [extractedLinks, setExtractedLinks] = useState<string[]>([]);
  const [tableRows, setTableRows] = useState<LinkRow[]>([]);
  const [totalLinks, setTotalLinks] = useState(0);

  const [isScraping, setIsScraping] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const stopSignalRef = useRef(false);

  // STATS
  const brokenLinks = tableRows.filter((l) => l.isBroken);
  const checkedCount = tableRows.filter((l) => l.status === "success" || l.status === "error").length;
  const progressPercent = tableRows.length > 0 ? (checkedCount / tableRows.length) * 100 : 0;

  // 1. SCRAPE
  const handleScrape = async () => {
    if (!targetUrl) return alert("Please enter a URL");
    setIsScraping(true);
    setExtractedLinks([]);
    setTableRows([]);

    try {
      const res = await fetch("/api/scrape", { method: "POST", body: JSON.stringify({ url: targetUrl }) });
      const data = await res.json();
      if (data.success) {
        setExtractedLinks(data.links);
        setRangeStart(1);
        setRangeEnd(data.total);
        setTotalLinks(data.total);
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      alert("Failed to connect to API");
    } finally {
      setIsScraping(false);
    }
  };

  // 2. LOAD TABLE
  const handleLoadTable = () => {
    const start = Math.max(0, rangeStart - 1);
    const end = Math.min(extractedLinks.length, rangeEnd);
    const subset = extractedLinks.slice(start, end);
    setTableRows(
      subset.map((url, index) => ({
        id: index,
        originalUrl: url,
        status: "idle",
        isBroken: false,
      }))
    );
  };

  // 3. CHECK (BATCHED)
  const handleStartCheck = async () => {
    if (tableRows.length === 0) return;
    setIsChecking(true);
    stopSignalRef.current = false;
    const BATCH_SIZE = 5;

    const processRow = async (row: LinkRow) => {
      setTableRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "loading" } : r)));
      try {
        const res = await fetch("/api/check", { method: "POST", body: JSON.stringify({ url: row.originalUrl }) });
        const result = await res.json();
        setTableRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  status: result.isBroken ? "error" : "success",
                  finalUrl: result.finalUrl,
                  statusCode: result.status,
                  reason: result.reason,
                  isBroken: result.isBroken,
                }
              : r
          )
        );
      } catch (error) {
        setTableRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "error", reason: "Network Error", isBroken: true } : r)));
      }
    };

    for (let i = 0; i < tableRows.length; i += BATCH_SIZE) {
      if (stopSignalRef.current) break;
      const batch = tableRows.slice(i, i + BATCH_SIZE).filter((r) => r.status === "idle");
      if (batch.length === 0) continue;
      await Promise.all(batch.map((row) => processRow(row)));
      await new Promise((r) => setTimeout(r, 50));
    }
    setIsChecking(false);
  };

  const handleStop = () => {
    stopSignalRef.current = true;
    setIsChecking(false);
  };

  return (
    <div className="container mx-auto py-10 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Web Link Auditor</h1>
          <p className="text-muted-foreground">Scrape a page, extract links, and validate redirects.</p>
        </div>
        {tableRows.length > 0 && (
          <div className="flex gap-4 text-sm font-medium">
            <span className="flex items-center text-green-600 gap-2">
              <CheckCircle2 size={16} /> {checkedCount - brokenLinks.length} Valid
            </span>
            <span className="flex items-center text-red-600 gap-2">
              <XCircle size={16} /> {brokenLinks.length} Broken
            </span>
          </div>
        )}
      </div>

      {/* Step 1: Scrape */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="w-5 h-5" /> Step 1: Scan Target Website
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Input
            placeholder="https://coloringonly.com/..."
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            disabled={isScraping || isChecking}
            className="bg-white"
          />
          <Button onClick={handleScrape} disabled={isScraping || isChecking} className="w-32 cursor-pointer">
            {isScraping ? <Loader2 className="animate-spin w-4 h-4" /> : "Scan Page"}
          </Button>
          {extractedLinks.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setExtractedLinks([]);
                setTableRows([]);
              }}
              className="text-red-600 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Load Table */}
      {extractedLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex justify-between items-center">
              <span>
                Step 2: Select Links to Check <span className="text-primary text-sm font-normal ml-2">(Total Links: {totalLinks})</span>
              </span>
              <Badge variant="secondary">In Memory: {extractedLinks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-6">
              <div className="grid w-full max-w-xs items-center gap-1.5">
                <label className="text-sm font-medium">Start Index</label>
                <Input type="number" value={rangeStart} onChange={(e) => setRangeStart(Number(e.target.value))} />
              </div>
              <div className="grid w-full max-w-xs items-center gap-1.5">
                <label className="text-sm font-medium">End Index</label>
                <Input type="number" value={rangeEnd} onChange={(e) => setRangeEnd(Number(e.target.value))} />
              </div>
              <Button onClick={handleLoadTable} disabled={isChecking} className="w-40 cursor-pointer">
                Load into Table
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Results Table */}
      {tableRows.length > 0 && (
        <div className="space-y-4">
          <Card className="border-blue-100 bg-blue-50/30">
            <CardContent className="pt-6 flex items-center gap-6">
              <div className="flex-1 space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-500">
                  <span>
                    Checking... {checkedCount} / {tableRows.length}
                  </span>
                  <span>{Math.round(progressPercent)}%</span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>
              <div>
                {!isChecking ? (
                  <Button onClick={handleStartCheck} className=" w-32 cursor-pointer">
                    <Play className="w-4 h-4 mr-2" /> Start
                  </Button>
                ) : (
                  <Button onClick={handleStop} variant="destructive" className="w-32 cursor-pointer">
                    <StopCircle className="w-4 h-4 mr-2" /> Stop
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="rounded-md border bg-white shadow-sm overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="bg-slate-100 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-[50px] text-center">#</TableHead>
                    <TableHead className="w-[30%]">Original Link</TableHead>
                    <TableHead className="w-[30%]">Redirected To</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="text-right">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((row, idx) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        <div className=" w-[500px] text-wrap" title={row.originalUrl}>
                          {row.originalUrl}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.status === "loading" ? (
                          <span className="text-blue-500 animate-pulse flex items-center gap-1">
                            <Loader2 size={12} className="animate-spin" /> Checking...
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            {row.finalUrl && row.finalUrl !== row.originalUrl && <ArrowRight size={12} className="text-orange-500 shrink-0" />}
                            <div className="truncate max-w-[300px]" title={row.finalUrl || ""}>
                              {row.finalUrl || "-"}
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.status === "idle" && <Badge variant="secondary">Waiting</Badge>}
                        {row.status === "loading" && <Badge className="bg-blue-500">Loading</Badge>}
                        {row.status === "success" && <Badge className="bg-green-600">Valid</Badge>}
                        {row.status === "error" && <Badge variant="destructive">Broken</Badge>}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium text-red-600">{row.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Export */}
      {brokenLinks.length > 0 && (
        <Card className="border-red-200 shadow-md">
          <CardHeader className="bg-red-50 border-b border-red-100 flex flex-row items-center justify-between">
            <CardTitle className="text-red-800 text-lg">Broken Links Found ({brokenLinks.length})</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="bg-white cursor-pointer text-red-700 border-red-200 hover:bg-red-50"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(brokenLinks.map((l) => l.originalUrl)));
                alert("Copied!");
              }}
            >
              <Copy className="w-4 h-4 mr-2" /> Copy List
            </Button>
          </CardHeader>
          <CardContent className="pt-4">
            <Textarea
              readOnly
              value={JSON.stringify(
                brokenLinks.map((l) => l.originalUrl),
                null,
                2
              )}
              className="font-mono text-xs min-h-[150px] bg-slate-50 text-red-900"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
