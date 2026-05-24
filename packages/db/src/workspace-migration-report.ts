import { PrismaClient } from "@prisma/client";

export type WorkspaceMigrationSuggestion = "team_candidate" | "personal_candidate" | "needs_review";

export type WorkspaceMigrationConfidence = "high" | "medium" | "low";

export type WorkspaceMigrationWorkspaceInput = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  kind: string | null;
  personal_owner_user_id: string | null;
  created_by: string | null;
  member_counts: {
    owner: number;
    admin: number;
    member: number;
    guest: number;
    total: number;
  };
  owner_user_ids: string[];
  created_by_exists: boolean;
  knowledge_base_counts: {
    private: number;
    workspace: number;
    public: number;
    demo_named: number;
    total: number;
  };
  document_counts: {
    page: number;
    folder: number;
    total: number;
  };
  owner_has_other_personal_workspace: boolean;
};

export type WorkspaceMigrationReportItem = WorkspaceMigrationWorkspaceInput & {
  is_default_workspace: boolean;
  suggested_kind: WorkspaceMigrationSuggestion;
  confidence: WorkspaceMigrationConfidence;
  reasons: string[];
};

export type WorkspaceMigrationReport = {
  generated_at: string;
  summary: Record<WorkspaceMigrationSuggestion, number> & {
    total: number;
  };
  workspaces: WorkspaceMigrationReportItem[];
};

export type WorkspaceMigrationReportOptions = {
  prisma?: PrismaClient;
  now?: Date;
};

const DEFAULT_WORKSPACE_NAME_RE = /(^|[\s_-])(default|demo|team|openkb demo)([\s_-]|$)/i;

export async function generateWorkspaceMigrationReport(
  options: WorkspaceMigrationReportOptions = {}
): Promise<WorkspaceMigrationReport> {
  const prisma = options.prisma ?? new PrismaClient();
  const ownsClient = !options.prisma;

  try {
    const [workspaces, workspaceMembers, knowledgeBases, documents, users, personalWorkspaces] =
      await Promise.all([
        prisma.workspace.findMany({ orderBy: [{ tenant_id: "asc" }, { created_at: "asc" }] }),
        prisma.workspaceMember.findMany({
          select: { workspace_id: true, user_id: true, role: true }
        }),
        prisma.knowledgeBase.findMany({
          select: { workspace_id: true, title: true, slug: true, visibility: true }
        }),
        prisma.document.findMany({
          where: { status: { not: "deleted" } },
          select: { workspace_id: true, type: true }
        }),
        prisma.user.findMany({ select: { id: true } }),
        prisma.workspace.findMany({
          where: { kind: "personal", personal_owner_user_id: { not: null } },
          select: { id: true, tenant_id: true, personal_owner_user_id: true }
        })
      ]);

    const userIds = new Set(users.map((user) => user.id));
    const personalWorkspaceByTenantOwner = new Map<string, string>();
    for (const workspace of personalWorkspaces) {
      if (workspace.personal_owner_user_id) {
        personalWorkspaceByTenantOwner.set(
          `${workspace.tenant_id}:${workspace.personal_owner_user_id}`,
          workspace.id
        );
      }
    }

    const workspaceInputs = workspaces.map((workspace) => {
      const members = workspaceMembers.filter((member) => member.workspace_id === workspace.id);
      const memberCounts = {
        owner: members.filter((member) => member.role === "owner").length,
        admin: members.filter((member) => member.role === "admin").length,
        member: members.filter((member) => member.role === "member").length,
        guest: members.filter((member) => member.role === "guest").length,
        total: members.length
      };
      const ownerUserIds = members
        .filter((member) => member.role === "owner")
        .map((member) => member.user_id);
      const workspaceKnowledgeBases = knowledgeBases.filter(
        (knowledgeBase) => knowledgeBase.workspace_id === workspace.id
      );
      const workspaceDocuments = documents.filter(
        (document) => document.workspace_id === workspace.id
      );
      const ownerId = ownerUserIds.length === 1 ? ownerUserIds[0] : null;
      const existingPersonalWorkspaceId = ownerId
        ? personalWorkspaceByTenantOwner.get(`${workspace.tenant_id}:${ownerId}`)
        : null;

      return {
        id: workspace.id,
        tenant_id: workspace.tenant_id,
        name: workspace.name,
        slug: workspace.slug,
        kind: workspace.kind ?? "team",
        personal_owner_user_id: workspace.personal_owner_user_id ?? null,
        created_by: workspace.created_by,
        member_counts: memberCounts,
        owner_user_ids: ownerUserIds,
        created_by_exists: userIds.has(workspace.created_by),
        knowledge_base_counts: {
          private: workspaceKnowledgeBases.filter((kb) => kb.visibility === "private").length,
          workspace: workspaceKnowledgeBases.filter((kb) => kb.visibility === "workspace").length,
          public: workspaceKnowledgeBases.filter((kb) => kb.visibility === "public").length,
          demo_named: workspaceKnowledgeBases.filter(
            (kb) => kb.slug === "openkb-demo" || /openkb demo|demo/i.test(kb.title)
          ).length,
          total: workspaceKnowledgeBases.length
        },
        document_counts: {
          page: workspaceDocuments.filter((document) => document.type === "page").length,
          folder: workspaceDocuments.filter((document) => document.type === "folder").length,
          total: workspaceDocuments.length
        },
        owner_has_other_personal_workspace: Boolean(
          existingPersonalWorkspaceId && existingPersonalWorkspaceId !== workspace.id
        )
      } satisfies WorkspaceMigrationWorkspaceInput;
    });

    const items = workspaceInputs.map(classifyWorkspaceForMigration);
    const summary = {
      total: items.length,
      team_candidate: items.filter((item) => item.suggested_kind === "team_candidate").length,
      personal_candidate: items.filter((item) => item.suggested_kind === "personal_candidate")
        .length,
      needs_review: items.filter((item) => item.suggested_kind === "needs_review").length
    };

    return {
      generated_at: (options.now ?? new Date()).toISOString(),
      summary,
      workspaces: items
    };
  } finally {
    if (ownsClient) {
      await prisma.$disconnect();
    }
  }
}

