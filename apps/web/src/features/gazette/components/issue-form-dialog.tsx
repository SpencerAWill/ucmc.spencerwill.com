import { format } from "date-fns";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
  useCreateGazetteIssue,
  useUpdateGazetteIssue,
} from "#/features/gazette/api/use-gazette-mutations";
import { GAZETTE_PDF_MAX_BYTES } from "#/features/gazette/server/gazette-schemas";
import type { GazetteIssueSummary } from "#/features/gazette/server/gazette-fns";

/**
 * Seed for opening the issue dialog. `mode = "create"` opens a fresh
 * form (parent can optionally pre-fill the school year). `mode = "edit"`
 * pre-loads from an existing issue — PDF is optional on save (omit
 * to keep the current file, attach to replace).
 */
export type IssueFormSeed =
  | {
      mode: "create";
      defaultSchoolYear?: string;
      defaultIssueNumber?: number;
    }
  | {
      mode: "edit";
      issue: GazetteIssueSummary;
    };

const SCHOOL_YEAR_RE = /^\d{4}-\d{2}$/;

interface FormState {
  schoolYear: string;
  startYear: string;
  issueNumber: string;
  title: string;
  editor: string;
  publishedAt: string;
  description: string;
  pdfDataUrl: string | null;
  pdfFileName: string | null;
  pdfBytes: number | null;
}

function seedToForm(seed: IssueFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      schoolYear: seed.issue.schoolYear,
      startYear: String(seed.issue.startYear),
      issueNumber: String(seed.issue.issueNumber),
      title: seed.issue.title ?? "",
      editor: seed.issue.editor ?? "",
      publishedAt: seed.issue.publishedAt
        ? format(new Date(seed.issue.publishedAt), "yyyy-MM-dd")
        : "",
      description: seed.issue.description ?? "",
      pdfDataUrl: null,
      pdfFileName: null,
      pdfBytes: seed.issue.pdfBytes,
    };
  }
  return {
    schoolYear: seed.defaultSchoolYear ?? "",
    startYear:
      seed.defaultSchoolYear && SCHOOL_YEAR_RE.test(seed.defaultSchoolYear)
        ? seed.defaultSchoolYear.slice(0, 4)
        : "",
    issueNumber:
      seed.defaultIssueNumber !== undefined
        ? String(seed.defaultIssueNumber)
        : "1",
    title: "",
    editor: "",
    publishedAt: "",
    description: "",
    pdfDataUrl: null,
    pdfFileName: null,
    pdfBytes: null,
  };
}

