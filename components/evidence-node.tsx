"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle, FileCode2, FileText, GitCommitHorizontal, GitPullRequest,
  MessageSquare, UserRound, CircleHelp, Sparkles,
} from "lucide-react";
import { GithubLogo as Github } from "@/components/icons";
import type { GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

export type EvidenceNodeData = {
  node: GraphNode;
  dimmed: boolean;
  direct: boolean;
};

export type EvidenceFlowNode = Node<EvidenceNodeData, "evidence">;

const META: Record<GraphNode["kind"], { label: string; icon: React.ReactNode; paper?: boolean; oxblood?: boolean }> = {
  repository: { label: "REPOSITORY", icon: <Github className="h-3 w-3" /> },
  file: { label: "FILE", icon: <FileCode2 className="h-3 w-3" /> },
  commit: { label: "COMMIT", icon: <GitCommitHorizontal className="h-3 w-3" />, paper: true },
  pullRequest: { label: "PULL REQUEST", icon: <GitPullRequest className="h-3 w-3" /> },
  issue: { label: "ISSUE", icon: <CircleHelp className="h-3 w-3" /> },
  discussion: { label: "DISCUSSION", icon: <MessageSquare className="h-3 w-3" /> },
  developer: { label: "DEVELOPER", icon: <UserRound className="h-3 w-3" /> },
  decision: { label: "DECISION", icon: <Sparkles className="h-3 w-3" />, paper: true },
  designDocument: { label: "DESIGN DOCUMENT", icon: <FileText className="h-3 w-3" />, paper: true },
  incident: { label: "INCIDENT", icon: <AlertTriangle className="h-3 w-3" />, oxblood: true },
};

function EvidenceNodeCard({ data, selected }: NodeProps<EvidenceFlowNode>) {
  const { node, dimmed, direct } = data;
  const meta = META[node.kind];
  return (
    <div
      className={cn(
        "evidence-node-card relative w-[210px] rounded border px-3 py-2.5 transition-[opacity,border-color,box-shadow] duration-200",
        meta.paper
          ? "border-primary/50 bg-[#e8dcc5] text-on-paper"
          : meta.oxblood
            ? "border-secondary/80 bg-[#3a1b18] text-on-surface"
            : node.kind === "repository"
              ? "border-primary bg-surface-container-high text-on-surface"
              : "border-outline-variant bg-surface-container text-on-surface",
        dimmed ? "opacity-25" : "opacity-100",
      )}
      aria-label={`${meta.label}: ${node.label}`}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center justify-between gap-2">
        <span className={cn("inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em]", meta.paper || meta.oxblood ? "text-secondary" : "text-primary")}>
          {meta.icon} {meta.label}
        </span>
        <span
          className={cn("evidence-node-pin h-2.5 w-2.5 rounded-full border", direct ? "border-primary bg-primary" : "border-outline bg-surface-container-highest")}
          title={direct ? "Direct evidence match" : "Contextual graph record"}
          aria-hidden="true"
        />
      </div>
      <p className={cn("mt-1.5 line-clamp-2 font-title text-[13px] font-semibold leading-[18px]", meta.paper ? "text-on-paper" : "text-on-surface")}>
        {node.label}
      </p>
      {node.sublabel ? (
        <p className={cn("mt-0.5 line-clamp-2 break-all font-mono text-[9px] leading-[13px]", meta.paper ? "text-paper-muted" : "text-on-surface-variant")}>
          {node.sublabel}
        </p>
      ) : null}
      {selected ? <span className="ripple" aria-hidden="true" /> : null}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

export const EvidenceNode = memo(EvidenceNodeCard);

export const nodeTypes = { evidence: EvidenceNode };

export function kindIcon(kind: GraphNode["kind"], className = "h-3.5 w-3.5") {
  switch (kind) {
    case "repository": return <Github className={className} />;
    case "file": return <FileCode2 className={className} />;
    case "commit": return <GitCommitHorizontal className={className} />;
    case "pullRequest": return <GitPullRequest className={className} />;
    case "issue": return <CircleHelp className={className} />;
    case "discussion": return <MessageSquare className={className} />;
    case "developer": return <UserRound className={className} />;
    case "decision": return <Sparkles className={className} />;
    case "designDocument": return <FileText className={className} />;
    case "incident": return <AlertTriangle className={className} />;
  }
}

export function kindLabel(kind: GraphNode["kind"]): string {
  return META[kind]?.label ?? kind.toUpperCase();
}

export function kindAccent(kind: GraphNode["kind"]): string {
  switch (kind) {
    case "repository": return "#c49a58";
    case "decision": return "#c49a58";
    case "designDocument": return "#b9a076";
    case "commit": return "#c49a58";
    case "pullRequest": return "#d2a963";
    case "issue": return "#d27b72";
    case "incident": return "#8e3830";
    case "discussion": return "#a98e68";
    case "file": return "#8f9b82";
    case "developer": return "#9b8a74";
  }
}