export function classifyWorkspaceForMigration(
  workspace: WorkspaceMigrationWorkspaceInput
): WorkspaceMigrationReportItem {
  const reasons: string[] = [];
  const isDefaultWorkspace =
    workspace.slug === "default-workspace" || DEFAULT_WORKSPACE_NAME_RE.test(workspace.name);
  const hasWorkspaceVisibleKnowledgeBase =
    workspace.knowledge_base_counts.workspace + workspace.knowledge_base_counts.public > 0;
  const hasDemoKnowledgeBase = workspace.knowledge_base_counts.demo_named > 0;
  const hasOnlyPrivateKnowledgeBases =
    workspace.knowledge_base_counts.total > 0 &&
    workspace.knowledge_base_counts.private === workspace.knowledge_base_counts.total;
  const singleOwnerId =
    workspace.member_counts.owner === 1 && workspace.owner_user_ids.length === 1
      ? workspace.owner_user_ids[0]
      : null;
  const onlyOneOwnerMember =
    workspace.member_counts.total === 1 &&
    workspace.member_counts.owner === 1 &&
    workspace.member_counts.admin === 0 &&
    workspace.member_counts.member === 0 &&
    workspace.member_counts.guest === 0;
  const createdByIsSingleOwner = Boolean(singleOwnerId && workspace.created_by === singleOwnerId);

  if (isDefaultWorkspace) {
    reasons.push("slug/name matches default/demo/team workspace convention");
  }
  if (workspace.member_counts.total > 1) {
    reasons.push("workspace has more than one member");
  }
  if (hasWorkspaceVisibleKnowledgeBase) {
    reasons.push("workspace contains workspace-visible or public knowledge bases");
  }
  if (hasDemoKnowledgeBase) {
    reasons.push("workspace contains OpenKB Demo-style knowledge bases");
  }
  if (onlyOneOwnerMember) {
    reasons.push("workspace has exactly one owner and no other members");
  }
  if (hasOnlyPrivateKnowledgeBases) {
    reasons.push("all knowledge bases are private");
  }
  if (createdByIsSingleOwner) {
    reasons.push("creator is the only owner");
  }
  if (workspace.member_counts.total === 0) {
    reasons.push("workspace has no members");
  }
  if (workspace.member_counts.owner > 1) {
    reasons.push("workspace has multiple owners");
  }
  if (!workspace.created_by_exists) {
    reasons.push("creator user no longer exists");
  }
  if (workspace.owner_has_other_personal_workspace) {
    reasons.push("single owner already has another personal workspace");
  }

  const teamSignals =
    (workspace.member_counts.total > 1 ? 1 : 0) +
    (hasWorkspaceVisibleKnowledgeBase ? 1 : 0) +
    (isDefaultWorkspace ? 1 : 0) +
    (hasDemoKnowledgeBase ? 1 : 0);
  const personalSignals =
    (onlyOneOwnerMember ? 1 : 0) +
    (hasOnlyPrivateKnowledgeBases ? 1 : 0) +
    (createdByIsSingleOwner ? 1 : 0);
  const reviewSignals =
    (workspace.member_counts.total === 0 ? 1 : 0) +
    (workspace.member_counts.owner > 1 ? 1 : 0) +
    (!workspace.created_by_exists ? 1 : 0) +
    (workspace.owner_has_other_personal_workspace ? 1 : 0) +
    (!isDefaultWorkspace && teamSignals > 0 && personalSignals > 0 ? 1 : 0);

  let suggestedKind: WorkspaceMigrationSuggestion;
  if (isDefaultWorkspace && workspace.member_counts.total > 0 && workspace.created_by_exists) {
    suggestedKind = "team_candidate";
  } else if (reviewSignals > 0) {
    suggestedKind = "needs_review";
  } else if (teamSignals > 0) {
    suggestedKind = "team_candidate";
  } else if (personalSignals >= 3) {
    suggestedKind = "personal_candidate";
  } else {
    suggestedKind = "needs_review";
    reasons.push("insufficient signal for automatic classification");
  }

  const confidence =
    suggestedKind === "needs_review"
      ? "low"
      : suggestedKind === "team_candidate" && teamSignals >= 2
        ? "high"
        : suggestedKind === "personal_candidate" && personalSignals >= 3
          ? "high"
          : "medium";

  return {
    ...workspace,
    is_default_workspace: isDefaultWorkspace,
    suggested_kind: suggestedKind,
    confidence,
    reasons
  };
}