export function IssueFormDialog({
  seed,
  onClose,
}: {
  seed: IssueFormSeed | null;
  onClose: () => void;
}) {
  const createMut = useCreateGazetteIssue();
  const updateMut = useUpdateGazetteIssue();
  const [form, setForm] = useState<FormState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed whenever the dialog opens. Without this, opening edit
  // after a previous edit would keep the prior form values.
  useEffect(() => {
    setForm(seed === null ? null : seedToForm(seed));
  }, [seed]);

  const submitting = createMut.isPending || updateMut.isPending;

  async function handleFileChange(file: File | null) {
    if (!form || !file) {
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Pick a PDF file.");
      return;
    }
    if (file.size > GAZETTE_PDF_MAX_BYTES) {
      toast.error(
        `PDF must be under ${GAZETTE_PDF_MAX_BYTES / (1024 * 1024)} MB (got ${(
          file.size /
          (1024 * 1024)
        ).toFixed(1)} MB).`,
      );
      return;
    }
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
    setForm({
      ...form,
      pdfDataUrl: dataUrl,
      pdfFileName: file.name,
      pdfBytes: file.size,
    });
  }

  async function submit() {
    if (!form || !seed) {
      return;
    }
    if (!SCHOOL_YEAR_RE.test(form.schoolYear)) {
      toast.error("School year must look like 2026-27.");
      return;
    }
    const startYear = Number.parseInt(form.startYear, 10);
    if (!Number.isFinite(startYear) || startYear < 1900 || startYear > 2100) {
      toast.error("Start year must be a four-digit calendar year.");
      return;
    }
    const issueNumber = Number.parseInt(form.issueNumber, 10);
    if (!Number.isFinite(issueNumber) || issueNumber < 1 || issueNumber > 99) {
      toast.error("Issue number must be between 1 and 99.");
      return;
    }
    if (seed.mode === "create" && !form.pdfDataUrl) {
      toast.error("Attach a PDF.");
      return;
    }

    const title = form.title.trim().length > 0 ? form.title.trim() : null;
    const editor = form.editor.trim().length > 0 ? form.editor.trim() : null;
    const description =
      form.description.trim().length > 0 ? form.description.trim() : null;
    const publishedAt =
      form.publishedAt.length > 0 ? new Date(form.publishedAt) : null;

    const base = {
      schoolYear: form.schoolYear,
      startYear,
      issueNumber,
      title,
      editor,
      publishedAt,
      description,
    };

    try {
      if (seed.mode === "create") {
        if (!form.pdfDataUrl) {
          toast.error("Attach a PDF.");
          return;
        }
        await createMut.mutateAsync({ ...base, pdfDataUrl: form.pdfDataUrl });
        toast.success("Issue uploaded.");
      } else {
        await updateMut.mutateAsync({
          publicId: seed.issue.publicId,
          ...base,
          ...(form.pdfDataUrl ? { pdfDataUrl: form.pdfDataUrl } : {}),
        });
        toast.success("Issue updated.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the issue.",
      );
    }
  }

  return (
    <Dialog
      open={seed !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {seed?.mode === "edit" ? "Edit Gazette issue" : "Add Gazette issue"}
          </DialogTitle>
          <DialogDescription>
            School year (YYYY-YY) + issue number is unique. Title and editor are
            optional. PDF is required on create; on edit, leave the file input
            empty to keep the existing PDF.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="gazette-issue-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submit();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="gazette-school-year">
                  School year (YYYY-YY)
                </Label>
                <Input
                  id="gazette-school-year"
                  value={form.schoolYear}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm({
                      ...form,
                      schoolYear: next,
                      startYear: SCHOOL_YEAR_RE.test(next)
                        ? next.slice(0, 4)
                        : form.startYear,
                    });
                  }}
                  placeholder="2026-27"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gazette-start-year">Start year</Label>
                <Input
                  id="gazette-start-year"
                  type="number"
                  value={form.startYear}
                  onChange={(e) =>
                    setForm({ ...form, startYear: e.target.value })
                  }
                  placeholder="2026"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gazette-issue-number">Issue number</Label>
                <Input
                  id="gazette-issue-number"
                  type="number"
                  min={1}
                  max={99}
                  value={form.issueNumber}
                  onChange={(e) =>
                    setForm({ ...form, issueNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gazette-published-at">Published date</Label>
                <Input
                  id="gazette-published-at"
                  type="date"
                  value={form.publishedAt}
                  onChange={(e) =>
                    setForm({ ...form, publishedAt: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gazette-title">Title (optional)</Label>
                <Input
                  id="gazette-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Fall 2026 Issue"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gazette-editor">Editor (optional)</Label>
                <Input
                  id="gazette-editor"
                  value={form.editor}
                  onChange={(e) => setForm({ ...form, editor: e.target.value })}
                  placeholder="Issue editor's name"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gazette-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="gazette-description"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="Brief blurb shown on the list view…"
                  rows={3}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="gazette-pdf">
                  PDF{" "}
                  {seed?.mode === "create"
                    ? "(required)"
                    : "(optional — leave empty to keep current)"}
                </Label>
                <input
                  ref={fileInputRef}
                  id="gazette-pdf"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) =>
                    void handleFileChange(e.target.files?.[0] ?? null)
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-4" />
                    {form.pdfDataUrl ? "Replace PDF" : "Choose PDF"}
                  </Button>
                  {form.pdfFileName ? (
                    <span className="text-xs text-muted-foreground">
                      {form.pdfFileName}
                      {form.pdfBytes !== null
                        ? ` · ${(form.pdfBytes / (1024 * 1024)).toFixed(1)} MB`
                        : null}
                    </span>
                  ) : seed?.mode === "edit" && form.pdfBytes !== null ? (
                    <span className="text-xs text-muted-foreground">
                      Current PDF: {(form.pdfBytes / (1024 * 1024)).toFixed(1)}{" "}
                      MB
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="gazette-issue-form"
            disabled={submitting || form === null}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
