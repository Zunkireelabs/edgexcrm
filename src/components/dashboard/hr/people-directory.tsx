"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Users, Pencil, X, Plus, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface Department {
  id: string;
  name: string;
}

interface EmployeeProfile {
  employment_type: string | null;
  employment_status: string;
  billable: boolean;
  weekly_capacity_hours: number;
  job_title: string | null;
  hire_date: string | null;
  phone: string | null;
  department_id: string | null;
  manager_tenant_user_id: string | null;
  departments: { id: string; name: string } | null;
}

interface EmployeeRow {
  tenant_user_id: string;
  user_id: string;
  role: string;
  name: string | null;
  email: string;
  profile: EmployeeProfile | null;
}

interface EmployeeSkill {
  id: string;
  skill_id: string;
  proficiency: number | null;
  skills: { id: string; name: string; category: string | null } | null;
}

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contractor", label: "Contractor" },
  { value: "intern", label: "Intern" },
];
const EMPLOYMENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "notice", label: "Notice period" },
  { value: "terminated", label: "Terminated" },
];

export function PeopleDirectory({
  canManageHR,
  currentUserId,
}: {
  canManageHR: boolean;
  currentUserId: string;
}) {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EmployeeRow | null>(null);
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/employees");
      if (!res.ok) throw new Error("Failed to load employees");
      const { data } = await res.json();
      setRows((data ?? []) as EmployeeRow[]);
    } catch {
      toast.error("Failed to load the People directory");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDepartments = useCallback(async () => {
    if (!canManageHR) return;
    try {
      const res = await fetch("/api/v1/departments");
      if (!res.ok) return;
      const { data } = await res.json();
      setDepartments((data ?? []) as Department[]);
    } catch {
      // Non-fatal: department dropdown just stays empty.
    }
  }, [canManageHR]);

  useEffect(() => {
    load();
    loadDepartments();
  }, [load, loadDepartments]);

  const jobTitleSuggestions = useMemo(
    () => Array.from(new Set(
      rows.map((r) => r.profile?.job_title?.trim()).filter((t): t is string => !!t)
    )).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  async function createDepartment() {
    if (!newDeptName.trim()) return;
    try {
      const res = await fetch("/api/v1/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDeptName.trim() }),
      });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      setDepartments((prev) => [...prev, data]);
      setNewDeptName("");
      setDeptDialogOpen(false);
      toast.success("Department created");
    } catch {
      toast.error("Failed to create department");
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
        <h1 className="text-lg font-bold">People</h1>
        {canManageHR && (
          <Button size="sm" variant="outline" onClick={() => setDeptDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New department
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-background">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">No one visible yet</h3>
          <p className="text-muted-foreground text-sm">
            {canManageHR ? "Team members will appear here once added." : "You'll see your own profile and any direct reports here."}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Job title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Employment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.tenant_user_id}>
                  <TableCell className="font-medium">
                    {row.name ?? row.email}
                    {row.user_id === currentUserId && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">You</Badge>
                    )}
                  </TableCell>
                  <TableCell>{row.profile?.job_title ?? "—"}</TableCell>
                  <TableCell>{row.profile?.departments?.name ?? "—"}</TableCell>
                  <TableCell>
                    {row.profile?.employment_type
                      ? EMPLOYMENT_TYPES.find((t) => t.value === row.profile?.employment_type)?.label
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.profile?.employment_status === "active" ? "default" : "secondary"}>
                      {EMPLOYMENT_STATUSES.find((s) => s.value === (row.profile?.employment_status ?? "active"))?.label ?? "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => setEditTarget(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editTarget && (
        <EmployeeEditSheet
          row={editTarget}
          departments={departments}
          jobTitleSuggestions={jobTitleSuggestions}
          canManageHR={canManageHR}
          isSelf={editTarget.user_id === currentUserId}
          onClose={() => setEditTarget(null)}
          onSaved={(updated) => {
            setRows((prev) => prev.map((r) => (r.tenant_user_id === updated.tenant_user_id ? updated : r)));
            setEditTarget(null);
          }}
        />
      )}

      {deptDialogOpen && (
        <Sheet open onOpenChange={(open) => !open && setDeptDialogOpen(false)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>New department</SheetTitle>
            </SheetHeader>
            <div className="px-4 space-y-2">
              <Label htmlFor="dept-name">Name</Label>
              <Input id="dept-name" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="e.g. Engineering" />
            </div>
            <SheetFooter>
              <Button onClick={createDepartment}>Create</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function EmployeeEditSheet({
  row,
  departments,
  jobTitleSuggestions,
  canManageHR,
  isSelf,
  onClose,
  onSaved,
}: {
  row: EmployeeRow;
  departments: Department[];
  jobTitleSuggestions: string[];
  canManageHR: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (row: EmployeeRow) => void;
}) {
  const [jobTitle, setJobTitle] = useState(row.profile?.job_title ?? "");
  const [phone, setPhone] = useState(row.profile?.phone ?? "");
  const [employmentType, setEmploymentType] = useState(row.profile?.employment_type ?? "");
  const [employmentStatus, setEmploymentStatus] = useState(row.profile?.employment_status ?? "active");
  const [departmentId, setDepartmentId] = useState(row.profile?.department_id ?? "");
  const [capacityHours, setCapacityHours] = useState(String(row.profile?.weekly_capacity_hours ?? 40));
  const [skills, setSkills] = useState<EmployeeSkill[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<{ id: string; name: string; category: string | null }[]>([]);
  const [newSkillId, setNewSkillId] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEditHRFields = canManageHR;
  const canEditAtAll = canManageHR || isSelf;

  useEffect(() => {
    fetch(`/api/v1/employees/${row.tenant_user_id}/skills`)
      .then((r) => r.json())
      .then(({ data }) => setSkills((data ?? []) as EmployeeSkill[]))
      .catch(() => {});
    if (canManageHR) {
      fetch("/api/v1/skills")
        .then((r) => r.json())
        .then(({ data }) => setSkillCatalog(data ?? []))
        .catch(() => {});
    }
    fetch(`/api/v1/employees/${row.tenant_user_id}/photo`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setPhotoUrl(json?.data?.url ?? null))
      .catch(() => {});
  }, [row.tenant_user_id, canManageHR]);

  async function uploadPhoto(file: File) {
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error("Photo must be under 5 MB");
      return;
    }
    if (!PHOTO_ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Photo must be JPEG, PNG, or WebP");
      return;
    }
    setUploadingPhoto(true);
    try {
      const urlRes = await fetch(`/api/v1/employees/${row.tenant_user_id}/photo-upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, file_size: file.size, mime_type: file.type }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlJson.error?.message || "Failed to get upload URL");
      const { token, path } = urlJson.data as { token: string; path: string };

      const supabase = createClient();
      const { error: storageError } = await supabase.storage
        .from("employee-photos")
        .uploadToSignedUrl(path, token, file);
      if (storageError) throw new Error(storageError.message);

      const patchRes = await fetch(`/api/v1/employees/${row.tenant_user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_url: path }),
      });
      if (!patchRes.ok) throw new Error("Failed to save photo reference");

      const photoRes = await fetch(`/api/v1/employees/${row.tenant_user_id}/photo`);
      const photoJson = await photoRes.json();
      setPhotoUrl(photoJson?.data?.url ?? null);
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  const availableSkills = useMemo(
    () => skillCatalog.filter((s) => !skills.some((es) => es.skill_id === s.id)),
    [skillCatalog, skills]
  );

  async function save() {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { job_title: jobTitle || null, phone: phone || null };
      if (canEditHRFields) {
        patch.employment_type = employmentType || null;
        patch.employment_status = employmentStatus;
        patch.department_id = departmentId || null;
        patch.weekly_capacity_hours = Number(capacityHours) || 40;
      }
      const res = await fetch(`/api/v1/employees/${row.tenant_user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      onSaved({ ...row, profile: data });
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function attachSkill() {
    if (!newSkillId) return;
    try {
      const res = await fetch(`/api/v1/employees/${row.tenant_user_id}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: newSkillId }),
      });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      setSkills((prev) => [...prev, data]);
      setNewSkillId("");
    } catch {
      toast.error("Failed to add skill");
    }
  }

  async function detachSkill(skillId: string) {
    try {
      const res = await fetch(`/api/v1/employees/${row.tenant_user_id}/skills?skill_id=${skillId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setSkills((prev) => prev.filter((s) => s.skill_id !== skillId));
    } catch {
      toast.error("Failed to remove skill");
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row.name ?? row.email}</SheetTitle>
        </SheetHeader>
        <div className="px-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
                <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Users className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            {canEditAtAll && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={PHOTO_ACCEPTED_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadPhoto(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4 mr-1.5" />
                  {uploadingPhoto ? "Uploading…" : "Change photo"}
                </Button>
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Job title</Label>
            <Input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              disabled={!canEditAtAll}
              list={`job-title-suggestions-${row.tenant_user_id}`}
            />
            <datalist id={`job-title-suggestions-${row.tenant_user_id}`}>
              {jobTitleSuggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canEditAtAll} />
          </div>

          {canEditHRFields && (
            <>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Employment status</Label>
                <Select value={employmentStatus} onValueChange={setEmploymentStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Weekly capacity (hours)</Label>
                <Input type="number" value={capacityHours} onChange={(e) => setCapacityHours(e.target.value)} />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Skills</Label>
            <div className="flex flex-wrap gap-1.5">
              {skills.length === 0 && <p className="text-xs text-muted-foreground">No skills added yet.</p>}
              {skills.map((s) => (
                <Badge key={s.id} variant="secondary" className="gap-1">
                  {s.skills?.name ?? "Unknown"}
                  {s.proficiency ? ` · ${s.proficiency}/5` : ""}
                  {canEditAtAll && (
                    <button type="button" onClick={() => detachSkill(s.skill_id)} aria-label="Remove skill">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
            {canManageHR && availableSkills.length > 0 && (
              <div className="flex gap-2 pt-1">
                <Select value={newSkillId} onValueChange={setNewSkillId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Add a skill" /></SelectTrigger>
                  <SelectContent>
                    {availableSkills.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={attachSkill}>Add</Button>
              </div>
            )}
          </div>
        </div>
        {canEditAtAll && (
          <SheetFooter>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
