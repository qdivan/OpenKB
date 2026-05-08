import { ShieldCheck } from "lucide-react";

export default function PermissionBoundaryPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase text-zinc-500">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold">Permission Boundary</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Admin roles manage accounts and configuration. They do not automatically grant private
          knowledge base or document read access.
        </p>
      </div>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <ShieldCheck className="h-4 w-4 text-emerald-700" />
          Current v0.x rule
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <BoundaryRule title="Account admin">
            `system_admin` and `tenant_admin` can use admin pages and account management APIs.
          </BoundaryRule>
          <BoundaryRule title="Content permission">
            Private documents still require explicit workspace, knowledge base, or document access.
          </BoundaryRule>
          <BoundaryRule title="Audited exception">
            Any future emergency content access must be explicit and audited, not implicit.
          </BoundaryRule>
        </div>
      </section>
    </div>
  );
}

function BoundaryRule({ children, title }: { children: string; title: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{children}</p>
    </div>
  );
}