export function formatWorkspaceMigrationReportMarkdown(report: WorkspaceMigrationReport): string {
  const lines = [
    "# OpenKB Workspace Migration Report",
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `- Total workspaces: ${report.summary.total}`,
    `- Team candidates: ${report.summary.team_candidate}`,
    `- Personal candidates: ${report.summary.personal_candidate}`,
    `- Needs review: ${report.summary.needs_review}`,
    "",
    "## Workspaces",
    "",
    "| Workspace | Current kind | Suggested | Confidence | Members | KBs | Docs | Reasons |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |"
  ];

  for (const workspace of report.workspaces) {
    lines.push(
      `| ${[
        `${escapeMarkdownTable(workspace.name)} (${escapeMarkdownTable(workspace.slug)})`,
        workspace.kind ?? "-",
        workspace.suggested_kind,
        workspace.confidence,
        String(workspace.member_counts.total),
        String(workspace.knowledge_base_counts.total),
        String(workspace.document_counts.total),
        escapeMarkdownTable(workspace.reasons.join("; ") || "-")
      ].join(" | ")} |`
    );
  }

  lines.push(
    "",
    "## Notes",
    "",
    "- This report is read-only. It does not move knowledge bases or rewrite private content permissions.",
    "- `default-workspace` and OpenKB Demo-style spaces should stay as team spaces unless an administrator manually migrates metadata through the runbook.",
    "- Personal-space candidates must be reviewed before any metadata-only migration."
  );

  return `${lines.join("\n")}\n`;
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
