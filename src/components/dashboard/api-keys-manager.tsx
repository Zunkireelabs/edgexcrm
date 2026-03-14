"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Copy, Check, Key, AlertTriangle, Shield, FlaskConical, Loader2 } from "lucide-react";

type ApiKeyScope = "read" | "write" | "admin";

interface ApiKeyRow {
  id: string;
  name: string;
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  status: "active" | "revoked";
}

interface CreatedKeyResponse {
  id: string;
  name: string;
  scope: string;
  key: string;
  created_at: string;
}

interface ApiKeysManagerProps {
  tenantId: string;
  initialKeys: ApiKeyRow[];
}

export function ApiKeysManager({ initialKeys }: ApiKeysManagerProps) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScope, setKeyScope] = useState<ApiKeyScope>("read");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const refreshKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/settings/api-keys");
      if (res.ok) {
        const json = await res.json();
        setKeys(json.data || []);
      }
    } catch {
      // silent — keys will refresh on next action
    }
  }, []);

  async function handleCreate() {
    if (!keyName.trim()) {
      toast.error("Key name is required");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/v1/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim(), scope: keyScope }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg =
          json.error?.message || "Failed to create API key";
        toast.error(msg);
        setCreating(false);
        return;
      }

      setCreatedKey(json.data);
      setCopied(false);
      setConfirmed(false);
      await refreshKeys();
    } catch {
      toast.error("Network error creating API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke API key "${name}"? This cannot be undone.`)) return;

    setRevokingId(id);
    try {
      const res = await fetch(`/api/v1/settings/api-keys/${id}`, {
        method: "DELETE",
      });

      if (res.status === 204) {
        toast.success(`API key "${name}" revoked`);
        await refreshKeys();
      } else {
        const json = await res.json();
        toast.error(json.error?.message || "Failed to revoke key");
      }
    } catch {
      toast.error("Network error revoking key");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/v1/settings/api-keys/${id}/test`, {
        method: "POST",
      });

      const json = await res.json();
      const result = json.data;

      if (!res.ok || !result) {
        toast.error("Failed to test key");
        return;
      }

      if (result.status === "ok") {
        toast.success(
          `Key is valid and working (scope: ${result.scope}, rate limit remaining: ${result.rate_limit_remaining})`
        );
      } else {
        const messages: Record<string, string> = {
          revoked: "Key is revoked",
          insufficient_scope: "Insufficient permissions",
          tenant_suspended: "Tenant is suspended",
          rate_limited: "Rate limit exceeded — try again in a minute",
        };
        toast.error(messages[result.reason] || "Key test failed");
      }
    } catch {
      toast.error("Network error testing key");
    } finally {
      setTestingId(null);
    }
  }

  function handleCopyKey() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    toast.success("API key copied to clipboard");
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setKeyName("");
    setKeyScope("read");
    setCreatedKey(null);
    setCopied(false);
    setConfirmed(false);
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getScopeLabel(permissions: string[]): string {
    if (permissions.includes("admin")) return "Admin";
    if (permissions.includes("write")) return "Write";
    return "Read";
  }

  function getScopeBadgeVariant(permissions: string[]) {
    if (permissions.includes("admin")) return "destructive" as const;
    if (permissions.includes("write")) return "default" as const;
    return "secondary" as const;
  }

  const activeCount = keys.filter((k) => k.status === "active").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
            <CardDescription>
              Manage integration keys for external services like Orca.
              {activeCount > 0 && (
                <span className="ml-1">
                  {activeCount}/20 active keys
                </span>
              )}
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={(open) => {
            if (!open) handleCloseCreate();
            else setCreateOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Create API Key
              </Button>
            </DialogTrigger>
            <DialogContent showCloseButton={!createdKey}>
              {!createdKey ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                    <DialogDescription>
                      Generate a new key for external integrations.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="key-name">Key Name</Label>
                      <Input
                        id="key-name"
                        placeholder='e.g. "Orca Connector"'
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="key-scope">Scope</Label>
                      <Select
                        value={keyScope}
                        onValueChange={(v) => setKeyScope(v as ApiKeyScope)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">
                            Read — View leads & pipeline
                          </SelectItem>
                          <SelectItem value="write">
                            Write — Read + create/update leads
                          </SelectItem>
                          <SelectItem value="admin">
                            Admin — Full access
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        This key will be shown <strong>only once</strong>. Store
                        it securely — it cannot be retrieved later.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={handleCloseCreate}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreate}
                      disabled={creating || !keyName.trim()}
                    >
                      {creating ? "Creating..." : "Create Key"}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-green-600" />
                      API Key Created
                    </DialogTitle>
                    <DialogDescription>
                      Copy your key now. You will not be able to see it again.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    {/* Key display */}
                    <div className="space-y-2">
                      <Label>Your API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={createdKey.key}
                          className="font-mono text-sm"
                        />
                        <Button
                          variant={copied ? "default" : "outline"}
                          size="icon"
                          onClick={handleCopyKey}
                          className="shrink-0"
                        >
                          {copied ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Integration instructions */}
                    <div className="rounded-md border bg-muted/50 p-4 space-y-3">
                      <p className="text-sm font-medium">Quick Integration Guide</p>
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Base URL</p>
                          <code className="text-sm block mt-0.5">
                            https://lead-crm.zunkireelabs.com
                          </code>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Authorization Header
                          </p>
                          <code className="text-sm block mt-0.5 break-all">
                            Bearer {createdKey.key}
                          </code>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Example Request
                          </p>
                          <pre className="text-xs mt-1 bg-background rounded p-2 overflow-x-auto">
{`curl -H "Authorization: Bearer ${createdKey.key.slice(0, 20)}..." \\
  https://lead-crm.zunkireelabs.com/api/v1/integrations/crm/leads`}
                          </pre>
                        </div>
                      </div>
                    </div>

                    {/* Confirmation checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm">
                        I have stored this key securely
                      </span>
                    </label>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleCloseCreate}
                      disabled={!confirmed}
                    >
                      Done
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No API keys yet</p>
            <p className="text-xs mt-1">
              Create a key to connect external services like Orca.
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => {
                  const isRevoked = key.status === "revoked";
                  return (
                    <TableRow
                      key={key.id}
                      className={isRevoked ? "opacity-50" : ""}
                    >
                      <TableCell className="font-medium">
                        {key.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getScopeBadgeVariant(key.permissions)}>
                          {getScopeLabel(key.permissions)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(key.created_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(key.last_used_at)}
                      </TableCell>
                      <TableCell>
                        {isRevoked ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Revoked
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                          >
                            Active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isRevoked && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={testingId === key.id}
                              onClick={() => handleTest(key.id)}
                            >
                              {testingId === key.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <FlaskConical className="h-3.5 w-3.5 mr-1" />
                              )}
                              Test
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={revokingId === key.id}
                              onClick={() => handleRevoke(key.id, key.name)}
                            >
                              {revokingId === key.id ? "Revoking..." : "Revoke"}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
