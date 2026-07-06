"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Users, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Project {
  id: string;
  name: string;
  status: string;
}

interface TeamMember {
  id: string; // tenant_users.id
  user_id: string;
  name: string | null;
  email: string;
}

interface Allocation {
  id: string;
  project_id: string;
  tenant_user_id: string;
  hours_per_week: number;
  role_on_project: string | null;
  projects: { id: string; name: string; status: string } | null;
}

interface EmployeeSkillRow {
  tenant_user_id: string;
  skill_id: string;
  proficiency: number | null;
  skills: { id: string; name: string; category: string | null } | null;
}

interface EmployeeRow {
  tenant_user_id: string;
  name: string | null;
  email: string;
}

interface Skill {
  id: string;
  name: string;
  category: string | null;
}

export function ResourcingBoard({ canManageHR }: { canManageHR: boolean }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, teamRes, allocRes] = await Promise.all([
        fetch("/api/v1/projects"),
        fetch("/api/v1/team"),
        fetch("/api/v1/project-allocations"),
      ]);
      const [projJson, teamJson, allocJson] = await Promise.all([projRes.json(), teamRes.json(), allocRes.json()]);
      setProjects((projJson.data ?? []) as Project[]);
      setTeam((teamJson.data ?? []) as TeamMember[]);
      setAllocations((allocJson.data ?? []) as Allocation[]);
    } catch {
      toast.error("Failed to load resourcing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const memberById = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);

  const allocationsByMember = useMemo(() => {
    const map = new Map<string, Allocation[]>();
    for (const a of allocations) {
      const list = map.get(a.tenant_user_id) ?? [];
      list.push(a);
      map.set(a.tenant_user_id, list);
    }
    return map;
  }, [allocations]);

  const bench = useMemo(
    () => team.filter((m) => (allocationsByMember.get(m.id) ?? []).length === 0),
    [team, allocationsByMember]
  );

  async function deleteAllocation(id: string) {
    try {
      const res = await fetch(`/api/v1/project-allocations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setAllocations((prev) => prev.filter((a) => a.id !== id));
      toast.success("Allocation removed");
    } catch {
      toast.error("Failed to remove allocation");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden pr-6">
      <div className="flex items-center justify-between shrink-0 mb-4">
        <h1 className="text-lg font-bold">Resourcing</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Allocate member
        </Button>
      </div>

      <Tabs defaultValue="allocations" className="flex flex-col flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="allocations">Allocations</TabsTrigger>
          {canManageHR && <TabsTrigger value="skills">Skills Matrix</TabsTrigger>}
        </TabsList>

        <TabsContent value="allocations" className="flex-1 min-h-0 overflow-y-auto space-y-6">
          <div className="border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Hours / week</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      No allocations yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  allocations.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{memberById.get(a.tenant_user_id)?.name ?? memberById.get(a.tenant_user_id)?.email ?? "Unknown"}</TableCell>
                      <TableCell>{a.projects?.name ?? "Unknown"}</TableCell>
                      <TableCell>{a.role_on_project ?? "—"}</TableCell>
                      <TableCell>{a.hours_per_week}h</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => deleteAllocation(a.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" /> Bench ({bench.length})
            </h2>
            {bench.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everyone is allocated to at least one project.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {bench.map((m) => <Badge key={m.id} variant="secondary">{m.name ?? m.email}</Badge>)}
              </div>
            )}
          </div>
        </TabsContent>

        {canManageHR && (
          <TabsContent value="skills" className="flex-1 min-h-0 overflow-y-auto">
            <SkillsMatrix />
          </TabsContent>
        )}
      </Tabs>

      {createOpen && (
        <AllocateMemberDialog
          projects={projects}
          team={team}
          onClose={() => setCreateOpen(false)}
          onCreated={(a) => { setAllocations((prev) => [a, ...prev]); setCreateOpen(false); }}
        />
      )}
    </div>
  );
}

function AllocateMemberDialog({
  projects, team, onClose, onCreated,
}: {
  projects: Project[];
  team: TeamMember[];
  onClose: () => void;
  onCreated: (a: Allocation) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [tenantUserId, setTenantUserId] = useState("");
  const [hours, setHours] = useState("10");
  const [roleOnProject, setRoleOnProject] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!projectId || !tenantUserId) {
      toast.error("Select a project and a member");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/project-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          tenant_user_id: tenantUserId,
          hours_per_week: Number(hours),
          role_on_project: roleOnProject || null,
        }),
      });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      onCreated(data as Allocation);
      toast.success("Member allocated");
    } catch {
      toast.error("Failed to allocate member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Allocate member to project</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Member</Label>
            <Select value={tenantUserId} onValueChange={setTenantUserId}>
              <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name ?? m.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Hours / week</Label>
            <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role on project (optional)</Label>
            <Input value={roleOnProject} onChange={(e) => setRoleOnProject(e.target.value)} placeholder="e.g. Frontend Developer" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Allocate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillsMatrix() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [matrix, setMatrix] = useState<Map<string, Map<string, number | null>>>(new Map());

  useEffect(() => {
    async function load() {
      try {
        const [empRes, skillRes] = await Promise.all([
          fetch("/api/v1/employees"),
          fetch("/api/v1/skills"),
        ]);
        const [empJson, skillJson] = await Promise.all([empRes.json(), skillRes.json()]);
        const emps = (empJson.data ?? []) as EmployeeRow[];
        setEmployees(emps);
        setSkills((skillJson.data ?? []) as Skill[]);

        const results = await Promise.all(
          emps.map((e) => fetch(`/api/v1/employees/${e.tenant_user_id}/skills`).then((r) => r.json()))
        );
        const m = new Map<string, Map<string, number | null>>();
        emps.forEach((e, i) => {
          const rows = (results[i]?.data ?? []) as EmployeeSkillRow[];
          const inner = new Map<string, number | null>();
          for (const r of rows) inner.set(r.skill_id, r.proficiency);
          m.set(e.tenant_user_id, inner);
        });
        setMatrix(m);
      } catch {
        toast.error("Failed to load skills matrix");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (skills.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No skills in the catalog yet.</p>;
  }

  return (
    <div className="border rounded-lg overflow-x-auto bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-card">Member</TableHead>
            {skills.map((s) => <TableHead key={s.id} className="text-center whitespace-nowrap">{s.name}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((e) => (
            <TableRow key={e.tenant_user_id}>
              <TableCell className="sticky left-0 bg-card font-medium whitespace-nowrap">{e.name ?? e.email}</TableCell>
              {skills.map((s) => {
                const prof = matrix.get(e.tenant_user_id)?.get(s.id);
                return (
                  <TableCell key={s.id} className="text-center">
                    {prof ? <Badge variant="secondary">{prof}/5</Badge> : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
